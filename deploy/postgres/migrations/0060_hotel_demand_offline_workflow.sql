begin;

-- Ocupacao descreve a composicao humana do quarto. Categoria comercial
-- (Standard, Luxo etc.) pertence a cotacao, nao a demanda.
create table if not exists hotel_occupancy_types (
  code citext primary key,
  name text not null,
  description text,
  max_guests smallint not null check (max_guests between 1 and 12),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(code::text) <> ''),
  check (btrim(name) <> '')
);

create table if not exists hotel_occupancy_slots (
  occupancy_code citext not null references hotel_occupancy_types(code) on delete cascade,
  slot_index smallint not null check (slot_index between 1 and 12),
  slot_role text not null check (slot_role in ('responsible', 'companion', 'guest')),
  label text not null,
  is_required boolean not null default true,
  allows_external_guest boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (occupancy_code, slot_index)
);

insert into hotel_occupancy_types (code, name, description, max_guests) values
  ('single', 'Single', 'Um hospede responsavel.', 1),
  ('couple', 'Casal', 'Responsavel e acompanhante.', 2),
  ('double', 'Duplo', 'Responsavel e segundo hospede.', 2),
  ('twin', 'Twin', 'Dois hospedes em camas separadas.', 2),
  ('triple', 'Triplo', 'Responsavel e mais dois hospedes.', 3),
  ('quadruple', 'Quadruplo', 'Responsavel e mais tres hospedes.', 4),
  ('family', 'Familia', 'Ocupacao familiar configuravel, ate seis hospedes.', 6)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  max_guests = excluded.max_guests,
  is_active = true,
  updated_at = now();

insert into hotel_occupancy_slots (
  occupancy_code, slot_index, slot_role, label, is_required, allows_external_guest
) values
  ('single', 1, 'responsible', 'Hospede responsavel', true, false),
  ('couple', 1, 'responsible', 'Hospede responsavel', true, false),
  ('couple', 2, 'companion', 'Acompanhante', true, true),
  ('double', 1, 'responsible', 'Hospede responsavel', true, false),
  ('double', 2, 'guest', 'Segundo hospede', true, true),
  ('twin', 1, 'responsible', 'Hospede responsavel', true, false),
  ('twin', 2, 'guest', 'Segundo hospede', true, true),
  ('triple', 1, 'responsible', 'Hospede responsavel', true, false),
  ('triple', 2, 'guest', 'Segundo hospede', true, true),
  ('triple', 3, 'guest', 'Terceiro hospede', true, true),
  ('quadruple', 1, 'responsible', 'Hospede responsavel', true, false),
  ('quadruple', 2, 'guest', 'Segundo hospede', true, true),
  ('quadruple', 3, 'guest', 'Terceiro hospede', true, true),
  ('quadruple', 4, 'guest', 'Quarto hospede', true, true),
  ('family', 1, 'responsible', 'Hospede responsavel', true, false),
  ('family', 2, 'companion', 'Acompanhante', true, true),
  ('family', 3, 'guest', 'Hospede 3', false, true),
  ('family', 4, 'guest', 'Hospede 4', false, true),
  ('family', 5, 'guest', 'Hospede 5', false, true),
  ('family', 6, 'guest', 'Hospede 6', false, true)
on conflict (occupancy_code, slot_index) do update set
  slot_role = excluded.slot_role,
  label = excluded.label,
  is_required = excluded.is_required,
  allows_external_guest = excluded.allows_external_guest;

create table if not exists demand_travelers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  employee_id text,
  traveler_role text not null check (traveler_role in ('responsible', 'companion', 'guest')),
  is_primary boolean not null default false,
  is_external boolean not null default false,
  name_snapshot text not null,
  email_snapshot citext,
  phone_snapshot text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, demand_id, id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  check (btrim(name_snapshot) <> ''),
  check ((is_external and employee_id is null) or (not is_external and employee_id is not null))
);

create unique index if not exists demand_travelers_employee_uidx
  on demand_travelers (tenant_id, demand_id, employee_id)
  where employee_id is not null and deleted_at is null;
