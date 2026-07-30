insert into permissions (permission_key, module, description) values
  ('ver_empresas', 'cadastros', 'Visualizar empresas autorizadas'),
  ('ver_consolidado_grupo', 'inteligencia', 'Visualizar dados consolidados de grupos autorizados'),
  ('ver_funcionarios', 'cadastros', 'Visualizar funcionarios das empresas autorizadas'),
  ('gerenciar_funcionarios', 'cadastros', 'Gerenciar funcionarios das empresas autorizadas'),
  ('ver_solicitantes', 'operacao', 'Visualizar solicitantes das empresas autorizadas'),
  ('gerenciar_solicitantes', 'operacao', 'Gerenciar solicitantes das empresas autorizadas'),
  ('criar_demandas', 'operacao', 'Criar demandas para empresas autorizadas'),
  ('ver_demandas', 'operacao', 'Visualizar demandas das empresas autorizadas'),
  ('ver_reservas', 'operacao', 'Visualizar reservas das empresas autorizadas'),
  ('ver_emissoes', 'operacao', 'Visualizar emissoes das empresas autorizadas'),
  ('ver_vouchers', 'operacao', 'Visualizar vouchers das empresas autorizadas'),
  ('ver_relatorios', 'inteligencia', 'Visualizar relatorios das empresas autorizadas'),
  ('exportar_relatorios', 'inteligencia', 'Exportar relatorios das empresas autorizadas'),
  ('gerenciar_vinculos_acesso', 'administracao', 'Gerenciar vinculos corporativos de acesso'),
  ('gerenciar_empresas_grupo', 'administracao', 'Gerenciar empresas de grupos autorizados'),
  ('alterar_configuracoes', 'administracao', 'Alterar configuracoes dentro do escopo autorizado')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select r.id, p.permission_key, true
from roles r
cross join permissions p
where r.role_key = 'tenant_admin'
on conflict (role_id, permission_key) do update set allowed = true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_memberships_tenant_id_id_key'
      and conrelid = 'tenant_memberships'::regclass
  ) then
    alter table tenant_memberships
      add constraint tenant_memberships_tenant_id_id_key unique (tenant_id, id);
  end if;
end;
$$;

create or replace function corporate_permission_overrides_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_each(value) entry
      where jsonb_typeof(entry.value) <> 'boolean'
        or entry.key not in (
          'ver_financeiro', 'editar_financeiro', 'cadastrar_empresas',
          'cadastrar_funcionarios', 'cadastrar_hoteis', 'editar_politicas',
          'gerar_relatorios', 'importar_planilhas', 'ver_produtividade_todos',
          'gerenciar_usuarios', 'excluir_demandas', 'aprovar_demandas',
          'ver_empresas', 'ver_consolidado_grupo',
          'ver_funcionarios', 'gerenciar_funcionarios', 'ver_solicitantes',
          'gerenciar_solicitantes', 'criar_demandas', 'ver_demandas',
          'ver_reservas', 'ver_emissoes', 'ver_vouchers', 'ver_relatorios',
          'exportar_relatorios', 'gerenciar_vinculos_acesso',
          'gerenciar_empresas_grupo', 'alterar_configuracoes'
        )
    );
$$;

create table if not exists corporate_group_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  business_group_id text not null,
  corporate_profile text not null check (corporate_profile in (
    'owner', 'ceo', 'group_admin', 'executive_assistant', 'group_finance',
    'manager', 'viewer', 'company_admin', 'requester'
  )),
  access_mode text not null check (access_mode in ('all_companies', 'selected_companies')),
  can_view_consolidated boolean not null default false,
  permission_overrides jsonb not null default '{}'::jsonb
    check (corporate_permission_overrides_valid(permission_overrides)),
  constraint corporate_group_access_consolidated_permission_check check (
    not can_view_consolidated
    or case
      when permission_overrides ? 'ver_consolidado_grupo'
        then (permission_overrides ->> 'ver_consolidado_grupo')::boolean
      else corporate_profile in (
        'owner', 'ceo', 'group_admin', 'executive_assistant', 'group_finance', 'manager'
      )
    end
  ),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id)
    references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, business_group_id)
    references business_groups(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete set null (created_by_membership_id),
  check (valid_until is null or valid_until > valid_from)
);

