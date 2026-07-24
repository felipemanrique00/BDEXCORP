begin;

create table if not exists assistant_agent_runs (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  company_id text,
  input text not null,
  intent text not null,
  status text not null check (status in ('concluido', 'pendente', 'falhou')),
  summary text not null,
  plan jsonb not null default '[]'::jsonb check (jsonb_typeof(plan) = 'array'),
  created_entities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(created_entities) = 'array'),
  blocked_by jsonb not null default '[]'::jsonb check (jsonb_typeof(blocked_by) = 'array'),
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(input)) between 1 and 12000),
  check (length(trim(intent)) between 1 and 100),
  check (length(trim(summary)) between 1 and 4000)
);

create unique index if not exists assistant_agent_runs_legacy_uidx
  on assistant_agent_runs (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists assistant_agent_runs_scope_idx
  on assistant_agent_runs (tenant_id, company_id, created_at desc);

create table if not exists assistant_agent_tasks (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  company_id text,
  kind text not null check (kind in (
    'cotacao', 'aprovacao', 'emissao', 'reserva_hotel', 'reserva_aereo',
    'reserva_carro', 'voucher', 'monitoramento', 'emergencia',
    'financeiro', 'notificacao', 'integracao_externa'
  )),
  title text not null,
  description text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  priority text not null check (priority in ('baixa', 'media', 'alta', 'urgente')),
  requires_human boolean not null default true,
  entity_type text check (entity_type in (
    'atendimento', 'voucher', 'empresa', 'funcionario', 'hotel', 'cotacao'
  )),
  entity_id text,
  due_at timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1 check (version > 0),
  completed_by_user_id uuid references users(id) on delete restrict,
  completed_at timestamptz,
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, completed_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(title)) between 1 and 300),
  check (length(trim(description)) between 1 and 4000),
  check ((entity_type is null) = (entity_id is null)),
  check (
    (status = 'concluida' and completed_at is not null and completed_by_user_id is not null)
    or (status <> 'concluida' and completed_at is null)
  )
);

create unique index if not exists assistant_agent_tasks_legacy_uidx
  on assistant_agent_tasks (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists assistant_agent_tasks_queue_idx
  on assistant_agent_tasks (tenant_id, company_id, status, priority, created_at desc);

create table if not exists assistant_agent_memories (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  company_id text,
  entity_type text not null check (entity_type in (
    'funcionario', 'empresa', 'hotel', 'fornecedor', 'sistema'
  )),
  entity_id text not null,
  memory_key text not null,
  value text not null,
  source text not null,
  confidence text not null check (confidence in ('alta', 'media', 'baixa')),
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  unique (tenant_id, entity_type, entity_id, memory_key),
  check (length(trim(id)) between 2 and 200),
  check (length(trim(entity_id)) between 1 and 200),
  check (length(trim(memory_key)) between 1 and 120),
  check (length(trim(value)) between 1 and 4000),
  check (length(trim(source)) between 1 and 300)
);

create unique index if not exists assistant_agent_memories_legacy_uidx
  on assistant_agent_memories (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists assistant_agent_memories_scope_idx
  on assistant_agent_memories (tenant_id, company_id, entity_type, entity_id);

create table if not exists assistant_agent_artifacts (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  company_id text,
  artifact_kind text not null check (artifact_kind in ('approval_advisory', 'quote_advisory')),
  status text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(status)) between 1 and 80)
);

create unique index if not exists assistant_agent_artifacts_legacy_uidx
  on assistant_agent_artifacts (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists assistant_agent_artifacts_scope_idx
  on assistant_agent_artifacts (tenant_id, company_id, artifact_kind, created_at desc);

select tenant_rls_policy('assistant_agent_runs');
select tenant_rls_policy('assistant_agent_tasks');
select tenant_rls_policy('assistant_agent_memories');
select tenant_rls_policy('assistant_agent_artifacts');

drop trigger if exists assistant_agent_runs_set_updated_at on assistant_agent_runs;
create trigger assistant_agent_runs_set_updated_at
before update on assistant_agent_runs
for each row execute function set_updated_at();

drop trigger if exists assistant_agent_tasks_set_updated_at on assistant_agent_tasks;
create trigger assistant_agent_tasks_set_updated_at
before update on assistant_agent_tasks
for each row execute function set_updated_at();

drop trigger if exists assistant_agent_memories_set_updated_at on assistant_agent_memories;
create trigger assistant_agent_memories_set_updated_at
before update on assistant_agent_memories
for each row execute function set_updated_at();

drop trigger if exists assistant_agent_artifacts_set_updated_at on assistant_agent_artifacts;
create trigger assistant_agent_artifacts_set_updated_at
before update on assistant_agent_artifacts
for each row execute function set_updated_at();

commit;
