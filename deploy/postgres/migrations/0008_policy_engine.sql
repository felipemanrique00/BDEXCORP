create table if not exists policy_template_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  category_key text not null,
  name text not null,
  description text,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, category_key)
);

create table if not exists policy_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  category_id uuid not null,
  template_key text not null,
  name text not null,
  description text not null,
  template_version integer not null default 1 check (template_version > 0),
  condition_template jsonb not null check (jsonb_typeof(condition_template) = 'object'),
  action_templates jsonb not null check (jsonb_typeof(action_templates) = 'array'),
  parameter_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(parameter_schema) = 'object'),
  dependencies jsonb not null default '[]'::jsonb check (jsonb_typeof(dependencies) = 'array'),
  risks jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),
  tags text[] not null default '{}',
  content_hash char(64) not null,
  status text not null default 'active' check (status in ('active', 'deprecated', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, template_key, template_version),
  foreign key (tenant_id, category_id) references policy_template_categories(tenant_id, id) on delete restrict,
  check (content_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists policy_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_code text not null,
  name text not null,
  description text not null,
  category text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'suspended', 'archived')),
  priority integer not null default 100,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'blocking', 'critical')),
  inheritance_mode text not null default 'inherit' check (inheritance_mode in ('inherit', 'merge', 'override', 'replace', 'disable', 'stop_inheritance')),
  overridable boolean not null default true,
  business_justification text not null,
  tags text[] not null default '{}',
  current_version integer,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, policy_code)
);

create index if not exists policy_definitions_status_idx
  on policy_definitions (tenant_id, status, category, priority desc);

create table if not exists policy_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_definition_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'suspended', 'archived')),
  name text not null,
  description text not null,
  category text not null,
  priority integer not null,
  severity text not null check (severity in ('info', 'warning', 'blocking', 'critical')),
  inheritance_mode text not null check (inheritance_mode in ('inherit', 'merge', 'override', 'replace', 'disable', 'stop_inheritance')),
  overridable boolean not null default true,
  condition_ast jsonb not null check (jsonb_typeof(condition_ast) = 'object'),
  actions_ast jsonb not null check (jsonb_typeof(actions_ast) = 'array'),
  exception_ast jsonb not null default '[]'::jsonb check (jsonb_typeof(exception_ast) = 'array'),
  timezone text not null default 'America/Sao_Paulo',
  valid_from timestamptz,
  valid_until timestamptz,
  tags text[] not null default '{}',
  business_justification text not null,
  content_hash char(64) not null,
  change_summary text not null,
  created_by uuid not null references users(id) on delete restrict,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, policy_definition_id, version_number),
  foreign key (tenant_id, policy_definition_id) references policy_definitions(tenant_id, id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check (content_hash ~ '^[0-9a-f]{64}$'),
  check ((approved_at is null) = (approved_by is null)),
  check ((published_at is null) = (published_by is null)),
  check (status <> 'published' or (published_at is not null and approved_at is not null))
);

create index if not exists policy_versions_effective_idx
  on policy_versions (tenant_id, status, valid_from, valid_until, priority desc);

create table if not exists policy_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  scope_type text not null check (scope_type in (
    'tenant', 'group', 'company', 'branch', 'unit', 'department',
    'cost_center', 'project', 'job_title', 'traveler', 'requester'
  )),
  scope_id text,
  mode text not null default 'include' check (mode in ('include', 'exclude')),
  specificity smallint not null check (specificity between 0 and 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, policy_version_id, scope_type, scope_id, mode),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade,
  check ((scope_type = 'tenant' and scope_id is null) or (scope_type <> 'tenant' and scope_id is not null))
);

create index if not exists policy_scopes_lookup_idx
  on policy_scopes (tenant_id, scope_type, scope_id, policy_version_id);

create table if not exists policy_rule_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  name text not null,
  logical_operator text not null check (logical_operator in ('all', 'any', 'not')),
  sequence integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade
);

