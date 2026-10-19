-- 0006_admin.sql — admin route override + Central Desk queue
create or replace function public.fn_admin_route(
  p_complaint_id uuid,
  p_institution_id uuid,
  p_department_id uuid default null,
  p_note text default null
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
begin
  if not public.fn_is_admin() then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if not found then
    return false;
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.institution_id = p_institution_id
  ) then
    return false;
  end if;

  update public.complaints
     set institution_id = p_institution_id,
         department_id  = p_department_id,
         status         = case when c.status in ('submitted') then 'received' else c.status end,
         expected_response_at = public.fn_calculate_deadline(c.category_id, c.urgency)
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation, is_citizen_visible
  )
  select c.id, auth.uid(), 'admin', 'route',
         c.status,
         case when c.status = 'submitted' then 'received' else c.status end,
         coalesce(p_note, 'Manual route override by admin'), false;

  return true;
end $$;

create or replace function public.fn_central_desk_queue()
returns table (
  id uuid,
  tracking_no text,
  title text,
  description text,
  status public.complaint_status,
  urgency public.urgency_level,
  ai_confidence numeric,
  institution text,
  created_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.tracking_no, c.title, c.description, c.status, c.urgency,
         c.ai_confidence, i.name, c.created_at
  from public.complaints c
  left join public.institutions i on i.id = c.institution_id
  where c.status = 'submitted'
  order by c.urgency = 'critical' desc, c.created_at asc;
$$;
