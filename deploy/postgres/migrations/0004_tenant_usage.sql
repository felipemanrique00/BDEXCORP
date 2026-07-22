create table if not exists tenant_usage_monthly (
  tenant_id uuid not null references tenants(id) on delete cascade,
  month_start date not null,
  operations_created integer not null default 0 check (operations_created >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, month_start),
  check (month_start = date_trunc('month', month_start)::date)
);

create index if not exists tenant_usage_monthly_period_idx
  on tenant_usage_monthly (month_start desc, tenant_id);

alter table tenant_usage_monthly enable row level security;
alter table tenant_usage_monthly force row level security;
drop policy if exists tenant_usage_monthly_isolation on tenant_usage_monthly;
create policy tenant_usage_monthly_isolation on tenant_usage_monthly
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
