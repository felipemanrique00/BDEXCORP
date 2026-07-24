begin;

alter table demands
  add column if not exists create_idempotency_key text,
  add column if not exists create_input_hash char(64),
  add column if not exists submitted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demands_create_idempotency_pair_check'
      and conrelid = 'demands'::regclass
  ) then
    alter table demands
      add constraint demands_create_idempotency_pair_check
      check (
        (create_idempotency_key is null and create_input_hash is null)
        or
        (
          create_idempotency_key is not null
          and length(create_idempotency_key) between 8 and 200
          and create_input_hash ~ '^[0-9a-f]{64}$'
        )
      );
  end if;
end;
$$;

create unique index if not exists demands_create_idempotency_uidx
  on demands (tenant_id, create_idempotency_key)
  where create_idempotency_key is not null;

create index if not exists demands_lifecycle_queue_idx
  on demands (tenant_id, company_id, lifecycle_status, created_at desc)
  where deleted_at is null;

commit;
