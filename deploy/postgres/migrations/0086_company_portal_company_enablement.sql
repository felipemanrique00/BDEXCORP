begin;

alter table companies
  add column if not exists company_portal_enabled boolean;

update companies
set company_portal_enabled = (
  status = 'active'
  and deleted_at is null
)
where company_portal_enabled is null;

alter table companies
  alter column company_portal_enabled set default false;

alter table companies
  alter column company_portal_enabled set not null;

commit;
