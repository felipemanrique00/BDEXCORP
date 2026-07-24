begin;

create table if not exists ai_invocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete restrict,
  task text not null check (task in (
    'chat', 'extract', 'hotel_search', 'research', 'report_explanation',
    'policy_draft', 'workflow_draft', 'transcription', 'speech'
  )),
  provider text not null check (provider in ('openai', 'gemini', 'local')),
  model text not null,
  status text not null check (status in ('completed', 'blocked', 'failed')),
  input_hash char(64) not null,
  input_characters integer not null check (input_characters >= 0),
  output_characters integer not null default 0 check (output_characters >= 0),
  company_scope text[] not null default '{}',
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  context_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(context_summary) = 'object'),
  error_code text,
  latency_ms integer not null check (latency_ms >= 0),
  request_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, actor_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict
);

create index if not exists ai_invocations_actor_created_idx
  on ai_invocations (tenant_id, actor_user_id, created_at desc);

create index if not exists ai_invocations_task_created_idx
  on ai_invocations (tenant_id, task, created_at desc);

create table if not exists ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  confirmed_by_user_id uuid references users(id) on delete restrict,
  company_id text,
  action_type text not null check (action_type in (
    'create_demand', 'create_hotel', 'human_handoff'
  )),
  status text not null default 'pending_confirmation' check (status in (
    'pending_confirmation', 'executing', 'completed', 'rejected',
    'expired', 'failed'
  )),
  summary text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  idempotency_key text not null,
  input_hash char(64) not null,
  version bigint not null default 1 check (version > 0),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  executed_at timestamptz,
  rejected_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, requested_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, confirmed_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(summary)) between 3 and 1000),
  check (length(trim(idempotency_key)) between 12 and 200),
  check (expires_at > created_at),
  check (
    (status in ('executing', 'completed', 'failed') and confirmed_at is not null and confirmed_by_user_id is not null)
    or (status not in ('executing', 'completed', 'failed') and confirmed_at is null and confirmed_by_user_id is null)
  ),
  check (
    (status = 'completed' and executed_at is not null)
    or status <> 'completed'
  ),
  check (
    (status = 'rejected' and rejected_at is not null)
    or status <> 'rejected'
  )
);

create index if not exists ai_action_proposals_pending_idx
  on ai_action_proposals (tenant_id, requested_by_user_id, expires_at, created_at desc)
  where status = 'pending_confirmation';

create index if not exists ai_action_proposals_company_idx
  on ai_action_proposals (tenant_id, company_id, created_at desc)
  where company_id is not null;

create table if not exists ai_action_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  proposal_id uuid not null,
  event_type text not null check (event_type in (
    'prepared', 'confirmed', 'rejected', 'execution_started',
    'execution_completed', 'execution_failed', 'expired'
  )),
  actor_user_id uuid references users(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, proposal_id)
    references ai_action_proposals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict
);

create index if not exists ai_action_events_proposal_idx
  on ai_action_events (tenant_id, proposal_id, created_at);

select tenant_rls_policy('ai_invocations');
select tenant_rls_policy('ai_action_proposals');
select tenant_rls_policy('ai_action_events');

drop trigger if exists ai_action_proposals_set_updated_at on ai_action_proposals;
create trigger ai_action_proposals_set_updated_at
before update on ai_action_proposals
for each row execute function set_updated_at();

create or replace function prevent_ai_governance_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.tenant_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Registros de governanca da IA sao imutaveis.';
end;
$$;

drop trigger if exists ai_invocations_immutable on ai_invocations;
create trigger ai_invocations_immutable
before update or delete on ai_invocations
for each row execute function prevent_ai_governance_event_mutation();

drop trigger if exists ai_action_events_immutable on ai_action_events;
create trigger ai_action_events_immutable
before update or delete on ai_action_events
for each row execute function prevent_ai_governance_event_mutation();

commit;
