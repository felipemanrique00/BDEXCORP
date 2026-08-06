begin;

-- The function is shared by emissions, cancellations and justifications.
-- Access cancellation-only fields exclusively inside that trigger branch.
create or replace function validate_post_booking_scope()
returns trigger
language plpgsql
as $$
declare
  reservation_company text;
  reservation_demand text;
  emission_company text;
  emission_demand text;
  emission_reservation text;
begin
  if new.reservation_id is not null then
    select company_id, demand_id into reservation_company, reservation_demand
    from reservations
    where tenant_id = new.tenant_id and id = new.reservation_id;

    if reservation_company is null
       or reservation_company <> new.company_id
       or reservation_demand is distinct from new.demand_id then
      raise exception 'Reserva fora do escopo da demanda/empresa.';
    end if;
  end if;

  if tg_table_name = 'travel_cancellations' then
    if new.emission_id is not null then
      select company_id, demand_id, reservation_id
        into emission_company, emission_demand, emission_reservation
      from travel_emissions
      where tenant_id = new.tenant_id and id = new.emission_id;

      if emission_company is null
         or emission_company <> new.company_id
         or emission_demand <> new.demand_id
         or emission_reservation <> new.reservation_id then
        raise exception 'Emissao fora do escopo do cancelamento.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

commit;
