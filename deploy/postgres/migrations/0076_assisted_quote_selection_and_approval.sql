begin;

alter table travel_quote_selections
  add column if not exists acting_for_requester_id text,
  add column if not exists acting_for_user_id uuid references users(id) on delete restrict,
  add column if not exists impersonation_id uuid,
  add column if not exists selection_source text;

update travel_quote_selections
set selection_source = 'legacy'
where selection_source is null;

alter table travel_quote_selections
  alter column selection_source set default 'requester_direct',
  alter column selection_source set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'travel_quote_selections_acting_requester_fk'
      and conrelid = 'travel_quote_selections'::regclass
  ) then
    alter table travel_quote_selections add constraint travel_quote_selections_acting_requester_fk
      foreign key (tenant_id, acting_for_requester_id)
      references requesters(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'travel_quote_selections_impersonation_fk'
      and conrelid = 'travel_quote_selections'::regclass
  ) then
    alter table travel_quote_selections add constraint travel_quote_selections_impersonation_fk
      foreign key (tenant_id, impersonation_id)
      references support_impersonations(tenant_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'travel_quote_selections_actor_context_check'
      and conrelid = 'travel_quote_selections'::regclass
  ) then
    alter table travel_quote_selections add constraint travel_quote_selections_actor_context_check check (
      (selection_source = 'requester_direct'
        and acting_for_requester_id is null and acting_for_user_id is null and impersonation_id is null)
      or
      (selection_source = 'legacy'
        and acting_for_requester_id is null and acting_for_user_id is null and impersonation_id is null)
      or
      (selection_source = 'support_assisted'
        and acting_for_requester_id is not null and acting_for_user_id is not null
        and impersonation_id is not null and chosen_by <> acting_for_user_id)
    );
  end if;
end;
$$;

create index if not exists travel_quote_selections_impersonation_idx
  on travel_quote_selections (tenant_id, impersonation_id)
  where impersonation_id is not null;

create or replace function validate_travel_quote_selection_actor_context()
returns trigger
language plpgsql
as $$
declare
  demand_company_id text;
  demand_requester_id text;
  requester_user_id uuid;
  context_row support_impersonations%rowtype;
begin
  if new.selection_source = 'legacy' then
    if tg_op = 'INSERT' then
      raise exception 'Novas escolhas nao podem usar a origem legada.';
    end if;
    return new;
  end if;

  select demand.company_id, requester.id, requester.user_id
    into demand_company_id, demand_requester_id, requester_user_id
  from demands demand
  join requesters requester
    on requester.tenant_id = demand.tenant_id
   and requester.id = demand.requester_id
   and requester.company_id = demand.company_id
   and requester.status = 'active'
   and requester.deleted_at is null
  where demand.tenant_id = new.tenant_id
    and demand.id = new.demand_id;

  if new.selection_source = 'requester_direct' then
    if requester_user_id is null or requester_user_id is distinct from new.chosen_by then
      raise exception 'Escolha direta nao corresponde ao solicitante da demanda.';
    end if;
    return new;
  end if;

  if demand_requester_id is distinct from new.acting_for_requester_id
     or requester_user_id is distinct from new.acting_for_user_id then
    raise exception 'Solicitante da escolha nao corresponde a demanda.';
  end if;

  select * into context_row from support_impersonations
  where tenant_id = new.tenant_id and id = new.impersonation_id;
  if not found
     or context_row.mode <> 'operate'
     or context_row.status <> 'active'
     or context_row.started_at > now()
     or context_row.expires_at <= now()
     or context_row.actor_user_id <> new.chosen_by
     or context_row.target_user_id <> new.acting_for_user_id
     or not ('quote.select' = any(context_row.allowed_actions))
     or not (demand_company_id = any(context_row.company_ids))
     or not exists (
       select 1 from user_sessions actor_session
       where actor_session.id = context_row.actor_session_id
         and actor_session.tenant_id = new.tenant_id
         and actor_session.user_id = new.chosen_by
         and actor_session.status = 'active'
         and actor_session.active_impersonation_id = context_row.id
     ) then
    raise exception 'Contexto de escolha assistida invalido ou fora de escopo.';
  end if;
  return new;
