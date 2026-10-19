-- ============================================================================
-- 0012_auth_verification.sql
-- Verified signup + admin-configurable senders + system email log.
-- ============================================================================
-- 1. profiles gains phone / phone_verified / email_verified so the web app
--    can enforce the verified-signup gate and detect officer accounts
--    (officers of an institution already live in public.officers via user_id).
-- 2. otp_codes: hashed single-use codes with per-recipient hourly rate limit.
-- 3. app_settings: key/value JSON the admin panel edits without migrations
--    (whatsapp_sender_number, resend_from_email).
-- 4. email_log: SYSTEM emails only (OTP, welcome, citizen lifecycle). No
--    institute rows: institute correspondence never passes through this
--    server (Boss decision 2026-10-19). Admin reads it via fn_admin_emails.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: verification columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists email_verified boolean not null default false;

-- One phone per account (NULLs allowed for citizens who skip phone entry).
create unique index if not exists ux_profiles_phone
  on public.profiles (phone) where phone is not null;

-- ---------------------------------------------------------------------------
-- 2. otp_codes: single-use hashed verification codes
-- ---------------------------------------------------------------------------
create table if not exists public.otp_codes (
  id          uuid primary key default gen_random_uuid(),
  purpose     text not null check (purpose in ('email_verify', 'phone_verify')),
  recipient   text not null,             -- email address or phone digits
  code_hash   text not null,             -- sha-256 hex, never the code itself
  expires_at  timestamptz not null,
  attempts    int not null default 0,    -- failed verify attempts against row
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint otp_expires_future check (expires_at > created_at)
);

create index if not exists ix_otp_codes_recipient
  on public.otp_codes (purpose, recipient, created_at desc);

-- One active code per (purpose, recipient): a new send supersedes the old one.
create unique index if not exists ux_otp_codes_active
  on public.otp_codes (purpose, recipient) where consumed_at is null;

alter table public.otp_codes enable row level security;

-- No direct table access for anon/authenticated: codes are only ever read
-- and consumed inside the security-definer RPCs below. service_role keeps
-- full access for the edge functions.
revoke all on public.otp_codes from anon, authenticated;

-- Rate limit: how many codes were issued to this recipient in the last hour
-- (enforced server-side by issue_otp before inserting).
create or replace function public.otp_codes_last_hour(p_purpose text, p_recipient text)
returns int
language sql stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.otp_codes
  where purpose = p_purpose
    and recipient = p_recipient
    and created_at > now() - interval '1 hour';
$$;

-- Issue (or replace) a code. Hashes the code; never stores it in clear text.
create or replace function public.issue_otp(
  p_purpose text,
  p_recipient text,
  p_code text,
  p_ttl_minutes int default 10
) returns boolean
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  if p_purpose not in ('email_verify', 'phone_verify') then
    return false;
  end if;
  if p_recipient is null or length(btrim(p_recipient)) = 0
     or length(btrim(p_recipient)) > 200 then
    return false;
  end if;
  if p_code is null or not (p_code ~ '^[0-9]{6}$') then
    return false;
  end if;
  if p_ttl_minutes < 1 or p_ttl_minutes > 60 then
    p_ttl_minutes := 10;
  end if;

  -- Rate limit: at most 5 codes per recipient per purpose per hour.
  if public.otp_codes_last_hour(p_purpose, btrim(p_recipient)) >= 5 then
    return false;
  end if;

  -- A new send supersedes the previous active code (ux_otp_codes_active).
  update public.otp_codes
     set consumed_at = now()
   where purpose = p_purpose
     and recipient = btrim(p_recipient)
     and consumed_at is null;

  insert into public.otp_codes (purpose, recipient, code_hash, expires_at)
  values (
    p_purpose,
    btrim(p_recipient),
    encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex'),
    now() + make_interval(mins => p_ttl_minutes)
  );
  return true;
end $$;

-- Verify + consume a code atomically. Max 5 wrong attempts per row.
create or replace function public.verify_otp(
  p_purpose text,
  p_recipient text,
  p_code text
) returns boolean
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_row public.otp_codes%rowtype;
  v_hash text;
