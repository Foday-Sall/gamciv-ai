-- 0015_institution_dashboard.sql
-- Live institution dashboard aggregates. The caller can only see the institution
-- linked to their officer account. No citizen identity fields are returned.

create or replace function public.fn_institution_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_institution_id uuid := public.fn_my_institution();
  v_result jsonb;
begin
  if v_institution_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  with base as (
    select
      c.id,
      c.created_at,
      c.resolved_at,
      c.expected_response_at,
      c.status,
      c.urgency,
      c.channel,
      coalesce(cat.name, 'Uncategorized') as category
    from public.complaints c
    left join public.categories cat on cat.id = c.category_id
    where c.institution_id = v_institution_id
  ),
  daily as (
    select
      d.day,
      count(b.id) filter (where b.created_at >= d.day and b.created_at < d.day + interval '1 day') as received,
      count(b.id) filter (
        where b.resolved_at >= d.day and b.resolved_at < d.day + interval '1 day'
      ) as resolved
    from generate_series(
      date_trunc('day', now()) - interval '13 days',
      date_trunc('day', now()),
      interval '1 day'
    ) as d(day)
    left join base b on true
    group by d.day
    order by d.day
  )
  select jsonb_build_object(
    'institution', (
      select jsonb_build_object('id', i.id, 'code', i.code, 'name', i.name)
      from public.institutions i
      where i.id = v_institution_id
    ),
    'total', (select count(*) from base),
    'today', (select count(*) from base where created_at >= date_trunc('day', now())),
    'open', (select count(*) from base where status not in ('closed', 'rejected')),
    'resolved_week', (
      select count(*) from base
      where resolved_at >= now() - interval '7 days'
    ),
    'overdue', (
      select count(*) from base
      where expected_response_at < now()
        and status not in ('closed', 'rejected')
    ),
    'avg_resolution_hours', (
      select coalesce(round(avg(extract(epoch from (resolved_at - created_at)) / 3600.0)::numeric, 1), 0)
      from base
      where resolved_at is not null
    ),
    'by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.count) order by s.status)
      from (
        select status::text, count(*)::int
        from base
        group by status
      ) s
    ), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', s.category, 'count', s.count) order by s.count desc, s.category)
      from (
        select category, count(*)::int
        from base
        group by category
      ) s
    ), '[]'::jsonb),
    'by_channel', coalesce((
      select jsonb_agg(jsonb_build_object('channel', s.channel, 'count', s.count) order by s.count desc, s.channel)
      from (
        select channel::text, count(*)::int
        from base
        group by channel
      ) s
    ), '[]'::jsonb),
    'by_urgency', coalesce((
      select jsonb_agg(jsonb_build_object('urgency', s.urgency, 'count', s.count) order by s.urgency)
      from (
        select urgency::text, count(*)::int
        from base
        group by urgency
      ) s
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(day, 'YYYY-MM-DD'),
        'received', received,
        'resolved', resolved
      ) order by day)
      from daily
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.fn_institution_dashboard_stats() from public, anon;
grant execute on function public.fn_institution_dashboard_stats() to authenticated;
