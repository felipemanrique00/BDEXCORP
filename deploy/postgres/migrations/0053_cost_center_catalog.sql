-- Cadastro central de planos e centros de custo.
-- A tabela cost_centers existente permanece como projecao por empresa para
-- preservar compatibilidade com demandas, orcamentos, alcadas e autorizacao.

insert into permissions (permission_key, module, description) values
  ('ver_centros_custo', 'cadastros', 'Visualizar planos e centros de custo autorizados'),
  ('gerenciar_centros_custo', 'cadastros', 'Criar e alterar planos e centros de custo autorizados')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array['ver_centros_custo', 'gerenciar_centros_custo']) as permission_key
where role_row.role_key in ('tenant_admin', 'supervisor', 'company_admin')
on conflict (role_id, permission_key) do update set allowed = true;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, 'ver_centros_custo', true
from roles role_row
where role_row.role_key in (
  'agent', 'operator', 'financial_manager', 'requester', 'readonly'
)
on conflict (role_id, permission_key) do update set allowed = true;

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
          'ver_empresas', 'ver_consolidado_grupo', 'ver_funcionarios',
          'gerenciar_funcionarios', 'ver_solicitantes', 'gerenciar_solicitantes',
          'criar_demandas', 'ver_demandas', 'ver_reservas', 'ver_emissoes',
          'ver_vouchers', 'ver_relatorios', 'exportar_relatorios',
          'gerenciar_vinculos_acesso', 'gerenciar_empresas_grupo',
          'alterar_configuracoes', 'operar_cotacoes', 'operar_reservas',
          'operar_emissoes', 'operar_cancelamentos', 'gerenciar_integracoes',
          'ver_politicas', 'gerenciar_politicas', 'publicar_politicas',
          'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
          'ver_workflows', 'gerenciar_workflows', 'executar_workflows',
          'gerenciar_delegacoes', 'usar_ia', 'gerenciar_ia',
          'ver_arquivos', 'gerenciar_arquivos', 'ver_auditoria',
          'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos',
          'gerenciar_orcamentos', 'executar_automacoes',
          'gerenciar_automacoes', 'acessar_portal_viajante',
          'ver_centros_custo', 'gerenciar_centros_custo'
        )
    );
$$;

create table if not exists cost_center_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_group_id text,
  owner_company_id text,
  code citext not null,
  name text not null,
  description text,
  plan_type text not null check (plan_type in ('group_shared', 'company_exclusive')),
  is_group_default boolean not null default false,
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, business_group_id)
    references business_groups(tenant_id, id) on delete restrict,
  foreign key (tenant_id, owner_company_id)
    references companies(tenant_id, id) on delete restrict,
  check (
    (plan_type = 'group_shared' and business_group_id is not null and owner_company_id is null)
    or
    (plan_type = 'company_exclusive' and owner_company_id is not null and not is_group_default)
  ),
  check (btrim(code::text) <> ''),
  check (length(btrim(code::text)) <= 120),
  check (btrim(name) <> ''),
  check (length(btrim(name)) <= 240),
  check (description is null or length(description) <= 2000),
  check (deleted_at is null or not is_active)
);

create unique index if not exists cost_center_plans_group_code_uidx
  on cost_center_plans (tenant_id, business_group_id, lower(btrim(code::text)))
  where plan_type = 'group_shared' and deleted_at is null;
create unique index if not exists cost_center_plans_company_code_uidx
  on cost_center_plans (tenant_id, owner_company_id, lower(btrim(code::text)))
  where plan_type = 'company_exclusive' and deleted_at is null;
create unique index if not exists cost_center_plans_group_default_uidx
  on cost_center_plans (tenant_id, business_group_id)
  where plan_type = 'group_shared' and is_group_default and is_active and deleted_at is null;
create index if not exists cost_center_plans_lookup_idx
  on cost_center_plans (tenant_id, business_group_id, owner_company_id, is_active);

create table if not exists cost_center_plan_companies (
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null,
  company_id text not null,
  is_default boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (tenant_id, plan_id, company_id),
  foreign key (tenant_id, plan_id)
    references cost_center_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check ((is_active and ended_at is null) or (not is_active and ended_at is not null)),
  check (not is_default or is_active)
);

create unique index if not exists cost_center_plan_companies_default_uidx
  on cost_center_plan_companies (tenant_id, company_id)
  where is_default and is_active and ended_at is null;
create index if not exists cost_center_plan_companies_plan_idx
  on cost_center_plan_companies (tenant_id, plan_id, is_active, company_id);

create table if not exists cost_center_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null,
  parent_id uuid,
  code citext not null,
  name text not null,
  description text,
  hierarchy_level smallint not null default 1 check (hierarchy_level between 1 and 3),
  scope_type text not null default 'plan' check (scope_type in ('plan', 'selected_companies')),
  manager_user_id uuid references users(id) on delete set null,
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, plan_id, id),
  foreign key (tenant_id, plan_id)
    references cost_center_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, parent_id)
    references cost_center_definitions(tenant_id, id) on delete restrict,
  check (parent_id is null or parent_id <> id),
  check (btrim(code::text) <> ''),
  check (length(btrim(code::text)) <= 120),
  check (btrim(name) <> ''),
  check (length(btrim(name)) <= 240),
  check (description is null or length(description) <= 2000),
  check (deleted_at is null or not is_active)
);

create unique index if not exists cost_center_definitions_plan_code_uidx
  on cost_center_definitions (tenant_id, plan_id, lower(btrim(code::text)))
  where deleted_at is null;
