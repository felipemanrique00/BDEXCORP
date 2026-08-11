begin;

-- Catalogo global e independente de provedor para companhias aereas. Os
-- codigos operacionais pertencem a esta entidade canonica; aliases preservam
-- codigos historicos e nomes comerciais sem duplicar a companhia.
create table if not exists geo_airlines (
  id uuid primary key default gen_random_uuid(),
  iata_code citext not null,
  icao_code citext,
  name text not null,
  normalized_name text not null,
  legal_name text,
  normalized_legal_name text,
  country_code citext,
  logo_path text,
  logo_background_color text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (iata_code),
  unique (icao_code),
  check (iata_code::text ~ '^[A-Za-z0-9]{2}$'),
  check (icao_code is null or icao_code::text ~ '^[A-Za-z0-9]{3}$'),
  check (btrim(name) <> ''),
  check (btrim(normalized_name) <> ''),
  check (legal_name is null or btrim(legal_name) <> ''),
  check (normalized_legal_name is null or btrim(normalized_legal_name) <> ''),
  check (country_code is null or country_code::text ~ '^[A-Za-z]{2}$'),
  check (logo_path is null or logo_path ~ '^/airlines/[A-Za-z0-9_-]+\.svg$'),
  check (logo_background_color is null or logo_background_color ~ '^#[0-9A-Fa-f]{6}$')
);

create index if not exists geo_airlines_iata_idx
  on geo_airlines (upper(iata_code::text)) where is_active;
create index if not exists geo_airlines_icao_idx
  on geo_airlines (upper(icao_code::text)) where icao_code is not null and is_active;
create index if not exists geo_airlines_name_search_idx
  on geo_airlines (is_active, normalized_name);
create index if not exists geo_airlines_country_idx
  on geo_airlines (country_code, is_active, normalized_name);

create table if not exists geo_airline_aliases (
  id uuid primary key default gen_random_uuid(),
  airline_id uuid not null references geo_airlines(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'alternate_name'
    check (alias_type in (
      'alternate_name', 'commercial_name', 'historical_iata',
      'historical_icao', 'provider', 'keyword'
    )),
  created_at timestamptz not null default now(),
  unique (airline_id, normalized_alias),
  check (btrim(alias) <> ''),
  check (btrim(normalized_alias) <> '')
);

create index if not exists geo_airline_aliases_search_idx
  on geo_airline_aliases (normalized_alias, airline_id);
create index if not exists geo_airline_aliases_code_idx
  on geo_airline_aliases (upper(alias))
  where alias_type in ('historical_iata', 'historical_icao');

drop trigger if exists geo_airlines_set_updated_at on geo_airlines;
create trigger geo_airlines_set_updated_at before update on geo_airlines
for each row execute function set_updated_at();

-- Carga inicial brasileira usada pelo fluxo offline. O upsert mantem a
-- migration reexecutavel em ambientes locais sem criar identidades paralelas.
insert into geo_airlines (
  iata_code, icao_code, name, normalized_name, legal_name,
  normalized_legal_name, country_code, logo_path, logo_background_color,
  metadata
) values
  (
    'AD', 'AZU', 'Azul', 'azul', 'Azul Linhas Aereas Brasileiras S.A.',
    'azul linhas aereas brasileiras s a', 'BR', '/airlines/AD.svg', '#FFFFFF',
    '{"seed":"bbt","market":"BR"}'::jsonb
  ),
  (
    'G3', 'GLO', 'GOL', 'gol', 'GOL Linhas Aereas S.A.',
    'gol linhas aereas s a', 'BR', '/airlines/G3.svg', '#FFFFFF',
    '{"seed":"bbt","market":"BR"}'::jsonb
  ),
  (
    'LA', 'LAN', 'LATAM', 'latam', 'LATAM Airlines Group S.A.',
    'latam airlines group s a', 'CL', '/airlines/LA.svg', '#1B0088',
    '{"seed":"bbt","market":"LATAM"}'::jsonb
  )
on conflict (iata_code) do update set
  icao_code = excluded.icao_code,
  name = excluded.name,
  normalized_name = excluded.normalized_name,
  legal_name = excluded.legal_name,
  normalized_legal_name = excluded.normalized_legal_name,
  country_code = excluded.country_code,
  logo_path = excluded.logo_path,
  logo_background_color = excluded.logo_background_color,
  is_active = true,
  metadata = geo_airlines.metadata || excluded.metadata,
  updated_at = now();

insert into geo_airline_aliases (airline_id, alias, normalized_alias, alias_type)
select airline.id, seed.alias, seed.normalized_alias, seed.alias_type
from (
  values
    ('AD', 'Azul Linhas Aereas', 'azul linhas aereas', 'alternate_name'),
    ('G3', 'Gol Linhas Aereas', 'gol linhas aereas', 'alternate_name'),
    ('LA', 'LATAM Brasil', 'latam brasil', 'commercial_name'),
    ('LA', 'JJ', 'jj', 'historical_iata')
) as seed(iata_code, alias, normalized_alias, alias_type)
join geo_airlines airline on upper(airline.iata_code::text) = seed.iata_code
on conflict (airline_id, normalized_alias) do update set
  alias = excluded.alias,
  alias_type = excluded.alias_type;

commit;
