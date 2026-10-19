-- 0008_ops.sql — public tracking fn, storage bucket + RLS, realtime, pg_cron, track_complaint
create or replace function public.fn_public_tracking(
  p_tracking_no text
) returns table (
  id uuid,
  tracking_no text,
  title text,
  status public.complaint_status,
  urgency public.urgency_level,
  institution_name text,
  department_name text,
  category_name text,
  ward text,
  expected_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_note text,
  resolution_photo_url text,
  created_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select
    c.id, c.tracking_no, c.title, c.status, c.urgency,
    i.name, d.name, cat.name, c.ward,
    c.expected_response_at, c.resolved_at, c.closed_at,
    c.resolution_note, c.resolution_photo_url, c.created_at
  from public.complaints c
  left join public.institutions i on i.id = c.institution_id
  left join public.departments d on d.id = c.department_id
  left join public.categories cat on cat.id = c.category_id
  where c.tracking_no = upper(btrim(p_tracking_no))
    and not c.is_sensitive;
$$;

grant execute on function public.fn_public_tracking(text) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('complaint-photos', 'complaint-photos', false)
on conflict (id) do nothing;

-- photos live under {complaint_id}/... in the bucket; owner, owning-institution officers, admin, service only
create policy "photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'complaint-photos'
    and (
      public.fn_is_admin()
      or exists (
        select 1 from public.complaints c
        where c.id = (storage.foldername(name))[1]::uuid
          and (c.citizen_id = auth.uid() or public.fn_is_officer_of(c.id))
      )
    )
  );

create policy "photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'complaint-photos'
    and exists (
      select 1 from public.complaints c
      where c.id = (storage.foldername(name))[1]::uuid
        and (c.citizen_id = auth.uid() or public.fn_is_officer_of(c.id))
    )
  );

create policy "photos_service_all" on storage.objects
  for all to service_role using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.complaints;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.complaint_updates;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- pg_cron: escalation sweep every 15 min, auto-close daily; guarded — n8n fallback calls the sweeps directly
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then null;  -- may need to live in 'extensions' schema
    end;
  end if;
end $$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      select cron.schedule('gamciv-escalation-sweep', '*/15 * * * *',
        $$select public.fn_run_escalation_sweep()$$);
    exception when duplicate_object then
      perform cron.unschedule('gamciv-escalation-sweep');
      select cron.schedule('gamciv-escalation-sweep', '*/15 * * * *',
        $$select public.fn_run_escalation_sweep()$$);
    end;

    begin
      select cron.schedule('gamciv-autoclose-sweep', '0 6 * * *',
        $$select public.fn_run_autoclose_sweep()$$);
    exception when duplicate_object then
      perform cron.unschedule('gamciv-autoclose-sweep');
      select cron.schedule('gamciv-autoclose-sweep', '0 6 * * *',
        $$select public.fn_run_autoclose_sweep()$$);
    end;
  end if;
end $cron$;

-- SECURITY: sensitive complaints return only tracking_no + status (no institution, urgency, response times, or real timeline)
create or replace function public.track_complaint(
  p_tracking_no text
) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
begin
  select * into c from public.complaints
  where tracking_no = upper(btrim(p_tracking_no));
  if not found then
    return null;
  end if;

  if c.is_sensitive then
    return jsonb_build_object(
      'tracking_no', c.tracking_no,
      'status', c.status,
      'urgency', null,
      'title', null,
      'description', null,
      'institution', null,
      'department', null,
      'expected_response_at', null,
      'resolved_at', null,
      'closed_at', null,
      'timeline', jsonb_build_array(jsonb_build_object(
        'status', c.status,
        'message', 'This report is under review. Contact the office for updates.',
        'at', null
      ))
    );
  end if;

  return jsonb_build_object(
    'tracking_no', c.tracking_no,
    'status', c.status,
    'urgency', c.urgency,
    'title', c.title,
    'description', c.description,
    'institution', (select name from public.institutions where id = c.institution_id),
    'department', (select name from public.departments where id = c.department_id),
    'expected_response_at', c.expected_response_at,
    'resolved_at', c.resolved_at,
    'closed_at', c.closed_at,
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
                 'status', u.status_to,
                 'message', u.citizen_message,
                 'at', u.created_at
               ) order by u.created_at), '[]'::jsonb)
      from public.complaint_updates u
      where u.complaint_id = c.id
        and u.is_citizen_visible = true
    )
  );
end $$;

grant execute on function public.track_complaint(text) to anon, authenticated;