create index if not exists cost_center_definitions_tree_idx
  on cost_center_definitions (tenant_id, plan_id, parent_id, hierarchy_level);
create index if not exists cost_center_definitions_search_idx
  on cost_center_definitions (tenant_id, plan_id, is_active, code);

create table if not exists cost_center_definition_companies (
  tenant_id uuid not null references tenants(id) on delete cascade,
  cost_center_definition_id uuid not null,
  company_id text not null,
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (tenant_id, cost_center_definition_id, company_id),
  foreign key (tenant_id, cost_center_definition_id)
    references cost_center_definitions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check ((is_active and ended_at is null) or (not is_active and ended_at is not null))
);

create index if not exists cost_center_definition_companies_company_idx
  on cost_center_definition_companies (tenant_id, company_id, is_active, cost_center_definition_id);

create or replace function validate_cost_center_plan()
returns trigger
language plpgsql
as $$
declare
  owner_group_id text;
  owner_status text;
  owner_deleted_at timestamptz;
  group_status text;
  group_deleted_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'O identificador do plano de centros de custo e imutavel.';
  end if;
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'O tenant do plano de centros de custo e imutavel.';
  end if;

  if new.plan_type = 'group_shared' then
    select status, deleted_at into group_status, group_deleted_at
    from business_groups
    where tenant_id = new.tenant_id and id = new.business_group_id;
    if not found then
      raise exception 'Grupo do plano de centros de custo nao encontrado no tenant.';
    end if;
    if new.is_active and (group_status <> 'active' or group_deleted_at is not null) then
      raise exception 'Plano compartilhado ativo exige grupo ativo.';
    end if;
  else
    select group_id, status, deleted_at
      into owner_group_id, owner_status, owner_deleted_at
    from companies
    where tenant_id = new.tenant_id and id = new.owner_company_id;
    if not found then
      raise exception 'Empresa proprietaria do plano nao encontrada no tenant.';
    end if;
    if new.business_group_id is not null
       and owner_group_id is distinct from new.business_group_id then
      raise exception 'Empresa proprietaria e plano exclusivo pertencem a grupos diferentes.';
    end if;
    if new.is_active and (owner_status <> 'active' or owner_deleted_at is not null) then
      raise exception 'Plano exclusivo ativo exige empresa proprietaria ativa.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and (
       new.plan_type is distinct from old.plan_type
       or new.business_group_id is distinct from old.business_group_id
       or new.owner_company_id is distinct from old.owner_company_id
     )
     and (
       exists (
         select 1 from cost_center_definitions definition
         where definition.tenant_id = old.tenant_id and definition.plan_id = old.id
       )
       or exists (
         select 1 from cost_center_plan_companies assignment
         where assignment.tenant_id = old.tenant_id and assignment.plan_id = old.id
       )
     ) then
    raise exception 'A propriedade do plano nao pode mudar depois de receber centros ou empresas.';
  end if;

  if tg_op = 'UPDATE'
     and (not new.is_active or new.deleted_at is not null)
     and (old.is_active and old.deleted_at is null)
     and (
       exists (
         select 1 from cost_center_definitions definition
         where definition.tenant_id = old.tenant_id
           and definition.plan_id = old.id
           and definition.is_active
           and definition.deleted_at is null
       )
       or exists (
         select 1 from cost_center_plan_companies assignment
         where assignment.tenant_id = old.tenant_id
           and assignment.plan_id = old.id
           and assignment.is_active
           and assignment.ended_at is null
       )
     ) then
    raise exception 'Desative centros e atribuicoes antes de desativar o plano.';
  end if;
  return new;
end;
$$;

drop trigger if exists cost_center_plans_validate on cost_center_plans;
create trigger cost_center_plans_validate
before insert or update of id, tenant_id, plan_type, business_group_id, owner_company_id,
  is_active, deleted_at
on cost_center_plans
for each row execute function validate_cost_center_plan();

create or replace function validate_cost_center_plan_company()
returns trigger
language plpgsql
as $$
declare
  plan_row cost_center_plans%rowtype;
  company_group_id text;
  company_status text;
  company_deleted_at timestamptz;
begin
  if tg_op = 'UPDATE'
     and (
       new.tenant_id is distinct from old.tenant_id
       or new.plan_id is distinct from old.plan_id
       or new.company_id is distinct from old.company_id
     ) then
    raise exception 'A identidade da atribuicao empresa-plano e imutavel.';
  end if;

  select * into plan_row
  from cost_center_plans
  where tenant_id = new.tenant_id and id = new.plan_id
    and deleted_at is null;
  if not found then
    raise exception 'Plano de centros de custo ativo nao encontrado no tenant.';
  end if;

  select group_id, status, deleted_at
    into company_group_id, company_status, company_deleted_at
  from companies
  where tenant_id = new.tenant_id and id = new.company_id;
  if not found then
    raise exception 'Empresa ativa do plano nao encontrada no tenant.';
  end if;

  if plan_row.plan_type = 'company_exclusive' and plan_row.owner_company_id <> new.company_id then
    raise exception 'Plano exclusivo somente pode ser atribuido a empresa proprietaria.';
  end if;
  if plan_row.plan_type = 'group_shared' and company_group_id is distinct from plan_row.business_group_id then
    raise exception 'Empresa e plano compartilhado pertencem a grupos diferentes.';
  end if;
  if new.is_active
     and (not plan_row.is_active or company_status <> 'active' or company_deleted_at is not null) then
    raise exception 'Atribuicao ativa exige plano e empresa ativos.';
  end if;
  return new;
