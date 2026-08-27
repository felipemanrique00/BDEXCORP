begin;

insert into permissions (permission_key, module, description) values
  ('gerenciar_personificacoes', 'administracao', 'Iniciar e encerrar personificacao controlada de usuarios corporativos')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, 'gerenciar_personificacoes', true
from roles role_row
where role_row.role_key = 'tenant_admin'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

create table if not exists support_impersonations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_session_id uuid not null references user_sessions(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete restrict,
  actor_membership_id uuid not null references tenant_memberships(id) on delete restrict,
  target_user_id uuid not null references users(id) on delete restrict,
  target_membership_id uuid not null references tenant_memberships(id) on delete restrict,
  mode text not null check (mode in ('test', 'operate')),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  reference text check (reference is null or char_length(btrim(reference)) between 1 and 160),
  allowed_actions text[] not null default '{}',
  company_ids text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'stopped', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(btrim(end_reason)) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (actor_user_id <> target_user_id),
  check (actor_membership_id <> target_membership_id),
  check (mode = 'test' or reference is not null),
  check (cardinality(company_ids) > 0),
  check (
    allowed_actions <@ array['demand.create', 'quote.select', 'approval.decide']::text[]
    and (
      (mode = 'test' and cardinality(allowed_actions) = 0)
      or (mode = 'operate' and cardinality(allowed_actions) > 0)
    )
  ),
  check (expires_at > started_at and expires_at <= started_at + interval '15 minutes'),
  check (
    (status = 'active' and ended_at is null)
    or (status in ('stopped', 'expired') and ended_at is not null)
  )
);

create unique index if not exists support_impersonations_active_session_uidx
  on support_impersonations (actor_session_id)
  where status = 'active';

create index if not exists support_impersonations_tenant_started_idx
  on support_impersonations (tenant_id, started_at desc);

create index if not exists support_impersonations_target_idx
  on support_impersonations (tenant_id, target_user_id, started_at desc);

alter table user_sessions
  add column if not exists active_impersonation_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_sessions_tenant_id_id_key'
      and conrelid = 'user_sessions'::regclass
  ) then
    alter table user_sessions
      add constraint user_sessions_tenant_id_id_key unique (tenant_id, id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_sessions_active_impersonation_fk'
      and conrelid = 'user_sessions'::regclass
  ) then
    alter table user_sessions
      add constraint user_sessions_active_impersonation_fk
      foreign key (tenant_id, active_impersonation_id)
      references support_impersonations(tenant_id, id)
      on delete set null (active_impersonation_id);
  end if;
end;
$$;

create index if not exists user_sessions_active_impersonation_idx
  on user_sessions (active_impersonation_id)
  where active_impersonation_id is not null;

create or replace function close_impersonation_on_session_end()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'active' and new.status <> 'active' and old.active_impersonation_id is not null then
    perform set_config('app.tenant_id', old.tenant_id::text, true);
    update support_impersonations
       set status = case when new.status = 'expired' then 'expired' else 'stopped' end,
           ended_at = now(),
           end_reason = left(coalesce(new.revocation_reason, 'session_ended'), 200)
     where id = old.active_impersonation_id
       and tenant_id = old.tenant_id
       and status = 'active';

    insert into audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
    ) values (
      old.tenant_id,
      old.user_id,
      'auth.impersonation.stop',
      'support_impersonation',
      old.active_impersonation_id,
      'success',
      jsonb_build_object('reason', coalesce(new.revocation_reason, 'session_ended'))
    );
    new.active_impersonation_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists user_sessions_close_impersonation on user_sessions;
create trigger user_sessions_close_impersonation
before update of status on user_sessions
for each row execute function close_impersonation_on_session_end();