create unique index if not exists corporate_group_access_grants_current_uidx
  on corporate_group_access_grants (tenant_id, membership_id, business_group_id)
  where status <> 'revoked';
create index if not exists corporate_group_access_grants_member_idx
  on corporate_group_access_grants (tenant_id, membership_id, status, valid_until);
create index if not exists corporate_group_access_grants_group_idx
  on corporate_group_access_grants (tenant_id, business_group_id, status);

create table if not exists corporate_group_access_companies (
  tenant_id uuid not null references tenants(id) on delete cascade,
  group_access_grant_id uuid not null,
  company_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, group_access_grant_id, company_id),
  foreign key (tenant_id, group_access_grant_id)
    references corporate_group_access_grants(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict
);

create index if not exists corporate_group_access_companies_company_idx
  on corporate_group_access_companies (tenant_id, company_id, group_access_grant_id);

create table if not exists corporate_company_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  company_id text not null,
  corporate_profile text not null check (corporate_profile in (
    'owner', 'ceo', 'group_admin', 'executive_assistant', 'group_finance',
    'manager', 'viewer', 'company_admin', 'requester'
  )),
  permission_overrides jsonb not null default '{}'::jsonb
    check (corporate_permission_overrides_valid(permission_overrides)),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id)
    references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete set null (created_by_membership_id),
  check (valid_until is null or valid_until > valid_from)
);

create unique index if not exists corporate_company_access_grants_current_uidx
  on corporate_company_access_grants (tenant_id, membership_id, company_id)
  where status <> 'revoked';
create index if not exists corporate_company_access_grants_member_idx
  on corporate_company_access_grants (tenant_id, membership_id, status, valid_until);
create index if not exists corporate_company_access_grants_company_idx
  on corporate_company_access_grants (tenant_id, company_id, status);

create table if not exists membership_corporate_preferences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  default_context_type text check (default_context_type in ('company', 'group')),
  default_company_id text,
  default_group_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, membership_id),
  foreign key (tenant_id, membership_id)
    references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, default_company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, default_group_id)
    references business_groups(tenant_id, id) on delete restrict,
  check (
    (default_context_type is null and default_company_id is null and default_group_id is null)
    or (default_context_type = 'company' and default_company_id is not null and default_group_id is null)
    or (default_context_type = 'group' and default_group_id is not null and default_company_id is null)
  )
);

create or replace function validate_corporate_group_company()
returns trigger
language plpgsql
as $$
declare
  grant_group_id text;
  grant_mode text;
  company_group_id text;
  company_status text;
begin
  select business_group_id, access_mode
    into grant_group_id, grant_mode
  from corporate_group_access_grants
  where tenant_id = new.tenant_id and id = new.group_access_grant_id;

  select group_id, status
    into company_group_id, company_status
  from companies
  where tenant_id = new.tenant_id and id = new.company_id and deleted_at is null;

  if grant_mode is distinct from 'selected_companies' then
    raise exception 'Empresas selecionadas exigem access_mode selected_companies.';
  end if;
  if company_group_id is distinct from grant_group_id then
    raise exception 'A empresa selecionada nao pertence ao grupo do vinculo.';
  end if;
  if company_status is distinct from 'active' then
    raise exception 'A empresa selecionada precisa estar ativa.';
  end if;
  return new;
end;
$$;

drop trigger if exists corporate_group_company_validate on corporate_group_access_companies;
create trigger corporate_group_company_validate
before insert or update on corporate_group_access_companies
for each row execute function validate_corporate_group_company();

