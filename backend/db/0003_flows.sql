-- 0003_flows.sql — grouping, notification queue, citizen submit/confirm/reopen RPCs
create or replace function public.fn_group_complaint(
  p_complaint_id uuid
) returns uuid
language plpgsql volatile
as $$
declare
  c       public.complaints%rowtype;
  v_group uuid;
begin
  select * into c from public.complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint % not found', p_complaint_id;
  end if;

  if c.lat is null or c.lng is null then
    return null;
  end if;

  select g.id into v_group
  from public.complaint_groups g
  join public.complaints c2 on c2.group_id = g.id
  where g.closed_at is null
    and c2.category_id is not distinct from c.category_id
    and c2.id <> c.id
    and c2.lat is not null
    and c2.created_at > now() - interval '72 hours'
    and (
      6371000 * acos(least(1::double precision, greatest(-1::double precision,
        cos(radians(c.lat::float8)) * cos(radians(c2.lat::float8)) *
        cos(radians(c2.lng::float8) - radians(c.lng::float8)) +
        sin(radians(c.lat::float8)) * sin(radians(c2.lat::float8))
      )))
    ) < 500
  order by c2.created_at desc
  limit 1;

  if v_group is not null then
    update public.complaints set group_id = v_group where id = c.id;
    return v_group;
  end if;

  insert into public.complaint_groups (category_id, area)
  values (c.category_id, coalesce(c.ward, c.council_area, 'unknown'))
  returning id into v_group;

  update public.complaints set group_id = v_group where id = c.id;
  return v_group;
end $$;

create or replace function public.fn_group_lifecycle()
returns trigger
language plpgsql
as $$
declare
  v_group uuid;
begin
  if TG_OP = 'DELETE' then
    v_group := old.group_id;
  else
    v_group := coalesce(new.group_id, old.group_id);
  end if;
  if v_group is null then
    return coalesce(new, old);
  end if;

  if TG_OP = 'UPDATE' and new.status in ('closed','rejected') then
    if not exists (
      select 1 from public.complaints
      where group_id = v_group
        and id <> new.id
        and status not in ('closed','rejected')
    ) then
      update public.complaint_groups set closed_at = now() where id = v_group and closed_at is null;
    end if;
  elsif TG_OP = 'UPDATE' and new.status not in ('closed','rejected') then
    update public.complaint_groups set closed_at = null
    where id = v_group and closed_at is not null;
  end if;

  return coalesce(new, old);
end $$;

create trigger trg_group_lifecycle
  after insert or update or delete on public.complaints
  for each row execute function public.fn_group_lifecycle();

-- notifications is a queue: n8n sends pending rows via GOWA (whatsapp) / Termii (sms), then marks sent/failed
create or replace function public.fn_notify(
  p_complaint_id uuid,
  p_channel public.notif_channel,
  p_recipient text,
  p_message text
) returns uuid
language plpgsql volatile
as $$
declare
  v_id uuid;
begin
  if p_recipient is null or length(btrim(p_recipient)) = 0 then
    return null;
  end if;
  insert into public.notifications (complaint_id, channel, recipient, message)
  values (p_complaint_id, p_channel, p_recipient, p_message)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_notify_citizen(
  p_complaint_id uuid,
  p_message text,
  p_channel public.notif_channel default 'whatsapp'
) returns uuid
language plpgsql volatile
as $$
declare
  c public.complaints%rowtype;
  v_id uuid;
begin
  select * into c from public.complaints where id = p_complaint_id;
  if not found or c.is_anonymous or c.citizen_phone is null then
    return null;
  end if;
  select public.fn_notify(p_complaint_id, p_channel, c.citizen_phone, p_message)
  into v_id;
  return v_id;
end $$;

create or replace function public.fn_notify_group(
  p_group_id uuid,
  p_message text
) returns int
language plpgsql volatile
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, citizen_phone, is_anonymous, channel
    from public.complaints
    where group_id = p_group_id
      and not is_anonymous
      and citizen_phone is not null
  loop
    perform public.fn_notify(r.id, 'whatsapp', r.citizen_phone, p_message);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- intake RPC (POST /reports): insert → routing → grouping → audit row → notify in one transaction
create or replace function public.submit_complaint(
  p_title         text,
  p_description   text,
  p_category_id   uuid,
  p_ai_confidence numeric default null,
  p_urgency       public.urgency_level default 'normal',
  p_lat           numeric default null,
  p_lng           numeric default null,
  p_region        text default null,
  p_council_area  text default null,
  p_ward          text default null,
  p_photo_url     text default null,
  p_channel       public.report_channel default 'web',
  p_citizen_name  text default null,
  p_citizen_phone text default null,
  p_is_anonymous  boolean default false
) returns public.complaints
language plpgsql volatile
as $$
declare
  v_id   uuid;
  v_row  public.complaints%rowtype;
  v_route jsonb;
  v_gid  uuid;