create or replace function validate_support_impersonation()
returns trigger
language plpgsql
as $$
declare
  actor_membership tenant_memberships%rowtype;
  target_membership tenant_memberships%rowtype;
  actor_role_key text;
  actor_can_impersonate boolean;
  target_role_key text;
  target_platform_admin boolean;
  target_user_status text;
  target_user_deleted_at timestamptz;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.actor_session_id is distinct from old.actor_session_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.actor_membership_id is distinct from old.actor_membership_id
    or new.target_user_id is distinct from old.target_user_id
    or new.target_membership_id is distinct from old.target_membership_id
    or new.mode is distinct from old.mode
    or new.reason is distinct from old.reason
    or new.reference is distinct from old.reference
    or new.allowed_actions is distinct from old.allowed_actions
    or new.company_ids is distinct from old.company_ids
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at
  ) then
    raise exception 'A identidade e o escopo da personificacao sao imutaveis.';
  end if;

  select * into actor_membership from tenant_memberships where id = new.actor_membership_id;
  select * into target_membership from tenant_memberships where id = new.target_membership_id;
  select role_key into actor_role_key from roles where id = actor_membership.role_id;
  select coalesce(
    case
      when actor_membership.custom_permissions ? 'gerenciar_personificacoes'
        then (actor_membership.custom_permissions->>'gerenciar_personificacoes')::boolean
      else role_permission.allowed
    end,
    false
  ) into actor_can_impersonate
  from roles actor_role
  left join role_permissions role_permission
    on role_permission.role_id = actor_role.id
   and role_permission.permission_key = 'gerenciar_personificacoes'
  where actor_role.id = actor_membership.role_id;
  select role_key into target_role_key from roles where id = target_membership.role_id;
  select platform_admin, status, deleted_at
    into target_platform_admin, target_user_status, target_user_deleted_at
    from users where id = new.target_user_id;

  if tg_op = 'INSERT' or new.status = 'active' then
    if actor_membership.id is null
       or actor_membership.tenant_id <> new.tenant_id
       or actor_membership.user_id <> new.actor_user_id
       or actor_membership.status <> 'active'
       or actor_role_key not in ('tenant_admin', 'supervisor', 'agent', 'operator')
       or not coalesce(actor_can_impersonate, false) then
      raise exception 'Ator da personificacao invalido.';
    end if;

    if target_membership.id is null
       or target_membership.tenant_id <> new.tenant_id
       or target_membership.user_id <> new.target_user_id
       or target_membership.status <> 'active'
       or target_role_key not in ('company_admin', 'requester', 'readonly')
       or coalesce(target_platform_admin, false)
       or target_user_status <> 'active'
       or target_user_deleted_at is not null then
      raise exception 'Usuario corporativo alvo invalido.';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.status = 'active') and not exists (
    select 1 from user_sessions session_row
    where session_row.id = new.actor_session_id
      and session_row.tenant_id = new.tenant_id
      and session_row.membership_id = new.actor_membership_id
      and session_row.user_id = new.actor_user_id
      and session_row.status = 'active'
  ) then
    raise exception 'Sessao do ator invalida.';
  end if;

  return new;
end;
$$;

drop trigger if exists support_impersonations_validate on support_impersonations;
create trigger support_impersonations_validate
before insert or update on support_impersonations
for each row execute function validate_support_impersonation();

alter table support_impersonations enable row level security;
alter table support_impersonations force row level security;
drop policy if exists tenant_isolation on support_impersonations;
create policy tenant_isolation on support_impersonations
  using (
    tenant_id = app_context_uuid('app.tenant_id')
    or actor_user_id = app_context_uuid('app.identity_user_id')
    or exists (
      select 1 from user_sessions session_row
      where session_row.id = actor_session_id
        and session_row.token_hash = app_context_text('app.session_token_hash')
    )
  )
  with check (
    tenant_id = app_context_uuid('app.tenant_id')
    or actor_user_id = app_context_uuid('app.identity_user_id')
    or exists (
      select 1 from user_sessions session_row
      where session_row.id = actor_session_id
        and session_row.token_hash = app_context_text('app.session_token_hash')
    )
  );

commit;
