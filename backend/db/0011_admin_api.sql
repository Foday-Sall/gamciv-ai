-- ============================================================================
-- 0011: Admin backend API
--   * new tables: admin_audit_log, admin_settings (RLS enabled)
--   * officers.is_active flag
--   * institutions access-control columns
--   * 15 admin RPCs (SECURITY DEFINER, fn_is_admin guard, audit logging)
--   * helpers private_admin_log / private_admin_denied (schema-qualified refs)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_email  text,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.admin_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.officers
  add column if not exists is_active boolean not null default true;

alter table public.institutions
  add column if not exists access_level text not null default 'restricted'
    constraint chk_inst_access_level
    check (access_level in ('full', 'restricted', 'view-only'));
alter table public.institutions
  add column if not exists allowed_categories text[] not null default '{}';
alter table public.institutions
  add column if not exists sla_hours int not null default 48;
alter table public.institutions
  add column if not exists max_complaints_per_day int not null default 100;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log  enable row level security;
alter table public.admin_settings   enable row level security;

-- Audit log: admins may read; inserts flow through the definer RPCs only.
drop policy if exists admin_audit_log_admin_select on public.admin_audit_log;
create policy admin_audit_log_admin_select
  on public.admin_audit_log
  for select
  to authenticated
  using (public.fn_is_admin());

drop policy if exists admin_audit_log_admin_insert on public.admin_audit_log;
create policy admin_audit_log_admin_insert
  on public.admin_audit_log
  for insert
  to authenticated
  with check (public.fn_is_admin());

-- No UPDATE/DELETE policies: the audit trail is append-only.

-- Settings: readable by any authenticated user, writable by admins only.
drop policy if exists admin_settings_read on public.admin_settings;
create policy admin_settings_read
  on public.admin_settings
  for select
  to authenticated
  using (true);

drop policy if exists admin_settings_admin_write on public.admin_settings;
create policy admin_settings_admin_write
  on public.admin_settings
  for all
  to authenticated
  using (public.fn_is_admin())
  with check (public.fn_is_admin());

revoke all on public.admin_audit_log from public, anon;
revoke all on public.admin_settings  from public, anon;

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to any caller; used by the RPCs below)
-- ---------------------------------------------------------------------------

