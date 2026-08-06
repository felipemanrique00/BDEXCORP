begin;

-- Every requester choice is independently replay-safe, including rows created
-- before explicit selection idempotency was introduced.
alter table travel_quote_selections
  add column if not exists idempotency_key text;

update travel_quote_selections
set idempotency_key = 'legacy-selection:' || id::text
where idempotency_key is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_selections'::regclass
      and conname = 'travel_quote_selections_idempotency_key_length_check'
  ) then
    alter table travel_quote_selections
      add constraint travel_quote_selections_idempotency_key_length_check
      check (char_length(idempotency_key) between 8 and 200) not valid;
  end if;
end
$$;

alter table travel_quote_selections
  validate constraint travel_quote_selections_idempotency_key_length_check;

alter table travel_quote_selections
  alter column idempotency_key set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_selections'::regclass
      and conname = 'travel_quote_selections_tenant_idempotency_key'
  ) then
    alter table travel_quote_selections
      add constraint travel_quote_selections_tenant_idempotency_key
      unique (tenant_id, idempotency_key);
  end if;
end
$$;

-- PostgreSQL requires a matching unique key on every referenced composite.
-- These keys let the selection FKs prove the whole demand -> quote -> option
-- chain instead of validating each identifier independently.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quotes'::regclass
      and conname = 'travel_quotes_tenant_demand_id_key'
  ) then
    alter table travel_quotes
      add constraint travel_quotes_tenant_demand_id_key
      unique (tenant_id, demand_id, id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_options'::regclass
      and conname = 'travel_quote_options_tenant_quote_id_key'
  ) then
    alter table travel_quote_options
      add constraint travel_quote_options_tenant_quote_id_key
      unique (tenant_id, quote_id, id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_selections'::regclass
      and conname = 'travel_quote_selections_demand_quote_scope_fk'
  ) then
    alter table travel_quote_selections
      add constraint travel_quote_selections_demand_quote_scope_fk
      foreign key (tenant_id, demand_id, quote_id)
      references travel_quotes (tenant_id, demand_id, id)
      on delete restrict
      not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_selections'::regclass
      and conname = 'travel_quote_selections_quote_option_scope_fk'
  ) then
    alter table travel_quote_selections
      add constraint travel_quote_selections_quote_option_scope_fk
      foreign key (tenant_id, quote_id, option_id)
      references travel_quote_options (tenant_id, quote_id, id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table travel_quote_selections
  validate constraint travel_quote_selections_demand_quote_scope_fk;
alter table travel_quote_selections
  validate constraint travel_quote_selections_quote_option_scope_fk;

create index if not exists travel_quotes_manual_demand_status_idx
  on travel_quotes (tenant_id, demand_id, status, created_at desc)
  where provider = 'manual-offline';

create index if not exists travel_quote_selections_quote_status_idx
  on travel_quote_selections (tenant_id, quote_id, status, chosen_at desc);

commit;
