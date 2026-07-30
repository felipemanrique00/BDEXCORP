begin;

alter table demand_events
  add column if not exists idempotency_key text,
  add column if not exists input_hash char(64);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demand_events_idempotency_pair_check'
      and conrelid = 'demand_events'::regclass
  ) then
    alter table demand_events
      add constraint demand_events_idempotency_pair_check
      check (
        (idempotency_key is null and input_hash is null)
        or
        (
          idempotency_key is not null
          and length(idempotency_key) between 8 and 200
          and input_hash ~ '^[0-9a-f]{64}$'
        )
      );
  end if;
end;
$$;

create unique index if not exists demand_events_idempotency_uidx
  on demand_events (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists demands_assignment_queue_idx
  on demands (tenant_id, company_id, assigned_to_user_id, status, updated_at desc)
  where deleted_at is null;

commit;