-- Append an audit row, resolving the acting admin's email from auth.uid().
create function public.private_admin_log(
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_details     jsonb default '{}'::jsonb
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  insert into public.admin_audit_log
    (actor_email, action, target_type, target_id, details)
  values
    (
      (select u.email
         from public.profiles p
         join auth.users u on u.id = p.user_id
        where p.user_id = auth.uid()
        limit 1),
      p_action,
      p_target_type,
      p_target_id,
      coalesce(p_details, '{}'::jsonb)
    );
end;
$fn$;

-- Standard denial payload shared by every admin RPC.
create function public.private_admin_denied()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $fn$
  select jsonb_build_object('ok', false, 'error', 'not_authorized');
$fn$;

-- ---------------------------------------------------------------------------
-- 1. admin_get_overview_stats
-- ---------------------------------------------------------------------------
create function public.admin_get_overview_stats()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
declare
  v_result jsonb;
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  with base as (
    select
      c.id,
      c.created_at,
      coalesce(cat.name, 'uncategorized') as category,
      (
        select min(up.created_at)
        from public.complaint_updates up
        where up.complaint_id = c.id
          and up.actor_label <> 'system'
      ) as first_response_at
    from public.complaints c
    left join public.categories cat on cat.id = c.category_id
  )
  select jsonb_build_object(
    'total',
    (select count(*) from base),
    'open',
    (
      select count(*)
      from public.complaints
      where status not in ('closed', 'rejected')
    ),
    'escalated_today',
    (
      select count(*)
      from public.complaint_updates up
      where up.update_type = 'escalation'
        and up.created_at >= date_trunc('day', now())
    ),
    'avg_first_response_minutes',
    (
      select coalesce(
        round(avg(extract(epoch from (b.first_response_at - b.created_at)) / 60.0)::numeric, 1),
        0
      )
      from base b
      where b.first_response_at is not null
    ),
    'per_category',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('category', pc.category, 'count', pc.cnt))
        from (
          select category, count(*) as cnt
          from base
          group by category
        ) pc
      ),
      '[]'::jsonb
    ),
    'daily',
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'date', to_char(d.day, 'YYYY-MM-DD'),
                   'count', coalesce(o.cnt, 0)
                 )
                 order by d.day
               )
        from generate_series(
               date_trunc('day', now()) - interval '13 days',
               date_trunc('day', now()),
               interval '1 day'
             ) as d(day)
        left join (
          select date_trunc('day', created_at) as day, count(*) as cnt
          from base
          group by date_trunc('day', created_at)
        ) o on o.day = d.day
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. admin_list_institutions
-- ---------------------------------------------------------------------------
create function public.admin_list_institutions()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  return coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name,
                 'code', i.code,
                 'contact', i.contact,
                 'access_level', i.access_level,
                 'allowed_categories', i.allowed_categories,
                 'sla_hours', i.sla_hours,
                 'max_complaints_per_day', i.max_complaints_per_day,
                 'open_complaints', (
                   select count(*)
                   from public.complaints c
                   where c.institution_id = i.id
                     and c.status not in ('closed', 'rejected')
                 ),
                 'officer_count', (
                   select count(*)
                   from public.officers o
                   where o.institution_id = i.id
                 )
               )
               order by i.name
             )
      from public.institutions i
    ),
    '[]'::jsonb
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. admin_create_institution
-- ---------------------------------------------------------------------------
create function public.admin_create_institution(
  p_name         text,
  p_shortcode    text,
  p_contact_email text,
  p_phone        text,
  p_category_scope text[] default '{}'
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
declare
  v_row public.institutions%rowtype;
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if exists (
       select 1 from public.institutions where code = p_shortcode
     ) then
    return jsonb_build_object('ok', false, 'error', 'shortcode_taken');
  end if;

  insert into public.institutions
    (name, code, contact, allowed_categories)
  values
    (
      p_name,
      p_shortcode,
      jsonb_build_object('email', p_contact_email, 'phone', p_phone),
      coalesce(p_category_scope, '{}'::text[])
    )
  returning * into v_row;

  perform public.private_admin_log(
    'create_institution',
    'institution',
    v_row.id::text,
    jsonb_build_object('name', p_name, 'code', p_shortcode)
  );

  return to_jsonb(v_row);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. admin_list_officers
-- ---------------------------------------------------------------------------
create function public.admin_list_officers()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  return coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'institution_id', o.institution_id,
                 'institution_name', i.name,
                 'department_id', o.department_id,
                 'name', o.name,
                 'phone', o.phone,
                 'email', o.email,
                 'is_active', o.is_active,
                 'created_at', o.created_at
               )
               order by o.created_at desc
             )
      from public.officers o
      left join public.institutions i on i.id = o.institution_id
    ),
    '[]'::jsonb
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. admin_invite_officer
-- ---------------------------------------------------------------------------
create function public.admin_invite_officer(
  p_name          text,
  p_email         text,
  p_institution_id uuid,
  p_role          text default 'officer',
  p_department    text default null
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
declare
  v_dept_id uuid;
  v_row     public.officers%rowtype;
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if p_name is null or btrim(p_name) = ''
     or p_email is null or btrim(p_email) = ''
     or p_institution_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  if not exists (
       select 1 from public.institutions where id = p_institution_id
     ) then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  if p_department is not null and btrim(p_department) <> '' then
    select d.id into v_dept_id
    from public.departments d
    where d.institution_id = p_institution_id
      and upper(btrim(d.name)) = upper(btrim(p_department))
    limit 1;
  end if;

  insert into public.officers
    (institution_id, department_id, name, phone, email)
  values
    (p_institution_id, v_dept_id, p_name, p_department, p_email)
  returning * into v_row;

  perform public.private_admin_log(
    'invite_officer',
    'officer',
    v_row.id::text,
    jsonb_build_object(
      'name', p_name,
      'email', p_email,
      'institution_id', p_institution_id,
      'role', p_role,
      'department', p_department
    )
  );

  return to_jsonb(v_row);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'email_taken');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. admin_toggle_officer_active
