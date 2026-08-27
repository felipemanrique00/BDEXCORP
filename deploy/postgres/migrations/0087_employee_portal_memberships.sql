begin;

do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = current_user
      and (rolsuper or rolbypassrls)
  ) then
    raise exception
      '0087 exige uma role administrativa com SUPERUSER ou BYPASSRLS.'
      using hint = 'O backfill e os preflights atravessam tenants protegidos por FORCE RLS. Configure MIGRATION_DATABASE_URL com uma role de migracao dedicada e repita.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_invites_tenant_id_id_membership_id_key'
      and conrelid = 'user_invites'::regclass
  ) then
    alter table user_invites
      add constraint user_invites_tenant_id_id_membership_id_key
      unique (tenant_id, id, membership_id);
  end if;
end;
$$;

create index if not exists employees_active_company_email_idx
  on employees (tenant_id, company_id, email)
  where status = 'active' and deleted_at is null and email is not null;
create index if not exists user_invites_pending_membership_idx
  on user_invites (tenant_id, membership_id, expires_at desc)
  where accepted_at is null;

create table if not exists employee_portal_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  employee_id text not null,
  membership_id uuid not null,
  invite_id uuid,
  email_snapshot citext not null,
  status text not null check (status in ('pending', 'active', 'revoked')),
  approval_enabled boolean not null default false,
  invitation_state text not null default 'not_required'
    check (invitation_state in ('not_required', 'sent', 'delivery_pending')),
  created_by_membership_id uuid,
  activated_by_membership_id uuid,
  revoked_by_user_id uuid references users(id) on delete set null,
  activated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, employee_id)
    references employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, membership_id)
    references tenant_memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, invite_id, membership_id)
    references user_invites(tenant_id, id, membership_id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete set null (created_by_membership_id),
  foreign key (tenant_id, activated_by_membership_id)
    references tenant_memberships(tenant_id, id) on delete set null (activated_by_membership_id),
  check (
    (status = 'pending' and invite_id is not null and activated_at is null and revoked_at is null
      and invitation_state in ('sent', 'delivery_pending'))
    or (status = 'active' and activated_at is not null and revoked_at is null
      and invitation_state = 'not_required')
    or (status = 'revoked' and revoked_at is not null and invitation_state = 'not_required')
  ),
  check ((status = 'revoked') = (revoke_reason is not null))
);

create unique index if not exists employee_portal_memberships_current_employee_uidx
  on employee_portal_memberships (tenant_id, company_id, employee_id)
  where status <> 'revoked';
create unique index if not exists employee_portal_memberships_current_membership_uidx
  on employee_portal_memberships (tenant_id, company_id, membership_id)
  where status <> 'revoked';
create index if not exists employee_portal_memberships_membership_idx
  on employee_portal_memberships (tenant_id, membership_id, status, company_id);
create index if not exists employee_portal_memberships_employee_history_idx
  on employee_portal_memberships (tenant_id, company_id, employee_id, created_at desc);
create index if not exists employee_portal_memberships_invite_idx
  on employee_portal_memberships (tenant_id, invite_id)
  where invite_id is not null;

create or replace function validate_employee_portal_membership()
returns trigger
language plpgsql
as $$
declare
  employee_status text;
  employee_deleted_at timestamptz;
  employee_email citext;
  company_status text;
  company_deleted_at timestamptz;
  portal_enabled boolean;
  membership_status text;
  user_status text;
  user_deleted_at timestamptz;
  user_email citext;
  user_platform_admin boolean;
  membership_role text;
