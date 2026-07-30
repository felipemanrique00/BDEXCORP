begin;

create table if not exists reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_ids jsonb not null check (jsonb_typeof(company_ids) = 'array'),
  scanned_demands integer not null default 0 check (scanned_demands >= 0),
  scanned_employees integer not null default 0 check (scanned_employees >= 0),
  detected_alerts integer not null default 0 check (detected_alerts >= 0),
  active_alerts integer not null default 0 check (active_alerts >= 0),
  auto_resolved_alerts integer not null default 0 check (auto_resolved_alerts >= 0),
  counts_by_severity jsonb not null default '{}'::jsonb
    check (jsonb_typeof(counts_by_severity) = 'object'),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (completed_at >= started_at)
);

create table if not exists reconciliation_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  alert_key text not null check (length(trim(alert_key)) between 1 and 4000),
  alert_type text not null check (alert_type in (
    'venda_duplicada',
    'valor_divergente',
    'data_invalida',
    'passageiro_sem_funcionario',
    'empresa_sem_codigo',
    'demanda_sem_emissao',
    'emissao_sem_demanda',
    'funcionario_sem_cpf',
    'voucher_sem_demanda',
    'agente_sobrecarregado',
    'demanda_atrasada',
    'valor_zerado'
  )),
  severity text not null check (severity in ('critico', 'alto', 'medio', 'baixo', 'info')),
  title text not null check (length(trim(title)) between 1 and 500),
  description text not null check (length(trim(description)) between 1 and 5000),
  entities jsonb not null check (jsonb_typeof(entities) = 'array'),
  suggested_action text,
  detection_fingerprint char(64) not null
    check (detection_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'ignored', 'auto_resolved')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resolution_kind text check (
    resolution_kind is null
    or resolution_kind in ('manual', 'ignored', 'employee_linked', 'source_corrected', 'no_longer_detected')
  ),
  resolution_note text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, alert_key),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (last_detected_at >= first_detected_at),
  check (
    (status = 'open' and resolved_at is null and resolved_by is null and resolution_kind is null)
    or
    (status <> 'open' and resolved_at is not null and resolution_kind is not null)
  )
);

create table if not exists reconciliation_alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  alert_id uuid not null,
  action text not null check (action in ('detected', 'reopened', 'resolved', 'ignored', 'auto_resolved')),
  from_status text check (
    from_status is null
    or from_status in ('open', 'resolved', 'ignored', 'auto_resolved')
  ),
  to_status text not null check (to_status in ('open', 'resolved', 'ignored', 'auto_resolved')),
  note text,
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, alert_id)
    references reconciliation_alerts(tenant_id, id) on delete cascade
);

create index if not exists reconciliation_runs_tenant_created_idx
  on reconciliation_runs (tenant_id, created_at desc);

create index if not exists reconciliation_alerts_company_status_idx
  on reconciliation_alerts (tenant_id, company_id, status, severity, last_detected_at desc);

create index if not exists reconciliation_alerts_type_status_idx
  on reconciliation_alerts (tenant_id, alert_type, status, last_detected_at desc);

create index if not exists reconciliation_alert_events_alert_created_idx
  on reconciliation_alert_events (tenant_id, alert_id, created_at desc);

select tenant_rls_policy('reconciliation_runs');
select tenant_rls_policy('reconciliation_alerts');
select tenant_rls_policy('reconciliation_alert_events');

drop trigger if exists reconciliation_alerts_set_updated_at
  on reconciliation_alerts;
create trigger reconciliation_alerts_set_updated_at
before update on reconciliation_alerts
for each row execute function set_updated_at();

commit;
