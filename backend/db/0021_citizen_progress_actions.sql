begin;

-- Direct complaint-photo writes are limited to the verified citizen who filed
-- a non-anonymous web report. The service-role citizen-photo-upload Edge
-- Function performs the same ownership checks before its upload.
drop policy if exists "photos_insert" on storage.objects;
create policy "photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'complaint-photos'
    and exists (
      select 1
      from public.complaints c
      join public.profiles p on p.user_id = auth.uid()
      where c.id = (storage.foldername(name))[1]::uuid
        and c.citizen_id = auth.uid()
        and c.channel = 'web'::public.report_channel
        and c.is_anonymous = false
        and p.role = 'citizen'::public.user_role
    )
  );

-- Keep assignment visible in the citizen's safe tracking timeline. The
-- authenticated institution scope is still checked by the existing helper.
create or replace function public.fn_officer_accept(
  p_complaint_id uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c public.complaints%rowtype;
  v_officer public.officers%rowtype;
  v_institution_name text;
begin
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c
  from public.complaints
  where id = p_complaint_id
  for update;

  if not found or c.status not in ('submitted', 'received', 'escalated') then
    return false;
  end if;

  select * into v_officer
  from public.officers
  where user_id = auth.uid()
  limit 1;

  update public.complaints
  set status = 'assigned',
      officer_id = v_officer.id,
      department_id = coalesce(c.department_id, v_officer.department_id)
  where id = c.id;

  select i.name into v_institution_name
  from public.institutions i
  where i.id = c.institution_id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'assignment',
    c.status, 'assigned', 'Case accepted by officer',
    'Your report has been assigned to an officer at ' || coalesce(v_institution_name, 'the responsible service') || '.',
    true
  );

  perform public.fn_notify_citizen(
    c.id,
    'Update: your report ' || c.tracking_no ||
    ' has been assigned to an officer.'
  );

  return true;
end;
$fn$;

-- Use the supplied citizen-facing note in the timeline when staff report a
-- fix. Keep the established reply instructions in the external notification.
create or replace function public.fn_officer_set_status(
  p_complaint_id uuid,
  p_status text,
  p_citizen_message text default null
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
  v_timeline_message text;
  v_notification text;
begin
  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c
  from public.complaints
  where id = p_complaint_id
  for update;

  if p_status = 'in_progress' and c.status in ('assigned', 'waiting_info', 'reopened') then
    v_allowed := true;
  elsif p_status = 'citizen_confirmation' and c.status = 'in_progress' then
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

  v_timeline_message := case
    when p_status = 'citizen_confirmation' then 'Fix reported: ' || btrim(p_citizen_message)
    else coalesce(nullif(btrim(p_citizen_message), ''), 'Work has started on your report.')
  end;
  v_notification := case
    when p_status = 'citizen_confirmation' then
      'Your report ' || c.tracking_no || ': the handling service reports a fix. Reply YES to confirm or NO to reopen.'
    else
      'Update on your report ' || c.tracking_no || ': work has started.'
  end;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'status',
    c.status, p_status::public.complaint_status,
    v_timeline_message, true
  );

  perform public.fn_notify_citizen(c.id, v_notification);
  return true;
end;
$fn$;

