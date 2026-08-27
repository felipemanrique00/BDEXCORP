begin;

-- Fundacao relacional para os produtos terrestres offline do Portal Empresa.
-- O ciclo de vida, as cotacoes genericas, a escolha formal, as aprovacoes,
-- reservas, emissoes e vouchers continuam nas tabelas compartilhadas. Esta
-- migration guarda apenas catalogo, proveniencia e snapshots especificos de
-- locacao de veiculo e rodoviario.

create table if not exists offline_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_key citext not null,
  source_name text not null,
  source_kind text not null check (source_kind in (
    'manual', 'supplier_site', 'official_directory', 'contract_import',
    'government_open_data', 'integration', 'local_fixture'
  )),
  refresh_mode text not null default 'manual'
    check (refresh_mode in ('manual', 'file_import', 'api')),
  base_url text,
  license_name text,
  license_url text,
  authoritative_for text[] not null default '{}'::text[],
  review_interval_days integer check (
    review_interval_days is null or review_interval_days between 1 and 3650
  ),
  last_observed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, source_key),
  check (btrim(source_key::text) <> ''),
  check (btrim(source_name) <> ''),
  check (base_url is null or base_url ~ '^https?://'),
  check (license_url is null or license_url ~ '^https?://'),
  check (array_position(authoritative_for, null) is null),
  check (deleted_at is null or status = 'inactive')
);

create table if not exists rental_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null,
  source_id uuid,
  internal_code citext not null,
  external_code text,
  name text not null,
  location_type text not null default 'urban' check (location_type in (
    'airport', 'urban', 'bus_terminal', 'rail_station', 'hotel', 'other'
  )),
  country_id uuid references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  city_id uuid references geo_cities(id) on delete restrict,
  address_id uuid,
  address_text text,
  postal_code text,
  airport_iata varchar(3),
  timezone text,
  opening_hours jsonb not null default '{}'::jsonb
    check (jsonb_typeof(opening_hours) = 'object'),
  reservation_channels jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reservation_channels) = 'object'),
  source_record_key text,
  source_url text,
  source_observed_at timestamptz,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'stale', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, supplier_id, internal_code),
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id)
    references offline_catalog_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, address_id)
    references postal_addresses(tenant_id, id) on delete restrict,
  foreign key (country_id, subdivision_id)
    references geo_subdivisions(country_id, id) on delete restrict,
  foreign key (country_id, city_id)
    references geo_cities(country_id, id) on delete restrict,
  foreign key (subdivision_id, city_id)
    references geo_cities(subdivision_id, id) on delete restrict,
  check (btrim(internal_code::text) <> ''),
  check (btrim(name) <> ''),
  check (airport_iata is null or airport_iata ~ '^[A-Z]{3}$'),
  check (source_url is null or source_url ~ '^https?://'),
  check (review_status <> 'verified' or (reviewed_at is not null and reviewed_by is not null)),
  check (reviewed_at is not null or reviewed_by is null),
  check (deleted_at is null or status = 'inactive')
);

create unique index if not exists rental_locations_source_record_uidx
  on rental_locations (tenant_id, source_id, source_record_key)
  where source_id is not null and source_record_key is not null and deleted_at is null;
create index if not exists rental_locations_search_idx
  on rental_locations (tenant_id, city_id, status, lower(name))
  where deleted_at is null;

create table if not exists bus_terminals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid,
  internal_code citext not null,
  external_code text,
  name text not null,
  terminal_type text not null default 'bus_terminal'
    check (terminal_type in ('bus_terminal', 'bus_station', 'stop', 'other')),
  country_id uuid references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  city_id uuid not null references geo_cities(id) on delete restrict,
  address_id uuid,
  address_text text,
  postal_code text,
  timezone text,
  amenities jsonb not null default '{}'::jsonb check (jsonb_typeof(amenities) = 'object'),
  source_record_key text,
  source_url text,
  source_observed_at timestamptz,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'stale', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, internal_code),
  foreign key (tenant_id, source_id)
    references offline_catalog_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, address_id)
    references postal_addresses(tenant_id, id) on delete restrict,
  foreign key (country_id, subdivision_id)
    references geo_subdivisions(country_id, id) on delete restrict,
  foreign key (country_id, city_id)
    references geo_cities(country_id, id) on delete restrict,
  foreign key (subdivision_id, city_id)
    references geo_cities(subdivision_id, id) on delete restrict,
  check (btrim(internal_code::text) <> ''),
  check (btrim(name) <> ''),
  check (source_url is null or source_url ~ '^https?://'),
  check (review_status <> 'verified' or (reviewed_at is not null and reviewed_by is not null)),
  check (reviewed_at is not null or reviewed_by is null),
  check (deleted_at is null or status = 'inactive')
);

