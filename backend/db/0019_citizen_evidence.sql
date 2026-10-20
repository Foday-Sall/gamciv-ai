-- 0019_citizen_evidence.sql
-- Bind signed-in web reports to their submitter, attach private evidence
-- paths through a server-side ownership check, and persist admin-managed logos.

create or replace function public.fn_bind_web_citizen_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
begin
  if new.channel = 'web'::public.report_channel then
    -- Never trust a client-supplied owner for a web report. Anonymous and
    -- unauthenticated reports remain unlinked; signed-in citizens own theirs.
    new.citizen_id := null;
    if not new.is_anonymous
       and v_user_id is not null
       and exists (
         select 1
         from public.profiles p
         where p.user_id = v_user_id
           and p.role = 'citizen'::public.user_role
       ) then
      new.citizen_id := v_user_id;
    end if;
  end if;
  return new;
end;
$fn$;

revoke all on function public.fn_bind_web_citizen_owner() from public, anon, authenticated;
drop trigger if exists trg_bind_web_citizen_owner on public.complaints;
create trigger trg_bind_web_citizen_owner
  before insert on public.complaints
  for each row execute function public.fn_bind_web_citizen_owner();

-- The existing private complaint-photos bucket and its institution-scoped
-- Storage RLS policies are created in 0008_ops.sql. Match the reporter UI's
-- 10 MB limit and accepted image types at the storage boundary too.
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'complaint-photos';

create or replace function public.attach_photo(
  p_complaint_id uuid,
  p_path text
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null
     or p_complaint_id is null
     or p_path is null
     or length(p_path) > 256
     or p_path !~ ('^' || p_complaint_id::text || '/[A-Za-z0-9._-]{1,200}$') then
    return false;
  end if;

  if not exists (
    select 1
    from public.complaints c
    where c.id = p_complaint_id
      and c.citizen_id = auth.uid()
      and c.channel = 'web'::public.report_channel
      and c.is_anonymous = false
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'complaint-photos'
      and o.name = p_path
  ) then
    return false;
  end if;

  update public.complaints c
  set photo_url = p_path
  where c.id = p_complaint_id
    and c.citizen_id = auth.uid()
    and c.channel = 'web'::public.report_channel
    and c.is_anonymous = false;

  return found;
end;
$fn$;

revoke all on function public.attach_photo(uuid, text) from public, anon;
grant execute on function public.attach_photo(uuid, text) to authenticated;

-- Logo metadata is public-facing, but only the server-verified GamCiv admin
-- can change it under the existing institutions RLS policy.
grant update (logo_url) on public.institutions to authenticated;

-- Include only the verified institution's persisted logo in the access result.
create or replace function public.fn_dashboard_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_institution_id uuid;
  v_institution public.institutions%rowtype;
  v_role text;
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'role', null);
  end if;

  if public.fn_is_admin() then
    return jsonb_build_object('ok', true, 'role', 'admin');
  end if;

  v_institution_id := public.fn_my_institution();
  if v_institution_id is not null then
    select * into v_institution
    from public.institutions i
    where i.id = v_institution_id;
    return jsonb_build_object(
      'ok', true,
      'role', 'officer',
      'institution', jsonb_build_object(
        'id', v_institution.id,
        'code', v_institution.code,
        'name', v_institution.name,
        'logo_url', v_institution.logo_url
      )
    );
  end if;

  select p.role::text into v_role
  from public.profiles p
  where p.user_id = auth.uid()
    and lower(btrim(coalesce(p.email, ''))) = v_email;

  if v_role = 'citizen' then
    return jsonb_build_object('ok', true, 'role', 'citizen');
  end if;
  return jsonb_build_object('ok', false, 'role', null);
end;
$fn$;
revoke all on function public.fn_dashboard_access() from public, anon;
grant execute on function public.fn_dashboard_access() to authenticated;

-- Keep photo paths private. The scoped RPC returns paths only after verifying
-- this officer belongs to the report's institution; Storage signs each preview.
create or replace function public.fn_officer_complaint_detail(p_complaint_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_complaint public.complaints%rowtype;
  v_institution_id uuid := public.fn_my_institution();
  v_is_admin boolean := public.fn_is_admin();
  v_category text;
  v_contact jsonb := null;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select c.* into v_complaint
  from public.complaints c
  where c.id = p_complaint_id
    and (v_is_admin or (v_institution_id is not null and c.institution_id = v_institution_id));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select cat.name into v_category
  from public.categories cat
  where cat.id = v_complaint.category_id;

  if not v_complaint.is_anonymous then
    select jsonb_build_object(
      'name', nullif(btrim(coalesce(v_complaint.citizen_name, p.full_name, '')), ''),
      'phone', nullif(btrim(coalesce(v_complaint.citizen_phone, p.phone, '')), ''),
      'email', nullif(btrim(coalesce(p.email, '')), '')
    ) into v_contact
    from public.profiles p
    where p.user_id = v_complaint.citizen_id;

    if v_contact is null then
      v_contact := jsonb_build_object(
        'name', nullif(btrim(coalesce(v_complaint.citizen_name, '')), ''),
        'phone', nullif(btrim(coalesce(v_complaint.citizen_phone, '')), ''),
        'email', null
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'complaint', jsonb_build_object(
      'id', v_complaint.id,
      'tracking_no', v_complaint.tracking_no,
      'title', v_complaint.title,
      'description', v_complaint.description,
      'status', v_complaint.status,
      'urgency', v_complaint.urgency,
      'category', v_category,
      'lat', v_complaint.lat,
      'lng', v_complaint.lng,
      'region', v_complaint.region,
      'council_area', v_complaint.council_area,
      'ward', v_complaint.ward,
      'created_at', v_complaint.created_at,
      'updated_at', v_complaint.updated_at,
      'is_anonymous', v_complaint.is_anonymous,
      'photo_url', v_complaint.photo_url,
      'resolution_photo_url', v_complaint.resolution_photo_url,
      'resolution_note', v_complaint.resolution_note,
      'contact', v_contact
    )
  );
end;
$fn$;
revoke all on function public.fn_officer_complaint_detail(uuid) from public, anon;
grant execute on function public.fn_officer_complaint_detail(uuid) to authenticated;

-- Reuse the established status transition so notifications, citizen-visible
-- history, and permission checks remain identical to the existing workflow.
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
declare
  v_updated boolean;
begin
  if auth.uid() is null
     or p_complaint_id is null
     or p_citizen_message is null
     or length(btrim(p_citizen_message)) < 5 then
    return false;
  end if;

  if p_resolution_photo_url is not null then
    if length(p_resolution_photo_url) > 256
       or p_resolution_photo_url !~ ('^' || p_complaint_id::text || '/resolution-[A-Za-z0-9._-]{1,200}$')
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'complaint-photos'
           and o.name = p_resolution_photo_url
       ) then
      return false;
    end if;
  end if;

  v_updated := public.fn_officer_set_status(
    p_complaint_id,
    'citizen_confirmation',
    btrim(p_citizen_message)
  );
  if not v_updated then
    return false;
  end if;

  if p_resolution_photo_url is not null then
    update public.complaints c
    set resolution_photo_url = p_resolution_photo_url
    where c.id = p_complaint_id
      and public.fn_is_officer_of(c.id);
  end if;
  return true;
end;
$fn$;
revoke all on function public.fn_officer_report_resolution(uuid, text, text) from public, anon;
grant execute on function public.fn_officer_report_resolution(uuid, text, text) to authenticated;
