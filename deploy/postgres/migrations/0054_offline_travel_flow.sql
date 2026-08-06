begin;

alter table vouchers
  add column if not exists emission_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vouchers_emission_fk'
      and conrelid = 'vouchers'::regclass
  ) then
    alter table vouchers add constraint vouchers_emission_fk
      foreign key (tenant_id, emission_id)
      references travel_emissions(tenant_id, id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists vouchers_emission_uidx
  on vouchers (tenant_id, emission_id)
  where emission_id is not null and deleted_at is null;

alter table travel_segments
  drop constraint if exists travel_segments_segment_type_check;

alter table travel_segments
  add constraint travel_segments_segment_type_check
  check (segment_type ~ '^[a-z][a-z0-9_]{1,39}$');

create index if not exists reservations_manual_offline_idx
  on reservations (tenant_id, demand_id, status, created_at desc)
  where provider = 'manual-offline';

create index if not exists travel_emissions_manual_offline_idx
  on travel_emissions (tenant_id, reservation_id, status, issued_at desc)
  where provider = 'manual-offline';

create or replace function validate_voucher_emission_scope()
returns trigger
language plpgsql
as $$
declare
  emission_company text;
  emission_demand text;
  emission_reservation text;
begin
  if new.emission_id is null then
    return new;
  end if;

  select company_id, demand_id, reservation_id
    into emission_company, emission_demand, emission_reservation
  from travel_emissions
  where tenant_id = new.tenant_id and id = new.emission_id;

  if emission_company is null
     or emission_company <> new.company_id
     or emission_demand is distinct from new.demand_id
     or emission_reservation is distinct from new.reservation_id then
    raise exception 'Voucher fora do escopo da emissao/reserva/demanda.';
  end if;

  return new;
end;
$$;

drop trigger if exists vouchers_validate_emission_scope on vouchers;
create trigger vouchers_validate_emission_scope
before insert or update of tenant_id, emission_id, reservation_id, demand_id, company_id on vouchers
for each row execute function validate_voucher_emission_scope();

commit;