end;
$$;

drop trigger if exists travel_quote_selections_validate_actor_context on travel_quote_selections;
create trigger travel_quote_selections_validate_actor_context
before insert or update of demand_id, chosen_by, acting_for_requester_id, acting_for_user_id, impersonation_id, selection_source
on travel_quote_selections
for each row execute function validate_travel_quote_selection_actor_context();

alter table approval_decisions
  add column if not exists impersonation_id uuid;

update approval_decisions decision_row
set decision_source = 'delegated'
from approval_assignments assignment
where assignment.tenant_id = decision_row.tenant_id
  and assignment.id = decision_row.assignment_id
  and assignment.delegated_from_user_id is not null
  and decision_row.acting_for_user_id = assignment.delegated_from_user_id
  and decision_row.decision_source = 'human';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'approval_decisions_impersonation_fk'
      and conrelid = 'approval_decisions'::regclass
  ) then
    alter table approval_decisions add constraint approval_decisions_impersonation_fk
      foreign key (tenant_id, impersonation_id)
      references support_impersonations(tenant_id, id) on delete restrict;
  end if;
end;
$$;

alter table approval_decisions drop constraint if exists approval_decisions_source_check;
alter table approval_decisions add constraint approval_decisions_source_check check (
  decision_source in ('human', 'delegated', 'system_passive', 'support_assisted')
  and (
    (decision_source = 'human' and decided_by_user_id is not null
      and acting_for_user_id is null and impersonation_id is null)
    or (decision_source = 'delegated' and decided_by_user_id is not null
      and acting_for_user_id is not null and impersonation_id is null)
    or (decision_source = 'system_passive' and decided_by_user_id is null
      and acting_for_user_id is null and impersonation_id is null and decision = 'approved')
    or (decision_source = 'support_assisted' and decided_by_user_id is not null
      and acting_for_user_id is not null and impersonation_id is not null
      and decided_by_user_id <> acting_for_user_id)
  )
);

create index if not exists approval_decisions_impersonation_idx
  on approval_decisions (tenant_id, impersonation_id)
  where impersonation_id is not null;

create or replace function active_approval_delegation_covers_assignment(
  p_tenant_id uuid,
  p_delegation_id uuid,
  p_delegator_user_id uuid,
  p_delegate_user_id uuid,
  p_company_id text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from approval_delegations delegation
    join tenant_memberships delegator
      on delegator.tenant_id = delegation.tenant_id
     and delegator.id = delegation.delegator_membership_id
     and delegator.user_id = p_delegator_user_id
     and delegator.status = 'active'
    join tenant_memberships delegate
      on delegate.tenant_id = delegation.tenant_id
     and delegate.id = delegation.delegate_membership_id
     and delegate.user_id = p_delegate_user_id
     and delegate.status = 'active'
    where delegation.tenant_id = p_tenant_id
      and delegation.id = p_delegation_id
      and delegation.status in ('active', 'scheduled')
      and delegation.valid_from <= now()
      and delegation.valid_until > now()
      and exists (
        select 1 from approval_delegation_modules module
        where module.tenant_id = delegation.tenant_id
          and module.delegation_id = delegation.id
          and module.module_key = 'approvals'
      )
      and (
        exists (
          select 1 from approval_delegation_companies company_scope
          where company_scope.tenant_id = delegation.tenant_id
            and company_scope.delegation_id = delegation.id
            and company_scope.company_id = p_company_id
        )
        or exists (
          select 1
          from approval_delegation_groups group_scope
          join companies company
            on company.tenant_id = group_scope.tenant_id
           and company.group_id = group_scope.group_id
           and company.id = p_company_id
           and company.deleted_at is null
          where group_scope.tenant_id = delegation.tenant_id
            and group_scope.delegation_id = delegation.id
        )
      )
  );
$$;

create or replace function validate_approval_decision_consistency()
returns trigger
language plpgsql
as $$
declare
  assignment_row approval_assignments%rowtype;
  step_instance_id uuid;
  instance_company_id text;
  context_row support_impersonations%rowtype;
  actor_role_key text;
  actor_can_impersonate boolean;
