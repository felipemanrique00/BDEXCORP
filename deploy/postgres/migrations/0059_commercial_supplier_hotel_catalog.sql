begin;

-- Fornecedores comerciais sao distintos de integration_providers, que
-- representam conectores tecnicos/API.
create table if not exists postal_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  country_id uuid references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  city_id uuid references geo_cities(id) on delete restrict,
  postal_code text,
  street text,
  street_number text,
  complement text,
  district text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  formatted_address text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (country_id, subdivision_id)
    references geo_subdivisions(country_id, id) on delete restrict,
  foreign key (country_id, city_id)
    references geo_cities(country_id, id) on delete restrict,
  foreign key (subdivision_id, city_id)
    references geo_cities(subdivision_id, id) on delete restrict,
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index if not exists postal_addresses_city_idx
  on postal_addresses (tenant_id, city_id) where deleted_at is null;

create table if not exists commercial_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  internal_code citext not null,
  legal_name text not null,
  trade_name text,
  document_type text not null default 'cnpj'
    check (document_type in ('cnpj', 'cpf', 'foreign_tax_id', 'other')),
  document_number text,
  service_types text[] not null default '{}'::text[],
  address_id uuid,
  integration_provider_id uuid,
  website text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  payment_terms jsonb not null default '{}'::jsonb check (jsonb_typeof(payment_terms) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, internal_code),
  foreign key (tenant_id, address_id)
    references postal_addresses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, integration_provider_id)
    references integration_providers(tenant_id, id) on delete restrict,
  check (btrim(internal_code::text) <> ''),
  check (btrim(legal_name) <> ''),
  check (cardinality(service_types) > 0),
  check (array_position(service_types, null) is null),
  check (service_types <@ array[
    'hotel', 'air', 'car', 'bus', 'transfer', 'insurance', 'package', 'other'
  ]::text[]),
  check (deleted_at is null or status <> 'active')
);

create unique index if not exists commercial_suppliers_document_uidx
  on commercial_suppliers (tenant_id, document_type, document_number)
  where document_number is not null and btrim(document_number) <> '' and deleted_at is null;
create index if not exists commercial_suppliers_search_idx
  on commercial_suppliers (tenant_id, status, lower(coalesce(trade_name, legal_name)));
create index if not exists commercial_suppliers_services_idx
  on commercial_suppliers using gin (service_types);

create table if not exists commercial_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null,
  contact_type text not null
    check (contact_type in ('commercial', 'reservation', 'financial', 'emergency', 'general')),
  name text,
  email citext,
  phone text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete cascade,
  check (email is not null or phone is not null),
  check (email is null or btrim(email::text) <> ''),
  check (phone is null or btrim(phone) <> ''),
  check (name is null or btrim(name) <> '')
);

create unique index if not exists commercial_supplier_contacts_primary_uidx
  on commercial_supplier_contacts (tenant_id, supplier_id, contact_type)
  where is_primary and is_active;

alter table hotels
  add column if not exists normalized_name text,
  add column if not exists legacy_numeric_id bigint,
  add column if not exists country_id uuid references geo_countries(id) on delete restrict,
  add column if not exists subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  add column if not exists city_id uuid references geo_cities(id) on delete restrict,
  add column if not exists address_id uuid,
  add column if not exists website text,
  add column if not exists source text not null default 'manual',
  add column if not exists version bigint not null default 1 check (version > 0),
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists updated_by uuid references users(id) on delete set null;

update hotels
set normalized_name = lower(btrim(name))
where normalized_name is null or btrim(normalized_name) = '';

update hotels hotel
set country_id = country_row.id
from geo_countries country_row
where hotel.country_id is null
  and upper(coalesce(nullif(btrim(hotel.country), ''), 'BR')) in ('BR', 'BRA', 'BRASIL')
  and upper(country_row.iso_alpha2::text) = 'BR';

alter table hotels alter column normalized_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotels_address_fk' and conrelid = 'hotels'::regclass
  ) then
    alter table hotels add constraint hotels_address_fk
      foreign key (tenant_id, address_id)
      references postal_addresses(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotels_country_subdivision_fk' and conrelid = 'hotels'::regclass
  ) then
    alter table hotels add constraint hotels_country_subdivision_fk
      foreign key (country_id, subdivision_id)
      references geo_subdivisions(country_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotels_country_city_fk' and conrelid = 'hotels'::regclass
  ) then
    alter table hotels add constraint hotels_country_city_fk
      foreign key (country_id, city_id)
      references geo_cities(country_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotels_subdivision_city_fk' and conrelid = 'hotels'::regclass
  ) then
    alter table hotels add constraint hotels_subdivision_city_fk
      foreign key (subdivision_id, city_id)
      references geo_cities(subdivision_id, id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists hotels_legacy_numeric_uidx
  on hotels (tenant_id, legacy_numeric_id)
  where legacy_numeric_id is not null and deleted_at is null;
create index if not exists hotels_geo_search_idx
  on hotels (tenant_id, city_id, status, normalized_name)
  where deleted_at is null;

create table if not exists hotel_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hotel_id text not null,
  supplier_id uuid not null,
  supplier_property_code text,
  reservation_email citext,
  reservation_phone text,
  priority smallint not null default 100 check (priority between 1 and 999),
  billing_enabled boolean not null default false,
  payment_methods text[] not null default '{}'::text[],
  commercial_terms jsonb not null default '{}'::jsonb check (jsonb_typeof(commercial_terms) = 'object'),
  is_active boolean not null default true,
  valid_from date,
  valid_until date,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, hotel_id, id),
  unique (tenant_id, hotel_id, supplier_id),
  foreign key (tenant_id, hotel_id) references hotels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supplier_id) references commercial_suppliers(tenant_id, id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check ((is_active and ended_at is null) or (not is_active and ended_at is not null))
);

