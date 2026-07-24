begin;

create table if not exists enterprise_workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_code text not null,
  name text not null,
  description text not null,
  process_type text not null check (process_type in (
    'travel_request', 'quotation', 'choice', 'approval', 'reservation',
    'issuance', 'change', 'cancellation', 'refund', 'advance',
    'expense_report', 'reconciliation', 'onboarding', 'support', 'incident',
    'integration', 'administrative', 'generic'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'approved', 'published', 'suspended', 'archived'
  )),
  current_version integer not null default 1 check (current_version > 0),
  published_version integer check (published_version is null or published_version > 0),
  tags text[] not null default '{}',
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, workflow_code)
);

create table if not exists enterprise_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'approved', 'published', 'suspended', 'archived'
  )),
  source text not null default 'manual' check (source in ('manual', 'ai_draft')),
  graph_snapshot jsonb not null check (jsonb_typeof(graph_snapshot) = 'object'),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text not null,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  reviewed_by uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_definition_id, version_number),
  foreign key (tenant_id, workflow_definition_id)
    references enterprise_workflow_definitions(tenant_id, id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check ((reviewed_at is null) = (reviewed_by is null)),
  check ((approved_at is null) = (approved_by is null)),
  check ((published_at is null) = (published_by is null)),
  check (status <> 'approved' or (reviewed_at is not null and approved_at is not null)),
  check (status <> 'published' or (
    reviewed_at is not null and approved_at is not null and published_at is not null
  ))
);

create index if not exists enterprise_workflow_versions_effective_idx
  on enterprise_workflow_versions (tenant_id, status, valid_from, valid_until);

create table if not exists enterprise_workflow_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  scope_type text not null check (scope_type in ('tenant', 'group', 'company')),
  scope_id text,
  mode text not null default 'include' check (mode in ('include', 'exclude')),
  specificity integer not null default 0 check (specificity between 0 and 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, scope_type, scope_id, mode),
  foreign key (tenant_id, workflow_version_id)
    references enterprise_workflow_versions(tenant_id, id) on delete cascade,
  check (
    (scope_type = 'tenant' and scope_id is null)
    or (scope_type <> 'tenant' and scope_id is not null)
  )
);

create table if not exists enterprise_workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  client_node_id text not null,
  node_key text not null,
  name text not null,
  description text,
  node_type text not null check (node_type in (
    'start', 'sequence', 'human_task', 'automatic_task', 'condition', 'decision',
    'domain_command', 'service_call', 'integration_call', 'timer', 'wait',
    'parallel_split', 'parallel_join', 'quorum', 'sla', 'escalation', 'fallback',
    'retry', 'compensation', 'subworkflow', 'approval', 'fault_handler', 'end'
  )),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  position_x numeric(12,2) not null default 0,
  position_y numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, client_node_id),
  unique (tenant_id, workflow_version_id, node_key),
  foreign key (tenant_id, workflow_version_id)
    references enterprise_workflow_versions(tenant_id, id) on delete cascade
);

create table if not exists enterprise_workflow_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  client_edge_id text not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  edge_kind text not null default 'success' check (edge_kind in (
    'success', 'condition', 'default', 'failure', 'timeout', 'parallel', 'compensation'
  )),
  sequence integer not null default 0 check (sequence >= 0),
  label text,
  condition_ast jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, client_edge_id),
  unique (tenant_id, workflow_version_id, source_node_id, target_node_id, edge_kind),
  foreign key (tenant_id, workflow_version_id)
    references enterprise_workflow_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_node_id)
    references enterprise_workflow_nodes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, target_node_id)
    references enterprise_workflow_nodes(tenant_id, id) on delete cascade,
  check (source_node_id <> target_node_id),
  check (
    (edge_kind = 'condition' and condition_ast is not null and jsonb_typeof(condition_ast) = 'object')
    or (edge_kind <> 'condition' and condition_ast is null)
  )
);

create table if not exists enterprise_workflow_change_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  workflow_version_id uuid,
  action text not null,
  actor_user_id uuid not null references users(id) on delete restrict,
  reason text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, workflow_definition_id)
    references enterprise_workflow_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_version_id)
    references enterprise_workflow_versions(tenant_id, id) on delete restrict,
  check (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object'),
  check (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object')
);

create index if not exists enterprise_workflow_change_audits_definition_idx
  on enterprise_workflow_change_audits (tenant_id, workflow_definition_id, created_at desc);

create table if not exists enterprise_workflow_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  workflow_version_id uuid not null,
  company_id text not null,
  subject_type text not null check (subject_type in (
    'demand', 'reservation', 'employee', 'company', 'integration',
    'workflow_execution', 'generic'
  )),
  subject_id text not null,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'
  )),
  workflow_snapshot jsonb not null check (jsonb_typeof(workflow_snapshot) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  active_node_keys text[] not null default '{}',
  completed_node_keys text[] not null default '{}',
  input_hash char(64) not null check (input_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null,
  version bigint not null default 1 check (version > 0),
  started_by uuid not null references users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, workflow_definition_id)
    references enterprise_workflow_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_version_id)
    references enterprise_workflow_versions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (
    (status = 'completed' and completed_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and completed_at is null)
    or (status not in ('completed', 'failed') and completed_at is null and failed_at is null)
  )
);