create unique index if not exists demand_travelers_primary_uidx
  on demand_travelers (tenant_id, demand_id)
  where is_primary and deleted_at is null;

create table if not exists hotel_demand_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  country_id uuid references geo_countries(id) on delete restrict,
  subdivision_id uuid references geo_subdivisions(id) on delete restrict,
  city_id uuid references geo_cities(id) on delete restrict,
  preferred_hotel_id text,
  check_in date not null,
  check_out date not null,
  purpose text,
  accessibility_notes text,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  needs_review boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, demand_id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, preferred_hotel_id) references hotels(tenant_id, id) on delete restrict,
  check (check_out > check_in)
);

create index if not exists hotel_demand_details_city_idx
  on hotel_demand_details (tenant_id, city_id, check_in);

create table if not exists hotel_demand_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  room_sequence smallint not null check (room_sequence between 1 and 99),
  occupancy_code citext not null references hotel_occupancy_types(code) on delete restrict,
  notes text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, demand_id, id),
  unique (tenant_id, demand_id, room_sequence),
  foreign key (tenant_id, demand_id) references hotel_demand_details(tenant_id, demand_id) on delete cascade
);

create table if not exists hotel_demand_room_guests (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  room_id uuid not null,
  traveler_id uuid not null,
  slot_index smallint not null check (slot_index between 1 and 12),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, room_id, slot_index),
  unique (tenant_id, demand_id, traveler_id),
  foreign key (tenant_id, demand_id, room_id)
    references hotel_demand_rooms(tenant_id, demand_id, id) on delete cascade,
  foreign key (tenant_id, demand_id, traveler_id)
    references demand_travelers(tenant_id, demand_id, id) on delete restrict
);

-- Escolha formal e imutavel da opcao. O snapshot e a fronteira da aprovacao.
create table if not exists travel_quote_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  quote_id uuid not null,
  option_id uuid not null,
  status text not null
    check (status in ('selected', 'pending_approval', 'approved', 'rejected', 'superseded')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash char(64) not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  approval_instance_id uuid,
  chosen_by uuid not null references users(id) on delete restrict,
  chosen_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  superseded_at timestamptz,
  superseded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, demand_id, id),
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quote_id) references travel_quotes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, option_id) references travel_quote_options(tenant_id, id) on delete restrict,
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete restrict,
  check ((status = 'superseded' and superseded_at is not null) or (status <> 'superseded' and superseded_at is null))
);

create unique index if not exists travel_quote_selections_active_uidx
  on travel_quote_selections (tenant_id, demand_id)
  where status in ('selected', 'pending_approval', 'approved');
create index if not exists travel_quote_selections_approval_idx
  on travel_quote_selections (tenant_id, approval_instance_id)
  where approval_instance_id is not null;

create table if not exists hotel_quote_option_details (
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  hotel_id text,
  supplier_id uuid,
  meal_plan text,
  room_category text,
  cancellation_policy text,
  no_show_policy text,
  payment_terms text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, quote_option_id),
  foreign key (tenant_id, quote_option_id) references travel_quote_options(tenant_id, id) on delete cascade,
  foreign key (tenant_id, hotel_id) references hotels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supplier_id) references commercial_suppliers(tenant_id, id) on delete restrict
);

create table if not exists hotel_quote_room_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  demand_room_id uuid not null,
  room_category text,
  nightly_amount_minor bigint not null check (nightly_amount_minor >= 0),
  nights smallint not null check (nights between 1 and 366),
  subtotal_amount_minor bigint not null check (subtotal_amount_minor >= 0),
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_option_id, demand_room_id),
  foreign key (tenant_id, quote_option_id) references travel_quote_options(tenant_id, id) on delete cascade,
  foreign key (tenant_id, demand_room_id) references hotel_demand_rooms(tenant_id, id) on delete restrict,
  check (subtotal_amount_minor = nightly_amount_minor * nights)
);

