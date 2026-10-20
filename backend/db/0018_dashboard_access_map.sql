-- 0018_dashboard_access_map.sql
-- Exact account role mapping, active institution scope, complaint map and
-- detail access, and dashboard data boundaries.

-- Existing intake stores coordinates as latitude/longitude. Keep that contract
-- and derive a PostGIS point so map viewport queries can use a spatial index.
create extension if not exists postgis with schema extensions;
alter table public.complaints
  add column if not exists geo_location extensions.geography(Point,4326)
  generated always as (
    case when lat is not null and lng is not null then
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(lng::double precision, lat::double precision),
        4326
      )::extensions.geography
    else null end
  ) stored;
create index if not exists idx_complaints_geo_location_gist
  on public.complaints using gist (geo_location);

-- Resolve the five named institution accounts to their single institution.
create or replace function public.fn_staff_institution_code(p_email text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case lower(btrim(coalesce(p_email, '')))
    when 'nawec@pocketsoftware.dev' then 'NAWEC'
    when 'kmc@pocketsoftware.dev' then 'KMC'
    when 'nra@pocketsoftware.dev' then 'NRA'
    when 'nea@pocketsoftware.dev' then 'NEA'
    when 'police@pocketsoftware.dev' then 'POLICE'
    else null
  end;
$fn$;
revoke all on function public.fn_staff_institution_code(text) from public, anon, authenticated;
grant execute on function public.fn_staff_institution_code(text) to postgres, service_role;

-- The owner account is the sole administrator, and must also have an admin
-- profile. The verified JWT email prevents a second admin-role profile from
-- gaining administrator access.
create or replace function public.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    auth.uid() is not null
    and lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'admin@pocketsoftware.dev'
    and exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and lower(btrim(coalesce(p.email, ''))) = 'admin@pocketsoftware.dev'
    ),
    false
  );
$fn$;

-- A staff session is active only when the JWT, profile, officer row, active
-- flag, and mapped institution all agree.
create or replace function public.fn_my_institution()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select i.id
  from public.officers o
  join public.institutions i on i.id = o.institution_id
  join public.profiles p on p.user_id = o.user_id
  where o.user_id = auth.uid()
    and o.is_active is true
    and p.role = 'officer'
    and lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = lower(btrim(coalesce(p.email, '')))
    and lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = lower(btrim(coalesce(o.email, '')))
    and public.fn_staff_institution_code(auth.jwt() ->> 'email') = i.code
  limit 1;
$fn$;