create unique index if not exists bus_terminals_source_record_uidx
  on bus_terminals (tenant_id, source_id, source_record_key)
  where source_id is not null and source_record_key is not null and deleted_at is null;
create index if not exists bus_terminals_search_idx
  on bus_terminals (tenant_id, city_id, status, lower(name))
  where deleted_at is null;

create table if not exists bus_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null,
  source_id uuid,
  route_code citext not null,
  external_authorization_reference text,
  service_kind text not null default 'regular'
    check (service_kind in ('regular', 'semiurban', 'charter', 'other')),
  origin_city_id uuid not null references geo_cities(id) on delete restrict,
  destination_city_id uuid not null references geo_cities(id) on delete restrict,
  origin_terminal_id uuid,
  destination_terminal_id uuid,
  valid_from date,
  valid_until date,
  source_record_key text,
  source_url text,
  source_observed_at timestamptz,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'stale', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, supplier_id, route_code),
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id)
    references offline_catalog_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, origin_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, destination_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  check (btrim(route_code::text) <> ''),
  check (origin_city_id <> destination_city_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (source_url is null or source_url ~ '^https?://'),
  check (review_status <> 'verified' or (reviewed_at is not null and reviewed_by is not null)),
  check (reviewed_at is not null or reviewed_by is null),
  check (deleted_at is null or status = 'inactive')
);

create unique index if not exists bus_routes_source_record_uidx
  on bus_routes (tenant_id, source_id, source_record_key)
  where source_id is not null and source_record_key is not null and deleted_at is null;
create index if not exists bus_routes_market_idx
  on bus_routes (tenant_id, origin_city_id, destination_city_id, status)
  where deleted_at is null;

create table if not exists car_demand_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  pickup_location_id uuid,
  return_location_id uuid,
  pickup_location_text text,
  return_location_text text,
  pickup_at timestamptz not null,
  return_at timestamptz not null,
  primary_driver_traveler_id uuid,
  desired_category text,
  automatic_transmission boolean,
  air_conditioning boolean,
  unlimited_mileage boolean,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  notes text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, demand_id),
  foreign key (tenant_id, demand_id)
    references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, pickup_location_id)
    references rental_locations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, return_location_id)
    references rental_locations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id, primary_driver_traveler_id)
    references demand_travelers(tenant_id, demand_id, id) on delete restrict,
  check (return_at > pickup_at),
  check (pickup_location_id is not null or nullif(btrim(pickup_location_text), '') is not null),
  check (return_location_id is not null or nullif(btrim(return_location_text), '') is not null)
);

create index if not exists car_demand_details_period_idx
  on car_demand_details (tenant_id, pickup_at, return_at);

create table if not exists bus_demand_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  trip_type text not null default 'one_way'
    check (trip_type in ('one_way', 'round_trip', 'multi_city')),
  preferred_class text,
  seat_preference text,
  accessibility_required boolean not null default false,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  notes text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, demand_id),
  foreign key (tenant_id, demand_id)
    references demands(tenant_id, id) on delete cascade
);

create table if not exists bus_demand_legs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  sequence smallint not null check (sequence between 1 and 32),
  origin_city_id uuid not null references geo_cities(id) on delete restrict,
  destination_city_id uuid not null references geo_cities(id) on delete restrict,
  origin_terminal_id uuid,
  destination_terminal_id uuid,
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
    references bus_demand_details(tenant_id, demand_id) on delete cascade,
  foreign key (tenant_id, origin_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, destination_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  check (origin_city_id <> destination_city_id),
  check (latest_departure is null or earliest_departure is null or latest_departure >= earliest_departure)
);

