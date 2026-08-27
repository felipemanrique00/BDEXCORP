begin;

do $$
declare
  constraint_name text;
begin
  select constraint_row.conname
    into constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'support_impersonations'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) ilike '%allowed_actions%'
  limit 1;

  if constraint_name is null then
    raise exception 'support_impersonations allowed_actions constraint was not found';
  end if;

  execute format(
    'alter table support_impersonations drop constraint %I',
    constraint_name
  );
end;
$$;

alter table support_impersonations
  add constraint support_impersonations_allowed_actions_check
  check (
    allowed_actions <@ array[
      'demand.create',
      'demand.correct',
      'quote.select',
      'approval.decide'
    ]::text[]
    and (
      (mode = 'test' and cardinality(allowed_actions) = 0)
      or (mode = 'operate' and cardinality(allowed_actions) > 0)
    )
  );

commit;