end;
$$;

drop trigger if exists cost_center_plan_companies_validate on cost_center_plan_companies;
create trigger cost_center_plan_companies_validate
before insert or update on cost_center_plan_companies
for each row execute function validate_cost_center_plan_company();

create or replace function cost_center_plan_applies_to_company(
  requested_tenant_id uuid,
  requested_plan_id uuid,
  requested_company_id text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from cost_center_plans plan
    join companies company
      on company.tenant_id = plan.tenant_id
     and company.id = requested_company_id
     and company.status = 'active'
     and company.deleted_at is null
    where plan.tenant_id = requested_tenant_id
      and plan.id = requested_plan_id
      and plan.is_active
      and plan.deleted_at is null
      and (
        exists (
          select 1
          from cost_center_plan_companies assignment
          where assignment.tenant_id = plan.tenant_id
            and assignment.plan_id = plan.id
            and assignment.company_id = company.id
            and assignment.is_active
            and assignment.ended_at is null
            and (
              (plan.plan_type = 'company_exclusive' and plan.owner_company_id = company.id)
              or
              (plan.plan_type = 'group_shared' and plan.business_group_id = company.group_id)
            )
        )
        or (
          plan.plan_type = 'group_shared'
          and plan.is_group_default
          and company.group_id = plan.business_group_id
          and not exists (
            select 1
            from cost_center_plan_companies explicit_choice
            where explicit_choice.tenant_id = plan.tenant_id
              and explicit_choice.company_id = company.id
              and (
                -- Uma atribuicao encerrada ao proprio plano e um opt-out
                -- explicito e nao pode ser reativada pela heranca do grupo.
                explicit_choice.plan_id = plan.id
                or (
                  explicit_choice.is_default
                  and explicit_choice.is_active
                  and explicit_choice.ended_at is null
                )
              )
          )
        )
      )
  );
$$;

create or replace function validate_cost_center_definition_hierarchy()
returns trigger
language plpgsql
as $$
declare
  parent_plan_id uuid;
  parent_level smallint;
  parent_active boolean;
  maximum_relative_depth integer;
  cycle_found boolean;
  plan_active boolean;
begin
  perform pg_advisory_xact_lock(
    hashtext(new.tenant_id::text),
    hashtext(new.plan_id::text)
  );

  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'O identificador da definicao de centro de custo e imutavel.';
  end if;
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'O tenant da definicao de centro de custo e imutavel.';
  end if;
  if tg_op = 'UPDATE' and new.plan_id is distinct from old.plan_id then
    raise exception 'Uma definicao existente nao pode ser movida para outro plano.';
  end if;

  select is_active into plan_active
  from cost_center_plans
  where tenant_id = new.tenant_id and id = new.plan_id and deleted_at is null;
  if not found then
    raise exception 'Plano da definicao de centro de custo nao encontrado no tenant.';
  end if;
  if new.is_active and not plan_active then
    raise exception 'Definicao ativa exige plano ativo.';
  end if;

  if tg_op = 'UPDATE'
     and (not new.is_active or new.deleted_at is not null)
     and (old.is_active and old.deleted_at is null)
     and exists (
       select 1
       from cost_center_definitions child
       where child.tenant_id = old.tenant_id
         and child.plan_id = old.plan_id
         and child.parent_id = old.id
         and child.is_active
         and child.deleted_at is null
     ) then
    raise exception 'Desative ou mova os centros filhos antes de desativar o centro pai.';
  end if;

  if new.parent_id is null then
    new.hierarchy_level := 1;
  else
    select plan_id, hierarchy_level, is_active
      into parent_plan_id, parent_level, parent_active
    from cost_center_definitions
    where tenant_id = new.tenant_id and id = new.parent_id
      and deleted_at is null
    for key share;
    if not found then
      raise exception 'Centro de custo pai nao encontrado no tenant.';
    end if;
    if parent_plan_id <> new.plan_id then
      raise exception 'Centro de custo pai pertence a outro plano.';
    end if;
    if new.is_active and not parent_active then
      raise exception 'Centro de custo ativo exige pai ativo.';
    end if;
    if parent_level >= 3 then
      raise exception 'A hierarquia de centros de custo aceita no maximo tres niveis.';
    end if;

    with recursive ancestors as (
      select definition.id, definition.parent_id, array[definition.id] as path,
             definition.id = new.id as has_cycle
      from cost_center_definitions definition
      where definition.tenant_id = new.tenant_id and definition.id = new.parent_id
      union all
      select definition.id, definition.parent_id,
             ancestors.path || definition.id,
             definition.id = new.id or definition.id = any(ancestors.path)
      from cost_center_definitions definition
      join ancestors on ancestors.parent_id = definition.id
      where definition.tenant_id = new.tenant_id
        and not ancestors.has_cycle
    )
    select exists(select 1 from ancestors where has_cycle) into cycle_found;
    if cycle_found then
      raise exception 'A hierarquia de centros de custo nao pode conter ciclos.';
    end if;
    new.hierarchy_level := parent_level + 1;
  end if;

  if tg_op = 'UPDATE' then
    with recursive descendants as (
      select definition.id, 1 as relative_depth, array[definition.id] as path
      from cost_center_definitions definition
      where definition.tenant_id = new.tenant_id and definition.parent_id = new.id
        and definition.plan_id = new.plan_id
        and definition.deleted_at is null
      union all
      select definition.id, descendants.relative_depth + 1,
             descendants.path || definition.id
      from cost_center_definitions definition
      join descendants on definition.parent_id = descendants.id
      where definition.tenant_id = new.tenant_id
        and definition.plan_id = new.plan_id
        and definition.deleted_at is null
        and not definition.id = any(descendants.path)
    )
    select coalesce(max(relative_depth), 0) into maximum_relative_depth from descendants;
    if new.hierarchy_level + maximum_relative_depth > 3 then
      raise exception 'A alteracao criaria mais de tres niveis de centros de custo.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function refresh_cost_center_descendant_levels()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not distinct from old.parent_id
     or new.hierarchy_level = old.hierarchy_level then
    return null;
  end if;

  with recursive descendants as (
    select child.id, new.hierarchy_level + 1 as resolved_level
    from cost_center_definitions child
    where child.tenant_id = new.tenant_id
      and child.plan_id = new.plan_id
      and child.parent_id = new.id
      and child.deleted_at is null
    union all
    select child.id, descendants.resolved_level + 1
    from cost_center_definitions child
    join descendants on child.parent_id = descendants.id
    where child.tenant_id = new.tenant_id
      and child.plan_id = new.plan_id
      and child.deleted_at is null
  )
  update cost_center_definitions definition
  set hierarchy_level = descendants.resolved_level
  from descendants
  where definition.tenant_id = new.tenant_id
    and definition.id = descendants.id
    and definition.hierarchy_level is distinct from descendants.resolved_level;
  return null;
