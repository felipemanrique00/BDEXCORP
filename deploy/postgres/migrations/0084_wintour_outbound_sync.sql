begin;

create table if not exists wintour_sync_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  sync_from timestamptz not null default now(),
  agency_name text not null check (length(trim(agency_name)) between 1 and 50),
  branch_id integer check (branch_id is null or branch_id > 0),
  branch_name text check (branch_name is null or length(trim(branch_name)) between 1 and 60),
  free_field text check (free_field is null or length(free_field) <= 1200),
  product_codes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(product_codes) = 'object')
    check ((product_codes - array['air', 'hotel', 'car', 'bus']) = '{}'::jsonb),
  payment_method_codes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payment_method_codes) = 'object')
    check ((payment_method_codes - array[
      'faturado', 'pix', 'cartao_corporativo', 'cartao_agencia',
      'transferencia', 'dinheiro', 'outro'
    ]) = '{}'::jsonb),
  service_route_types jsonb not null default '{}'::jsonb
    check (jsonb_typeof(service_route_types) = 'object')
    check ((service_route_types - array['air', 'hotel', 'car', 'bus']) = '{}'::jsonb),
  tariff_net_default smallint check (tariff_net_default in (0, 1)),
  account_defaults jsonb not null default '{}'::jsonb
    check (jsonb_typeof(account_defaults) = 'object')
    check ((account_defaults - array[
      'issuer', 'promoter', 'manager', 'supplier', 'agency_cost_center',
      'card_cp', 'card_mp', 'additional_fee', 'additional_fee_2', 'issuance_fee'
    ]) = '{}'::jsonb),
  customer_action text not null default 'none'
    check (customer_action in ('none', 'I', 'U', 'IU')),
  auto_send boolean not null default false,
  auto_poll boolean not null default false,
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  discovery_batch_size integer not null default 100
    check (discovery_batch_size between 1 and 500),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wintour_sale_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  emission_id uuid not null,
  source_item_key text not null check (length(trim(source_item_key)) between 1 and 160),
  source_ticket_id uuid,
  idv_externo bigint not null check (idv_externo between 1 and 9999999999),
  wintour_sale_number bigint check (
    wintour_sale_number is null
    or wintour_sale_number between 1 and 9999999999
  ),
  source_fingerprint char(64) not null
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb not null
    check (jsonb_typeof(source_snapshot) = 'object'),
  state text not null default 'blocked' check (state in (
    'blocked', 'ready', 'sending', 'ambiguous', 'received', 'processing',
    'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  blocked_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocked_reasons) = 'array'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  source_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, emission_id, source_item_key),
  unique (tenant_id, idv_externo),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, emission_id)
    references travel_emissions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_ticket_id)
    references air_emission_tickets(tenant_id, id) on delete restrict,
  check (
    (source_ticket_id is null and source_item_key = 'emission')
    or (
      source_ticket_id is not null
      and source_item_key = 'air-ticket:' || source_ticket_id::text
    )
  )
);

create unique index if not exists wintour_sale_links_sale_number_idx
  on wintour_sale_links (tenant_id, wintour_sale_number)
  where wintour_sale_number is not null;
create index if not exists wintour_sale_links_state_idx
  on wintour_sale_links (tenant_id, state, updated_at desc);
create index if not exists wintour_sale_links_company_idx
  on wintour_sale_links (tenant_id, company_id, updated_at desc);
create index if not exists wintour_sale_links_source_refresh_idx
  on wintour_sale_links (tenant_id, source_refreshed_at);

