create table if not exists business_groups (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text,
  document_number text,
  description text,
  contact_name text,
  contact_email citext,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id)
);

create table if not exists companies (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  group_id text,
  legal_name text not null,
  trade_name text,
  document_number text,
  customer_code text,
  contact_name text,
  contact_email citext,
  contact_phone text,
  default_cost_center text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  billing_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_settings) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, group_id) references business_groups(tenant_id, id) on delete restrict
);

create unique index if not exists companies_document_uidx
  on companies (tenant_id, document_number) where document_number is not null and deleted_at is null;
create index if not exists companies_group_idx on companies (tenant_id, group_id, status);

create table if not exists employees (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  identification_code text not null,
  full_name text not null,
  document_number text,
  email citext,
  phone text,
  job_title text,
  department text,
  cost_center text,
  registration_code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, identification_code),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict
);

create unique index if not exists employees_document_uidx
  on employees (tenant_id, document_number) where document_number is not null and deleted_at is null;
create index if not exists employees_company_name_idx on employees (tenant_id, company_id, full_name);
create index if not exists employees_cost_center_idx on employees (tenant_id, company_id, cost_center);

create table if not exists employee_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null,
  normalized_alias text not null,
  original_alias text not null,
  source text not null,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confirmed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, normalized_alias),
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete cascade
);

create index if not exists employee_aliases_employee_idx on employee_aliases (tenant_id, employee_id);

create table if not exists requesters (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  employee_id text,
  user_id uuid references users(id) on delete set null,
  name text not null,
  email citext not null,
  phone text,
  department text,
  job_title text,
  cost_center text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  request_limit numeric(14,2) not null default 0 check (request_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, company_id, email),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict
);

create table if not exists hotels (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  city text,
  state text,
  country text not null default 'BR',
  phone text,
  email citext,
  address text,
  category text,
  billing_enabled boolean not null default false,
  billing_info text,
  amenities jsonb not null default '{}'::jsonb check (jsonb_typeof(amenities) = 'object'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id)
);

create index if not exists hotels_location_idx on hotels (tenant_id, city, state, status);

create table if not exists demands (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  requester_id text,
  employee_id text,
  assigned_to_user_id uuid references users(id) on delete set null,
  demand_number text not null,
  service_type text not null,
  passenger_name_snapshot text not null,
  status text not null,
  priority text not null default 'normal',
  travel_start_date date,
  travel_end_date date,
  destination text,
  cost_center text,
  estimated_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  observations text,
  internal_notes text,
  sla_due_at timestamptz,
  version bigint not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, demand_number),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, requester_id) references requesters(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  check (travel_end_date is null or travel_start_date is null or travel_end_date >= travel_start_date)
);

create index if not exists demands_company_status_idx on demands (tenant_id, company_id, status, updated_at desc);
create index if not exists demands_employee_idx on demands (tenant_id, employee_id, created_at desc);
create index if not exists demands_sla_idx on demands (tenant_id, sla_due_at) where deleted_at is null;

create table if not exists demand_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade
);

create index if not exists demand_events_demand_idx on demand_events (tenant_id, demand_id, created_at desc);

create table if not exists approvals (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  approver_user_id uuid references users(id) on delete set null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade
);

create table if not exists reservations (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text,
  company_id text not null,
  employee_id text,
  provider text not null,
  provider_reference text,
  idempotency_key text,
  status text not null,
  service_type text not null,
  passenger_name_snapshot text not null,
  start_at timestamptz,
  end_at timestamptz,
  gross_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  currency char(3) not null default 'BRL',
  provider_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, provider_reference),
  unique (tenant_id, provider, idempotency_key),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  check (end_at is null or start_at is null or end_at >= start_at)
);

create index if not exists reservations_company_status_idx on reservations (tenant_id, company_id, status, created_at desc);
create index if not exists reservations_employee_idx on reservations (tenant_id, employee_id, created_at desc);

create table if not exists vouchers (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  reservation_id text,
  demand_id text,
  company_id text not null,
  employee_id text,
  voucher_code text not null,
  status text not null,
  file_id uuid,
  issued_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, voucher_code),
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, file_id) references stored_files(tenant_id, id) on delete restrict
);

create table if not exists financial_entries (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  demand_id text,
  reservation_id text,
  entry_type text not null,
  status text not null,
  amount numeric(14,2) not null,
  currency char(3) not null default 'BRL',
  due_date date,
  settled_at timestamptz,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict
);

create index if not exists financial_entries_due_idx on financial_entries (tenant_id, company_id, due_date, status);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid references users(id) on delete set null,
  source text not null,
  file_id uuid,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  idempotency_key text,
  total_rows integer not null default 0 check (total_rows >= 0),
  processed_rows integer not null default 0 check (processed_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  error_code text,
  error_message text,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, source, idempotency_key),
  foreign key (tenant_id, file_id) references stored_files(tenant_id, id) on delete restrict
);

create index if not exists import_jobs_status_idx on import_jobs (tenant_id, status, created_at desc);

create or replace function tenant_rls_policy(table_name text)
returns void
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', table_name);
  execute format('alter table %I force row level security', table_name);
  execute format('drop policy if exists tenant_isolation on %I', table_name);
  execute format(
    'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
    table_name
  );
end;
$$;

select tenant_rls_policy('business_groups');
select tenant_rls_policy('companies');
select tenant_rls_policy('employees');
select tenant_rls_policy('employee_aliases');
select tenant_rls_policy('requesters');
select tenant_rls_policy('hotels');
select tenant_rls_policy('demands');
select tenant_rls_policy('demand_events');
select tenant_rls_policy('approvals');
select tenant_rls_policy('reservations');
select tenant_rls_policy('vouchers');
select tenant_rls_policy('financial_entries');
select tenant_rls_policy('import_jobs');

drop function tenant_rls_policy(text);

drop trigger if exists business_groups_set_updated_at on business_groups;
create trigger business_groups_set_updated_at before update on business_groups for each row execute function set_updated_at();
drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at before update on companies for each row execute function set_updated_at();
drop trigger if exists employees_set_updated_at on employees;
create trigger employees_set_updated_at before update on employees for each row execute function set_updated_at();
drop trigger if exists requesters_set_updated_at on requesters;
create trigger requesters_set_updated_at before update on requesters for each row execute function set_updated_at();
drop trigger if exists hotels_set_updated_at on hotels;
create trigger hotels_set_updated_at before update on hotels for each row execute function set_updated_at();
drop trigger if exists demands_set_updated_at on demands;
create trigger demands_set_updated_at before update on demands for each row execute function set_updated_at();
drop trigger if exists approvals_set_updated_at on approvals;
create trigger approvals_set_updated_at before update on approvals for each row execute function set_updated_at();
drop trigger if exists reservations_set_updated_at on reservations;
create trigger reservations_set_updated_at before update on reservations for each row execute function set_updated_at();
drop trigger if exists vouchers_set_updated_at on vouchers;
create trigger vouchers_set_updated_at before update on vouchers for each row execute function set_updated_at();
drop trigger if exists financial_entries_set_updated_at on financial_entries;
create trigger financial_entries_set_updated_at before update on financial_entries for each row execute function set_updated_at();
