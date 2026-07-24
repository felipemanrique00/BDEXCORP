begin;

create table if not exists demand_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  demand_id text not null,
  company_id text not null,
  source_user_id uuid not null references users(id) on delete restrict,
  destination_user_id uuid not null references users(id) on delete restrict,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  requested_demand_version bigint not null check (requested_demand_version > 0),
  response_reason text,
  legacy_source_id text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, demand_id)
    references demands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, destination_user_id)
    references tenant_memberships(tenant_id, user_id) on delete restrict,
  check (source_user_id <> destination_user_id),
  check (length(trim(reason)) between 5 and 2000),
  check (response_reason is null or length(trim(response_reason)) between 5 and 2000),
  check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

create unique index if not exists demand_transfer_requests_pending_uidx
  on demand_transfer_requests (tenant_id, demand_id, destination_user_id)
  where status = 'pending';

create unique index if not exists demand_transfer_requests_legacy_uidx
  on demand_transfer_requests (tenant_id, legacy_source_id)
  where legacy_source_id is not null;

create index if not exists demand_transfer_requests_destination_idx
  on demand_transfer_requests (tenant_id, destination_user_id, status, requested_at desc);

create index if not exists demand_transfer_requests_source_idx
  on demand_transfer_requests (tenant_id, source_user_id, status, requested_at desc);

select tenant_rls_policy('demand_transfer_requests');

drop trigger if exists demand_transfer_requests_set_updated_at
  on demand_transfer_requests;
create trigger demand_transfer_requests_set_updated_at
before update on demand_transfer_requests
for each row execute function set_updated_at();

commit;
