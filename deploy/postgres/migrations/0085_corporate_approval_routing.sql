begin;

alter table corporate_group_access_grants
  drop constraint if exists corporate_group_access_grants_corporate_profile_check;
alter table corporate_group_access_grants
  add constraint corporate_group_access_grants_corporate_profile_check check (corporate_profile in (
    'owner', 'ceo', 'group_admin', 'executive_assistant', 'group_finance',
    'manager', 'approver', 'viewer', 'company_admin', 'requester'
  ));

alter table corporate_company_access_grants
  drop constraint if exists corporate_company_access_grants_corporate_profile_check;
alter table corporate_company_access_grants
  add constraint corporate_company_access_grants_corporate_profile_check check (corporate_profile in (
    'owner', 'ceo', 'group_admin', 'executive_assistant', 'group_finance',
    'manager', 'approver', 'viewer', 'company_admin', 'requester'
  ));

create table if not exists approval_approver_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  business_group_id text,
  code text not null check (code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, business_group_id) references business_groups(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict,
  check (num_nonnulls(company_id, business_group_id) = 1)
);

create unique index if not exists approval_approver_groups_scope_code_uidx
  on approval_approver_groups (
    tenant_id,
    coalesce(company_id, ''),
    coalesce(business_group_id, ''),
    lower(code)
  ) where status <> 'archived';

create table if not exists approval_approver_group_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  approver_group_id uuid not null,
  membership_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, approver_group_id, membership_id),
  foreign key (tenant_id, approver_group_id)
    references approval_approver_groups(tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id)
    references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete restrict
);

create index if not exists approval_approver_group_members_membership_idx
  on approval_approver_group_members (tenant_id, membership_id, status, approver_group_id);

create table if not exists approval_audience_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  code text not null check (code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id) references tenant_memberships(tenant_id, id) on delete restrict
);

create unique index if not exists approval_audience_groups_company_code_uidx
  on approval_audience_groups (tenant_id, company_id, lower(code))
  where status <> 'archived';

create table if not exists approval_audience_group_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  audience_group_id uuid not null,
  employee_id text,
  requester_id text,
  user_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, audience_group_id)
    references approval_audience_groups(tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, requester_id) references requesters(tenant_id, id) on delete cascade,
  foreign key (user_id) references users(id) on delete cascade,
  foreign key (tenant_id, created_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete restrict,
  check (num_nonnulls(employee_id, requester_id, user_id) = 1)
);

create unique index if not exists approval_audience_group_employee_uidx
  on approval_audience_group_members (tenant_id, audience_group_id, employee_id)
  where employee_id is not null;
create unique index if not exists approval_audience_group_requester_uidx
  on approval_audience_group_members (tenant_id, audience_group_id, requester_id)
  where requester_id is not null;
create unique index if not exists approval_audience_group_user_uidx
  on approval_audience_group_members (tenant_id, audience_group_id, user_id)
  where user_id is not null;

alter table approval_authorities add column if not exists department text;
alter table approval_authorities add column if not exists audience_group_id uuid;
alter table approval_authorities add column if not exists approval_level smallint not null default 1;

alter table approval_authorities
  drop constraint if exists approval_authorities_status_check;
alter table approval_authorities
  add constraint approval_authorities_status_check check (
    status in ('draft', 'scheduled', 'active', 'suspended', 'revoked', 'expired')
  );