begin
  if new.status = 'revoked' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.approval_enabled = true
     and new.approval_enabled = false
     and old.tenant_id = new.tenant_id
     and old.company_id = new.company_id
     and old.employee_id = new.employee_id
     and old.membership_id = new.membership_id
     and old.email_snapshot = new.email_snapshot then
    return new;
  end if;

  select employee.status, employee.deleted_at, employee.email
    into employee_status, employee_deleted_at, employee_email
  from employees employee
  where employee.tenant_id = new.tenant_id
    and employee.id = new.employee_id
    and employee.company_id = new.company_id;

  select company.status, company.deleted_at, company.company_portal_enabled
    into company_status, company_deleted_at, portal_enabled
  from companies company
  where company.tenant_id = new.tenant_id and company.id = new.company_id;

  select membership.status, user_row.status, user_row.deleted_at, user_row.email,
         user_row.platform_admin, role_row.role_key
    into membership_status, user_status, user_deleted_at, user_email,
         user_platform_admin, membership_role
  from tenant_memberships membership
  join users user_row on user_row.id = membership.user_id
  join roles role_row on role_row.id = membership.role_id
  where membership.tenant_id = new.tenant_id and membership.id = new.membership_id;

  if employee_status is distinct from 'active' or employee_deleted_at is not null then
    raise exception 'Funcionario precisa estar ativo para possuir acesso ao portal.';
  end if;
  if company_status is distinct from 'active' or company_deleted_at is not null or not coalesce(portal_enabled, false) then
    raise exception 'Portal da empresa precisa estar ativo para vincular o autorizador.';
  end if;
  if employee_email is null or user_email is null or lower(employee_email::text) <> lower(new.email_snapshot::text)
     or lower(user_email::text) <> lower(new.email_snapshot::text) then
    raise exception 'E-mail do funcionario diverge da identidade confirmada.';
  end if;
  if exists (
    select 1 from employees duplicate_employee
    where duplicate_employee.tenant_id = new.tenant_id
      and duplicate_employee.company_id = new.company_id
      and duplicate_employee.id <> new.employee_id
      and duplicate_employee.status = 'active'
      and duplicate_employee.deleted_at is null
      and duplicate_employee.email is not null
      and lower(duplicate_employee.email::text) = lower(new.email_snapshot::text)
  ) then
    raise exception 'E-mail duplicado entre funcionarios ativos da mesma empresa.';
  end if;
  if coalesce(user_platform_admin, false)
     or membership_role in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator') then
    raise exception 'Conta interna da agencia nao pode ser vinculada como funcionario autorizador.';
  end if;
  if user_deleted_at is not null then
    raise exception 'Identidade do autorizador foi excluida.';
  end if;

  if new.status = 'active' then
    if membership_status is distinct from 'active' or user_status is distinct from 'active' then
      raise exception 'Vinculo ativo exige usuario e membership ativos.';
    end if;
  elsif new.status = 'pending' then
    if membership_status is distinct from 'invited' or user_status is distinct from 'invited' then
      raise exception 'Vinculo pendente exige usuario e membership convidados.';
    end if;
    if not exists (
      select 1 from user_invites invite
      where invite.tenant_id = new.tenant_id
        and invite.id = new.invite_id
        and invite.membership_id = new.membership_id
        and invite.accepted_at is null
        and invite.expires_at > now()
    ) then
      raise exception 'Vinculo pendente exige convite valido para o mesmo membership.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_portal_memberships_validate on employee_portal_memberships;
create trigger employee_portal_memberships_validate
before insert or update of company_id, employee_id, membership_id, invite_id, email_snapshot, status, approval_enabled
on employee_portal_memberships
for each row execute function validate_employee_portal_membership();

