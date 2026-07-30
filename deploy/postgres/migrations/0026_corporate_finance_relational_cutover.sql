begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'demands_tenant_id_id_company_unique'
      and conrelid = 'demands'::regclass
  ) then
    alter table demands
      add constraint demands_tenant_id_id_company_unique
      unique (tenant_id, id, company_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_entries_tenant_id_id_company_unique'
      and conrelid = 'financial_entries'::regclass
  ) then
    alter table financial_entries
      add constraint financial_entries_tenant_id_id_company_unique
      unique (tenant_id, id, company_id);
  end if;
end;
$$;

create table if not exists corporate_wallets (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  available_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  daily_pix_limit numeric(14,2) not null default 0 check (daily_pix_limit >= 0),
  monthly_card_limit numeric(14,2) not null default 0 check (monthly_card_limit >= 0),
  status text not null default 'pending_configuration'
    check (status in ('active', 'blocked', 'pending_configuration')),
  pix_enabled boolean not null default false,
  card_enabled boolean not null default false,
  provider text not null default 'pending'
    check (provider in ('pending', 'stripe_issuing', 'dock', 'pismo', 'efi_bank', 'other')),
  virtual_account text,
  notes text,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, company_id),
  unique (tenant_id, id, company_id),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (available_balance + credit_limit >= 0),
  check (virtual_account is null or length(trim(virtual_account)) between 1 and 240)
);

create table if not exists corporate_cards (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  wallet_id text not null,
  company_id text not null,
  employee_id text,
  card_type text not null check (card_type in ('physical', 'virtual')),
  nickname text not null check (length(trim(nickname)) between 1 and 160),
  holder_name text,
  last_four char(4) not null check (last_four ~ '^[0-9]{4}$'),
  brand text not null check (brand in ('Visa', 'Mastercard', 'Elo', 'Other')),
  card_limit numeric(14,2) not null default 0 check (card_limit >= 0),
  month_spend numeric(14,2) not null default 0 check (month_spend >= 0),
  spend_period char(7) not null default to_char(current_date, 'YYYY-MM')
    check (spend_period ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'active'
    check (status in ('active', 'blocked', 'cancelled', 'pending_issuance')),
  merchant_lock text,
  expiry_month smallint check (expiry_month is null or expiry_month between 1 and 12),
  expiry_year smallint check (expiry_year is null or expiry_year between 2000 and 9999),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, id, company_id),
  foreign key (tenant_id, wallet_id, company_id)
    references corporate_wallets(tenant_id, id, company_id) on delete restrict,
  foreign key (tenant_id, employee_id, company_id)
    references employees(tenant_id, id, company_id) on delete restrict,
  check ((expiry_month is null) = (expiry_year is null))
);

create table if not exists corporate_wallet_movements (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  wallet_id text not null,
  company_id text not null,
  movement_type text not null check (movement_type in ('credit', 'debit', 'refund', 'adjustment')),
  source text not null check (source in ('pix', 'card', 'invoice', 'manual', 'integration')),
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (length(trim(description)) between 2 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'failed', 'cancelled')),
  demand_id text,
  financial_entry_id text,
  card_id text,
  external_reference text,
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 200),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  processed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, wallet_id, company_id)
    references corporate_wallets(tenant_id, id, company_id) on delete restrict,
  foreign key (tenant_id, demand_id, company_id)
    references demands(tenant_id, id, company_id) on delete restrict,
  foreign key (tenant_id, financial_entry_id, company_id)
    references financial_entries(tenant_id, id, company_id) on delete restrict,
  foreign key (tenant_id, card_id, company_id)
    references corporate_cards(tenant_id, id, company_id) on delete restrict,
  check (
    (status = 'processed' and processed_at is not null)
    or (status <> 'processed' and processed_at is null)
  ),
  check (
    status <> 'processed'
    or source = 'manual'
    or external_reference is not null
  )
);

create table if not exists corporate_invoices (
  id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id text not null,
  invoice_number text not null,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  settled_amount numeric(14,2) not null default 0
    check (settled_amount >= 0 and settled_amount <= total_amount),
  status text not null default 'open'
    check (status in ('open', 'closed', 'paid', 'overdue', 'cancelled')),
  notes text,
  fingerprint text not null,
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, id, company_id),
  unique (tenant_id, invoice_number),
  unique (tenant_id, company_id, period_start, period_end),
  unique (tenant_id, fingerprint),
  foreign key (tenant_id, company_id)
    references companies(tenant_id, id) on delete restrict,
  check (period_end >= period_start),
  check (due_date >= period_end),
  check (deleted_at is null or status = 'cancelled')
);

create table if not exists corporate_invoice_financial_entries (
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id text not null,
  company_id text not null,
  financial_entry_id text not null,
  entry_amount numeric(14,2) not null check (entry_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, invoice_id, financial_entry_id),
  foreign key (tenant_id, invoice_id, company_id)
    references corporate_invoices(tenant_id, id, company_id) on delete cascade,
  foreign key (tenant_id, financial_entry_id, company_id)
    references financial_entries(tenant_id, id, company_id) on delete restrict
);

create table if not exists corporate_invoice_demands (
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id text not null,
  company_id text not null,
  demand_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, invoice_id, demand_id),
  foreign key (tenant_id, invoice_id, company_id)
    references corporate_invoices(tenant_id, id, company_id) on delete cascade,
  foreign key (tenant_id, demand_id, company_id)
    references demands(tenant_id, id, company_id) on delete restrict
);

