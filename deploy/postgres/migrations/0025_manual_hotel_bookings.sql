begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_tenant_id_id_company_unique'
      and conrelid = 'employees'::regclass
  ) then
    alter table employees
      add constraint employees_tenant_id_id_company_unique
      unique (tenant_id, id, company_id);
  end if;
end;
$$;

create table if not exists manual_hotel_bookings (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  employee_id text,
  hotel_id text not null,
  passenger_name_snapshot text not null,
  identity_status text not null default 'matched'
    check (identity_status in ('matched', 'legacy_unresolved')),
  status text not null default 'recorded'
    check (status in ('recorded', 'cancelled')),
  checkin_date date not null,
  checkout_date date not null,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  currency char(3) not null default 'BRL',
  observations text,
  idempotency_key text,
  request_hash text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, hotel_id)
    references hotels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id, company_id)
    references employees(tenant_id, id, company_id) on delete restrict,
  check (checkout_date >= checkin_date),
  check (
    (identity_status = 'matched' and employee_id is not null)
    or identity_status = 'legacy_unresolved'
  )
);

create index if not exists manual_hotel_bookings_company_period_idx
  on manual_hotel_bookings (
    tenant_id, company_id, checkin_date desc, created_at desc
  )
  where deleted_at is null;

create index if not exists manual_hotel_bookings_employee_idx
  on manual_hotel_bookings (tenant_id, employee_id, checkin_date desc)
  where employee_id is not null and deleted_at is null;

create index if not exists manual_hotel_bookings_hotel_idx
  on manual_hotel_bookings (tenant_id, hotel_id, checkin_date desc)
  where deleted_at is null;

select tenant_rls_policy('manual_hotel_bookings');

drop trigger if exists manual_hotel_bookings_set_updated_at
  on manual_hotel_bookings;
create trigger manual_hotel_bookings_set_updated_at
before update on manual_hotel_bookings
for each row execute function set_updated_at();

commit;