create or replace function assert_selected_group_access_not_empty(
  target_tenant_id uuid,
  target_grant_id uuid
)
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from corporate_group_access_grants grant_row
    where grant_row.tenant_id = target_tenant_id
      and grant_row.id = target_grant_id
      and grant_row.status = 'active'
      and grant_row.access_mode = 'selected_companies'
      and not exists (
        select 1 from corporate_group_access_companies selected
        where selected.tenant_id = grant_row.tenant_id
          and selected.group_access_grant_id = grant_row.id
      )
  ) then
    raise exception 'Vinculo ativo selected_companies exige ao menos uma empresa.';
  end if;
  if exists (
    select 1
    from corporate_group_access_grants grant_row
    where grant_row.tenant_id = target_tenant_id
      and grant_row.id = target_grant_id
      and grant_row.access_mode = 'all_companies'
      and exists (
        select 1 from corporate_group_access_companies selected
        where selected.tenant_id = grant_row.tenant_id
          and selected.group_access_grant_id = grant_row.id
      )
  ) then
    raise exception 'Vinculo all_companies nao pode manter empresas selecionadas.';
  end if;
end;
$$;

create or replace function validate_selected_group_access_not_empty()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'corporate_group_access_grants' then
    perform assert_selected_group_access_not_empty(new.tenant_id, new.id);
  else
    if tg_op <> 'DELETE' then
      perform assert_selected_group_access_not_empty(new.tenant_id, new.group_access_grant_id);
    end if;
    if tg_op <> 'INSERT' and (
      tg_op = 'DELETE'
      or old.tenant_id is distinct from new.tenant_id
      or old.group_access_grant_id is distinct from new.group_access_grant_id
    ) then
      perform assert_selected_group_access_not_empty(old.tenant_id, old.group_access_grant_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists corporate_group_grant_selection_required on corporate_group_access_grants;
create constraint trigger corporate_group_grant_selection_required
after insert or update on corporate_group_access_grants
deferrable initially deferred
for each row execute function validate_selected_group_access_not_empty();

drop trigger if exists corporate_group_company_selection_required on corporate_group_access_companies;
create constraint trigger corporate_group_company_selection_required
after insert or update or delete on corporate_group_access_companies
deferrable initially deferred
for each row execute function validate_selected_group_access_not_empty();

create or replace function validate_corporate_default_context()
returns trigger
language plpgsql
as $$
declare
  membership_role text;
  is_platform_admin boolean;
  has_access boolean := false;
begin
  if new.default_context_type is null then
    return new;
  end if;

  select role_row.role_key, user_row.platform_admin
    into membership_role, is_platform_admin
  from tenant_memberships membership_row
  join roles role_row on role_row.id = membership_row.role_id
  join users user_row on user_row.id = membership_row.user_id
  where membership_row.tenant_id = new.tenant_id
    and membership_row.id = new.membership_id;

  if is_platform_admin or membership_role = 'tenant_admin' then
    return new;
  end if;

  if new.default_context_type = 'company' then
    select exists (
      select 1
      from corporate_company_access_grants direct_grant
      join companies company_row
        on company_row.tenant_id = direct_grant.tenant_id
       and company_row.id = direct_grant.company_id
       and company_row.status = 'active'
       and company_row.deleted_at is null
      where direct_grant.tenant_id = new.tenant_id
        and direct_grant.membership_id = new.membership_id
        and direct_grant.company_id = new.default_company_id
        and direct_grant.status = 'active'
        and direct_grant.valid_from <= now()
        and (direct_grant.valid_until is null or direct_grant.valid_until > now())
        and coalesce((direct_grant.permission_overrides ->> 'ver_empresas')::boolean, true)
      union all
      select 1
      from corporate_group_access_grants group_grant
      join companies company_row
        on company_row.tenant_id = group_grant.tenant_id
       and company_row.group_id = group_grant.business_group_id
       and company_row.id = new.default_company_id
       and company_row.status = 'active'
       and company_row.deleted_at is null
      left join corporate_group_access_companies selected
        on selected.tenant_id = group_grant.tenant_id
       and selected.group_access_grant_id = group_grant.id
       and selected.company_id = company_row.id
      where group_grant.tenant_id = new.tenant_id
        and group_grant.membership_id = new.membership_id
        and group_grant.status = 'active'
        and group_grant.valid_from <= now()
        and (group_grant.valid_until is null or group_grant.valid_until > now())
        and coalesce((group_grant.permission_overrides ->> 'ver_empresas')::boolean, true)
        and (group_grant.access_mode = 'all_companies' or selected.company_id is not null)
    ) into has_access;
  else
    select exists (
      select 1
      from corporate_group_access_grants group_grant
      join business_groups group_row
        on group_row.tenant_id = group_grant.tenant_id
       and group_row.id = group_grant.business_group_id
       and group_row.status = 'active'
       and group_row.deleted_at is null
      where group_grant.tenant_id = new.tenant_id
        and group_grant.membership_id = new.membership_id
        and group_grant.business_group_id = new.default_group_id
        and group_grant.can_view_consolidated
        and group_grant.status = 'active'
        and group_grant.valid_from <= now()
        and (group_grant.valid_until is null or group_grant.valid_until > now())
        and exists (
          select 1
          from companies company_row
          left join corporate_group_access_companies selected
            on selected.tenant_id = group_grant.tenant_id
           and selected.group_access_grant_id = group_grant.id
           and selected.company_id = company_row.id
          where company_row.tenant_id = group_grant.tenant_id
            and company_row.group_id = group_grant.business_group_id
            and company_row.status = 'active'
            and company_row.deleted_at is null
            and (group_grant.access_mode = 'all_companies' or selected.company_id is not null)
        )
    ) into has_access;
  end if;

  if not has_access then
    raise exception 'O contexto padrao precisa pertencer ao escopo corporativo ativo.';
  end if;
  return new;
end;
$$;

drop trigger if exists membership_corporate_preferences_validate on membership_corporate_preferences;
create trigger membership_corporate_preferences_validate
before insert or update on membership_corporate_preferences
for each row execute function validate_corporate_default_context();

drop trigger if exists corporate_group_access_grants_set_updated_at on corporate_group_access_grants;
create trigger corporate_group_access_grants_set_updated_at
before update on corporate_group_access_grants for each row execute function set_updated_at();
drop trigger if exists corporate_company_access_grants_set_updated_at on corporate_company_access_grants;
create trigger corporate_company_access_grants_set_updated_at
before update on corporate_company_access_grants for each row execute function set_updated_at();
drop trigger if exists membership_corporate_preferences_set_updated_at on membership_corporate_preferences;
create trigger membership_corporate_preferences_set_updated_at
before update on membership_corporate_preferences for each row execute function set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'corporate_group_access_grants',
    'corporate_group_access_companies',
    'corporate_company_access_grants',
    'membership_corporate_preferences'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists tenant_isolation on %I', table_name);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  end loop;
end;
$$;

with storage_state as (
  select tenant_id,
    case
      when jsonb_typeof(value -> 'state') = 'object' then value -> 'state'
      else value
    end as state
  from app_kv
  where key = 'bbt-data-v4'
), group_rows as (
  select storage_state.tenant_id, item
  from storage_state
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(storage_state.state -> 'gruposEmpresariais') = 'array'
      then storage_state.state -> 'gruposEmpresariais' else '[]'::jsonb end
  ) item
  where nullif(btrim(item ->> 'id'), '') is not null
), unique_group_rows as (
  select distinct on (tenant_id, item ->> 'id') tenant_id, item
  from group_rows
  order by tenant_id, item ->> 'id', coalesce(nullif(item ->> 'updated_at', '')::timestamptz, '-infinity'::timestamptz) desc
)
insert into business_groups (
  id, tenant_id, name, code, document_number, description,
  contact_name, contact_email, status, created_at, updated_at
)
select
  item ->> 'id', tenant_id,
  coalesce(nullif(btrim(item ->> 'nome'), ''), 'Grupo sem nome'),
  nullif(btrim(item ->> 'codigo'), ''),
  nullif(btrim(item ->> 'cnpj_matriz'), ''),
  nullif(item ->> 'descricao', ''),
  nullif(btrim(item ->> 'responsavel_nome'), ''),
  nullif(btrim(item ->> 'responsavel_email'), '')::citext,
  case when coalesce((item ->> 'ativo')::boolean, true) then 'active' else 'inactive' end,
  coalesce(nullif(item ->> 'created_at', '')::timestamptz, now()),
  coalesce(nullif(item ->> 'updated_at', '')::timestamptz, now())
