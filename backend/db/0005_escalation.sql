-- ============================================================================
-- GamCiv AI — 0005_escalation.sql
-- Officer forward/urgency RPCs, escalation sweep, auto-close sweep
-- ============================================================================

-- ---------------------------------------------------------------------------
-- OFFICER RPC: forward to another institution (reason REQUIRED).
-- BLUEPRINT §8: status -> forwarded; target becomes new owner; audit row.
-- ---------------------------------------------------------------------------
create or replace function public.fn_officer_forward(
  p_complaint_id uuid,
  p_institution_id uuid,
  p_reason text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
  v_target public.institutions%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then
    return false;
  end if;

  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into v_target from public.institutions where id = p_institution_id;
  if not found then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if c.status not in ('submitted','received','assigned','in_progress','waiting_info','escalated') then
    return false;
  end if;

  if c.institution_id = v_target.id then
    return false;  -- forwarding to self is a no-op
  end if;

  update public.complaints
     set institution_id = v_target.id,
         department_id  = null,      -- receiving institution assigns its own
         officer_id     = null,
         status         = 'forwarded',
         expected_response_at = public.fn_calculate_deadline(c.category_id, c.urgency)
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation, citizen_message, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'forward',
    c.status, 'forwarded',
    'Forwarded to ' || v_target.name || ': ' || btrim(p_reason),
    'Your report ' || c.tracking_no || ' has been forwarded to ' || v_target.name ||
      ' for handling.', true
  );

  perform public.fn_notify_citizen(
    c.id,
    'Your report ' || c.tracking_no || ' has been forwarded to ' || v_target.name || '.'
  );

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- OFFICER RPC: change urgency (recomputes SLA deadline)
-- ---------------------------------------------------------------------------
create or replace function public.fn_officer_set_urgency(
  p_complaint_id uuid,
  p_urgency text
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
  v_new public.urgency_level;
begin
  v_new := p_urgency::public.urgency_level;  -- raises if invalid

  if not public.fn_is_officer_of(p_complaint_id) then
    return false;
  end if;

  select * into c from public.complaints where id = p_complaint_id;
  if c.status in ('closed','rejected') then
    return false;
  end if;

  update public.complaints
     set urgency = v_new,
         expected_response_at = public.fn_calculate_deadline(c.category_id, v_new)
   where id = c.id;

  insert into public.complaint_updates (
    complaint_id, actor_id, actor_label, update_type,
    status_from, status_to, explanation, is_citizen_visible
  ) values (
    c.id, auth.uid(), 'officer', 'urgency',
    c.status, c.status,
    'Urgency changed ' || c.urgency::text || ' -> ' || v_new::text ||
      '; deadline recomputed.', false
  );

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- ESCALATION SWEEP (runs via pg_cron / n8n every 15 min)
-- open statuses + deadline passed -> escalated; notify officer + citizen
-- ---------------------------------------------------------------------------
create or replace function public.fn_run_escalation_sweep()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, tracking_no, urgency, expected_response_at, group_id
    from public.complaints
    where status in ('received','assigned','in_progress','waiting_info')
      and expected_response_at is not null
      and expected_response_at < now()
  loop
    update public.complaints
       set status = 'escalated'
     where id = r.id;

    insert into public.complaint_updates (
      complaint_id, actor_label, update_type,
      status_from, status_to, explanation, is_citizen_visible
    ) values (
      r.id, 'system', 'escalation',
      null, 'escalated',
      'Deadline passed (' || r.expected_response_at::text || ') — auto-escalated.',
      true
    );

    -- notify citizens in the same group too (group updates)
    perform public.fn_notify_citizen(
      r.id,
      'Your report ' || r.tracking_no ||
      ' passed its expected response time. It has been escalated. Reference kept.'
    );
    if r.group_id is not null then
      perform public.fn_notify_group(
        r.group_id,
        'An update on an incident near you: a related report was escalated.'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- AUTO-CLOSE SWEEP (runs daily): cases resolved but unconfirmed for 72h are
-- closed by the system (BLUEPRINT: "no response in 72h → closed, actor system")
-- ---------------------------------------------------------------------------
create or replace function public.fn_run_autoclose_sweep()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, tracking_no
    from public.complaints
    where status in ('citizen_confirmation','resolved')
      and resolved_at is not null
      and resolved_at < now() - interval '72 hours'
  loop
    update public.complaints
       set status = 'closed', closed_at = now()
     where id = r.id;

    insert into public.complaint_updates (
      complaint_id, actor_label, update_type,
      status_from, status_to, explanation, citizen_message, is_citizen_visible
    ) values (
      r.id, 'system', 'status',
      null, 'closed',
      'Auto-closed after 72h without citizen response.',
      'No response received, so your report ' || r.tracking_no ||
        ' has been closed. Thank you.', true
    );

    perform public.fn_notify_citizen(
      r.id,
      'No response received for your report ' || r.tracking_no ||
      ', so it has been closed. Thank you.'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
