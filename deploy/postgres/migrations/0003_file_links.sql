create table if not exists stored_file_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  file_id uuid not null,
  entity_type text not null check (entity_type in ('demand', 'employee', 'company', 'voucher', 'import')),
  entity_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, file_id, entity_type, entity_id),
  foreign key (tenant_id, file_id) references stored_files(tenant_id, id) on delete cascade
);

create index if not exists stored_file_links_entity_idx
  on stored_file_links (tenant_id, entity_type, entity_id, created_at desc);

alter table stored_file_links enable row level security;
alter table stored_file_links force row level security;
drop policy if exists stored_file_links_tenant_isolation on stored_file_links;
create policy stored_file_links_tenant_isolation on stored_file_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
