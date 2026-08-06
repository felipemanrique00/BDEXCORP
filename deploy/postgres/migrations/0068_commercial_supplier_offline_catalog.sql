begin;

-- Evolucao aditiva do catalogo comercial offline. Fornecedor comercial,
-- propriedade hoteleira, vinculo fornecedor/propriedade e tarifa continuam
-- entidades distintas para evitar duplicidade fiscal e operacional.
alter table commercial_suppliers
  add column if not exists reservation_system text not null default 'manual'
    check (reservation_system in ('manual', 'email', 'portal', 'api', 'other'));

alter table commercial_supplier_contacts
  add column if not exists fax text;

-- O contato pode ser mantido somente por fax em fornecedores legados.
alter table commercial_supplier_contacts
  drop constraint if exists commercial_supplier_contacts_check;
alter table commercial_supplier_contacts
  add constraint commercial_supplier_contacts_channel_check
    check (email is not null or phone is not null or fax is not null),
  add constraint commercial_supplier_contacts_fax_check
    check (fax is null or btrim(fax) <> '');

create index if not exists commercial_suppliers_reservation_system_idx
  on commercial_suppliers (tenant_id, reservation_system, status)
  where deleted_at is null;

alter table hotels
  add column if not exists chain_name text,
  add column if not exists brand_name text,
  add column if not exists star_rating smallint
    check (star_rating between 1 and 5);

alter table hotel_suppliers
  add column if not exists out_of_period_policy text not null default 'block'
    check (out_of_period_policy in ('block', 'warn', 'allow'));

alter table hotel_supplier_rates
  add column if not exists rack_amount numeric(14,2)
    check (rack_amount is null or rack_amount >= 0),
  add column if not exists service_fee_amount numeric(14,2) not null default 0
    check (service_fee_amount >= 0),
  add column if not exists is_net boolean not null default false,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists scope_type text not null default 'global'
    check (scope_type in ('global', 'restricted'));

-- Uma tarifa restrita pode abranger empresas avulsas e/ou grupos economicos.
-- A consistencia global/restricted e validada no servico que grava a tarifa,
-- pois a tarifa e seus escopos nascem na mesma transacao.
create table if not exists hotel_supplier_rate_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rate_id uuid not null,
  scope_type text not null check (scope_type in ('company', 'group')),
  company_id text,
  business_group_id text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, rate_id)
    references hotel_supplier_rates(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, business_group_id)
    references business_groups(tenant_id, id) on delete restrict,
  check (
    (scope_type = 'company' and company_id is not null and business_group_id is null)
    or
    (scope_type = 'group' and company_id is null and business_group_id is not null)
  )
);

create unique index if not exists hotel_supplier_rate_scopes_company_uidx
  on hotel_supplier_rate_scopes (tenant_id, rate_id, company_id)
  where company_id is not null and deleted_at is null;

create unique index if not exists hotel_supplier_rate_scopes_group_uidx
  on hotel_supplier_rate_scopes (tenant_id, rate_id, business_group_id)
  where business_group_id is not null and deleted_at is null;

create index if not exists hotel_supplier_rate_scopes_company_lookup_idx
  on hotel_supplier_rate_scopes (tenant_id, company_id, rate_id)
  where company_id is not null and deleted_at is null;

create index if not exists hotel_supplier_rate_scopes_group_lookup_idx
  on hotel_supplier_rate_scopes (tenant_id, business_group_id, rate_id)
  where business_group_id is not null and deleted_at is null;

create index if not exists hotel_supplier_rates_scope_lookup_idx
  on hotel_supplier_rates (
    tenant_id, hotel_supplier_id, scope_type, is_active, is_suspended,
    valid_from, valid_until
  );

create or replace function validate_hotel_supplier_rate_scope_identity()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.rate_id is distinct from old.rate_id
    or new.scope_type is distinct from old.scope_type
    or new.company_id is distinct from old.company_id
    or new.business_group_id is distinct from old.business_group_id
  then
    raise exception 'O tenant, a tarifa e o alvo do escopo sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_supplier_rate_scopes_validate_identity
  on hotel_supplier_rate_scopes;
create trigger hotel_supplier_rate_scopes_validate_identity
before update on hotel_supplier_rate_scopes
for each row execute function validate_hotel_supplier_rate_scope_identity();

-- Garante no commit que tarifa global nao tenha alvos e que uma tarifa
-- restrita possua ao menos uma empresa ou grupo ativo. Os gatilhos sao
-- diferidos porque o pai e os alvos sao gravados na mesma transacao.
create or replace function validate_hotel_supplier_rate_scope_consistency()
returns trigger
language plpgsql
as $$
declare
  target_tenant_id uuid;
  target_rate_id uuid;
  target_scope_type text;
  active_scope_count bigint;
begin
  if tg_table_name = 'hotel_supplier_rates' then
    if tg_op = 'DELETE' then
      target_tenant_id := old.tenant_id;
      target_rate_id := old.id;
    else
      target_tenant_id := new.tenant_id;
      target_rate_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_tenant_id := old.tenant_id;
      target_rate_id := old.rate_id;
    else
      target_tenant_id := new.tenant_id;
      target_rate_id := new.rate_id;
    end if;
  end if;

  select rate.scope_type
    into target_scope_type
    from hotel_supplier_rates rate
   where rate.tenant_id = target_tenant_id
     and rate.id = target_rate_id;

  if not found then
    return null;
  end if;

  select count(*)
    into active_scope_count
    from hotel_supplier_rate_scopes scope
   where scope.tenant_id = target_tenant_id
     and scope.rate_id = target_rate_id
     and scope.deleted_at is null;

  if target_scope_type = 'global' and active_scope_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Tarifa global nao pode possuir empresas ou grupos vinculados.';
  end if;
  if target_scope_type = 'restricted' and active_scope_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'Tarifa restrita exige ao menos uma empresa ou grupo vinculado.';
  end if;
  return null;
end;
$$;

drop trigger if exists hotel_supplier_rates_validate_scope_consistency
  on hotel_supplier_rates;
create constraint trigger hotel_supplier_rates_validate_scope_consistency
after insert or update or delete on hotel_supplier_rates
deferrable initially deferred
for each row execute function validate_hotel_supplier_rate_scope_consistency();

drop trigger if exists hotel_supplier_rate_scopes_validate_consistency
  on hotel_supplier_rate_scopes;
create constraint trigger hotel_supplier_rate_scopes_validate_consistency
after insert or update or delete on hotel_supplier_rate_scopes
deferrable initially deferred
for each row execute function validate_hotel_supplier_rate_scope_consistency();

alter table hotel_supplier_rate_scopes enable row level security;
alter table hotel_supplier_rate_scopes force row level security;
drop policy if exists tenant_isolation on hotel_supplier_rate_scopes;
create policy tenant_isolation on hotel_supplier_rate_scopes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists hotel_supplier_rate_scopes_set_updated_at
  on hotel_supplier_rate_scopes;
create trigger hotel_supplier_rate_scopes_set_updated_at
before update on hotel_supplier_rate_scopes
for each row execute function set_updated_at();

commit;
