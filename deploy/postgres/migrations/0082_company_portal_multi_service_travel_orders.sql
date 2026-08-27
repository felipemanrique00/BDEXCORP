begin;

-- Pedido-pai privado do Portal Empresa. Enquanto estiver em draft/submitting,
-- nenhum item materializado e visivel nas filas operacionais.
create table if not exists company_portal_travel_order_counters (
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_year integer not null check (order_year between 2020 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, order_year)
);

-- A identidade proprietaria precisa pertencer ao mesmo tenant. A chave e
-- redundante com (tenant_id,user_id), mas permite uma FK declarativa completa.
create unique index if not exists tenant_memberships_tenant_id_user_uidx
  on tenant_memberships (tenant_id, id, user_id);
create unique index if not exists requesters_tenant_id_id_company_user_uidx
  on requesters (tenant_id, id, company_id, user_id);

create table if not exists company_portal_travel_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  requester_id text not null,
  requester_user_id uuid not null references users(id) on delete restrict,
  requester_membership_id uuid not null references tenant_memberships(id) on delete restrict,
  order_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitting', 'submitted')),
  version bigint not null default 1 check (version > 0),
  submit_idempotency_key text,
  submit_input_hash char(64),
  usage_registered_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, company_id),
  unique (tenant_id, order_number),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, requester_id, company_id, requester_user_id)
    references requesters(tenant_id, id, company_id, user_id) on delete restrict,
  foreign key (tenant_id, requester_membership_id, requester_user_id)
    references tenant_memberships(tenant_id, id, user_id) on delete restrict,
  check (
    (status in ('draft', 'submitting') and submitted_at is null)
    or (status = 'submitted' and submitted_at is not null)
  ),
  check (
    (submit_idempotency_key is null and submit_input_hash is null)
    or (
      submit_idempotency_key is not null
      and length(submit_idempotency_key) between 8 and 200
      and submit_input_hash ~ '^[0-9a-f]{64}$'
    )
  )
);

create index if not exists company_portal_travel_orders_owner_idx
  on company_portal_travel_orders (
    tenant_id, requester_user_id, company_id, status, updated_at desc
  );
create index if not exists company_portal_travel_orders_company_idx
  on company_portal_travel_orders (tenant_id, company_id, status, updated_at desc);

create table if not exists company_portal_travel_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null,
  company_id text not null,
  service_type text not null check (service_type in ('air', 'hotel')),
  position smallint not null check (position between 1 and 32),
  demand_payload jsonb not null check (jsonb_typeof(demand_payload) = 'object'),
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  completeness_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(completeness_issues) = 'array'),
  child_demand_id text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_id, id),
  unique (tenant_id, order_id, id, company_id),
  unique (tenant_id, order_id, service_type),
  unique (tenant_id, order_id, position),
  unique (tenant_id, child_demand_id),
  foreign key (tenant_id, order_id, company_id)
    references company_portal_travel_orders(tenant_id, id, company_id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (child_demand_id is null or btrim(child_demand_id) <> '')
);

create index if not exists company_portal_travel_order_items_order_idx
  on company_portal_travel_order_items (tenant_id, order_id, position);

-- Registro de comando separado do snapshot atual. Assim uma resposta perdida
-- pode ser repetida sem recriar pedido/item nem reexecutar o envio.
create table if not exists company_portal_travel_order_operations (
  tenant_id uuid not null references tenants(id) on delete cascade,
  idempotency_key text not null,
  input_hash char(64) not null check (input_hash ~ '^[0-9a-f]{64}$'),
  operation text not null
    check (operation in ('create', 'reorder', 'item_upsert', 'item_delete', 'submit')),
  order_id uuid not null,
  item_id uuid,
  actor_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key),
  foreign key (tenant_id, order_id)
    references company_portal_travel_orders(tenant_id, id) on delete cascade,
  check (length(idempotency_key) between 8 and 200)
);

