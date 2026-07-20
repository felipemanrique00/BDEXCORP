-- BBT Corporate V17 - assistant, WhatsApp, voice, PDF and audit production schema.
-- This schema is additive. It keeps app_kv compatibility while preparing real relational storage.

create extension if not exists pgcrypto;

create table if not exists assistant_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  status text not null default 'active',
  assistant_name text not null,
  provider text not null default 'mock',
  model text not null default 'mock-secure-assistant',
  temperature numeric(4,2) not null default 0.20,
  language text not null default 'pt-BR',
  initial_message text,
  personality text,
  tone text,
  system_instruction text,
  behavior_rules text,
  security_rules text,
  unknown_message text,
  error_message text,
  human_handoff_message text,
  memory_enabled boolean not null default true,
  context_window integer not null default 12,
  response_limit integer not null default 1800,
  config jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_voice_settings (
  id uuid primary key default gen_random_uuid(),
  assistant_setting_id uuid references assistant_settings(id) on delete cascade,
  tenant_id text,
  status text not null default 'active',
  speech_to_text_enabled boolean not null default true,
  text_to_speech_enabled boolean not null default true,
  transcription_provider text not null default 'browser',
  voice_provider text not null default 'browser',
  voice text not null default 'pt-BR',
  speed numeric(4,2) not null default 1.00,
  audio_format text not null default 'webm',
  language text not null default 'pt-BR',
  response_mode text not null default 'auto',
  max_duration_seconds integer not null default 90,
  accepted_formats text[] not null default array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'],
  storage_mode text not null default 'temporary',
  fallback_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  tool_key text not null,
  status text not null default 'active',
  name text not null,
  description text not null,
  kind text not null,
  module text not null,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  permissions text[] not null default '{}',
  channels text[] not null default array['system', 'portal', 'test'],
  sensitive boolean not null default false,
  requires_confirmation boolean not null default false,
  whatsapp_enabled boolean not null default false,
  internal_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, tool_key)
);

create table if not exists assistant_tool_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  user_id text,
  conversation_id uuid,
  tool_key text not null,
  status text not null,
  duration_ms integer not null default 0,
  channel text not null,
  input_summary text,
  output_summary text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists assistant_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  user_id text,
  user_name text,
  channel text not null,
  level text not null default 'info',
  action text not null,
  module text not null,
  entity_type text,
  entity_id text,
  conversation_id uuid,
  tool_key text,
  input_summary text,
  output_summary text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  status text not null default 'disconnected',
  mode text not null default 'mock',
  provider text not null default 'mock',
  connected_number text,
  encrypted_session jsonb,
  qr_code text,
  last_connection_at timestamptz,
  last_disconnect_at timestamptz,
  last_message_at timestamptz,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_connection_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  whatsapp_session_id uuid references whatsapp_sessions(id) on delete set null,
  status text not null,
  event text not null,
  message text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  status text not null default 'open',
  channel text not null,
  participant_name text,
  participant_phone text,
  assigned_to_user_id text,
  priority text not null default 'normal',
  tags text[] not null default '{}',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id text,
  company_id text,
  user_id text,
  display_name text,
  phone text,
  role text not null default 'customer',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id text,
  company_id text,
  direction text not null,
  role text not null,
  type text not null,
  content text,
  transcript text,
  file_id text,
  provider_message_id text,
  tool_calls jsonb not null default '[]'::jsonb,
  sensitive boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists generated_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  created_by text,
  type text not null,
  status text not null default 'generated',
  title text not null,
  entity_type text,
  entity_id text,
  file_name text not null,
  mime_type text not null,
  storage_url text,
  html text,
  checksum text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists voucher_send_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  voucher_id text not null,
  generated_document_id uuid references generated_documents(id) on delete set null,
  channel text not null,
  recipient_phone text,
  recipient_name text,
  status text not null,
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audio_transcription_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  conversation_id uuid references conversations(id) on delete set null,
  provider text not null,
  status text not null,
  language text,
  source text not null,
  file_name text,
  storage_url text,
  transcript text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audio_generation_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  conversation_id uuid references conversations(id) on delete set null,
  provider text not null,
  status text not null,
  voice text,
  format text,
  text_preview text,
  storage_url text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists human_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  conversation_id uuid references conversations(id) on delete set null,
  status text not null default 'waiting_human',
  priority text not null default 'normal',
  reason text not null,
  assigned_to_user_id text,
  resolved_by_user_id text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists message_queue_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  channel text not null,
  provider text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  payload jsonb not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integration_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  integration text not null,
  direction text not null,
  status text not null,
  request_summary text,
  response_summary text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists security_event_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  company_id text,
  user_id text,
  conversation_id uuid references conversations(id) on delete set null,
  severity text not null default 'medium',
  type text not null,
  reason text,
  preview text,
  channel text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_audit_logs_created_idx on assistant_audit_logs (created_at desc);
create index if not exists assistant_audit_logs_company_idx on assistant_audit_logs (company_id, created_at desc);
create index if not exists assistant_tool_logs_created_idx on assistant_tool_logs (created_at desc);
create index if not exists whatsapp_sessions_status_idx on whatsapp_sessions (status);
create index if not exists conversations_company_status_idx on conversations (company_id, status, updated_at desc);
create index if not exists conversation_messages_conversation_idx on conversation_messages (conversation_id, created_at desc);
create index if not exists generated_documents_entity_idx on generated_documents (entity_type, entity_id, created_at desc);
create index if not exists voucher_send_logs_voucher_idx on voucher_send_logs (voucher_id, created_at desc);
create index if not exists message_queue_jobs_due_idx on message_queue_jobs (status, scheduled_at);
create index if not exists integration_logs_created_idx on integration_logs (integration, created_at desc);
create index if not exists security_event_logs_created_idx on security_event_logs (severity, created_at desc);
