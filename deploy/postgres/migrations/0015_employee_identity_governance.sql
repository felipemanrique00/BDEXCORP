begin;

alter table employee_aliases
  drop constraint if exists employee_aliases_tenant_id_normalized_alias_key;

alter table employee_aliases
  add constraint employee_aliases_employee_alias_unique
  unique (tenant_id, employee_id, normalized_alias);

create index if not exists employee_aliases_normalized_lookup_idx
  on employee_aliases (tenant_id, normalized_alias, employee_id);

create table if not exists employee_identity_counters (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  current_value bigint not null default 999 check (current_value >= 999),
  updated_at timestamptz not null default now()
);

create table if not exists employee_match_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  employee_id text,
  demand_id text,
  source_type text not null,
  source_reference text not null,
  source_name text not null,
  normalized_name text not null,
  status text not null check (status in ('suggested', 'confirmed', 'rejected', 'unresolved')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  match_method text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_type, source_reference),
  foreign key (tenant_id, company_id) references companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, demand_id) references demands(tenant_id, id) on delete cascade,
  check ((status = 'confirmed') = (employee_id is not null)),
  check ((decided_at is null) = (status in ('suggested', 'unresolved')))
);

create index if not exists employee_match_decisions_review_idx
  on employee_match_decisions (tenant_id, company_id, status, created_at desc);
create index if not exists employee_match_decisions_name_idx
  on employee_match_decisions (tenant_id, company_id, normalized_name);

alter table demands
  add column if not exists employee_match_status text not null default 'unresolved'
    check (employee_match_status in ('exact', 'alias', 'automatic', 'manual', 'ambiguous', 'unresolved')),
  add column if not exists employee_match_confidence numeric(5,4)
    check (employee_match_confidence is null or (employee_match_confidence >= 0 and employee_match_confidence <= 1));

create index if not exists demands_employee_match_review_idx
  on demands (tenant_id, company_id, employee_match_status, created_at desc)
  where employee_id is null or employee_match_status in ('ambiguous', 'unresolved');

create or replace function validate_employee_match_scope()
returns trigger
language plpgsql
as $$
declare
  employee_company text;
  demand_company text;
begin
  if new.employee_id is not null then
    select company_id into employee_company
    from employees
    where tenant_id = new.tenant_id and id = new.employee_id and deleted_at is null;
    if employee_company is null or employee_company <> new.company_id then
      raise exception 'Funcionario fora do escopo da empresa.';
    end if;
  end if;

  if new.demand_id is not null then
    select company_id into demand_company
    from demands
    where tenant_id = new.tenant_id and id = new.demand_id and deleted_at is null;
    if demand_company is null or demand_company <> new.company_id then
      raise exception 'Demanda fora do escopo da empresa.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_match_decisions_validate_scope on employee_match_decisions;
create trigger employee_match_decisions_validate_scope
before insert or update of tenant_id, company_id, employee_id, demand_id on employee_match_decisions
for each row execute function validate_employee_match_scope();

alter table employee_identity_counters enable row level security;
alter table employee_identity_counters force row level security;
drop policy if exists tenant_isolation on employee_identity_counters;
create policy tenant_isolation on employee_identity_counters
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table employee_match_decisions enable row level security;
alter table employee_match_decisions force row level security;
drop policy if exists tenant_isolation on employee_match_decisions;
create policy tenant_isolation on employee_match_decisions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop trigger if exists employee_identity_counters_set_updated_at on employee_identity_counters;
create trigger employee_identity_counters_set_updated_at
before update on employee_identity_counters for each row execute function set_updated_at();

drop trigger if exists employee_match_decisions_set_updated_at on employee_match_decisions;
create trigger employee_match_decisions_set_updated_at
before update on employee_match_decisions for each row execute function set_updated_at();

commit;
