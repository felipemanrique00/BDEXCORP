begin;

create table if not exists tenant_ai_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, updated_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists report_snapshots (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  snapshot_type text not null default 'executive_dashboard'
    check (snapshot_type in ('executive_dashboard')),
  period_label text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source text not null default 'dashboard'
    check (source in ('dashboard', 'legacy_import')),
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(period_label)) between 1 and 200)
);

create unique index if not exists report_snapshots_legacy_uidx
  on report_snapshots (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists report_snapshots_owner_idx
  on report_snapshots (tenant_id, owner_user_id, created_at desc);

select tenant_rls_policy('tenant_ai_settings');
select tenant_rls_policy('report_snapshots');

drop trigger if exists tenant_ai_settings_set_updated_at on tenant_ai_settings;
create trigger tenant_ai_settings_set_updated_at
before update on tenant_ai_settings
for each row execute function set_updated_at();

drop trigger if exists report_snapshots_set_updated_at on report_snapshots;
create trigger report_snapshots_set_updated_at
before update on report_snapshots
for each row execute function set_updated_at();

commit;
