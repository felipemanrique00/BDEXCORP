begin;

-- Uma emissao confirma um preco historico; ela nao altera silenciosamente o
-- tarifario contratual. A observacao abaixo e imutavel e pode ser usada como
-- sugestao auditavel quando nao houver uma tarifa vigente mais forte.
create table if not exists hotel_emission_rate_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  emission_id uuid not null,
  demand_id text not null,
  company_id text not null,
  reservation_id text not null,
  quote_id uuid not null,
  quote_option_id uuid not null,
  demand_room_id uuid not null,
  hotel_id text not null,
  hotel_supplier_id uuid not null,
  supplier_id uuid not null,
  room_type_id uuid,
  room_category text not null,
  occupancy_code citext not null references hotel_occupancy_types(code) on delete restrict,
  stay_start date not null,
  stay_end date not null,
  nightly_amount numeric(14,2) not null check (nightly_amount >= 0),
  nightly_tax_amount numeric(14,2) not null default 0 check (nightly_tax_amount >= 0),
  option_service_fee_amount numeric(14,2) not null default 0
    check (option_service_fee_amount >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  meal_plan text,
  refundable boolean,
  cancellation_policy text,
  payment_terms text,
  catalog_rate_id uuid,
  catalog_rate_version bigint,
  quote_snapshot_hash text not null check (quote_snapshot_hash ~ '^[0-9a-f]{64}$'),
  operational_supplier_name text not null,
  supplier_matches_quote boolean not null,
  source text not null default 'offline_emission' check (source = 'offline_emission'),
  issued_by uuid references users(id) on delete set null,
  issued_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, emission_id, demand_room_id),
  foreign key (tenant_id, emission_id)
    references travel_emissions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id)
    references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reservation_id)
    references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quote_id)
    references travel_quotes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quote_option_id)
    references travel_quote_options(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_room_id)
    references hotel_demand_rooms(tenant_id, id) on delete restrict,
  foreign key (tenant_id, hotel_id, hotel_supplier_id)
    references hotel_suppliers(tenant_id, hotel_id, id) on delete restrict,
  foreign key (tenant_id, supplier_id)
    references commercial_suppliers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, hotel_id, room_type_id)
    references hotel_room_types(tenant_id, hotel_id, id) on delete restrict,
  check (btrim(room_category) <> ''),
  check (stay_end > stay_start),
  check ((catalog_rate_id is null) = (catalog_rate_version is null)),
  check (catalog_rate_version is null or catalog_rate_version > 0),
  check (btrim(operational_supplier_name) <> '')
);

comment on column hotel_emission_rate_observations.option_service_fee_amount is
  'Taxa total da opcao emitida, repetida apenas como proveniencia; nao somar por quarto nem reaplicar automaticamente.';

create index if not exists hotel_emission_rate_observations_suggestion_idx
  on hotel_emission_rate_observations (
    tenant_id, company_id, occupancy_code, hotel_id, hotel_supplier_id, issued_at desc
  )
  where supplier_matches_quote and currency = 'BRL';

create index if not exists hotel_emission_rate_observations_emission_idx
  on hotel_emission_rate_observations (tenant_id, emission_id, created_at);

create or replace function validate_hotel_emission_rate_observation_scope()
returns trigger
language plpgsql
as $$
declare
  emission_status text;
  emission_provider text;
  emission_demand_id text;
  emission_company_id text;
  emission_reservation_id text;
  emission_issued_by uuid;
  emission_issued_at timestamptz;
  reservation_service text;
  reservation_quote_id uuid;
  reservation_option_id uuid;
begin
  select emission.status, emission.provider, emission.demand_id,
         emission.company_id, emission.reservation_id, emission.issued_by,
         emission.issued_at
    into emission_status, emission_provider, emission_demand_id,
         emission_company_id, emission_reservation_id, emission_issued_by,
         emission_issued_at
    from travel_emissions emission
   where emission.tenant_id = new.tenant_id
     and emission.id = new.emission_id;

  if not found
     or emission_status not in ('issued', 'partially_issued')
     or emission_provider <> 'manual-offline'
     or emission_demand_id <> new.demand_id
     or emission_company_id <> new.company_id
     or emission_reservation_id <> new.reservation_id then
    raise exception 'A observacao nao corresponde a uma emissao offline valida.';
  end if;

  select reservation.service_type, reservation.selected_quote_id,
         reservation.selected_quote_option_id
    into reservation_service, reservation_quote_id, reservation_option_id
    from reservations reservation
   where reservation.tenant_id = new.tenant_id
     and reservation.id = new.reservation_id
     and reservation.demand_id = new.demand_id
     and reservation.company_id = new.company_id;

  if not found
     or reservation_service <> 'hotelaria'
     or reservation_quote_id is distinct from new.quote_id
     or reservation_option_id is distinct from new.quote_option_id then
    raise exception 'A observacao nao corresponde a reserva hoteleira e opcao aprovadas.';
  end if;

  if not exists (
    select 1
      from hotel_quote_option_details detail
     where detail.tenant_id = new.tenant_id
       and detail.quote_option_id = new.quote_option_id
       and detail.hotel_id = new.hotel_id
       and detail.supplier_id = new.supplier_id
  ) then
    raise exception 'O hotel ou fornecedor da observacao diverge da opcao emitida.';
  end if;

  if not exists (
    select 1
      from hotel_demand_rooms room
     where room.tenant_id = new.tenant_id
       and room.id = new.demand_room_id
       and room.demand_id = new.demand_id
       and room.occupancy_code = new.occupancy_code
       and room.deleted_at is null
  ) then
    raise exception 'O quarto observado nao pertence a demanda emitida.';
  end if;

  new.issued_by := emission_issued_by;
  new.issued_at := emission_issued_at;
  return new;
end;
$$;

drop trigger if exists hotel_emission_rate_observations_validate_scope
  on hotel_emission_rate_observations;
create trigger hotel_emission_rate_observations_validate_scope
before insert on hotel_emission_rate_observations
for each row execute function validate_hotel_emission_rate_observation_scope();

create or replace function prevent_hotel_emission_rate_observation_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'Observacoes de tarifa emitida sao imutaveis.';
end;
$$;

drop trigger if exists hotel_emission_rate_observations_immutable
  on hotel_emission_rate_observations;
create trigger hotel_emission_rate_observations_immutable
before update or delete on hotel_emission_rate_observations
for each row execute function prevent_hotel_emission_rate_observation_mutation();

alter table hotel_emission_rate_observations enable row level security;
alter table hotel_emission_rate_observations force row level security;
drop policy if exists tenant_isolation on hotel_emission_rate_observations;
create policy tenant_isolation on hotel_emission_rate_observations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

commit;
