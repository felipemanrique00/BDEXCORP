begin;

alter table requesters
  drop constraint if exists requesters_status_check;

alter table requesters
  add constraint requesters_status_check
  check (status in ('active', 'inactive', 'pending', 'blocked'));

alter table requesters
  add column if not exists notes text,
  add column if not exists version bigint not null default 1,
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists updated_by uuid references users(id) on delete set null;

alter table requesters
  drop constraint if exists requesters_version_check;

alter table requesters
  add constraint requesters_version_check check (version > 0);

alter table requesters
  drop constraint if exists requesters_soft_delete_status_check;

alter table requesters
  add constraint requesters_soft_delete_status_check
  check (deleted_at is null or status = 'inactive');

alter table requesters
  drop constraint if exists requesters_permissions_shape_check;

alter table requesters
  add constraint requesters_permissions_shape_check check (
    jsonb_typeof(permissions) = 'object'
    and (
      not (permissions ? 'canCreateDemand')
      or jsonb_typeof(permissions -> 'canCreateDemand') = 'boolean'
    )
    and (
      not (permissions ? 'canViewVouchers')
      or jsonb_typeof(permissions -> 'canViewVouchers') = 'boolean'
    )
    and (
      not (permissions ? 'canViewFinance')
      or jsonb_typeof(permissions -> 'canViewFinance') = 'boolean'
    )
  );

create index if not exists requesters_company_status_idx
  on requesters (tenant_id, company_id, status, name)
  where deleted_at is null;

create index if not exists requesters_user_idx
  on requesters (tenant_id, user_id)
  where user_id is not null and deleted_at is null;

create index if not exists requesters_employee_idx
  on requesters (tenant_id, employee_id)
  where employee_id is not null and deleted_at is null;

commit;