-- Preserve the RPC shape for compatible clients but never accept staff
-- resolution-photo paths. Repair reports contain a citizen-facing note only.
create or replace function public.fn_officer_report_resolution(
  p_complaint_id uuid,
  p_citizen_message text,
  p_resolution_photo_url text default null
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null
     or p_complaint_id is null
     or p_citizen_message is null
     or length(btrim(p_citizen_message)) < 5
     or p_resolution_photo_url is not null then
    return false;
  end if;

  return public.fn_officer_set_status(
    p_complaint_id,
    'citizen_confirmation',
    btrim(p_citizen_message)
  );
end;
$fn$;
revoke all on function public.fn_officer_report_resolution(uuid, text, text) from public, anon;
grant execute on function public.fn_officer_report_resolution(uuid, text, text) to authenticated;

-- These legacy RPCs were invoker functions, but complaint SELECT/UPDATE is
-- intentionally restricted by RLS. Run their narrowly checked mutations as
-- the database owner, and retain the authenticated-owner and matching
-- tracking-number-plus-phone paths. Staff can report a fix but cannot confirm
-- or reopen it on the citizen's behalf.
create or replace function public.confirm_complaint(
  p_tracking_no text,
  p_phone text default null
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
begin
  if p_tracking_no is null or length(btrim(p_tracking_no)) = 0 then
    return false;
  end if;

  select * into c
  from public.complaints
  where tracking_no = upper(btrim(p_tracking_no))
  for update;
  if not found or c.status not in ('citizen_confirmation', 'resolved') then
    return false;
  end if;

  if p_phone is not null and not c.is_anonymous and c.citizen_phone is not null
     and regexp_replace(c.citizen_phone, '[^0-9+]', '', 'g')
       = regexp_replace(p_phone, '[^0-9+]', '', 'g') then
    v_allowed := true;
  end if;
  if not v_allowed and auth.uid() is not null and c.citizen_id = auth.uid() then
    v_allowed := true;
  end if;
  if not v_allowed then
    return false;
  end if;

  update public.complaints
  set status = 'closed', closed_at = now()
  where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'citizen', 'confirmation', c.status, 'closed',
    'Resolution confirmed by citizen. Thank you.', true
  );
  return true;
end;
$fn$;

create or replace function public.reopen_complaint(
  p_tracking_no text,
  p_reason text,
  p_phone text default null
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'reopen_reason_required_min_5_chars';
  end if;
  if p_tracking_no is null or length(btrim(p_tracking_no)) = 0 then
    return false;
  end if;

  select * into c
  from public.complaints
  where tracking_no = upper(btrim(p_tracking_no))
  for update;
  if not found or c.status not in ('citizen_confirmation', 'resolved', 'closed') then
    return false;
  end if;

  if p_phone is not null and not c.is_anonymous and c.citizen_phone is not null
     and regexp_replace(c.citizen_phone, '[^0-9+]', '', 'g')
       = regexp_replace(p_phone, '[^0-9+]', '', 'g') then
    v_allowed := true;
  end if;
  if not v_allowed and auth.uid() is not null and c.citizen_id = auth.uid() then
    v_allowed := true;
  end if;
  if not v_allowed then
    return false;
  end if;

  update public.complaints
  set status = 'reopened',
      closed_at = null,
      resolved_at = null,
      reopened_count = coalesce(c.reopened_count, 0) + 1,
      expected_response_at = public.fn_calculate_deadline(c.category_id, c.urgency)
  where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'citizen', 'reopened', c.status, 'reopened',
    'Reopened by citizen: ' || btrim(p_reason), true
  );
  return true;
end;
$fn$;

-- The app uses this answer only to decide whether to render citizen actions;
-- the mutation RPCs above still repeat all authorization checks.
create or replace function public.fn_can_confirm_report(
  p_tracking_no text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null and exists (
    select 1
    from public.complaints c
    where c.tracking_no = upper(btrim(p_tracking_no))
      and c.citizen_id = auth.uid()
      and c.status in ('citizen_confirmation', 'resolved')
  );
$fn$;

revoke all on function public.fn_officer_accept(uuid) from public, anon;
grant execute on function public.fn_officer_accept(uuid) to authenticated, service_role;
revoke all on function public.fn_officer_set_status(uuid, text, text) from public, anon;
grant execute on function public.fn_officer_set_status(uuid, text, text) to authenticated, service_role;
revoke all on function public.confirm_complaint(text, text) from public;
grant execute on function public.confirm_complaint(text, text) to anon, authenticated, service_role;
revoke all on function public.reopen_complaint(text, text, text) from public;
grant execute on function public.reopen_complaint(text, text, text) to anon, authenticated, service_role;
revoke all on function public.fn_can_confirm_report(text) from public, anon;
grant execute on function public.fn_can_confirm_report(text) to authenticated;

commit;
