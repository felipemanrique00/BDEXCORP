create table if not exists currencies (
  code char(3) primary key,
  name text not null,
  numeric_code char(3),
  minor_units smallint not null default 2 check (minor_units between 0 and 6),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into currencies (code, name, numeric_code, minor_units) values
  ('BRL', 'Real brasileiro', '986', 2),
  ('USD', 'Dolar americano', '840', 2),
  ('EUR', 'Euro', '978', 2),
  ('GBP', 'Libra esterlina', '826', 2)
on conflict (code) do update set
  name = excluded.name,
  numeric_code = excluded.numeric_code,
  minor_units = excluded.minor_units;

create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  base_currency char(3) not null references currencies(code) on delete restrict,
  quote_currency char(3) not null references currencies(code) on delete restrict,
  rate numeric(24,10) not null check (rate > 0),
  source text not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, base_currency, quote_currency, source, effective_at),
  check (base_currency <> quote_currency),
  check (expires_at is null or expires_at > effective_at)
);

create index if not exists exchange_rates_lookup_idx
  on exchange_rates (tenant_id, base_currency, quote_currency, effective_at desc);

create table if not exists business_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  working_days smallint[] not null default '{1,2,3,4,5}',
  workday_start time not null default '08:00',
  workday_end time not null default '18:00',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  check (workday_end > workday_start),
  check (working_days <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  calendar_id uuid not null,
  holiday_date date not null,
  name text not null,
  partial_day boolean not null default false,
  starts_at time,
  ends_at time,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, calendar_id, holiday_date, name),
  foreign key (tenant_id, calendar_id)
    references business_calendars(tenant_id, id) on delete cascade,
  check (
    (not partial_day and starts_at is null and ends_at is null)
    or (partial_day and starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

create table if not exists organizational_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  parent_id uuid,
  unit_type text not null check (unit_type in ('branch', 'department', 'division', 'community', 'other')),
  code text not null,
  name text not null,
  timezone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, company_id, code),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, parent_id) references organizational_units(tenant_id, id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);

create index if not exists organizational_units_company_idx
  on organizational_units (tenant_id, company_id, status, unit_type);

create table if not exists cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  organizational_unit_id uuid,
  parent_id uuid,
  code text not null,
  name text not null,
  manager_user_id uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, company_id, code),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, organizational_unit_id) references organizational_units(tenant_id, id) on delete restrict,
  foreign key (tenant_id, parent_id) references cost_centers(tenant_id, id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);

create index if not exists cost_centers_company_idx
  on cost_centers (tenant_id, company_id, status, code);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  code text not null,
  name text not null,
  owner_user_id uuid references users(id) on delete set null,
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('planned', 'active', 'completed', 'cancelled', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, company_id, code),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  cost_center_id uuid,
  project_id uuid,
  name text not null,
  period_start date not null,
  period_end date not null,
  currency char(3) not null default 'BRL' references currencies(code) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  committed_amount numeric(18,2) not null default 0 check (committed_amount >= 0),
  consumed_amount numeric(18,2) not null default 0 check (consumed_amount >= 0),
  version bigint not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('draft', 'active', 'closed', 'cancelled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, cost_center_id) references cost_centers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  check (period_end >= period_start),
  check (committed_amount + consumed_amount <= amount)
);

create index if not exists budgets_scope_period_idx
  on budgets (tenant_id, company_id, cost_center_id, project_id, period_start, period_end, status);

create table if not exists budget_commitments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  budget_id uuid not null,
  demand_id text,
  reservation_id text,
  idempotency_key text not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null references currencies(code) on delete restrict,
  status text not null check (status in ('held', 'committed', 'released', 'cancelled')),
  held_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, budget_id) references budgets(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict
);

alter table business_groups
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'exchange_rates',
    'business_calendars',
    'calendar_holidays',
    'organizational_units',
    'cost_centers',
    'projects',
    'budgets',
    'budget_commitments'
  ] loop
    execute format('alter table %I enable row level security', target_table);
    execute format('alter table %I force row level security', target_table);
    execute format('drop policy if exists tenant_isolation on %I', target_table);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      target_table
    );
  end loop;
end;
$$;

drop trigger if exists currencies_set_updated_at on currencies;
create trigger currencies_set_updated_at before update on currencies for each row execute function set_updated_at();
drop trigger if exists business_calendars_set_updated_at on business_calendars;
create trigger business_calendars_set_updated_at before update on business_calendars for each row execute function set_updated_at();
drop trigger if exists organizational_units_set_updated_at on organizational_units;
create trigger organizational_units_set_updated_at before update on organizational_units for each row execute function set_updated_at();
drop trigger if exists cost_centers_set_updated_at on cost_centers;
create trigger cost_centers_set_updated_at before update on cost_centers for each row execute function set_updated_at();
drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at before update on projects for each row execute function set_updated_at();
drop trigger if exists budgets_set_updated_at on budgets;
create trigger budgets_set_updated_at before update on budgets for each row execute function set_updated_at();
drop trigger if exists budget_commitments_set_updated_at on budget_commitments;
create trigger budget_commitments_set_updated_at before update on budget_commitments for each row execute function set_updated_at();