with employee_requester_identity as (
  select requester.tenant_id, requester.company_id, requester.employee_id,
         min(membership.id::text)::uuid as membership_id,
         min(user_row.email::text)::citext as email_snapshot
  from requesters requester
  join employees employee
    on employee.tenant_id = requester.tenant_id
   and employee.id = requester.employee_id
   and employee.company_id = requester.company_id
   and employee.status = 'active'
   and employee.deleted_at is null
  join companies company
    on company.tenant_id = employee.tenant_id
   and company.id = employee.company_id
   and company.status = 'active'
   and company.deleted_at is null
   and company.company_portal_enabled = true
  join tenant_memberships membership
    on membership.tenant_id = requester.tenant_id
   and membership.user_id = requester.user_id
   and membership.status = 'active'
  join users user_row
    on user_row.id = membership.user_id
   and user_row.status = 'active'
   and user_row.deleted_at is null
   and not user_row.platform_admin
  join roles role_row
    on role_row.id = membership.role_id
   and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
  where requester.employee_id is not null
    and requester.user_id is not null
    and requester.status = 'active'
    and requester.deleted_at is null
    and employee.email is not null
    and lower(employee.email::text) = lower(user_row.email::text)
  group by requester.tenant_id, requester.company_id, requester.employee_id
  having count(distinct requester.user_id) = 1
), safe_identity as (
  select identity.*
  from employee_requester_identity identity
  where not exists (
    select 1
    from employee_requester_identity conflicting
    where conflicting.tenant_id = identity.tenant_id
      and conflicting.company_id = identity.company_id
      and conflicting.membership_id = identity.membership_id
      and conflicting.employee_id <> identity.employee_id
  )
    and not exists (
      select 1
      from employees duplicate_employee
      join employees canonical_employee
        on canonical_employee.tenant_id = identity.tenant_id
       and canonical_employee.company_id = identity.company_id
       and canonical_employee.id = identity.employee_id
      where duplicate_employee.tenant_id = identity.tenant_id
        and duplicate_employee.company_id = identity.company_id
        and duplicate_employee.id <> identity.employee_id
        and duplicate_employee.status = 'active'
        and duplicate_employee.deleted_at is null
        and duplicate_employee.email is not null
        and canonical_employee.email is not null
        and lower(duplicate_employee.email::text) = lower(canonical_employee.email::text)
    )
)
insert into employee_portal_memberships (
  tenant_id, company_id, employee_id, membership_id, email_snapshot,
  status, approval_enabled, activated_by_membership_id, activated_at
)
select tenant_id, company_id, employee_id, membership_id, email_snapshot,
       'active', (
         exists (
           select 1 from corporate_company_access_grants company_grant
           where company_grant.tenant_id = safe_identity.tenant_id
             and company_grant.membership_id = safe_identity.membership_id
             and company_grant.company_id = safe_identity.company_id
             and company_grant.status = 'active'
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
            and company.id = safe_identity.company_id
            and company.group_id = group_grant.business_group_id
           where group_grant.tenant_id = safe_identity.tenant_id
             and group_grant.membership_id = safe_identity.membership_id
             and group_grant.status = 'active'
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
                   and selected.company_id = safe_identity.company_id
               )
             )
         )
       ),
       membership_id, now()
from safe_identity
on conflict do nothing;

do $$
declare
  unsafe_pending_assignments bigint;
begin
  select count(*)
    into unsafe_pending_assignments
  from approval_assignments assignment
  join approval_steps step
    on step.tenant_id = assignment.tenant_id
   and step.id = assignment.approval_step_id
  join approval_instances instance
    on instance.tenant_id = step.tenant_id
   and instance.id = step.approval_instance_id
  join tenant_memberships membership
    on membership.tenant_id = assignment.tenant_id
   and membership.user_id = assignment.assignee_user_id
  join users assigned_user on assigned_user.id = membership.user_id
  join roles assigned_role on assigned_role.id = membership.role_id
  where assignment.status = 'pending'
    and step.status = 'pending'
    and instance.status in ('pending', 'in_progress')
    and not assigned_user.platform_admin
    and assigned_role.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
    and not exists (
      select 1
      from employee_portal_memberships safe_link
      where safe_link.tenant_id = assignment.tenant_id
        and safe_link.membership_id = membership.id
        and safe_link.company_id = instance.company_id
        and safe_link.status = 'active'
        and safe_link.approval_enabled = true
    );

  if unsafe_pending_assignments > 0 then
    raise exception
      '0087 bloqueada: % atribuicao(oes) pendente(s) perderiam um autorizador verificavel.',
      unsafe_pending_assignments
      using hint = 'Vincule cada aprovador pendente a um funcionario ativo da empresa, ou reatribua/cancele a aprovacao antes de reaplicar a migration.';
  end if;
end;
$$;

do $preflight$
declare
  unsafe_configuration_count bigint;
  unsafe_configuration_sample text;
