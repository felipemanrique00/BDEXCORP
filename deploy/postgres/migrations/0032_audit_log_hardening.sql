begin;

create unique index if not exists audit_logs_legacy_source_uidx
  on audit_logs (tenant_id, (metadata->>'legacyId'))
  where tenant_id is not null
    and metadata->>'source' = 'app_kv:bbt-auditoria'
    and nullif(metadata->>'legacyId', '') is not null;

alter table audit_logs enable row level security;
alter table audit_logs force row level security;

drop policy if exists tenant_isolation on audit_logs;
drop policy if exists audit_logs_tenant_read on audit_logs;
drop policy if exists audit_logs_tenant_insert on audit_logs;
drop policy if exists audit_logs_tenant_delete on audit_logs;

create policy audit_logs_tenant_read on audit_logs
  for select
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy audit_logs_tenant_insert on audit_logs
  for insert
  with check (
    tenant_id is null
    or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create policy audit_logs_tenant_delete on audit_logs
  for delete
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

create or replace function prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.tenant_reset', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'A trilha de auditoria e imutavel.';
end;
$$;

drop trigger if exists audit_logs_immutable on audit_logs;
create trigger audit_logs_immutable
before update or delete on audit_logs
for each row execute function prevent_audit_log_mutation();

commit;
