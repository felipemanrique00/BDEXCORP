begin;

create table if not exists integration_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider_key text not null,
  name text not null,
  provider_type text not null
    check (provider_type in ('consolidator', 'operator', 'direct_supplier', 'ota', 'gds', 'other')),
  services text[] not null default '{}'::text[],
  capabilities text[] not null default '{}'::text[],
  mode text not null check (mode in ('api', 'assisted_portal', 'email', 'manual')),
  status text not null check (status in ('active', 'pending_configuration', 'inactive', 'failed')),
  priority integer not null default 50 check (priority between 0 and 1000),
  portal_url text,
  api_base_url text,
  auth_type text not null check (auth_type in ('none', 'api_key', 'bearer', 'basic', 'oauth2', 'portal')),
  base_url_env_name text,
  credential_env_name text,
  support_contact text,
  notes text,
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  system_managed boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  check (provider_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  check (length(trim(name)) between 2 and 200),
  check (cardinality(services) > 0),
  check (
    base_url_env_name is null
    or base_url_env_name ~ '^[A-Z][A-Z0-9_]{2,119}$'
  ),
  check (
    credential_env_name is null
    or credential_env_name ~ '^[A-Z][A-Z0-9_]{2,119}$'
  )
);

create unique index if not exists integration_providers_active_key_uidx
  on integration_providers (tenant_id, provider_key)
  where deleted_at is null;

create index if not exists integration_providers_status_priority_idx
  on integration_providers (tenant_id, status, priority desc, name)
  where deleted_at is null;

create table if not exists integration_action_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  provider_id uuid,
  provider_key text not null,
  provider_name text not null,
  action text not null,
  service text,
  status text not null check (status in ('success', 'pending', 'failure')),
  message text not null,
  endpoint text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  payload_redacted jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload_redacted) = 'object'),
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, provider_id)
    references integration_providers(tenant_id, id) on delete restrict,
  check (length(trim(provider_key)) between 2 and 80),
  check (length(trim(provider_name)) between 2 and 200),
  check (length(trim(action)) between 2 and 80),
  check (length(trim(message)) between 1 and 2000)
);

create index if not exists integration_action_logs_provider_created_idx
  on integration_action_logs (tenant_id, provider_key, created_at desc);

create index if not exists integration_action_logs_company_created_idx
  on integration_action_logs (tenant_id, company_id, created_at desc)
  where company_id is not null;

select tenant_rls_policy('integration_providers');
select tenant_rls_policy('integration_action_logs');

drop trigger if exists integration_providers_set_updated_at
  on integration_providers;
create trigger integration_providers_set_updated_at
before update on integration_providers
for each row execute function set_updated_at();

create or replace function prevent_integration_action_log_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.tenant_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Logs de integracao publicados sao imutaveis.';
end;
$$;

drop trigger if exists integration_action_logs_immutable
  on integration_action_logs;
create trigger integration_action_logs_immutable
before update or delete on integration_action_logs
for each row execute function prevent_integration_action_log_mutation();

commit;