end;
$$;

create or replace function validate_cost_center_definition_company()
returns trigger
language plpgsql
as $$
declare
  definition_scope text;
  definition_plan_id uuid;
begin
  if tg_op = 'UPDATE'
     and (
       new.tenant_id is distinct from old.tenant_id
       or new.cost_center_definition_id is distinct from old.cost_center_definition_id
       or new.company_id is distinct from old.company_id
     ) then
    raise exception 'A identidade da abrangencia empresa-centro e imutavel.';
  end if;

  select scope_type, plan_id into definition_scope, definition_plan_id
  from cost_center_definitions
  where tenant_id = new.tenant_id and id = new.cost_center_definition_id
    and deleted_at is null;
  if not found then
    raise exception 'Definicao de centro de custo nao encontrada no tenant.';
  end if;
  if definition_scope <> 'selected_companies' then
    raise exception 'Centro global nao aceita empresas explicitas.';
  end if;
  if new.is_active and not cost_center_plan_applies_to_company(
    new.tenant_id,
    definition_plan_id,
    new.company_id
  ) then
    raise exception 'Empresa selecionada nao utiliza o plano do centro de custo.';
  end if;
  return new;
end;
$$;

drop trigger if exists cost_center_definition_companies_validate on cost_center_definition_companies;
create trigger cost_center_definition_companies_validate
before insert or update on cost_center_definition_companies
for each row execute function validate_cost_center_definition_company();

create or replace function cost_center_definition_scope_complete()
returns trigger
language plpgsql
as $$
declare
  row_payload jsonb;
  definition_id uuid;
  definition_tenant_id uuid;
  definition_scope text;
  definition_active boolean;
  selected_count bigint;
begin
  if tg_op = 'DELETE' then
    row_payload := to_jsonb(old);
  else
    row_payload := to_jsonb(new);
  end if;

  definition_id := coalesce(
    nullif(row_payload ->> 'id', '')::uuid,
    nullif(row_payload ->> 'cost_center_definition_id', '')::uuid
  );
  definition_tenant_id := nullif(row_payload ->> 'tenant_id', '')::uuid;
  select scope_type, is_active into definition_scope, definition_active
  from cost_center_definitions
  where tenant_id = definition_tenant_id and id = definition_id and deleted_at is null;
  if not found then return null; end if;

  select count(*) into selected_count
  from cost_center_definition_companies
  where tenant_id = definition_tenant_id
    and cost_center_definition_id = definition_id
    and is_active
    and ended_at is null;

  if definition_scope = 'selected_companies' and definition_active and selected_count = 0 then
    raise exception 'Centro restrito exige ao menos uma empresa selecionada.';
  end if;
  if definition_scope = 'plan' and selected_count > 0 then
    raise exception 'Centro global nao pode manter empresas selecionadas.';
  end if;

  if exists (
    select 1
    from cost_center_definitions child
    join cost_center_definitions parent
      on parent.tenant_id = child.tenant_id
     and parent.plan_id = child.plan_id
     and parent.id = child.parent_id
    where child.tenant_id = definition_tenant_id
      and (child.id = definition_id or parent.id = definition_id)
      and child.is_active
      and child.deleted_at is null
      and parent.scope_type = 'selected_companies'
      and (
        child.scope_type = 'plan'
        or exists (
          select 1
          from cost_center_definition_companies child_scope
          where child_scope.tenant_id = child.tenant_id
            and child_scope.cost_center_definition_id = child.id
            and child_scope.is_active
            and child_scope.ended_at is null
            and not exists (
              select 1
              from cost_center_definition_companies parent_scope
              where parent_scope.tenant_id = parent.tenant_id
                and parent_scope.cost_center_definition_id = parent.id
                and parent_scope.company_id = child_scope.company_id
                and parent_scope.is_active
                and parent_scope.ended_at is null
            )
        )
      )
  ) then
    raise exception 'O escopo de um centro filho deve estar contido no escopo do centro pai.';
  end if;
  return null;
end;
$$;

drop trigger if exists cost_center_definitions_scope_complete on cost_center_definitions;
create constraint trigger cost_center_definitions_scope_complete
after insert or update of parent_id, scope_type, is_active, deleted_at on cost_center_definitions
deferrable initially deferred
for each row execute function cost_center_definition_scope_complete();

