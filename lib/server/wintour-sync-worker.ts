import 'server-only'

import { databaseConfigured } from '@/lib/server/database'
import { getServerEnvironment } from '@/lib/server/environment'
import { logInfo, logWarn } from '@/lib/server/logger'
import {
  runWintourSyncCycle,
  type WintourSyncRunnerOptions,
  type WintourSyncRunnerResult,
} from '@/lib/server/wintour-sync-runner'

interface WintourWorkerRuntime {
  timer: ReturnType<typeof setInterval>
  startup: ReturnType<typeof setTimeout>
  running: boolean
}

const WINTOUR_WORKER_RUNTIME_KEY = '__bbtWintourSyncWorkerRuntime'

export async function runWintourSyncWorkerCycle(
  options: WintourSyncRunnerOptions = {},
): Promise<WintourSyncRunnerResult> {
  return runWintourSyncCycle(options)
}

export function startWintourSyncWorker(): void {
  const globalRuntime = globalThis as typeof globalThis & {
    [WINTOUR_WORKER_RUNTIME_KEY]?: WintourWorkerRuntime
  }
  if (globalRuntime[WINTOUR_WORKER_RUNTIME_KEY]) return

  let environment: ReturnType<typeof getServerEnvironment>
  try {
    environment = getServerEnvironment()
  } catch {
    logWarn('wintour_sync_worker_disabled', {
      errorCode: 'WINTOUR_ENVIRONMENT_INVALID',
    })
    return
  }
  const configured = databaseConfigured()
  if (!environment.WINTOUR_SYNC_ENABLED || !environment.WINTOUR_PIN?.trim() || !configured) {
    logInfo('wintour_sync_worker_disabled', {
      configured,
      enabled: environment.WINTOUR_SYNC_ENABLED,
      credentialConfigured: Boolean(environment.WINTOUR_PIN?.trim()),
    })
    return
  }

  const runtime: WintourWorkerRuntime = {
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    startup: undefined as unknown as ReturnType<typeof setTimeout>,
    running: false,
  }
  const execute = async () => {
    if (runtime.running) return
    runtime.running = true
    try {
      const result = await runWintourSyncWorkerCycle({
        limit: environment.WINTOUR_WORKER_BATCH_SIZE,
      })
      if (result.claimed || result.pollClaimed || result.errors
          || result.ambiguous || result.manualReview || result.pollManualReview || result.pollFailed) {
        logInfo('wintour_sync_worker_cycle_completed', { ...result })
      }
    } catch {
      logWarn('wintour_sync_worker_cycle_failed', {
        errorCode: 'WINTOUR_WORKER_CYCLE_FAILED',
      })
    } finally {
      runtime.running = false
    }
  }

  runtime.timer = setInterval(() => {
    void execute()
  }, environment.WINTOUR_WORKER_INTERVAL_MS)
  unrefTimer(runtime.timer)
  runtime.startup = setTimeout(() => {
    void execute()
  }, Math.min(2_000, environment.WINTOUR_WORKER_INTERVAL_MS))
  unrefTimer(runtime.startup)
  globalRuntime[WINTOUR_WORKER_RUNTIME_KEY] = runtime

  logInfo('wintour_sync_worker_started', {
    intervalMs: environment.WINTOUR_WORKER_INTERVAL_MS,
    batchSize: environment.WINTOUR_WORKER_BATCH_SIZE,
    autoSendEnabled: environment.WINTOUR_AUTO_SEND,
    protocolPollEnabled: environment.WINTOUR_PROTOCOL_POLL_ENABLED,
  })
}

export function stopWintourSyncWorker(): void {
  const globalRuntime = globalThis as typeof globalThis & {
    [WINTOUR_WORKER_RUNTIME_KEY]?: WintourWorkerRuntime
  }
  const runtime = globalRuntime[WINTOUR_WORKER_RUNTIME_KEY]
  if (!runtime) return
  clearInterval(runtime.timer)
  clearTimeout(runtime.startup)
  delete globalRuntime[WINTOUR_WORKER_RUNTIME_KEY]
}

function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}
