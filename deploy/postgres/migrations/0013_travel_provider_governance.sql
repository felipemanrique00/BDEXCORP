begin;

create table if not exists travel_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  employee_id text,
  provider text not null,
  provider_quote_id text not null,
  service_type text not null,
  status text not null default 'completed' check (status in ('pending', 'completed', 'selected', 'expired', 'failed')),
  currency char(3) not null default 'BRL',
  minimum_amount numeric(14,2),
  option_count integer not null default 0 check (option_count >= 0),
  policy_evaluation_id uuid,
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  provider_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  expires_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, provider_quote_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict,
  check (minimum_amount is null or minimum_amount >= 0),
  check (expires_at is null or expires_at > created_at)
);

create index if not exists travel_quotes_demand_idx
  on travel_quotes (tenant_id, demand_id, created_at desc);
create index if not exists travel_quotes_company_status_idx
  on travel_quotes (tenant_id, company_id, status, created_at desc);

create table if not exists travel_quote_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_id uuid not null,
  provider_option_id text not null,
  supplier_name text,
  title text not null,
  subtitle text,
  amount numeric(14,2),
  currency char(3) not null default 'BRL',
  refundable boolean,
  policy_status text check (policy_status is null or policy_status in ('respeitada', 'nao_respeitada', 'nao_aplicada')),
  starts_at timestamptz,
  ends_at timestamptz,
  city text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  provider_payload jsonb not null default '{}'::jsonb,
  selected_at timestamptz,
  selected_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_id, provider_option_id),
  foreign key (tenant_id, quote_id) references travel_quotes(tenant_id, id) on delete cascade,
  check (amount is null or amount >= 0),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check ((selected_at is null) = (selected_by is null))
);

create index if not exists travel_quote_options_quote_amount_idx
  on travel_quote_options (tenant_id, quote_id, amount nulls last);

create table if not exists travel_provider_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  reservation_id text,
  quote_id uuid,
  quote_option_id uuid,
  budget_commitment_id uuid,
  provider text not null,
  operation_type text not null check (operation_type in (
    'quote', 'fare', 'reserve', 'status', 'issue', 'cancel',
    'cancel_ticket', 'voucher_data', 'refund', 'rebook'
  )),
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'pending' check (status in (
    'pending', 'succeeded', 'failed', 'requires_reconciliation', 'compensated'
  )),
  attempt_count integer not null default 1 check (attempt_count > 0),
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb,
  provider_reference text,
  provider_locator text,
  error_code text,
  error_message text,
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  started_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, operation_type, idempotency_key),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quote_id) references travel_quotes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quote_option_id) references travel_quote_options(tenant_id, id) on delete restrict,
  foreign key (tenant_id, budget_commitment_id) references budget_commitments(tenant_id, id) on delete restrict,
  check (length(trim(idempotency_key)) between 8 and 200),
  check (request_hash ~ '^[0-9a-f]{64}$'),
  check (response_payload is null or jsonb_typeof(response_payload) in ('object', 'array')),
  check (
    (status = 'pending' and completed_at is null and error_code is null and error_message is null)
    or (status = 'succeeded' and completed_at is not null and response_payload is not null and error_code is null)
    or (status in ('failed', 'requires_reconciliation') and completed_at is not null and error_code is not null)
    or (status = 'compensated' and completed_at is not null)
  )
);

create index if not exists travel_provider_operations_demand_idx
  on travel_provider_operations (tenant_id, demand_id, created_at desc);
create index if not exists travel_provider_operations_pending_idx
  on travel_provider_operations (tenant_id, status, lease_expires_at)
  where status = 'pending';
create index if not exists travel_provider_operations_reference_idx
  on travel_provider_operations (tenant_id, provider, provider_reference)
  where provider_reference is not null;

create table if not exists integration_company_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  provider text not null,
  provider_company_id text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, company_id, provider),
  unique (tenant_id, provider, provider_company_id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  check (length(trim(provider)) between 2 and 120),
  check (length(trim(provider_company_id)) between 1 and 240)
);

create index if not exists integration_company_mappings_provider_idx
  on integration_company_mappings (tenant_id, provider, status, company_id);