drop trigger if exists cost_center_definition_companies_scope_complete on cost_center_definition_companies;
create constraint trigger cost_center_definition_companies_scope_complete
after insert or update or delete on cost_center_definition_companies
deferrable initially deferred
for each row execute function cost_center_definition_scope_complete();

create or replace function ensure_company_cost_center_plan(
  requested_tenant_id uuid,
  requested_company_id text,
  actor_user_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  company_row companies%rowtype;
  resolved_plan_id uuid;
  resolved_plan_active boolean;
  company_is_active boolean;
begin
  perform pg_advisory_xact_lock(
    hashtext(requested_tenant_id::text),
    hashtext(requested_company_id)
  );

  select * into company_row
  from companies
  where tenant_id = requested_tenant_id and id = requested_company_id;
  if not found then
    raise exception 'Empresa para provisionamento de plano nao encontrada no tenant.';
  end if;

  -- Nunca reativa automaticamente uma atribuicao encerrada. Isso evita que
  -- uma sincronizacao de diretorio reverta uma decisao administrativa.
  select assignment.plan_id into resolved_plan_id
  from cost_center_plan_companies assignment
  where assignment.tenant_id = requested_tenant_id
    and assignment.company_id = requested_company_id
  order by assignment.is_active desc, assignment.is_default desc,
           assignment.updated_at desc, assignment.plan_id
  limit 1;
  if found then
    return resolved_plan_id;
  end if;

  company_is_active := company_row.status = 'active' and company_row.deleted_at is null;

  -- Empresas novas de um grupo com plano padrao o herdam sem criar uma
  -- atribuicao redundante. A funcao de abrangencia resolve essa heranca.
  if company_is_active and company_row.group_id is not null then
    select plan.id into resolved_plan_id
    from cost_center_plans plan
    where plan.tenant_id = requested_tenant_id
      and plan.business_group_id = company_row.group_id
      and plan.plan_type = 'group_shared'
      and plan.is_group_default
      and plan.is_active
      and plan.deleted_at is null
    order by plan.created_at, plan.id
    limit 1;
    if found then
      return resolved_plan_id;
    end if;
  end if;

  select plan.id, plan.is_active
    into resolved_plan_id, resolved_plan_active
  from cost_center_plans plan
  where plan.tenant_id = requested_tenant_id
    and plan.owner_company_id = requested_company_id
    and plan.plan_type = 'company_exclusive'
    and plan.deleted_at is null
  order by plan.is_active desc, plan.created_at, plan.id
  limit 1;

  if not found then
    insert into cost_center_plans (
      tenant_id, business_group_id, owner_company_id, code, name,
      plan_type, is_group_default, is_active, metadata, created_by, updated_by
    ) values (
      requested_tenant_id,
      company_row.group_id,
      requested_company_id,
      left('LEGACY-' || requested_company_id, 120),
      left('Plano atual - ' || coalesce(company_row.trade_name, company_row.legal_name), 240),
      'company_exclusive',
      false,
      company_is_active,
      jsonb_build_object('migration', '0053', 'source', 'company_directory'),
      actor_user_id,
      actor_user_id
    )
    returning id, is_active into resolved_plan_id, resolved_plan_active;
  end if;

  insert into cost_center_plan_companies (
    tenant_id, plan_id, company_id, is_default, is_active,
    created_by, updated_by, ended_at
  ) values (
    requested_tenant_id,
    resolved_plan_id,
    requested_company_id,
    company_is_active and resolved_plan_active,
    company_is_active and resolved_plan_active,
    actor_user_id,
    actor_user_id,
    case when company_is_active and resolved_plan_active then null else now() end
  )
  on conflict (tenant_id, plan_id, company_id) do nothing;
  return resolved_plan_id;
end;
$$;

create or replace function provision_company_cost_center_plan()
returns trigger
language plpgsql
as $$
begin
  perform ensure_company_cost_center_plan(new.tenant_id, new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists companies_provision_cost_center_plan on companies;
create trigger companies_provision_cost_center_plan
after insert on companies
for each row execute function provision_company_cost_center_plan();

-- Cada empresa existente recebe inicialmente um plano exclusivo. Como a
-- migration ainda nao criou planos compartilhados, o helper preserva o
-- comportamento legado inclusive para empresas inativas ou removidas.
select ensure_company_cost_center_plan(company.tenant_id, company.id, null)
from companies company;

alter table cost_centers
  add column if not exists plan_id uuid,
  add column if not exists definition_id uuid,
  add column if not exists hierarchy_level smallint not null default 1,
  add column if not exists version bigint not null default 1,
  add column if not exists updated_by uuid references users(id) on delete set null;

do $$
declare
  invalid_budget_id uuid;
begin
  select budget.id into invalid_budget_id
  from budgets budget
  join cost_centers center
    on center.tenant_id = budget.tenant_id
   and center.id = budget.cost_center_id
  where budget.cost_center_id is not null
    and center.company_id is distinct from budget.company_id
  order by budget.tenant_id, budget.id
  limit 1;
  if invalid_budget_id is not null then
    raise exception 'Orcamento % referencia centro de custo de outra empresa.', invalid_budget_id;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_hierarchy_level_check'
  ) then
    alter table cost_centers add constraint cost_centers_hierarchy_level_check
      check (hierarchy_level between 1 and 3);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_version_check'
  ) then
    alter table cost_centers add constraint cost_centers_version_check
      check (version > 0);
  end if;