begin
  with corporate_identity as (
    select membership.tenant_id, membership.id as membership_id, membership.user_id
    from tenant_memberships membership
    join users user_row
      on user_row.id = membership.user_id
     and user_row.status = 'active'
     and user_row.deleted_at is null
     and not user_row.platform_admin
    join roles role_row
      on role_row.id = membership.role_id
     and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
    where membership.status = 'active'
  ), unsafe_scope as (
    select identity.tenant_id, identity.membership_id, identity.user_id,
           company.id as company_id, company.group_id
    from corporate_identity identity
    join corporate_company_access_grants company_grant
      on company_grant.tenant_id = identity.tenant_id
     and company_grant.membership_id = identity.membership_id
     and company_grant.status = 'active'
     and (company_grant.valid_until is null or company_grant.valid_until > now())
     and corporate_approval_grant_can_decide(
       company_grant.corporate_profile,
       company_grant.permission_overrides
     )
    join companies company
      on company.tenant_id = company_grant.tenant_id
     and company.id = company_grant.company_id
     and company.status = 'active'
     and company.deleted_at is null
    where not exists (
      select 1 from employee_portal_memberships safe_link
      where safe_link.tenant_id = identity.tenant_id
        and safe_link.membership_id = identity.membership_id
        and safe_link.company_id = company.id
        and safe_link.status = 'active'
        and safe_link.approval_enabled = true
    )
    union
    select identity.tenant_id, identity.membership_id, identity.user_id,
           company.id as company_id, company.group_id
    from corporate_identity identity
    join corporate_group_access_grants group_grant
      on group_grant.tenant_id = identity.tenant_id
     and group_grant.membership_id = identity.membership_id
     and group_grant.status = 'active'
     and (group_grant.valid_until is null or group_grant.valid_until > now())
     and corporate_approval_grant_can_decide(
       group_grant.corporate_profile,
       group_grant.permission_overrides
     )
    join companies company
      on company.tenant_id = group_grant.tenant_id
     and company.group_id = group_grant.business_group_id
     and company.status = 'active'
     and company.deleted_at is null
     and (
       group_grant.access_mode = 'all_companies'
       or exists (
         select 1 from corporate_group_access_companies selected
         where selected.tenant_id = group_grant.tenant_id
           and selected.group_access_grant_id = group_grant.id
           and selected.company_id = company.id
       )
     )
    where not exists (
      select 1 from employee_portal_memberships safe_link
      where safe_link.tenant_id = identity.tenant_id
        and safe_link.membership_id = identity.membership_id
        and safe_link.company_id = company.id
        and safe_link.status = 'active'
        and safe_link.approval_enabled = true
    )
  ), applicable_version_candidates as (
    select unsafe_scope.tenant_id, unsafe_scope.membership_id, unsafe_scope.user_id,
           unsafe_scope.company_id, unsafe_scope.group_id,
           version.id as workflow_version_id,
           version.workflow_definition_id,
           version.version_number,
           row_number() over (
             partition by unsafe_scope.tenant_id, version.workflow_definition_id,
                          unsafe_scope.company_id, unsafe_scope.user_id
             order by version.version_number desc, version.id desc
           ) as resolution_rank
    from unsafe_scope
    join approval_workflow_versions version
      on version.tenant_id = unsafe_scope.tenant_id
     and version.status = 'published'
     and (version.valid_from is null or version.valid_from <= now())
     and (version.valid_until is null or version.valid_until > now())
    where coalesce((
      select max(scope.specificity)
      from approval_workflow_scopes scope
      where scope.tenant_id = version.tenant_id
        and scope.workflow_version_id = version.id
        and scope.mode = 'include'
        and (
          scope.scope_type = 'tenant'
          or (scope.scope_type = 'company' and scope.scope_id = unsafe_scope.company_id)
          or (scope.scope_type = 'group' and scope.scope_id = unsafe_scope.group_id)
        )
    ), -1) > coalesce((
      select max(scope.specificity)
      from approval_workflow_scopes scope
      where scope.tenant_id = version.tenant_id
        and scope.workflow_version_id = version.id
        and scope.mode = 'exclude'
        and (
          scope.scope_type = 'tenant'
          or (scope.scope_type = 'company' and scope.scope_id = unsafe_scope.company_id)
          or (scope.scope_type = 'group' and scope.scope_id = unsafe_scope.group_id)
        )
    ), -1)
  ), blocker as (
    select 'authority'::text as risk_type, unsafe_scope.tenant_id,
           unsafe_scope.membership_id, unsafe_scope.company_id,
           authority.id::text as object_id
    from unsafe_scope
    join approval_authorities authority
      on authority.tenant_id = unsafe_scope.tenant_id
     and authority.membership_id = unsafe_scope.membership_id
     and authority.status in ('active', 'scheduled', 'approved')
     and (authority.valid_until is null or authority.valid_until > now())
     and (
       authority.company_id = unsafe_scope.company_id
       or authority.group_id = unsafe_scope.group_id
       or (authority.company_id is null and authority.group_id is null)
     )
    union all
    select 'approver_group'::text, unsafe_scope.tenant_id,
           unsafe_scope.membership_id, unsafe_scope.company_id,
           approver_group.id::text
    from unsafe_scope
    join approval_approver_group_members group_member
      on group_member.tenant_id = unsafe_scope.tenant_id
     and group_member.membership_id = unsafe_scope.membership_id
     and group_member.status = 'active'
    join approval_approver_groups approver_group
      on approver_group.tenant_id = group_member.tenant_id
     and approver_group.id = group_member.approver_group_id
     and approver_group.status = 'active'
     and (
       approver_group.company_id = unsafe_scope.company_id
       or approver_group.business_group_id = unsafe_scope.group_id
     )
    union all
    select 'delegation'::text, unsafe_scope.tenant_id,
           unsafe_scope.membership_id, unsafe_scope.company_id,
           delegation.id::text
    from unsafe_scope
    join approval_delegations delegation
      on delegation.tenant_id = unsafe_scope.tenant_id
     and unsafe_scope.membership_id in (
       delegation.delegator_membership_id,
       delegation.delegate_membership_id
     )
     and delegation.status in ('active', 'scheduled')
     and delegation.valid_until > now()
    where exists (
      select 1 from approval_delegation_modules delegation_module
      where delegation_module.tenant_id = delegation.tenant_id
        and delegation_module.delegation_id = delegation.id
        and delegation_module.module_key = 'approvals'
    ) and (
      exists (
        select 1 from approval_delegation_companies company_scope
        where company_scope.tenant_id = delegation.tenant_id
          and company_scope.delegation_id = delegation.id
          and company_scope.company_id = unsafe_scope.company_id
      )
      or exists (
        select 1 from approval_delegation_groups group_scope
        where group_scope.tenant_id = delegation.tenant_id
          and group_scope.delegation_id = delegation.id
          and group_scope.group_id = unsafe_scope.group_id
      )
    )
    union all
    select 'person_selector'::text, candidate.tenant_id,
           candidate.membership_id, candidate.company_id,
           concat(candidate.workflow_version_id::text, ':', node.id::text)
    from applicable_version_candidates candidate
    join approval_nodes node
      on node.tenant_id = candidate.tenant_id
     and node.workflow_version_id = candidate.workflow_version_id
     and node.node_type = 'approval'
    cross join lateral jsonb_array_elements(
      coalesce(node.approver_resolution->'selectors', '[]'::jsonb)
      || coalesce(node.approver_resolution->'fallbackSelectors', '[]'::jsonb)
    ) selector
    where candidate.resolution_rank = 1
      and selector->>'type' = 'person'
      and (
        (jsonb_typeof(selector->'value') = 'string'
          and selector->>'value' = candidate.user_id::text)
        or (jsonb_typeof(selector->'value') = 'array'
          and (selector->'value') ? candidate.user_id::text)
      )
  ), distinct_blocker as (
    select distinct risk_type, tenant_id, membership_id, company_id, object_id
    from blocker
  )
  select count(*)::bigint,
         array_to_string((array_agg(
           concat(risk_type, ':', object_id, '@', company_id)
           order by risk_type, object_id, company_id
         ))[1:12], ', ')
    into unsafe_configuration_count, unsafe_configuration_sample
  from distinct_blocker;

  if unsafe_configuration_count > 0 then
    raise exception
      '0087 bloqueada: % configuracao(oes) de aprovacao perderiam autorizadores verificaveis.',
      unsafe_configuration_count
      using hint = concat(
        'Amostra: ', coalesce(unsafe_configuration_sample, 'indisponivel'),
        '. Vincule os memberships a funcionarios ativos em cada empresa coberta, ',
        'ou arquive/reconfigure alcadas, grupos, delegacoes e seletores antes de reaplicar a migration.'
      );
  end if;
