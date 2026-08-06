begin;

-- Parametrizacao tri-state da apresentacao do voucher. NULL representa
-- heranca; o valor efetivo e resolvido por empresa -> grupo -> sistema.
create table if not exists voucher_presentation_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scope_type text not null check (scope_type in ('group', 'company')),
  business_group_id text,
  company_id text,
  show_confirmed_values boolean,
  show_cancellation_terms boolean,
  show_administrative_data boolean,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, business_group_id)
    references business_groups(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete cascade,
  check (
    (scope_type = 'group' and business_group_id is not null and company_id is null)
    or
    (scope_type = 'company' and company_id is not null and business_group_id is null)
  )
);

create unique index if not exists voucher_presentation_settings_group_uidx
  on voucher_presentation_settings (tenant_id, business_group_id)
  where scope_type = 'group';

create unique index if not exists voucher_presentation_settings_company_uidx
  on voucher_presentation_settings (tenant_id, company_id)
  where scope_type = 'company';

create index if not exists voucher_presentation_settings_scope_idx
  on voucher_presentation_settings (tenant_id, scope_type, updated_at desc);

create or replace function validate_voucher_presentation_settings_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.scope_type is distinct from old.scope_type
    or new.business_group_id is distinct from old.business_group_id
    or new.company_id is distinct from old.company_id
  ) then
    raise exception 'O tenant e o escopo da configuracao de voucher sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists voucher_presentation_settings_validate_scope
  on voucher_presentation_settings;
create trigger voucher_presentation_settings_validate_scope
before update on voucher_presentation_settings
for each row execute function validate_voucher_presentation_settings_scope();

alter table voucher_presentation_settings enable row level security;
alter table voucher_presentation_settings force row level security;
drop policy if exists tenant_isolation on voucher_presentation_settings;
create policy tenant_isolation on voucher_presentation_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists voucher_presentation_settings_set_updated_at
  on voucher_presentation_settings;
create trigger voucher_presentation_settings_set_updated_at
before update on voucher_presentation_settings
for each row execute function set_updated_at();

commit;