end;
$$;

update cost_centers center
set plan_id = coalesce(
      center.plan_id,
      ensure_company_cost_center_plan(center.tenant_id, center.company_id, null)
    ),
    definition_id = coalesce(center.definition_id, center.id)
where center.plan_id is null or center.definition_id is null;

do $$
declare
  invalid_center_id uuid;
begin
  select center.id into invalid_center_id
  from cost_centers center
  where center.plan_id is null or center.definition_id is null
  order by center.tenant_id, center.id
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Centro de custo % nao recebeu plano/definicao durante o backfill.', invalid_center_id;
  end if;

  select center.id into invalid_center_id
  from cost_centers center
  where btrim(center.code) = ''
     or length(btrim(center.code)) > 120
     or btrim(center.name) = ''
     or length(btrim(center.name)) > 240
  order by center.tenant_id, center.id
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Centro de custo legado % possui codigo/nome vazio ou acima do limite.', invalid_center_id;
  end if;

  select duplicate.center_id into invalid_center_id
  from (
    select (array_agg(center.id order by center.id))[1] as center_id,
           center.tenant_id,
           center.company_id,
           lower(btrim(center.code)) as normalized_code
    from cost_centers center
    where center.deleted_at is null
    group by center.tenant_id, center.company_id, lower(btrim(center.code))
    having count(*) > 1
  ) duplicate
  order by duplicate.tenant_id, duplicate.company_id, duplicate.normalized_code
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Centros legados possuem codigo duplicado sem diferenciar maiusculas/minusculas; exemplo: %.', invalid_center_id;
  end if;

  select child.id into invalid_center_id
  from cost_centers child
  join cost_centers parent
    on parent.tenant_id = child.tenant_id and parent.id = child.parent_id
  where child.company_id is distinct from parent.company_id
     or child.plan_id is distinct from parent.plan_id
  order by child.tenant_id, child.id
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Centro de custo % possui pai de outra empresa/plano.', invalid_center_id;
  end if;

  with recursive ancestry as (
    select center.tenant_id,
           center.id as leaf_id,
           center.id as current_id,
           center.parent_id,
           array[center.id] as path,
           false as has_cycle,
           1 as depth
    from cost_centers center
    union all
    select ancestry.tenant_id,
           ancestry.leaf_id,
           parent.id,
           parent.parent_id,
           ancestry.path || parent.id,
           parent.id = any(ancestry.path),
           ancestry.depth + 1
    from ancestry
    join cost_centers parent
      on parent.tenant_id = ancestry.tenant_id
     and parent.id = ancestry.parent_id
    where not ancestry.has_cycle
  )
  select leaf_id into invalid_center_id
  from ancestry
  where has_cycle
  order by tenant_id, leaf_id
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Hierarquia legada possui ciclo envolvendo o centro de custo %.', invalid_center_id;
  end if;

  with recursive ancestry as (
    select center.tenant_id,
           center.id as leaf_id,
           center.id as current_id,
           center.parent_id,
           1 as depth
    from cost_centers center
    union all
    select ancestry.tenant_id,
           ancestry.leaf_id,
           parent.id,
           parent.parent_id,
           ancestry.depth + 1
    from ancestry
    join cost_centers parent
      on parent.tenant_id = ancestry.tenant_id
     and parent.id = ancestry.parent_id
  )
  select leaf_id into invalid_center_id
  from ancestry
  group by tenant_id, leaf_id
  having max(depth) > 3
  order by tenant_id, leaf_id
  limit 1;
  if invalid_center_id is not null then
    raise exception 'Hierarquia legada excede tres niveis no centro de custo %.', invalid_center_id;
  end if;
end;
$$;

with recursive hierarchy as (
  select center.tenant_id, center.id, 1 as depth, array[center.id] as path
  from cost_centers center
  where center.parent_id is null
  union all
  select child.tenant_id, child.id, parent.depth + 1, parent.path || child.id
  from cost_centers child
  join hierarchy parent
    on parent.tenant_id = child.tenant_id and child.parent_id = parent.id
  where not child.id = any(parent.path)
)
update cost_centers center
set hierarchy_level = hierarchy.depth
from hierarchy
where center.tenant_id = hierarchy.tenant_id and center.id = hierarchy.id;

insert into cost_center_definitions (
  id, tenant_id, plan_id, parent_id, code, name, hierarchy_level,
  scope_type, manager_user_id, is_active, version, metadata,
  created_at, updated_at, deleted_at
)
select center.definition_id, center.tenant_id, center.plan_id,
       parent.definition_id, center.code, center.name, center.hierarchy_level,
       'plan', center.manager_user_id,
       center.status = 'active' and center.deleted_at is null,
       center.version,
       center.metadata || jsonb_build_object('migration', '0053', 'sourceProjectionId', center.id),
       center.created_at, center.updated_at, center.deleted_at
from cost_centers center
left join cost_centers parent
  on parent.tenant_id = center.tenant_id and parent.id = center.parent_id
where center.definition_id is not null and center.plan_id is not null
on conflict (id) do nothing;

drop trigger if exists cost_center_definitions_validate_hierarchy on cost_center_definitions;
create trigger cost_center_definitions_validate_hierarchy
before insert or update of id, tenant_id, parent_id, plan_id, is_active, deleted_at
on cost_center_definitions
for each row execute function validate_cost_center_definition_hierarchy();

drop trigger if exists cost_center_definitions_refresh_descendant_levels on cost_center_definitions;
create trigger cost_center_definitions_refresh_descendant_levels
after update of parent_id on cost_center_definitions
for each row execute function refresh_cost_center_descendant_levels();

