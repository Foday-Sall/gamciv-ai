-- ============================================================================
-- 0013: Admin secrets audit
--   * admin_secret_audit: log of every admin-panel secret action
--   * admin_log_secret_action: write-only RPC for the admin-secrets function
--   * admin_list_secret_audit: recent entries for the panel
-- ============================================================================
-- Secrets themselves NEVER touch the database. They live in
-- /opt/supabase/docker/.env.functions on the VPS, written by the local
-- secrets bridge daemon and read by the edge functions container on
-- recreation. This table records only who changed what and when.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table: append-only audit of secret actions
-- ---------------------------------------------------------------------------
create table if not exists public.admin_secret_audit (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid,                       -- null = system/unknown actor
  action        text not null check (action in ('set', 'delete', 'list')),
  key           text not null,              -- key name only, never a value
  created_at    timestamptz not null default now()
);

create index if not exists ix_admin_secret_audit_recent
  on public.admin_secret_audit (created_at desc);

alter table public.admin_secret_audit enable row level security;

-- Readable by admins only; inserts flow through the RPCs below only.
drop policy if exists admin_secret_audit_admin_select on public.admin_secret_audit;
create policy admin_secret_audit_admin_select
  on public.admin_secret_audit
  for select
  to authenticated
  using (public.fn_is_admin());

-- No UPDATE/DELETE policies: the audit trail is append-only.
revoke all on public.admin_secret_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_log_secret_action: called by the admin-secrets edge function with the
-- service role key (so the entry carries the acting admin's user id from the
-- JWT it verified, not from the request itself). Not callable by regular
-- users.
-- ---------------------------------------------------------------------------
create function public.admin_log_secret_action(
  p_action        text,
  p_key           text,
  p_admin_user_id uuid default null
)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $fn$
begin
  insert into public.admin_secret_audit (admin_user_id, action, key)
  values (p_admin_user_id, p_action, p_key);
end;
$fn$;

revoke execute on function public.admin_log_secret_action(text, text, uuid)
  from public, anon, authenticated;

-- The admin-secrets edge function logs actions with the service role key.
grant execute on function public.admin_log_secret_action(text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- admin_list_secret_audit: recent entries (default 50, max 200) for the panel.
-- ---------------------------------------------------------------------------
create function public.admin_list_secret_audit(
  p_limit int default 50
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
      select jsonb_agg(
               jsonb_build_object(
                 'id', a.id,
                 'action', a.action,
                 'key', a.key,
                 'created_at', a.created_at,
                 'admin_user_id', a.admin_user_id,
                 'admin_email', (
                   select u.email
                   from auth.users u
                   where u.id = a.admin_user_id
                 )
               )
               order by a.created_at desc
             )
      from (
        select *
        from public.admin_secret_audit
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) a
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke execute on function public.admin_list_secret_audit(int) from public, anon;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The edge function logs actions using the service role (bypasses RLS); the
-- panel reads via the admin-secrets function as the requesting admin.
grant execute on function public.admin_list_secret_audit(int) to authenticated;
