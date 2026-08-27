import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  databaseConfigured: vi.fn(),
  getServerEnvironment: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  runWintourSyncCycle: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({ databaseConfigured: mocks.databaseConfigured }))
vi.mock('@/lib/server/environment', () => ({ getServerEnvironment: mocks.getServerEnvironment }))
vi.mock('@/lib/server/logger', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn }))
vi.mock('@/lib/server/wintour-sync-runner', () => ({ runWintourSyncCycle: mocks.runWintourSyncCycle }))

import {
  startWintourSyncWorker,
  stopWintourSyncWorker,
} from '@/lib/server/wintour-sync-worker'

describe('Wintour sync worker scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stopWintourSyncWorker()
    mocks.databaseConfigured.mockReturnValue(true)
    mocks.getServerEnvironment.mockReturnValue(environment())
    mocks.runWintourSyncCycle.mockResolvedValue(cycleResult())
  })

  afterEach(() => {
    stopWintourSyncWorker()
    vi.useRealTimers()
  })

  it('does not schedule a cycle without the absolute feature/credential/database gate', async () => {
    mocks.getServerEnvironment.mockReturnValue(environment({ WINTOUR_SYNC_ENABLED: false }))

    startWintourSyncWorker()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(mocks.runWintourSyncCycle).not.toHaveBeenCalled()
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'wintour_sync_worker_disabled',
      expect.objectContaining({ enabled: false }),
    )
  })

  it('is global single-flight across duplicate starts and overlapping timer ticks', async () => {
    let release: (() => void) | undefined
    mocks.runWintourSyncCycle.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(cycleResult({ claimed: 1, received: 1 }))
    }))

    startWintourSyncWorker()
    startWintourSyncWorker()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.runWintourSyncCycle).toHaveBeenCalledOnce()
    release?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.runWintourSyncCycle).toHaveBeenCalledTimes(2)
  })

  it('never includes the integration credential in worker logs', async () => {
    startWintourSyncWorker()
    await vi.advanceTimersByTimeAsync(2_000)

    const logs = JSON.stringify([
      ...mocks.logInfo.mock.calls,
      ...mocks.logWarn.mock.calls,
    ])
    expect(logs).not.toContain('secret-pin')
  })

  it('is registered alongside the existing automation worker', () => {
    const instrumentation = fs.readFileSync(
      path.resolve(process.cwd(), 'instrumentation-node.ts'),
      'utf8',
    )
    expect(instrumentation).toContain("import { startWintourSyncWorker } from '@/lib/server/wintour-sync-worker'")
    expect(instrumentation).toContain('startAutomationWorker()')
    expect(instrumentation).toContain('startWintourSyncWorker()')
  })
})

function environment(overrides: Record<string, unknown> = {}) {
  return {
    WINTOUR_SYNC_ENABLED: true,
    WINTOUR_PIN: 'secret-pin',
    WINTOUR_WORKER_INTERVAL_MS: 30_000,
    WINTOUR_WORKER_BATCH_SIZE: 25,
    WINTOUR_AUTO_SEND: true,
    WINTOUR_PROTOCOL_POLL_ENABLED: false,
    ...overrides,
  }
}

function cycleResult(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    databaseReady: true,
    targets: 1,
    discovered: 0,
    discoveryCreated: 0,
    discoveryRefreshed: 0,
    recovered: 0,
    prepared: 0,
    claimed: 0,
    received: 0,
    ambiguous: 0,
    manualReview: 0,
    failed: 0,
    pollClaimed: 0,
    pollCompleted: 0,
    pollProcessing: 0,
    pollManualReview: 0,
    pollFailed: 0,
    errors: 0,
    ...overrides,
  }
}