create index if not exists bus_demand_legs_market_idx
  on bus_demand_legs (tenant_id, origin_city_id, destination_city_id, departure_date);

create table if not exists car_quote_option_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  supplier_id uuid not null,
  pickup_location_id uuid not null,
  return_location_id uuid not null,
  category_code text,
  category_name text not null,
  vehicle_example text,
  rental_days smallint not null check (rental_days between 1 and 366),
  daily_amount_minor bigint not null check (daily_amount_minor >= 0),
  protection_amount_minor bigint not null default 0 check (protection_amount_minor >= 0),
  fee_amount_minor bigint not null default 0 check (fee_amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  mileage_policy text,
  fuel_policy text,
  deposit_policy text,
  protections jsonb not null default '[]'::jsonb check (jsonb_typeof(protections) = 'array'),
  cancellation_policy text,
  issuance_deadline timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, quote_option_id),
  foreign key (tenant_id, quote_option_id)
    references travel_quote_options(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, pickup_location_id)
    references rental_locations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, return_location_id)
    references rental_locations(tenant_id, id) on delete restrict,
  check (btrim(category_name) <> ''),
  check (
    total_amount_minor = daily_amount_minor * rental_days
      + protection_amount_minor + fee_amount_minor + tax_amount_minor
  )
);

create table if not exists bus_quote_option_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  supplier_id uuid not null,
  route_id uuid,
  service_number text,
  class_name text not null,
  baggage_pieces smallint not null default 1 check (baggage_pieces between 0 and 9),
  refundable boolean,
  issuance_deadline timestamptz,
  fare_amount_minor bigint not null check (fare_amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  fee_amount_minor bigint not null default 0 check (fee_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  change_policy text,
  cancellation_policy text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, quote_option_id),
  foreign key (tenant_id, quote_option_id)
    references travel_quote_options(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, route_id)
    references bus_routes(tenant_id, id) on delete restrict,
  check (btrim(class_name) <> ''),
  check (total_amount_minor = fare_amount_minor + tax_amount_minor + fee_amount_minor)
);

create table if not exists bus_quote_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  demand_leg_id uuid,
  route_id uuid not null,
  sequence smallint not null check (sequence between 1 and 64),
  origin_city_id uuid not null references geo_cities(id) on delete restrict,
  destination_city_id uuid not null references geo_cities(id) on delete restrict,
  origin_terminal_id uuid,
  destination_terminal_id uuid,
  departs_at timestamptz not null,
  arrives_at timestamptz not null,
  service_number text,
  class_name text not null,
  seat_available boolean,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_option_id, sequence),
  foreign key (tenant_id, quote_option_id)
    references bus_quote_option_details(tenant_id, quote_option_id) on delete cascade,
  foreign key (tenant_id, demand_leg_id)
    references bus_demand_legs(tenant_id, id) on delete restrict,
  foreign key (tenant_id, route_id)
    references bus_routes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, origin_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, destination_terminal_id)
    references bus_terminals(tenant_id, id) on delete restrict,
  check (origin_city_id <> destination_city_id),
  check (arrives_at > departs_at),
  check (btrim(class_name) <> '')
);

create index if not exists bus_quote_segments_market_idx
  on bus_quote_segments (tenant_id, origin_city_id, destination_city_id, departs_at);

create or replace function validate_ground_catalog_supplier()
returns trigger
language plpgsql
as $$
declare
  expected_service text;
  supplier_ok boolean;
begin
  expected_service := case
    when tg_table_name in ('rental_locations', 'car_quote_option_details') then 'car'
    else 'bus'
  end;

  select exists (
    select 1
    from commercial_suppliers supplier
    where supplier.tenant_id = new.tenant_id
      and supplier.id = new.supplier_id
      and supplier.status = 'active'
      and supplier.deleted_at is null
      and supplier.service_types @> array[expected_service]::text[]
  ) into supplier_ok;

  if not supplier_ok then
    raise exception 'Fornecedor comercial inativo ou sem o servico %.', expected_service;
  end if;
  return new;
