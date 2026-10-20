-- ============================================================================
-- 0016_dispatch.sql — welcome email for first-time Google signups + WhatsApp
-- dispatch of queued notifications (status-change updates to citizens).
-- ============================================================================
-- 1. Google welcome email: GoTrue's send-email hook only fires for email
--    auth types (signup/magiclink/recovery/...). OAuth (Google) users never
--    pass through it, so first-time Google signups got no welcome email.
--    Fix: a DEFERRED constraint trigger on auth.users (fires at COMMIT, so
--    the auth.identities rows GoTrue writes in the same transaction are
--    visible) calls the welcome-email edge function via pg_net, which sends
--    exactly ONE welcome email (no code — Google users have nothing to
--    verify) via Resend and logs it in public.email_log. Email signups are
--    untouched: their welcome + OTP comes from the GoTrue email hook.
--    Idempotent per user AND per email address (welcome_email_log guard).
-- 2. Verified-phone storage on profiles already exists (0012 +
--    auth-verify /verify-phone-otp writes phone + phone_verified). Nothing
--    to add here — this migration makes the stored number USED.
-- 3. WhatsApp dispatch: status changes already queue rows in
--    public.notifications via fn_notify_citizen, but nothing sent them
--    (60+ pending rows at deploy time). Fix: an AFTER INSERT trigger on
--    public.notifications hands each row to the notify-out edge function
--    (x-gamciv-key from the DB Vault) which sends via GOWA and reports the
--    result back with notify_out_result. A pg_cron sweep re-dispatches any
--    row the trigger could not hand over and resets rows stuck in
--    'sending'. fn_notify_citizen now prefers the citizen's VERIFIED
--    profile phone (phone_verified = true, set by the WhatsApp OTP flow)
--    and falls back to complaints.citizen_phone.
--    Rate limit: max ONE status-change message per complaint per hour
--    (the intake "Received, reference ..." confirmation always goes and
--    does not count toward the limit).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Welcome email for first-time Google (OAuth) signups
-- ---------------------------------------------------------------------------

-- Guard table: which users/emails already received (or were queued for) a
-- trigger-driven welcome. The edge function additionally checks email_log.
create table if not exists public.welcome_email_log (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text,
  sent_at   timestamptz not null default now()
);

alter table public.welcome_email_log enable row level security;

-- No direct client access; service_role keeps full access (email_log pattern).
revoke all on public.welcome_email_log from anon, authenticated;
grant select, insert, update, delete on public.welcome_email_log to service_role;

create policy "welcome_email_log_service_all"
  on public.welcome_email_log
  for all to service_role
  using (true)
  with check (true);

