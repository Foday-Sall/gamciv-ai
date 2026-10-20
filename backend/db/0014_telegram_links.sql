-- 0014_telegram_links.sql — Telegram one-time phone linking
-- Maps a Telegram chat to a registered user profile. Filled by the
-- telegram-intake edge function when an unlinked chat sends the phone number
-- they registered with (matching a profiles row with phone_verified = true).
--
-- Security: RLS is enabled with NO policies. Anon/authenticated get nothing;
-- the table is read and written only via service_role (the edge functions) or
-- security-definer SQL. Chat IDs are personal data, not public content.

create table if not exists public.telegram_links (
  telegram_chat_id text primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now()
);

alter table public.telegram_links ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role bypasses RLS. Keep it that way.

-- Lookup used by telegram-intake to link or gate a chat (service_role only).
-- Joins profiles so the caller gets the personalized-confirmation fields in
-- one hop; rows whose profile was deleted are treated as unlinked.
create or replace function public.get_telegram_link(p_chat_id text)
returns table (user_id uuid, full_name text, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id, p.full_name, p.email, l.created_at
  from public.telegram_links l
  join public.profiles p on p.user_id = l.user_id
  where l.telegram_chat_id = p_chat_id;
$$;

-- Verified-profile lookup for the linking flow: exactly one row when the
-- phone belongs to a registered, phone-verified account (service_role only).
create or replace function public.find_verified_profile_by_phone(p_phone text)
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.full_name, p.email
  from public.profiles p
  where p.phone = btrim(p_phone)
    and p.phone_verified is true
  limit 1;
$$;

-- Insert or refresh the chat-to-user link (service_role only). Relinking a
-- chat to a different account overwrites the previous mapping.
create or replace function public.upsert_telegram_link(p_chat_id text, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_chat_id is null or length(btrim(p_chat_id)) = 0
     or length(btrim(p_chat_id)) > 64 then
    return false;
  end if;
  if p_user_id is null then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id) then
    return false;
  end if;
  insert into public.telegram_links (telegram_chat_id, user_id)
  values (btrim(p_chat_id), p_user_id)
  on conflict (telegram_chat_id) do update
    set user_id = excluded.user_id,
        created_at = now();
  return true;
end $$;

revoke all on function public.get_telegram_link(text) from public, anon, authenticated;
revoke all on function public.find_verified_profile_by_phone(text) from public, anon, authenticated;
revoke all on function public.upsert_telegram_link(text, uuid) from public, anon, authenticated;
grant execute on function public.get_telegram_link(text) to service_role;
grant execute on function public.find_verified_profile_by_phone(text) to service_role;
grant execute on function public.upsert_telegram_link(text, uuid) to service_role;
