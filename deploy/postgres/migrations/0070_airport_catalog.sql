begin;

-- Catalogo global e independente de provedor para aeroportos e codigos de
-- localidade. A origem externa so e consultada durante uma sincronizacao; as
-- buscas operacionais leem exclusivamente estas tabelas locais.
create table if not exists geo_airports (
  id uuid primary key default gen_random_uuid(),
  canonical_key citext not null,
  ident citext not null,
  iata_code citext,
  icao_code citext,
  gps_code citext,
  local_code citext,
  airport_type text not null check (airport_type in (
    'large_airport', 'medium_airport', 'small_airport', 'heliport',
    'seaplane_base', 'balloonport', 'closed', 'other'
  )),
  name text not null,
  normalized_name text not null,
  municipality text,
  normalized_municipality text,
  country_code citext not null,
  subdivision_code citext,
  country_id uuid references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  city_id uuid references geo_cities(id) on delete restrict,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  elevation_ft integer,
  timezone text,
  scheduled_service boolean not null default false,
  primary_provider text not null,
  primary_provider_id text not null,
  dataset_version_id uuid references geo_dataset_versions(id) on delete restrict,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_key),
  unique (primary_provider, primary_provider_id),
  unique (country_id, id),
  unique (subdivision_id, id),
  foreign key (country_id, subdivision_id)
    references geo_subdivisions(country_id, id) on delete restrict,
  foreign key (country_id, city_id)
    references geo_cities(country_id, id) on delete restrict,
  foreign key (subdivision_id, city_id)
    references geo_cities(subdivision_id, id) on delete restrict,
  check (btrim(canonical_key::text) <> ''),
  check (btrim(ident::text) <> ''),
  check (iata_code is null or iata_code::text ~ '^[A-Za-z0-9]{3}$'),
  check (icao_code is null or icao_code::text ~ '^[A-Za-z0-9]{4}$'),
  check (gps_code is null or gps_code::text ~ '^[A-Za-z0-9]{2,8}$'),
  check (local_code is null or length(btrim(local_code::text)) between 1 and 16),
  check (country_code::text ~ '^[A-Za-z]{2}$'),
  check (subdivision_code is null or length(btrim(subdivision_code::text)) between 2 and 16),
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> ''),
  check (normalized_municipality is null or btrim(normalized_municipality) <> ''),
  check (latitude between -90 and 90),
  check (longitude between -180 and 180),
  check (subdivision_id is null or country_id is not null),
  check (city_id is null or (country_id is not null and subdivision_id is not null))
);

create index if not exists geo_airports_iata_idx
  on geo_airports (upper(iata_code::text)) where iata_code is not null;
create index if not exists geo_airports_icao_idx
  on geo_airports (upper(icao_code::text)) where icao_code is not null;
create index if not exists geo_airports_ident_idx
  on geo_airports (upper(ident::text));
create index if not exists geo_airports_name_search_idx
  on geo_airports (is_active, scheduled_service desc, normalized_name);
create index if not exists geo_airports_municipality_search_idx
  on geo_airports (country_code, subdivision_code, is_active, normalized_municipality);
create index if not exists geo_airports_geo_idx
  on geo_airports (country_code, subdivision_code, latitude, longitude);

-- Uma entidade canonica pode ser reconhecida por mais de uma fonte. Isso
-- permite adotar futuramente uma API/GDS licenciada sem trocar IDs usados nas
-- demandas e sem perder a linhagem da carga inicial do OurAirports.
create table if not exists geo_airport_sources (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references geo_airports(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  dataset_version_id uuid not null references geo_dataset_versions(id) on delete restrict,
  source_checksum_sha256 char(64) not null
    check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default true,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  check (btrim(provider) <> ''),
  check (btrim(provider_id) <> '')
);

create index if not exists geo_airport_sources_airport_idx
  on geo_airport_sources (airport_id, is_current);
create index if not exists geo_airport_sources_dataset_idx
  on geo_airport_sources (provider, dataset_version_id, is_current);

create table if not exists geo_airport_aliases (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references geo_airports(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'alternate'
    check (alias_type in ('alternate', 'historical', 'provider', 'keyword', 'code')),
  provider text,
  created_at timestamptz not null default now(),
  unique (airport_id, normalized_alias),
  check (btrim(alias) <> ''),
  check (btrim(normalized_alias) <> '')
);

create index if not exists geo_airport_aliases_search_idx
  on geo_airport_aliases (normalized_alias);

-- Codigos metropolitanos (SAO, RIO, NYC etc.) nao representam um aeroporto
-- fisico. Eles permanecem separados e podem apontar para varios aeroportos.
create table if not exists geo_airport_location_codes (
  id uuid primary key default gen_random_uuid(),
  code citext not null,
  code_type text not null check (code_type in ('airport', 'metropolitan', 'city')),
  name text not null,
  normalized_name text not null,
  municipality text,
  country_code citext not null,
  subdivision_code citext,
  provider text not null,
  provider_id text not null,
  dataset_version_id uuid references geo_dataset_versions(id) on delete restrict,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  unique (code, code_type, country_code),
  check (code::text ~ '^[A-Za-z0-9]{3}$'),
  check (country_code::text ~ '^[A-Za-z]{2}$'),
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> '')
);

create index if not exists geo_airport_location_codes_search_idx
  on geo_airport_location_codes (is_active, upper(code::text), normalized_name);

create table if not exists geo_airport_location_code_memberships (
  location_code_id uuid not null references geo_airport_location_codes(id) on delete cascade,
  airport_id uuid not null references geo_airports(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (location_code_id, airport_id)
);

create index if not exists geo_airport_location_memberships_airport_idx
  on geo_airport_location_code_memberships (airport_id, location_code_id);

drop trigger if exists geo_airports_set_updated_at on geo_airports;
create trigger geo_airports_set_updated_at before update on geo_airports
for each row execute function set_updated_at();
drop trigger if exists geo_airport_sources_set_updated_at on geo_airport_sources;
create trigger geo_airport_sources_set_updated_at before update on geo_airport_sources
for each row execute function set_updated_at();
drop trigger if exists geo_airport_location_codes_set_updated_at on geo_airport_location_codes;
create trigger geo_airport_location_codes_set_updated_at before update on geo_airport_location_codes
for each row execute function set_updated_at();

commit;