update approval_authorities
set approval_level = 2
where approval_kind = 'second_level' and approval_level = 1;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_value.conname
    from pg_constraint constraint_value
    where constraint_value.conrelid = 'approval_authorities'::regclass
      and constraint_value.contype = 'c'
      and pg_get_constraintdef(constraint_value.oid) ilike '%num_nonnulls(company_id, group_id, cost_center_id, project_id)%'
  loop
    execute format('alter table approval_authorities drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

update approval_authorities authority
set company_id = center.company_id
from cost_centers center
where authority.tenant_id = center.tenant_id
  and authority.cost_center_id = center.id
  and authority.company_id is null;

update approval_authorities authority
set company_id = project.company_id
from projects project
where authority.tenant_id = project.tenant_id
  and authority.project_id = project.id
  and authority.company_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'approval_authorities'::regclass
      and conname = 'approval_authorities_scope_shape_check'
  ) then
    alter table approval_authorities
      add constraint approval_authorities_scope_shape_check check (
        (group_id is null or num_nonnulls(company_id, cost_center_id, project_id, department, audience_group_id) = 0)
        and num_nonnulls(cost_center_id, project_id, department, audience_group_id) <= 1
        and (num_nonnulls(cost_center_id, project_id, department, audience_group_id) = 0 or company_id is not null)
        and (department is null or length(btrim(department)) between 1 and 240)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'approval_authorities'::regclass
      and conname = 'approval_authorities_level_check'
  ) then
    alter table approval_authorities
      add constraint approval_authorities_level_check check (approval_level in (1, 2));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'approval_authorities'::regclass
      and conname = 'approval_authorities_audience_group_fk'
  ) then
    alter table approval_authorities
      add constraint approval_authorities_audience_group_fk
      foreign key (tenant_id, audience_group_id)
      references approval_audience_groups(tenant_id, id) on delete restrict;
  end if;
end;
$$;

drop index if exists approval_authorities_current_uidx;
create unique index approval_authorities_current_uidx
  on approval_authorities (
    tenant_id, membership_id, approval_kind, approval_level,
    coalesce(company_id, ''), coalesce(group_id, ''),
    coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(lower(btrim(department)), ''),
    coalesce(audience_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(currency, ''), coalesce(max_amount, -1),
    coalesce(accumulated_amount_limit, -1), coalesce(accumulation_period_days, -1),
    coalesce(max_percentage_above_lowest, -1), coalesce(max_percentage_above_average, -1),
    requires_budget_available, urgent_allowed, products, destinations, risk_levels
  ) where status in ('scheduled', 'active');

create index if not exists approval_authorities_resolution_scope_idx
  on approval_authorities (
    tenant_id, approval_kind, approval_level, company_id, group_id,
    cost_center_id, audience_group_id, status, valid_from, valid_until
  );

create table if not exists approval_matrices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  root_scope_type text not null check (root_scope_type in ('company', 'business_group')),
  company_id text,
  business_group_id text,
  access_mode text check (access_mode is null or access_mode in ('all_companies', 'selected_companies')),
  selected_company_ids text[] not null default '{}',
  stage text not null check (stage in ('merit', 'cost')),
  rule_slot_key text not null check (rule_slot_key ~ '^[0-9a-f]{64}$'),
  authority_ids uuid[] not null check (cardinality(authority_ids) > 0),
  workflow_definition_id uuid not null,
  workflow_version_id uuid not null,
  policy_definition_id uuid not null,
  policy_version_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references users(id) on delete restrict,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, business_group_id) references business_groups(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_definition_id) references approval_workflow_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_version_id) references approval_workflow_versions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_definition_id) references policy_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, policy_version_id) references policy_versions(tenant_id, id) on delete restrict,
  check (
    (root_scope_type = 'company' and company_id is not null and business_group_id is null
      and access_mode is null and cardinality(selected_company_ids) = 0)
    or
    (root_scope_type = 'business_group' and company_id is null and business_group_id is not null
      and access_mode is not null
      and (access_mode = 'all_companies' or cardinality(selected_company_ids) > 0))
  ),
  check ((approved_at is null) = (approved_by is null)),
  check ((published_at is null) = (published_by is null))
);

create index if not exists approval_matrices_scope_stage_idx
  on approval_matrices (
    tenant_id, root_scope_type, company_id, business_group_id, stage, status, created_at desc
  );

