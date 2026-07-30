begin;

update financial_entries
set entry_type = case entry_type
  when 'pagar' then 'payable'
  when 'receber' then 'receivable'
  else entry_type
end
where entry_type in ('pagar', 'receber');

update financial_entries
set status = case status
  when 'pendente' then 'pending'
  when 'pago' then 'paid'
  when 'parcial' then 'partial'
  when 'cancelado' then 'cancelled'
  when 'atrasado' then 'overdue'
  else status
end
where status in ('pendente', 'pago', 'parcial', 'cancelado', 'atrasado');

alter table financial_entries
  add column if not exists settled_amount numeric(14,2) not null default 0,
  add column if not exists issued_on date,
  add column if not exists fingerprint text,
  add column if not exists version bigint not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists updated_by uuid references users(id) on delete set null;

alter table financial_entries
  drop constraint if exists financial_entries_entry_type_check;

alter table financial_entries
  add constraint financial_entries_entry_type_check
  check (entry_type in ('payable', 'receivable'));

alter table financial_entries
  drop constraint if exists financial_entries_status_check;

alter table financial_entries
  add constraint financial_entries_status_check
  check (status in ('pending', 'paid', 'partial', 'cancelled', 'overdue'));

alter table financial_entries
  drop constraint if exists financial_entries_amount_check;

alter table financial_entries
  add constraint financial_entries_amount_check
  check (amount >= 0 and settled_amount >= 0 and settled_amount <= amount);

alter table financial_entries
  drop constraint if exists financial_entries_version_check;

alter table financial_entries
  add constraint financial_entries_version_check check (version > 0);

alter table financial_entries
  drop constraint if exists financial_entries_metadata_shape_check;

alter table financial_entries
  add constraint financial_entries_metadata_shape_check
  check (jsonb_typeof(metadata) = 'object');

alter table financial_entries
  drop constraint if exists financial_entries_soft_delete_status_check;

alter table financial_entries
  add constraint financial_entries_soft_delete_status_check
  check (deleted_at is null or status = 'cancelled');

create unique index if not exists financial_entries_demand_type_uidx
  on financial_entries (tenant_id, demand_id, entry_type)
  where demand_id is not null and deleted_at is null;

create unique index if not exists financial_entries_fingerprint_uidx
  on financial_entries (tenant_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

create index if not exists financial_entries_company_status_due_idx
  on financial_entries (tenant_id, company_id, status, due_date, created_at desc)
  where deleted_at is null;

create index if not exists financial_entries_reservation_idx
  on financial_entries (tenant_id, reservation_id, created_at desc)
  where reservation_id is not null and deleted_at is null;

commit;