create index if not exists enterprise_workflow_executions_status_idx
  on enterprise_workflow_executions (tenant_id, company_id, status, updated_at desc);
create index if not exists enterprise_workflow_executions_subject_idx
  on enterprise_workflow_executions (tenant_id, subject_type, subject_id, started_at desc);

create table if not exists enterprise_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  execution_id uuid not null,
  workflow_node_id uuid not null,
  node_key text not null,
  attempt integer not null default 1 check (attempt between 1 and 100),
  status text not null default 'pending' check (status in (
    'pending', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled'
  )),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  error_code text,
  error_message text,
  assigned_user_id uuid references users(id) on delete restrict,
  assigned_role_key text,
  idempotency_key text not null,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, execution_id, node_key, attempt),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, execution_id)
    references enterprise_workflow_executions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, workflow_node_id)
    references enterprise_workflow_nodes(tenant_id, id) on delete restrict,
  check (num_nonnulls(assigned_user_id, assigned_role_key) <= 1),
  check (
    status not in ('completed', 'failed', 'skipped', 'cancelled')
    or completed_at is not null
  )
);

create index if not exists enterprise_workflow_steps_pending_idx
  on enterprise_workflow_steps (tenant_id, status, due_at, created_at)
  where status in ('pending', 'running', 'waiting', 'failed');

create table if not exists enterprise_workflow_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  execution_id uuid not null,
  step_id uuid not null,
  command_key text not null,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'completed', 'failed', 'compensated'
  )),
  idempotency_key text not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  result_payload jsonb check (result_payload is null or jsonb_typeof(result_payload) = 'object'),
  error_code text,
  error_message text,
  created_by uuid not null references users(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, execution_id)
    references enterprise_workflow_executions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, step_id)
    references enterprise_workflow_steps(tenant_id, id) on delete cascade,
  check (
    status not in ('completed', 'failed', 'compensated')
    or completed_at is not null
  )
);

create index if not exists enterprise_workflow_commands_status_idx
  on enterprise_workflow_commands (tenant_id, status, created_at);

create table if not exists enterprise_workflow_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  execution_id uuid not null,
  step_id uuid,
  event_sequence bigint generated always as identity,
  event_type text not null,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, execution_id, event_sequence),
  unique (tenant_id, execution_id, idempotency_key),
  foreign key (tenant_id, execution_id)
    references enterprise_workflow_executions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, step_id)
    references enterprise_workflow_steps(tenant_id, id) on delete cascade
);

create index if not exists enterprise_workflow_events_execution_idx
  on enterprise_workflow_events (tenant_id, execution_id, event_sequence);

