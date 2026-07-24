begin;

create table if not exists assistant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tool_key text not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, tool_key),
  check (tool_key ~ '^[A-Za-z][A-Za-z0-9_-]{1,119}$')
);

create table if not exists assistant_conversations (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  last_message_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200)
);

create index if not exists assistant_conversations_company_last_message_idx
  on assistant_conversations (tenant_id, company_id, last_message_at desc);

create table if not exists assistant_messages (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references assistant_conversations(tenant_id, id) on delete cascade,
  check (length(trim(id)) between 2 and 200)
);

create index if not exists assistant_messages_conversation_created_idx
  on assistant_messages (tenant_id, conversation_id, created_at desc);

create table if not exists assistant_integration_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_key text not null,
  provider text not null,
  status text not null,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, session_key),
  check (length(trim(session_key)) between 2 and 120),
  check (length(trim(provider)) between 2 and 120),
  check (length(trim(status)) between 2 and 80)
);

create table if not exists assistant_events (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  category text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(category)) between 2 and 120)
);

create index if not exists assistant_events_category_created_idx
  on assistant_events (tenant_id, category, created_at desc);

create index if not exists assistant_events_company_created_idx
  on assistant_events (tenant_id, company_id, created_at desc)
  where company_id is not null;

create table if not exists assistant_generated_documents (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  document_type text not null,
  status text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (length(trim(document_type)) between 2 and 80),
  check (status in ('generated', 'failed'))
);

create index if not exists assistant_generated_documents_company_created_idx
  on assistant_generated_documents (tenant_id, company_id, created_at desc);

select tenant_rls_policy('assistant_settings');
select tenant_rls_policy('assistant_tools');
select tenant_rls_policy('assistant_conversations');
select tenant_rls_policy('assistant_messages');
select tenant_rls_policy('assistant_integration_sessions');
select tenant_rls_policy('assistant_events');
select tenant_rls_policy('assistant_generated_documents');

drop trigger if exists assistant_settings_set_updated_at on assistant_settings;
create trigger assistant_settings_set_updated_at
before update on assistant_settings
for each row execute function set_updated_at();

drop trigger if exists assistant_tools_set_updated_at on assistant_tools;
create trigger assistant_tools_set_updated_at
before update on assistant_tools
for each row execute function set_updated_at();

drop trigger if exists assistant_conversations_set_updated_at on assistant_conversations;
create trigger assistant_conversations_set_updated_at
before update on assistant_conversations
for each row execute function set_updated_at();

drop trigger if exists assistant_integration_sessions_set_updated_at on assistant_integration_sessions;
create trigger assistant_integration_sessions_set_updated_at
before update on assistant_integration_sessions
for each row execute function set_updated_at();

create or replace function prevent_assistant_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.tenant_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Eventos publicados da assistente sao imutaveis.';
end;
$$;

drop trigger if exists assistant_events_immutable on assistant_events;
create trigger assistant_events_immutable
before update or delete on assistant_events
for each row execute function prevent_assistant_event_mutation();

commit;
