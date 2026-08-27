import 'server-only'

import { createHash } from 'node:crypto'

import type {
  WintourCreationProtocolDetail,
  WintourProtocolDetail,
  WintourSoapExecutionResult,
  WintourSoapRequest,
} from '@/lib/integrations/wintour/wintour-soap'
import {
  WintourSoapError,
  buildWintourCreateProtocolQuerySoapRequest,
  buildWintourCreateSalesSoapRequest,
  buildWintourUpdateProtocolQuerySoapRequest,
  buildWintourUpdateSalesSoapRequest,
  executeWintourSoapRequest,
} from '@/lib/integrations/wintour/wintour-soap'
import { resolveAutomationExecutorPrincipal } from '@/lib/server/auth-service'
import { databaseConfigured } from '@/lib/server/database'
import { getServerEnvironment, type ServerEnvironment } from '@/lib/server/environment'
import { logWarn } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  claimWintourPollJobs,
  claimWintourSyncJobs,
  discoverWintourSyncSales,
  listWintourWorkerTargets,
  prepareReadyWintourSyncJobs,
  recordWintourPollResult,
  recordWintourSubmissionSuccess,
  recordWintourSyncAttemptResult,
  recoverStaleWintourSyncJobs,
} from '@/lib/server/wintour-sync-service'
import type {
  ClaimedWintourPollJob,
  ClaimedWintourSyncJob,
  WintourDiscoveryResult,
  WintourPrepareReadyResult,
  WintourSyncJobSummary,
  WintourWorkerTarget,
} from '@/lib/wintour-sync'

type RunnerEnvironment = Pick<ServerEnvironment,
  | 'WINTOUR_SYNC_ENABLED'
  | 'WINTOUR_TENANT_ID'
  | 'WINTOUR_AUTO_SEND'
  | 'WINTOUR_PROTOCOL_POLL_ENABLED'
  | 'WINTOUR_PIN'
  | 'WINTOUR_TIMEOUT_MS'
  | 'WINTOUR_WORKER_BATCH_SIZE'
>

export interface WintourSyncRunnerOptions {
  tenantIds?: string[]
  limit?: number
}

export interface WintourSyncRunnerResult {
  enabled: boolean
  databaseReady: boolean
  targets: number
  discovered: number
  discoveryCreated: number
  discoveryRefreshed: number
  recovered: number
  prepared: number
  claimed: number
  received: number
  ambiguous: number
  manualReview: number
  failed: number
  pollClaimed: number
  pollCompleted: number
  pollProcessing: number
  pollManualReview: number
  pollFailed: number
  errors: number
}

export interface WintourRecoverStaleResult {
  recovered: number
}

export interface WintourSyncRunnerDependencies {
  getEnvironment(): RunnerEnvironment
  databaseConfigured(): boolean
  listTargets(): Promise<WintourWorkerTarget[]>
  resolvePrincipal(userId: string, tenantId: string): Promise<RequestPrincipal | null>
  discover(principal: RequestPrincipal): Promise<WintourDiscoveryResult>
  prepareReadyJobs(
    principal: RequestPrincipal,
    input: { limit: number },
  ): Promise<WintourPrepareReadyResult>
  recoverStaleJobs(
    principal: RequestPrincipal,
    input: { limit: number },
  ): Promise<WintourRecoverStaleResult>
  claim(
    principal: RequestPrincipal,
    input: { limit: number; leaseSeconds: number },
  ): Promise<ClaimedWintourSyncJob[]>
  buildCreateRequest(input: { pin: string; xml: string; free?: string }): WintourSoapRequest
  buildUpdateRequest(input: { pin: string; xml: string; free?: string }): WintourSoapRequest
  claimPollJobs(
    principal: RequestPrincipal,
    input: { limit: number; leaseSeconds: number },
  ): Promise<ClaimedWintourPollJob[]>
  buildCreateProtocolRequest(input: { pin: string; protocol: string }): WintourSoapRequest
  buildUpdateProtocolRequest(input: { pin: string; protocol: string }): WintourSoapRequest
  executeSoapRequest(
    request: WintourSoapRequest,
    options: { timeoutMs: number },
  ): Promise<WintourSoapExecutionResult>
  recordAttempt(
    principal: RequestPrincipal,
    input: Parameters<typeof recordWintourSyncAttemptResult>[1],
  ): Promise<WintourSyncJobSummary>
  recordSubmissionSuccess(
    principal: RequestPrincipal,
    input: Parameters<typeof recordWintourSubmissionSuccess>[1],
  ): Promise<WintourSyncJobSummary>
  recordPollResult(
    principal: RequestPrincipal,
    input: Parameters<typeof recordWintourPollResult>[1],
  ): Promise<WintourSyncJobSummary>
  warn(message: string, context: Record<string, unknown>): void
}

