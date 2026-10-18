-- ============================================================================
-- GamCiv AI — 0001_schema.sql
-- Enums, core tables, indexes, triggers, audit log, public views
-- Target: Supabase (self-hosted) / PostgreSQL 17
-- Source of truth: docs/BLUEPRINT.md §5-§8, docs/API-BLUEPRINT.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
create type public.complaint_status as enum (
  'submitted',              -- fresh intake, awaiting Central Desk triage
  'received',               -- auto-routed, awaiting officer acceptance
  'assigned',               -- officer accepted / assigned
  'in_progress',
  'waiting_info',           -- officer asked citizen for information
  'forwarded',              -- forwarded to another institution
  'citizen_confirmation',   -- officer resolved; citizen must confirm
  'resolved',               -- resolved (pre-confirmation state kept for stats)
  'closed',                 -- citizen confirmed or auto-closed
  'rejected',               -- with explanation
  'escalated',              -- deadline passed
  'reopened'
);

create type public.urgency_level as enum ('low', 'normal', 'high', 'critical');
create type public.report_channel as enum ('web', 'whatsapp', 'sms');
create type public.user_role as enum ('citizen', 'officer', 'admin');

create type public.update_type as enum (
  'system', 'status', 'note', 'assignment', 'forward', 'escalation',
  'resolution', 'attachment', 'reopened', 'route', 'confirmation', 'urgency'
);

create type public.notif_channel as enum ('whatsapp', 'sms', 'email');
create type public.notif_status  as enum ('pending', 'sent', 'failed');

-- ---------------------------------------------------------------------------
-- TABLES (order matters for FKs)
-- ---------------------------------------------------------------------------
create table public.institutions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code           text not null unique,
  type           text not null default 'agency',   -- municipal|utility|agency|security|central
  is_dashboard   boolean not null default false,
  public_visible boolean not null default true,
  contact        jsonb not null default '{}'::jsonb,  -- {phone,email,aliases:[]}
  created_at     timestamptz not null default now()
);

create table public.departments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name           text not null,
  created_at     timestamptz not null default now(),
  unique (institution_id, name)
);

create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text unique,
  role       public.user_role not null default 'citizen',
  full_name  text,
  created_at timestamptz not null default now()
);

create table public.officers (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  department_id  uuid references public.departments(id) on delete set null,
  name           text not null,
  phone          text,
  email          text unique,
  user_id        uuid unique references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table public.categories (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text not null unique,
  keywords              text[] not null default '{}',
  default_institution_id uuid references public.institutions(id) on delete set null,
  default_department_id  uuid references public.departments(id) on delete set null,
  is_sensitive          boolean not null default false,
  is_emergency          boolean not null default false,
  deadline_hours        int not null default 72,
  created_at            timestamptz not null default now()
);

create table public.complaint_groups (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  area        text not null default 'unknown',
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);

create table public.complaints (
  id                   uuid primary key default gen_random_uuid(),
  tracking_no          text not null unique,
  title                text not null,
  description          text not null,
  category_id          uuid references public.categories(id) on delete set null,
  urgency              public.urgency_level not null default 'normal',
  status               public.complaint_status not null default 'submitted',
  ai_confidence        numeric(3,2),
  lat                  numeric(9,6),
  lng                  numeric(9,6),
  region               text,
  council_area         text,
  ward                 text,
  photo_url            text,
  channel              public.report_channel not null default 'web',
  citizen_name         text,
  citizen_phone        text,
  is_anonymous         boolean not null default false,
  citizen_id           uuid references public.profiles(user_id) on delete set null,
  institution_id       uuid references public.institutions(id) on delete set null,
  department_id        uuid references public.departments(id) on delete set null,
  officer_id           uuid references public.officers(id) on delete set null,
  group_id             uuid references public.complaint_groups(id) on delete set null,
  expected_response_at timestamptz,
  resolved_at          timestamptz,
  closed_at            timestamptz,
  resolution_note      text,
  resolution_photo_url text,
  reopened_count       int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- anonymous reports carry no identity at all
  constraint chk_anonymous_no_identity check (
    not is_anonymous or (citizen_name is null and citizen_phone is null and citizen_id is null)
  ),
  -- sensitive complaints must have an institution (never unrouted)
  constraint chk_sensitive_routed check (not is_sensitive or institution_id is not null),
  constraint chk_lat_range check (lat is null or (lat >= -90 and lat <= 90)),
  constraint chk_lng_range check (lng is null or (lng >= -180 and lng <= 180)),
  constraint chk_coords_pair check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  )
);

