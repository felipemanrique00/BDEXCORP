begin;

-- A reserva operacional precisa apontar para a escolha formal que foi
-- apresentada e, quando aplicavel, aprovada. Mantemos a coluna anulavel para
-- preservar reservas legadas e os demais servicos que ainda usam a cotacao
-- offline sintetica.
alter table reservations
  add column if not exists quote_selection_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'travel_quote_selections'::regclass
      and conname = 'travel_quote_selections_fulfillment_scope_key'
  ) then
    alter table travel_quote_selections
      add constraint travel_quote_selections_fulfillment_scope_key
      unique (tenant_id, demand_id, quote_id, option_id, id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'reservations'::regclass
      and conname = 'reservations_selected_quote_pair_check'
  ) then
    alter table reservations
      add constraint reservations_selected_quote_pair_check
      check (
        (selected_quote_id is null and selected_quote_option_id is null)
        or (selected_quote_id is not null and selected_quote_option_id is not null)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'reservations'::regclass
      and conname = 'reservations_quote_selection_requires_quote_check'
  ) then
    alter table reservations
      add constraint reservations_quote_selection_requires_quote_check
      check (
        quote_selection_id is null
        or (
          demand_id is not null
          and selected_quote_id is not null
          and selected_quote_option_id is not null
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'reservations'::regclass
      and conname = 'reservations_quote_selection_scope_fk'
  ) then
    alter table reservations
      add constraint reservations_quote_selection_scope_fk
      foreign key (
        tenant_id,
        demand_id,
        selected_quote_id,
        selected_quote_option_id,
        quote_selection_id
      ) references travel_quote_selections (
        tenant_id,
        demand_id,
        quote_id,
        option_id,
        id
      ) on delete restrict
      not valid;
  end if;
end;
$$;

alter table reservations
  validate constraint reservations_selected_quote_pair_check;
alter table reservations
  validate constraint reservations_quote_selection_requires_quote_check;
alter table reservations
  validate constraint reservations_quote_selection_scope_fk;

create unique index if not exists reservations_quote_selection_uidx
  on reservations (tenant_id, quote_selection_id)
  where quote_selection_id is not null;

create index if not exists reservations_selected_quote_scope_idx
  on reservations (tenant_id, demand_id, selected_quote_id, selected_quote_option_id);

commit;
