begin;

create table if not exists tenant_number_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  sequence_key text not null,
  current_value bigint not null default 0 check (current_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sequence_key)
);

create table if not exists domain_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 10 check (max_attempts between 1 and 100),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error_code text,
  last_error_message text,
  idempotency_key text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  check ((status = 'processing') = (locked_at is not null and lock_token is not null)),
  check ((status = 'completed') = (completed_at is not null))
);

create index if not exists domain_outbox_pending_idx
  on domain_outbox (tenant_id, available_at, created_at)
  where status in ('pending', 'failed');
create index if not exists domain_outbox_aggregate_idx
  on domain_outbox (tenant_id, aggregate_type, aggregate_id, created_at desc);

create table if not exists travel_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  reservation_id text not null,
  emission_id uuid,
  cancellation_id uuid not null,
  policy_evaluation_id uuid,
  provider_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'partially_refunded', 'refunded', 'rejected', 'failed')),
  requested_amount numeric(18,2) check (requested_amount is null or requested_amount >= 0),
  refunded_amount numeric(18,2) not null default 0 check (refunded_amount >= 0),
  penalty_amount numeric(18,2) not null default 0 check (penalty_amount >= 0),
  currency char(3) not null default 'BRL' references currencies(code) on delete restrict,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, cancellation_id),
  unique (tenant_id, provider_refund_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, emission_id) references travel_emissions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, cancellation_id) references travel_cancellations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict,
  check (refunded_amount + penalty_amount <= coalesce(requested_amount, refunded_amount + penalty_amount))
);

create index if not exists travel_refunds_status_idx
  on travel_refunds (tenant_id, company_id, status, requested_at desc);

create table if not exists travel_refund_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  refund_id uuid not null,
  idempotency_key text not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('refunded', 'partially_refunded', 'rejected', 'failed')),
  result_snapshot jsonb not null check (jsonb_typeof(result_snapshot) = 'object'),
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, refund_id, idempotency_key),
  foreign key (tenant_id, refund_id) references travel_refunds(tenant_id, id) on delete cascade
);

create index if not exists travel_refund_events_refund_idx
  on travel_refund_events (tenant_id, refund_id, created_at desc);

create table if not exists integration_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  signature_valid boolean not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'rejected', 'failed')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  processed_at timestamptz,
  error_code text,
  unique (tenant_id, id),
  unique (tenant_id, provider, provider_event_id)
);

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'tenant_number_sequences', 'domain_outbox', 'travel_refunds',
    'travel_refund_events', 'integration_webhook_events'
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

drop trigger if exists tenant_number_sequences_set_updated_at on tenant_number_sequences;
create trigger tenant_number_sequences_set_updated_at
before update on tenant_number_sequences for each row execute function set_updated_at();
drop trigger if exists domain_outbox_set_updated_at on domain_outbox;
create trigger domain_outbox_set_updated_at
before update on domain_outbox for each row execute function set_updated_at();
drop trigger if exists travel_refunds_set_updated_at on travel_refunds;
create trigger travel_refunds_set_updated_at
before update on travel_refunds for each row execute function set_updated_at();

commit;