create or replace function public.fn_is_officer_of(p_complaint_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_institution_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.fn_is_admin() then
    return exists (select 1 from public.complaints c where c.id = p_complaint_id);
  end if;
  v_institution_id := public.fn_my_institution();
  return v_institution_id is not null and exists (
    select 1
    from public.complaints c
    where c.id = p_complaint_id
      and c.institution_id = v_institution_id
  );
end;
$fn$;

-- This single server-verified role/scope result drives both login routing and
-- dashboard guards. Client-supplied user IDs or institution IDs are not used.
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
        'name', v_institution.name
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

-- Account synchronization may update protected columns only while its private
-- transaction-local marker is active. Otherwise retain the owner-only guard.
create or replace function public.fn_guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if current_setting('gamciv.account_sync', true) = 'on' then
    return new;
  end if;

  if new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.phone is distinct from old.phone
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified
  then
    if not public.fn_is_admin() then
      raise exception 'profiles: only the owner account may change email, role, phone or verification flags'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

-- Keep account role mapping in the trusted auth-user lifecycle. The helper is
-- not callable by end users; only the auth trigger and migration use it.
create or replace function public.fn_sync_account_access(
  p_user_id uuid,
  p_email text,
  p_user_metadata jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text;
  v_role public.user_role := 'citizen';
  v_institution_id uuid;
  v_institution_name text;
  v_display_name text;
  v_officer_id uuid;
begin
  if p_user_id is null or v_email = '' then
    return;
  end if;

  v_code := public.fn_staff_institution_code(v_email);
  if v_email = 'admin@pocketsoftware.dev' then
    v_role := 'admin';
  elsif v_code is not null then
    v_role := 'officer';
    select i.id, i.name into v_institution_id, v_institution_name
    from public.institutions i
    where i.code = v_code;
    if v_institution_id is null then
      raise exception 'Required GamCiv institution is missing: %', v_code;
    end if;
  end if;

  v_display_name := nullif(btrim(coalesce(
    p_user_metadata ->> 'full_name',
    p_user_metadata ->> 'name',
    ''
  )), '');
  if v_display_name is null then
    v_display_name := coalesce(v_institution_name || ' staff', split_part(v_email, '@', 1));
  end if;

  perform pg_catalog.set_config('gamciv.account_sync', 'on', true);
  insert into public.profiles (user_id, email, role, full_name)
  values (p_user_id, v_email, v_role, v_display_name)
  on conflict (user_id) do update
    set email = excluded.email,
        role = excluded.role,
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

  -- Email changes revoke any stale staff membership before applying the new
  -- allowlisted mapping.
  update public.officers o
  set user_id = null
  where o.user_id = p_user_id
    and lower(btrim(coalesce(o.email, ''))) <> v_email;

  if v_role = 'officer' then
    select o.id into v_officer_id
    from public.officers o
    where lower(btrim(coalesce(o.email, ''))) = v_email
    order by o.created_at
    limit 1
    for update;

    if v_officer_id is null then
      insert into public.officers (institution_id, name, email, user_id)
      values (v_institution_id, v_display_name, v_email, p_user_id);
    else
      update public.officers o
      set institution_id = v_institution_id,
          user_id = p_user_id,
          name = coalesce(nullif(btrim(o.name), ''), v_display_name)
      where o.id = v_officer_id;
    end if;
  end if;
end;
$fn$;
revoke all on function public.fn_sync_account_access(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_sync_account_access(uuid, text, jsonb) to postgres, service_role;

create or replace function public.fn_auth_user_account_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.fn_sync_account_access(new.id, new.email, new.raw_user_meta_data);
  return new;
end;
$fn$;
revoke all on function public.fn_auth_user_account_access() from public, anon, authenticated;

drop trigger if exists trg_zz_gamciv_account_access_insert on auth.users;
create trigger trg_zz_gamciv_account_access_insert
  after insert on auth.users
  for each row execute function public.fn_auth_user_account_access();

drop trigger if exists trg_zz_gamciv_account_access_email_update on auth.users;
create trigger trg_zz_gamciv_account_access_email_update
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.fn_auth_user_account_access();

-- Align existing accounts with the same exact mapping, then remove all other
-- admin-role profiles. The account-sync setting is transaction-local and only
-- the trusted migration/trigger helper sets it.
do $backfill$
declare
  v_user record;
begin
  for v_user in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where lower(btrim(coalesce(u.email, ''))) = 'admin@pocketsoftware.dev'
       or public.fn_staff_institution_code(u.email) is not null
  loop
    perform public.fn_sync_account_access(v_user.id, v_user.email, v_user.raw_user_meta_data);
  end loop;

  perform pg_catalog.set_config('gamciv.account_sync', 'on', true);
  update public.profiles p
  set role = 'citizen'
  where p.role = 'admin'
    and lower(btrim(coalesce(p.email, ''))) <> 'admin@pocketsoftware.dev';
end;
$backfill$;

-- Users cannot self-insert an admin/officer profile or claim another email.
drop policy if exists prof_insert_self on public.profiles;
drop policy if exists "prof_insert_self" on public.profiles;
create policy prof_insert_self on public.profiles
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'citizen'
    and lower(btrim(coalesce(email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- Hide other staff directory rows and prevent self-editing institution
-- membership. Staff account mappings are maintained by the trusted auth hook.
drop policy if exists officers_select_authenticated on public.officers;
create policy officers_select_authenticated on public.officers
  for select to authenticated
  using (public.fn_is_admin() or user_id = auth.uid());
drop policy if exists officers_self_update on public.officers;
revoke insert, update, delete on public.officers from public, anon, authenticated;

-- All complaint, update, and notification policies derive staff scope from
-- the active exact-email account mapping, never from a client-supplied ID.
drop policy if exists comp_select_officer_own_inst on public.complaints;
create policy comp_select_officer_own_inst on public.complaints
  for select to authenticated
  using (institution_id = public.fn_my_institution());

drop policy if exists comp_update_officer on public.complaints;
create policy comp_update_officer on public.complaints
  for update to authenticated
  using (public.fn_is_admin() or institution_id = public.fn_my_institution())
  with check (public.fn_is_admin() or institution_id = public.fn_my_institution());

drop policy if exists upd_select_staff on public.complaint_updates;
create policy upd_select_staff on public.complaint_updates
  for select to authenticated
  using (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      where c.id = complaint_updates.complaint_id
        and c.institution_id = public.fn_my_institution()
    )
  );

drop policy if exists upd_insert_staff on public.complaint_updates;
create policy upd_insert_staff on public.complaint_updates
  for insert to authenticated
  with check (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      where c.id = complaint_updates.complaint_id
        and c.institution_id = public.fn_my_institution()
    )
  );

drop policy if exists notif_select_staff on public.notifications;
create policy notif_select_staff on public.notifications
  for select to authenticated
  using (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      where c.id = notifications.complaint_id
        and c.institution_id = public.fn_my_institution()
    )
  );

-- Staff complaint lists may read operational fields, but contact columns are
-- returned only by the authorized detail RPC below.
revoke select on public.complaints from public, anon, authenticated;
grant select (
  id, tracking_no, title, description, category_id, urgency, status,
  ai_confidence, lat, lng, region, council_area, ward, photo_url, channel,
  is_anonymous, institution_id, department_id, officer_id, group_id,
  expected_response_at, resolved_at, closed_at, resolution_note,
  resolution_photo_url, reopened_count, created_at, updated_at
) on public.complaints to authenticated;

drop function if exists public.fn_institution_map_complaints(integer);
create function public.fn_institution_map_complaints(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_limit integer default 1200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_institution_id uuid := public.fn_my_institution();
  v_is_admin boolean := public.fn_is_admin();
  v_bounds extensions.geography;
  v_limit integer := least(greatest(coalesce(p_limit, 1200), 1), 2000);
  v_rows jsonb;
  v_count bigint;
begin
  if auth.uid() is null or (v_institution_id is null and not v_is_admin) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_west is null or p_south is null or p_east is null or p_north is null
     or p_west < -180 or p_east > 180 or p_west >= p_east
     or p_south < -90 or p_north > 90 or p_south >= p_north then
    return jsonb_build_object('ok', false, 'error', 'invalid_bounds');
  end if;

  v_bounds := extensions.ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography;

  select count(*) into v_count
  from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where (v_is_admin or c.institution_id = v_institution_id)
    and c.geo_location is not null
    and cat.is_sensitive is false
    and extensions.ST_Intersects(c.geo_location, v_bounds);

  select coalesce(jsonb_agg(q.item order by q.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      c.created_at,
      jsonb_build_object(
        'id', c.id,
        'tracking_no', c.tracking_no,
        'title', c.title,
        'status', c.status,
        'urgency', c.urgency,
        'category', cat.name,
        'lat', extensions.ST_Y(c.geo_location::extensions.geometry),
        'lng', extensions.ST_X(c.geo_location::extensions.geometry),
        'region', c.region,
        'council_area', c.council_area,
        'ward', c.ward,
        'created_at', c.created_at
      ) as item
    from public.complaints c
    join public.categories cat on cat.id = c.category_id
    where (v_is_admin or c.institution_id = v_institution_id)
      and c.geo_location is not null
      and cat.is_sensitive is false
      and extensions.ST_Intersects(c.geo_location, v_bounds)
    order by c.created_at desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'ok', true,
    'institution_id', case when v_is_admin then null else v_institution_id end,
    'scope', case when v_is_admin then 'all' else 'institution' end,
    'total', v_count,
    'returned', jsonb_array_length(v_rows),
    'truncated', v_count > v_limit,
    'complaints', v_rows
  );
end;
$fn$;
revoke all on function public.fn_institution_map_complaints(double precision, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.fn_institution_map_complaints(double precision, double precision, double precision, double precision, integer) to authenticated;

-- Details and reporter contacts are fetched only after a staff member opens a
-- specific complaint. Anonymous reports intentionally return no identity.
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
      'contact', v_contact
    )
  );
end;
$fn$;
revoke all on function public.fn_officer_complaint_detail(uuid) from public, anon;
grant execute on function public.fn_officer_complaint_detail(uuid) to authenticated;