alter table cost_centers
  drop constraint if exists cost_centers_tenant_id_company_id_code_key;

create unique index if not exists cost_centers_company_code_active_uidx
  on cost_centers (tenant_id, company_id, lower(btrim(code)))
  where deleted_at is null;
create unique index if not exists cost_centers_company_definition_active_uidx
  on cost_centers (tenant_id, company_id, definition_id)
  where definition_id is not null and deleted_at is null;
create index if not exists cost_centers_plan_idx
  on cost_centers (tenant_id, plan_id, company_id, status, code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_plan_fk'
  ) then
    alter table cost_centers add constraint cost_centers_plan_fk
      foreign key (tenant_id, plan_id)
      references cost_center_plans(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_definition_fk'
  ) then
    alter table cost_centers add constraint cost_centers_definition_fk
      foreign key (tenant_id, plan_id, definition_id)
      references cost_center_definitions(tenant_id, plan_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_company_identity_unique'
  ) then
    alter table cost_centers add constraint cost_centers_company_identity_unique
      unique (tenant_id, company_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cost_centers'::regclass
      and conname = 'cost_centers_catalog_pair_check'
  ) then
    alter table cost_centers add constraint cost_centers_catalog_pair_check
      check ((plan_id is null) = (definition_id is null));
  end if;
end;
$$;

create or replace function validate_cost_center_projection()
returns trigger
language plpgsql
as $$
declare
  definition_row cost_center_definitions%rowtype;
  projected_parent_definition_id uuid;
begin
  -- Compatibilidade expand/contract: uma imagem anterior ainda pode criar
  -- uma linha sem catalogo. O novo codigo sempre informa o par completo.
  if new.plan_id is null and new.definition_id is null then
    return new;
  end if;
  if new.plan_id is null or new.definition_id is null then
    raise exception 'Projecao exige plan_id e definition_id em conjunto.';
  end if;

  select * into definition_row
  from cost_center_definitions
  where tenant_id = new.tenant_id
    and id = new.definition_id
    and plan_id = new.plan_id;
  if not found then
    raise exception 'Definicao da projecao nao pertence ao plano informado.';
  end if;

  -- A definicao e a fonte canonica; a projecao somente materializa os campos
  -- necessarios aos consumidores legados de uma empresa.
  new.code := definition_row.code::text;
  new.name := definition_row.name;
  new.manager_user_id := definition_row.manager_user_id;
  new.hierarchy_level := definition_row.hierarchy_level;

  if new.status = 'active' and new.deleted_at is null then
    if not definition_row.is_active or definition_row.deleted_at is not null then
      raise exception 'Projecao ativa exige definicao ativa.';
    end if;
    if not cost_center_plan_applies_to_company(new.tenant_id, new.plan_id, new.company_id) then
      raise exception 'Empresa nao esta autorizada a utilizar o plano da projecao.';
    end if;
    if definition_row.scope_type = 'selected_companies' and not exists (
      select 1
      from cost_center_definition_companies selected
      where selected.tenant_id = new.tenant_id
        and selected.cost_center_definition_id = new.definition_id
        and selected.company_id = new.company_id
        and selected.is_active
        and selected.ended_at is null
    ) then
      raise exception 'Empresa nao esta no escopo restrito do centro de custo.';
    end if;
  end if;

  if definition_row.parent_id is null then
    if new.parent_id is not null then
      raise exception 'Projecao raiz nao pode possuir pai.';
    end if;
  else
    select parent.definition_id into projected_parent_definition_id
    from cost_centers parent
    where parent.tenant_id = new.tenant_id
      and parent.company_id = new.company_id
      and parent.id = new.parent_id;
    if not found or projected_parent_definition_id is distinct from definition_row.parent_id then
      raise exception 'Pai da projecao nao corresponde ao pai da definicao na mesma empresa.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cost_centers_validate_catalog_projection on cost_centers;
create trigger cost_centers_validate_catalog_projection
before insert or update of company_id, plan_id, definition_id, parent_id, code, name,
  manager_user_id, hierarchy_level, status, deleted_at
on cost_centers
for each row execute function validate_cost_center_projection();

alter table companies add column if not exists default_cost_center_id uuid;
alter table employees add column if not exists cost_center_id uuid;
alter table requesters add column if not exists cost_center_id uuid;
alter table demands add column if not exists cost_center_id uuid;

update companies company
set default_cost_center_id = (
  select center.id
  from cost_centers center
  where center.tenant_id = company.tenant_id
    and center.company_id = company.id
    and center.deleted_at is null
    and (
      lower(btrim(center.code)) = lower(btrim(company.default_cost_center))
      or lower(btrim(center.name)) = lower(btrim(company.default_cost_center))
    )
  order by (lower(btrim(center.code)) = lower(btrim(company.default_cost_center))) desc, center.id
  limit 1
)
where company.default_cost_center_id is null
  and nullif(btrim(company.default_cost_center), '') is not null
  and exists (
    select 1 from cost_centers center
    where center.tenant_id = company.tenant_id and center.company_id = company.id
      and center.deleted_at is null
      and (
        lower(btrim(center.code)) = lower(btrim(company.default_cost_center))
        or lower(btrim(center.name)) = lower(btrim(company.default_cost_center))
      )
  );