from unique_group_rows
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code,
  document_number = excluded.document_number,
  description = excluded.description,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  status = excluded.status,
  updated_at = excluded.updated_at
where business_groups.tenant_id = excluded.tenant_id;

with storage_state as (
  select tenant_id,
    case
      when jsonb_typeof(value -> 'state') = 'object' then value -> 'state'
      else value
    end as state
  from app_kv
  where key = 'bbt-data-v4'
), raw_company_rows as (
  select storage_state.tenant_id, item,
    coalesce(
      nullif(btrim(item ->> 'grupo_id'), ''),
      (
        select group_item ->> 'id'
        from jsonb_array_elements(
          case when jsonb_typeof(storage_state.state -> 'gruposEmpresariais') = 'array'
            then storage_state.state -> 'gruposEmpresariais' else '[]'::jsonb end
        ) group_item
        where nullif(btrim(group_item ->> 'id'), '') is not null
          and (case when jsonb_typeof(group_item -> 'empresa_ids') = 'array'
            then group_item -> 'empresa_ids' else '[]'::jsonb end) ? (item ->> 'id')
        order by group_item ->> 'id'
        limit 1
      )
    ) as requested_group_id
  from storage_state
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(storage_state.state -> 'empresas') = 'array'
      then storage_state.state -> 'empresas' else '[]'::jsonb end
  ) item
  where nullif(btrim(item ->> 'id'), '') is not null
), unique_company_rows as (
  select distinct on (tenant_id, item ->> 'id') tenant_id, item, requested_group_id
  from raw_company_rows
  order by tenant_id, item ->> 'id', coalesce(nullif(item ->> 'updated_at', '')::timestamptz, '-infinity'::timestamptz) desc
), company_rows as (
  select tenant_id, item, requested_group_id,
    nullif(btrim(item ->> 'cnpj'), '') as requested_document_number,
    row_number() over (
      partition by tenant_id, nullif(btrim(item ->> 'cnpj'), '')
      order by item ->> 'id'
    ) as document_occurrence
  from unique_company_rows
)
insert into companies (
  id, tenant_id, group_id, legal_name, trade_name, document_number,
  customer_code, contact_name, contact_email, contact_phone,
  default_cost_center, status, billing_settings, created_at, updated_at
)
select
  item ->> 'id', company_rows.tenant_id,
  case when exists (
    select 1 from business_groups group_row
    where group_row.tenant_id = company_rows.tenant_id
      and group_row.id = company_rows.requested_group_id
  ) then company_rows.requested_group_id else null end,
  coalesce(nullif(btrim(item ->> 'nome'), ''), 'Empresa sem nome'),
  nullif(btrim(item ->> 'nome'), ''),
  case
    when company_rows.requested_document_number is null then null
    when company_rows.document_occurrence > 1 then null
    when exists (
      select 1 from companies existing_company
      where existing_company.tenant_id = company_rows.tenant_id
        and existing_company.document_number = company_rows.requested_document_number
        and existing_company.id <> item ->> 'id'
        and existing_company.deleted_at is null
    ) then null
    else company_rows.requested_document_number
  end,
  nullif(btrim(item ->> 'codigo_cliente'), ''),
  nullif(btrim(item ->> 'responsavel'), ''),
  nullif(btrim(item ->> 'email_responsavel'), '')::citext,
  nullif(btrim(item ->> 'telefone'), ''),
  nullif(btrim(item ->> 'centro_custo_padrao'), ''),
  case when coalesce((item ->> 'ativa')::boolean, true) then 'active' else 'inactive' end,
  case when jsonb_typeof(item -> 'config_cobranca') = 'object' then item -> 'config_cobranca' else '{}'::jsonb end,
  coalesce(nullif(item ->> 'created_at', '')::timestamptz, now()),
  coalesce(nullif(item ->> 'updated_at', '')::timestamptz, now())
