begin;

create or replace function prevent_enterprise_workflow_version_content_mutation()
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
    raise exception 'Versão de workflow submetida é imutável; arquive a definição.';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' and (
    new.graph_snapshot is distinct from old.graph_snapshot
    or new.content_hash is distinct from old.content_hash
    or new.workflow_definition_id is distinct from old.workflow_definition_id
    or new.version_number is distinct from old.version_number
    or new.source is distinct from old.source
    or new.valid_from is distinct from old.valid_from
    or new.valid_until is distinct from old.valid_until
  ) then
    raise exception 'Conteúdo de versão submetida é imutável; crie uma nova versão.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function prevent_enterprise_workflow_child_mutation()
returns trigger
language plpgsql
as $$
declare
  resolved_version_id uuid;
  resolved_status text;
begin
  if tenant_reset_maintenance_enabled()
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  resolved_version_id := case
    when tg_op = 'DELETE' then old.workflow_version_id
    else new.workflow_version_id
  end;
  select status into resolved_status
  from enterprise_workflow_versions
  where tenant_id = case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end
    and id = resolved_version_id;
  if resolved_status is distinct from 'draft' then
    raise exception 'Nós, conexões e escopos só podem ser alterados em versão rascunho.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function prevent_published_workflow_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled()
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Versão de workflow publicada é imutável; suspenda ou arquive a publicação.';
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
      raise exception 'Conteúdo de versão de workflow publicada é imutável; crie uma nova versão.';
    end if;
  end if;
  return new;
end;
$$;

commit;