-- ---------------------------------------------------------------------------
create function public.admin_toggle_officer_active(
  p_officer_id uuid,
  p_active     boolean
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
declare
  v_row public.officers%rowtype;
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  update public.officers
     set is_active = p_active
   where id = p_officer_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'officer_not_found');
  end if;

  perform public.private_admin_log(
    'toggle_officer_active',
    'officer',
    p_officer_id::text,
    jsonb_build_object('is_active', p_active)
  );

  return to_jsonb(v_row);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. admin_get_access_limits
-- ---------------------------------------------------------------------------
create function public.admin_get_access_limits(
  p_institution_id uuid
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
declare
  v_row public.institutions%rowtype;
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  select * into v_row
  from public.institutions
  where id = p_institution_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'access_level', v_row.access_level,
    'allowed_categories', v_row.allowed_categories,
    'sla_hours', v_row.sla_hours,
    'max_complaints_per_day', v_row.max_complaints_per_day
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. admin_set_access_level
-- ---------------------------------------------------------------------------
create function public.admin_set_access_level(
  p_institution_id uuid,
  p_level          text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if p_level not in ('full', 'restricted', 'view-only') then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_level');
  end if;

  update public.institutions
     set access_level = p_level
   where id = p_institution_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  perform public.private_admin_log(
    'set_access_level',
    'institution',
    p_institution_id::text,
    jsonb_build_object('access_level', p_level)
  );

  return jsonb_build_object('ok', true, 'access_level', p_level);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. admin_set_allowed_categories
-- ---------------------------------------------------------------------------
create function public.admin_set_allowed_categories(
  p_institution_id uuid,
  p_categories     text[]
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  update public.institutions
     set allowed_categories = coalesce(p_categories, '{}'::text[])
   where id = p_institution_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  perform public.private_admin_log(
    'set_allowed_categories',
    'institution',
    p_institution_id::text,
    jsonb_build_object('allowed_categories', to_jsonb(coalesce(p_categories, '{}'::text[])))
  );

  return jsonb_build_object(
    'ok', true,
    'allowed_categories', to_jsonb(coalesce(p_categories, '{}'::text[]))
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. admin_set_sla_hours
-- ---------------------------------------------------------------------------
create function public.admin_set_sla_hours(
  p_institution_id uuid,
  p_hours          int
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if p_hours is null or p_hours < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_sla_hours');
  end if;

  update public.institutions
     set sla_hours = p_hours
   where id = p_institution_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  perform public.private_admin_log(
    'set_sla_hours',
    'institution',
    p_institution_id::text,
    jsonb_build_object('sla_hours', p_hours)
  );

  return jsonb_build_object('ok', true, 'sla_hours', p_hours);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 11. admin_set_rate_limit
-- ---------------------------------------------------------------------------
create function public.admin_set_rate_limit(
  p_institution_id uuid,
  p_max            int
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if p_max is null or p_max < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_rate_limit');
  end if;

  update public.institutions
     set max_complaints_per_day = p_max
   where id = p_institution_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;

  perform public.private_admin_log(
    'set_rate_limit',
    'institution',
    p_institution_id::text,
    jsonb_build_object('max_complaints_per_day', p_max)
  );

  return jsonb_build_object('ok', true, 'max_complaints_per_day', p_max);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 12. admin_get_audit_log
-- ---------------------------------------------------------------------------
create function public.admin_get_audit_log(
  p_limit int default 100
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (
        select *
        from public.admin_audit_log
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) a
    ),
    '[]'::jsonb
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 13. admin_get_settings
-- ---------------------------------------------------------------------------
create function public.admin_get_settings()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  return coalesce(
    (
      select jsonb_object_agg(s.key, s.value)
      from public.admin_settings s
    ),
    '{}'::jsonb
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 14. admin_save_settings
-- ---------------------------------------------------------------------------
create function public.admin_save_settings(
  p_settings jsonb
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_settings');
  end if;

  insert into public.admin_settings (key, value, updated_at)
  select k.key, k.value, now()
  from jsonb_each(p_settings) as k(key, value)
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = now();

  perform public.private_admin_log(
    'save_settings',
    'settings',
    null,
    jsonb_build_object(
      'keys',
      (select coalesce(jsonb_agg(k.key), '[]'::jsonb) from jsonb_each(p_settings) k)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'saved',
    (select coalesce(jsonb_agg(k.key), '[]'::jsonb) from jsonb_each(p_settings) k)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 15. admin_audit (generic audit writer for panel flows beyond the RPCs
--     above; counted last so the file exposes 15 RPCs in total).
-- ---------------------------------------------------------------------------
create function public.admin_audit(
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_details     jsonb default '{}'::jsonb
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  if not public.fn_is_admin() then
    return public.private_admin_denied();
  end if;

  perform public.private_admin_log(
    p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb)
  );

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: admin RPCs are callable by authenticated users only; each function
-- re-verifies admin status internally via fn_is_admin().
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_get_overview_stats() from public, anon;
revoke execute on function public.admin_list_institutions() from public, anon;
revoke execute on function public.admin_create_institution(text, text, text, text, text[]) from public, anon;
revoke execute on function public.admin_list_officers() from public, anon;
revoke execute on function public.admin_invite_officer(text, text, uuid, text, text) from public, anon;
revoke execute on function public.admin_toggle_officer_active(uuid, boolean) from public, anon;
revoke execute on function public.admin_get_access_limits(uuid) from public, anon;
revoke execute on function public.admin_set_access_level(uuid, text) from public, anon;
revoke execute on function public.admin_set_allowed_categories(uuid, text[]) from public, anon;
revoke execute on function public.admin_set_sla_hours(uuid, int) from public, anon;
revoke execute on function public.admin_set_rate_limit(uuid, int) from public, anon;
revoke execute on function public.admin_get_audit_log(int) from public, anon;
revoke execute on function public.admin_get_settings() from public, anon;
revoke execute on function public.admin_save_settings(jsonb) from public, anon;
revoke execute on function public.admin_audit(text, text, text, jsonb) from public, anon;
revoke execute on function public.private_admin_log(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.private_admin_denied() from public, anon, authenticated;

grant execute on function public.admin_get_overview_stats() to authenticated;
grant execute on function public.admin_list_institutions() to authenticated;
grant execute on function public.admin_create_institution(text, text, text, text, text[]) to authenticated;
grant execute on function public.admin_list_officers() to authenticated;
grant execute on function public.admin_invite_officer(text, text, uuid, text, text) to authenticated;
grant execute on function public.admin_toggle_officer_active(uuid, boolean) to authenticated;
grant execute on function public.admin_get_access_limits(uuid) to authenticated;
grant execute on function public.admin_set_access_level(uuid, text) to authenticated;
grant execute on function public.admin_set_allowed_categories(uuid, text[]) to authenticated;
grant execute on function public.admin_set_sla_hours(uuid, int) to authenticated;
grant execute on function public.admin_set_rate_limit(uuid, int) to authenticated;
grant execute on function public.admin_get_audit_log(int) to authenticated;
grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_save_settings(jsonb) to authenticated;
grant execute on function public.admin_audit(text, text, text, jsonb) to authenticated;
