create or replace function corporate_permission_overrides_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_each(value) entry
      where jsonb_typeof(entry.value) <> 'boolean'
        or entry.key not in (
          'ver_financeiro', 'editar_financeiro', 'cadastrar_empresas',
          'cadastrar_funcionarios', 'cadastrar_hoteis', 'editar_politicas',
          'gerar_relatorios', 'importar_planilhas', 'ver_produtividade_todos',
          'gerenciar_usuarios', 'excluir_demandas', 'aprovar_demandas',
          'ver_empresas', 'ver_consolidado_grupo', 'ver_funcionarios',
          'gerenciar_funcionarios', 'ver_solicitantes', 'gerenciar_solicitantes',
          'criar_demandas', 'ver_demandas', 'ver_reservas', 'ver_emissoes',
          'ver_vouchers', 'ver_relatorios', 'exportar_relatorios',
          'gerenciar_vinculos_acesso', 'gerenciar_empresas_grupo',
          'alterar_configuracoes', 'operar_cotacoes', 'operar_reservas',
          'operar_emissoes', 'operar_cancelamentos', 'gerenciar_integracoes',
          'ver_politicas', 'gerenciar_politicas', 'publicar_politicas',
          'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
          'gerenciar_workflows', 'gerenciar_delegacoes'
        )
    );
$$;

alter table approval_workflow_definitions
  drop constraint if exists approval_workflow_definitions_workflow_type_check;
alter table approval_workflow_definitions
  add constraint approval_workflow_definitions_workflow_type_check check (workflow_type in (
    'merit', 'cost', 'budget', 'operational', 'security', 'international', 'national',
    'financial', 'executive', 'expense', 'refund', 'second_level', 'allocation_line', 'generic'
  ));

alter table approval_nodes
  drop constraint if exists approval_nodes_approval_kind_check;
alter table approval_nodes
  add constraint approval_nodes_approval_kind_check check (approval_kind in (
    'merit', 'cost', 'budget', 'operational', 'security', 'international',
    'financial', 'executive', 'cost_center', 'project', 'company', 'group',
    'traveler', 'debit', 'national', 'second_level', 'list', 'allocation_line'
  ));

create table if not exists approval_workflow_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  scope_type text not null check (scope_type in ('tenant', 'group', 'company')),
  scope_id text,
  mode text not null default 'include' check (mode in ('include', 'exclude')),
  specificity smallint not null check (specificity between 0 and 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, scope_type, scope_id, mode),
  foreign key (tenant_id, workflow_version_id)
    references approval_workflow_versions(tenant_id, id) on delete cascade,
  check ((scope_type = 'tenant' and scope_id is null) or (scope_type <> 'tenant' and scope_id is not null))
);

create index if not exists approval_workflow_scopes_lookup_idx
  on approval_workflow_scopes (tenant_id, scope_type, scope_id, workflow_version_id);

