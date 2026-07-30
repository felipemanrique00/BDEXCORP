begin;

create table if not exists integration_actor_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider_key text not null,
  external_actor_code text not null,
  user_id uuid not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_key, external_actor_code),
  foreign key (tenant_id, user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  check (provider_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  check (length(trim(external_actor_code)) between 1 and 120),
  check (external_actor_code = upper(external_actor_code)),
  check (external_actor_code !~ '[[:cntrl:]]')
);

create index if not exists integration_actor_mappings_user_idx
  on integration_actor_mappings (tenant_id, user_id, provider_key)
  where status = 'active';

create index if not exists integration_actor_mappings_provider_idx
  on integration_actor_mappings (tenant_id, provider_key, status, external_actor_code);

select tenant_rls_policy('integration_actor_mappings');

drop trigger if exists integration_actor_mappings_set_updated_at
  on integration_actor_mappings;
create trigger integration_actor_mappings_set_updated_at
before update on integration_actor_mappings
for each row execute function set_updated_at();

commit;
