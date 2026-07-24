begin;

create unique index if not exists import_jobs_tenant_id_uidx
  on import_jobs (tenant_id, id);

create table if not exists import_job_entity_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  import_job_id uuid not null,
  entity_type text not null check (entity_type in ('demand')),
  entity_id text not null,
  operation text not null check (operation in ('insert', 'update')),
  before_version bigint,
  after_version bigint not null check (after_version > 0),
  before_data jsonb,
  after_data jsonb not null check (jsonb_typeof(after_data) = 'object'),
  rolled_back_at timestamptz,
  rolled_back_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, import_job_id, entity_type, entity_id),
  foreign key (tenant_id, import_job_id) references import_jobs(tenant_id, id) on delete cascade,
  check (
    (operation = 'insert' and before_version is null and before_data is null)
    or
    (
      operation = 'update'
      and before_version is not null
      and before_version > 0
      and jsonb_typeof(before_data) = 'object'
    )
  ),
  check ((rolled_back_at is null) = (rolled_back_by is null))
);

create index if not exists import_job_entity_snapshots_job_idx
  on import_job_entity_snapshots (tenant_id, import_job_id, entity_type, entity_id);

select tenant_rls_policy('import_job_entity_snapshots');

commit;
