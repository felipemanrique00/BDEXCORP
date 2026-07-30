begin;

create unique index if not exists demands_tenant_id_company_uidx
  on demands (tenant_id, id, company_id);

create table if not exists demand_messages (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  message_type text not null check (message_type in (
    'received', 'sent', 'system_event', 'internal_note'
  )),
  channel text not null check (channel in (
    'whatsapp', 'email', 'phone', 'system', 'in_person', 'other'
  )),
  sender_name text,
  author_user_id uuid references users(id) on delete set null,
  content text not null,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  is_read boolean not null default false,
  important boolean not null default false,
  read_at timestamptz,
  read_by_user_id uuid references users(id) on delete set null,
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, demand_id, company_id)
    references demands(tenant_id, id, company_id) on delete cascade,
  foreign key (tenant_id, author_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, read_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  check (length(trim(id)) between 2 and 200),
  check (sender_name is null or length(trim(sender_name)) between 1 and 300),
  check (length(trim(content)) between 1 and 12000),
  check (
    (is_read and read_at is not null)
    or (not is_read and read_at is null and read_by_user_id is null)
  )
);

create unique index if not exists demand_messages_legacy_uidx
  on demand_messages (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists demand_messages_thread_idx
  on demand_messages (tenant_id, demand_id, created_at, id);

create index if not exists demand_messages_unread_idx
  on demand_messages (tenant_id, company_id, created_at)
  where message_type = 'received' and not is_read;

create table if not exists travel_desk_notes (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text,
  demand_id text,
  created_by_user_id uuid not null references users(id) on delete restrict,
  note text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'archived')),
  resolved_by_user_id uuid references users(id) on delete restrict,
  resolved_at timestamptz,
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id, company_id)
    references demands(tenant_id, id, company_id) on delete cascade,
  foreign key (tenant_id, created_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, resolved_by_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  check (demand_id is null or company_id is not null),
  check (length(trim(id)) between 2 and 200),
  check (length(trim(note)) between 1 and 4000),
  check (
    (status = 'resolved' and resolved_at is not null and resolved_by_user_id is not null)
    or (status <> 'resolved' and resolved_at is null and resolved_by_user_id is null)
  )
);

create unique index if not exists travel_desk_notes_legacy_uidx
  on travel_desk_notes (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists travel_desk_notes_scope_idx
  on travel_desk_notes (tenant_id, company_id, status, created_at desc);

select tenant_rls_policy('demand_messages');
select tenant_rls_policy('travel_desk_notes');

drop trigger if exists demand_messages_set_updated_at on demand_messages;
create trigger demand_messages_set_updated_at
before update on demand_messages
for each row execute function set_updated_at();

drop trigger if exists travel_desk_notes_set_updated_at on travel_desk_notes;
create trigger travel_desk_notes_set_updated_at
before update on travel_desk_notes
for each row execute function set_updated_at();

commit;
