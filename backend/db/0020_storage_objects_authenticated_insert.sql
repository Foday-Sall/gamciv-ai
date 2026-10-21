-- 0020_storage_objects_authenticated_insert.sql
-- Authenticated Storage API clients need the table-level INSERT privilege.
-- Upload authorization remains enforced by complaint-photo row-level policies.

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and c.relrowsecurity
  ) then
    raise exception 'storage.objects RLS must be enabled before granting INSERT to authenticated';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'photos_insert'
      and p.cmd = 'INSERT'
  ) then
    raise exception 'the complaint-photo photos_insert RLS policy must exist before granting INSERT';
  end if;
end
$migration$;

grant insert on table storage.objects to authenticated;
