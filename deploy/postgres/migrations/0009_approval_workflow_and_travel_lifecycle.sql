create table if not exists approval_workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_code text not null,
  name text not null,
  description text not null,
  workflow_type text not null check (workflow_type in (
    'merit', 'cost', 'budget', 'operational', 'security', 'international',
    'financial', 'executive', 'expense', 'refund', 'generic'
  )),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'suspended', 'archived')),
  current_version integer,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, workflow_code)
);

create table if not exists approval_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'suspended', 'archived')),
  graph_snapshot jsonb not null check (jsonb_typeof(graph_snapshot) = 'object'),
  content_hash char(64) not null,
  change_summary text not null,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_definition_id, version_number),
  foreign key (tenant_id, workflow_definition_id) references approval_workflow_definitions(tenant_id, id) on delete restrict,
  check (content_hash ~ '^[0-9a-f]{64}$'),
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check ((approved_at is null) = (approved_by is null)),
  check ((published_at is null) = (published_by is null)),
  check (status <> 'published' or (approved_at is not null and published_at is not null))
);

create index if not exists approval_workflow_versions_effective_idx
  on approval_workflow_versions (tenant_id, status, valid_from, valid_until);

create table if not exists approval_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  node_key text not null,
  name text not null,
  node_type text not null check (node_type in ('start', 'approval', 'automatic', 'condition', 'notification', 'end')),
  approval_kind text check (approval_kind in (
    'merit', 'cost', 'budget', 'operational', 'security', 'international',
    'financial', 'executive', 'cost_center', 'project', 'company', 'group', 'traveler', 'debit'
  )),
  completion_mode text check (completion_mode in ('any', 'all', 'quorum', 'first')),
  quorum integer check (quorum is null or quorum > 0),
  approver_resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(approver_resolution) = 'object'),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  position_x numeric(10,2) not null default 0,
  position_y numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, node_key),
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete cascade,
  check (
    (node_type = 'approval' and approval_kind is not null and completion_mode is not null)
    or (node_type <> 'approval' and approval_kind is null and completion_mode is null and quorum is null)
  ),
  check (completion_mode <> 'quorum' or quorum is not null)
);

create table if not exists approval_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  sequence integer not null default 0,
  condition_ast jsonb,
  label text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workflow_version_id, source_node_id, target_node_id),
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_node_id) references approval_nodes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, target_node_id) references approval_nodes(tenant_id, id) on delete cascade,
  check (source_node_id <> target_node_id),
  check (condition_ast is null or jsonb_typeof(condition_ast) = 'object')
);

create table if not exists approval_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  node_id uuid,
  rule_type text not null check (rule_type in ('entry', 'authority', 'fallback', 'separation_of_duties', 'reapproval', 'passive_approval')),
  condition_ast jsonb not null check (jsonb_typeof(condition_ast) = 'object'),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, node_id) references approval_nodes(tenant_id, id) on delete cascade
);

create table if not exists approval_slas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_version_id uuid not null,
  node_id uuid,
  calendar_id uuid,
  duration_minutes integer not null check (duration_minutes > 0),
  business_time_only boolean not null default true,
  reminder_minutes integer[] not null default '{}',
  expiration_action text not null default 'escalate' check (expiration_action in ('escalate', 'reassign', 'expire', 'notify', 'passive_approve')),
  passive_approval_justification text,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, node_id) references approval_nodes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, calendar_id) references business_calendars(tenant_id, id) on delete restrict,
  check (expiration_action <> 'passive_approve' or passive_approval_justification is not null)
);

create table if not exists approval_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_definition_id uuid not null,
  workflow_version_id uuid not null,
  demand_id text,
  reservation_id text,
  company_id text not null,
  employee_id text,
  instance_type text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'approved', 'rejected', 'cancelled', 'expired', 'failed', 'superseded')),
  subject_snapshot jsonb not null check (jsonb_typeof(subject_snapshot) = 'object'),
  workflow_snapshot jsonb not null check (jsonb_typeof(workflow_snapshot) = 'object'),
  input_hash char(64) not null,
  version bigint not null default 1 check (version > 0),
  started_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  superseded_by_instance_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, workflow_definition_id) references approval_workflow_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, superseded_by_instance_id) references approval_instances(tenant_id, id) on delete restrict,
  check (input_hash ~ '^[0-9a-f]{64}$'),
  check (superseded_by_instance_id is null or superseded_by_instance_id <> id),
  check ((completed_at is null) = (status in ('pending', 'in_progress')))
);

create index if not exists approval_instances_subject_idx
  on approval_instances (tenant_id, demand_id, reservation_id, status, created_at desc);

create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  approval_instance_id uuid not null,
  node_id uuid not null,
  step_number integer not null check (step_number > 0),
  status text not null default 'waiting' check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'cancelled', 'expired', 'failed')),
  completion_mode text not null check (completion_mode in ('any', 'all', 'quorum', 'first')),
  quorum integer,
  due_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, approval_instance_id, node_id),
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, node_id) references approval_nodes(tenant_id, id) on delete restrict,
  check (completion_mode <> 'quorum' or (quorum is not null and quorum > 0))
);

