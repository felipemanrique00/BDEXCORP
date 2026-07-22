create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  entitlements jsonb not null default '{}'::jsonb check (jsonb_typeof(entitlements) = 'object'),
  max_users integer check (max_users is null or max_users > 0),
  max_storage_bytes bigint check (max_storage_bytes is null or max_storage_bytes > 0),
  max_monthly_operations integer check (max_monthly_operations is null or max_monthly_operations > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  status text not null default 'active' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  trial_ends_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_subscriptions (
  tenant_id uuid primary key references tenants(id) on delete restrict,
  plan_id uuid not null references plans(id) on delete restrict,
  status text not null default 'active' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  cancelled_at timestamptz,
  billing_mode text not null default 'manual' check (billing_mode in ('manual', 'provider')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null,
  phone text,
  avatar_url text,
  locale text not null default 'pt-BR',
  status text not null default 'active' check (status in ('invited', 'active', 'blocked', 'inactive')),
  platform_admin boolean not null default false,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists user_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  password_updated_at timestamptz not null default now(),
  must_change_password boolean not null default false,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
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
  updated_at timestamptz not null default now()
);

create unique index if not exists roles_scope_key_uidx
  on roles (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), role_key);

create table if not exists permissions (
  permission_key text primary key,
  module text not null,
  description text not null
);

insert into permissions (permission_key, module, description) values
  ('ver_financeiro', 'financeiro', 'Visualizar dados financeiros'),
  ('editar_financeiro', 'financeiro', 'Criar e alterar dados financeiros'),
  ('cadastrar_empresas', 'cadastros', 'Gerenciar empresas e grupos'),
  ('cadastrar_funcionarios', 'cadastros', 'Gerenciar funcionarios e viajantes'),
  ('cadastrar_hoteis', 'cadastros', 'Gerenciar cadastro de hoteis'),
  ('editar_politicas', 'governanca', 'Gerenciar politicas corporativas'),
  ('gerar_relatorios', 'inteligencia', 'Acessar e exportar relatorios'),
  ('importar_planilhas', 'integracoes', 'Executar importacoes'),
  ('ver_produtividade_todos', 'operacao', 'Visualizar produtividade da equipe'),
  ('gerenciar_usuarios', 'administracao', 'Gerenciar usuarios e permissoes'),
  ('excluir_demandas', 'operacao', 'Excluir demandas com auditoria'),
  ('aprovar_demandas', 'operacao', 'Aprovar ou rejeitar demandas')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(permission_key) on delete restrict,
  allowed boolean not null default true,
  primary key (role_id, permission_key)
);

create table if not exists tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete restrict,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'inactive')),
  profile_key text,
  custom_permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_permissions) = 'object'),
  company_id text,
  allowed_company_ids text[] not null default '{}',
  allowed_group_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists tenant_memberships_user_idx on tenant_memberships (user_id, status);
create index if not exists tenant_memberships_tenant_status_idx on tenant_memberships (tenant_id, status);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  ip_address inet,
  user_agent text,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create index if not exists user_sessions_lookup_idx on user_sessions (token_hash, status, expires_at);
create index if not exists user_sessions_user_idx on user_sessions (user_id, status, expires_at desc);

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip inet,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx on password_reset_tokens (user_id, created_at desc);

create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists rate_limit_buckets (
  bucket_key text not null,
  identity_hash text not null,
  count integer not null default 1 check (count > 0),
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (bucket_key, identity_hash)
);

create index if not exists rate_limit_buckets_expiry_idx on rate_limit_buckets (expires_at);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete restrict,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  result text not null check (result in ('success', 'denied', 'failure')),
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);
create index if not exists audit_logs_actor_created_idx on audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_entity_idx on audit_logs (tenant_id, entity_type, entity_id, created_at desc);

create table if not exists app_kv (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  value jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create index if not exists app_kv_tenant_updated_idx on app_kv (tenant_id, updated_at desc);

create table if not exists stored_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  uploaded_by uuid references users(id) on delete set null,
  purpose text not null,
  entity_type text,
  entity_id text,
  original_name text not null,
  storage_key text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'quarantined', 'deleted')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id)
);

create index if not exists stored_files_entity_idx on stored_files (tenant_id, entity_type, entity_id, created_at desc);
create index if not exists stored_files_tenant_status_idx on stored_files (tenant_id, status, created_at desc);

create table if not exists idempotency_keys (
  tenant_id uuid not null references tenants(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, operation, idempotency_key)
);

create index if not exists idempotency_keys_expiry_idx on idempotency_keys (expires_at);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_set_updated_at on plans;
create trigger plans_set_updated_at before update on plans for each row execute function set_updated_at();
drop trigger if exists tenants_set_updated_at on tenants;
create trigger tenants_set_updated_at before update on tenants for each row execute function set_updated_at();
drop trigger if exists subscriptions_set_updated_at on tenant_subscriptions;
create trigger subscriptions_set_updated_at before update on tenant_subscriptions for each row execute function set_updated_at();
drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at before update on users for each row execute function set_updated_at();
drop trigger if exists credentials_set_updated_at on user_credentials;
create trigger credentials_set_updated_at before update on user_credentials for each row execute function set_updated_at();
drop trigger if exists roles_set_updated_at on roles;
create trigger roles_set_updated_at before update on roles for each row execute function set_updated_at();
drop trigger if exists memberships_set_updated_at on tenant_memberships;
create trigger memberships_set_updated_at before update on tenant_memberships for each row execute function set_updated_at();
drop trigger if exists app_kv_set_updated_at on app_kv;
create trigger app_kv_set_updated_at before update on app_kv for each row execute function set_updated_at();
drop trigger if exists idempotency_set_updated_at on idempotency_keys;
create trigger idempotency_set_updated_at before update on idempotency_keys for each row execute function set_updated_at();

alter table app_kv enable row level security;
alter table app_kv force row level security;
drop policy if exists app_kv_tenant_isolation on app_kv;
create policy app_kv_tenant_isolation on app_kv
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table stored_files enable row level security;
alter table stored_files force row level security;
drop policy if exists stored_files_tenant_isolation on stored_files;
create policy stored_files_tenant_isolation on stored_files
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
drop policy if exists idempotency_keys_tenant_isolation on idempotency_keys;
create policy idempotency_keys_tenant_isolation on idempotency_keys
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
