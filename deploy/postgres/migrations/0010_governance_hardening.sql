insert into permissions (permission_key, module, description) values
  ('ver_politicas', 'governanca', 'Visualizar politicas e decisoes aplicadas'),
  ('gerenciar_politicas', 'governanca', 'Criar e editar rascunhos de politicas'),
  ('publicar_politicas', 'governanca', 'Aprovar, publicar, suspender e arquivar politicas'),
  ('simular_politicas', 'governanca', 'Executar simulacoes sem efeitos operacionais'),
  ('ver_aprovacoes', 'governanca', 'Visualizar workflows e instancias de aprovacao'),
  ('decidir_aprovacoes', 'governanca', 'Aprovar ou rejeitar atribuicoes autorizadas'),
  ('gerenciar_workflows', 'governanca', 'Criar, revisar e publicar workflows'),
  ('gerenciar_delegacoes', 'governanca', 'Criar e revogar delegacoes de aprovacao')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_politicas', 'gerenciar_politicas', 'publicar_politicas', 'simular_politicas',
  'ver_aprovacoes', 'decidir_aprovacoes', 'gerenciar_workflows', 'gerenciar_delegacoes'
]) as permission_key
where role_row.role_key = 'tenant_admin'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_politicas', 'gerenciar_politicas', 'simular_politicas',
  'ver_aprovacoes', 'decidir_aprovacoes', 'gerenciar_workflows'
]) as permission_key
where role_row.role_key = 'supervisor'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array['ver_politicas', 'ver_aprovacoes', 'decidir_aprovacoes']) as permission_key
where role_row.role_key in ('financial_manager', 'company_admin')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array['ver_politicas', 'ver_aprovacoes']) as permission_key
where role_row.role_key in ('agent', 'operator', 'requester', 'readonly')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

alter table policy_templates
  add column if not exists family_key text,
  add column if not exists segment_key text,
  add column if not exists template_kind text not null default 'generic_policy',
  add column if not exists checkpoints text[] not null default '{}',
  add column if not exists sample_facts jsonb not null default '{}'::jsonb,
  add column if not exists expected_actions text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'policy_templates_kind_check' and conrelid = 'policy_templates'::regclass
  ) then
    alter table policy_templates add constraint policy_templates_kind_check check (template_kind in (
      'generic_policy', 'domain_action', 'workflow', 'authorization',
      'integration', 'job', 'report', 'financial_rule'
    ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'policy_templates_sample_facts_check' and conrelid = 'policy_templates'::regclass
  ) then
    alter table policy_templates add constraint policy_templates_sample_facts_check
      check (jsonb_typeof(sample_facts) = 'object');
  end if;
end;
$$;

create index if not exists policy_templates_family_segment_idx
  on policy_templates (tenant_id, family_key, segment_key, status);

create table if not exists policy_fact_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fact_path text not null,
  domain text not null,
  data_type text not null check (data_type in ('string', 'number', 'boolean', 'date', 'datetime', 'time', 'money', 'array', 'object')),
  description text not null,
  enum_values jsonb,
  sensitive boolean not null default false,
  status text not null default 'active' check (status in ('active', 'deprecated', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, fact_path),
  check (enum_values is null or jsonb_typeof(enum_values) = 'array')
);

create table if not exists policy_category_strategies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  category text not null,
  conflict_strategy text not null check (conflict_strategy in ('explicit_block', 'specific_scope', 'priority', 'manual_review')),
  legal_or_security_precedence boolean not null default true,
  unresolved_action text not null default 'manual_review' check (unresolved_action in ('block', 'manual_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, category)
);

create table if not exists policy_action_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  evaluation_id uuid not null,
  decision_id uuid,
  action_key text not null,
  action_type text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'executing', 'completed', 'failed', 'compensated')),
  attempts integer not null default 0 check (attempts >= 0),
  input_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(input_payload) = 'object'),
  result_payload jsonb,
  error_code text,
  error_message text,
  executed_by uuid references users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, evaluation_id, action_key),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, decision_id) references policy_decisions(tenant_id, id) on delete restrict,
  check (result_payload is null or jsonb_typeof(result_payload) = 'object'),
  check ((completed_at is null) = (status in ('pending', 'executing'))),
  check ((error_code is null and error_message is null) or status = 'failed')
);

create index if not exists policy_action_executions_status_idx
  on policy_action_executions (tenant_id, status, created_at);

create table if not exists approval_delegation_companies (
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegation_id uuid not null,
  company_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, delegation_id, company_id),
  foreign key (tenant_id, delegation_id) references approval_delegations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict
);

