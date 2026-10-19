-- 0007_rls.sql — row level security policies for all public tables + grants
-- model: anon reads non-sensitive only; citizens own rows; officers own-institution; admin all
alter table public.institutions      enable row level security;
alter table public.departments       enable row level security;
alter table public.profiles          enable row level security;
alter table public.officers          enable row level security;
alter table public.categories        enable row level security;
alter table public.complaint_groups  enable row level security;
alter table public.complaints        enable row level security;
alter table public.complaint_updates enable row level security;
alter table public.notifications     enable row level security;
alter table public.audit_log         enable row level security;

-- anon gets no direct row access here; public reads go through the security-definer functions and views
revoke select on public.complaints        from anon;
revoke select on public.complaint_updates from anon;
revoke select on public.notifications     from anon;
revoke select on public.audit_log         from anon;

create policy "inst_select_all" on public.institutions
  for select using (true);

create policy "inst_admin_write" on public.institutions
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "dept_select_all" on public.departments
  for select using (true);

create policy "dept_admin_write" on public.departments
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "cat_select_all" on public.categories
  for select using (true);

create policy "cat_admin_write" on public.categories
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "prof_select_self_or_admin" on public.profiles
  for select using (
    user_id = auth.uid() or public.fn_is_admin()
  );

create policy "prof_insert_self" on public.profiles
  for insert with check (user_id = auth.uid());

create policy "prof_update_self" on public.profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "officers_select_authenticated" on public.officers
  for select to authenticated using (true);

create policy "officers_admin_all" on public.officers
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "officers_self_update" on public.officers
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "comp_select_admin" on public.complaints
  for select to authenticated
  using (public.fn_is_admin());

create policy "comp_select_officer_own_inst" on public.complaints
  for select to authenticated
  using (
    exists (
      select 1 from public.officers o
      where o.user_id = auth.uid()
        and o.institution_id = complaints.institution_id
    )
  );

create policy "comp_select_citizen_own" on public.complaints
  for select to authenticated
  using (citizen_id = auth.uid());

create policy "comp_insert_citizen" on public.complaints
  for insert to authenticated with check (citizen_id = auth.uid());

create policy "comp_insert_service" on public.complaints
  for insert to service_role with check (true);

create policy "comp_update_officer" on public.complaints
  for update to authenticated
  using (
    public.fn_is_admin() or exists (
      select 1 from public.officers o
      where o.user_id = auth.uid()
        and o.institution_id = complaints.institution_id
    )
  )
  with check (
    public.fn_is_admin() or exists (
      select 1 from public.officers
      where user_id = auth.uid()
        and institution_id = complaints.institution_id
    )
  );

create policy "comp_delete_admin" on public.complaints
  for delete to authenticated using (public.fn_is_admin());

create policy "comp_delete_service" on public.complaints
  for delete to service_role using (true);

-- internal updates (not citizen-visible) are staff-only
create policy "upd_select_staff" on public.complaint_updates
  for select to authenticated
  using (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      join public.officers o
        on o.user_id = auth.uid() and o.institution_id = c.institution_id
      where c.id = complaint_updates.complaint_id
    )
  );

create policy "upd_select_citizen" on public.complaint_updates
  for select to authenticated
  using (
    exists (
      select 1 from public.complaints c
      where c.id = complaint_updates.complaint_id
        and c.citizen_id = auth.uid()
    ) and is_citizen_visible
  );

create policy "upd_insert_staff" on public.complaint_updates
  for insert to authenticated with check (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      join public.officers o
        on o.user_id = auth.uid() and o.institution_id = c.institution_id
      where c.id = complaint_updates.complaint_id
    )
  );

create policy "upd_insert_service" on public.complaint_updates
  for insert to service_role with check (true);

create policy "notif_select_staff" on public.notifications
  for select to authenticated
  using (
    public.fn_is_admin() or exists (
      select 1
      from public.complaints c
      join public.officers o
        on o.user_id = auth.uid() and o.institution_id = c.institution_id
      where c.id = notifications.complaint_id
    )
  );

create policy "notif_insert_service" on public.notifications
  for insert to service_role with check (true);

create policy "notif_update_service" on public.notifications
  for update to service_role using (true) with check (true);

create policy "audit_admin_all" on public.audit_log
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "audit_service_all" on public.audit_log
  for all to service_role using (true) with check (true);

create policy "grp_select_all" on public.complaint_groups
  for select using (true);

create policy "grp_admin_write" on public.complaint_groups
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy "grp_service_write" on public.complaint_groups
  for all to service_role using (true) with check (true);

-- anon allowed on citizen flows: no signup wall
grant execute on function
  public.submit_complaint(text, text, uuid, numeric, public.urgency_level,
                          numeric, numeric, text, text, text, text,
                          public.report_channel, text, text, boolean)
to anon, authenticated;

grant execute on function
  public.confirm_complaint(text, text) to anon, authenticated;
grant execute on function
  public.reopen_complaint(text, text, text) to anon, authenticated;

grant execute on function
  public.fn_officer_accept(uuid),
  public.fn_officer_reject(uuid, text),
  public.fn_officer_request_info(uuid, text),
  public.fn_officer_set_status(uuid, text, text),
  public.fn_officer_note(uuid, text),
  public.fn_officer_forward(uuid, uuid, text),
  public.fn_officer_set_urgency(uuid, text)
to authenticated;

grant execute on function
  public.fn_admin_route(uuid, uuid, uuid, text),
  public.fn_central_desk_queue()
to authenticated;

grant execute on function
  public.fn_run_escalation_sweep(),
  public.fn_run_autoclose_sweep()
to service_role;
