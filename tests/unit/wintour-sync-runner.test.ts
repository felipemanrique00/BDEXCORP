import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  WintourSoapError,
  type WintourSoapRequest,
} from '@/lib/integrations/wintour/wintour-soap'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  runWintourSyncCycle,
  pollClaimedWintourJob,
  submitClaimedWintourJob,
  type WintourSyncRunnerDependencies,
} from '@/lib/server/wintour-sync-runner'
import type {
  ClaimedWintourPollJob,
  ClaimedWintourSyncJob,
  WintourSyncJobSummary,
  WintourWorkerTarget,
} from '@/lib/wintour-sync'

describe('Wintour sync runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does no database work or network when the absolute flag/credential gate is closed', async () => {
    const disabled = dependencies({ environment: { WINTOUR_SYNC_ENABLED: false } })
    const missingCredential = dependencies({ environment: { WINTOUR_PIN: undefined } })
    const missingTenantBinding = dependencies({ environment: { WINTOUR_TENANT_ID: undefined } })

    const first = await runWintourSyncCycle({}, disabled.value)
    const second = await runWintourSyncCycle({}, missingCredential.value)
    const third = await runWintourSyncCycle({}, missingTenantBinding.value)

    expect(first.enabled).toBe(false)
    expect(second.enabled).toBe(false)
    expect(third.enabled).toBe(false)
    expect(disabled.spies.listTargets).not.toHaveBeenCalled()
    expect(missingCredential.spies.listTargets).not.toHaveBeenCalled()
    expect(missingTenantBinding.spies.listTargets).not.toHaveBeenCalled()
    expect(disabled.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(missingCredential.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(disabled.spies.claimPollJobs).not.toHaveBeenCalled()
    expect(missingCredential.spies.claimPollJobs).not.toHaveBeenCalled()
    expect(missingTenantBinding.spies.claimPollJobs).not.toHaveBeenCalled()
  })

  it('uses the global credential only for its explicitly bound tenant', async () => {
    const fixture = dependencies({
      listTargets: vi.fn().mockResolvedValue([
        target('tenant-a', 'user-a'),
        target('tenant-b', 'user-b'),
      ]),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result.targets).toBe(1)
    expect(fixture.spies.resolvePrincipal).toHaveBeenCalledOnce()
    expect(fixture.spies.resolvePrincipal).toHaveBeenCalledWith('user-a', 'tenant-a')
  })

  it('discovers issued sales but never claims or calls SOAP when auto-send is gated off', async () => {
    const fixture = dependencies({ environment: { WINTOUR_AUTO_SEND: false } })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ targets: 1, discovered: 2, discoveryCreated: 1, claimed: 0 })
    expect(fixture.spies.discover).toHaveBeenCalledOnce()
    expect(fixture.spies.claim).not.toHaveBeenCalled()
    expect(fixture.spies.executeSoapRequest).not.toHaveBeenCalled()
  })

  it('prepares, claims and records a non-empty submission protocol exactly once', async () => {
    const order: string[] = []
    const fixture = dependencies({
      prepareReadyJobs: vi.fn().mockResolvedValue({ prepared: 1 }),
      claim: vi.fn().mockResolvedValueOnce([claimedJob()]).mockResolvedValue([]),
      buildCreateRequest: vi.fn((input) => {
        expect(input).toMatchObject({ pin: 'secret-pin', xml: '<raiz>ação</raiz>' })
        order.push('build')
        return soapRequest('create-sales')
      }),
      executeSoapRequest: vi.fn().mockImplementation(async () => {
        order.push('execute')
        return {
          operation: 'create-sales',
          endpoint: 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
          value: 'PROTO-123',
          protocol: 'PROTO-123',
          httpStatus: 200,
          durationMs: 15,
        }
      }),
      recordSubmissionSuccess: vi.fn().mockImplementation(async (_principal, input) => {
        order.push('submission-success')
        expect(input).toMatchObject({
          protocolCode: 'PROTO-123',
          expectedJobVersion: 1,
          expectedAttemptVersion: 1,
        })
        expect(input.redactedPayload).not.toHaveProperty('xml')
        return jobSummary(2, 'received')
      }),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ prepared: 1, claimed: 1, received: 1, ambiguous: 0 })
    expect(order).toEqual(['build', 'execute', 'submission-success'])
    expect(fixture.spies.executeSoapRequest).toHaveBeenCalledOnce()
    expect(fixture.spies.recordAttempt).not.toHaveBeenCalled()
    expect(fixture.spies.claim).toHaveBeenCalledWith(expect.anything(), {
      limit: 1,
      leaseSeconds: 35,
    })
    expect(JSON.stringify(fixture.spies.warn.mock.calls)).not.toContain('secret-pin')
    expect(JSON.stringify(fixture.spies.warn.mock.calls)).not.toContain('<raiz>')
  })

  it('recovers, discovers and prepares through service exports before claiming', async () => {
    const order: string[] = []
    const fixture = dependencies({
      recoverStaleJobs: vi.fn().mockImplementation(async () => {
        order.push('recover')
        return { recovered: 1, jobIds: ['job-stale'] }
      }),
      discover: vi.fn().mockImplementation(async () => {
        order.push('discover')
        return { scanned: 1, created: 1, refreshed: 0, ready: 1, blocked: 0 }
      }),
      prepareReadyJobs: vi.fn().mockImplementation(async () => {
        order.push('prepare')
        return { scanned: 1, prepared: 1, replayed: 0, blocked: 0 }
      }),
      claim: vi.fn().mockImplementation(async () => {
        order.push('claim')
        return []
      }),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ recovered: 1, prepared: 1 })
    expect(order).toEqual(['recover', 'discover', 'prepare', 'claim'])
  })

  it('marks timeout/network/5xx mutation outcomes ambiguous and never retries them', async () => {
    const fixture = dependencies({
      prepareReadyJobs: vi.fn().mockResolvedValue({ prepared: 0 }),
      claim: vi.fn().mockResolvedValueOnce([claimedJob()]).mockResolvedValue([]),
      executeSoapRequest: vi.fn().mockRejectedValue(new WintourSoapError(
        'unknown result',
        {
          code: 'WINTOUR_SOAP_TIMEOUT',
          operation: 'create-sales',
          ambiguous: true,
          retryable: false,
        },
      )),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ claimed: 1, ambiguous: 1, received: 0 })
    expect(fixture.spies.executeSoapRequest).toHaveBeenCalledOnce()
    expect(fixture.spies.recordAttempt).toHaveBeenCalledOnce()
    expect(fixture.spies.recordAttempt.mock.calls[0][1]).toMatchObject({
      state: 'ambiguous',
      errorCode: 'WINTOUR_SOAP_TIMEOUT',
    })
    expect(fixture.spies.recordSubmissionSuccess).not.toHaveBeenCalled()
    expect(fixture.spies.claim).toHaveBeenCalledTimes(2)
  })

  it('claims and submits mutations one at a time so queued jobs never age under one lease', async () => {
    const first = claimedJob({
      id: '11111111-1111-4111-8111-111111111111',
      attemptId: '33333333-3333-4333-8333-333333333331',
      leaseToken: '44444444-4444-4444-8444-444444444441',
    })
    const second = claimedJob({
      id: '11111111-1111-4111-8111-111111111112',
      attemptId: '33333333-3333-4333-8333-333333333332',
      leaseToken: '44444444-4444-4444-8444-444444444442',
    })
    const claim = vi.fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValue([])
    const fixture = dependencies({ claim })

    const result = await runWintourSyncCycle({ limit: 2 }, fixture.value)

    expect(result).toMatchObject({ claimed: 2, received: 2 })
    expect(claim).toHaveBeenCalledTimes(2)
    expect(claim.mock.calls.every((call) => call[1].limit === 1)).toBe(true)
    expect(fixture.spies.executeSoapRequest).toHaveBeenCalledTimes(2)
  })

  it('never performs a mutation when the claimed lease cannot cover the SOAP timeout', async () => {
    const fixture = dependencies()
    const job = claimedJob({ leaseExpiresAt: new Date(Date.now() + 4_000).toISOString() })

    const outcome = await submitClaimedWintourJob(
      principal(),
      job,
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('failed')
    expect(fixture.spies.buildCreateRequest).not.toHaveBeenCalled()
    expect(fixture.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(fixture.spies.recordAttempt.mock.calls[0][1]).toMatchObject({
      state: 'failed',
      errorCode: 'WINTOUR_LEASE_EXPIRED_BEFORE_SEND',
    })
  })

  it('fails closed as ambiguous when atomic success persistence has an unknown outcome', async () => {
    const fixture = dependencies({
      recordSubmissionSuccess: vi.fn().mockRejectedValue(new Error('database response lost')),
    })

    const outcome = await submitClaimedWintourJob(
      principal(),
      claimedJob(),
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('ambiguous')
    expect(fixture.spies.recordSubmissionSuccess).toHaveBeenCalledOnce()
    expect(fixture.spies.recordAttempt.mock.calls[0][1]).toMatchObject({
      state: 'ambiguous',
      errorCode: 'WINTOUR_SUBMISSION_PERSISTENCE_UNKNOWN',
    })
    expect(JSON.stringify(fixture.spies.warn.mock.calls)).not.toContain('database response lost')
  })

  it('sends an explicit SOAP rejection to manual review without retrying', async () => {
    const fixture = dependencies({
      executeSoapRequest: vi.fn().mockRejectedValue(new WintourSoapError(
        'private fault detail',
        {
          code: 'WINTOUR_SOAP_FAULT',
          operation: 'create-sales',
          ambiguous: false,
          retryable: false,
        },
      )),
    })

    const outcome = await submitClaimedWintourJob(
      principal(),
      claimedJob(),
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('manualReview')
    expect(fixture.spies.recordAttempt.mock.calls[0][1]).toMatchObject({
      state: 'manual_review',
      errorCode: 'WINTOUR_SOAP_FAULT',
    })
    expect(fixture.spies.executeSoapRequest).toHaveBeenCalledOnce()
    expect(fixture.spies.recordSubmissionSuccess).not.toHaveBeenCalled()
  })

  it('isolates discovery failure in the bound tenant and logs only safe context', async () => {
    const targets = [target('tenant-a', 'user-a')]
    const discover = vi.fn().mockRejectedValueOnce(new Error('passenger private payload'))
    const fixture = dependencies({
      environment: { WINTOUR_AUTO_SEND: false },
      listTargets: vi.fn().mockResolvedValue(targets),
      discover,
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ targets: 1, discovered: 0, errors: 1 })
    expect(discover).toHaveBeenCalledOnce()
    const serializedLogs = JSON.stringify(fixture.spies.warn.mock.calls)
    expect(serializedLogs).toContain('WINTOUR_DISCOVERY_FAILED')
    expect(serializedLogs).not.toContain('passenger private payload')
  })

  it('does not prepare or send when source discovery fails, but still polls an existing protocol', async () => {
    const fixture = dependencies({
      environment: {
        WINTOUR_AUTO_SEND: true,
        WINTOUR_PROTOCOL_POLL_ENABLED: true,
      },
      listTargets: vi.fn().mockResolvedValue([{ ...target(), autoSend: true, autoPoll: true }]),
      discover: vi.fn().mockRejectedValue(new Error('source unavailable')),
      claimPollJobs: vi.fn().mockResolvedValue([]),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ targets: 1, discovered: 0, errors: 1, claimed: 0 })
    expect(fixture.spies.prepareReadyJobs).not.toHaveBeenCalled()
    expect(fixture.spies.claim).not.toHaveBeenCalled()
    expect(fixture.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(fixture.spies.claimPollJobs).toHaveBeenCalledOnce()
  })

  it('does not claim or query protocols unless both environment and tenant auto-poll gates are open', async () => {
    const environmentOff = dependencies({
      environment: {
        WINTOUR_AUTO_SEND: false,
        WINTOUR_PROTOCOL_POLL_ENABLED: false,
      },
      listTargets: vi.fn().mockResolvedValue([{ ...target(), autoPoll: true }]),
    })
    const tenantOff = dependencies({
      environment: {
        WINTOUR_AUTO_SEND: false,
        WINTOUR_PROTOCOL_POLL_ENABLED: true,
      },
      listTargets: vi.fn().mockResolvedValue([{ ...target(), autoSend: false, autoPoll: false }]),
    })

    const first = await runWintourSyncCycle({}, environmentOff.value)
    const second = await runWintourSyncCycle({}, tenantOff.value)

    expect(first.pollClaimed).toBe(0)
    expect(second.pollClaimed).toBe(0)
    expect(environmentOff.spies.claimPollJobs).not.toHaveBeenCalled()
    expect(tenantOff.spies.claimPollJobs).not.toHaveBeenCalled()
    expect(environmentOff.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(tenantOff.spies.executeSoapRequest).not.toHaveBeenCalled()
  })

  it('polls a processed creation and binds only one strictly parsed Wintour sale number', async () => {
    const fixture = dependencies({
      environment: {
        WINTOUR_AUTO_SEND: false,
        WINTOUR_PROTOCOL_POLL_ENABLED: true,
      },
      listTargets: vi.fn().mockResolvedValue([{ ...target(), autoSend: false, autoPoll: true }]),
      claimPollJobs: vi.fn().mockResolvedValueOnce([claimedPollJob()]).mockResolvedValue([]),
      executeSoapRequest: vi.fn().mockResolvedValue({
        operation: 'query-creation-protocol',
        endpoint: 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
        value: 'processed',
        protocol: 'PROTO-123',
        protocolDetail: creationProtocolDetail({ launchedSaleNumbers: '987654' }),
        httpStatus: 200,
        durationMs: 12,
      }),
    })

    const result = await runWintourSyncCycle({}, fixture.value)

    expect(result).toMatchObject({ pollClaimed: 1, pollCompleted: 1, pollManualReview: 0 })
    expect(fixture.spies.buildCreateProtocolRequest).toHaveBeenCalledWith({
      pin: 'secret-pin',
      protocol: 'PROTO-123',
    })
    expect(fixture.spies.recordPollResult).toHaveBeenCalledOnce()
    expect(fixture.spies.recordPollResult.mock.calls[0][1]).toMatchObject({
      state: 'completed',
      protocolCode: 'PROTO-123',
      wintourSaleNumber: '987654',
    })
    const persisted = fixture.spies.recordPollResult.mock.calls[0][1]
    expect(persisted.redactedPayload).not.toHaveProperty('description')
    expect(persisted.redactedPayload).not.toHaveProperty('lastError')
  })

  it('shares the per-cycle batch budget between submission and polling for the bound tenant', async () => {
    const fixture = dependencies({
      environment: {
        WINTOUR_AUTO_SEND: true,
        WINTOUR_PROTOCOL_POLL_ENABLED: true,
      },
      listTargets: vi.fn().mockResolvedValue([{ ...target(), autoSend: true, autoPoll: true }]),
      claim: vi.fn().mockResolvedValueOnce([claimedJob()]),
      claimPollJobs: vi.fn().mockResolvedValueOnce([claimedPollJob()]),
    })

    const result = await runWintourSyncCycle({ limit: 1 }, fixture.value)

    expect(result).toMatchObject({ targets: 1, claimed: 1, received: 1, pollClaimed: 0 })
    expect(fixture.spies.claim).toHaveBeenCalledOnce()
    expect(fixture.spies.claimPollJobs).not.toHaveBeenCalled()
    expect(fixture.spies.executeSoapRequest).toHaveBeenCalledOnce()
  })

  it('sends ambiguous creation sale-number lists to manual review instead of guessing', async () => {
    const fixture = dependencies({
      executeSoapRequest: vi.fn().mockResolvedValue({
        operation: 'query-creation-protocol',
        endpoint: 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
        value: 'processed',
        protocol: 'PROTO-123',
        protocolDetail: creationProtocolDetail({
          launchedSalesCount: 2,
          launchedSaleNumbers: '987654; 987655',
        }),
        httpStatus: 200,
        durationMs: 12,
      }),
    })

    const outcome = await pollClaimedWintourJob(
      principal(),
      claimedPollJob(),
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('pollManualReview')
    expect(fixture.spies.recordPollResult.mock.calls[0][1]).toMatchObject({
      state: 'manual_review',
      wintourSaleNumber: undefined,
    })
  })

  it('fails closed when a processed update protocol still carries a last error', async () => {
    const fixture = dependencies({
      executeSoapRequest: vi.fn().mockResolvedValue({
        operation: 'query-update-protocol',
        endpoint: 'https://www.digirotas.com/HubInterfacesSoapUpd/soap/IHubInterfacesUpd',
        value: 'processed',
        protocol: 'PROTO-123',
        protocolDetail: {
          kind: 'update',
          protocol: 'PROTO-123',
          status: 'trProcessado',
          description: 'not persisted',
          processedAt: '2026-08-21T12:00:00.000Z',
          lastError: 'upstream detail must not be stored',
        },
        httpStatus: 200,
        durationMs: 12,
      }),
    })

    const outcome = await pollClaimedWintourJob(
      principal(),
      { ...claimedPollJob(), operation: 'update' },
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('pollManualReview')
    expect(fixture.spies.recordPollResult.mock.calls[0][1]).toMatchObject({
      state: 'manual_review',
      redactedPayload: { hasLastError: true },
    })
    expect(JSON.stringify(fixture.spies.recordPollResult.mock.calls)).not.toContain('upstream detail')
  })

  it('keeps a processed update in manual review until a human reconciles the Wintour sale', async () => {
    const fixture = dependencies({
      executeSoapRequest: vi.fn().mockResolvedValue({
        operation: 'query-update-protocol',
        endpoint: 'https://www.digirotas.com/HubInterfacesSoapUpd/soap/IHubInterfacesUpd',
        value: 'processed',
        protocol: 'PROTO-123',
        protocolDetail: {
          kind: 'update',
          protocol: 'PROTO-123',
          status: 'trProcessado',
          description: '',
          processedAt: '2026-08-21T12:00:00.000Z',
          lastError: '',
        },
        httpStatus: 200,
        durationMs: 12,
      }),
    })

    const outcome = await pollClaimedWintourJob(
      principal(),
      { ...claimedPollJob(), operation: 'update' },
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('pollManualReview')
    expect(fixture.spies.recordPollResult.mock.calls[0][1]).toMatchObject({
      state: 'manual_review',
      redactedPayload: {
        hasLastError: false,
        processedByWintour: true,
      },
    })
  })

  it('releases a polling lease as processing after a transient query error without leaking details', async () => {
    const fixture = dependencies({
      executeSoapRequest: vi.fn().mockRejectedValue(new WintourSoapError(
        'private upstream response',
        {
          code: 'WINTOUR_SOAP_TIMEOUT',
          operation: 'query-creation-protocol',
          ambiguous: false,
          retryable: true,
        },
      )),
    })

    const outcome = await pollClaimedWintourJob(
      principal(),
      claimedPollJob(),
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(outcome).toBe('pollProcessing')
    expect(fixture.spies.recordPollResult.mock.calls[0][1]).toMatchObject({
      state: 'processing',
      redactedPayload: { errorCode: 'WINTOUR_SOAP_TIMEOUT' },
    })
    const logs = JSON.stringify(fixture.spies.warn.mock.calls)
    expect(logs).not.toContain('private upstream response')
    expect(logs).not.toContain('secret-pin')
  })

  it('rejects a changed immutable artifact before building a request or using the network', async () => {
    const fixture = dependencies()
    const job = { ...claimedJob(), payloadSha256: '0'.repeat(64) }

    const result = await submitClaimedWintourJob(
      principal(),
      job,
      { pin: 'secret-pin', timeoutMs: 5_000 },
      fixture.value,
    )

    expect(result).toBe('failed')
    expect(fixture.spies.buildCreateRequest).not.toHaveBeenCalled()
    expect(fixture.spies.executeSoapRequest).not.toHaveBeenCalled()
    expect(fixture.spies.recordAttempt.mock.calls[0][1]).toMatchObject({
      state: 'failed',
      errorCode: 'WINTOUR_ARTIFACT_INVALID',
    })
  })
})

function dependencies(overrides: {
  environment?: Partial<ReturnType<typeof baseEnvironment>>
  listTargets?: ReturnType<typeof vi.fn>
  discover?: ReturnType<typeof vi.fn>
  prepareReadyJobs?: WintourSyncRunnerDependencies['prepareReadyJobs']
  recoverStaleJobs?: WintourSyncRunnerDependencies['recoverStaleJobs']
  claim?: ReturnType<typeof vi.fn>
  claimPollJobs?: ReturnType<typeof vi.fn>
  buildCreateRequest?: ReturnType<typeof vi.fn>
  buildCreateProtocolRequest?: ReturnType<typeof vi.fn>
  executeSoapRequest?: ReturnType<typeof vi.fn>
  recordAttempt?: ReturnType<typeof vi.fn>
  recordSubmissionSuccess?: ReturnType<typeof vi.fn>
  recordPollResult?: ReturnType<typeof vi.fn>
} = {}) {
  const spies = {
    listTargets: overrides.listTargets || vi.fn().mockResolvedValue([target()]),
    resolvePrincipal: vi.fn().mockResolvedValue(principal()),
    discover: overrides.discover || vi.fn().mockResolvedValue({
      scanned: 2,
      created: 1,
      refreshed: 1,
      ready: 2,
      blocked: 0,
    }),
    prepareReadyJobs: overrides.prepareReadyJobs || vi.fn().mockResolvedValue({
      scanned: 0,
      prepared: 0,
      replayed: 0,
      blocked: 0,
    }),
    recoverStaleJobs: overrides.recoverStaleJobs || vi.fn().mockResolvedValue({ recovered: 0, jobIds: [] }),
    claim: overrides.claim || vi.fn().mockResolvedValue([]),
    claimPollJobs: overrides.claimPollJobs || vi.fn().mockResolvedValue([]),
    buildCreateRequest: overrides.buildCreateRequest || vi.fn().mockReturnValue(soapRequest('create-sales')),
    buildUpdateRequest: vi.fn().mockReturnValue(soapRequest('update-sales')),
    buildCreateProtocolRequest: overrides.buildCreateProtocolRequest
      || vi.fn().mockReturnValue(soapRequest('query-creation-protocol')),
    buildUpdateProtocolRequest: vi.fn().mockReturnValue(soapRequest('query-update-protocol')),
    executeSoapRequest: overrides.executeSoapRequest || vi.fn().mockResolvedValue({
      operation: 'create-sales',
      endpoint: 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
      value: 'PROTO-123',
      protocol: 'PROTO-123',
      httpStatus: 200,
      durationMs: 10,
    }),
    recordAttempt: overrides.recordAttempt || vi.fn().mockResolvedValue(jobSummary(2, 'received')),
    recordSubmissionSuccess: overrides.recordSubmissionSuccess
      || vi.fn().mockResolvedValue(jobSummary(2, 'received')),
    recordPollResult: overrides.recordPollResult || vi.fn().mockResolvedValue(jobSummary(2, 'processing')),
    warn: vi.fn(),
  }
  const value: WintourSyncRunnerDependencies = {
    getEnvironment: () => ({ ...baseEnvironment(), ...overrides.environment }),
    databaseConfigured: () => true,
    listTargets: spies.listTargets as unknown as WintourSyncRunnerDependencies['listTargets'],
    resolvePrincipal: spies.resolvePrincipal as unknown as WintourSyncRunnerDependencies['resolvePrincipal'],
    discover: spies.discover as unknown as WintourSyncRunnerDependencies['discover'],
    prepareReadyJobs: spies.prepareReadyJobs as unknown as WintourSyncRunnerDependencies['prepareReadyJobs'],
    recoverStaleJobs: spies.recoverStaleJobs as unknown as WintourSyncRunnerDependencies['recoverStaleJobs'],
    claim: spies.claim as unknown as WintourSyncRunnerDependencies['claim'],
    buildCreateRequest: spies.buildCreateRequest as unknown as WintourSyncRunnerDependencies['buildCreateRequest'],
    buildUpdateRequest: spies.buildUpdateRequest as unknown as WintourSyncRunnerDependencies['buildUpdateRequest'],
    claimPollJobs: spies.claimPollJobs as unknown as WintourSyncRunnerDependencies['claimPollJobs'],
    buildCreateProtocolRequest: spies.buildCreateProtocolRequest as unknown as WintourSyncRunnerDependencies['buildCreateProtocolRequest'],
    buildUpdateProtocolRequest: spies.buildUpdateProtocolRequest as unknown as WintourSyncRunnerDependencies['buildUpdateProtocolRequest'],
    executeSoapRequest: spies.executeSoapRequest as unknown as WintourSyncRunnerDependencies['executeSoapRequest'],
    recordAttempt: spies.recordAttempt as unknown as WintourSyncRunnerDependencies['recordAttempt'],
    recordSubmissionSuccess: spies.recordSubmissionSuccess as unknown as WintourSyncRunnerDependencies['recordSubmissionSuccess'],
    recordPollResult: spies.recordPollResult as unknown as WintourSyncRunnerDependencies['recordPollResult'],
    warn: spies.warn,
  }
  return { value, spies }
}

function baseEnvironment() {
  return {
    WINTOUR_SYNC_ENABLED: true,
    WINTOUR_TENANT_ID: 'tenant-a' as string | undefined,
    WINTOUR_AUTO_SEND: true,
    WINTOUR_PROTOCOL_POLL_ENABLED: false,
    WINTOUR_PIN: 'secret-pin' as string | undefined,
    WINTOUR_TIMEOUT_MS: 5_000,
    WINTOUR_WORKER_BATCH_SIZE: 25,
  }
}

function target(tenantId = 'tenant-a', updatedBy = 'user-a'): WintourWorkerTarget {
  return { tenantId, enabled: true, autoSend: true, autoPoll: false, updatedBy }
}

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    user: { id: 'user-a' },
    authenticationLevel: 'system',
  } as RequestPrincipal
}

function claimedJob(overrides: Partial<ClaimedWintourSyncJob> = {}): ClaimedWintourSyncJob {
  const payloadBytes = Uint8Array.from(Buffer.from('<raiz>ação</raiz>', 'latin1'))
  return {
    id: '11111111-1111-4111-8111-111111111111',
    saleLinkId: '22222222-2222-4222-8222-222222222222',
    companyId: 'company-a',
    emissionId: 'emission-a',
    operation: 'create',
    idvExterno: '1',
    wintourSaleNumber: null,
    payloadBytes,
    payloadSha256: createHash('sha256').update(payloadBytes).digest('hex'),
    payloadFilename: 'wintour.xml',
    payloadContentType: 'application/xml',
    serializerVersion: 'wintour-create-v4',
    freeField: null,
    attemptId: '33333333-3333-4333-8333-333333333333',
    attemptNumber: 1,
    leaseToken: '44444444-4444-4444-8444-444444444444',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    jobVersion: 1,
    attemptVersion: 1,
    ...overrides,
  }
}

function claimedPollJob(): ClaimedWintourPollJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    saleLinkId: '22222222-2222-4222-8222-222222222222',
    operation: 'create',
    attemptId: '33333333-3333-4333-8333-333333333333',
    protocolCode: 'PROTO-123',
    pollLeaseToken: '55555555-5555-4555-8555-555555555555',
    pollLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    jobVersion: 4,
  }
}

function creationProtocolDetail(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'creation' as const,
    id: 1,
    protocol: 'PROTO-123',
    status: 'trProcessado' as const,
    description: 'not persisted',
    processedAt: '2026-08-21T12:00:00.000Z',
    lastError: '',
    pendingSalesCount: 0,
    launchedSalesCount: 1,
    launchedSaleNumbers: '987654',
    pendingSales: {
      salesWithError: 0,
      excludedSales: 0,
      deniedDateSales: 0,
    },
    ...overrides,
  }
}

function soapRequest(operation: WintourSoapRequest['operation']): WintourSoapRequest {
  const createEndpoint = operation === 'create-sales' || operation === 'query-creation-protocol'
  return {
    operation,
    endpoint: createEndpoint
      ? 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces'
      : 'https://www.digirotas.com/HubInterfacesSoapUpd/soap/IHubInterfacesUpd',
    soapAction: 'official-action',
    method: 'POST',
    headers: {},
    body: '<soap/>',
    mutation: operation === 'create-sales' || operation === 'update-sales',
    safeMetadata: { operation, endpoint: 'official-endpoint', soapAction: 'official-action', payloadBytes: 1 },
    toJSON() { return this.safeMetadata },
  }
}

function jobSummary(version: number, state: WintourSyncJobSummary['state']): WintourSyncJobSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    saleLinkId: '22222222-2222-4222-8222-222222222222',
    operation: 'create',
    state,
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    latestProtocolCode: null,
    latestProtocolKind: null,
    downloadAvailable: true,
    version,
    preparedAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
  }
}