create table if not exists quote_option_charge_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_option_id uuid not null,
  charge_type text not null check (charge_type in ('tax', 'fee', 'addition', 'discount')),
  code text,
  description text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, quote_option_id) references travel_quote_options(tenant_id, id) on delete cascade,
  check (btrim(description) <> '')
);

alter table reservations
  add column if not exists correction_status text not null default 'none'
    check (correction_status in ('none', 'required', 'pending_approval')),
  add column if not exists correction_notes text,
  add column if not exists correction_updated_at timestamptz,
  add column if not exists correction_updated_by uuid references users(id) on delete set null;

create table if not exists offline_reservation_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reservation_id text not null,
  from_version bigint not null check (from_version > 0),
  to_version bigint not null check (to_version > from_version),
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  material_change boolean not null default false,
  previous_snapshot jsonb not null check (jsonb_typeof(previous_snapshot) = 'object'),
  next_snapshot jsonb not null check (jsonb_typeof(next_snapshot) = 'object'),
  approval_instance_id uuid,
  changed_by uuid not null references users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reservation_id, to_version),
  foreign key (tenant_id, reservation_id) references reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete restrict
);

create table if not exists voucher_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  voucher_id text not null,
  recipient_type text not null check (recipient_type in ('requester', 'traveler', 'operator')),
  requester_id text,
  employee_id text,
  recipient_name text not null,
  recipient_email citext,
  recipient_phone text,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  idempotency_key text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, voucher_id) references vouchers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, requester_id) references requesters(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  check (recipient_email is not null or recipient_phone is not null),
  check ((recipient_type = 'requester' and requester_id is not null)
      or (recipient_type = 'traveler' and employee_id is not null)
      or recipient_type = 'operator')
);

create index if not exists voucher_deliveries_queue_idx
  on voucher_deliveries (tenant_id, status, created_at)
  where status in ('pending', 'failed');

create or replace function validate_demand_traveler_scope()
returns trigger
language plpgsql
as $$
declare
  demand_company text;
  employee_company text;
begin
  select company_id into demand_company
  from demands where tenant_id = new.tenant_id and id = new.demand_id and deleted_at is null;
  if demand_company is null or demand_company <> new.company_id then
    raise exception 'Viajante fora do escopo da demanda/empresa.';
  end if;
  if new.employee_id is not null then
    select company_id into employee_company
    from employees where tenant_id = new.tenant_id and id = new.employee_id
      and status = 'active' and deleted_at is null;
    if employee_company is null or employee_company <> new.company_id then
      raise exception 'Funcionario inativo ou fora da empresa da demanda.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists demand_travelers_validate_scope on demand_travelers;
create trigger demand_travelers_validate_scope
before insert or update of tenant_id, demand_id, company_id, employee_id on demand_travelers
for each row execute function validate_demand_traveler_scope();

create or replace function validate_hotel_room_guest_slot()
returns trigger
language plpgsql
as $$
declare
  room_occupancy citext;
begin
  select occupancy_code into room_occupancy
  from hotel_demand_rooms
  where tenant_id = new.tenant_id and demand_id = new.demand_id and id = new.room_id
    and deleted_at is null;
  if room_occupancy is null or not exists (
    select 1 from hotel_occupancy_slots
    where occupancy_code = room_occupancy and slot_index = new.slot_index
  ) then
    raise exception 'Slot de hospede invalido para a ocupacao do quarto.';
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_demand_room_guests_validate_slot on hotel_demand_room_guests;
create trigger hotel_demand_room_guests_validate_slot
before insert or update on hotel_demand_room_guests
for each row execute function validate_hotel_room_guest_slot();