const DEFAULT_DEPENDENCIES: WintourSyncRunnerDependencies = {
  getEnvironment: getServerEnvironment,
  databaseConfigured,
  listTargets: listWintourWorkerTargets,
  resolvePrincipal: resolveAutomationExecutorPrincipal,
  discover: (principal) => discoverWintourSyncSales(principal, {}),
  prepareReadyJobs: prepareReadyWintourSyncJobs,
  recoverStaleJobs: recoverStaleWintourSyncJobs,
  claim: claimWintourSyncJobs,
  buildCreateRequest: buildWintourCreateSalesSoapRequest,
  buildUpdateRequest: buildWintourUpdateSalesSoapRequest,
  claimPollJobs: claimWintourPollJobs,
  buildCreateProtocolRequest: buildWintourCreateProtocolQuerySoapRequest,
  buildUpdateProtocolRequest: buildWintourUpdateProtocolQuerySoapRequest,
  executeSoapRequest: (request, options) => executeWintourSoapRequest(request, options),
  recordAttempt: recordWintourSyncAttemptResult,
  recordSubmissionSuccess: recordWintourSubmissionSuccess,
  recordPollResult: recordWintourPollResult,
  warn: logWarn,
}

export async function runWintourSyncCycle(
  options: WintourSyncRunnerOptions = {},
  dependencies: WintourSyncRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<WintourSyncRunnerResult> {
  const environment = dependencies.getEnvironment()
  const result = emptyResult()
  const pin = environment.WINTOUR_PIN?.trim() || ''
  const credentialTenantId = environment.WINTOUR_TENANT_ID?.trim() || ''

  if (!environment.WINTOUR_SYNC_ENABLED || !pin || !credentialTenantId) return result
  result.enabled = true
  if (!dependencies.databaseConfigured()) return result
  result.databaseReady = true

  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(options.limit || environment.WINTOUR_WORKER_BATCH_SIZE || 25)),
  )
  const tenantFilter = options.tenantIds?.length ? new Set(options.tenantIds) : null
  let targets: WintourWorkerTarget[]
  try {
    targets = (await dependencies.listTargets())
      .filter((target) => target.enabled
        && target.tenantId === credentialTenantId
        && (!tenantFilter || tenantFilter.has(target.tenantId)))
  } catch {
    result.errors += 1
    dependencies.warn('wintour_sync_targets_failed', { errorCode: 'WINTOUR_TARGETS_FAILED' })
    return result
  }
  result.targets = targets.length

  for (const target of targets) {
    if (!target.updatedBy) {
      result.errors += 1
      dependencies.warn('wintour_sync_executor_unavailable', {
        tenantId: target.tenantId,
        errorCode: 'WINTOUR_EXECUTOR_NOT_CONFIGURED',
      })
      continue
    }

    let principal: RequestPrincipal | null = null
    try {
      principal = await dependencies.resolvePrincipal(target.updatedBy, target.tenantId)
    } catch {
      // Deliberately omit the underlying error: authentication/database messages may contain context.
    }
    if (!principal) {
      result.errors += 1
      dependencies.warn('wintour_sync_executor_unavailable', {
        tenantId: target.tenantId,
        errorCode: 'WINTOUR_EXECUTOR_UNAVAILABLE',
      })
      continue
    }

    try {
      const recovered = await dependencies.recoverStaleJobs(principal, { limit })
      result.recovered += Math.max(0, Math.trunc(recovered.recovered || 0))
    } catch {
      result.errors += 1
      dependencies.warn('wintour_sync_recovery_failed', {
        tenantId: target.tenantId,
        errorCode: 'WINTOUR_RECOVERY_FAILED',
      })
    }

    let discoverySucceeded = false
    try {
      const discovered = await dependencies.discover(principal)
      result.discovered += Math.max(0, discovered.scanned)
      result.discoveryCreated += Math.max(0, discovered.created)
      result.discoveryRefreshed += Math.max(0, discovered.refreshed)
      discoverySucceeded = true
    } catch {
      result.errors += 1
      dependencies.warn('wintour_sync_discovery_failed', {
        tenantId: target.tenantId,
        errorCode: 'WINTOUR_DISCOVERY_FAILED',
      })
    }

    // A successful discovery refresh is the freshness barrier for every outbound mutation.
    // Protocol polling remains independent because it only observes a submission already made.
    const autoSend = discoverySucceeded && environment.WINTOUR_AUTO_SEND && target.autoSend
    if (autoSend) {
      try {
        const prepared = await dependencies.prepareReadyJobs(principal, { limit })
        result.prepared += Math.max(0, Math.trunc(prepared.prepared || 0))
      } catch {
        result.errors += 1
        dependencies.warn('wintour_sync_prepare_failed', {
          tenantId: target.tenantId,
          errorCode: 'WINTOUR_PREPARE_FAILED',
        })
      }
    }

    let processedForTenant = 0
    if (autoSend && processedForTenant < limit) {
      const leaseSeconds = Math.min(900, Math.max(30, Math.ceil(environment.WINTOUR_TIMEOUT_MS / 1_000) + 30))
      try {
        while (processedForTenant < limit) {
          // Claim exactly one mutation at a time. A batch claim starts every lease at
          // once, so jobs waiting behind a slow SOAP call could expire before their
          // first network byte and still be submitted from this process's memory.
          const jobs = await dependencies.claim(principal, { limit: 1, leaseSeconds })
          const job = jobs[0]
          if (!job) break
          result.claimed += 1
          processedForTenant += 1
          const outcome = await submitClaimedWintourJob(
            principal,
            job,
            { pin, timeoutMs: environment.WINTOUR_TIMEOUT_MS },
            dependencies,
          )
          result[outcome] += 1
        }
      } catch {
        result.errors += 1
        dependencies.warn('wintour_sync_claim_failed', {
          tenantId: target.tenantId,
          errorCode: 'WINTOUR_CLAIM_FAILED',
        })
      }
    }

    const autoPoll = environment.WINTOUR_PROTOCOL_POLL_ENABLED && target.autoPoll
    if (autoPoll && processedForTenant < limit) {
      const leaseSeconds = Math.min(900, Math.max(30, Math.ceil(environment.WINTOUR_TIMEOUT_MS / 1_000) + 30))
      try {
        while (processedForTenant < limit) {
          const jobs = await dependencies.claimPollJobs(principal, { limit: 1, leaseSeconds })
          const job = jobs[0]
          if (!job) break
          result.pollClaimed += 1
          processedForTenant += 1
          const outcome = await pollClaimedWintourJob(
            principal,
            job,
            { pin, timeoutMs: environment.WINTOUR_TIMEOUT_MS },
            dependencies,
          )
          result[outcome] += 1
        }
      } catch {
        result.errors += 1
        dependencies.warn('wintour_sync_poll_claim_failed', {
          tenantId: target.tenantId,
          errorCode: 'WINTOUR_POLL_CLAIM_FAILED',
        })
      }
    }
  }

  return result
}