create index if not exists corporate_wallets_company_status_idx
  on corporate_wallets (tenant_id, company_id, status)
  where deleted_at is null;
create index if not exists corporate_cards_company_status_idx
  on corporate_cards (tenant_id, company_id, status, created_at desc)
  where deleted_at is null;
create unique index if not exists corporate_cards_active_last_four_unique
  on corporate_cards (tenant_id, wallet_id, last_four)
  where deleted_at is null and status <> 'cancelled';
create index if not exists corporate_wallet_movements_company_created_idx
  on corporate_wallet_movements (tenant_id, company_id, created_at desc);
create index if not exists corporate_wallet_movements_wallet_created_idx
  on corporate_wallet_movements (tenant_id, wallet_id, created_at desc);
create index if not exists corporate_invoices_company_period_idx
  on corporate_invoices (tenant_id, company_id, period_end desc, created_at desc)
  where deleted_at is null;

create or replace function apply_corporate_wallet_movement()
returns trigger
language plpgsql
as $$
declare
  current_balance numeric(14,2);
  current_credit_limit numeric(14,2);
  current_monthly_card_limit numeric(14,2);
  current_status text;
  card_limit_value numeric(14,2);
  card_spend_value numeric(14,2);
  card_status_value text;
  card_spend_period char(7);
  current_period char(7);
  wallet_card_spend numeric(14,2);
  delta numeric(14,2);
begin
  if current_setting('app.corporate_finance_bootstrap', true) = 'on' then
    return new;
  end if;
  if new.status <> 'processed' then
    return new;
  end if;

  select available_balance, credit_limit, monthly_card_limit, status
    into current_balance, current_credit_limit, current_monthly_card_limit, current_status
  from corporate_wallets
  where tenant_id = new.tenant_id
    and id = new.wallet_id
    and company_id = new.company_id
    and deleted_at is null
  for update;

  if current_status is null then
    raise exception 'Carteira corporativa inexistente.';
  end if;
  if current_status <> 'active' then
    raise exception 'Carteira corporativa nao esta ativa.';
  end if;

  delta := case when new.movement_type = 'debit' then -new.amount else new.amount end;
  if current_balance + delta + current_credit_limit < 0 then
    raise exception 'Saldo e limite insuficientes para o movimento.';
  end if;

  if new.card_id is not null and new.movement_type = 'debit' then
    current_period := to_char(current_date, 'YYYY-MM');
    select card_limit, month_spend, status, spend_period
      into card_limit_value, card_spend_value, card_status_value, card_spend_period
    from corporate_cards
    where tenant_id = new.tenant_id
      and id = new.card_id
      and company_id = new.company_id
      and wallet_id = new.wallet_id
      and deleted_at is null
    for update;

    if card_status_value is null then
      raise exception 'Cartao corporativo inexistente.';
    end if;
    if card_status_value <> 'active' then
      raise exception 'Cartao corporativo nao esta ativo.';
    end if;
    if card_spend_period <> current_period then
      card_spend_value := 0;
    end if;
    if card_spend_value + new.amount > card_limit_value then
      raise exception 'Limite mensal do cartao insuficiente.';
    end if;

    select coalesce(sum(
      case when spend_period = current_period then month_spend else 0 end
    ), 0)
      into wallet_card_spend
    from corporate_cards
    where tenant_id = new.tenant_id
      and wallet_id = new.wallet_id
      and company_id = new.company_id
      and deleted_at is null;
    if current_monthly_card_limit > 0
       and wallet_card_spend + new.amount > current_monthly_card_limit then
      raise exception 'Limite mensal de cartoes da carteira insuficiente.';
    end if;
  end if;

  update corporate_wallets
  set available_balance = available_balance + delta,
      updated_by = coalesce(new.created_by, updated_by),
      version = version + 1,
      updated_at = now()
  where tenant_id = new.tenant_id and id = new.wallet_id;

  if new.card_id is not null and new.movement_type = 'debit' then
    update corporate_cards
    set month_spend = card_spend_value + new.amount,
        spend_period = current_period,
        updated_by = coalesce(new.created_by, updated_by),
        version = version + 1,
        updated_at = now()
    where tenant_id = new.tenant_id
      and id = new.card_id
      and company_id = new.company_id
      and deleted_at is null;
  end if;

  new.processed_at := coalesce(new.processed_at, now());
  return new;
end;
$$;

drop trigger if exists corporate_wallet_movements_apply
  on corporate_wallet_movements;
create trigger corporate_wallet_movements_apply
before insert on corporate_wallet_movements
for each row execute function apply_corporate_wallet_movement();

select tenant_rls_policy('corporate_wallets');
select tenant_rls_policy('corporate_cards');
select tenant_rls_policy('corporate_wallet_movements');
select tenant_rls_policy('corporate_invoices');
select tenant_rls_policy('corporate_invoice_financial_entries');
select tenant_rls_policy('corporate_invoice_demands');

drop trigger if exists corporate_wallets_set_updated_at on corporate_wallets;
create trigger corporate_wallets_set_updated_at
before update on corporate_wallets
for each row execute function set_updated_at();

drop trigger if exists corporate_cards_set_updated_at on corporate_cards;
create trigger corporate_cards_set_updated_at
before update on corporate_cards
for each row execute function set_updated_at();

drop trigger if exists corporate_invoices_set_updated_at on corporate_invoices;
create trigger corporate_invoices_set_updated_at
before update on corporate_invoices
for each row execute function set_updated_at();

commit;