alter table demands
  add column if not exists travel_order_id uuid,
  add column if not exists travel_order_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_travel_order_fk'
      and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_travel_order_fk
      foreign key (tenant_id, travel_order_id, company_id)
      references company_portal_travel_orders(tenant_id, id, company_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_travel_order_item_fk'
      and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_travel_order_item_fk
      foreign key (tenant_id, travel_order_id, travel_order_item_id, company_id)
      references company_portal_travel_order_items(tenant_id, order_id, id, company_id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_travel_order_pair_check'
      and conrelid = 'demands'::regclass
  ) then
    alter table demands add constraint demands_travel_order_pair_check
      check (
        (travel_order_id is null and travel_order_item_id is null)
        or (travel_order_id is not null and travel_order_item_id is not null)
      );
  end if;
end;
$$;

create unique index if not exists demands_travel_order_item_uidx
  on demands (tenant_id, travel_order_id, travel_order_item_id)
  where travel_order_id is not null;
create unique index if not exists demands_travel_order_item_demand_uidx
  on demands (tenant_id, travel_order_id, travel_order_item_id, id)
  ;
create index if not exists demands_travel_order_idx
  on demands (tenant_id, travel_order_id, created_at)
  where travel_order_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'travel_order_items_child_demand_fk'
      and conrelid = 'company_portal_travel_order_items'::regclass
  ) then
    alter table company_portal_travel_order_items
      add constraint travel_order_items_child_demand_fk
      foreign key (tenant_id, order_id, id, child_demand_id)
      references demands(tenant_id, travel_order_id, travel_order_item_id, id)
      deferrable initially deferred;
  end if;
end;
$$;

create or replace function validate_travel_order_child_service()
returns trigger
language plpgsql
as $$
declare
  expected_service text;
  normalized_service text;
begin
  if new.travel_order_id is null then
    return new;
  end if;
  select item.service_type into expected_service
  from company_portal_travel_order_items item
  where item.tenant_id = new.tenant_id
    and item.order_id = new.travel_order_id
    and item.id = new.travel_order_item_id
    and item.company_id = new.company_id;
  normalized_service := case
    when lower(btrim(new.service_type)) in ('air', 'aereo', U&'a\00E9reo') then 'air'
    when lower(btrim(new.service_type)) in ('hotel', 'hotelaria', 'hospedagem') then 'hotel'
    else lower(btrim(new.service_type))
  end;
  if expected_service is null or normalized_service <> expected_service then
    raise exception 'Servico da demanda nao corresponde ao item do pedido.';
  end if;
  return new;
end;
$$;

drop trigger if exists demands_validate_travel_order_service on demands;
create trigger demands_validate_travel_order_service
before insert or update of tenant_id, company_id, service_type,
  travel_order_id, travel_order_item_id on demands
for each row execute function validate_travel_order_child_service();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'company_portal_travel_order_counters',
    'company_portal_travel_orders',
    'company_portal_travel_order_items',
    'company_portal_travel_order_operations'
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

-- Defesa estrutural da fronteira de publicacao. Uma demanda filha somente faz
-- parte do dominio operacional depois que o pedido-pai foi publicado. A saga
-- usa uma GUC LOCAL e explicita durante criacao/recuperacao; qualquer outra
-- consulta, inclusive um endpoint novo sem predicate proprio, falha fechada.
drop policy if exists tenant_isolation on demands;
create policy tenant_isolation on demands
using (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  and (
    travel_order_id is null
    or current_setting('app.allow_hidden_travel_order_child', true) = 'true'
    or exists (
      select 1
      from company_portal_travel_orders visible_order
      where visible_order.tenant_id = demands.tenant_id
        and visible_order.id = demands.travel_order_id
        and visible_order.status = 'submitted'
    )
  )
)
with check (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  and (
    travel_order_id is null
    or current_setting('app.allow_hidden_travel_order_child', true) = 'true'
    or exists (
      select 1
      from company_portal_travel_orders visible_order
      where visible_order.tenant_id = demands.tenant_id
        and visible_order.id = demands.travel_order_id
        and visible_order.status = 'submitted'
    )
  )
);

drop trigger if exists company_portal_travel_order_counters_set_updated_at
  on company_portal_travel_order_counters;
create trigger company_portal_travel_order_counters_set_updated_at
before update on company_portal_travel_order_counters
for each row execute function set_updated_at();

drop trigger if exists company_portal_travel_orders_set_updated_at
  on company_portal_travel_orders;
create trigger company_portal_travel_orders_set_updated_at
before update on company_portal_travel_orders
for each row execute function set_updated_at();

drop trigger if exists company_portal_travel_order_items_set_updated_at
  on company_portal_travel_order_items;
create trigger company_portal_travel_order_items_set_updated_at
before update on company_portal_travel_order_items
for each row execute function set_updated_at();

commit;