create index if not exists approval_steps_pending_idx
  on approval_steps (tenant_id, status, due_at) where status = 'pending';

create table if not exists approval_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  approval_step_id uuid not null,
  assignee_user_id uuid references users(id) on delete restrict,
  assignee_role_key text,
  resolution_source text not null,
  source_reference text,
  delegated_from_user_id uuid references users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'reassigned')),
  assigned_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, approval_step_id) references approval_steps(tenant_id, id) on delete cascade,
  check (num_nonnulls(assignee_user_id, assignee_role_key) = 1),
  check (delegated_from_user_id is null or delegated_from_user_id <> assignee_user_id)
);

create index if not exists approval_assignments_user_idx
  on approval_assignments (tenant_id, assignee_user_id, status, assigned_at desc);

create table if not exists approval_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  approval_instance_id uuid not null,
  approval_step_id uuid not null,
  assignment_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected', 'abstained')),
  reason text not null,
  decided_by_user_id uuid not null references users(id) on delete restrict,
  acting_for_user_id uuid references users(id) on delete restrict,
  idempotency_key text not null,
  decision_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_snapshot) = 'object'),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, assignment_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete restrict,
  foreign key (tenant_id, approval_step_id) references approval_steps(tenant_id, id) on delete restrict,
  foreign key (tenant_id, assignment_id) references approval_assignments(tenant_id, id) on delete restrict,
  check (acting_for_user_id is null or acting_for_user_id <> decided_by_user_id)
);

create table if not exists approval_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegator_membership_id uuid not null,
  delegate_membership_id uuid not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  scope jsonb not null check (jsonb_typeof(scope) = 'object'),
  company_ids text[] not null default '{}',
  group_ids text[] not null default '{}',
  modules text[] not null default '{}',
  justification text not null,
  status text not null default 'active' check (status in ('scheduled', 'active', 'revoked', 'expired')),
  created_by_membership_id uuid not null,
  revoked_by_membership_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, delegator_membership_id) references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, delegate_membership_id) references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, revoked_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict,
  check (delegator_membership_id <> delegate_membership_id),
  check (valid_until > valid_from),
  check ((revoked_at is null and revoked_by_membership_id is null and revocation_reason is null) or (revoked_at is not null and revoked_by_membership_id is not null and revocation_reason is not null))
);

create index if not exists approval_delegations_active_idx
  on approval_delegations (tenant_id, delegator_membership_id, delegate_membership_id, status, valid_from, valid_until);

create table if not exists approval_escalations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  approval_instance_id uuid not null,
  approval_step_id uuid not null,
  escalation_type text not null check (escalation_type in ('reminder', 'reassign', 'manager', 'fallback', 'incident', 'expiration')),
  target_user_id uuid references users(id) on delete restrict,
  target_role_key text,
  status text not null default 'scheduled' check (status in ('scheduled', 'executed', 'cancelled', 'failed')),
  scheduled_at timestamptz not null,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, approval_step_id) references approval_steps(tenant_id, id) on delete cascade,
  check (num_nonnulls(target_user_id, target_role_key) <= 1)
);

create table if not exists approval_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  approval_instance_id uuid not null,
  approval_step_id uuid,
  event_type text not null,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, approval_step_id) references approval_steps(tenant_id, id) on delete cascade
);

create index if not exists approval_events_instance_idx
  on approval_events (tenant_id, approval_instance_id, created_at);

create table if not exists approval_action_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  assignment_id uuid not null,
  token_hash char(64) not null,
  allowed_action text not null check (allowed_action in ('view', 'approve', 'reject')),
  requires_authentication boolean not null default true,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_user_id uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (token_hash),
  foreign key (tenant_id, assignment_id) references approval_assignments(tenant_id, id) on delete cascade,
  check (token_hash ~ '^[0-9a-f]{64}$'),
  check (expires_at > created_at),
  check ((used_at is null) = (used_by_user_id is null))
);