end;
$preflight$;

do $$
declare
  finite_decision_grants bigint;
begin
  select count(*)::bigint
    into finite_decision_grants
  from employee_portal_memberships link
  where link.status = 'active'
    and link.approval_enabled = true
    and (
      exists (
        select 1 from corporate_company_access_grants company_grant
        where company_grant.tenant_id = link.tenant_id
          and company_grant.membership_id = link.membership_id
          and company_grant.company_id = link.company_id
          and company_grant.status = 'active'
          and company_grant.valid_until is not null
          and company_grant.valid_until > now()
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
         and company.id = link.company_id
         and company.group_id = group_grant.business_group_id
        where group_grant.tenant_id = link.tenant_id
          and group_grant.membership_id = link.membership_id
          and group_grant.status = 'active'
          and group_grant.valid_until is not null
          and group_grant.valid_until > now()
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
                and selected.company_id = link.company_id
            )
          )
      )
    )
    and not (
      exists (
        select 1 from corporate_company_access_grants company_grant
        where company_grant.tenant_id = link.tenant_id
          and company_grant.membership_id = link.membership_id
          and company_grant.company_id = link.company_id
          and company_grant.status = 'active'
          and company_grant.valid_until is null
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
         and company.id = link.company_id
         and company.group_id = group_grant.business_group_id
        where group_grant.tenant_id = link.tenant_id
          and group_grant.membership_id = link.membership_id
          and group_grant.status = 'active'
          and group_grant.valid_until is null
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
                and selected.company_id = link.company_id
            )
          )
      )
    );
  if finite_decision_grants > 0 then
    raise exception
      '0087 bloqueada: % vinculo(s) de autorizador dependem de grant decisorio com expiracao futura.',
      finite_decision_grants
      using hint = 'Remova a expiracao do grant e use a desatribuicao dedicada, que bloqueia enquanto houver aprovacoes pendentes.';
  end if;