create table if not exists policy_conditions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_set_id uuid not null,
  parent_condition_id uuid,
  sequence integer not null default 0,
  condition_ast jsonb not null check (jsonb_typeof(condition_ast) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, rule_set_id) references policy_rule_sets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_condition_id) references policy_conditions(tenant_id, id) on delete cascade,
  check (parent_condition_id is null or parent_condition_id <> id)
);

create table if not exists policy_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  action_type text not null,
  sequence integer not null default 0,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  idempotency_scope text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade
);

create table if not exists policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  name text not null,
  condition_ast jsonb not null check (jsonb_typeof(condition_ast) = 'object'),
  valid_from timestamptz,
  valid_until timestamptz,
  justification text not null,
  approved_by uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade,
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create table if not exists policy_dependencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  dependency_type text not null check (dependency_type in ('policy', 'workflow', 'budget', 'directory', 'integration', 'feature')),
  dependency_key text not null,
  required boolean not null default true,
  minimum_version text,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, policy_version_id, dependency_type, dependency_key),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade
);

create table if not exists policy_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid not null,
  conflicting_policy_version_id uuid,
  conflict_type text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  status text not null default 'open' check (status in ('open', 'accepted', 'resolved', 'false_positive')),
  explanation text not null,
  resolution text,
  detected_at timestamptz not null default now(),
  resolved_by uuid references users(id) on delete restrict,
  resolved_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, conflicting_policy_version_id) references policy_versions(tenant_id, id) on delete cascade,
  check (conflicting_policy_version_id is null or conflicting_policy_version_id <> policy_version_id),
  check ((resolved_at is null) = (resolved_by is null))
);

create index if not exists policy_conflicts_open_idx
  on policy_conflicts (tenant_id, policy_version_id, status, severity);

create table if not exists policy_publications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_definition_id uuid not null,
  policy_version_id uuid not null,
  status text not null check (status in ('scheduled', 'active', 'suspended', 'expired', 'revoked')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  published_by uuid not null references users(id) on delete restrict,
  approved_by uuid not null references users(id) on delete restrict,
  publication_reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_definition_id) references policy_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete restrict,
  check (effective_until is null or effective_until > effective_from)
);

create index if not exists policy_publications_effective_idx
  on policy_publications (tenant_id, status, effective_from, effective_until);

create table if not exists policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  request_id uuid,
  demand_id text,
  reservation_id text,
  company_id text not null,
  employee_id text,
  checkpoint text not null,
  mode text not null default 'enforce' check (mode in ('enforce', 'shadow', 'simulation')),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  facts_hash char(64) not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_hash char(64) not null,
  passed boolean not null,
  has_blocks boolean not null,
  evaluated_by uuid references users(id) on delete set null,
  evaluated_at timestamptz not null default now(),
  duration_ms integer not null check (duration_ms >= 0),
  engine_version text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  check (facts_hash ~ '^[0-9a-f]{64}$'),
  check (result_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists policy_evaluations_entity_idx
  on policy_evaluations (tenant_id, demand_id, reservation_id, checkpoint, evaluated_at desc);

create table if not exists policy_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  evaluation_id uuid not null,
  policy_version_id uuid not null,
  outcome text not null check (outcome in ('passed', 'warning', 'justification', 'approval', 'blocked', 'exception')),
  condition_result jsonb not null check (jsonb_typeof(condition_result) = 'object'),
  observed_values jsonb not null default '{}'::jsonb check (jsonb_typeof(observed_values) = 'object'),
  explanation text not null,
  remediation text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, evaluation_id, policy_version_id),
  foreign key (tenant_id, evaluation_id) references policy_evaluations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete restrict
);

create table if not exists policy_violations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  evaluation_id uuid not null,
  decision_id uuid not null,
  violation_code text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking', 'critical')),
  status text not null default 'open' check (status in ('open', 'justified', 'approved', 'remediated', 'waived')),
  message text not null,
  expected_value jsonb,
  observed_value jsonb,
  justification text,
  resolved_by uuid references users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, evaluation_id) references policy_evaluations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, decision_id) references policy_decisions(tenant_id, id) on delete cascade,
  check ((resolved_at is null) = (resolved_by is null))
);

