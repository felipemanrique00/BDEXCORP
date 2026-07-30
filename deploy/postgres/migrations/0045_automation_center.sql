begin;

create table if not exists automation_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_code text not null,
  name text not null,
  description text not null,
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'approved', 'published', 'suspended', 'archived'
  )),
  current_version integer not null default 1 check (current_version > 0),
  published_version integer check (published_version is null or published_version > 0),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, automation_code)
);

create table if not exists automation_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_definition_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'approved', 'published', 'suspended', 'archived'
  )),
  event_type text not null check (
    event_type ~ '^[a-z][a-z0-9_.-]{2,119}$'
  ),
  workflow_definition_id uuid not null,
  subject_type text not null check (subject_type in (
    'demand', 'reservation', 'employee', 'company', 'integration',
    'workflow_execution', 'generic'
  )),
  company_id_path text not null default 'companyId' check (
    company_id_path ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$'
  ),
  subject_id_path text not null default 'aggregateId' check (
    subject_id_path ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$'
  ),
  condition_ast jsonb not null check (jsonb_typeof(condition_ast) = 'object'),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text not null,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  reviewed_by uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, automation_definition_id, version_number),
  foreign key (tenant_id, automation_definition_id)
    references automation_definitions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, workflow_definition_id)
    references enterprise_workflow_definitions(tenant_id, id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check (
    (status in ('draft', 'in_review') and published_at is null)
    or status in ('approved', 'published', 'suspended', 'archived')
  )
);

alter table automation_definitions
  add constraint automation_definitions_current_version_fk
  foreign key (tenant_id, id, current_version)
  references automation_versions(tenant_id, automation_definition_id, version_number)
  deferrable initially deferred;

alter table automation_definitions
  add constraint automation_definitions_published_version_fk
  foreign key (tenant_id, id, published_version)
  references automation_versions(tenant_id, automation_definition_id, version_number)
  deferrable initially deferred;

create index if not exists automation_versions_event_idx
  on automation_versions (tenant_id, event_type, status, valid_from, valid_until);

create table if not exists automation_version_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_version_id uuid not null,
  scope_type text not null check (scope_type in ('tenant', 'group', 'company')),
  scope_id text,
  mode text not null default 'include' check (mode in ('include', 'exclude')),
  specificity integer not null default 0 check (specificity between 0 and 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, automation_version_id, scope_type, scope_id, mode),
  foreign key (tenant_id, automation_version_id)
    references automation_versions(tenant_id, id) on delete cascade,
  check (
    (scope_type = 'tenant' and scope_id is null)
    or (scope_type <> 'tenant' and scope_id is not null)
  )
);

create index if not exists automation_version_scopes_lookup_idx
  on automation_version_scopes (tenant_id, automation_version_id, scope_type, scope_id);
create unique index if not exists automation_version_scopes_unique_idx
  on automation_version_scopes (
    tenant_id,
    automation_version_id,
    scope_type,
    coalesce(scope_id, ''),
    mode
  );

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_definition_id uuid not null,
  automation_version_id uuid not null,
  source_outbox_event_id uuid not null,
  company_id text,
  subject_type text not null,
  subject_id text not null,
  status text not null default 'evaluating' check (status in (
    'evaluating', 'skipped', 'queued', 'running', 'waiting',
    'completed', 'failed', 'cancelled'
  )),
  input_hash char(64) not null check (input_hash ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  condition_trace jsonb check (
    condition_trace is null or jsonb_typeof(condition_trace) = 'object'
  ),
  workflow_execution_id uuid,
  attempts integer not null default 0 check (attempts between 0 and 100),
  error_code text,
  error_message text,
  started_by uuid references users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, automation_definition_id, source_outbox_event_id),
  foreign key (tenant_id, automation_definition_id)
    references automation_definitions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, automation_version_id)
    references automation_versions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_outbox_event_id)
    references domain_outbox(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_execution_id)
    references enterprise_workflow_executions(tenant_id, id) on delete restrict,
  check (
    status not in ('completed', 'failed', 'cancelled', 'skipped')
    or completed_at is not null
  )
);

create index if not exists automation_runs_status_idx
  on automation_runs (tenant_id, status, updated_at desc);
create index if not exists automation_runs_source_idx
  on automation_runs (tenant_id, source_outbox_event_id, automation_definition_id);