end;
$$;

drop trigger if exists rental_locations_validate_supplier on rental_locations;
create trigger rental_locations_validate_supplier
before insert or update of tenant_id, supplier_id on rental_locations
for each row execute function validate_ground_catalog_supplier();

drop trigger if exists bus_routes_validate_supplier on bus_routes;
create trigger bus_routes_validate_supplier
before insert or update of tenant_id, supplier_id on bus_routes
for each row execute function validate_ground_catalog_supplier();

drop trigger if exists car_quote_option_details_validate_supplier on car_quote_option_details;
create trigger car_quote_option_details_validate_supplier
before insert or update of tenant_id, supplier_id on car_quote_option_details
for each row execute function validate_ground_catalog_supplier();

drop trigger if exists bus_quote_option_details_validate_supplier on bus_quote_option_details;
create trigger bus_quote_option_details_validate_supplier
before insert or update of tenant_id, supplier_id on bus_quote_option_details
for each row execute function validate_ground_catalog_supplier();

create or replace function validate_ground_terminal_city_scope()
returns trigger
language plpgsql
as $$
declare
  origin_terminal_city uuid;
  destination_terminal_city uuid;
begin
  if new.origin_terminal_id is not null then
    select city_id into origin_terminal_city
    from bus_terminals
    where tenant_id = new.tenant_id and id = new.origin_terminal_id
      and status = 'active' and deleted_at is null;
    if origin_terminal_city is distinct from new.origin_city_id then
      raise exception 'Terminal de origem nao pertence a cidade de origem.';
    end if;
  end if;
  if new.destination_terminal_id is not null then
    select city_id into destination_terminal_city
    from bus_terminals
    where tenant_id = new.tenant_id and id = new.destination_terminal_id
      and status = 'active' and deleted_at is null;
    if destination_terminal_city is distinct from new.destination_city_id then
      raise exception 'Terminal de destino nao pertence a cidade de destino.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bus_routes_validate_terminal_city on bus_routes;
create trigger bus_routes_validate_terminal_city
before insert or update of tenant_id, origin_city_id, destination_city_id,
  origin_terminal_id, destination_terminal_id on bus_routes
for each row execute function validate_ground_terminal_city_scope();

drop trigger if exists bus_demand_legs_validate_terminal_city on bus_demand_legs;
create trigger bus_demand_legs_validate_terminal_city
before insert or update of tenant_id, origin_city_id, destination_city_id,
  origin_terminal_id, destination_terminal_id on bus_demand_legs
for each row execute function validate_ground_terminal_city_scope();

drop trigger if exists bus_quote_segments_validate_terminal_city on bus_quote_segments;
create trigger bus_quote_segments_validate_terminal_city
before insert or update of tenant_id, origin_city_id, destination_city_id,
  origin_terminal_id, destination_terminal_id on bus_quote_segments
for each row execute function validate_ground_terminal_city_scope();

create or replace function validate_ground_demand_service_scope()
returns trigger
language plpgsql
as $$
declare
  demand_service text;
  expected_services text[];
begin
  select lower(btrim(service_type)) into demand_service
  from demands
  where tenant_id = new.tenant_id and id = new.demand_id and deleted_at is null;

  expected_services := case
    when tg_table_name = 'car_demand_details'
      then array[
        'car', 'carro', 'locacao', 'locacao de veiculo',
        'locação', 'locação de veículo'
      ]::text[]
    else array[
      'bus', 'rodoviario', 'onibus', 'passagem rodoviaria',
      'rodoviário', 'ônibus', 'passagem rodoviária'
    ]::text[]
  end;

  if demand_service is null or not (demand_service = any(expected_services)) then
    raise exception 'Detalhe terrestre nao corresponde ao servico da demanda.';
  end if;
  return new;
end;
$$;

drop trigger if exists car_demand_details_validate_service on car_demand_details;
create trigger car_demand_details_validate_service
before insert or update of tenant_id, demand_id on car_demand_details
for each row execute function validate_ground_demand_service_scope();