create table if not exists approval_delegation_groups (
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegation_id uuid not null,
  group_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, delegation_id, group_id),
  foreign key (tenant_id, delegation_id) references approval_delegations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_id) references business_groups(tenant_id, id) on delete restrict
);

create table if not exists approval_delegation_modules (
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegation_id uuid not null,
  module_key text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, delegation_id, module_key),
  foreign key (tenant_id, delegation_id) references approval_delegations(tenant_id, id) on delete cascade
);

create or replace function validate_approval_delegation_scope()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from unnest(new.company_ids) as scope(company_id)
    where not exists (
      select 1 from companies
      where companies.tenant_id = new.tenant_id
        and companies.id = scope.company_id
        and companies.deleted_at is null
    )
  ) then
    raise exception 'Delegacao contem empresa invalida ou de outro tenant.';
  end if;
  if exists (
    select 1 from unnest(new.group_ids) as scope(group_id)
    where not exists (
      select 1 from business_groups
      where business_groups.tenant_id = new.tenant_id
        and business_groups.id = scope.group_id
        and business_groups.deleted_at is null
    )
  ) then
    raise exception 'Delegacao contem grupo invalido ou de outro tenant.';
  end if;
  if exists (
    select 1
    from tenant_memberships membership
    join users on users.id = membership.user_id
    where membership.tenant_id = new.tenant_id
      and membership.id = new.delegator_membership_id
      and users.platform_admin = true
  ) then
    raise exception 'Privilegios de administrador da plataforma nao podem ser delegados.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_delegations_validate_scope on approval_delegations;
create trigger approval_delegations_validate_scope
before insert or update on approval_delegations
for each row execute function validate_approval_delegation_scope();

create or replace function prevent_published_policy_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_version_id uuid;
  target_status text;
begin
  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  if tg_table_name = 'policy_conditions' then
    select policy_rule_sets.policy_version_id into target_version_id
    from policy_rule_sets where policy_rule_sets.tenant_id = row_value.tenant_id and policy_rule_sets.id = row_value.rule_set_id;
  else
    target_version_id := row_value.policy_version_id;
  end if;
  select status into target_status from policy_versions
  where tenant_id = row_value.tenant_id and id = target_version_id;
  if target_status = 'published' then
    raise exception 'Filhos de versao de politica publicada sao imutaveis.';
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
    'policy_scopes', 'policy_rule_sets', 'policy_conditions', 'policy_actions',
    'policy_exceptions', 'policy_dependencies'
  ] loop
    execute format('drop trigger if exists %I on %I', target_table || '_published_immutable', target_table);
    execute format(
      'create trigger %I before insert or update or delete on %I for each row execute function prevent_published_policy_child_mutation()',
      target_table || '_published_immutable', target_table
    );
  end loop;
end;
$$;

create or replace function prevent_published_workflow_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_status text;
begin
  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  select status into target_status from approval_workflow_versions
  where tenant_id = row_value.tenant_id and id = row_value.workflow_version_id;
  if target_status = 'published' then
    raise exception 'Filhos de versao de workflow publicada sao imutaveis.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array['approval_nodes', 'approval_edges', 'approval_rules', 'approval_slas'] loop
    execute format('drop trigger if exists %I on %I', target_table || '_published_immutable', target_table);
    execute format(
      'create trigger %I before insert or update or delete on %I for each row execute function prevent_published_workflow_child_mutation()',
      target_table || '_published_immutable', target_table
    );
  end loop;
end;
$$;