begin
  if p_title is null or length(btrim(p_title)) < 3 then
    raise exception 'title_required_min_3_chars';
  end if;
  if p_description is null or length(btrim(p_description)) < 10 then
    raise exception 'description_required_min_10_chars';
  end if;
  if p_category_id is null then
    raise exception 'category_required';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'unknown_category';
  end if;

  if p_is_anonymous then
    p_citizen_name := null;
    p_citizen_phone := null;
  end if;

  insert into public.complaints (
    title, description, category_id, urgency, status,
    ai_confidence, lat, lng, region, council_area, ward, photo_url,
    channel, citizen_name, citizen_phone, is_anonymous
  ) values (
    p_title, p_description, p_category_id, p_urgency, 'submitted',
    p_ai_confidence, p_lat, p_lng, p_region, p_council_area, p_ward, p_photo_url,
    p_channel, p_citizen_name, p_citizen_phone, p_is_anonymous
  ) returning id into v_id;

  v_route := public.fn_route_complaint(v_id);
  select * into v_row from public.complaints where id = v_id;

  v_gid := public.fn_group_complaint(v_id);

  insert into public.complaint_updates (
    complaint_id, actor_label, update_type, status_from, status_to,
    explanation, citizen_message, is_citizen_visible
  ) values (
    v_id, 'system', 'system', null, v_row.status::text::public.complaint_status,
    'Intake via ' || p_channel::text || '; routed: ' || coalesce(v_route->>'decision','?'),
    'Complaint received. Reference ' || v_row.tracking_no || '. ' ||
      coalesce((select name from public.institutions where id = v_row.institution_id), 'Central Desk') ||
      ' is responsible. We will update you here.',
    true
  );

  perform public.fn_notify_citizen(
    v_id,
    'Received, reference ' || v_row.tracking_no || '. ' ||
      coalesce((select name from public.institutions where id = v_row.institution_id), 'Central Desk') ||
      ' is responsible. We will update you here.'
  );

  return v_row;
end $$;

-- citizen confirms resolution; allowed: phone match (tokenless), authenticated owner, owning-institution officer, admin
create or replace function public.confirm_complaint(
  p_tracking_no text,
  p_phone text default null
) returns boolean
language plpgsql volatile
as $$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
begin
  select * into c from public.complaints
  where tracking_no = upper(btrim(p_tracking_no));
  if not found then
    return false;
  end if;

  if c.status not in ('citizen_confirmation','resolved') then
    return false;
  end if;

  if p_phone is not null and not c.is_anonymous
     and c.citizen_phone is not null
     and regexp_replace(c.citizen_phone, '[^0-9+]', '', 'g')
       = regexp_replace(p_phone, '[^0-9+]', '', 'g') then
    v_allowed := true;
  end if;

  if not v_allowed and auth.uid() is not null and c.citizen_id = auth.uid() then
    v_allowed := true;
  end if;

  if not v_allowed and public.fn_is_admin() then
    v_allowed := true;
  end if;

  if not v_allowed and public.fn_is_officer_of(c.id) then
    v_allowed := true;
  end if;

  if not v_allowed then
    return false;
  end if;

  update public.complaints
     set status = 'closed', closed_at = now()
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_label, update_type, status_from, status_to,
    citizen_message, is_citizen_visible
  ) values (
    c.id, 'citizen', 'confirmation', c.status, 'closed',
    'Resolution confirmed by citizen. Thank you.', true
  );

  return true;
end $$;

-- citizen rejects the fix; same authorization as confirm; re-enters officer queue and reopens the group
create or replace function public.reopen_complaint(
  p_tracking_no text,
  p_reason text,
  p_phone text default null
) returns boolean
language plpgsql volatile
as $$
declare
  c public.complaints%rowtype;
  v_allowed boolean := false;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'reopen_reason_required_min_5_chars';
  end if;

  select * into c from public.complaints
  where tracking_no = upper(btrim(p_tracking_no));
  if not found then
    return false;
  end if;

  if c.status not in ('citizen_confirmation','resolved','closed') then
    return false;
  end if;

  if p_phone is not null and not c.is_anonymous
     and c.citizen_phone is not null
     and regexp_replace(c.citizen_phone, '[^0-9+]', '', 'g')
       = regexp_replace(p_phone, '[^0-9+]', '', 'g') then
    v_allowed := true;
  end if;
  if not v_allowed and auth.uid() is not null and c.citizen_id = auth.uid() then
    v_allowed := true;
  end if;
  if not v_allowed and public.fn_is_admin() then
    v_allowed := true;
  end if;
  if not v_allowed and public.fn_is_officer_of(c.id) then
    v_allowed := true;
  end if;

  if not v_allowed then
    return false;
  end if;

  update public.complaints
     set status = 'reopened',
         closed_at = null,
         resolved_at = null,
         reopened_count = reopened_count + 1,
         expected_response_at = public.fn_calculate_deadline(c.category_id, c.urgency)
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_label, update_type, status_from, status_to,
    citizen_message, is_citizen_visible
  ) values (
    c.id, 'citizen', 'reopened', c.status, 'reopened',
    'Reopened by citizen: ' || btrim(p_reason), true
  );

  return true;
end $$;
