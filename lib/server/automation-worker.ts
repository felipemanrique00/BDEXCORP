import 'server-only'

import { resolveAutomationExecutorPrincipal } from '@/lib/server/auth-service'
import { processAutomationEvents } from '@/lib/server/automation-service'
import { databaseConfigured, queryDatabase, withTenantTransaction } from '@/lib/server/database'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError, logInfo, logWarn } from '@/lib/server/logger'

interface AutomationWorkerTarget {
  automation_id: string
  actor_user_id: string
}

export interface AutomationWorkerCycleOptions {
  tenantIds?: string[]
  limit?: number
}

export interface AutomationWorkerCycleResult {
  tenants: number
  definitions: number
  claimed: number
  completed: number
  skipped: number
  failed: number
  errors: number
}

interface AutomationWorkerRuntime {
  timer: ReturnType<typeof setInterval>
  running: boolean
}

const WORKER_RUNTIME_KEY = '__bbtAutomationWorkerRuntime'

export async function runAutomationWorkerCycle(
  options: AutomationWorkerCycleOptions = {},
): Promise<AutomationWorkerCycleResult> {
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 25)))
  const tenants = await queryDatabase<{ id: string }>(
    `select id
     from tenants
     where status in ('active', 'trial')
       and ($1::uuid[] is null or id = any($1::uuid[]))
     order by created_at, id`,
    [options.tenantIds?.length ? options.tenantIds : null],
  )
  const result: AutomationWorkerCycleResult = {
    tenants: tenants.rows.length,
    definitions: 0,
    claimed: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    errors: 0,
  }

  for (const tenant of tenants.rows) {
    if (result.claimed >= limit) break
    const targets = await loadWorkerTargets(tenant.id)
    result.definitions += targets.length
    for (const target of targets) {
      if (result.claimed >= limit) break
      try {
        const principal = await resolveAutomationExecutorPrincipal(
          target.actor_user_id,
          tenant.id,
        )
        if (!principal) {
          result.errors += 1
          logWarn('automation_worker_executor_unavailable', {
            tenantId: tenant.id,
            userId: target.actor_user_id,
            automationId: target.automation_id,
            errorCode: 'AUTOMATION_EXECUTOR_UNAVAILABLE',
          })
          continue
        }
        const processed = await processAutomationEvents(
          principal,
          limit - result.claimed,
          { definitionId: target.automation_id },
        )
        result.claimed += processed.claimed
        result.completed += processed.completed
        result.skipped += processed.skipped
        result.failed += processed.failed
      } catch (error) {
        result.errors += 1
        logError('automation_worker_definition_failed', error, {
          tenantId: tenant.id,
          userId: target.actor_user_id,
          automationId: target.automation_id,
          errorCode: 'AUTOMATION_WORKER_DEFINITION_FAILED',
        })
      }
    }
  }
  return result
}

export function startAutomationWorker(): void {
  const globalRuntime = globalThis as typeof globalThis & {
    [WORKER_RUNTIME_KEY]?: AutomationWorkerRuntime
  }
  if (globalRuntime[WORKER_RUNTIME_KEY]) return

  const environment = getServerEnvironment()
  if (!environment.AUTOMATION_WORKER_ENABLED || !databaseConfigured()) {
    logInfo('automation_worker_disabled', {
      configured: databaseConfigured(),
      enabled: environment.AUTOMATION_WORKER_ENABLED,
    })
    return
  }

  const runtime: AutomationWorkerRuntime = {
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    running: false,
  }
  const execute = async () => {
    if (runtime.running) return
    runtime.running = true
    try {
      const result = await runAutomationWorkerCycle({
        limit: environment.AUTOMATION_WORKER_BATCH_SIZE,
      })
      if (result.claimed || result.errors) {
        logInfo('automation_worker_cycle_completed', { ...result })
      }
    } catch (error) {
      logError('automation_worker_cycle_failed', error, {
        errorCode: 'AUTOMATION_WORKER_CYCLE_FAILED',
      })
    } finally {
      runtime.running = false
    }
  }

  runtime.timer = setInterval(() => {
    void execute()
  }, environment.AUTOMATION_WORKER_INTERVAL_MS)
  runtime.timer.unref()
  globalRuntime[WORKER_RUNTIME_KEY] = runtime

  const startup = setTimeout(() => {
    void execute()
  }, Math.min(2_000, environment.AUTOMATION_WORKER_INTERVAL_MS))
  startup.unref()
  logInfo('automation_worker_started', {
    intervalMs: environment.AUTOMATION_WORKER_INTERVAL_MS,
    batchSize: environment.AUTOMATION_WORKER_BATCH_SIZE,
  })
}

export function stopAutomationWorker(): void {
  const globalRuntime = globalThis as typeof globalThis & {
    [WORKER_RUNTIME_KEY]?: AutomationWorkerRuntime
  }
  const runtime = globalRuntime[WORKER_RUNTIME_KEY]
  if (!runtime) return
  clearInterval(runtime.timer)
  delete globalRuntime[WORKER_RUNTIME_KEY]
}

async function loadWorkerTargets(tenantId: string): Promise<AutomationWorkerTarget[]> {
  return withTenantTransaction(tenantId, async (client) => (
    await client.query<AutomationWorkerTarget>(
      `select
         definition.id as automation_id,
         coalesce(
           version.published_by,
           version.approved_by,
           version.reviewed_by,
           version.created_by,
           definition.created_by
         ) as actor_user_id
       from automation_definitions definition
       join automation_versions version
         on version.tenant_id = definition.tenant_id
        and version.automation_definition_id = definition.id
        and version.version_number = definition.published_version
       where definition.tenant_id = $1
         and definition.status = 'published'
         and version.status = 'published'
         and (version.valid_from is null or version.valid_from <= now())
         and (version.valid_until is null or version.valid_until > now())
         and exists (
           select 1
           from domain_outbox source
           where source.tenant_id = definition.tenant_id
             and source.event_type = version.event_type
             and (source.aggregate_type <> 'demand' or not exists (
               select 1
               from demands guarded_demand
               join company_portal_travel_orders guarded_order
                 on guarded_order.tenant_id = guarded_demand.tenant_id
                and guarded_order.id = guarded_demand.travel_order_id
               where guarded_demand.tenant_id = source.tenant_id
                 and guarded_demand.id = source.aggregate_id
                 and guarded_order.status <> 'submitted'
             ))
             and source.created_at >= coalesce(
               version.valid_from,
               version.published_at,
               version.created_at
             )
             and (version.valid_until is null or source.created_at < version.valid_until)
             and not exists (
               select 1
               from automation_runs run
               where run.tenant_id = definition.tenant_id
                 and run.automation_definition_id = definition.id
                 and run.source_outbox_event_id = source.id
             )
         )
       order by definition.updated_at, definition.id`,
      [tenantId],
    )
  ).rows)
}