create index if not exists hotel_suppliers_supplier_idx
  on hotel_suppliers (tenant_id, supplier_id, is_active, priority);

create table if not exists hotel_room_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hotel_id text not null,
  code citext not null,
  name text not null,
  occupancy_type text not null
    check (occupancy_type in ('single', 'double', 'twin', 'triple', 'quadruple', 'family')),
  max_guests smallint not null check (max_guests between 1 and 12),
  max_adults smallint not null check (max_adults between 1 and 12),
  max_children smallint not null default 0 check (max_children between 0 and 10),
  bed_configuration text,
  amenities jsonb not null default '{}'::jsonb check (jsonb_typeof(amenities) = 'object'),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, hotel_id, id),
  unique (tenant_id, hotel_id, code),
  foreign key (tenant_id, hotel_id) references hotels(tenant_id, id) on delete restrict,
  check (max_adults + max_children >= max_guests),
  check (max_guests >= max_adults),
  check (max_guests >= max_children),
  check (occupancy_type <> 'single' or (max_guests = 1 and max_adults = 1 and max_children = 0)),
  check (deleted_at is null or not is_active)
);

create index if not exists hotel_room_types_hotel_idx
  on hotel_room_types (tenant_id, hotel_id, is_active, occupancy_type);

create table if not exists hotel_supplier_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hotel_id text not null,
  hotel_supplier_id uuid not null,
  room_type_id uuid not null,
  rate_code citext not null,
  valid_from date not null,
  valid_until date not null,
  nightly_amount numeric(14,2) not null check (nightly_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  currency char(3) not null default 'BRL',
  refundable boolean,
  meal_plan text,
  cancellation_policy text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, hotel_id, hotel_supplier_id)
    references hotel_suppliers(tenant_id, hotel_id, id) on delete restrict,
  foreign key (tenant_id, hotel_id, room_type_id)
    references hotel_room_types(tenant_id, hotel_id, id) on delete restrict,
  unique (tenant_id, hotel_supplier_id, room_type_id, rate_code, valid_from),
  check (valid_until >= valid_from),
  check (currency ~ '^[A-Z]{3}$')
);

create index if not exists hotel_supplier_rates_lookup_idx
  on hotel_supplier_rates (tenant_id, hotel_supplier_id, room_type_id, is_active, valid_from, valid_until);

create table if not exists provider_city_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_provider_id uuid not null,
  city_id uuid not null references geo_cities(id) on delete restrict,
  provider_city_id text not null,
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, integration_provider_id, provider_city_id),
  unique (tenant_id, integration_provider_id, city_id),
  foreign key (tenant_id, integration_provider_id)
    references integration_providers(tenant_id, id) on delete cascade
);

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'postal_addresses', 'commercial_suppliers', 'commercial_supplier_contacts',
    'hotel_suppliers', 'hotel_room_types', 'hotel_supplier_rates',
    'provider_city_mappings'
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

drop trigger if exists postal_addresses_set_updated_at on postal_addresses;
create trigger postal_addresses_set_updated_at before update on postal_addresses for each row execute function set_updated_at();
drop trigger if exists commercial_suppliers_set_updated_at on commercial_suppliers;
create trigger commercial_suppliers_set_updated_at before update on commercial_suppliers for each row execute function set_updated_at();
drop trigger if exists commercial_supplier_contacts_set_updated_at on commercial_supplier_contacts;
create trigger commercial_supplier_contacts_set_updated_at before update on commercial_supplier_contacts for each row execute function set_updated_at();
drop trigger if exists hotels_set_updated_at on hotels;
create trigger hotels_set_updated_at before update on hotels for each row execute function set_updated_at();
drop trigger if exists hotel_suppliers_set_updated_at on hotel_suppliers;
create trigger hotel_suppliers_set_updated_at before update on hotel_suppliers for each row execute function set_updated_at();
drop trigger if exists hotel_room_types_set_updated_at on hotel_room_types;
create trigger hotel_room_types_set_updated_at before update on hotel_room_types for each row execute function set_updated_at();
drop trigger if exists hotel_supplier_rates_set_updated_at on hotel_supplier_rates;
create trigger hotel_supplier_rates_set_updated_at before update on hotel_supplier_rates for each row execute function set_updated_at();
drop trigger if exists provider_city_mappings_set_updated_at on provider_city_mappings;
create trigger provider_city_mappings_set_updated_at before update on provider_city_mappings for each row execute function set_updated_at();

commit;
