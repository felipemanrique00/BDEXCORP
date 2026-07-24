begin;

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_code text not null check (
    document_code ~ '^[A-Z0-9][A-Z0-9._-]{2,79}$'
  ),
  title text not null check (length(trim(title)) between 3 and 240),
  description text not null default '' check (length(description) <= 2000),
  source_type text not null default 'manual' check (
    source_type in ('manual', 'policy', 'report', 'file', 'integration')
  ),
  source_ref text,
  scope_type text not null check (scope_type in ('tenant', 'group', 'company')),
  scope_id text,
  classification text not null default 'internal' check (
    classification in ('internal', 'confidential', 'restricted')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'published', 'archived')
  ),
  content text not null check (length(trim(content)) between 20 and 500000),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid not null references users(id) on delete restrict,
  updated_by uuid not null references users(id) on delete restrict,
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, document_code),
  check (
    (scope_type = 'tenant' and scope_id is null)
    or (scope_type <> 'tenant' and scope_id is not null)
  ),
  check (
    (status = 'published' and published_by is not null and published_at is not null)
    or status <> 'published'
  ),
  check (
    (status = 'archived' and archived_at is not null)
    or status <> 'archived'
  )
);

create unique index if not exists knowledge_documents_source_uidx
  on knowledge_documents (tenant_id, source_type, source_ref)
  where source_ref is not null and status <> 'archived';
create index if not exists knowledge_documents_scope_idx
  on knowledge_documents (tenant_id, status, scope_type, scope_id, classification);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_id uuid not null,
  chunk_index integer not null check (chunk_index between 0 and 9999),
  content text not null check (length(trim(content)) between 1 and 5000),
  character_count integer not null check (character_count between 1 and 5000),
  search_vector tsvector generated always as (
    to_tsvector('portuguese', coalesce(content, ''))
  ) stored,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, document_id, chunk_index),
  foreign key (tenant_id, document_id)
    references knowledge_documents(tenant_id, id) on delete cascade
);

create index if not exists knowledge_chunks_search_idx
  on knowledge_chunks using gin (search_vector);
create index if not exists knowledge_chunks_document_idx
  on knowledge_chunks (tenant_id, document_id, chunk_index);

create or replace function validate_knowledge_document_scope()
returns trigger
language plpgsql
as $$
begin
  if new.scope_type = 'company' and not exists (
    select 1
    from companies
    where tenant_id = new.tenant_id
      and id = new.scope_id
      and deleted_at is null
  ) then
    raise exception 'Empresa da base de conhecimento nao pertence ao tenant.';
  end if;

  if new.scope_type = 'group' and not exists (
    select 1
    from business_groups
    where tenant_id = new.tenant_id
      and id = new.scope_id
      and deleted_at is null
  ) then
    raise exception 'Grupo da base de conhecimento nao pertence ao tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_documents_validate_scope on knowledge_documents;
create trigger knowledge_documents_validate_scope
before insert or update of tenant_id, scope_type, scope_id
on knowledge_documents
for each row execute function validate_knowledge_document_scope();

create or replace function prevent_published_knowledge_mutation()
returns trigger
language plpgsql
as $$
begin
  if tenant_reset_maintenance_enabled() then
    return new;
  end if;

  if old.status = 'published' and (
    new.document_code is distinct from old.document_code
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.source_type is distinct from old.source_type
    or new.source_ref is distinct from old.source_ref
    or new.scope_type is distinct from old.scope_type
    or new.scope_id is distinct from old.scope_id
    or new.classification is distinct from old.classification
    or new.content is distinct from old.content
    or new.content_hash is distinct from old.content_hash
    or new.metadata is distinct from old.metadata
  ) then
    raise exception 'Documento publicado e imutavel; arquive e crie uma nova versao.';
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_documents_prevent_published_mutation
  on knowledge_documents;
create trigger knowledge_documents_prevent_published_mutation
before update on knowledge_documents
for each row execute function prevent_published_knowledge_mutation();

create or replace function prevent_published_knowledge_chunk_mutation()
returns trigger
language plpgsql
as $$
declare
  current_document_id uuid;
begin
  if tenant_reset_maintenance_enabled()
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  current_document_id := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  if exists (
    select 1
    from knowledge_documents
    where tenant_id = case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end
      and id = current_document_id
      and status = 'published'
  ) then
    raise exception 'Fragmentos de documento publicado sao imutaveis.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists knowledge_chunks_prevent_published_mutation
  on knowledge_chunks;
create trigger knowledge_chunks_prevent_published_mutation
before update or delete on knowledge_chunks
for each row execute function prevent_published_knowledge_chunk_mutation();

select tenant_rls_policy('knowledge_documents');
select tenant_rls_policy('knowledge_chunks');

drop trigger if exists knowledge_documents_set_updated_at on knowledge_documents;
create trigger knowledge_documents_set_updated_at
before update on knowledge_documents
for each row execute function set_updated_at();

commit;