create index if not exists automation_runs_workflow_idx
  on automation_runs (tenant_id, workflow_execution_id)
  where workflow_execution_id is not null;

create table if not exists automation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_definition_id uuid not null,
  automation_version_id uuid,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid references users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, automation_definition_id)
    references automation_definitions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, automation_version_id)
    references automation_versions(tenant_id, id) on delete restrict
);

create index if not exists automation_events_definition_idx
  on automation_events (tenant_id, automation_definition_id, created_at desc);

create or replace function validate_automation_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_type = 'company' and not exists (
    select 1
    from companies
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Empresa da automacao nao pertence ao tenant.';
  end if;
  if new.scope_type = 'group' and not exists (
    select 1
    from business_groups
    where tenant_id = new.tenant_id and id = new.scope_id and deleted_at is null
  ) then
    raise exception 'Grupo da automacao nao pertence ao tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists automation_version_scopes_validate on automation_version_scopes;
create trigger automation_version_scopes_validate
before insert or update of tenant_id, scope_type, scope_id
on automation_version_scopes
for each row execute function validate_automation_scope();

create or replace function prevent_automation_version_content_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled()
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Versao de automacao submetida e imutavel.';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' and (
    new.event_type is distinct from old.event_type
    or new.workflow_definition_id is distinct from old.workflow_definition_id
    or new.subject_type is distinct from old.subject_type
    or new.company_id_path is distinct from old.company_id_path
    or new.subject_id_path is distinct from old.subject_id_path
    or new.condition_ast is distinct from old.condition_ast
    or new.content_hash is distinct from old.content_hash
    or (
      (
        new.valid_from is distinct from old.valid_from
        or new.valid_until is distinct from old.valid_until
      )
      and not (old.status = 'approved' and new.status = 'published')
    )
  ) then
    raise exception 'Conteudo de versao de automacao submetida e imutavel; crie nova versao.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists automation_versions_prevent_content_mutation on automation_versions;
create trigger automation_versions_prevent_content_mutation
before update or delete on automation_versions
for each row execute function prevent_automation_version_content_mutation();

create or replace function prevent_automation_scope_mutation()
returns trigger
language plpgsql
as $$
declare
  version_status text;
  resolved_version_id uuid;
  resolved_tenant_id uuid;
begin
  if tenant_reset_maintenance_enabled()
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  resolved_version_id := case when tg_op = 'DELETE' then old.automation_version_id else new.automation_version_id end;
  resolved_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  select status into version_status
  from automation_versions
  where tenant_id = resolved_tenant_id and id = resolved_version_id;
  if version_status is distinct from 'draft' then
    raise exception 'Escopos so podem ser alterados em versao rascunho.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists automation_scopes_prevent_mutation on automation_version_scopes;
create trigger automation_scopes_prevent_mutation
before insert or update or delete on automation_version_scopes
for each row execute function prevent_automation_scope_mutation();

create or replace function validate_automation_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if not exists (
      select 1
      from automation_version_scopes scope
      where scope.tenant_id = new.tenant_id
        and scope.automation_version_id = new.id
        and scope.mode = 'include'
    ) then
      raise exception 'Automacao publicada exige ao menos um escopo de inclusao.';
    end if;
    if not exists (
      select 1
      from enterprise_workflow_definitions workflow
      where workflow.tenant_id = new.tenant_id
        and workflow.id = new.workflow_definition_id
        and workflow.status = 'published'
        and workflow.published_version is not null
        and workflow.archived_at is null
    ) then
      raise exception 'Automacao publicada exige workflow publicado.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists automation_versions_validate_publication on automation_versions;
create trigger automation_versions_validate_publication
before update of status on automation_versions
for each row execute function validate_automation_publication();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'automation_definitions', 'automation_versions',
    'automation_version_scopes', 'automation_runs', 'automation_events'
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

drop trigger if exists automation_definitions_set_updated_at on automation_definitions;
create trigger automation_definitions_set_updated_at
before update on automation_definitions for each row execute function set_updated_at();
drop trigger if exists automation_versions_set_updated_at on automation_versions;
create trigger automation_versions_set_updated_at
before update on automation_versions for each row execute function set_updated_at();
drop trigger if exists automation_runs_set_updated_at on automation_runs;
create trigger automation_runs_set_updated_at
before update on automation_runs for each row execute function set_updated_at();

commit;
