begin;

-- Preferencias pertencem a necessidade da hospedagem, nao a uma cotacao.
-- A ordem e preservada para que o consultor receba as opcoes na mesma
-- sequencia escolhida pelo solicitante.
create table if not exists hotel_demand_preferred_hotels (
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  hotel_id text not null,
  preference_order smallint not null check (preference_order between 1 and 10),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, demand_id, hotel_id),
  unique (tenant_id, demand_id, preference_order),
  foreign key (tenant_id, demand_id)
    references hotel_demand_details(tenant_id, demand_id) on delete cascade,
  foreign key (tenant_id, hotel_id)
    references hotels(tenant_id, id) on delete restrict
);

create index if not exists hotel_demand_preferred_hotels_hotel_idx
  on hotel_demand_preferred_hotels (tenant_id, hotel_id, demand_id);

-- Mantem demandas anteriores legiveis sem remover a coluna singular. O campo
-- antigo continuara espelhando a primeira preferencia durante a transicao.
insert into hotel_demand_preferred_hotels (
  tenant_id, demand_id, hotel_id, preference_order, created_by, created_at
)
select tenant_id, demand_id, preferred_hotel_id, 1, created_by, created_at
from hotel_demand_details
where preferred_hotel_id is not null
on conflict do nothing;

alter table hotel_demand_preferred_hotels enable row level security;
alter table hotel_demand_preferred_hotels force row level security;
drop policy if exists tenant_isolation on hotel_demand_preferred_hotels;
create policy tenant_isolation on hotel_demand_preferred_hotels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

commit;
