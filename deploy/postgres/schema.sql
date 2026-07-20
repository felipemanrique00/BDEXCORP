create table if not exists app_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists app_kv_updated_at_idx on app_kv (updated_at desc);
