begin;

-- Dados solicitados para o produto aereo. A demanda continua sendo a raiz do
-- ciclo de vida; estas tabelas guardam apenas o contrato especifico do servico.
create table if not exists air_demand_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  trip_type text not null default 'round_trip'
    check (trip_type in ('one_way', 'round_trip', 'multi_city')),
  cabin_class text not null default 'economy'
    check (cabin_class in ('economy', 'premium_economy', 'business', 'first')),
  fare_family text,
  preferred_airline_codes text[] not null default '{}'::text[]
    check (cardinality(preferred_airline_codes) <= 20),
  direct_only boolean not null default false,
  baggage_required boolean not null default false,
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  notes text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, demand_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade
);

create table if not exists air_demand_legs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  sequence smallint not null check (sequence between 1 and 32),
  origin_code varchar(3) not null check (origin_code ~ '^[A-Z]{3}$'),
  origin_name text,
  destination_code varchar(3) not null check (destination_code ~ '^[A-Z]{3}$'),
  destination_name text,
  departure_date date not null,
  earliest_departure time,
  latest_departure time,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, demand_id, sequence),
  foreign key (tenant_id, demand_id)
    references air_demand_details(tenant_id, demand_id) on delete cascade,
  check (origin_code <> destination_code),
  check (latest_departure is null or earliest_departure is null or latest_departure >= earliest_departure)
);

create index if not exists air_demand_legs_search_idx
  on air_demand_legs (tenant_id, origin_code, destination_code, departure_date);

-- Snapshot comercial da opcao publicada pelo consultor. Valores sao salvos
-- em centavos para manter a soma auditavel e sem arredondamento binario.
create table if not exists air_quote_option_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  reservation_system text not null,
  locator text,
  validating_airline_code varchar(3) not null
    check (validating_airline_code ~ '^[A-Z0-9]{2,3}$'),
  validating_airline_name text not null,
  cabin_class text not null,
  fare_family text,
  baggage_pieces smallint not null default 0 check (baggage_pieces between 0 and 9),
  issuance_deadline timestamptz,
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  mileage integer not null default 0 check (mileage >= 0),
  reference_fare_minor bigint not null default 0 check (reference_fare_minor >= 0),
  fare_amount_minor bigint not null check (fare_amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  rav_amount_minor bigint not null default 0 check (rav_amount_minor >= 0),
  rac_amount_minor bigint not null default 0 check (rac_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  refundable boolean,
  change_policy text,
  cancellation_policy text,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, quote_option_id),
  foreign key (tenant_id, quote_option_id)
    references travel_quote_options(tenant_id, id) on delete cascade,
  check (btrim(reservation_system) <> ''),
  check (btrim(validating_airline_name) <> ''),
  check (btrim(cabin_class) <> ''),
  check (total_amount_minor = fare_amount_minor + tax_amount_minor + rav_amount_minor + rac_amount_minor)
);

create index if not exists air_quote_option_deadline_idx
  on air_quote_option_details (tenant_id, issuance_deadline)
  where issuance_deadline is not null;

create table if not exists air_quote_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  sequence smallint not null check (sequence between 1 and 64),
  airline_code varchar(3) not null check (airline_code ~ '^[A-Z0-9]{2,3}$'),
  airline_name text not null,
  flight_number varchar(8) not null check (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  booking_class varchar(2) not null,
  cabin_class text not null,
  baggage_pieces smallint not null default 0 check (baggage_pieces between 0 and 9),
  origin_code varchar(3) not null check (origin_code ~ '^[A-Z]{3}$'),
  origin_name text,
  destination_code varchar(3) not null check (destination_code ~ '^[A-Z]{3}$'),
  destination_name text,
  departs_at timestamptz not null,
  arrives_at timestamptz not null,
  equipment text,
  status text not null default 'quoted'
    check (status in ('quoted', 'reserved', 'issued', 'cancelled')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_option_id, sequence),
  foreign key (tenant_id, quote_option_id)
    references air_quote_option_details(tenant_id, quote_option_id) on delete cascade,
  check (origin_code <> destination_code),
  check (arrives_at > departs_at),
  check (btrim(airline_name) <> ''),
  check (btrim(booking_class) <> ''),
  check (btrim(cabin_class) <> '')
);

create index if not exists air_quote_segments_route_idx
  on air_quote_segments (tenant_id, origin_code, destination_code, departs_at);

create table if not exists air_reservation_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  reservation_id text not null,
  source_quote_option_id uuid,
  reservation_system text not null,
  locator text not null,
  issuance_deadline timestamptz,
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  mileage integer not null default 0 check (mileage >= 0),
  reference_fare_minor bigint not null default 0 check (reference_fare_minor >= 0),
  fare_amount_minor bigint not null check (fare_amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  rav_amount_minor bigint not null default 0 check (rav_amount_minor >= 0),
  rac_amount_minor bigint not null default 0 check (rac_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  change_policy text,
  cancellation_policy text,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reservation_id),
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_quote_option_id)
    references travel_quote_options(tenant_id, id) on delete restrict,
  check (btrim(reservation_system) <> ''),
  check (btrim(locator) <> ''),
  check (total_amount_minor = fare_amount_minor + tax_amount_minor + rav_amount_minor + rac_amount_minor)
);

