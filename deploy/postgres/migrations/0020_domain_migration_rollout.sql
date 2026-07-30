begin;

create table if not exists tenant_domain_rollouts (
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain_key text not null,
  read_mode text not null default 'legacy'
    check (read_mode in ('legacy', 'shadow', 'relational')),
  write_mode text not null default 'legacy'
    check (write_mode in ('legacy', 'dual', 'relational')),
  status text not null default 'active'
    check (status in ('active', 'paused')),
  version bigint not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, domain_key),
  check (domain_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  check (read_mode <> 'relational' or write_mode in ('dual', 'relational'))
);

create table if not exists tenant_domain_rollout_companies (
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain_key text not null,
  company_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, domain_key, company_id),
  foreign key (tenant_id, domain_key)
    references tenant_domain_rollouts(tenant_id, domain_key) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete cascade
);

create index if not exists tenant_domain_rollout_companies_company_idx
  on tenant_domain_rollout_companies (tenant_id, company_id, domain_key);

create table if not exists data_migration_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain_key text not null,
  source_key text not null,
  target_table text not null,
  mode text not null check (mode in ('inventory', 'dry_run', 'shadow', 'cutover', 'rollback')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'requires_review', 'rolled_back')),
  source_count bigint not null default 0 check (source_count >= 0),
  target_count bigint not null default 0 check (target_count >= 0),
  source_checksum char(64) check (source_checksum is null or source_checksum ~ '^[0-9a-f]{64}$'),
  target_checksum char(64) check (target_checksum is null or target_checksum ~ '^[0-9a-f]{64}$'),
  discrepancy_count bigint not null default 0 check (discrepancy_count >= 0),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  requested_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null)
  )
);

create index if not exists data_migration_runs_domain_idx
  on data_migration_runs (tenant_id, domain_key, started_at desc);
create index if not exists data_migration_runs_status_idx
  on data_migration_runs (tenant_id, status, started_at desc);

create table if not exists data_migration_discrepancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null,
  entity_key text not null,
  discrepancy_type text not null check (discrepancy_type in (
    'missing_target', 'missing_source', 'checksum_mismatch',
    'invalid_source', 'invalid_relationship', 'duplicate_source', 'write_failure'
  )),
  source_checksum char(64) check (source_checksum is null or source_checksum ~ '^[0-9a-f]{64}$'),
  target_checksum char(64) check (target_checksum is null or target_checksum ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, run_id, entity_key, discrepancy_type),
  foreign key (tenant_id, run_id)
    references data_migration_runs(tenant_id, id) on delete cascade
);

create index if not exists data_migration_discrepancies_run_idx
  on data_migration_discrepancies (tenant_id, run_id, discrepancy_type);

insert into tenant_domain_rollouts (
  tenant_id, domain_key, read_mode, write_mode, status, metadata
)
select
  tenant.id,
  'demands',
  'shadow',
  'dual',
  'active',
  '{"source":"migration-0020","automaticCutover":false}'::jsonb
from tenants tenant
on conflict (tenant_id, domain_key) do nothing;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'tenant_domain_rollouts',
    'tenant_domain_rollout_companies',
    'data_migration_runs',
    'data_migration_discrepancies'
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

drop trigger if exists tenant_domain_rollouts_set_updated_at on tenant_domain_rollouts;
create trigger tenant_domain_rollouts_set_updated_at
before update on tenant_domain_rollouts for each row execute function set_updated_at();

commit;
