begin;

create table if not exists intelligence_insight_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fingerprint char(64) not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  insight_type text not null check (length(trim(insight_type)) between 3 and 100),
  scope_type text not null check (scope_type in ('tenant', 'group', 'company')),
  scope_id text,
  severity text not null check (severity in ('info', 'warning', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  title text not null check (length(trim(title)) between 3 and 300),
  last_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(last_snapshot) = 'object'),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  acknowledged_by uuid references users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (
    resolution_note is null or length(trim(resolution_note)) between 10 and 2000
  ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, fingerprint),
  check (
    (scope_type = 'tenant' and scope_id is null)
    or (scope_type <> 'tenant' and scope_id is not null)
  ),
  check (last_detected_at >= first_detected_at),
  check (
    (status = 'open' and acknowledged_by is null and acknowledged_at is null
      and resolved_by is null and resolved_at is null)
    or
    (status = 'acknowledged' and acknowledged_by is not null and acknowledged_at is not null
      and resolved_by is null and resolved_at is null)
    or
    (status in ('resolved', 'dismissed') and resolved_by is not null and resolved_at is not null)
  )
);

create index if not exists intelligence_insight_states_status_idx
  on intelligence_insight_states (
    tenant_id, status, severity, last_detected_at desc
  );
create index if not exists intelligence_insight_states_scope_idx
  on intelligence_insight_states (
    tenant_id, scope_type, scope_id, status
  );

create table if not exists intelligence_insight_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  insight_state_id uuid not null,
  action text not null check (
    action in ('detected', 'refreshed', 'acknowledged', 'reopened', 'resolved', 'dismissed')
  ),
  from_status text check (
    from_status is null or from_status in ('open', 'acknowledged', 'resolved', 'dismissed')
  ),
  to_status text not null check (
    to_status in ('open', 'acknowledged', 'resolved', 'dismissed')
  ),
  note text,
  snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(snapshot) = 'object'),
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, insight_state_id)
    references intelligence_insight_states(tenant_id, id) on delete cascade
);

create index if not exists intelligence_insight_events_state_idx
  on intelligence_insight_events (tenant_id, insight_state_id, created_at desc);

create or replace function validate_intelligence_insight_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_type = 'company' and not exists (
    select 1
    from companies
    where tenant_id = new.tenant_id
      and id = new.scope_id
      and deleted_at is null
  ) then
    raise exception 'Empresa do insight nao pertence ao tenant.';
  end if;

  if new.scope_type = 'group' and not exists (
    select 1
    from business_groups
    where tenant_id = new.tenant_id
      and id = new.scope_id
      and deleted_at is null
  ) then
    raise exception 'Grupo do insight nao pertence ao tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists intelligence_insight_states_validate_scope
  on intelligence_insight_states;
create trigger intelligence_insight_states_validate_scope
before insert or update of tenant_id, scope_type, scope_id
on intelligence_insight_states
for each row execute function validate_intelligence_insight_scope();

select tenant_rls_policy('intelligence_insight_states');
select tenant_rls_policy('intelligence_insight_events');

drop trigger if exists intelligence_insight_states_set_updated_at
  on intelligence_insight_states;
create trigger intelligence_insight_states_set_updated_at
before update on intelligence_insight_states
for each row execute function set_updated_at();

commit;
