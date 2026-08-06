begin;

-- Catalogo geografico global. A aplicacao nunca depende da fonte externa
-- durante uma busca: sincronizacoes versionadas alimentam estas tabelas.
create table if not exists geo_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  dataset_key text not null,
  provider_version text,
  reference_date date,
  checksum_sha256 char(64) not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  record_count integer not null default 0 check (record_count >= 0),
  status text not null check (status in ('staging', 'active', 'superseded', 'failed')),
  source_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, dataset_key, checksum_sha256),
  check ((status = 'active' and activated_at is not null) or status <> 'active')
);

create unique index if not exists geo_dataset_versions_active_uidx
  on geo_dataset_versions (provider, dataset_key)
  where status = 'active';

create table if not exists geo_countries (
  id uuid primary key default gen_random_uuid(),
  iso_alpha2 citext not null,
  iso_alpha3 citext,
  numeric_code text,
  name text not null,
  official_name text,
  normalized_name text not null,
  provider text not null,
  provider_id text not null,
  dataset_version_id uuid references geo_dataset_versions(id) on delete restrict,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  check (iso_alpha2::text ~ '^[A-Za-z]{2}$'),
  check (iso_alpha3 is null or iso_alpha3::text ~ '^[A-Za-z]{3}$'),
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> '')
);

create unique index if not exists geo_countries_alpha2_uidx
  on geo_countries (upper(iso_alpha2::text));
create index if not exists geo_countries_search_idx
  on geo_countries (is_active, normalized_name);

create table if not exists geo_subdivisions (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references geo_countries(id) on delete restrict,
  code citext not null,
  name text not null,
  normalized_name text not null,
  subdivision_type text not null default 'state',
  provider text not null,
  provider_id text not null,
  dataset_version_id uuid references geo_dataset_versions(id) on delete restrict,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  unique (country_id, code),
  unique (country_id, id),
  check (btrim(code::text) <> ''),
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> '')
);

create index if not exists geo_subdivisions_country_search_idx
  on geo_subdivisions (country_id, is_active, normalized_name);

create table if not exists geo_cities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  name text not null,
  normalized_name text not null,
  provider text not null,
  provider_id text not null,
  dataset_version_id uuid references geo_dataset_versions(id) on delete restrict,
  latitude numeric(10,7),
  longitude numeric(10,7),
  timezone text,
  successor_city_id uuid references geo_cities(id) on delete restrict,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  unique (country_id, id),
  unique (subdivision_id, id),
  foreign key (country_id, subdivision_id)
    references geo_subdivisions(country_id, id) on delete restrict,
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> ''),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (successor_city_id is null or successor_city_id <> id)
);

create index if not exists geo_cities_subdivision_search_idx
  on geo_cities (subdivision_id, is_active, normalized_name);
create index if not exists geo_cities_country_search_idx
  on geo_cities (country_id, is_active, normalized_name);

create table if not exists geo_city_aliases (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references geo_cities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'alternate'
    check (alias_type in ('alternate', 'historical', 'abbreviation', 'provider')),
  provider text,
  created_at timestamptz not null default now(),
  unique (city_id, normalized_alias),
  check (btrim(alias) <> ''),
  check (btrim(normalized_alias) <> '')
);

create index if not exists geo_city_aliases_search_idx
  on geo_city_aliases (normalized_alias);

-- Execucoes ficam no escopo do tenant que disparou a sincronizacao, embora o
-- catalogo resultante seja uma referencia global compartilhada.
create table if not exists geo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  dataset_key text not null,
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  status text not null check (status in ('running', 'completed', 'failed', 'cancelled')),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  inactivated_count integer not null default 0 check (inactivated_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  checksum_sha256 char(64) check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  error_message text,
  started_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (tenant_id, id),
  check ((status = 'running' and finished_at is null) or (status <> 'running' and finished_at is not null))
);

create index if not exists geo_sync_runs_tenant_idx
  on geo_sync_runs (tenant_id, provider, dataset_key, started_at desc);

-- Ancora minima: o Brasil sempre existe, mesmo antes da primeira carga.
insert into geo_countries (
  iso_alpha2, iso_alpha3, numeric_code, name, official_name, normalized_name,
  provider, provider_id, is_active
) values (
  'BR', 'BRA', '076', 'Brasil', 'Republica Federativa do Brasil', 'brasil',
  'ibge', '076', true
)
on conflict (provider, provider_id) do update set
  iso_alpha2 = excluded.iso_alpha2,
  iso_alpha3 = excluded.iso_alpha3,
  numeric_code = excluded.numeric_code,
  name = excluded.name,
  official_name = excluded.official_name,
  normalized_name = excluded.normalized_name,
  is_active = true,
  synced_at = now(),
  updated_at = now();

drop trigger if exists geo_countries_set_updated_at on geo_countries;
create trigger geo_countries_set_updated_at before update on geo_countries
for each row execute function set_updated_at();
drop trigger if exists geo_subdivisions_set_updated_at on geo_subdivisions;
create trigger geo_subdivisions_set_updated_at before update on geo_subdivisions
for each row execute function set_updated_at();
drop trigger if exists geo_cities_set_updated_at on geo_cities;
create trigger geo_cities_set_updated_at before update on geo_cities
for each row execute function set_updated_at();

alter table geo_sync_runs enable row level security;
alter table geo_sync_runs force row level security;
drop policy if exists tenant_isolation on geo_sync_runs;
create policy tenant_isolation on geo_sync_runs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

commit;