begin
  if p_code is null or not (p_code ~ '^[0-9]{6}$') then
    return false;
  end if;

  select * into v_row
  from public.otp_codes
  where purpose = p_purpose
    and recipient = btrim(p_recipient)
    and consumed_at is null
  order by created_at desc
  limit 1;

  if not found then
    return false;
  end if;

  if v_row.attempts >= 5 then
    return false;
  end if;

  v_hash := encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex');

  if v_hash <> v_row.code_hash then
    update public.otp_codes
       set attempts = attempts + 1
     where id = v_row.id;
    return false;
  end if;

  if v_row.expires_at < now() then
    return false;
  end if;

  update public.otp_codes
     set consumed_at = now()
   where id = v_row.id;
  return true;
end $$;

revoke execute on function public.otp_codes_last_hour(text, text) from anon, authenticated;
revoke execute on function public.issue_otp(text, text, text, int) from anon, authenticated;
revoke execute on function public.verify_otp(text, text, text) from anon, authenticated;
grant execute on function public.otp_codes_last_hour(text, text) to service_role;
grant execute on function public.issue_otp(text, text, text, int) to service_role;
grant execute on function public.verify_otp(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app_settings: admin-editable key/value config (JSON values)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_settings enable row level security;

create policy "settings_admin_all" on public.app_settings
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "settings_service_all" on public.app_settings
  for all to service_role using (true) with check (true);

-- Seeded values; the admin panel edits them in place (no migration needed).
insert into public.app_settings (key, value)
values
  ('whatsapp_sender_number', '"2200000000"'::jsonb),
  ('resend_from_email', '"GamCiv <onboarding@resend.dev>"'::jsonb)
on conflict (key) do nothing;

-- Typed getters (service_role only; edge functions call these).
create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select value from public.app_settings where key = btrim(p_key);
$$;

create or replace function public.set_setting(p_key text, p_value jsonb)
returns boolean
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  if p_key is null or length(btrim(p_key)) = 0 or length(btrim(p_key)) > 100 then
    return false;
  end if;
  if p_value is null then
    return false;
  end if;
  insert into public.app_settings (key, value, updated_by)
  values (btrim(p_key), p_value, auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now(),
        updated_by = excluded.updated_by;
  return true;
end $$;

revoke execute on function public.get_setting(text) from anon, authenticated;
revoke execute on function public.set_setting(text, jsonb) from anon, authenticated;
grant execute on function public.get_setting(text) to service_role;
grant execute on function public.set_setting(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. email_log: system emails only (OTP, welcome, citizen lifecycle)
-- ---------------------------------------------------------------------------
create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  subject    text not null,
  template   text not null,
  status     text not null default 'sent' check (status in ('sent', 'failed')),
  error      text,
  sent_at    timestamptz not null default now()
);

alter table public.email_log enable row level security;

create index if not exists ix_email_log_sent
  on public.email_log (sent_at desc);

-- Admin reads system emails; nobody else does. Institute emails do not exist
-- here: institute correspondence never passes through this server.
create policy "email_log_admin_select" on public.email_log
  for select to authenticated
  using (public.fn_is_admin());

create policy "email_log_service_all" on public.email_log
  for all to service_role using (true) with check (true);

-- Admin Mail Center: recent system emails. service_role only (admin UI calls
-- the edge function which uses the service key; direct admin SQL reads the
-- table through RLS above).
create or replace function public.fn_admin_emails(p_limit int default 100)
returns table (
  id uuid,
  to_email text,
  subject text,
  template text,
  status text,
  sent_at timestamptz
)
language sql stable
security definer
set search_path = ''
as $$
  select id, to_email, subject, template, status, sent_at
  from public.email_log
  order by sent_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.fn_admin_emails(int) from anon, authenticated;
grant execute on function public.fn_admin_emails(int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Verified signup helper: one row per user is created by the signup
--    trigger in 0001; the auth-verify edge function uses service_role writes.
-- ---------------------------------------------------------------------------
create or replace function public.mark_email_verified(p_user_id uuid)
returns boolean
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return false;
  end if;
  update public.profiles
     set email_verified = true
   where user_id = p_user_id;
  return found;
end $$;

create or replace function public.mark_phone_verified(p_user_id uuid, p_phone text)
returns boolean
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_phone is null then
    return false;
  end if;
  update public.profiles
     set phone_verified = true,
         phone = btrim(p_phone)
   where user_id = p_user_id;
  return found;
end $$;

revoke execute on function public.mark_email_verified(uuid) from anon, authenticated;
revoke execute on function public.mark_phone_verified(uuid, text) from anon, authenticated;
grant execute on function public.mark_email_verified(uuid) to service_role;
grant execute on function public.mark_phone_verified(uuid, text) to service_role;