create or replace function public.fn_dispatch_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
begin
  -- Anonymous accounts have no email: nothing to send to.
  if new.email is null or length(btrim(new.email)) = 0 then
    return new;
  end if;

  -- OAuth check. raw_app_meta_data.provider is written with the user row;
  -- auth.identities is the authoritative fallback (the trigger is deferred,
  -- so GoTrue's identity rows are visible at COMMIT).
  v_provider := coalesce(new.raw_app_meta_data ->> 'provider', '');
  if v_provider in ('', 'email', 'anonymous')
     and not exists (
       select 1 from auth.identities i
       where i.user_id = new.id
         and i.provider not in ('email', 'anonymous')
     )
  then
    -- Email signup: the GoTrue send-email hook sends welcome + OTP code.
    return new;
  end if;

  -- Exactly ONE welcome per user and per email address, ever. The email
  -- match also suppresses a Google welcome for an address that already
  -- received one via the email-signup flow.
  if exists (
    select 1 from public.welcome_email_log w
    where w.user_id = new.id
       or (w.email is not null and w.email = new.email)
  ) then
    return new;
  end if;

  insert into public.welcome_email_log (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;

  -- Fire-and-forget: a dispatch failure must NEVER fail the signup.
  begin
    perform net.http_post(
      url := 'http://functions:9000/welcome-email',
      body := jsonb_build_object('user_id', new.id::text, 'email', new.email),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- welcome_email_log row already marks the attempt; email_log shows the outcome
  end;

  return new;
end $$;

-- DEFERRED: fires at COMMIT so GoTrue's identities rows are visible.
drop trigger if exists trg_welcome_email on auth.users;
create constraint trigger trg_welcome_email
  after insert on auth.users
  deferrable initially deferred
  for each row execute function public.fn_dispatch_welcome_email();

-- ---------------------------------------------------------------------------
-- 2. Verified-phone preference + status-update rate limit
-- ---------------------------------------------------------------------------

-- fn_notify_citizen: prefer the citizen's VERIFIED profile phone; fall back
-- to the complaint's citizen_phone. Once a person verifies their WhatsApp
-- number (auth-verify), all later updates reach them even when the report
-- was filed with a different or missing phone.
create or replace function public.fn_notify_citizen(
  p_complaint_id uuid,
  p_message text,
  p_channel notif_channel default 'whatsapp'
) returns uuid
language plpgsql
as $$
declare
  c public.complaints%rowtype;
  v_phone text;
  v_id uuid;
begin
  select * into c from public.complaints where id = p_complaint_id;
  if not found or c.is_anonymous then
    return null;
  end if;

  -- Rate limit (Boss 2026-10-20): max ONE update message per complaint per
  -- hour. The intake confirmation ("Received, reference ...") always goes
  -- and does not count toward the limit.
  if p_channel = 'whatsapp'
     and exists (
       select 1 from public.notifications n
       where n.complaint_id = p_complaint_id
         and n.channel = 'whatsapp'
         and n.message not like 'Received, reference%'
         and n.created_at > now() - interval '1 hour'
     )
  then
    return null;
  end if;

  -- Phone preference: citizen's verified profile phone first, then the
  -- phone recorded on the complaint itself.
  if c.citizen_id is not null then
    select p.phone into v_phone
    from public.profiles p
    where p.user_id = c.citizen_id
      and p.phone_verified is true
      and p.phone is not null
    limit 1;
  end if;

  if v_phone is null then
    v_phone := c.citizen_phone;
  end if;
  if v_phone is null or length(btrim(v_phone)) = 0 then
    return null;
  end if;

  select public.fn_notify(p_complaint_id, p_channel, v_phone, p_message)
  into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Dispatch queued notifications to notify-out (WhatsApp via GOWA)
-- ---------------------------------------------------------------------------

-- When the row was claimed but never got a result (notify-out crashed
-- mid-send), the sweep needs to know when that happened.
alter table public.notifications
  add column if not exists claimed_at timestamptz;

-- notify_out_claim: unchanged contract + claimed_at stamp.
create or replace function public.notify_out_claim(p_notification_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.notifications%rowtype;
begin
  select * into v from public.notifications
  where id::text = p_notification_id
    and status = 'pending'
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.notifications
     set status = 'sending', attempts = attempts + 1, claimed_at = now()
   where id = v.id;

  return jsonb_build_object(
    'notification_id', v.id::text,
    'channel', v.channel::text,
    'recipient', v.recipient,
    'message', v.message
  );
end $$;

-- Trigger: hand every new notification row to notify-out. The claim mutex
-- inside notify-out makes double dispatch safe (second claim returns null).
create or replace function public.fn_dispatch_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  -- No key in the Vault: leave the row pending; the sweep picks it up once
  -- the key exists (dispatching with no key would strand the row in
  -- 'sending' forever because notify-out 401s without recording a result).
  v_key := (
    select decrypted_secret from vault.decrypted_secrets
    where name = 'internal_function_key'
  );
  if v_key is null or length(v_key) = 0 then
    return new;
  end if;

  -- A dispatch failure must never fail the business action that queued
  -- the message; the row stays pending and the sweep retries.
  begin
    perform net.http_post(
      url := 'http://functions:9000/notify-out',
      body := jsonb_build_object('notification_id', new.id::text),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-gamciv-key', v_key
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;

  return new;
end $$;

drop trigger if exists trg_dispatch_notification on public.notifications;
create trigger trg_dispatch_notification
  after insert on public.notifications
  for each row execute function public.fn_dispatch_notification();

-- Sweep (pg_cron every 15 min): reset rows stuck in 'sending', then hand
-- every still-unsent recent WhatsApp row to notify-out. Recipients must be
-- a clean phone (7-20 digits, optional +) — masked/garbage recipients
-- (privacy-masked strings, group JIDs longer than 20 digits) are skipped.
create or replace function public.fn_notify_dispatch_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_reset int;
  v_dispatched int := 0;
  r record;
begin
  update public.notifications
     set status = 'pending'
   where status = 'sending'
     and (
       (claimed_at is not null and claimed_at < now() - interval '15 minutes')
       or (claimed_at is null and created_at < now() - interval '15 minutes')
     );
  get diagnostics v_reset = row_count;

  v_key := (
    select decrypted_secret from vault.decrypted_secrets
    where name = 'internal_function_key'
  );
  if v_key is null or length(v_key) = 0 then
    raise notice 'notify dispatch sweep: no internal key in vault';
    return 0;
  end if;

  for r in
    select id
    from public.notifications
    where status = 'pending'
      and attempts = 0
      and channel = 'whatsapp'
      and recipient ~ '^[0-9+]{7,20}$'
      and created_at > now() - interval '24 hours'
  loop
    begin
      perform net.http_post(
        url := 'http://functions:9000/notify-out',
        body := jsonb_build_object('notification_id', r.id::text),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-gamciv-key', v_key
        ),
        timeout_milliseconds := 5000
      );
      v_dispatched := v_dispatched + 1;
    exception when others then
      null; -- stays pending for the next sweep
    end;
  end loop;

  raise notice 'notify dispatch sweep: reset % stuck, dispatched %', v_reset, v_dispatched;
  return v_dispatched;
end $$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('gamciv-notify-dispatch');
    exception when others then null;
    end;
    begin
      perform cron.schedule('gamciv-notify-dispatch', '*/15 * * * *',
        $$select public.fn_notify_dispatch_sweep()$$);
    exception when duplicate_object then
      perform cron.unschedule('gamciv-notify-dispatch');
      perform cron.schedule('gamciv-notify-dispatch', '*/15 * * * *',
        $$select public.fn_notify_dispatch_sweep()$$);
    end;
  end if;
end $cron$;

-- ---------------------------------------------------------------------------
-- 4. Backfill the welcome guard for existing users: nobody already in the
--    system gets a retroactive welcome; only new first-time Google signups
--    will. (Existing Google users are covered by this backfill too.)
-- ---------------------------------------------------------------------------
insert into public.welcome_email_log (user_id, email)
select u.id, u.email
from auth.users u
where u.email is not null
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Harden: internal helpers are not callable by clients.
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_dispatch_welcome_email() from anon, authenticated, public;
revoke execute on function public.fn_notify_dispatch_sweep() from anon, authenticated, public;
