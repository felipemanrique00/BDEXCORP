-- BBT Corporativo - production core schema draft
-- Purpose: initial relational SaaS structure for IT review and implementation.
-- This file is additive and does not remove app_kv compatibility.

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  status text not null default 'active',
  legal_name text not null,
  trade_name text,
  document_number text,
  customer_code text,
  contact_name text,
  contact_email text,
  contact_phone text,
  cost_center_default text,
  billing_settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, document_number)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  status text not null default 'active',
  email text not null,
  name text not null,
  phone text,
  avatar_url text,
  locale text not null default 'pt-BR',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, email)
);

create table if not exists user_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  password_updated_at timestamptz,
  must_change_password boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  role_key text not null,
  name text not null,
  description text,
  system_role boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, role_key)
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  module text not null,
  description text
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists company_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid references roles(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, user_id)
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  session_hash text not null unique,
  ip_address inet,
  user_agent text,
  status text not null default 'active',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  status text not null default 'active',
  full_name text not null,
  document_number text,
  email text,
  phone text,
  job_title text,
  department text,
  cost_center text,
  registration_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists requesters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  status text not null default 'active',
  name text not null,
  email text not null,
  phone text,
  department text,
  job_title text,
  cost_center text,
  can_create_demand boolean not null default true,
  can_view_vouchers boolean not null default true,
  can_view_financial boolean not null default false,
  limit_per_request numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, email)
);

create table if not exists hotels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  status text not null default 'active',
  name text not null,
  city text,
  state text,
  country text not null default 'BR',
  phone text,
  email text,
  address text,
  category text,
  billing_enabled boolean not null default false,
  billing_info text,
  amenities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists demands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  requester_id uuid references requesters(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  assigned_to_user_id uuid references users(id) on delete set null,
  demand_number text not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  service_type text not null,
  passenger_name text not null,
  travel_start_date date,
  travel_end_date date,
  destination text,
  cost_center text,
  estimated_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  observations text,
  internal_notes text,
  sla_due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, demand_number)
);

create table if not exists demand_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  demand_id uuid not null references demands(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references users(id) on delete set null,
  message text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  demand_id uuid references demands(id) on delete cascade,
  status text not null default 'pending',
  requested_by uuid references users(id) on delete set null,
  approver_user_id uuid references users(id) on delete set null,
  reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  demand_id uuid references demands(id) on delete set null,
  hotel_id uuid references hotels(id) on delete set null,
  status text not null default 'draft',
  provider text,
  provider_locator text,
  check_in date,
  check_out date,
  guest_name text,
  total_amount numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  demand_id uuid references demands(id) on delete set null,
  reservation_id uuid references reservations(id) on delete set null,
  voucher_code text not null,
  status text not null default 'issued',
  passenger_name text not null,
  service_type text not null,
  supplier_name text,
  start_date date,
  end_date date,
  total_amount numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, voucher_code)
);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  owner_user_id uuid references users(id) on delete set null,
  status text not null default 'active',
  entity_type text,
  entity_id uuid,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_provider text not null default 'local',
  storage_key text not null,
  checksum text,
  sensitive boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists generated_documents_core (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  file_id uuid references files(id) on delete set null,
  entity_type text,
  entity_id uuid,
  document_type text not null,
  status text not null default 'generated',
  title text not null,
  created_by uuid references users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists financial_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  demand_id uuid references demands(id) on delete set null,
  voucher_id uuid references vouchers(id) on delete set null,
  status text not null default 'open',
  entry_type text not null,
  description text not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'BRL',
  due_date date,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  import_type text not null,
  status text not null default 'pending',
  file_id uuid references files(id) on delete set null,
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  failed_rows integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  actor_role text,
  action text not null,
  module text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  channel text not null default 'system',
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists companies_tenant_status_idx on companies (tenant_id, status);
create index if not exists users_tenant_email_idx on users (tenant_id, email);
create index if not exists memberships_company_user_idx on company_memberships (company_id, user_id);
create index if not exists employees_company_name_idx on employees (company_id, full_name);
create index if not exists requesters_company_email_idx on requesters (company_id, email);
create index if not exists hotels_location_idx on hotels (tenant_id, city, state);
create index if not exists demands_company_status_idx on demands (company_id, status, updated_at desc);
create index if not exists demands_sla_idx on demands (tenant_id, sla_due_at) where deleted_at is null;
create index if not exists vouchers_company_code_idx on vouchers (company_id, voucher_code);
create index if not exists financial_company_due_idx on financial_entries (company_id, due_date, status);
create index if not exists audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);
