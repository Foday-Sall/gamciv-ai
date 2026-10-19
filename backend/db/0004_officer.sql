-- 0004_officer.sql — authorization helpers + officer/admin RPCs
create or replace function public.fn_is_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select true from public.profiles p
     where p.user_id = auth.uid() and p.role = 'admin'),
    false
  );
$$;

create or replace function public.fn_my_institution()
returns uuid
language sql stable
security definer
set search_path = ''
as $$
  select o.institution_id
  from public.officers o
  where o.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.fn_is_officer_of(
  p_complaint_id uuid
) returns boolean
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_inst uuid;
  v_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.fn_is_admin() then
    return true;
  end if;

  select institution_id into v_inst
  from public.complaints where id = p_complaint_id;
  if v_inst is null then
    return false;
  end if;

  if exists (
    select 1 from public.officers o
    where o.user_id = auth.uid() and o.institution_id = v_inst
  ) then
    return true;
  end if;

  select role::text into v_role
  from public.profiles
  where user_id = auth.uid();
  if v_role = 'officer' then
    return exists (
      select 1 from public.officers o
      where o.user_id = auth.uid() and o.institution_id = v_inst
    );
  end if;

  return false;
end $$;

create or replace function public.fn_officer_accept(
  p_complaint_id uuid
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
  v_officer public.officers%rowtype;
begin
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if c.status not in ('submitted','received','escalated') then
    return false;
  end if;

  select * into v_officer from public.officers where user_id = auth.uid() limit 1;

  update public.complaints
     set status = 'assigned',
         officer_id = v_officer.id,
         department_id = coalesce(c.department_id, v_officer.department_id)
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation
  ) values (
    c.id, auth.uid(), 'officer', 'assignment',
    c.status, 'assigned', 'Case accepted by officer'
  );

  perform public.fn_notify_citizen(
    c.id,
    'Update: your report ' || c.tracking_no ||
    ' has been assigned to an officer.'
  );

  return true;
end $$;

create or replace function public.fn_officer_reject(
  p_complaint_id uuid,
  p_reason text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then
    return false;
  end if;

  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if c.status not in ('submitted','received','assigned','escalated') then
    return false;
  end if;

  update public.complaints set status = 'rejected' where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'status',
    c.status, 'rejected', p_reason,
    'Your report ' || c.tracking_no || ' was not accepted: ' || btrim(p_reason),
    true
  );

  perform public.fn_notify_citizen(
    c.id,
    'Your report ' || c.tracking_no || ' was not accepted: ' || btrim(p_reason)
  );

  return true;
end $$;

create or replace function public.fn_officer_request_info(
  p_complaint_id uuid,
  p_message text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
begin
  if p_message is null or length(btrim(p_message)) < 5 then
    return false;
  end if;

  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if c.status not in ('assigned','in_progress','waiting_info') then
    return false;
  end if;

  update public.complaints set status = 'waiting_info' where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'status',
    c.status, 'waiting_info', btrim(p_message), true
  );

  perform public.fn_notify_citizen(c.id, btrim(p_message));

  return true;
end $$;

create or replace function public.fn_officer_set_status(
  p_complaint_id uuid,
  p_status text,
  p_citizen_message text default null
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
begin
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;

  if p_status = 'in_progress' and c.status in ('assigned','waiting_info') then
    v_allowed := true;
  elsif p_status = 'citizen_confirmation' and c.status in ('assigned','in_progress','waiting_info') then
    if p_citizen_message is null or length(btrim(p_citizen_message)) < 5 then
      return false;
    end if;
    v_allowed := true;
  end if;

  if not v_allowed then
    return false;
  end if;

  update public.complaints
     set status = p_status::public.complaint_status,
         resolved_at = case when p_status = 'citizen_confirmation' then now() else resolved_at end,
         resolution_note = case when p_status = 'citizen_confirmation' then btrim(p_citizen_message) else resolution_note end
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'status',
    c.status, p_status::public.complaint_status,
    case when p_status = 'citizen_confirmation'
         then 'Crew reports fixed. Reply YES to confirm or NO to reopen.'
         else btrim(coalesce(p_citizen_message, 'Status updated: ' || p_status))
    end,
    true
  );

  perform public.fn_notify_citizen(
    c.id,
    case when p_status = 'citizen_confirmation'
         then 'Your report ' || c.tracking_no || ': crew reports fixed. Reply YES to confirm or NO to reopen.'
         else 'Update on your report ' || c.tracking_no || ': ' || p_status
    end
  );

  return true;
end $$;

create or replace function public.fn_officer_note(
  p_complaint_id uuid,
  p_note text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    return false;
  end if;
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type, explanation, is_citizen_visible
  ) values (
    p_complaint_id, auth.uid(), 'officer', 'note', btrim(p_note), false
  );

  return true;
end $$;

create or replace function public.fn_officer_attach_proof(
  p_complaint_id uuid,
  p_photo_url text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
begin
  if p_photo_url is null or length(btrim(p_photo_url)) < 5 then
    return false;
  end if;
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;

  update public.complaints
     set resolution_photo_url = coalesce(resolution_photo_url, btrim(p_photo_url))
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'attachment',
    'Proof attached by ' || c.tracking_no || ' handling team.', true
  );

  return true;
end $$;