create or replace function validate_enterprise_workflow_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_type = 'company' and not exists (
    select 1 from companies
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Empresa do escopo de workflow não encontrada no tenant.';
  end if;
  if new.scope_type = 'group' and not exists (
    select 1 from business_groups
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Grupo do escopo de workflow não encontrado no tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists enterprise_workflow_scopes_validate on enterprise_workflow_scopes;
create trigger enterprise_workflow_scopes_validate
before insert or update on enterprise_workflow_scopes
for each row execute function validate_enterprise_workflow_scope();

create or replace function validate_enterprise_workflow_execution_subject()
returns trigger
language plpgsql
as $$
begin
  if new.subject_type = 'demand' and not exists (
    select 1 from demands
    where tenant_id = new.tenant_id and id = new.subject_id
      and company_id = new.company_id and deleted_at is null
  ) then
    raise exception 'Demanda da execução não pertence à empresa e ao tenant.';
  elsif new.subject_type = 'reservation' and not exists (
    select 1 from reservations
    where tenant_id = new.tenant_id and id = new.subject_id
      and company_id = new.company_id
  ) then
    raise exception 'Reserva da execução não pertence à empresa e ao tenant.';
  elsif new.subject_type = 'employee' and not exists (
    select 1 from employees
    where tenant_id = new.tenant_id and id = new.subject_id
      and company_id = new.company_id and deleted_at is null
  ) then
    raise exception 'Funcionário da execução não pertence à empresa e ao tenant.';
  elsif new.subject_type = 'company' and new.subject_id is distinct from new.company_id then
    raise exception 'Sujeito empresa precisa coincidir com a empresa da execução.';
  elsif new.subject_type = 'workflow_execution' and not exists (
    select 1 from enterprise_workflow_executions
    where tenant_id = new.tenant_id and id::text = new.subject_id
      and company_id = new.company_id
  ) then
    raise exception 'Subexecução não pertence à empresa e ao tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists enterprise_workflow_executions_validate_subject on enterprise_workflow_executions;
create trigger enterprise_workflow_executions_validate_subject
before insert or update of tenant_id, company_id, subject_type, subject_id
on enterprise_workflow_executions
for each row execute function validate_enterprise_workflow_execution_subject();

create or replace function prevent_enterprise_workflow_version_content_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Versão de workflow submetida é imutável; arquive a definição.';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' and (
    new.graph_snapshot is distinct from old.graph_snapshot
    or new.content_hash is distinct from old.content_hash
    or new.workflow_definition_id is distinct from old.workflow_definition_id
    or new.version_number is distinct from old.version_number
    or new.source is distinct from old.source
    or new.valid_from is distinct from old.valid_from
    or new.valid_until is distinct from old.valid_until
  ) then
    raise exception 'Conteúdo de versão submetida é imutável; crie uma nova versão.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enterprise_workflow_versions_content_immutable on enterprise_workflow_versions;
create trigger enterprise_workflow_versions_content_immutable
before update or delete on enterprise_workflow_versions
for each row execute function prevent_enterprise_workflow_version_content_mutation();

create or replace function prevent_enterprise_workflow_child_mutation()
returns trigger
language plpgsql
as $$
declare
  resolved_version_id uuid;
  resolved_status text;
begin
  resolved_version_id := case
    when tg_op = 'DELETE' then old.workflow_version_id
    else new.workflow_version_id
  end;
  select status into resolved_status
  from enterprise_workflow_versions
  where tenant_id = case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end
    and id = resolved_version_id;
  if resolved_status is distinct from 'draft' then
    raise exception 'Nós, conexões e escopos só podem ser alterados em versão rascunho.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'enterprise_workflow_scopes',
    'enterprise_workflow_nodes',
    'enterprise_workflow_edges'
  ] loop
    execute format('drop trigger if exists %I_content_immutable on %I', target_table, target_table);
    execute format(
      'create trigger %I_content_immutable before insert or update or delete on %I for each row execute function prevent_enterprise_workflow_child_mutation()',
      target_table,
      target_table
    );
  end loop;
end;
$$;

create or replace function prevent_published_workflow_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versão de workflow publicada é imutável; suspenda ou arquive a definição.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and (
    new.graph_snapshot is distinct from old.graph_snapshot
    or new.content_hash is distinct from old.content_hash
    or new.workflow_definition_id is distinct from old.workflow_definition_id
    or new.version_number is distinct from old.version_number
    or new.valid_from is distinct from old.valid_from
    or new.valid_until is distinct from old.valid_until
  ) then
    raise exception 'Conteúdo de workflow publicado é imutável; crie uma nova versão.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'enterprise_workflow_definitions',
    'enterprise_workflow_versions',
    'enterprise_workflow_scopes',
    'enterprise_workflow_nodes',
    'enterprise_workflow_edges',
    'enterprise_workflow_change_audits',
    'enterprise_workflow_executions',
    'enterprise_workflow_steps',
    'enterprise_workflow_commands',
    'enterprise_workflow_events'
  ] loop
    perform tenant_rls_policy(target_table);
  end loop;
end;
$$;

drop trigger if exists enterprise_workflow_definitions_set_updated_at on enterprise_workflow_definitions;
create trigger enterprise_workflow_definitions_set_updated_at
before update on enterprise_workflow_definitions
for each row execute function set_updated_at();

drop trigger if exists enterprise_workflow_versions_set_updated_at on enterprise_workflow_versions;
create trigger enterprise_workflow_versions_set_updated_at
before update on enterprise_workflow_versions
for each row execute function set_updated_at();

drop trigger if exists enterprise_workflow_executions_set_updated_at on enterprise_workflow_executions;
create trigger enterprise_workflow_executions_set_updated_at
before update on enterprise_workflow_executions
for each row execute function set_updated_at();

drop trigger if exists enterprise_workflow_steps_set_updated_at on enterprise_workflow_steps;
create trigger enterprise_workflow_steps_set_updated_at
before update on enterprise_workflow_steps
for each row execute function set_updated_at();

drop trigger if exists enterprise_workflow_commands_set_updated_at on enterprise_workflow_commands;
create trigger enterprise_workflow_commands_set_updated_at
before update on enterprise_workflow_commands
for each row execute function set_updated_at();

commit;
