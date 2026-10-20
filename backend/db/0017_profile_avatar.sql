-- 0017_profile_avatar.sql — citizen profile editing + avatar storage
-- Adds profiles.avatar_url, guards protected columns on self-update, creates
-- the 'avatars' bucket with owner-folder-only upload policies and public read.
--
-- Protected columns (role, email, institution_id, phone, verification flags)
-- are guarded by a BEFORE UPDATE trigger that mirrors fn_guard_profile_role:
-- a self-update may only change full_name and avatar_url. RLS already limits
-- updates to the owner's row (prof_update_self); the trigger stops a citizen
-- from smuggling role/email/phone changes into that allowed update.

-- ============================================================
-- 1. Schema: avatar_url column
-- ============================================================
alter table public.profiles
  add column if not exists avatar_url text;

-- ============================================================
-- 2. Column guard trigger (mirrors fn_guard_profile_role)
-- ============================================================
create or replace function public.fn_guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.phone is distinct from old.phone
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified
  then
    if not public.fn_is_admin() then
      raise exception 'profiles: only admins may change email, role, phone or verification flags'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_profile_column_guard on public.profiles;
create trigger trg_profile_column_guard
  before update on public.profiles
  for each row execute function public.fn_guard_profile_columns();

-- ============================================================
-- 3. avatars bucket + owner-folder policies
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB — enforced again in the upload code
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone (anon included) can read public bucket objects.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Upload/delete only into the user's own folder: avatars/<auth.uid>/...
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 4. Update the full_name of auth.users → profiles sync trigger
-- ============================================================
-- The signup sync (trg_sync_profile_on_signup, 0012_auth_verification.sql)
-- only inserts. Keep it: profile edits go through the citizen app.
-- ============================================================
-- 5. Grants
-- ============================================================
grant execute on function public.fn_guard_profile_columns() to postgres, service_role;

-- Done. Frontend (Profile.tsx) saves full_name/avatar_url with the anon key;
-- RLS (prof_update_self) limits updates to the owner's row.