export async function submitClaimedWintourJob(
  principal: RequestPrincipal,
  job: ClaimedWintourSyncJob,
  configuration: { pin: string; timeoutMs: number },
  dependencies: WintourSyncRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<'received' | 'ambiguous' | 'manualReview' | 'failed'> {
  if (!configuration.pin.trim()) {
    return settleFailure(principal, job, 'failed', 'WINTOUR_PIN_MISSING', dependencies)
  }
  if (!leaseCoversNetworkWindow(job.leaseExpiresAt, configuration.timeoutMs)) {
    return settleFailure(
      principal,
      job,
      'failed',
      'WINTOUR_LEASE_EXPIRED_BEFORE_SEND',
      dependencies,
    )
  }
  if (job.payloadContentType !== 'application/xml' || !validArtifactHash(job)) {
    return settleFailure(principal, job, 'failed', 'WINTOUR_ARTIFACT_INVALID', dependencies)
  }

  let request: WintourSoapRequest
  try {
    const xml = Buffer.from(job.payloadBytes).toString('latin1')
    const input = { pin: configuration.pin, xml, free: job.freeField || undefined }
    request = job.operation === 'create'
      ? dependencies.buildCreateRequest(input)
      : dependencies.buildUpdateRequest(input)
  } catch {
    return settleFailure(principal, job, 'failed', 'WINTOUR_REQUEST_BUILD_FAILED', dependencies)
  }
  if (!leaseCoversNetworkWindow(job.leaseExpiresAt, configuration.timeoutMs)) {
    return settleFailure(
      principal,
      job,
      'failed',
      'WINTOUR_LEASE_EXPIRED_BEFORE_SEND',
      dependencies,
    )
  }

  let execution: WintourSoapExecutionResult
  try {
    execution = await dependencies.executeSoapRequest(request, { timeoutMs: configuration.timeoutMs })
  } catch (error) {
    const classification = classifyMutationError(error)
    return settleFailure(principal, job, classification.state, classification.code, dependencies)
  }

  const protocol = execution.protocol?.trim() || ''
  if (!protocol) {
    return settleFailure(principal, job, 'ambiguous', 'WINTOUR_PROTOCOL_MISSING', dependencies)
  }
  const responseFingerprint = fingerprint([
    execution.operation,
    execution.httpStatus,
    protocol,
  ].join('|'))

  try {
    await dependencies.recordSubmissionSuccess(principal, {
      jobId: job.id,
      attemptId: job.attemptId,
      leaseToken: job.leaseToken,
      expectedJobVersion: job.jobVersion,
      expectedAttemptVersion: job.attemptVersion,
      protocolCode: protocol,
      responseFingerprint,
      redactedPayload: {
        operation: execution.operation,
        httpStatus: execution.httpStatus,
        durationMs: execution.durationMs,
        submissionStatus: 'received',
      },
    })
    return 'received'
  } catch {
    dependencies.warn('wintour_sync_submission_persistence_failed', {
      tenantId: principal.tenantId,
      jobId: job.id,
      errorCode: 'WINTOUR_SUBMISSION_PERSISTENCE_FAILED',
    })
    return settleUnknownSubmissionPersistence(principal, job, dependencies)
  }
}

export async function pollClaimedWintourJob(
  principal: RequestPrincipal,
  job: ClaimedWintourPollJob,
  configuration: { pin: string; timeoutMs: number },
  dependencies: WintourSyncRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<'pollCompleted' | 'pollProcessing' | 'pollManualReview' | 'pollFailed'> {
  const protocol = job.protocolCode.trim()
  if (!configuration.pin.trim() || !protocol) {
    return settlePollResult(
      principal,
      job,
      {
        state: 'manual_review',
        errorCode: configuration.pin.trim() ? 'WINTOUR_PROTOCOL_MISSING' : 'WINTOUR_PIN_MISSING',
      },
      dependencies,
    )
  }
  if (!leaseCoversNetworkWindow(job.pollLeaseExpiresAt, configuration.timeoutMs)) {
    return settlePollResult(
      principal,
      job,
      { state: 'processing', errorCode: 'WINTOUR_POLL_LEASE_EXPIRED_BEFORE_QUERY' },
      dependencies,
    )
  }

  let request: WintourSoapRequest
  try {
    const input = { pin: configuration.pin, protocol }
    request = job.operation === 'create'
      ? dependencies.buildCreateProtocolRequest(input)
      : dependencies.buildUpdateProtocolRequest(input)
  } catch {
    return settlePollResult(
      principal,
      job,
      { state: 'manual_review', errorCode: 'WINTOUR_POLL_REQUEST_BUILD_FAILED' },
      dependencies,
    )
  }
  if (!leaseCoversNetworkWindow(job.pollLeaseExpiresAt, configuration.timeoutMs)) {
    return settlePollResult(
      principal,
      job,
      { state: 'processing', errorCode: 'WINTOUR_POLL_LEASE_EXPIRED_BEFORE_QUERY' },
      dependencies,
    )
  }

  let execution: WintourSoapExecutionResult
  try {
    execution = await dependencies.executeSoapRequest(request, { timeoutMs: configuration.timeoutMs })
  } catch (error) {
    const classification = classifyPollError(error)
    return settlePollResult(
      principal,
      job,
      {
        state: classification.state,
        errorCode: classification.code,
      },
      dependencies,
    )
  }

  if (!execution.protocolDetail
      || execution.protocolDetail.kind !== expectedProtocolKind(job)
      || execution.protocolDetail.protocol.trim() !== protocol) {
    return settlePollResult(
      principal,
      job,
      { state: 'manual_review', errorCode: 'WINTOUR_POLL_DETAIL_INVALID' },
      dependencies,
    )
  }

  const mapped = mapProtocolDetail(execution.protocolDetail)
  const responseFingerprint = fingerprint(JSON.stringify({
    operation: execution.operation,
    httpStatus: execution.httpStatus,
    protocol,
    status: execution.protocolDetail.status,
    ...mapped.fingerprintFields,
  }))
  try {
    await dependencies.recordPollResult(principal, {
      jobId: job.id,
      attemptId: job.attemptId,
      pollLeaseToken: job.pollLeaseToken,
      expectedJobVersion: job.jobVersion,
      state: mapped.state,
      protocolCode: protocol,
      wintourSaleNumber: mapped.wintourSaleNumber,
      responseFingerprint,
      redactedPayload: {
        operation: execution.operation,
        httpStatus: execution.httpStatus,
        durationMs: execution.durationMs,
        protocolStatus: execution.protocolDetail.status,
        ...mapped.redactedPayload,
      },
      nextPollSeconds: 300,
    })
  } catch {
    dependencies.warn('wintour_sync_poll_persistence_failed', {
      tenantId: principal.tenantId,
      jobId: job.id,
      errorCode: 'WINTOUR_POLL_PERSISTENCE_FAILED',
    })
    return 'pollFailed'
  }
  return pollResultKey(mapped.state)
}

async function settlePollResult(
  principal: RequestPrincipal,
  job: ClaimedWintourPollJob,
  outcome: {
    state: 'processing' | 'manual_review'
    errorCode: string
  },
  dependencies: WintourSyncRunnerDependencies,
): Promise<'pollProcessing' | 'pollManualReview' | 'pollFailed'> {
  const responseFingerprint = fingerprint([
    job.operation,
    job.protocolCode,
    outcome.state,
    outcome.errorCode,
  ].join('|'))
  try {
    await dependencies.recordPollResult(principal, {
      jobId: job.id,
      attemptId: job.attemptId,
      pollLeaseToken: job.pollLeaseToken,
      expectedJobVersion: job.jobVersion,
      state: outcome.state,
      protocolCode: job.protocolCode,
      responseFingerprint,
      redactedPayload: {
        pollStatus: outcome.state === 'processing' ? 'temporarily_unavailable' : 'manual_review',
        errorCode: outcome.errorCode,
      },
      nextPollSeconds: 300,
    })
  } catch {
    dependencies.warn('wintour_sync_poll_persistence_failed', {
      tenantId: principal.tenantId,
      jobId: job.id,
      errorCode: 'WINTOUR_POLL_PERSISTENCE_FAILED',
    })
    return 'pollFailed'
  }
  dependencies.warn('wintour_sync_poll_not_completed', {
    tenantId: principal.tenantId,
    jobId: job.id,
    operation: job.operation,
    state: outcome.state,
    errorCode: outcome.errorCode,
  })
  return outcome.state === 'manual_review' ? 'pollManualReview' : 'pollProcessing'
}

function mapProtocolDetail(detail: WintourProtocolDetail): {
  state: 'processing' | 'manual_review' | 'completed'
  wintourSaleNumber?: string
  fingerprintFields: Record<string, unknown>
  redactedPayload: Record<string, unknown>
} {
  if (detail.status === 'trEmFila') {
    return {
      state: 'processing',
      fingerprintFields: {},
      redactedPayload: {},
    }
  }
  if (detail.status === 'trProcessManual' || detail.status === 'trNaoEncontrado') {
    return {
      state: 'manual_review',
      fingerprintFields: {},
      redactedPayload: { hasLastError: Boolean(detail.lastError.trim()) },
    }
  }
  if (detail.kind === 'update') {
    const hasLastError = Boolean(detail.lastError.trim())
    return {
      // DGR-046 only confirms that Wintour processed the alteration request. It
      // does not prove the sale now reflects the requested fields, so updates
      // remain pending human reconciliation even when the protocol has no error.
      state: 'manual_review',
      fingerprintFields: { processedByWintour: true },
      redactedPayload: { hasLastError, processedByWintour: true },
    }
  }

  const wintourSaleNumber = extractSingleWintourSaleNumber(detail.launchedSaleNumbers)
  const pending = pendingCreationSales(detail)
  const safeCounts = creationProtocolCounts(detail)
  const complete = detail.launchedSalesCount === 1
    && pending === 0
    && !detail.lastError.trim()
    && Boolean(wintourSaleNumber)
  return {
    state: complete ? 'completed' : 'manual_review',
    wintourSaleNumber: complete ? wintourSaleNumber : undefined,
    fingerprintFields: {
      ...safeCounts,
      hasLastError: Boolean(detail.lastError.trim()),
      saleNumberFingerprint: wintourSaleNumber ? fingerprint(wintourSaleNumber) : null,
    },
    redactedPayload: {
      ...safeCounts,
      hasLastError: Boolean(detail.lastError.trim()),
      saleNumberResolved: Boolean(wintourSaleNumber),
    },
  }
}

function expectedProtocolKind(job: ClaimedWintourPollJob): WintourProtocolDetail['kind'] {
  return job.operation === 'create' ? 'creation' : 'update'
}

function creationProtocolCounts(detail: WintourCreationProtocolDetail): Record<string, number> {
  return {
    pendingSalesCount: detail.pendingSalesCount,
    launchedSalesCount: detail.launchedSalesCount,
    salesWithError: detail.pendingSales.salesWithError,
    excludedSales: detail.pendingSales.excludedSales,
    deniedDateSales: detail.pendingSales.deniedDateSales,
  }
}

function pendingCreationSales(detail: WintourCreationProtocolDetail): number {
  return detail.pendingSalesCount
    + detail.pendingSales.salesWithError
    + detail.pendingSales.excludedSales
    + detail.pendingSales.deniedDateSales
}

function extractSingleWintourSaleNumber(value: string): string | undefined {
  const matches = value.match(/[1-9][0-9]{0,9}/g) || []
  if (matches.length !== 1) return undefined
  const remainder = value.replace(/[1-9][0-9]{0,9}/g, '')
  if (!/^[\s,;|/\-]*$/.test(remainder)) return undefined
  return matches[0]
}

const NETWORK_LEASE_SAFETY_MS = 5_000

function leaseCoversNetworkWindow(expiresAt: string, timeoutMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return false
  return expiresAtMs - Date.now() >= Math.max(1, timeoutMs) + NETWORK_LEASE_SAFETY_MS
}

function pollResultKey(
  state: 'processing' | 'manual_review' | 'completed',
): 'pollProcessing' | 'pollManualReview' | 'pollCompleted' {
  if (state === 'completed') return 'pollCompleted'
  if (state === 'manual_review') return 'pollManualReview'
  return 'pollProcessing'
}

function classifyPollError(error: unknown): {
  state: 'processing' | 'manual_review'
  code: string
} {
  if (!(error instanceof WintourSoapError)) {
    return { state: 'processing', code: 'WINTOUR_POLL_UNKNOWN_ERROR' }
  }
  return {
    state: error.retryable ? 'processing' : 'manual_review',
    code: error.code,
  }
}

async function settleFailure(
  principal: RequestPrincipal,
  job: ClaimedWintourSyncJob,
  state: 'ambiguous' | 'manual_review' | 'failed',
  errorCode: string,
  dependencies: WintourSyncRunnerDependencies,
): Promise<'ambiguous' | 'manualReview' | 'failed'> {
  try {
    await dependencies.recordAttempt(principal, {
      jobId: job.id,
      attemptId: job.attemptId,
      leaseToken: job.leaseToken,
      expectedJobVersion: job.jobVersion,
      expectedAttemptVersion: job.attemptVersion,
      state,
      errorCode,
      errorMessage: safeAttemptMessage(state),
    })
  } catch {
    dependencies.warn('wintour_sync_attempt_persistence_failed', {
      tenantId: principal.tenantId,
      jobId: job.id,
      errorCode: 'WINTOUR_ATTEMPT_PERSISTENCE_FAILED',
    })
  }
  dependencies.warn('wintour_sync_submission_not_received', {
    tenantId: principal.tenantId,
    jobId: job.id,
    operation: job.operation,
    state,
    errorCode,
  })
  return state === 'manual_review' ? 'manualReview' : state
}

async function settleUnknownSubmissionPersistence(
  principal: RequestPrincipal,
  job: ClaimedWintourSyncJob,
  dependencies: WintourSyncRunnerDependencies,
): Promise<'ambiguous'> {
  try {
    await dependencies.recordAttempt(principal, {
      jobId: job.id,
      attemptId: job.attemptId,
      leaseToken: job.leaseToken,
      expectedJobVersion: job.jobVersion,
      expectedAttemptVersion: job.attemptVersion,
      state: 'ambiguous',
      errorCode: 'WINTOUR_SUBMISSION_PERSISTENCE_UNKNOWN',
      errorMessage: safeAttemptMessage('ambiguous'),
    })
  } catch {
    dependencies.warn('wintour_sync_attempt_persistence_failed', {
      tenantId: principal.tenantId,
      jobId: job.id,
      errorCode: 'WINTOUR_ATTEMPT_PERSISTENCE_FAILED',
    })
  }
  return 'ambiguous'
}

function classifyMutationError(error: unknown): {
  state: 'ambiguous' | 'manual_review' | 'failed'
  code: string
} {
  if (!(error instanceof WintourSoapError)) {
    return { state: 'ambiguous', code: 'WINTOUR_MUTATION_UNKNOWN_ERROR' }
  }
  if (error.ambiguous) return { state: 'ambiguous', code: error.code }
  if (error.code === 'WINTOUR_SOAP_FAULT' || error.code === 'WINTOUR_SOAP_HTTP_ERROR') {
    return { state: 'manual_review', code: error.code }
  }
  return { state: 'failed', code: error.code }
}

function validArtifactHash(job: ClaimedWintourSyncJob): boolean {
  if (!/^[0-9a-f]{64}$/.test(job.payloadSha256)) return false
  return fingerprint(job.payloadBytes) === job.payloadSha256
}

function fingerprint(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeAttemptMessage(state: 'ambiguous' | 'manual_review' | 'failed'): string {
  if (state === 'ambiguous') return 'Resultado do envio desconhecido; requer conciliacao manual.'
  if (state === 'manual_review') return 'Solicitacao rejeitada pelo Wintour; requer revisao manual.'
  return 'Envio nao realizado; requer revisao da configuracao ou do artefato.'
}

function emptyResult(): WintourSyncRunnerResult {
  return {
    enabled: false,
    databaseReady: false,
    targets: 0,
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
  }
}
