begin;

create or replace function tenant_reset_maintenance_enabled()
returns boolean
language sql
stable
as $$
  select current_setting('app.tenant_reset', true) = 'on';
$$;

create or replace function prevent_published_policy_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versao de politica publicada e imutavel; suspenda ou arquive a publicacao.';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if old.published_at is not null then
    if new.status not in ('published', 'suspended', 'archived')
       or new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.priority is distinct from old.priority
       or new.severity is distinct from old.severity
       or new.inheritance_mode is distinct from old.inheritance_mode
       or new.overridable is distinct from old.overridable
       or new.condition_ast is distinct from old.condition_ast
       or new.actions_ast is distinct from old.actions_ast
       or new.exception_ast is distinct from old.exception_ast
       or new.timezone is distinct from old.timezone
       or new.valid_from is distinct from old.valid_from
       or new.valid_until is distinct from old.valid_until
       or new.tags is distinct from old.tags
       or new.business_justification is distinct from old.business_justification
       or new.content_hash is distinct from old.content_hash
       or new.change_summary is distinct from old.change_summary
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.published_by is distinct from old.published_by
       or new.published_at is distinct from old.published_at then
      raise exception 'Conteudo de versao de politica publicada e imutavel; crie uma nova versao.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_published_workflow_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versao de workflow publicada e imutavel; suspenda ou arquive a publicacao.';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if old.published_at is not null then
    if new.status not in ('published', 'suspended', 'archived')
       or new.graph_snapshot is distinct from old.graph_snapshot
       or new.content_hash is distinct from old.content_hash
       or new.change_summary is distinct from old.change_summary
       or new.valid_from is distinct from old.valid_from
       or new.valid_until is distinct from old.valid_until
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.published_by is distinct from old.published_by
       or new.published_at is distinct from old.published_at then
      raise exception 'Conteudo de versao de workflow publicada e imutavel; crie uma nova versao.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_published_workflow_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_published_at timestamptz;
begin
  if tenant_reset_maintenance_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  select published_at into target_published_at
  from approval_workflow_versions
  where tenant_id = row_value.tenant_id and id = row_value.workflow_version_id;
  if target_published_at is not null then
    raise exception 'Filhos de versao de workflow publicada sao imutaveis.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function prevent_published_policy_child_mutation()
returns trigger
language plpgsql
as $$
declare
  row_value record;
  target_version_id uuid;
  target_published_at timestamptz;
begin
  if tenant_reset_maintenance_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then row_value := old; else row_value := new; end if;
  if tg_table_name = 'policy_conditions' then
    select policy_rule_sets.policy_version_id into target_version_id
    from policy_rule_sets
    where policy_rule_sets.tenant_id = row_value.tenant_id
      and policy_rule_sets.id = row_value.rule_set_id;
  else
    target_version_id := row_value.policy_version_id;
  end if;
  select published_at into target_published_at
  from policy_versions
  where tenant_id = row_value.tenant_id and id = target_version_id;
  if target_published_at is not null then
    raise exception 'Filhos de versao de politica publicada sao imutaveis.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

commit;
