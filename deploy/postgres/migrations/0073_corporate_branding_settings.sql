begin;

-- Identidade visual corporativa com heranca campo a campo. NULL significa
-- herdar: empresa -> grupo -> identidade da entidade/sistema.
create table if not exists corporate_branding_assets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  file_id uuid not null,
  scope_type text not null check (scope_type in ('group', 'company')),
  business_group_id text,
  company_id text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, file_id),
  foreign key (tenant_id, file_id)
    references stored_files(tenant_id, id) on delete cascade,
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

create index if not exists corporate_branding_assets_scope_idx
  on corporate_branding_assets (
    tenant_id, scope_type, business_group_id, company_id, created_at desc
  );

create table if not exists corporate_branding_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scope_type text not null check (scope_type in ('group', 'company')),
  business_group_id text,
  company_id text,
  display_name text,
  logo_file_id uuid,
  logo_alt text,
  primary_color text,
  accent_color text,
  sidebar_color text,
  document_legal_name text,
  document_number text,
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
  foreign key (tenant_id, logo_file_id)
    references corporate_branding_assets(tenant_id, file_id) on delete restrict,
  check (
    (scope_type = 'group' and business_group_id is not null and company_id is null)
    or
    (scope_type = 'company' and company_id is not null and business_group_id is null)
  ),
  check (display_name is null or length(btrim(display_name)) between 1 and 200),
  check (logo_alt is null or length(btrim(logo_alt)) between 1 and 240),
  check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (sidebar_color is null or sidebar_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (document_legal_name is null or length(btrim(document_legal_name)) between 1 and 240),
  check (
    document_number is null
    or (
      length(btrim(document_number)) between 1 and 64
      and document_number ~ '^[A-Za-z0-9./-]+$'
    )
  )
);

create unique index if not exists corporate_branding_settings_group_uidx
  on corporate_branding_settings (tenant_id, business_group_id)
  where scope_type = 'group';

create unique index if not exists corporate_branding_settings_company_uidx
  on corporate_branding_settings (tenant_id, company_id)
  where scope_type = 'company';

create index if not exists corporate_branding_settings_scope_idx
  on corporate_branding_settings (tenant_id, scope_type, updated_at desc);

create or replace function validate_corporate_branding_settings_scope()
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
    raise exception 'O tenant e o escopo da identidade visual sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists corporate_branding_settings_validate_scope
  on corporate_branding_settings;
create trigger corporate_branding_settings_validate_scope
before update on corporate_branding_settings
for each row execute function validate_corporate_branding_settings_scope();

create or replace function validate_corporate_branding_logo_scope()
returns trigger
language plpgsql
as $$
begin
  if new.logo_file_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from corporate_branding_assets asset
    where asset.tenant_id = new.tenant_id
      and asset.file_id = new.logo_file_id
      and asset.scope_type = new.scope_type
      and asset.business_group_id is not distinct from new.business_group_id
      and asset.company_id is not distinct from new.company_id
  ) then
    raise exception 'A logomarca nao pertence ao escopo da identidade visual.';
  end if;
  return new;
end;
$$;

drop trigger if exists corporate_branding_settings_validate_logo_scope
  on corporate_branding_settings;
create trigger corporate_branding_settings_validate_logo_scope
before insert or update of logo_file_id on corporate_branding_settings
for each row execute function validate_corporate_branding_logo_scope();

alter table corporate_branding_settings enable row level security;
alter table corporate_branding_settings force row level security;
drop policy if exists tenant_isolation on corporate_branding_settings;
create policy tenant_isolation on corporate_branding_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table corporate_branding_assets enable row level security;
alter table corporate_branding_assets force row level security;
drop policy if exists tenant_isolation on corporate_branding_assets;
create policy tenant_isolation on corporate_branding_assets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists corporate_branding_settings_set_updated_at
  on corporate_branding_settings;
create trigger corporate_branding_settings_set_updated_at
before update on corporate_branding_settings
for each row execute function set_updated_at();

commit;
