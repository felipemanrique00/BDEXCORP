begin;

-- O lifecycle relacional e a fonte de verdade. O status operacional existe
-- somente como projecao de compatibilidade para filas e relatorios legados.
with projected as materialized (
  select
    tenant_id,
    id,
    status as previous_status,
    case
      when lifecycle_status in ('draft', 'submitted') then 'pendente'
      when lifecycle_status in ('pending_merit_approval', 'pending_choice', 'pending_cost_approval') then 'aguardando_cliente'
      when lifecycle_status in ('issued', 'refunded', 'closed') then 'finalizado'
      when lifecycle_status in ('rejected', 'canceled', 'expired') then 'cancelado'
      else 'em_andamento'
    end as projected_status
  from demands
  where deleted_at is null
), repaired as (
  update demands demand
  set
    status = projected.projected_status,
    metadata = coalesce(demand.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacySnapshot',
      case
        when projected.projected_status = 'finalizado' then
          coalesce(demand.metadata -> 'legacySnapshot', '{}'::jsonb)
          || jsonb_build_object(
            'status', projected.projected_status,
            'finalizado_em', coalesce(
              demand.metadata #>> '{legacySnapshot,finalizado_em}',
              demand.last_transition_at::text,
              now()::text
            )
          )
        else
          (coalesce(demand.metadata -> 'legacySnapshot', '{}'::jsonb) - 'finalizado_em')
          || jsonb_build_object('status', projected.projected_status)
      end
    ),
    version = demand.version + 1,
    updated_at = now()
  from projected
  where demand.tenant_id = projected.tenant_id
    and demand.id = projected.id
    and (
      demand.status is distinct from projected.projected_status
      or demand.metadata #>> '{legacySnapshot,status}' is distinct from projected.projected_status
    )
  returning
    demand.tenant_id,
    demand.id,
    projected.previous_status,
    projected.projected_status,
    demand.lifecycle_status,
    demand.version
)
insert into demand_events (
  tenant_id,
  demand_id,
  actor_user_id,
  event_type,
  from_status,
  to_status,
  data
)
select
  tenant_id,
  id,
  null,
  'operational_status_reconciled',
  previous_status,
  projected_status,
  jsonb_build_object(
    'source', 'migration:0067',
    'lifecycleStatus', lifecycle_status,
    'resultingVersion', version
  )
from repaired;

commit;