from company_rows
on conflict (id) do update set
  group_id = excluded.group_id,
  legal_name = excluded.legal_name,
  trade_name = excluded.trade_name,
  document_number = excluded.document_number,
  customer_code = excluded.customer_code,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  default_cost_center = excluded.default_cost_center,
  status = excluded.status,
  billing_settings = excluded.billing_settings,
  updated_at = excluded.updated_at
where companies.tenant_id = excluded.tenant_id;

insert into corporate_group_access_grants (
  tenant_id, membership_id, business_group_id, corporate_profile,
  access_mode, can_view_consolidated, permission_overrides, status, valid_from
)
select distinct
  membership.tenant_id,
  membership.id,
  group_id,
  case
    when role_row.role_key = 'company_admin' then 'company_admin'
    when role_row.role_key = 'requester' then 'requester'
    when role_row.role_key = 'readonly' then 'viewer'
    when role_row.role_key = 'financial_manager' then 'group_finance'
    when role_row.role_key = 'tenant_admin' then 'group_admin'
    else 'manager'
  end,
  'all_companies',
  true,
  case
    when role_row.role_key in ('company_admin', 'requester', 'readonly')
      then coalesce(membership.custom_permissions, '{}'::jsonb) || '{"ver_consolidado_grupo": true}'::jsonb
    else membership.custom_permissions
  end,
  case when membership.status in ('active', 'invited') then 'active' else 'suspended' end,
  membership.created_at
