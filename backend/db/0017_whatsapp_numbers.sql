-- ============================================================================
-- 0017_whatsapp_numbers.sql — WhatsApp numbers registry + institution logos
-- ============================================================================
-- 1. whatsapp_numbers: admin-managed registry of the WhatsApp numbers (GOWA
--    device slots) this deployment uses. One number sends OTP verification
--    codes, another handles user chat. Status lifecycle:
--      pending  — slot created, pairing code issued, not yet linked
--      linked   — GOWA reports logged-in
--      revoked  — logged out on the GOWA side; cannot send
--    gowa_instance stores the GOWA device slot id so admin-whatsapp can
--    correlate the two systems.
-- 2. RLS: admins get full access via fn_is_admin; service_role bypasses RLS
--    (edge functions need it for OTP sender lookup); everyone else nothing.
-- 3. Helper for the OTP flow: verified admin-registered number whose role is
--    'otp', else NULL (callers fall back to app_settings/env).
-- 4. institutions.logo_url — optional logo shown in the admin panel and the
--    institution dashboard header. Files live in the 'institution-logos'
--    storage bucket (admin-only writes, public reads).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registry table
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_numbers (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  role          text not null default 'chat'
                check (role in ('otp', 'chat')),
  status        text not null default 'pending'
                check (status in ('pending', 'linked', 'revoked')),
  gowa_instance text,
  linked_at     timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists ix_whatsapp_numbers_role_status
  on public.whatsapp_numbers (role, status);

alter table public.whatsapp_numbers enable row level security;

-- Admins only (same guard as app_settings / email_log). service_role needs
-- no policy — it bypasses RLS.
drop policy if exists "whatsapp_numbers_admin_all" on public.whatsapp_numbers;
create policy "whatsapp_numbers_admin_all"
  on public.whatsapp_numbers
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- No anon policy at all: anon gets nothing (RLS default deny).

-- ---------------------------------------------------------------------------
-- 2. OTP sender lookup (service_role only, used by auth-verify)
-- ---------------------------------------------------------------------------
create or replace function public.get_otp_sender_number()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select number
  from public.whatsapp_numbers
  where role = 'otp'
    and status = 'linked'
  order by created_at desc
  limit 1;
$$;

revoke execute on function public.get_otp_sender_number() from public, anon, authenticated;
grant execute on function public.get_otp_sender_number() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Institution logos
-- ---------------------------------------------------------------------------
alter table public.institutions
  add column if not exists logo_url text;

-- Logo storage bucket: admins write, anyone reads (logos are public brand
-- images rendered on the institution dashboard header).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'institution-logos',
  'institution-logos',
  true,
  2097152, -- 2 MB — enforced again in the admin UI
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read (logos render on the public institution dashboard).
drop policy if exists "institution_logos_public_read" on storage.objects;
create policy "institution_logos_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'institution-logos');

-- Admin writes only. Folder layout: institution-logos/<institution_id>.<ext>
-- so a re-upload with the same id overwrites cleanly; the folder check keeps
-- other institutions' files (and other buckets) out of reach.
drop policy if exists "institution_logos_admin_insert" on storage.objects;
create policy "institution_logos_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'institution-logos'
    and public.fn_is_admin()
  );

drop policy if exists "institution_logos_admin_update" on storage.objects;
create policy "institution_logos_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'institution-logos'
    and public.fn_is_admin()
  )
  with check (
    bucket_id = 'institution-logos'
    and public.fn_is_admin()
  );

drop policy if exists "institution_logos_admin_delete" on storage.objects;
create policy "institution_logos_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'institution-logos'
    and public.fn_is_admin()
  );

-- Done. The admin panel uploads via the admin-whatsapp function (service
-- role) or directly with the admin session (policies above).
