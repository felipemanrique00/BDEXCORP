begin;

-- 0082 ja foi publicada com o primeiro recorte (aereo + hotel). Esta migracao
-- amplia o dominio do item sem reescrever o checksum historico.
alter table company_portal_travel_order_items
  drop constraint if exists company_portal_travel_order_items_service_type_check;

alter table company_portal_travel_order_items
  add constraint company_portal_travel_order_items_service_type_check
  check (service_type in ('air', 'hotel', 'car', 'bus'));

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
    when lower(btrim(new.service_type)) in (
      'car', 'carro', 'locacao', U&'loca\00E7\00E3o',
      'locacao de veiculo', U&'loca\00E7\00E3o de ve\00EDculo'
    ) then 'car'
    when lower(btrim(new.service_type)) in (
      'bus', 'rodoviario', U&'rodovi\00E1rio',
      'onibus', U&'\00F4nibus',
      'passagem rodoviaria', U&'passagem rodovi\00E1ria'
    ) then 'bus'
    else lower(btrim(new.service_type))
  end;
  if expected_service is null or normalized_service <> expected_service then
    raise exception 'Servico da demanda nao corresponde ao item do pedido.';
  end if;
  return new;
end;
$$;

commit;
