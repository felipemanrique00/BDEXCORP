begin;

with demand_sequence_maxima as (
  select
    tenant_id,
    'demand-os:' || substring(demand_number from 4 for 8) as sequence_key,
    max((substring(demand_number from '^OS-[0-9]{8}-([0-9]{1,12})$'))::bigint) as current_value
  from demands
  where demand_number ~ '^OS-[0-9]{8}-[0-9]{1,12}$'
  group by tenant_id, substring(demand_number from 4 for 8)
)
insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
select tenant_id, sequence_key, current_value
from demand_sequence_maxima
on conflict (tenant_id, sequence_key) do update set
  current_value = greatest(
    tenant_number_sequences.current_value,
    excluded.current_value
  ),
  updated_at = now();

commit;