create unique index if not exists approval_matrices_published_rule_slot_uidx
  on approval_matrices (tenant_id, rule_slot_key)
  where status = 'published';

create or replace function corporate_approval_grant_can_decide(profile_value text, overrides jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when overrides ? 'decidir_aprovacoes' then (overrides ->> 'decidir_aprovacoes')::boolean
    else profile_value in (
      'owner', 'ceo', 'group_admin', 'group_finance', 'manager',
      'approver', 'company_admin'
    )
  end;
$$;

create or replace function corporate_user_can_decide_for_company(
  tenant_value uuid,
  membership_value uuid,
  company_value text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from tenant_memberships membership
    join users user_row on user_row.id = membership.user_id
    join roles role_row on role_row.id = membership.role_id
    where membership.tenant_id = tenant_value
      and membership.id = membership_value
      and membership.status = 'active'
      and user_row.status = 'active'
      and user_row.deleted_at is null
      and not user_row.platform_admin
      and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
      and (
        exists (
          select 1 from corporate_company_access_grants company_grant
          where company_grant.tenant_id = membership.tenant_id
            and company_grant.membership_id = membership.id
            and company_grant.company_id = company_value
            and company_grant.status = 'active'
            and company_grant.valid_from <= now()
            and (company_grant.valid_until is null or company_grant.valid_until > now())
            and corporate_approval_grant_can_decide(
              company_grant.corporate_profile,
              company_grant.permission_overrides
            )
        )
        or exists (
          select 1
          from corporate_group_access_grants group_grant
          join companies company
            on company.tenant_id = group_grant.tenant_id
           and company.id = company_value
           and company.group_id = group_grant.business_group_id
           and company.deleted_at is null
          where group_grant.tenant_id = membership.tenant_id
            and group_grant.membership_id = membership.id
            and group_grant.status = 'active'
            and group_grant.valid_from <= now()
            and (group_grant.valid_until is null or group_grant.valid_until > now())
            and corporate_approval_grant_can_decide(
              group_grant.corporate_profile,
              group_grant.permission_overrides
            )
            and (
              group_grant.access_mode = 'all_companies'
              or exists (
                select 1 from corporate_group_access_companies selected
                where selected.tenant_id = group_grant.tenant_id
                  and selected.group_access_grant_id = group_grant.id
                  and selected.company_id = company_value
              )
            )
        )
      )
  );
$$;

create or replace function corporate_user_can_decide_for_group_all(
  tenant_value uuid,
  membership_value uuid,
  group_value text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from tenant_memberships membership
    join users user_row on user_row.id = membership.user_id
    join roles role_row on role_row.id = membership.role_id
    join corporate_group_access_grants group_grant
      on group_grant.tenant_id = membership.tenant_id
     and group_grant.membership_id = membership.id
     and group_grant.business_group_id = group_value
     and group_grant.access_mode = 'all_companies'
     and group_grant.status = 'active'
     and group_grant.valid_from <= now()
     and (group_grant.valid_until is null or group_grant.valid_until > now())
    where membership.tenant_id = tenant_value
      and membership.id = membership_value
      and membership.status = 'active'
      and user_row.status = 'active'
      and user_row.deleted_at is null
      and not user_row.platform_admin
      and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
      and corporate_approval_grant_can_decide(
        group_grant.corporate_profile,
        group_grant.permission_overrides
      )
  );
$$;

create or replace function corporate_user_has_company_access(
  tenant_value uuid,
  membership_value uuid,
  company_value text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from tenant_memberships membership
    join users user_row on user_row.id = membership.user_id
    join roles role_row on role_row.id = membership.role_id
    where membership.tenant_id = tenant_value
      and membership.id = membership_value
      and membership.status = 'active'
      and user_row.status = 'active'
      and user_row.deleted_at is null
      and not user_row.platform_admin
      and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
      and (
        exists (
          select 1 from corporate_company_access_grants company_grant
          where company_grant.tenant_id = membership.tenant_id
            and company_grant.membership_id = membership.id
            and company_grant.company_id = company_value
            and company_grant.status = 'active'
            and company_grant.valid_from <= now()
            and (company_grant.valid_until is null or company_grant.valid_until > now())
        )
        or exists (
          select 1
          from corporate_group_access_grants group_grant
          join companies company
            on company.tenant_id = group_grant.tenant_id
           and company.id = company_value
           and company.group_id = group_grant.business_group_id
           and company.deleted_at is null
          where group_grant.tenant_id = membership.tenant_id
            and group_grant.membership_id = membership.id
            and group_grant.status = 'active'
            and group_grant.valid_from <= now()
            and (group_grant.valid_until is null or group_grant.valid_until > now())
            and (
              group_grant.access_mode = 'all_companies'
              or exists (
                select 1 from corporate_group_access_companies selected
                where selected.tenant_id = group_grant.tenant_id
                  and selected.group_access_grant_id = group_grant.id
                  and selected.company_id = company_value
              )
            )
        )
      )
  );
$$;

create or replace function validate_approval_approver_group_member()
returns trigger
language plpgsql
as $$
declare
  group_company_id text;
  target_group_id text;
begin
  select company_id, business_group_id into group_company_id, target_group_id
  from approval_approver_groups
  where tenant_id = new.tenant_id and id = new.approver_group_id and status <> 'archived';
  if group_company_id is not null then
    if not corporate_user_can_decide_for_company(new.tenant_id, new.membership_id, group_company_id) then
      raise exception 'Membro nao possui acesso corporativo efetivo para decidir aprovacoes na empresa.';
    end if;
  elsif target_group_id is not null then
    if not corporate_user_can_decide_for_group_all(new.tenant_id, new.membership_id, target_group_id) then
      raise exception 'Membro precisa de grant corporativo all_companies para decidir inclusive em empresas futuras do grupo.';
    end if;
  else
    raise exception 'Grupo de aprovadores sem escopo valido.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_approver_group_members_validate on approval_approver_group_members;
create trigger approval_approver_group_members_validate
before insert or update on approval_approver_group_members
for each row execute function validate_approval_approver_group_member();

create or replace function validate_approval_authority_extended_scope()
returns trigger
language plpgsql
as $$
declare
  scoped_company_id text;
begin
  if new.audience_group_id is not null then
    select company_id into scoped_company_id
    from approval_audience_groups
    where tenant_id = new.tenant_id and id = new.audience_group_id and status = 'active';
    if scoped_company_id is null or scoped_company_id is distinct from new.company_id then
      raise exception 'Grupo alvo da alcada pertence a outra empresa ou nao esta ativo.';
    end if;
  end if;
  if new.approval_kind in ('merit', 'cost')
     and new.status in ('scheduled', 'active')
     and not exists (
       select 1 from approval_matrices matrix
       where matrix.tenant_id = new.tenant_id
         and matrix.status in ('approved', 'published')
         and new.id = any(matrix.authority_ids)
     ) then
    raise exception 'Alcadas de merito e custo efetivas exigem vinculo com matriz governada aprovada.';
  end if;
  if new.status in ('draft', 'scheduled', 'active', 'suspended') then
    if new.group_id is not null then
      if not corporate_user_can_decide_for_group_all(new.tenant_id, new.membership_id, new.group_id) then
        raise exception 'Alcada de grupo exige autorizador corporativo com grant all_companies para decidir aprovacoes.';
      end if;
    elsif new.company_id is not null then
      if not corporate_user_can_decide_for_company(new.tenant_id, new.membership_id, new.company_id) then
        raise exception 'Alcada exige autorizador corporativo com grant explicito para decidir aprovacoes na empresa.';
      end if;
    elsif not exists (
      select 1
      from companies company
      where company.tenant_id = new.tenant_id
        and company.deleted_at is null
        and corporate_user_can_decide_for_company(new.tenant_id, new.membership_id, company.id)
    ) then
      raise exception 'Alcada global exige autorizador corporativo com grant explicito para decidir aprovacoes.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists approval_authorities_validate_extended_scope on approval_authorities;
create trigger approval_authorities_validate_extended_scope
before insert or update of membership_id, approval_kind, approval_level, company_id, group_id, audience_group_id, status on approval_authorities
for each row execute function validate_approval_authority_extended_scope();

create or replace function validate_approval_audience_group_member()
returns trigger
language plpgsql
as $$
declare
  target_company_id text;
  member_company_id text;
begin
  select company_id into target_company_id
  from approval_audience_groups
  where tenant_id = new.tenant_id and id = new.audience_group_id;
  if target_company_id is null then
    raise exception 'Grupo alvo de usuarios nao encontrado.';
  end if;
  if new.employee_id is not null then
    select company_id into member_company_id from employees
    where tenant_id = new.tenant_id and id = new.employee_id and deleted_at is null;
  elsif new.requester_id is not null then
    select company_id into member_company_id from requesters
    where tenant_id = new.tenant_id and id = new.requester_id and deleted_at is null;
  else
    if not exists (
      select 1 from tenant_memberships membership
      where membership.tenant_id = new.tenant_id
        and membership.user_id = new.user_id
        and corporate_user_has_company_access(
          new.tenant_id,
          membership.id,
          target_company_id
        )
    ) then
      raise exception 'Usuario do grupo alvo nao possui acesso corporativo efetivo a empresa.';
    end if;
    return new;
  end if;
  if member_company_id is distinct from target_company_id then
    raise exception 'Membro do grupo alvo pertence a outra empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_audience_group_members_validate on approval_audience_group_members;
create trigger approval_audience_group_members_validate
before insert or update on approval_audience_group_members
for each row execute function validate_approval_audience_group_member();

alter table approval_approver_groups enable row level security;
alter table approval_approver_groups force row level security;
drop policy if exists tenant_isolation on approval_approver_groups;
create policy tenant_isolation on approval_approver_groups
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_approver_group_members enable row level security;
alter table approval_approver_group_members force row level security;
drop policy if exists tenant_isolation on approval_approver_group_members;
create policy tenant_isolation on approval_approver_group_members
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_audience_groups enable row level security;
alter table approval_audience_groups force row level security;
drop policy if exists tenant_isolation on approval_audience_groups;
create policy tenant_isolation on approval_audience_groups
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_audience_group_members enable row level security;
alter table approval_audience_group_members force row level security;
drop policy if exists tenant_isolation on approval_audience_group_members;
create policy tenant_isolation on approval_audience_group_members
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table approval_matrices enable row level security;
alter table approval_matrices force row level security;
drop policy if exists tenant_isolation on approval_matrices;
create policy tenant_isolation on approval_matrices
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists approval_approver_groups_set_updated_at on approval_approver_groups;
create trigger approval_approver_groups_set_updated_at
before update on approval_approver_groups for each row execute function set_updated_at();
drop trigger if exists approval_approver_group_members_set_updated_at on approval_approver_group_members;
create trigger approval_approver_group_members_set_updated_at
before update on approval_approver_group_members for each row execute function set_updated_at();
drop trigger if exists approval_audience_groups_set_updated_at on approval_audience_groups;
create trigger approval_audience_groups_set_updated_at
before update on approval_audience_groups for each row execute function set_updated_at();
drop trigger if exists approval_audience_group_members_set_updated_at on approval_audience_group_members;
create trigger approval_audience_group_members_set_updated_at
before update on approval_audience_group_members for each row execute function set_updated_at();
drop trigger if exists approval_matrices_set_updated_at on approval_matrices;
create trigger approval_matrices_set_updated_at
before update on approval_matrices for each row execute function set_updated_at();

commit;
