-- BBT Corporate - Tech Travel/TTravel integration schema
-- Additive schema for production deployments. The current app keeps app_kv
-- compatibility, but these tables define the relational contract for the
-- Tech hub when the SaaS backend is promoted from key-value storage.

create extension if not exists pgcrypto;

create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'pending_configuration',
  mode text not null default 'production',
  base_url text,
  capabilities jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  last_health_at timestamptz,
  last_health_status text,
  last_health_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider)
);

create table if not exists provider_company_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_company_id text not null,
  provider_company_name text,
  bbt_company_id text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_company_id)
);

create table if not exists integration_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  action text not null,
  status text not null,
  endpoint text,
  request_id text,
  duration_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists integration_logs_provider_created_idx
  on integration_logs (provider, created_at desc);

create table if not exists travel_quotes (
  id text primary key,
  provider text not null,
  service text not null,
  company_id text,
  provider_company_id text,
  request jsonb not null default '{}'::jsonb,
  options jsonb not null default '[]'::jsonb,
  raw_response jsonb,
  warnings jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists travel_quotes_company_created_idx
  on travel_quotes (company_id, created_at desc);

create table if not exists travel_reservations (
  id text primary key,
  provider text not null,
  service text not null,
  status text not null,
  company_id text,
  demand_id text,
  quote_id text references travel_quotes(id) on delete set null,
  id_os text,
  localizador text,
  sistema text,
  request jsonb not null default '{}'::jsonb,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_reservations_os_idx
  on travel_reservations (provider, id_os);

create index if not exists travel_reservations_company_created_idx
  on travel_reservations (company_id, created_at desc);

insert into integration_connections (provider, status, mode, base_url, capabilities)
values (
  'tech-ttravel',
  'pending_configuration',
  'production',
  'https://www.ttravel.com.br/ttravelapi/reservas',
  '["login","company_access","air_quote","air_fare","air_reserve","air_issue","hotel_quote","hotel_reserve","os_lookup","cancel","policies","cost_centers"]'::jsonb
)
on conflict (provider) do nothing;