create or replace function validate_travel_governance_scope()
returns trigger
language plpgsql
as $$
declare
  demand_company text;
  demand_employee text;
  related_company text;
  related_demand text;
begin
  select company_id, employee_id
    into demand_company, demand_employee
  from demands
  where tenant_id = new.tenant_id and id = new.demand_id and deleted_at is null;

  if demand_company is null then
    raise exception 'Demanda inexistente ou removida para o tenant informado.';
  end if;
  if demand_company <> new.company_id then
    raise exception 'Empresa da operacao nao corresponde a empresa da demanda.';
  end if;

  if tg_table_name = 'travel_quotes' and new.employee_id is not null
     and demand_employee is distinct from new.employee_id then
    raise exception 'Funcionario da cotacao nao corresponde ao funcionario da demanda.';
  end if;

  if tg_table_name = 'travel_provider_operations' then
    if new.reservation_id is not null then
      select company_id, demand_id into related_company, related_demand
      from reservations
      where tenant_id = new.tenant_id and id = new.reservation_id;
      if related_company is distinct from new.company_id or related_demand is distinct from new.demand_id then
        raise exception 'Reserva fora do escopo da demanda/empresa.';
      end if;
    end if;

    if new.quote_id is not null then
      select company_id, demand_id into related_company, related_demand
      from travel_quotes
      where tenant_id = new.tenant_id and id = new.quote_id;
      if related_company is distinct from new.company_id or related_demand is distinct from new.demand_id then
        raise exception 'Cotacao fora do escopo da demanda/empresa.';
      end if;
    end if;

    if new.quote_option_id is not null and not exists (
      select 1 from travel_quote_options option_row
      join travel_quotes quote_row
        on quote_row.tenant_id = option_row.tenant_id and quote_row.id = option_row.quote_id
      where option_row.tenant_id = new.tenant_id and option_row.id = new.quote_option_id
        and quote_row.id = new.quote_id and quote_row.demand_id = new.demand_id
        and quote_row.company_id = new.company_id
    ) then
      raise exception 'Opcao de cotacao fora do escopo da operacao.';
    end if;

    if new.budget_commitment_id is not null and not exists (
      select 1 from budget_commitments commitment
      join budgets budget
        on budget.tenant_id = commitment.tenant_id and budget.id = commitment.budget_id
      where commitment.tenant_id = new.tenant_id and commitment.id = new.budget_commitment_id
        and commitment.demand_id = new.demand_id and budget.company_id = new.company_id
    ) then
      raise exception 'Compromisso orcamentario fora do escopo da operacao.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists travel_quotes_validate_scope on travel_quotes;
create trigger travel_quotes_validate_scope
before insert or update of tenant_id, demand_id, company_id, employee_id on travel_quotes
for each row execute function validate_travel_governance_scope();

drop trigger if exists travel_provider_operations_validate_scope on travel_provider_operations;
create trigger travel_provider_operations_validate_scope
before insert or update of tenant_id, demand_id, company_id, reservation_id, quote_id, quote_option_id, budget_commitment_id on travel_provider_operations
for each row execute function validate_travel_governance_scope();

alter table travel_state_events
  add column if not exists provider_operation_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'travel_state_events_provider_operation_fk'
      and conrelid = 'travel_state_events'::regclass
  ) then
    alter table travel_state_events add constraint travel_state_events_provider_operation_fk
      foreign key (tenant_id, provider_operation_id)
      references travel_provider_operations(tenant_id, id) on delete restrict;
  end if;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'travel_quotes', 'travel_quote_options', 'travel_provider_operations',
    'integration_company_mappings'
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

drop trigger if exists travel_quotes_set_updated_at on travel_quotes;
create trigger travel_quotes_set_updated_at
before update on travel_quotes for each row execute function set_updated_at();

drop trigger if exists travel_provider_operations_set_updated_at on travel_provider_operations;
create trigger travel_provider_operations_set_updated_at
before update on travel_provider_operations for each row execute function set_updated_at();

drop trigger if exists integration_company_mappings_set_updated_at on integration_company_mappings;
create trigger integration_company_mappings_set_updated_at
before update on integration_company_mappings for each row execute function set_updated_at();

commit;
