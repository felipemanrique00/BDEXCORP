insert into permissions (permission_key, module, description) values
  ('ver_workflows', 'governanca', 'Visualizar definicoes e execucoes de workflows'),
  ('executar_workflows', 'governanca', 'Executar e reprocessar workflows autorizados'),
  ('usar_ia', 'inteligencia', 'Utilizar recursos de inteligencia artificial autorizados'),
  ('gerenciar_ia', 'inteligencia', 'Administrar configuracoes e ferramentas de inteligencia artificial'),
  ('ver_arquivos', 'documentos', 'Visualizar arquivos vinculados a recursos autorizados'),
  ('gerenciar_arquivos', 'documentos', 'Enviar e remover arquivos vinculados a recursos autorizados'),
  ('ver_auditoria', 'administracao', 'Consultar trilhas de auditoria autorizadas'),
  ('ver_inteligencia', 'inteligencia', 'Visualizar indicadores e recomendacoes corporativas'),
  ('usar_busca_global', 'inteligencia', 'Utilizar busca universal dentro do escopo autorizado'),
  ('ver_orcamentos', 'financeiro', 'Visualizar orcamentos das empresas autorizadas'),
  ('gerenciar_orcamentos', 'financeiro', 'Criar e alterar orcamentos das empresas autorizadas'),
  ('executar_automacoes', 'automacoes', 'Executar e acompanhar automacoes autorizadas'),
  ('gerenciar_automacoes', 'automacoes', 'Criar, publicar e suspender automacoes'),
  ('acessar_portal_viajante', 'portal', 'Acessar a experiencia operacional do viajante')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission.permission_key, true
from roles role_row
cross join permissions permission
where role_row.role_key = 'tenant_admin'
on conflict (role_id, permission_key) do update set allowed = true;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
  'gerenciar_arquivos', 'ver_inteligencia', 'usar_busca_global',
  'acessar_portal_viajante'
]) as permission_key
where role_row.role_key in ('agent', 'operator')
on conflict (role_id, permission_key) do update set allowed = true;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_workflows', 'executar_workflows', 'usar_ia', 'gerenciar_ia',
  'ver_arquivos', 'gerenciar_arquivos', 'ver_auditoria',
  'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos',
  'gerenciar_orcamentos', 'executar_automacoes', 'gerenciar_automacoes',
  'acessar_portal_viajante'
]) as permission_key
where role_row.role_key = 'supervisor'
on conflict (role_id, permission_key) do update set allowed = true;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
  'ver_auditoria', 'ver_inteligencia', 'usar_busca_global',
  'ver_orcamentos', 'gerenciar_orcamentos'
]) as permission_key
where role_row.role_key = 'financial_manager'
on conflict (role_id, permission_key) do update set allowed = true;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from roles role_row
cross join unnest(array[
  'ver_workflows', 'usar_ia', 'ver_arquivos', 'ver_inteligencia',
  'usar_busca_global', 'ver_orcamentos', 'acessar_portal_viajante'
]) as permission_key
where role_row.role_key in ('company_admin', 'requester', 'readonly')
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
          'gerenciar_automacoes', 'acessar_portal_viajante'
        )
    );
$$;

create or replace function authorization_field_names_valid(value text[])
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1 from unnest(value) field_name
    where field_name !~ '^[a-zA-Z][a-zA-Z0-9_.]{0,119}$'
  );
$$;

create table if not exists authorization_scope_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  effect text not null check (effect in ('allow', 'deny')),
  permission_key text not null references permissions(permission_key) on delete restrict,
  resource_type text not null check (
    resource_type = '*' or resource_type ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  actions text[] not null check (
    cardinality(actions) > 0
    and actions <@ array[
      '*', 'read', 'list', 'create', 'update', 'delete', 'export',
      'approve', 'publish', 'execute', 'issue', 'cancel', 'settle',
      'manage', 'reset', 'use'
    ]::text[]
  ),
  scope_type text not null check (scope_type in (
    'tenant', 'group', 'company', 'organizational_unit',
    'cost_center', 'project', 'user'
  )),
  scope_id text not null check (btrim(scope_id) <> ''),
  company_id text,
  field_names text[] not null default '{}',
  is_boundary boolean not null default false,
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
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
    references tenant_memberships(tenant_id, id) on delete set null,
  check (valid_until is null or valid_until > valid_from),
  check (not (effect = 'deny' and is_boundary)),
  check (authorization_field_names_valid(field_names))
);

create unique index if not exists authorization_scope_grants_active_uidx
  on authorization_scope_grants (
    tenant_id, membership_id, permission_key, resource_type,
    scope_type, scope_id, effect, is_boundary
  )
  where status <> 'revoked';