create table if not exists policy_simulations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  policy_version_ids uuid[] not null,
  source_type text not null check (source_type in ('manual', 'historical', 'comparison')),
  input_facts jsonb not null check (jsonb_typeof(input_facts) = 'object'),
  baseline_result jsonb,
  candidate_result jsonb not null check (jsonb_typeof(candidate_result) = 'object'),
  impact_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(impact_summary) = 'object'),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists policy_test_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_version_id uuid,
  template_id uuid,
  name text not null,
  input_facts jsonb not null check (jsonb_typeof(input_facts) = 'object'),
  expected_result jsonb not null check (jsonb_typeof(expected_result) = 'object'),
  last_result jsonb,
  last_status text check (last_status in ('passed', 'failed')),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id) references policy_templates(tenant_id, id) on delete cascade,
  check (num_nonnulls(policy_version_id, template_id) = 1)
);

create table if not exists policy_change_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_definition_id uuid,
  policy_version_id uuid,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  action text not null,
  previous_value jsonb,
  next_value jsonb,
  reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, policy_definition_id) references policy_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete restrict
);

create index if not exists policy_change_audits_entity_idx
  on policy_change_audits (tenant_id, policy_definition_id, policy_version_id, created_at desc);

create or replace function prevent_published_policy_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'Versao de politica publicada e imutavel; crie uma nova versao.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists policy_versions_published_immutable on policy_versions;
create trigger policy_versions_published_immutable
before update or delete on policy_versions
for each row execute function prevent_published_policy_version_mutation();

create or replace function validate_policy_publication_version()
returns trigger
language plpgsql
as $$
declare
  version_definition_id uuid;
  version_status text;
begin
  select policy_definition_id, status
    into version_definition_id, version_status
  from policy_versions
  where tenant_id = new.tenant_id and id = new.policy_version_id;

  if version_definition_id is distinct from new.policy_definition_id then
    raise exception 'A versao publicada nao pertence a definicao informada.';
  end if;
  if version_status not in ('approved', 'published') then
    raise exception 'Somente versao aprovada pode ser publicada.';
  end if;
  return new;
end;
$$;

drop trigger if exists policy_publications_validate_version on policy_publications;
create trigger policy_publications_validate_version
before insert or update on policy_publications
for each row execute function validate_policy_publication_version();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'policy_template_categories', 'policy_templates', 'policy_definitions',
    'policy_versions', 'policy_scopes', 'policy_rule_sets', 'policy_conditions',
    'policy_actions', 'policy_exceptions', 'policy_dependencies', 'policy_conflicts',
    'policy_publications', 'policy_evaluations', 'policy_decisions',
    'policy_violations', 'policy_simulations', 'policy_test_cases', 'policy_change_audits'
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

drop trigger if exists policy_template_categories_set_updated_at on policy_template_categories;
create trigger policy_template_categories_set_updated_at before update on policy_template_categories for each row execute function set_updated_at();
drop trigger if exists policy_templates_set_updated_at on policy_templates;
create trigger policy_templates_set_updated_at before update on policy_templates for each row execute function set_updated_at();
drop trigger if exists policy_definitions_set_updated_at on policy_definitions;
create trigger policy_definitions_set_updated_at before update on policy_definitions for each row execute function set_updated_at();
drop trigger if exists policy_versions_set_updated_at on policy_versions;
create trigger policy_versions_set_updated_at before update on policy_versions for each row execute function set_updated_at();
drop trigger if exists policy_publications_set_updated_at on policy_publications;
create trigger policy_publications_set_updated_at before update on policy_publications for each row execute function set_updated_at();
drop trigger if exists policy_test_cases_set_updated_at on policy_test_cases;
create trigger policy_test_cases_set_updated_at before update on policy_test_cases for each row execute function set_updated_at();
