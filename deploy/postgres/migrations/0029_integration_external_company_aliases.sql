begin;

alter table integration_company_mappings
  add column if not exists mapping_type text not null default 'provider_company';

alter table integration_company_mappings
  drop constraint if exists integration_company_mappings_mapping_type_check;
alter table integration_company_mappings
  add constraint integration_company_mappings_mapping_type_check
  check (mapping_type in ('provider_company', 'external_alias'));

alter table integration_company_mappings
  drop constraint if exists integration_company_mappings_tenant_id_company_id_provider_key;

create unique index if not exists integration_company_mappings_active_provider_company_uidx
  on integration_company_mappings (tenant_id, company_id, provider)
  where mapping_type = 'provider_company' and status = 'active';

create index if not exists integration_company_mappings_alias_lookup_idx
  on integration_company_mappings (tenant_id, provider, provider_company_id, status)
  where mapping_type = 'external_alias';

commit;
