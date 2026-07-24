alter table approval_authorities
  add column if not exists accumulated_amount_limit numeric(18,2),
  add column if not exists accumulation_period_days integer,
  add column if not exists max_percentage_above_lowest numeric(12,4),
  add column if not exists max_percentage_above_average numeric(12,4),
  add column if not exists requires_budget_available boolean not null default false,
  add column if not exists urgent_allowed boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_authorities_advanced_limits_check'
      and conrelid = 'approval_authorities'::regclass
  ) then
    alter table approval_authorities add constraint approval_authorities_advanced_limits_check check (
      (accumulated_amount_limit is null or accumulated_amount_limit >= 0)
      and (accumulation_period_days is null or accumulation_period_days between 1 and 366)
      and ((accumulated_amount_limit is null) = (accumulation_period_days is null))
      and (max_percentage_above_lowest is null or max_percentage_above_lowest >= 0)
      and (max_percentage_above_average is null or max_percentage_above_average >= 0)
    );
  end if;
end;
$$;

drop index if exists approval_authorities_current_uidx;
create unique index approval_authorities_current_uidx
  on approval_authorities (
    tenant_id, membership_id, approval_kind,
    coalesce(company_id, ''), coalesce(group_id, ''),
    coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(currency, ''), coalesce(max_amount, -1),
    coalesce(accumulated_amount_limit, -1), coalesce(accumulation_period_days, -1),
    coalesce(max_percentage_above_lowest, -1), coalesce(max_percentage_above_average, -1),
    requires_budget_available, urgent_allowed, products, destinations, risk_levels
  ) where status in ('scheduled', 'active');

create or replace function approval_sla_reminders_valid(reminders integer[], duration integer)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(value > 0 and value < duration), true)
  from unnest(reminders) as value;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_slas_runtime_configuration_check'
      and conrelid = 'approval_slas'::regclass
  ) then
    alter table approval_slas add constraint approval_slas_runtime_configuration_check check (
      (not business_time_only or calendar_id is not null)
      and approval_sla_reminders_valid(reminder_minutes, duration_minutes)
      and (
        expiration_action <> 'passive_approve'
        or length(trim(passive_approval_justification)) >= 10
      )
    );
  end if;
end;
$$;

alter table approval_escalations
  add column if not exists configuration jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_escalations_configuration_check'
      and conrelid = 'approval_escalations'::regclass
  ) then
    alter table approval_escalations add constraint approval_escalations_configuration_check
      check (jsonb_typeof(configuration) = 'object');
  end if;
end;
$$;

create unique index if not exists approval_escalations_schedule_uidx
  on approval_escalations (
    tenant_id, approval_step_id, escalation_type, scheduled_at,
    coalesce(target_user_id::text, ''), coalesce(target_role_key, '')
  ) where status in ('scheduled', 'executed');

create table if not exists approval_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipient_user_id uuid not null,
  approval_instance_id uuid not null,
  approval_step_id uuid,
  source_escalation_id uuid,
  notification_type text not null check (notification_type in ('assignment', 'reminder', 'escalation', 'expiration', 'decision')),
  title text not null check (length(trim(title)) between 3 and 240),
  message text not null check (length(trim(message)) between 3 and 2000),
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, recipient_user_id) references tenant_memberships(tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, approval_instance_id) references approval_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, approval_step_id) references approval_steps(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_escalation_id) references approval_escalations(tenant_id, id) on delete cascade,
  check ((status = 'unread' and read_at is null) or (status in ('read', 'dismissed') and read_at is not null))
);

create unique index if not exists approval_notifications_escalation_recipient_uidx
  on approval_notifications (tenant_id, source_escalation_id, recipient_user_id)
  where source_escalation_id is not null;

create index if not exists approval_notifications_recipient_idx
  on approval_notifications (tenant_id, recipient_user_id, status, created_at desc);

alter table approval_notifications enable row level security;
alter table approval_notifications force row level security;
drop policy if exists tenant_isolation on approval_notifications;
create policy tenant_isolation on approval_notifications
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists approval_notifications_set_updated_at on approval_notifications;
create trigger approval_notifications_set_updated_at
before update on approval_notifications
for each row execute function set_updated_at();

alter table approval_decisions
  add column if not exists decision_source text not null default 'human';

alter table approval_decisions alter column decided_by_user_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_decisions_source_check'
      and conrelid = 'approval_decisions'::regclass
  ) then
    alter table approval_decisions add constraint approval_decisions_source_check check (
      decision_source in ('human', 'delegated', 'system_passive')
      and (
        (decision_source in ('human', 'delegated') and decided_by_user_id is not null)
        or (decision_source = 'system_passive' and decided_by_user_id is null and acting_for_user_id is null and decision = 'approved')
      )
    );
  end if;
end;
$$;

create or replace function validate_approval_decision_consistency()
returns trigger
language plpgsql
as $$
declare
  assignment_row approval_assignments%rowtype;
  step_instance_id uuid;
begin
  select * into assignment_row
  from approval_assignments
  where tenant_id = new.tenant_id and id = new.assignment_id;

  if not found or assignment_row.approval_step_id <> new.approval_step_id then
    raise exception 'Decisao referencia atribuicao fora da etapa.';
  end if;

  select approval_instance_id into step_instance_id
  from approval_steps
  where tenant_id = new.tenant_id and id = new.approval_step_id;

  if step_instance_id is distinct from new.approval_instance_id then
    raise exception 'Decisao referencia etapa fora da instancia.';
  end if;

  if new.decision_source = 'system_passive' then
    if new.decided_by_user_id is not null or new.acting_for_user_id is not null or new.decision <> 'approved' then
      raise exception 'Aprovacao passiva possui identidade ou decisao inconsistente.';
    end if;
    return new;
  end if;

  if assignment_row.assignee_user_id is distinct from new.decided_by_user_id then
    raise exception 'Decisor nao corresponde ao usuario da atribuicao.';
  end if;

  if assignment_row.delegated_from_user_id is null and new.acting_for_user_id is not null then
    raise exception 'Decisao sem delegacao nao pode agir em nome de outro usuario.';
  end if;

  if assignment_row.delegated_from_user_id is not null
     and assignment_row.delegated_from_user_id is distinct from new.acting_for_user_id then
    raise exception 'Identidade representada nao corresponde a delegacao da atribuicao.';
  end if;

  return new;
end;
$$;

drop trigger if exists approval_decisions_validate_consistency on approval_decisions;
create trigger approval_decisions_validate_consistency
before insert or update on approval_decisions
for each row execute function validate_approval_decision_consistency();