create unique index if not exists approval_nodes_version_id_uidx
  on approval_nodes (tenant_id, workflow_version_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approval_edges_source_same_version_fk') then
    alter table approval_edges add constraint approval_edges_source_same_version_fk
      foreign key (tenant_id, workflow_version_id, source_node_id)
      references approval_nodes(tenant_id, workflow_version_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_edges_target_same_version_fk') then
    alter table approval_edges add constraint approval_edges_target_same_version_fk
      foreign key (tenant_id, workflow_version_id, target_node_id)
      references approval_nodes(tenant_id, workflow_version_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_rules_node_same_version_fk') then
    alter table approval_rules add constraint approval_rules_node_same_version_fk
      foreign key (tenant_id, workflow_version_id, node_id)
      references approval_nodes(tenant_id, workflow_version_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_slas_node_same_version_fk') then
    alter table approval_slas add constraint approval_slas_node_same_version_fk
      foreign key (tenant_id, workflow_version_id, node_id)
      references approval_nodes(tenant_id, workflow_version_id, id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists policy_decisions_evaluation_id_uidx
  on policy_decisions (tenant_id, evaluation_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policy_action_executions_decision_same_evaluation_fk') then
    alter table policy_action_executions add constraint policy_action_executions_decision_same_evaluation_fk
      foreign key (tenant_id, evaluation_id, decision_id)
      references policy_decisions(tenant_id, evaluation_id, id) on delete restrict;
  end if;
end;
$$;

create or replace function validate_approval_instance_version()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from approval_workflow_versions
    where tenant_id = new.tenant_id
      and id = new.workflow_version_id
      and workflow_definition_id = new.workflow_definition_id
  ) then
    raise exception 'Versao do workflow nao pertence a definicao informada.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_instances_validate_version on approval_instances;
create trigger approval_instances_validate_version
before insert or update of workflow_definition_id, workflow_version_id on approval_instances
for each row execute function validate_approval_instance_version();

create or replace function validate_approval_step_node()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from approval_instances instance
    join approval_nodes node
      on node.tenant_id = instance.tenant_id
      and node.workflow_version_id = instance.workflow_version_id
    where instance.tenant_id = new.tenant_id
      and instance.id = new.approval_instance_id
      and node.id = new.node_id
  ) then
    raise exception 'No da etapa nao pertence a versao da instancia.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_steps_validate_node on approval_steps;
create trigger approval_steps_validate_node
before insert or update of approval_instance_id, node_id on approval_steps
for each row execute function validate_approval_step_node();

create or replace function enforce_demand_lifecycle_transition()
returns trigger
language plpgsql
as $$
declare
  lifecycle_command text;
  idempotency_key text;
  transition_key text;
  allowed_transitions text[] := array[
    'draft>submitted', 'submitted>pending_merit_approval', 'submitted>approved_for_quotation',
    'pending_merit_approval>approved_for_quotation', 'approved_for_quotation>quoting',
    'quoting>pending_choice', 'pending_choice>pending_cost_approval', 'pending_choice>approved',
    'approved>pending_cost_approval', 'pending_cost_approval>approved', 'approved>reserving',
    'reserving>reserved', 'reserved>pending_issuance', 'pending_issuance>issuing',
    'partially_issued>issuing', 'issuing>issued', 'partially_issued>issued',
    'issuing>partially_issued', 'submitted>rejected', 'pending_merit_approval>rejected',
    'pending_choice>rejected', 'pending_cost_approval>rejected', 'issued>pending_refund',
    'partially_issued>pending_refund', 'canceled>pending_refund', 'pending_refund>refunded',
    'issued>closed', 'refunded>closed'
  ];
begin
  if new.lifecycle_status is not distinct from old.lifecycle_status then return new; end if;
  lifecycle_command := nullif(current_setting('app.lifecycle_command', true), '');
  idempotency_key := nullif(current_setting('app.idempotency_key', true), '');
  if lifecycle_command is null or idempotency_key is null then
    raise exception 'Transicao de ciclo de vida exige comando e chave de idempotencia.';
  end if;
  transition_key := old.lifecycle_status || '>' || new.lifecycle_status;
  if not (transition_key = any(allowed_transitions))
    and not (new.lifecycle_status = 'canceled' and old.lifecycle_status not in ('rejected', 'expired', 'closed'))
    and not (new.lifecycle_status = 'expired' and old.lifecycle_status not in ('issued', 'refunded', 'rejected', 'canceled', 'closed'))
    and not (new.lifecycle_status = 'failed' and old.lifecycle_status not in ('draft', 'issued', 'refunded', 'rejected', 'canceled', 'expired', 'closed'))
  then
    raise exception 'Transicao de ciclo de vida invalida: %', transition_key;
  end if;
  if new.lifecycle_version <> old.lifecycle_version + 1 then
    raise exception 'Versao do ciclo de vida deve ser incrementada em uma unidade.';
  end if;
  if new.last_transition_at is null then
    raise exception 'Data da transicao e obrigatoria.';
  end if;
  return new;
end;
$$;

drop trigger if exists demands_enforce_lifecycle_transition on demands;
create trigger demands_enforce_lifecycle_transition
before update of lifecycle_status on demands
for each row execute function enforce_demand_lifecycle_transition();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'policy_fact_definitions', 'policy_category_strategies', 'policy_action_executions',
    'approval_delegation_companies', 'approval_delegation_groups', 'approval_delegation_modules'
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

drop trigger if exists policy_fact_definitions_set_updated_at on policy_fact_definitions;
create trigger policy_fact_definitions_set_updated_at before update on policy_fact_definitions for each row execute function set_updated_at();
drop trigger if exists policy_category_strategies_set_updated_at on policy_category_strategies;
create trigger policy_category_strategies_set_updated_at before update on policy_category_strategies for each row execute function set_updated_at();
drop trigger if exists policy_action_executions_set_updated_at on policy_action_executions;
create trigger policy_action_executions_set_updated_at before update on policy_action_executions for each row execute function set_updated_at();