end;
$$;

with linked_group_company as (
  select distinct group_grant.tenant_id, group_grant.membership_id,
         company.id as company_id, group_grant.valid_from,
         group_grant.created_by_membership_id
  from corporate_group_access_grants group_grant
  join companies company
    on company.tenant_id = group_grant.tenant_id
   and company.group_id = group_grant.business_group_id
   and company.status = 'active'
   and company.deleted_at is null
   and (
     group_grant.access_mode = 'all_companies'
     or exists (
       select 1 from corporate_group_access_companies selected
       where selected.tenant_id = group_grant.tenant_id
         and selected.group_access_grant_id = group_grant.id
         and selected.company_id = company.id
     )
   )
  where group_grant.status = 'active'
    and (group_grant.valid_until is null or group_grant.valid_until > now())
    and corporate_approval_grant_can_decide(
      group_grant.corporate_profile,
      group_grant.permission_overrides
    )
    and exists (
      select 1 from employee_portal_memberships linked_company
      where linked_company.tenant_id = group_grant.tenant_id
        and linked_company.membership_id = group_grant.membership_id
        and linked_company.company_id = company.id
        and linked_company.status = 'active'
        and linked_company.approval_enabled = true
    )
)
insert into corporate_company_access_grants (
  tenant_id, membership_id, company_id, corporate_profile,
  permission_overrides, status, valid_from, valid_until,
  created_by_membership_id
)
select tenant_id, membership_id, company_id, 'approver',
       '{"ver_aprovacoes": true, "decidir_aprovacoes": true}'::jsonb,
       'active', valid_from, null, created_by_membership_id
from linked_group_company
on conflict (tenant_id, membership_id, company_id) where status <> 'revoked'
do update set
  status = 'active',
  valid_from = least(corporate_company_access_grants.valid_from, excluded.valid_from),
  valid_until = null,
  permission_overrides = corporate_company_access_grants.permission_overrides
    || '{"ver_aprovacoes": true, "decidir_aprovacoes": true}'::jsonb,
  updated_at = now();

update corporate_group_access_grants group_grant
set permission_overrides = group_grant.permission_overrides
      || '{"decidir_aprovacoes": false}'::jsonb,
    updated_at = now()
where group_grant.status <> 'revoked'
  and corporate_approval_grant_can_decide(
    group_grant.corporate_profile,
    group_grant.permission_overrides
  );

update corporate_company_access_grants company_grant
set permission_overrides = company_grant.permission_overrides
      || '{"decidir_aprovacoes": false}'::jsonb,
    updated_at = now()
where company_grant.status <> 'revoked'
  and corporate_approval_grant_can_decide(
    company_grant.corporate_profile,
    company_grant.permission_overrides
  )
  and not exists (
    select 1 from employee_portal_memberships safe_link
    where safe_link.tenant_id = company_grant.tenant_id
      and safe_link.membership_id = company_grant.membership_id
      and safe_link.company_id = company_grant.company_id
      and safe_link.status = 'active'
      and safe_link.approval_enabled = true
  );

