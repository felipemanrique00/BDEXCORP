begin;

-- O codigo do voucher e sequencial dentro de cada tenant (por exemplo,
-- H-100000). Logo, o identificador relacional precisa usar o mesmo escopo.
-- Todas as leituras e a FK de entregas ja carregam tenant_id.
lock table vouchers, voucher_deliveries in access exclusive mode;

alter table voucher_deliveries
  drop constraint if exists voucher_deliveries_tenant_id_voucher_id_fkey;

alter table vouchers
  drop constraint if exists vouchers_pkey;

alter table vouchers
  drop constraint if exists vouchers_tenant_id_id_key;

alter table vouchers
  add constraint vouchers_pkey primary key (tenant_id, id);

alter table voucher_deliveries
  add constraint voucher_deliveries_tenant_id_voucher_id_fkey
  foreign key (tenant_id, voucher_id)
  references vouchers(tenant_id, id)
  on delete cascade;

commit;