create table if not exists wintour_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_link_id uuid not null,
  company_id text not null,
  emission_id uuid not null,
  operation text not null check (operation in ('create', 'update')),
  link_source_fingerprint char(64) not null
    check (link_source_fingerprint ~ '^[0-9a-f]{64}$'),
  config_fingerprint char(64) not null
    check (config_fingerprint ~ '^[0-9a-f]{64}$'),
  source_fingerprint char(64) not null
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb not null
    check (jsonb_typeof(source_snapshot) = 'object'),
  idempotency_key char(64) not null
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  file_number bigint check (file_number is null or file_number between 1 and 2147483647),
  payload_bytes bytea,
  payload_sha256 char(64)
    check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload_filename text check (
    payload_filename is null
    or payload_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}[.]xml$'
  ),
  payload_content_type text
    check (payload_content_type is null or payload_content_type = 'application/xml'),
  serializer_version text
    check (serializer_version is null or length(trim(serializer_version)) between 1 and 80),
  transport_free_field text
    check (transport_free_field is null or length(transport_free_field) <= 1200),
  state text not null default 'blocked' check (state in (
    'blocked', 'ready', 'sending', 'ambiguous', 'received', 'processing',
    'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  blocked_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocked_reasons) = 'array'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null check (max_attempts between 1 and 20),
  lease_token uuid,
  lease_expires_at timestamptz,
  poll_lease_token uuid,
  poll_lease_expires_at timestamptz,
  poll_attempt_count integer not null default 0
    check (poll_attempt_count between 0 and 12),
  poll_started_at timestamptz,
  next_poll_at timestamptz,
  last_error_code text,
  last_error_message text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  prepared_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, operation, sale_link_id, source_fingerprint),
  foreign key (tenant_id, sale_link_id)
    references wintour_sale_links(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, emission_id)
    references travel_emissions(tenant_id, id) on delete restrict,
  check ((state = 'sending') = (lease_token is not null and lease_expires_at is not null)),
  check ((poll_lease_token is null) = (poll_lease_expires_at is null)),
  check (poll_lease_token is null or state in ('received', 'processing')),
  check (state <> 'completed' or completed_at is not null),
  check (payload_bytes is null or octet_length(payload_bytes) between 1 and 10485760),
  check (
    state = 'blocked'
    or (
      file_number is not null and payload_bytes is not null and payload_sha256 is not null
      and payload_filename is not null and payload_content_type is not null
      and serializer_version is not null
    )
  )
);

create unique index if not exists wintour_sync_jobs_file_number_idx
  on wintour_sync_jobs (tenant_id, file_number)
  where file_number is not null;

create index if not exists wintour_sync_jobs_worker_idx
  on wintour_sync_jobs (tenant_id, state, prepared_at, id)
  where state in ('ready', 'sending');
create index if not exists wintour_sync_jobs_poll_idx
  on wintour_sync_jobs (tenant_id, next_poll_at, prepared_at, id)
  where state in ('received', 'processing');
create index if not exists wintour_sync_jobs_sale_idx
  on wintour_sync_jobs (tenant_id, sale_link_id, created_at desc);