create table if not exists approval_workflow_change_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  workflow_version_id uuid,
  action text not null,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  reason text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, workflow_definition_id)
    references approval_workflow_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_version_id)
    references approval_workflow_versions(tenant_id, id) on delete restrict,
  check (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object'),
  check (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object')
);

create index if not exists approval_workflow_change_audits_entity_idx
  on approval_workflow_change_audits (tenant_id, workflow_definition_id, workflow_version_id, created_at desc);

create or replace function validate_approval_workflow_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_type = 'company' and not exists (
    select 1 from companies
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Empresa do escopo de workflow nao existe no tenant.';
  end if;
  if new.scope_type = 'group' and not exists (
    select 1 from business_groups
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Grupo do escopo de workflow nao existe no tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_workflow_scopes_validate on approval_workflow_scopes;
create trigger approval_workflow_scopes_validate
before insert or update on approval_workflow_scopes
for each row execute function validate_approval_workflow_scope();

create table if not exists approval_authorities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  approval_kind text not null check (approval_kind in (
    'merit', 'cost', 'budget', 'operational', 'security', 'international',
    'financial', 'executive', 'cost_center', 'project', 'company', 'group',
    'traveler', 'debit', 'national', 'second_level', 'list', 'allocation_line'
  )),
  company_id text,
  group_id text,
  cost_center_id uuid,
  project_id uuid,
  max_amount numeric(18,2) check (max_amount is null or max_amount >= 0),
  currency char(3) references currencies(code) on delete restrict,
  products text[] not null default '{}',
  destinations text[] not null default '{}',
  risk_levels text[] not null default '{}',
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  status text not null default 'active' check (status in ('scheduled', 'active', 'suspended', 'revoked', 'expired')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  justification text not null,
  created_by_membership_id uuid not null,
  revoked_by_membership_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id) references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, revoked_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, group_id) references business_groups(tenant_id, id) on delete restrict,
  foreign key (tenant_id, cost_center_id) references cost_centers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  check (num_nonnulls(company_id, group_id, cost_center_id, project_id) <= 1),
  check (valid_until is null or valid_until > valid_from),
  check (
    (revoked_at is null and revoked_by_membership_id is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by_membership_id is not null and revocation_reason is not null)
  )
);

create unique index if not exists approval_authorities_current_uidx
  on approval_authorities (
    tenant_id, membership_id, approval_kind,
    coalesce(company_id, ''), coalesce(group_id, ''),
    coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(currency, '')
  ) where status in ('scheduled', 'active');

create index if not exists approval_authorities_member_idx
  on approval_authorities (tenant_id, membership_id, status, valid_from, valid_until);

alter table approval_instances
  add column if not exists source_idempotency_key text;

create unique index if not exists approval_instances_source_idempotency_uidx
  on approval_instances (tenant_id, source_idempotency_key)
  where source_idempotency_key is not null;

create unique index if not exists approval_assignments_active_user_uidx
  on approval_assignments (tenant_id, approval_step_id, assignee_user_id)
  where assignee_user_id is not null and status in ('pending', 'approved', 'rejected');

create or replace function validate_approval_decision_consistency()
returns trigger
language plpgsql
as $$
declare
  assignment_row approval_assignments%rowtype;
  step_instance_id uuid;
begin
  select * into assignment_row
  from approval_assignments
  where tenant_id = new.tenant_id and id = new.assignment_id;

  if not found or assignment_row.approval_step_id <> new.approval_step_id then
    raise exception 'Decisao referencia atribuicao fora da etapa.';
  end if;

  select approval_instance_id into step_instance_id
  from approval_steps
  where tenant_id = new.tenant_id and id = new.approval_step_id;

  if step_instance_id is distinct from new.approval_instance_id then
    raise exception 'Decisao referencia etapa fora da instancia.';
  end if;

  if assignment_row.assignee_user_id is distinct from new.decided_by_user_id then
    raise exception 'Decisor nao corresponde ao usuario da atribuicao.';
  end if;

  if assignment_row.delegated_from_user_id is null and new.acting_for_user_id is not null then
    raise exception 'Decisao sem delegacao nao pode agir em nome de outro usuario.';
  end if;

  if assignment_row.delegated_from_user_id is not null
     and assignment_row.delegated_from_user_id is distinct from new.acting_for_user_id then
    raise exception 'Identidade representada nao corresponde a delegacao da atribuicao.';
  end if;

  return new;
end;
$$;

drop trigger if exists approval_decisions_validate_consistency on approval_decisions;
create trigger approval_decisions_validate_consistency
before insert or update on approval_decisions
for each row execute function validate_approval_decision_consistency();

create or replace function prevent_published_policy_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versao de politica publicada e imutavel; suspenda ou arquive a publicacao.';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if old.published_at is not null then
    if new.status not in ('published', 'suspended', 'archived')
       or new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.priority is distinct from old.priority
       or new.severity is distinct from old.severity
       or new.inheritance_mode is distinct from old.inheritance_mode
       or new.overridable is distinct from old.overridable
       or new.condition_ast is distinct from old.condition_ast
       or new.actions_ast is distinct from old.actions_ast
       or new.exception_ast is distinct from old.exception_ast
       or new.timezone is distinct from old.timezone
       or new.valid_from is distinct from old.valid_from
       or new.valid_until is distinct from old.valid_until
       or new.tags is distinct from old.tags
       or new.business_justification is distinct from old.business_justification
       or new.content_hash is distinct from old.content_hash
       or new.change_summary is distinct from old.change_summary
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.published_by is distinct from old.published_by
       or new.published_at is distinct from old.published_at then
      raise exception 'Conteudo de versao de politica publicada e imutavel; crie uma nova versao.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_published_workflow_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versao de workflow publicada e imutavel; suspenda ou arquive a publicacao.';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if old.published_at is not null then
    if new.status not in ('published', 'suspended', 'archived')
       or new.graph_snapshot is distinct from old.graph_snapshot
       or new.content_hash is distinct from old.content_hash
       or new.change_summary is distinct from old.change_summary
       or new.valid_from is distinct from old.valid_from
       or new.valid_until is distinct from old.valid_until
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.published_by is distinct from old.published_by
       or new.published_at is distinct from old.published_at then
      raise exception 'Conteudo de versao de workflow publicada e imutavel; crie uma nova versao.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_published_workflow_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_published_at timestamptz;
begin
  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  select published_at into target_published_at from approval_workflow_versions
  where tenant_id = row_value.tenant_id and id = row_value.workflow_version_id;
  if target_published_at is not null then
    raise exception 'Filhos de versao de workflow publicada sao imutaveis.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function prevent_published_policy_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_version_id uuid;
  target_published_at timestamptz;
begin
  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  if tg_table_name = 'policy_conditions' then
    select policy_rule_sets.policy_version_id into target_version_id
    from policy_rule_sets
    where policy_rule_sets.tenant_id = row_value.tenant_id
      and policy_rule_sets.id = row_value.rule_set_id;
  else
    target_version_id := row_value.policy_version_id;
  end if;
  select published_at into target_published_at from policy_versions
  where tenant_id = row_value.tenant_id and id = target_version_id;
  if target_published_at is not null then
    raise exception 'Filhos de versao de politica publicada sao imutaveis.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists approval_workflow_scopes_published_immutable on approval_workflow_scopes;
create trigger approval_workflow_scopes_published_immutable
before insert or update or delete on approval_workflow_scopes
for each row execute function prevent_published_workflow_child_mutation();

alter table approval_workflow_scopes enable row level security;
alter table approval_workflow_scopes force row level security;
drop policy if exists tenant_isolation on approval_workflow_scopes;
create policy tenant_isolation on approval_workflow_scopes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_authorities enable row level security;
alter table approval_authorities force row level security;
drop policy if exists tenant_isolation on approval_authorities;
create policy tenant_isolation on approval_authorities
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_workflow_change_audits enable row level security;
alter table approval_workflow_change_audits force row level security;
drop policy if exists tenant_isolation on approval_workflow_change_audits;
create policy tenant_isolation on approval_workflow_change_audits
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists approval_authorities_set_updated_at on approval_authorities;
create trigger approval_authorities_set_updated_at
before update on approval_authorities
for each row execute function set_updated_at();