begin
  select * into assignment_row from approval_assignments
  where tenant_id = new.tenant_id and id = new.assignment_id;
  if not found or assignment_row.approval_step_id <> new.approval_step_id then
    raise exception 'Decisao referencia atribuicao fora da etapa.';
  end if;

  select step.approval_instance_id, instance.company_id
    into step_instance_id, instance_company_id
  from approval_steps step
  join approval_instances instance
    on instance.tenant_id = step.tenant_id and instance.id = step.approval_instance_id
  where step.tenant_id = new.tenant_id and step.id = new.approval_step_id;
  if step_instance_id is distinct from new.approval_instance_id then
    raise exception 'Decisao referencia etapa fora da instancia.';
  end if;

  if new.decision_source = 'system_passive' then return new; end if;

  if new.decision_source = 'support_assisted' then
    if assignment_row.assignee_user_id is distinct from new.acting_for_user_id
       or assignment_row.delegated_from_user_id is not null then
      raise exception 'Alvo assistido nao corresponde ao aprovador originalmente atribuido.';
    end if;
    select * into context_row from support_impersonations
    where tenant_id = new.tenant_id and id = new.impersonation_id;
    select role_row.role_key,
           coalesce(
             case
               when membership.custom_permissions ? 'gerenciar_personificacoes'
                 then (membership.custom_permissions->>'gerenciar_personificacoes')::boolean
               else role_permission.allowed
             end,
             false
           )
      into actor_role_key, actor_can_impersonate
    from tenant_memberships membership
    join roles role_row on role_row.id = membership.role_id
    left join role_permissions role_permission
      on role_permission.role_id = role_row.id
     and role_permission.permission_key = 'gerenciar_personificacoes'
    where membership.tenant_id = new.tenant_id
      and membership.id = context_row.actor_membership_id
      and membership.user_id = new.decided_by_user_id
      and membership.status = 'active';
    if not found
       or context_row.mode <> 'operate'
       or context_row.status <> 'active'
       or context_row.started_at > now()
       or context_row.expires_at <= now()
       or context_row.actor_user_id <> new.decided_by_user_id
       or context_row.target_user_id <> new.acting_for_user_id
       or actor_role_key not in ('tenant_admin', 'supervisor', 'agent', 'operator')
       or not coalesce(actor_can_impersonate, false)
       or not ('approval.decide' = any(context_row.allowed_actions))
       or not (instance_company_id = any(context_row.company_ids))
       or not exists (
         select 1 from user_sessions actor_session
         where actor_session.id = context_row.actor_session_id
           and actor_session.tenant_id = new.tenant_id
           and actor_session.user_id = new.decided_by_user_id
           and actor_session.status = 'active'
           and actor_session.active_impersonation_id = context_row.id
       ) then
      raise exception 'Contexto de aprovacao assistida invalido ou fora de escopo.';
    end if;
    return new;
  end if;

  if assignment_row.assignee_user_id is distinct from new.decided_by_user_id then
    raise exception 'Decisor nao corresponde ao usuario da atribuicao.';
  end if;
  if new.decision_source = 'human' and assignment_row.delegated_from_user_id is not null then
    raise exception 'Atribuicao delegada exige origem de decisao delegada.';
  end if;
  if new.decision_source = 'delegated'
     and assignment_row.delegated_from_user_id is distinct from new.acting_for_user_id then
    raise exception 'Identidade representada nao corresponde a delegacao da atribuicao.';
  end if;
  if new.decision_source = 'delegated'
     and (
       assignment_row.source_reference is null
       or assignment_row.source_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not active_approval_delegation_covers_assignment(
         new.tenant_id,
         assignment_row.source_reference::uuid,
         new.acting_for_user_id,
         new.decided_by_user_id,
         instance_company_id
       )
     ) then
    raise exception 'Delegacao da atribuicao expirou, foi revogada ou perdeu o escopo.';
  end if;
  return new;
end;
$$;

drop trigger if exists approval_decisions_validate_consistency on approval_decisions;
create trigger approval_decisions_validate_consistency
before insert or update on approval_decisions
for each row execute function validate_approval_decision_consistency();

commit;