create index if not exists air_reservation_locator_idx
  on air_reservation_details (tenant_id, reservation_system, locator);

create table if not exists air_reservation_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reservation_id text not null,
  source_quote_segment_id uuid,
  sequence smallint not null check (sequence between 1 and 64),
  airline_code varchar(3) not null check (airline_code ~ '^[A-Z0-9]{2,3}$'),
  airline_name text not null,
  flight_number varchar(8) not null check (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  booking_class varchar(2) not null,
  cabin_class text not null,
  baggage_pieces smallint not null default 0 check (baggage_pieces between 0 and 9),
  origin_code varchar(3) not null check (origin_code ~ '^[A-Z]{3}$'),
  origin_name text,
  destination_code varchar(3) not null check (destination_code ~ '^[A-Z]{3}$'),
  destination_name text,
  departs_at timestamptz not null,
  arrives_at timestamptz not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'issued', 'cancelled', 'changed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reservation_id, sequence),
  foreign key (tenant_id, reservation_id)
    references air_reservation_details(tenant_id, reservation_id) on delete cascade,
  foreign key (tenant_id, source_quote_segment_id)
    references air_quote_segments(tenant_id, id) on delete restrict,
  check (origin_code <> destination_code),
  check (arrives_at > departs_at)
);

create index if not exists air_reservation_segments_route_idx
  on air_reservation_segments (tenant_id, reservation_id, sequence);

create table if not exists air_emission_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  emission_id uuid not null,
  reservation_id text not null,
  demand_traveler_id uuid,
  passenger_name text not null,
  ticket_number text not null,
  issuing_airline_code varchar(3) not null check (issuing_airline_code ~ '^[A-Z0-9]{2,3}$'),
  issuing_airline_name text not null,
  fare_amount_minor bigint not null default 0 check (fare_amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  total_amount_minor bigint not null default 0 check (total_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'issued'
    check (status in ('issued', 'voided', 'cancelled', 'refunded')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  issued_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ticket_number),
  unique (tenant_id, emission_id, demand_traveler_id),
  foreign key (tenant_id, emission_id) references travel_emissions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_traveler_id) references demand_travelers(tenant_id, id) on delete restrict,
  check (btrim(passenger_name) <> ''),
  check (btrim(ticket_number) <> ''),
  check (btrim(issuing_airline_name) <> ''),
  check (total_amount_minor = fare_amount_minor + tax_amount_minor)
);

create index if not exists air_emission_tickets_reservation_idx
  on air_emission_tickets (tenant_id, reservation_id, issued_at desc);

-- Evita que um bilhete seja vinculado a uma reserva diferente da emissao.
create or replace function validate_air_emission_ticket_scope()
returns trigger
language plpgsql
as $$
declare
  emission_reservation text;
  emission_demand text;
  traveler_demand text;
begin
  select reservation_id, demand_id into emission_reservation, emission_demand
  from travel_emissions
  where tenant_id = new.tenant_id and id = new.emission_id;

  if emission_reservation is null or emission_reservation <> new.reservation_id then
    raise exception 'Bilhete aereo fora do escopo da emissao/reserva.';
  end if;

  if new.demand_traveler_id is not null then
    select demand_id into traveler_demand
    from demand_travelers
    where tenant_id = new.tenant_id and id = new.demand_traveler_id and deleted_at is null;
    if traveler_demand is null or traveler_demand <> emission_demand then
      raise exception 'Passageiro fora do escopo da emissao.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists air_emission_tickets_validate_scope on air_emission_tickets;
create trigger air_emission_tickets_validate_scope
before insert or update of tenant_id, emission_id, reservation_id, demand_traveler_id
on air_emission_tickets
for each row execute function validate_air_emission_ticket_scope();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'air_demand_details', 'air_demand_legs',
    'air_quote_option_details', 'air_quote_segments',
    'air_reservation_details', 'air_reservation_segments',
    'air_emission_tickets'
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

drop trigger if exists air_demand_details_set_updated_at on air_demand_details;
create trigger air_demand_details_set_updated_at
before update on air_demand_details for each row execute function set_updated_at();
drop trigger if exists air_demand_legs_set_updated_at on air_demand_legs;
create trigger air_demand_legs_set_updated_at
before update on air_demand_legs for each row execute function set_updated_at();
drop trigger if exists air_quote_option_details_set_updated_at on air_quote_option_details;
create trigger air_quote_option_details_set_updated_at
before update on air_quote_option_details for each row execute function set_updated_at();
drop trigger if exists air_quote_segments_set_updated_at on air_quote_segments;
create trigger air_quote_segments_set_updated_at
before update on air_quote_segments for each row execute function set_updated_at();
drop trigger if exists air_reservation_details_set_updated_at on air_reservation_details;
create trigger air_reservation_details_set_updated_at
before update on air_reservation_details for each row execute function set_updated_at();
drop trigger if exists air_reservation_segments_set_updated_at on air_reservation_segments;
create trigger air_reservation_segments_set_updated_at
before update on air_reservation_segments for each row execute function set_updated_at();
drop trigger if exists air_emission_tickets_set_updated_at on air_emission_tickets;
create trigger air_emission_tickets_set_updated_at
before update on air_emission_tickets for each row execute function set_updated_at();

commit;
