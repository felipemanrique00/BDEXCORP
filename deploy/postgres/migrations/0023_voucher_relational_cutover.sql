begin;

update vouchers
set status = case status
  when 'rascunho' then 'draft'
  when 'emitido' then 'issued'
  when 'confirmado' then 'confirmed'
  when 'cancelado' then 'cancelled'
  else status
end
where status in ('rascunho', 'emitido', 'confirmado', 'cancelado');

alter table vouchers
  add column if not exists fingerprint text,
  add column if not exists version bigint not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists updated_by uuid references users(id) on delete set null;

alter table vouchers
  drop constraint if exists vouchers_status_check;

alter table vouchers
  add constraint vouchers_status_check
  check (status in ('draft', 'issued', 'confirmed', 'cancelled'));

alter table vouchers
  drop constraint if exists vouchers_version_check;

alter table vouchers
  add constraint vouchers_version_check check (version > 0);

alter table vouchers
  drop constraint if exists vouchers_metadata_shape_check;

alter table vouchers
  add constraint vouchers_metadata_shape_check
  check (jsonb_typeof(metadata) = 'object');

alter table vouchers
  drop constraint if exists vouchers_soft_delete_status_check;

alter table vouchers
  add constraint vouchers_soft_delete_status_check
  check (deleted_at is null or status = 'cancelled');

create unique index if not exists vouchers_fingerprint_uidx
  on vouchers (tenant_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

create index if not exists vouchers_company_status_idx
  on vouchers (tenant_id, company_id, status, issued_at desc, created_at desc)
  where deleted_at is null;

create index if not exists vouchers_demand_idx
  on vouchers (tenant_id, demand_id, created_at desc)
  where demand_id is not null and deleted_at is null;

create index if not exists vouchers_employee_idx
  on vouchers (tenant_id, employee_id, created_at desc)
  where employee_id is not null and deleted_at is null;

commit;