update employees employee
set cost_center_id = (
  select center.id
  from cost_centers center
  where center.tenant_id = employee.tenant_id
    and center.company_id = employee.company_id
    and center.deleted_at is null
    and (
      lower(btrim(center.code)) = lower(btrim(employee.cost_center))
      or lower(btrim(center.name)) = lower(btrim(employee.cost_center))
    )
  order by (lower(btrim(center.code)) = lower(btrim(employee.cost_center))) desc, center.id
  limit 1
)
where employee.cost_center_id is null
  and nullif(btrim(employee.cost_center), '') is not null
  and exists (
    select 1 from cost_centers center
    where center.tenant_id = employee.tenant_id and center.company_id = employee.company_id
      and center.deleted_at is null
      and (
        lower(btrim(center.code)) = lower(btrim(employee.cost_center))
        or lower(btrim(center.name)) = lower(btrim(employee.cost_center))
      )
  );

update requesters requester
set cost_center_id = (
  select center.id
  from cost_centers center
  where center.tenant_id = requester.tenant_id
    and center.company_id = requester.company_id
    and center.deleted_at is null
    and (
      lower(btrim(center.code)) = lower(btrim(requester.cost_center))
      or lower(btrim(center.name)) = lower(btrim(requester.cost_center))
    )
  order by (lower(btrim(center.code)) = lower(btrim(requester.cost_center))) desc, center.id
  limit 1
)
where requester.cost_center_id is null
  and nullif(btrim(requester.cost_center), '') is not null
  and exists (
    select 1 from cost_centers center
    where center.tenant_id = requester.tenant_id and center.company_id = requester.company_id
      and center.deleted_at is null
      and (
        lower(btrim(center.code)) = lower(btrim(requester.cost_center))
        or lower(btrim(center.name)) = lower(btrim(requester.cost_center))
      )
  );

update demands demand
set cost_center_id = (
  select center.id
  from cost_centers center
  where center.tenant_id = demand.tenant_id
    and center.company_id = demand.company_id
    and center.deleted_at is null
    and (
      lower(btrim(center.code)) = lower(btrim(demand.cost_center))
      or lower(btrim(center.name)) = lower(btrim(demand.cost_center))
    )
  order by (lower(btrim(center.code)) = lower(btrim(demand.cost_center))) desc, center.id
  limit 1
)
where demand.cost_center_id is null
  and nullif(btrim(demand.cost_center), '') is not null
  and exists (
    select 1 from cost_centers center
    where center.tenant_id = demand.tenant_id and center.company_id = demand.company_id
      and center.deleted_at is null
      and (
        lower(btrim(center.code)) = lower(btrim(demand.cost_center))
        or lower(btrim(center.name)) = lower(btrim(demand.cost_center))
      )
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'companies'::regclass and conname = 'companies_default_cost_center_fk'
  ) then
    alter table companies add constraint companies_default_cost_center_fk
      foreign key (tenant_id, id, default_cost_center_id)
      references cost_centers(tenant_id, company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'employees'::regclass and conname = 'employees_cost_center_fk'
  ) then
    alter table employees add constraint employees_cost_center_fk
      foreign key (tenant_id, company_id, cost_center_id)
      references cost_centers(tenant_id, company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'requesters'::regclass and conname = 'requesters_cost_center_fk'
  ) then
    alter table requesters add constraint requesters_cost_center_fk
      foreign key (tenant_id, company_id, cost_center_id)
      references cost_centers(tenant_id, company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'demands'::regclass and conname = 'demands_cost_center_fk'
  ) then
    alter table demands add constraint demands_cost_center_fk
      foreign key (tenant_id, company_id, cost_center_id)
      references cost_centers(tenant_id, company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'budgets'::regclass and conname = 'budgets_company_cost_center_fk'
  ) then
    alter table budgets add constraint budgets_company_cost_center_fk
      foreign key (tenant_id, company_id, cost_center_id)
      references cost_centers(tenant_id, company_id, id) on delete restrict;
  end if;
end;
$$;

create index if not exists companies_default_cost_center_idx
  on companies (tenant_id, default_cost_center_id) where default_cost_center_id is not null;
create index if not exists employees_cost_center_id_idx
  on employees (tenant_id, company_id, cost_center_id) where cost_center_id is not null;
create index if not exists requesters_cost_center_id_idx
  on requesters (tenant_id, company_id, cost_center_id) where cost_center_id is not null;
create index if not exists demands_cost_center_id_idx
  on demands (tenant_id, company_id, cost_center_id) where cost_center_id is not null;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'cost_center_plans',
    'cost_center_plan_companies',
    'cost_center_definitions',
    'cost_center_definition_companies'
  ] loop
    execute format('alter table %I enable row level security', target_table);
    execute format('alter table %I force row level security', target_table);
    execute format('drop policy if exists tenant_isolation on %I', target_table);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      target_table
    );
  end loop;
end;
$$;

drop trigger if exists cost_center_plans_set_updated_at on cost_center_plans;
create trigger cost_center_plans_set_updated_at
before update on cost_center_plans
for each row execute function set_updated_at();

drop trigger if exists cost_center_plan_companies_set_updated_at on cost_center_plan_companies;
create trigger cost_center_plan_companies_set_updated_at
before update on cost_center_plan_companies
for each row execute function set_updated_at();

drop trigger if exists cost_center_definitions_set_updated_at on cost_center_definitions;
create trigger cost_center_definitions_set_updated_at
before update on cost_center_definitions
for each row execute function set_updated_at();

drop trigger if exists cost_center_definition_companies_set_updated_at
on cost_center_definition_companies;
create trigger cost_center_definition_companies_set_updated_at
before update on cost_center_definition_companies
for each row execute function set_updated_at();