from tenant_memberships membership
join roles role_row on role_row.id = membership.role_id
cross join lateral unnest(membership.allowed_group_ids) group_id
join business_groups group_row
  on group_row.tenant_id = membership.tenant_id and group_row.id = group_id
where group_id is not null and btrim(group_id) <> ''
on conflict (tenant_id, membership_id, business_group_id) where status <> 'revoked'
do nothing;

insert into corporate_company_access_grants (
  tenant_id, membership_id, company_id, corporate_profile,
  permission_overrides, status, valid_from
)
select distinct
  membership.tenant_id,
  membership.id,
  selected_company.company_id,
  case
    when role_row.role_key = 'company_admin' then 'company_admin'
    when role_row.role_key = 'requester' then 'requester'
    when role_row.role_key = 'readonly' then 'viewer'
    when role_row.role_key = 'financial_manager' then 'group_finance'
    when role_row.role_key = 'tenant_admin' then 'group_admin'
    else 'manager'
  end,
  membership.custom_permissions,
  case when membership.status in ('active', 'invited') then 'active' else 'suspended' end,
  membership.created_at
from tenant_memberships membership
join roles role_row on role_row.id = membership.role_id
cross join lateral unnest(
  array_remove(array_append(membership.allowed_company_ids, membership.company_id), null)
) selected_company(company_id)
join companies company_row
  on company_row.tenant_id = membership.tenant_id
 and company_row.id = selected_company.company_id
where selected_company.company_id is not null
  and btrim(selected_company.company_id) <> ''
on conflict (tenant_id, membership_id, company_id) where status <> 'revoked'
do nothing;

insert into membership_corporate_preferences (
  tenant_id, membership_id, default_context_type, default_company_id
)
select membership.tenant_id, membership.id, 'company', membership.company_id
from tenant_memberships membership
join companies company_row
  on company_row.tenant_id = membership.tenant_id and company_row.id = membership.company_id
where membership.company_id is not null
on conflict (tenant_id, membership_id) do nothing;