create index if not exists authorization_scope_grants_resolution_idx
  on authorization_scope_grants (
    tenant_id, membership_id, status, permission_key, resource_type,
    scope_type, scope_id, valid_from, valid_until
  );

create or replace function validate_authorization_scope_grant()
returns trigger
language plpgsql
as $$
declare
  resolved_company_id text;
begin
  if new.scope_type = 'tenant' then
    if new.scope_id is distinct from new.tenant_id::text then
      raise exception 'Escopo tenant precisa referenciar o tenant do vinculo.';
    end if;
    if new.company_id is not null then
      raise exception 'Escopo tenant nao aceita company_id.';
    end if;
  elsif new.scope_type = 'group' then
    if not exists (
      select 1 from business_groups
      where tenant_id = new.tenant_id and id = new.scope_id
        and deleted_at is null
    ) then
      raise exception 'Grupo do limite de autorizacao nao encontrado no tenant.';
    end if;
    if new.company_id is not null and not exists (
      select 1 from companies
      where tenant_id = new.tenant_id and id = new.company_id
        and group_id = new.scope_id and deleted_at is null
    ) then
      raise exception 'A empresa informada nao pertence ao grupo do limite.';
    end if;
  elsif new.scope_type = 'company' then
    if not exists (
      select 1 from companies
      where tenant_id = new.tenant_id and id = new.scope_id
        and deleted_at is null
    ) then
      raise exception 'Empresa do limite de autorizacao nao encontrada no tenant.';
    end if;
    if new.company_id is not null and new.company_id is distinct from new.scope_id then
      raise exception 'company_id precisa coincidir com o escopo company.';
    end if;
    new.company_id := new.scope_id;
  elsif new.scope_type = 'organizational_unit' then
    select company_id into resolved_company_id
    from organizational_units
    where tenant_id = new.tenant_id and id = new.scope_id::uuid
      and deleted_at is null;
    if resolved_company_id is null then
      raise exception 'Unidade organizacional nao encontrada no tenant.';
    end if;
    if new.company_id is not null and new.company_id is distinct from resolved_company_id then
      raise exception 'A unidade organizacional pertence a outra empresa.';
    end if;
    new.company_id := resolved_company_id;
  elsif new.scope_type = 'cost_center' then
    select company_id into resolved_company_id
    from cost_centers
    where tenant_id = new.tenant_id and id = new.scope_id::uuid
      and deleted_at is null;
    if resolved_company_id is null then
      raise exception 'Centro de custo nao encontrado no tenant.';
    end if;
    if new.company_id is not null and new.company_id is distinct from resolved_company_id then
      raise exception 'O centro de custo pertence a outra empresa.';
    end if;
    new.company_id := resolved_company_id;
  elsif new.scope_type = 'project' then
    select company_id into resolved_company_id
    from projects
    where tenant_id = new.tenant_id and id = new.scope_id::uuid
      and deleted_at is null;
    if resolved_company_id is null then
      raise exception 'Projeto nao encontrado no tenant.';
    end if;
    if new.company_id is not null and new.company_id is distinct from resolved_company_id then
      raise exception 'O projeto pertence a outra empresa.';
    end if;
    new.company_id := resolved_company_id;
  elsif new.scope_type = 'user' then
    if not exists (
      select 1 from tenant_memberships
      where tenant_id = new.tenant_id and user_id = new.scope_id::uuid
    ) then
      raise exception 'Usuario do limite de autorizacao nao pertence ao tenant.';
    end if;
  end if;

  if new.company_id is not null and not exists (
    select 1 from companies
    where tenant_id = new.tenant_id and id = new.company_id
      and deleted_at is null
  ) then
    raise exception 'Empresa contextual do limite nao encontrada no tenant.';
  end if;

  return new;
exception
  when invalid_text_representation then
    raise exception 'Identificador de escopo invalido para %.', new.scope_type;
end;
$$;

drop trigger if exists authorization_scope_grants_validate on authorization_scope_grants;
create trigger authorization_scope_grants_validate
before insert or update on authorization_scope_grants
for each row execute function validate_authorization_scope_grant();

alter table authorization_scope_grants enable row level security;
alter table authorization_scope_grants force row level security;
drop policy if exists tenant_isolation on authorization_scope_grants;
create policy tenant_isolation on authorization_scope_grants
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists authorization_scope_grants_set_updated_at on authorization_scope_grants;
create trigger authorization_scope_grants_set_updated_at
before update on authorization_scope_grants
for each row execute function set_updated_at();