create table if not exists wintour_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_link_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  lease_token uuid not null,
  state text not null check (state in (
    'blocked', 'ready', 'sending', 'ambiguous', 'received', 'processing',
    'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  request_fingerprint char(64) not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  response_fingerprint char(64)
    check (response_fingerprint is null or response_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code text,
  error_message text,
  version bigint not null default 1 check (version > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, job_id, attempt_number),
  foreign key (tenant_id, sale_link_id)
    references wintour_sale_links(tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id)
    references wintour_sync_jobs(tenant_id, id) on delete cascade
);

create index if not exists wintour_sync_attempts_job_idx
  on wintour_sync_attempts (tenant_id, job_id, attempt_number desc);

create table if not exists wintour_sync_protocols (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_link_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  protocol_kind text not null check (protocol_kind in ('submission', 'poll', 'manual')),
  protocol_code text not null check (length(trim(protocol_code)) between 1 and 240),
  observation_key char(64) not null
    check (observation_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in (
    'blocked', 'ready', 'sending', 'ambiguous', 'received', 'processing',
    'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  response_fingerprint char(64)
    check (response_fingerprint is null or response_fingerprint ~ '^[0-9a-f]{64}$'),
  redacted_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(redacted_payload) = 'object'),
  observed_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, observation_key),
  foreign key (tenant_id, sale_link_id)
    references wintour_sale_links(tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id)
    references wintour_sync_jobs(tenant_id, id) on delete cascade,
  foreign key (tenant_id, attempt_id)
    references wintour_sync_attempts(tenant_id, id) on delete cascade
);

create index if not exists wintour_sync_protocols_job_idx
  on wintour_sync_protocols (tenant_id, job_id, observed_at desc);

create or replace function wintour_sale_source_freshness_at(
  p_tenant_id uuid,
  p_emission_id uuid,
  p_source_ticket_id uuid,
  p_company_id text
)
returns timestamptz
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select greatest(
    emission.updated_at,
    reservation.updated_at,
    demand.updated_at,
    coalesce(requester.updated_at, '-infinity'::timestamptz),
    coalesce(cost_center.updated_at, '-infinity'::timestamptz),
    coalesce(ticket.updated_at, '-infinity'::timestamptz),
    coalesce(ticket_freshness.updated_at, '-infinity'::timestamptz),
    coalesce(traveler.updated_at, '-infinity'::timestamptz),
    coalesce(employee.updated_at, '-infinity'::timestamptz),
    coalesce(air.updated_at, '-infinity'::timestamptz),
    coalesce(air_demand.updated_at, '-infinity'::timestamptz),
    coalesce(route_freshness.updated_at, '-infinity'::timestamptz),
    coalesce(company_mapping_freshness.updated_at, '-infinity'::timestamptz),
    coalesce(actor_mapping_freshness.updated_at, '-infinity'::timestamptz),
    coalesce(settings.updated_at, '-infinity'::timestamptz)
  )
  from travel_emissions emission
  join reservations reservation
    on reservation.tenant_id = emission.tenant_id
   and reservation.id = emission.reservation_id
  join demands demand
    on demand.tenant_id = emission.tenant_id
   and demand.id = emission.demand_id
   and demand.company_id = emission.company_id
   and demand.id = reservation.demand_id
  left join requesters requester
    on requester.tenant_id = demand.tenant_id
   and requester.id = demand.requester_id
   and requester.company_id = demand.company_id
  left join cost_centers cost_center
    on cost_center.tenant_id = demand.tenant_id
   and cost_center.id = demand.cost_center_id
   and cost_center.company_id = demand.company_id
  left join air_emission_tickets ticket
    on ticket.tenant_id = emission.tenant_id
   and ticket.emission_id = emission.id
   and ticket.id = p_source_ticket_id
  left join demand_travelers traveler
    on traveler.tenant_id = ticket.tenant_id
   and traveler.id = ticket.demand_traveler_id
   and traveler.demand_id = demand.id
  left join employees employee
    on employee.tenant_id = traveler.tenant_id
   and employee.id = traveler.employee_id
   and employee.company_id = demand.company_id
  left join air_reservation_details air
    on air.tenant_id = reservation.tenant_id
   and air.reservation_id = reservation.id
  left join air_demand_details air_demand
    on air_demand.tenant_id = demand.tenant_id
   and air_demand.demand_id = demand.id
  left join wintour_sync_settings settings
    on settings.tenant_id = emission.tenant_id
  left join lateral (
    select max(item.updated_at) as updated_at
    from air_emission_tickets item
    where item.tenant_id = emission.tenant_id
      and item.emission_id = emission.id
  ) ticket_freshness on true
  left join lateral (
    select greatest(
      max(segment.updated_at),
      max(origin_airport.updated_at),
      max(destination_airport.updated_at)
    ) as updated_at
    from air_reservation_segments segment
    left join lateral (
      select max(airport.updated_at) as updated_at
      from geo_airports airport
      where upper(airport.iata_code::text) = segment.origin_code
    ) origin_airport on true
    left join lateral (
      select max(airport.updated_at) as updated_at
      from geo_airports airport
      where upper(airport.iata_code::text) = segment.destination_code
    ) destination_airport on true
    where segment.tenant_id = reservation.tenant_id
      and segment.reservation_id = reservation.id
  ) route_freshness on true
  left join lateral (
    select max(mapping.updated_at) as updated_at
    from integration_company_mappings mapping
    where mapping.tenant_id = emission.tenant_id
      and mapping.company_id = emission.company_id
      and mapping.provider = 'wintour'
      and mapping.mapping_type = 'provider_company'
  ) company_mapping_freshness on true
  left join lateral (
    select max(mapping.updated_at) as updated_at
    from integration_actor_mappings mapping
    where mapping.tenant_id = emission.tenant_id
      and mapping.provider_key = 'wintour'
      and mapping.user_id = emission.issued_by
  ) actor_mapping_freshness on true
  where emission.tenant_id = p_tenant_id
    and emission.id = p_emission_id
    and emission.company_id = p_company_id;
$$;

create or replace function validate_wintour_sale_link_scope()
returns trigger
language plpgsql
as $$
declare
  emission_company text;
  ticket_emission uuid;
begin
  select company_id into emission_company
  from travel_emissions
  where tenant_id = new.tenant_id and id = new.emission_id;

  if emission_company is null or emission_company <> new.company_id then
    raise exception 'Emissao Wintour fora do escopo da empresa/tenant.';
  end if;
  if new.source_ticket_id is not null then
    select emission_id into ticket_emission
    from air_emission_tickets
    where tenant_id = new.tenant_id and id = new.source_ticket_id;
    if ticket_emission is null or ticket_emission <> new.emission_id then
      raise exception 'Bilhete Wintour fora do escopo da emissao.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function validate_wintour_job_scope()
returns trigger
language plpgsql
as $$
declare
  link_company text;
  link_emission uuid;
  link_sale_number bigint;
  link_fingerprint char(64);
begin
  select company_id, emission_id, wintour_sale_number, source_fingerprint
    into link_company, link_emission, link_sale_number, link_fingerprint
  from wintour_sale_links
  where tenant_id = new.tenant_id and id = new.sale_link_id;

  if link_company is null
     or link_company <> new.company_id
     or link_emission <> new.emission_id
     or link_fingerprint <> new.link_source_fingerprint then
    raise exception 'Job Wintour fora do escopo da venda/emissao.';
  end if;
  if new.operation = 'update' and link_sale_number is null then
    raise exception 'Atualizacao Wintour exige numero de venda vinculado.';
  end if;
  return new;
end;
$$;

create or replace function validate_wintour_attempt_scope()
returns trigger
language plpgsql
as $$
declare
  linked_sale uuid;
begin
  select sale_link_id into linked_sale
  from wintour_sync_jobs
  where tenant_id = new.tenant_id and id = new.job_id;
  if linked_sale is null or linked_sale <> new.sale_link_id then
    raise exception 'Tentativa Wintour fora do escopo do job.';
  end if;
  return new;
end;
$$;

create or replace function validate_wintour_protocol_scope()
returns trigger
language plpgsql
as $$
declare
  linked_job uuid;
  linked_sale uuid;
begin
  select job_id, sale_link_id into linked_job, linked_sale
  from wintour_sync_attempts
  where tenant_id = new.tenant_id and id = new.attempt_id;
  if linked_job is null
     or linked_job <> new.job_id
     or linked_sale <> new.sale_link_id then
    raise exception 'Protocolo Wintour fora do escopo da tentativa/job.';
  end if;
  return new;
end;
$$;

create or replace function wintour_state_transition_allowed(previous_state text, next_state text)
returns boolean
language sql
immutable
as $$
  select previous_state = next_state or case previous_state
    when 'blocked' then next_state in ('ready', 'manual_review', 'cancelled')
    when 'ready' then next_state in ('blocked', 'sending', 'manual_review', 'cancelled')
    when 'sending' then next_state in (
      'ambiguous', 'received', 'processing', 'manual_review', 'completed', 'rejected', 'failed'
    )
    when 'ambiguous' then next_state in (
      'received', 'processing', 'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
    )
    when 'received' then next_state in (
      'processing', 'manual_review', 'completed', 'rejected', 'failed', 'cancelled'
    )
    when 'processing' then next_state in (
      'completed', 'manual_review', 'rejected', 'failed', 'cancelled'
    )
    when 'manual_review' then next_state in (
      'blocked', 'ready', 'received', 'processing', 'completed', 'rejected', 'failed', 'cancelled'
    )
    when 'failed' then next_state in ('ready', 'manual_review', 'cancelled')
    when 'rejected' then next_state in ('ready', 'manual_review', 'cancelled')
    when 'completed' then next_state in ('blocked', 'ready', 'manual_review')
    when 'cancelled' then next_state in ('ready', 'manual_review')
    else false
  end;
$$;

create or replace function validate_wintour_job_state_transition()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'completed' and new.state <> old.state then
    raise exception 'Job Wintour concluido e terminal; prepare um novo snapshot.';
  end if;
  if not wintour_state_transition_allowed(old.state, new.state) then
    raise exception 'Transicao de estado do job Wintour invalida: % -> %.', old.state, new.state;
  end if;
  return new;
end;
$$;

create or replace function validate_wintour_state_transition()
returns trigger
language plpgsql
as $$
begin
  if not wintour_state_transition_allowed(old.state, new.state) then
    raise exception 'Transicao de estado Wintour invalida: % -> %.', old.state, new.state;
  end if;
  return new;
end;
$$;

create or replace function preserve_wintour_sale_identity()
returns trigger
language plpgsql
as $$
begin
  if old.tenant_id <> new.tenant_id
     or old.emission_id <> new.emission_id
     or old.source_item_key <> new.source_item_key
     or old.source_ticket_id is distinct from new.source_ticket_id
     or old.idv_externo <> new.idv_externo then
    raise exception 'Identidade externa Wintour e imutavel.';
  end if;
  if old.wintour_sale_number is not null
     and old.wintour_sale_number is distinct from new.wintour_sale_number then
    raise exception 'Numero da venda Wintour ja vinculado e imutavel.';
  end if;
  return new;
end;
$$;

create or replace function preserve_wintour_job_source()
returns trigger
language plpgsql
as $$
begin
  if old.tenant_id <> new.tenant_id
     or old.sale_link_id <> new.sale_link_id
     or old.emission_id <> new.emission_id
     or old.operation <> new.operation
     or old.link_source_fingerprint <> new.link_source_fingerprint
     or old.config_fingerprint <> new.config_fingerprint
     or old.source_fingerprint <> new.source_fingerprint
     or old.source_snapshot <> new.source_snapshot
     or old.idempotency_key <> new.idempotency_key then
    raise exception 'Fonte preparada do job Wintour e imutavel.';
  end if;
  if old.payload_bytes is not null and (
    old.file_number is distinct from new.file_number
    or old.payload_bytes is distinct from new.payload_bytes
    or old.payload_sha256 is distinct from new.payload_sha256
    or old.payload_filename is distinct from new.payload_filename
    or old.payload_content_type is distinct from new.payload_content_type
    or old.serializer_version is distinct from new.serializer_version
    or old.transport_free_field is distinct from new.transport_free_field
  ) then
    raise exception 'Artefato XML Wintour ja anexado e imutavel.';
  end if;
  if old.payload_bytes is null and new.payload_bytes is not null and old.state <> 'blocked' then
    raise exception 'Artefato Wintour so pode ser anexado a job bloqueado.';
  end if;
  return new;
end;
$$;

create or replace function preserve_wintour_protocol()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Protocolos Wintour sao imutaveis e somente append.';
end;
$$;

drop trigger if exists wintour_sale_links_validate_scope on wintour_sale_links;
create trigger wintour_sale_links_validate_scope
before insert or update of tenant_id, company_id, emission_id, source_ticket_id on wintour_sale_links
for each row execute function validate_wintour_sale_link_scope();

drop trigger if exists wintour_sale_links_preserve_identity on wintour_sale_links;
create trigger wintour_sale_links_preserve_identity
before update of tenant_id, emission_id, source_item_key, source_ticket_id,
  idv_externo, wintour_sale_number on wintour_sale_links
for each row execute function preserve_wintour_sale_identity();

drop trigger if exists wintour_sale_links_validate_state on wintour_sale_links;
create trigger wintour_sale_links_validate_state
before update of state on wintour_sale_links
for each row execute function validate_wintour_state_transition();

drop trigger if exists wintour_sync_jobs_validate_scope on wintour_sync_jobs;
create trigger wintour_sync_jobs_validate_scope
before insert or update of tenant_id, sale_link_id, company_id, emission_id, operation on wintour_sync_jobs
for each row execute function validate_wintour_job_scope();

drop trigger if exists wintour_sync_jobs_preserve_source on wintour_sync_jobs;
create trigger wintour_sync_jobs_preserve_source
before update of tenant_id, sale_link_id, emission_id, operation,
  link_source_fingerprint, config_fingerprint, source_fingerprint,
  source_snapshot, idempotency_key, file_number, payload_bytes, payload_sha256,
  payload_filename, payload_content_type, serializer_version, transport_free_field
on wintour_sync_jobs
for each row execute function preserve_wintour_job_source();

drop trigger if exists wintour_sync_jobs_validate_state on wintour_sync_jobs;
create trigger wintour_sync_jobs_validate_state
before update of state on wintour_sync_jobs
for each row execute function validate_wintour_job_state_transition();

drop trigger if exists wintour_sync_attempts_validate_scope on wintour_sync_attempts;
create trigger wintour_sync_attempts_validate_scope
before insert or update of tenant_id, sale_link_id, job_id on wintour_sync_attempts
for each row execute function validate_wintour_attempt_scope();

drop trigger if exists wintour_sync_protocols_validate_scope on wintour_sync_protocols;
create trigger wintour_sync_protocols_validate_scope
before insert on wintour_sync_protocols
for each row execute function validate_wintour_protocol_scope();

drop trigger if exists wintour_sync_protocols_preserve on wintour_sync_protocols;
create trigger wintour_sync_protocols_preserve
before update on wintour_sync_protocols
for each row execute function preserve_wintour_protocol();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'wintour_sync_settings', 'wintour_sale_links', 'wintour_sync_jobs',
    'wintour_sync_attempts', 'wintour_sync_protocols'
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

drop trigger if exists wintour_sync_settings_set_updated_at on wintour_sync_settings;
create trigger wintour_sync_settings_set_updated_at
before update on wintour_sync_settings for each row execute function set_updated_at();
drop trigger if exists wintour_sale_links_set_updated_at on wintour_sale_links;
create trigger wintour_sale_links_set_updated_at
before update on wintour_sale_links for each row execute function set_updated_at();
drop trigger if exists wintour_sync_jobs_set_updated_at on wintour_sync_jobs;
create trigger wintour_sync_jobs_set_updated_at
before update on wintour_sync_jobs for each row execute function set_updated_at();
drop trigger if exists wintour_sync_attempts_set_updated_at on wintour_sync_attempts;
create trigger wintour_sync_attempts_set_updated_at
before update on wintour_sync_attempts for each row execute function set_updated_at();

commit;