drop trigger if exists bus_demand_details_validate_service on bus_demand_details;
create trigger bus_demand_details_validate_service
before insert or update of tenant_id, demand_id on bus_demand_details
for each row execute function validate_ground_demand_service_scope();

create or replace function validate_ground_quote_option_scope()
returns trigger
language plpgsql
as $$
declare
  quote_service text;
  route_supplier uuid;
  pickup_supplier uuid;
  return_supplier uuid;
begin
  select lower(btrim(quote.service_type)) into quote_service
  from travel_quote_options option_row
  join travel_quotes quote
    on quote.tenant_id = option_row.tenant_id and quote.id = option_row.quote_id
  where option_row.tenant_id = new.tenant_id and option_row.id = new.quote_option_id;

  if tg_table_name = 'car_quote_option_details' then
    if quote_service is null or quote_service not in ('car', 'carro', 'locacao', 'locação') then
      raise exception 'Detalhe de carro nao corresponde ao servico da cotacao.';
    end if;
    select supplier_id into pickup_supplier from rental_locations
      where tenant_id = new.tenant_id and id = new.pickup_location_id;
    select supplier_id into return_supplier from rental_locations
      where tenant_id = new.tenant_id and id = new.return_location_id;
    if pickup_supplier is distinct from new.supplier_id
       or return_supplier is distinct from new.supplier_id then
      raise exception 'Lojas da opcao nao pertencem a locadora informada.';
    end if;
  else
    if quote_service is null or quote_service not in (
      'bus', 'rodoviario', 'onibus', 'rodoviário', 'ônibus'
    ) then
      raise exception 'Detalhe rodoviario nao corresponde ao servico da cotacao.';
    end if;
    if new.route_id is not null then
      select supplier_id into route_supplier from bus_routes
        where tenant_id = new.tenant_id and id = new.route_id;
      if route_supplier is distinct from new.supplier_id then
        raise exception 'Linha rodoviaria nao pertence a operadora informada.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists car_quote_option_details_validate_scope on car_quote_option_details;
create trigger car_quote_option_details_validate_scope
before insert or update of tenant_id, quote_option_id, supplier_id,
  pickup_location_id, return_location_id on car_quote_option_details
for each row execute function validate_ground_quote_option_scope();

drop trigger if exists bus_quote_option_details_validate_scope on bus_quote_option_details;
create trigger bus_quote_option_details_validate_scope
before insert or update of tenant_id, quote_option_id, supplier_id, route_id
on bus_quote_option_details
for each row execute function validate_ground_quote_option_scope();

create or replace function validate_bus_quote_segment_route_scope()
returns trigger
language plpgsql
as $$
declare
  option_supplier uuid;
  route_supplier uuid;
  route_origin uuid;
  route_destination uuid;
  route_origin_terminal uuid;
  route_destination_terminal uuid;
  route_valid_from date;
  route_valid_until date;
  route_timezone text;
  quote_demand_id text;
  leg_demand_id text;