-- Acrescenta a volta controlada para escolha. O comando TypeScript
-- accept_for_quotation usa o par ja permitido submitted>approved_for_quotation.
create or replace function enforce_demand_lifecycle_transition()
returns trigger
language plpgsql
as $$
declare
  lifecycle_command text;
  idempotency_key text;
  transition_key text;
  allowed_transitions text[] := array[
    'draft>submitted', 'submitted>pending_merit_approval', 'submitted>approved_for_quotation',
    'pending_merit_approval>approved_for_quotation', 'approved_for_quotation>quoting',
    'quoting>pending_choice', 'pending_choice>pending_cost_approval', 'pending_choice>approved',
    'approved>pending_cost_approval', 'pending_cost_approval>approved',
    'pending_cost_approval>pending_choice', 'approved>reserving',
    'reserving>reserved', 'reserved>pending_issuance', 'pending_issuance>issuing',
    'partially_issued>issuing', 'issuing>issued', 'partially_issued>issued',
    'issuing>partially_issued', 'submitted>rejected', 'pending_merit_approval>rejected',
    'pending_choice>rejected', 'pending_cost_approval>rejected', 'issued>pending_refund',
    'partially_issued>pending_refund', 'canceled>pending_refund', 'pending_refund>refunded',
    'issued>closed', 'refunded>closed'
  ];
begin
  if new.lifecycle_status is not distinct from old.lifecycle_status then return new; end if;
  lifecycle_command := nullif(current_setting('app.lifecycle_command', true), '');
  idempotency_key := nullif(current_setting('app.idempotency_key', true), '');
  if lifecycle_command is null or idempotency_key is null then
    raise exception 'Transicao de ciclo de vida exige comando e chave de idempotencia.';
  end if;
  transition_key := old.lifecycle_status || '>' || new.lifecycle_status;
  if not (transition_key = any(allowed_transitions))
    and not (new.lifecycle_status = 'canceled' and old.lifecycle_status not in ('rejected', 'expired', 'closed'))
    and not (new.lifecycle_status = 'expired' and old.lifecycle_status not in ('issued', 'refunded', 'rejected', 'canceled', 'closed'))
    and not (new.lifecycle_status = 'failed' and old.lifecycle_status not in ('draft', 'issued', 'refunded', 'rejected', 'canceled', 'expired', 'closed'))
  then
    raise exception 'Transicao de ciclo de vida invalida: %', transition_key;
  end if;
  if new.lifecycle_version <> old.lifecycle_version + 1 then
    raise exception 'Versao do ciclo de vida deve ser incrementada em uma unidade.';
  end if;
  if new.last_transition_at is null then
    raise exception 'Data da transicao e obrigatoria.';
  end if;
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'demand_travelers', 'hotel_demand_details', 'hotel_demand_rooms',
    'hotel_demand_room_guests', 'travel_quote_selections',
    'hotel_quote_option_details', 'hotel_quote_room_rates',
    'quote_option_charge_lines', 'offline_reservation_revisions',
    'voucher_deliveries'
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

drop trigger if exists hotel_occupancy_types_set_updated_at on hotel_occupancy_types;
create trigger hotel_occupancy_types_set_updated_at before update on hotel_occupancy_types for each row execute function set_updated_at();
drop trigger if exists demand_travelers_set_updated_at on demand_travelers;
create trigger demand_travelers_set_updated_at before update on demand_travelers for each row execute function set_updated_at();
drop trigger if exists hotel_demand_details_set_updated_at on hotel_demand_details;
create trigger hotel_demand_details_set_updated_at before update on hotel_demand_details for each row execute function set_updated_at();
drop trigger if exists hotel_demand_rooms_set_updated_at on hotel_demand_rooms;
create trigger hotel_demand_rooms_set_updated_at before update on hotel_demand_rooms for each row execute function set_updated_at();
drop trigger if exists travel_quote_selections_set_updated_at on travel_quote_selections;
create trigger travel_quote_selections_set_updated_at before update on travel_quote_selections for each row execute function set_updated_at();
drop trigger if exists hotel_quote_option_details_set_updated_at on hotel_quote_option_details;
create trigger hotel_quote_option_details_set_updated_at before update on hotel_quote_option_details for each row execute function set_updated_at();
drop trigger if exists voucher_deliveries_set_updated_at on voucher_deliveries;
create trigger voucher_deliveries_set_updated_at before update on voucher_deliveries for each row execute function set_updated_at();

commit;
