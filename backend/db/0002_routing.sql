-- 0002_routing.sql — SLA deadlines, emergency keyword check, location resolution, routing engine
create or replace function public.fn_calculate_deadline(
  p_category_id uuid,
  p_urgency public.urgency_level
) returns timestamptz
language plpgsql stable
as $$
declare
  v_hours numeric;
begin
  select coalesce(deadline_hours, 72)::numeric into v_hours
  from public.categories where id = p_category_id;
  if v_hours is null then
    v_hours := 72;
  end if;

  if p_urgency = 'critical' then
    v_hours := v_hours * 0.5;
  elsif p_urgency = 'low' then
    v_hours := v_hours * 1.5;
  end if;

  v_hours := greatest(4, least(168, v_hours));
  return now() + make_interval(hours => v_hours);
end $$;

create or replace function public.fn_check_emergency_keywords(
  p_title text,
  p_description text
) returns text
language plpgsql immutable
as $$
declare
  v_text text;
begin
  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  if v_text ~ '(fire|smoke|burning|ablaze|inferno)' then
    return 'emergency_fire';
  end if;
  if v_text ~ '(gunshot|shooting|gunmen|stabbing|bleeding|drowning|assault|robbery)' then
    return 'emergency_police';
  end if;
  return null;
end $$;

-- resolution: council_area alias match, else lat/lng inside contact->'bbox' = [minLat, minLng, maxLat, maxLng]
create or replace function public.fn_resolve_location_institution(
  p_council_area text,
  p_lat numeric,
  p_lng numeric
) returns table (match_id uuid, match_method text)
language plpgsql stable
as $$
declare
  v_inst uuid;
begin
  match_id := null;
  match_method := 'none';

  if p_council_area is not null and length(trim(p_council_area)) > 0 then
    select i.id into v_inst
    from public.institutions i
    where i.type = 'municipal'
      and lower(btrim(p_council_area)) = any (
        select lower(btrim(a))
        from jsonb_array_elements_text(coalesce(i.contact->'aliases', '[]'::jsonb)) as a
      )
    limit 1;
    if v_inst is not null then
      match_id := v_inst;
      match_method := 'council_area';
      return;
    end if;
  end if;

  if p_lat is not null and p_lng is not null then
    select i.id into v_inst
    from public.institutions i
    where i.type = 'municipal'
      and jsonb_typeof(i.contact->'bbox') = 'array'
      and p_lat between (i.contact->'bbox'->>0)::numeric and (i.contact->'bbox'->>2)::numeric
      and p_lng between (i.contact->'bbox'->>1)::numeric and (i.contact->'bbox'->>3)::numeric
    order by
      ((i.contact->'bbox'->>2)::numeric - (i.contact->'bbox'->>0)::numeric) *
      ((i.contact->'bbox'->>3)::numeric - (i.contact->'bbox'->>1)::numeric)
    limit 1;
    if v_inst is not null then
      match_id := v_inst;
      match_method := 'bbox';
      return;
    end if;
  end if;
end $$;

create or replace function public.fn_route_complaint(
  p_complaint_id uuid
) returns jsonb
language plpgsql volatile
as $$
declare
  c        public.complaints%rowtype;
  v_cat    public.categories%rowtype;
  v_emerg  text;
  v_inst   uuid;
  v_dept   uuid;
  v_central uuid;
  v_status public.complaint_status := 'received';
  v_reason text;
  v_loc    record;
begin
  select * into c from public.complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint % not found', p_complaint_id;
  end if;

  select id into v_central from public.institutions where code = 'CENTRAL';
  if v_central is null then
    raise exception 'CENTRAL institution missing';
  end if;

  v_emerg := public.fn_check_emergency_keywords(c.title, c.description);
  if v_emerg is not null then
    update public.complaints
       set category_id = (select id from public.categories where slug = v_emerg),
           urgency = 'critical'
     where id = c.id;
    select * into c from public.complaints where id = c.id;
  end if;

  select * into v_cat from public.categories where id = c.category_id;
  if not found then
    raise exception 'complaint % has no category', p_complaint_id;
  end if;

  v_inst := null;
  v_dept := null;
  v_status := 'received';
  v_reason := null;

  if c.ai_confidence is not null and c.ai_confidence < 0.70 then
    v_inst := v_central;
    v_status := 'submitted';
    v_reason := 'low_confidence_central_desk';
  else
    v_inst := v_cat.default_institution_id;
    v_dept := v_cat.default_department_id;
    v_reason := 'category_default';

    if v_inst is not null and (
      select i.type from public.institutions i where i.id = v_inst
    ) = 'municipal' then
      select * into v_loc
      from public.fn_resolve_location_institution(c.council_area, c.lat, c.lng);
      if v_loc.match_id is not null then
        v_inst := v_loc.match_id;
        v_reason := 'location_' || v_loc.match_method;
      end if;
    end if;
  end if;

  if v_cat.is_sensitive and not coalesce(v_cat.is_emergency, false) then
    v_inst := v_central;
    v_dept := null;
    v_status := 'submitted';
    v_reason := 'sensitive_central_desk';
  end if;

  if v_inst is null then
    v_inst := v_central;
    v_status := 'submitted';
    v_reason := 'unrouted_fallback_central';
  end if;

-- routing + is_sensitive written in one update so chk_sensitive_routed never violates mid-flight
  update public.complaints
     set institution_id = v_inst,
         department_id = v_dept,
         status = v_status,
         is_sensitive = coalesce(v_cat.is_sensitive, false) or v_emerg is not null,
         expected_response_at = public.fn_calculate_deadline(c.category_id, c.urgency)
   where id = c.id;

  return jsonb_build_object(
    'institution_id', v_inst,
    'department_id', v_dept,
    'status', v_status,
    'decision', v_reason
  );
end $$;