create table public.complaint_updates (
  id                 uuid primary key default gen_random_uuid(),
  complaint_id       uuid not null references public.complaints(id) on delete cascade,
  actor_id           uuid references auth.users(id) on delete set null,
  actor_label        text not null default 'system',  -- system|citizen|<officer name>
  update_type        public.update_type not null default 'status',
  status_from        public.complaint_status,
  status_to          public.complaint_status,
  explanation        text,           -- internal (officer/admin/audit)
  citizen_message    text,           -- citizen-visible timeline entry
  is_citizen_visible boolean not null default false,
  created_at         timestamptz not null default now()
);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  channel      public.notif_channel not null default 'whatsapp',
  recipient    text not null,
  message      text not null,
  status       public.notif_status not null default 'pending',
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null default 'system',
  action      text not null,               -- INSERT|UPDATE|DELETE
  table_name  text not null,
  record_id   uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
create index idx_complaints_status            on public.complaints (status);
create index idx_complaints_inst_status       on public.complaints (institution_id, status);
create index idx_complaints_due               on public.complaints (expected_response_at);
create index idx_complaints_created           on public.complaints (created_at desc);
create index idx_complaints_group             on public.complaints (group_id) where group_id is not null;
create index idx_complaints_geo               on public.complaints (lat, lng);
create index idx_complaints_phone             on public.complaints (citizen_phone) where citizen_phone is not null;
create index idx_updates_complaint            on public.complaint_updates (complaint_id, created_at);
create index idx_notifications_pending        on public.notifications (status) where status = 'pending';
create index idx_groups_open                  on public.complaint_groups (closed_at) where closed_at is null;

-- ---------------------------------------------------------------------------
-- TRACKING NUMBER: GMC-<YYYY>-<00001>  (sequence-based, concurrency-safe)
-- ---------------------------------------------------------------------------
create sequence public.seq_tracking_no start 1;

create or replace function public.fn_set_tracking_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tracking_no is null or new.tracking_no = '' then
    new.tracking_no := 'GMC-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('public.seq_tracking_no'::regclass)::text, 5, '0');
  end if;
  return new;
end $$;

create trigger trg_set_tracking_no
  before insert on public.complaints
  for each row execute function public.fn_set_tracking_no();

-- ---------------------------------------------------------------------------
-- updated_at touch
-- ---------------------------------------------------------------------------
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_touch_updated_at
  before update on public.complaints
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOG for configuration tables (institutions, departments, categories,
-- officers) — every config change writes an audit row (API blueprint: CRUD
-- /admin/* writes audit_log)
-- ---------------------------------------------------------------------------
create or replace function public.fn_audit_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record uuid;
begin
  if TG_OP = 'DELETE' then
    v_record := old.id;
  else
    v_record := new.id;
  end if;

  insert into public.audit_log (actor, action, table_name, record_id, details)
  values (
    coalesce(auth.email()::text, auth.uid()::text, 'system'),
    TG_OP,
    TG_TABLE_NAME,
    v_record,
    case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger trg_audit_institutions
  after insert or update or delete on public.institutions
  for each row execute function public.fn_audit_config();
create trigger trg_audit_departments
  after insert or update or delete on public.departments
  for each row execute function public.fn_audit_config();
create trigger trg_audit_categories
  after insert or update or delete on public.categories
  for each row execute function public.fn_audit_config();
create trigger trg_audit_officers
  after insert or update or delete on public.officers
  for each row execute function public.fn_audit_config();

-- ---------------------------------------------------------------------------
-- PUBLIC VIEWS (owner-rights: bypass RLS deliberately, hard-filtered here)
-- ---------------------------------------------------------------------------
-- Public map: non-sensitive complaints only, no citizen fields, no description
create view public.v_public_map as
  select
    c.id, c.tracking_no, c.title, c.urgency, c.status,
    cat.slug  as category_slug,
    cat.name  as category_name,
    c.lat, c.lng, c.ward, c.council_area, c.region,
    c.photo_url, c.created_at, c.resolved_at is not null as has_resolution
  from public.complaints c
  left join public.categories cat on cat.id = c.category_id
  where not c.is_sensitive;

-- Public transparency stats per institution (public_visible ones only)
create view public.v_institution_stats as
  select
    i.id as institution_id,
    i.code,
    i.name,
    count(c.id)                                              as total,
    count(c.id) filter (where c.status not in ('closed','rejected')) as open_cases,
    count(c.id) filter (where c.resolved_at is not null)     as resolved_cases,
    round(
      avg(extract(epoch from (c.resolved_at - c.created_at)) / 3600.0)
      filter (where c.resolved_at is not null)::numeric
    , 1)                                                     as avg_resolution_hours
  from public.institutions i
  left join public.complaints c on c.institution_id = i.id
  where i.public_visible
  group by i.id, i.code, i.name;