create or replace function employee_portal_membership_allows_company(
  tenant_value uuid,
  membership_value uuid,
  company_value text
)
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1
      from tenant_memberships internal_membership
      join users internal_user on internal_user.id = internal_membership.user_id
      join roles internal_role on internal_role.id = internal_membership.role_id
      where internal_membership.tenant_id = tenant_value
        and internal_membership.id = membership_value
        and internal_membership.status = 'active'
        and internal_user.status = 'active'
        and internal_user.deleted_at is null
        and (
          internal_user.platform_admin
          or internal_role.role_key in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
        )
    )
    or not exists (
      select 1
      from employee_portal_memberships managed_link
      where managed_link.tenant_id = tenant_value
        and managed_link.membership_id = membership_value
        and managed_link.company_id = company_value
    )
    or exists (
      select 1
      from employee_portal_memberships active_link
      join employees employee
        on employee.tenant_id = active_link.tenant_id
       and employee.id = active_link.employee_id
       and employee.company_id = active_link.company_id
       and employee.status = 'active'
       and employee.deleted_at is null
       and employee.email is not null
       and lower(employee.email::text) = lower(active_link.email_snapshot::text)
      join tenant_memberships membership
        on membership.tenant_id = active_link.tenant_id
       and membership.id = active_link.membership_id
       and membership.status = 'active'
      join users user_row
        on user_row.id = membership.user_id
       and user_row.status = 'active'
       and user_row.deleted_at is null
       and not user_row.platform_admin
       and lower(user_row.email::text) = lower(active_link.email_snapshot::text)
      join roles role_row
        on role_row.id = membership.role_id
       and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
       and not exists (
         select 1 from employees duplicate_employee
         where duplicate_employee.tenant_id = active_link.tenant_id
           and duplicate_employee.company_id = active_link.company_id
           and duplicate_employee.id <> active_link.employee_id
           and duplicate_employee.status = 'active'
           and duplicate_employee.deleted_at is null
           and duplicate_employee.email is not null
           and lower(duplicate_employee.email::text) = lower(active_link.email_snapshot::text)
       )
      where active_link.tenant_id = tenant_value
        and active_link.membership_id = membership_value
        and active_link.company_id = company_value
        and active_link.status = 'active'
    );
$$;

create or replace function employee_authorizer_can_decide_for_company(
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
    from tenant_memberships internal_membership
    join users internal_user on internal_user.id = internal_membership.user_id
    join roles internal_role on internal_role.id = internal_membership.role_id
    where internal_membership.tenant_id = tenant_value
      and internal_membership.id = membership_value
      and internal_membership.status = 'active'
      and internal_user.status = 'active'
      and internal_user.deleted_at is null
      and (
        internal_user.platform_admin
        or internal_role.role_key in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
      )
  ) or (
    employee_portal_membership_allows_company(
      tenant_value,
      membership_value,
      company_value
    ) and exists (
      select 1 from employee_portal_memberships active_authorizer
      where active_authorizer.tenant_id = tenant_value
        and active_authorizer.membership_id = membership_value
        and active_authorizer.company_id = company_value
        and active_authorizer.status = 'active'
        and active_authorizer.approval_enabled = true
    )
  );
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
      and employee_authorizer_can_decide_for_company(tenant_value, membership_value, company_value)
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
    where membership.tenant_id = tenant_value
      and membership.id = membership_value
      and membership.status = 'active'
      and user_row.status = 'active'
      and user_row.deleted_at is null
      and not user_row.platform_admin
      and role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')
      and exists (
        select 1 from companies covered_company
        where covered_company.tenant_id = tenant_value
          and covered_company.group_id = group_value
          and covered_company.status = 'active'
          and covered_company.deleted_at is null
          and covered_company.company_portal_enabled = true
      )
      and not exists (
        select 1
        from companies group_company
        where group_company.tenant_id = tenant_value
          and group_company.group_id = group_value
          and group_company.status = 'active'
          and group_company.deleted_at is null
          and group_company.company_portal_enabled = true
          and not corporate_user_can_decide_for_company(
            tenant_value,
            membership_value,
            group_company.id
          )
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
      and employee_portal_membership_allows_company(tenant_value, membership_value, company_value)
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

alter table employee_portal_memberships enable row level security;
alter table employee_portal_memberships force row level security;
drop policy if exists tenant_isolation on employee_portal_memberships;
create policy tenant_isolation on employee_portal_memberships
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists employee_portal_memberships_set_updated_at on employee_portal_memberships;
create trigger employee_portal_memberships_set_updated_at
before update on employee_portal_memberships
for each row execute function set_updated_at();

commit;