begin
  select supplier_id into option_supplier
  from bus_quote_option_details
  where tenant_id = new.tenant_id and quote_option_id = new.quote_option_id;

  select route.supplier_id, route.origin_city_id, route.destination_city_id,
         route.origin_terminal_id, route.destination_terminal_id,
         route.valid_from, route.valid_until,
         coalesce(origin_terminal.timezone, 'UTC')
    into route_supplier, route_origin, route_destination,
         route_origin_terminal, route_destination_terminal,
         route_valid_from, route_valid_until, route_timezone
  from bus_routes route
  left join bus_terminals origin_terminal
    on origin_terminal.tenant_id = route.tenant_id and origin_terminal.id = route.origin_terminal_id
  left join bus_terminals destination_terminal
    on destination_terminal.tenant_id = route.tenant_id and destination_terminal.id = route.destination_terminal_id
  where route.tenant_id = new.tenant_id and route.id = new.route_id
    and route.status = 'active' and route.deleted_at is null and route.review_status = 'verified'
    and (route.origin_terminal_id is null or (
      origin_terminal.status = 'active' and origin_terminal.deleted_at is null
      and origin_terminal.review_status = 'verified'
    ))
    and (route.destination_terminal_id is null or (
      destination_terminal.status = 'active' and destination_terminal.deleted_at is null
      and destination_terminal.review_status = 'verified'
    ));

  select quote.demand_id into quote_demand_id
  from bus_quote_option_details detail
  join travel_quote_options option_row
    on option_row.tenant_id = detail.tenant_id and option_row.id = detail.quote_option_id
  join travel_quotes quote
    on quote.tenant_id = option_row.tenant_id and quote.id = option_row.quote_id
  where detail.tenant_id = new.tenant_id and detail.quote_option_id = new.quote_option_id;

  select demand_id into leg_demand_id
  from bus_demand_legs
  where tenant_id = new.tenant_id and id = new.demand_leg_id;

  if option_supplier is null or route_supplier is distinct from option_supplier
     or quote_demand_id is null or leg_demand_id is distinct from quote_demand_id
     or route_origin is distinct from new.origin_city_id
     or route_destination is distinct from new.destination_city_id
     or (route_origin_terminal is not null and route_origin_terminal is distinct from new.origin_terminal_id)
     or (route_destination_terminal is not null and route_destination_terminal is distinct from new.destination_terminal_id)
     or (route_valid_from is not null and (new.departs_at at time zone route_timezone)::date < route_valid_from)
     or (route_valid_until is not null and (new.departs_at at time zone route_timezone)::date > route_valid_until) then
    raise exception 'Linha do segmento nao corresponde ao fornecedor, mercado ou terminais da opcao.';
  end if;
  return new;
end;
$$;

drop trigger if exists bus_quote_segments_validate_route_scope on bus_quote_segments;
create trigger bus_quote_segments_validate_route_scope
before insert or update of tenant_id, quote_option_id, route_id,
  demand_leg_id, origin_city_id, destination_city_id,
  origin_terminal_id, destination_terminal_id, departs_at
on bus_quote_segments
for each row execute function validate_bus_quote_segment_route_scope();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'offline_catalog_sources', 'rental_locations', 'bus_terminals', 'bus_routes',
    'car_demand_details', 'bus_demand_details', 'bus_demand_legs',
    'car_quote_option_details', 'bus_quote_option_details', 'bus_quote_segments'
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

drop trigger if exists offline_catalog_sources_set_updated_at on offline_catalog_sources;
create trigger offline_catalog_sources_set_updated_at
before update on offline_catalog_sources for each row execute function set_updated_at();
drop trigger if exists rental_locations_set_updated_at on rental_locations;
create trigger rental_locations_set_updated_at
before update on rental_locations for each row execute function set_updated_at();
drop trigger if exists bus_terminals_set_updated_at on bus_terminals;
create trigger bus_terminals_set_updated_at
before update on bus_terminals for each row execute function set_updated_at();
drop trigger if exists bus_routes_set_updated_at on bus_routes;
create trigger bus_routes_set_updated_at
before update on bus_routes for each row execute function set_updated_at();
drop trigger if exists car_demand_details_set_updated_at on car_demand_details;
create trigger car_demand_details_set_updated_at
before update on car_demand_details for each row execute function set_updated_at();
drop trigger if exists bus_demand_details_set_updated_at on bus_demand_details;
create trigger bus_demand_details_set_updated_at
before update on bus_demand_details for each row execute function set_updated_at();
drop trigger if exists bus_demand_legs_set_updated_at on bus_demand_legs;
create trigger bus_demand_legs_set_updated_at
before update on bus_demand_legs for each row execute function set_updated_at();
drop trigger if exists car_quote_option_details_set_updated_at on car_quote_option_details;
create trigger car_quote_option_details_set_updated_at
before update on car_quote_option_details for each row execute function set_updated_at();
drop trigger if exists bus_quote_option_details_set_updated_at on bus_quote_option_details;
create trigger bus_quote_option_details_set_updated_at
before update on bus_quote_option_details for each row execute function set_updated_at();
drop trigger if exists bus_quote_segments_set_updated_at on bus_quote_segments;
create trigger bus_quote_segments_set_updated_at
before update on bus_quote_segments for each row execute function set_updated_at();

commit;