alter table demands
  add column if not exists lifecycle_status text not null default 'draft',
  add column if not exists lifecycle_version bigint not null default 1,
  add column if not exists last_transition_at timestamptz,
  add column if not exists last_policy_evaluation_id uuid,
  add column if not exists active_approval_instance_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_lifecycle_status_check' and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_lifecycle_status_check check (lifecycle_status in (
      'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation',
      'quoting', 'pending_choice', 'pending_cost_approval', 'approved', 'reserving',
      'reserved', 'pending_issuance', 'issuing', 'issued', 'partially_issued',
      'rejected', 'canceled', 'expired', 'failed', 'pending_refund', 'refunded', 'closed'
    ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_lifecycle_version_check' and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_lifecycle_version_check check (lifecycle_version > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_last_policy_evaluation_fk' and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_last_policy_evaluation_fk
      foreign key (tenant_id, last_policy_evaluation_id)
      references policy_evaluations(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_active_approval_instance_fk' and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_active_approval_instance_fk
      foreign key (tenant_id, active_approval_instance_id)
      references approval_instances(tenant_id, id) on delete restrict;
  end if;
end;
$$;

update demands
set lifecycle_status = case
  when lower(status) in ('finalizado', 'concluido', 'closed') then 'closed'
  when lower(status) in ('cancelado', 'canceled') then 'canceled'
  when lower(status) in ('rejeitado', 'rejected') then 'rejected'
  when lower(status) in ('emitido', 'issued') then 'issued'
  when lower(status) in ('reservado', 'reserved') then 'reserved'
  when lower(status) in ('aguardando_aprovacao', 'pending_approval') then 'pending_merit_approval'
  when lower(status) in ('em_andamento', 'cotando', 'quoting') then 'quoting'
  else lifecycle_status
end
where lifecycle_status = 'draft';

create table if not exists travel_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  reservation_id text,
  segment_type text not null check (segment_type in ('air', 'hotel', 'car', 'bus', 'transfer', 'insurance', 'service', 'other')),
  sequence integer not null check (sequence > 0),
  lifecycle_status text not null default 'draft' check (lifecycle_status in (
    'draft', 'quoting', 'selected', 'pending_approval', 'approved', 'reserving',
    'reserved', 'issuing', 'issued', 'canceled', 'failed', 'pending_refund', 'refunded', 'closed'
  )),
  version bigint not null default 1 check (version > 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, demand_id, sequence),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict
);

create table if not exists travel_state_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  segment_id uuid,
  command text not null,
  from_status text not null,
  to_status text not null,
  lifecycle_version bigint not null check (lifecycle_version > 0),
  idempotency_key text not null,
  actor_user_id uuid references users(id) on delete set null,
  request_id uuid,
  policy_evaluation_id uuid,
  approval_instance_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, demand_id, idempotency_key),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, segment_id) references travel_segments(tenant_id, id) on delete cascade,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete restrict,
  check (from_status <> to_status)
);

create index if not exists travel_state_events_demand_idx
  on travel_state_events (tenant_id, demand_id, lifecycle_version, created_at);

create table if not exists travel_reapproval_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  previous_approval_instance_id uuid,
  new_approval_instance_id uuid,
  previous_snapshot jsonb not null check (jsonb_typeof(previous_snapshot) = 'object'),
  current_snapshot jsonb not null check (jsonb_typeof(current_snapshot) = 'object'),
  changed_fields text[] not null,
  tolerance_result jsonb not null check (jsonb_typeof(tolerance_result) = 'object'),
  reapproval_required boolean not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, previous_approval_instance_id) references approval_instances(tenant_id, id) on delete restrict,
  foreign key (tenant_id, new_approval_instance_id) references approval_instances(tenant_id, id) on delete restrict
);

create or replace function prevent_published_workflow_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'Versao de workflow publicada e imutavel; crie uma nova versao.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists approval_workflow_versions_published_immutable on approval_workflow_versions;
create trigger approval_workflow_versions_published_immutable
before update or delete on approval_workflow_versions
for each row execute function prevent_published_workflow_version_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'approval_workflow_definitions', 'approval_workflow_versions', 'approval_nodes',
    'approval_edges', 'approval_rules', 'approval_slas', 'approval_instances',
    'approval_steps', 'approval_assignments', 'approval_decisions',
    'approval_delegations', 'approval_escalations', 'approval_events',
    'approval_action_tokens', 'travel_segments', 'travel_state_events',
    'travel_reapproval_checks'
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

drop trigger if exists approval_workflow_definitions_set_updated_at on approval_workflow_definitions;
create trigger approval_workflow_definitions_set_updated_at before update on approval_workflow_definitions for each row execute function set_updated_at();
drop trigger if exists approval_workflow_versions_set_updated_at on approval_workflow_versions;
create trigger approval_workflow_versions_set_updated_at before update on approval_workflow_versions for each row execute function set_updated_at();
drop trigger if exists approval_instances_set_updated_at on approval_instances;
create trigger approval_instances_set_updated_at before update on approval_instances for each row execute function set_updated_at();
drop trigger if exists approval_steps_set_updated_at on approval_steps;
create trigger approval_steps_set_updated_at before update on approval_steps for each row execute function set_updated_at();
drop trigger if exists approval_assignments_set_updated_at on approval_assignments;
create trigger approval_assignments_set_updated_at before update on approval_assignments for each row execute function set_updated_at();
drop trigger if exists approval_delegations_set_updated_at on approval_delegations;
create trigger approval_delegations_set_updated_at before update on approval_delegations for each row execute function set_updated_at();
drop trigger if exists travel_segments_set_updated_at on travel_segments;
create trigger travel_segments_set_updated_at before update on travel_segments for each row execute function set_updated_at();
