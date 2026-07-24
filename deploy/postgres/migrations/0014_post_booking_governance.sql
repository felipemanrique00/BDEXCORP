begin;

alter table budget_commitments
  add column if not exists consumed_at timestamptz;

alter table budget_commitments
  drop constraint if exists budget_commitments_status_check;
alter table budget_commitments
  add constraint budget_commitments_status_check
  check (status in ('held', 'committed', 'consumed', 'released', 'cancelled'));

alter table reservations
  add column if not exists selected_quote_id uuid,
  add column if not exists selected_quote_option_id uuid,
  add column if not exists last_policy_evaluation_id uuid,
  add column if not exists issued_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists version bigint not null default 1 check (version > 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_selected_quote_fk'
      and conrelid = 'reservations'::regclass
  ) then
    alter table reservations add constraint reservations_selected_quote_fk
      foreign key (tenant_id, selected_quote_id)
      references travel_quotes(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_selected_quote_option_fk'
      and conrelid = 'reservations'::regclass
  ) then
    alter table reservations add constraint reservations_selected_quote_option_fk
      foreign key (tenant_id, selected_quote_option_id)
      references travel_quote_options(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_last_policy_evaluation_fk'
      and conrelid = 'reservations'::regclass
  ) then
    alter table reservations add constraint reservations_last_policy_evaluation_fk
      foreign key (tenant_id, last_policy_evaluation_id)
      references policy_evaluations(tenant_id, id) on delete restrict;
  end if;
end;
$$;

create table if not exists travel_emissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  reservation_id text not null,
  provider_operation_id uuid not null,
  policy_evaluation_id uuid,
  provider text not null,
  provider_emission_id text not null,
  ticket_number text,
  status text not null check (status in (
    'issued', 'partially_issued', 'cancelled', 'pending_refund', 'refunded'
  )),
  gross_amount numeric(14,2) not null default 0 check (gross_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  final_amount numeric(14,2) not null default 0 check (final_amount >= 0),
  currency char(3) not null default 'BRL',
  provider_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  issued_by uuid references users(id) on delete set null,
  issued_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_operation_id),
  unique (tenant_id, provider, provider_emission_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, provider_operation_id) references travel_provider_operations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict,
  check (final_amount <= gross_amount + tax_amount or gross_amount = 0)
);

create index if not exists travel_emissions_reservation_idx
  on travel_emissions (tenant_id, reservation_id, issued_at desc);
create index if not exists travel_emissions_company_status_idx
  on travel_emissions (tenant_id, company_id, status, issued_at desc);
create unique index if not exists travel_emissions_ticket_unique_idx
  on travel_emissions (tenant_id, provider, ticket_number)
  where ticket_number is not null and length(trim(ticket_number)) > 0;

create table if not exists travel_cancellations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  reservation_id text not null,
  emission_id uuid,
  provider_operation_id uuid not null,
  policy_evaluation_id uuid,
  cancellation_type text not null check (cancellation_type in ('reservation', 'ticket')),
  status text not null check (status in ('confirmed', 'pending_refund', 'refunded')),
  reason text,
  provider_reference text,
  refund_amount numeric(14,2) check (refund_amount is null or refund_amount >= 0),
  currency char(3) not null default 'BRL',
  provider_payload jsonb not null default '{}'::jsonb,
  requested_by uuid references users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_operation_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, emission_id) references travel_emissions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, provider_operation_id) references travel_provider_operations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict
);

create index if not exists travel_cancellations_reservation_idx
  on travel_cancellations (tenant_id, reservation_id, created_at desc);

create table if not exists travel_policy_justifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  reservation_id text,
  policy_evaluation_id uuid not null,
  checkpoint text not null,
  justification text not null check (length(trim(justification)) between 3 and 2000),
  submitted_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, policy_evaluation_id, checkpoint),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_evaluation_id) references policy_evaluations(tenant_id, id) on delete restrict
);

create or replace function validate_post_booking_scope()
returns trigger
language plpgsql
as $$
declare
  reservation_company text;
  reservation_demand text;
  emission_company text;
  emission_demand text;
  emission_reservation text;
begin
  if new.reservation_id is not null then
    select company_id, demand_id into reservation_company, reservation_demand
    from reservations
    where tenant_id = new.tenant_id and id = new.reservation_id;

    if reservation_company is null
       or reservation_company <> new.company_id
       or reservation_demand is distinct from new.demand_id then
      raise exception 'Reserva fora do escopo da demanda/empresa.';
    end if;
  end if;

  if tg_table_name = 'travel_cancellations' and new.emission_id is not null then
    select company_id, demand_id, reservation_id
      into emission_company, emission_demand, emission_reservation
    from travel_emissions
    where tenant_id = new.tenant_id and id = new.emission_id;

    if emission_company is null
       or emission_company <> new.company_id
       or emission_demand <> new.demand_id
       or emission_reservation <> new.reservation_id then
      raise exception 'Emissao fora do escopo do cancelamento.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists travel_emissions_validate_scope on travel_emissions;
create trigger travel_emissions_validate_scope
before insert or update of tenant_id, demand_id, company_id, reservation_id on travel_emissions
for each row execute function validate_post_booking_scope();

drop trigger if exists travel_cancellations_validate_scope on travel_cancellations;
create trigger travel_cancellations_validate_scope
before insert or update of tenant_id, demand_id, company_id, reservation_id, emission_id on travel_cancellations
for each row execute function validate_post_booking_scope();

drop trigger if exists travel_policy_justifications_validate_scope on travel_policy_justifications;
create trigger travel_policy_justifications_validate_scope
before insert or update of tenant_id, demand_id, company_id, reservation_id on travel_policy_justifications
for each row execute function validate_post_booking_scope();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'travel_emissions', 'travel_cancellations', 'travel_policy_justifications'
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

drop trigger if exists travel_emissions_set_updated_at on travel_emissions;
create trigger travel_emissions_set_updated_at
before update on travel_emissions for each row execute function set_updated_at();

drop trigger if exists travel_cancellations_set_updated_at on travel_cancellations;
create trigger travel_cancellations_set_updated_at
before update on travel_cancellations for each row execute function set_updated_at();

commit;
