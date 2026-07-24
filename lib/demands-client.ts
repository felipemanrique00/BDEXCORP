'use client'

import type { Atendimento, StatusAtendimento } from '@/types'

export interface DemandCreationClientResult {
  demand: Atendimento
  relational: {
    id: string
    demandNumber: string
    companyId: string
    employeeId: string | null
    lifecycleStatus: string
    lifecycleVersion: number
  }
  policy: {
    blocked: boolean
    requiresAction: boolean
    submissionAllowed: boolean
    checkpoints: Array<{
      checkpoint: string
      passed: boolean
      blocks: Array<{ code: string; message: string }>
      warnings: Array<{ code: string; message: string }>
      requiredActions: Array<{ action: string; code: string; message: string }>
      approvals: Array<{ code: string; message: string; workflow: string | null }>
    }>
  }
  approval: {
    required: boolean
    configured: boolean
    workflowCode: string | null
    instanceId: string | null
    errorCode: string | null
    message: string | null
  }
  replayed: boolean
}

export interface RelationalDemandClientItem {
  id: string
  demandNumber: string
  companyId: string
  companyName: string
  employeeId: string | null
  employeeMatchStatus: string | null
  employeeMatchConfidence: number | null
  assignedToUserId: string | null
  assignedToName: string | null
  serviceType: string
  passengerName: string
  operationalStatus: StatusAtendimento
  lifecycleStatus: string
  lifecycleVersion: number
  priority: string
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  costCenter: string | null
  estimatedAmount: number
  finalAmount: number
  slaDueAt: string | null
  version: number
  policyEvaluationId: string | null
  approvalInstanceId: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
  demand: Atendimento
  governance: Record<string, unknown>
}

export interface DemandListClientFilters {
  companyId?: string
  status?: StatusAtendimento
  lifecycleStatus?: string
  serviceType?: string
  assignedToMe?: boolean
  unassigned?: boolean
  search?: string
  limit?: number
  offset?: number
}

export interface DemandListClientResult {
  items: RelationalDemandClientItem[]
  total: number
  rollout: DemandDomainRollout
}

export interface DemandDomainRollout {
  domainKey: string
  readMode: 'legacy' | 'shadow' | 'relational'
  writeMode: 'legacy' | 'dual' | 'relational'
  status: 'active' | 'paused'
  version: number
  pilotCompanyIds: string[]
}

export interface DemandMutationClientResult {
  item: RelationalDemandClientItem
  replayed: boolean
}

export interface DemandDetailsUpdateClientResult extends DemandMutationClientResult {
  policy: {
    blocked: boolean
    requiresAction: boolean
    checkpoints: DemandCreationClientResult['policy']['checkpoints']
  }
  approval: DemandCreationClientResult['approval']
  reapproval: {
    required: boolean
    changedFields: string[]
    supersededApprovalInstanceId: string | null
  }
}

export type DemandImportSource =
  | 'wintour'
  | 'tech_travel'
  | 'emissions'
  | 'company_import'
  | 'voucher'
  | 'generic'

export interface DemandImportClientResult {
  sourceCount: number
  synchronized: number
  inserted: number
  updated: number
  skipped: number
  failures: Array<{
    index: number
    entityId: string | null
    issues: string[]
  }>
  demands: Atendimento[]
  jobIds: string[]
}

export interface DemandImportMetadata {
  fileName?: string
  sourceFormat?: 'xml' | 'xlsx' | 'csv' | 'pdf'
  periodStart?: string
  periodEnd?: string
  totalRecords?: number
  totalValue?: number
  totalCost?: number
  totalMarkup?: number
}

export interface DemandImportRollbackClientResult {
  restored: number
  removed: number
  removedDemandIds: string[]
  demands: Atendimento[]
  jobIds: string[]
}

export class DemandClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DemandClientError'
  }
}

export async function listDemandsFromServer(
  filters: DemandListClientFilters = {},
): Promise<DemandListClientResult> {
  const search = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const response = await demandRequest(`/api/demands${search.size ? `?${search}` : ''}`, {
    method: 'GET',
  })
  if (!Array.isArray(response.items) || !response.items.every(isRelationalDemandItem)) {
    throw new DemandClientError(
      'O servidor retornou uma lista de demandas invalida.',
      'INVALID_SERVER_RESPONSE',
      502,
    )
  }
  const rollout = parseDemandRollout(response.rollout)
  return {
    items: response.items,
    total: finiteNumber(response.total),
    rollout,
  }
}

export async function updateDemandAssignmentOnServer(
  demandId: string,
  input: {
    assigneeUserId: string | null
    expectedVersion: number
    reason: string
    idempotencyKey: string
  },
): Promise<DemandMutationClientResult> {
  return demandMutationRequest(demandId, 'assignment', {
    ...input,
    confirmed: true,
  })
}

export async function updateDemandStatusOnServer(
  demandId: string,
  input: {
    status: StatusAtendimento
    expectedVersion: number
    reason: string
    idempotencyKey: string
  },
): Promise<DemandMutationClientResult> {
  return demandMutationRequest(demandId, 'status', {
    ...input,
    confirmed: true,
  })
}

export async function getDemandFromServer(
  demandId: string,
): Promise<RelationalDemandClientItem> {
  const payload = await demandRequest(`/api/demands/${encodeURIComponent(demandId)}`, {
    method: 'GET',
  })
  if (!isRelationalDemandItem(payload.item)) {
    throw new DemandClientError(
      'O servidor retornou uma demanda invalida.',
      'INVALID_SERVER_RESPONSE',
      502,
    )
  }
  return payload.item
}

export async function updateDemandDetailsOnServer(
  demandId: string,
  input: {
    demand: Atendimento
    expectedVersion: number
    reason: string
    idempotencyKey: string
  },
): Promise<DemandDetailsUpdateClientResult> {
  const payload = await demandRequest(`/api/demands/${encodeURIComponent(demandId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      ...input,
      confirmed: true,
    }),
  })
  if (
    !isRelationalDemandItem(payload.item)
    || typeof payload.replayed !== 'boolean'
    || !isDemandPolicy(payload.policy)
    || !isDemandApproval(payload.approval)
    || !isDemandReapproval(payload.reapproval)
  ) {
    throw new DemandClientError(
      'O servidor retornou uma atualizacao de demanda invalida.',
      'INVALID_SERVER_RESPONSE',
      502,
    )
  }
  return payload as unknown as DemandDetailsUpdateClientResult
}

export async function importDemandBatchesOnServer(
  demands: Atendimento[],
  source: DemandImportSource,
  batchKey: string,
  onProgress?: (processed: number, total: number) => void,
  metadata?: DemandImportMetadata,
): Promise<DemandImportClientResult> {
  const chunks = chunk(demands, 100)
  const aggregate: DemandImportClientResult = {
    sourceCount: 0,
    synchronized: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failures: [],
    demands: [],
    jobIds: [],
  }
  let processed = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const items = chunks[index]
    const payload = await demandRequest('/api/demands/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${batchKey}:${index + 1}`,
      },
      body: JSON.stringify({
        source,
        idempotencyKey: `${batchKey}:${index + 1}`,
        demands: items,
        confirmed: true,
        metadata: {
          ...metadata,
          batchKey,
          chunkIndex: index + 1,
          chunkCount: chunks.length,
        },
      }),
    })
    if (!Array.isArray(payload.demands)) {
      throw new DemandClientError(
        'O servidor retornou um lote de importacao invalido.',
        'INVALID_SERVER_RESPONSE',
        502,
      )
    }
    aggregate.sourceCount += finiteNumber(payload.sourceCount)
    aggregate.synchronized += finiteNumber(payload.synchronized)
    aggregate.inserted += finiteNumber(payload.inserted)
    aggregate.updated += finiteNumber(payload.updated)
    aggregate.skipped += finiteNumber(payload.skipped)
    aggregate.demands.push(...payload.demands.filter(isAtendimento))
    if (Array.isArray(payload.failures)) {
      aggregate.failures.push(...payload.failures.filter(isDemandImportFailure))
    }
    if (typeof payload.jobId === 'string') aggregate.jobIds.push(payload.jobId)
    processed += items.length
    onProgress?.(processed, demands.length)
  }
  return {
    ...aggregate,
    demands: Array.from(new Map(aggregate.demands.map((demand) => [demand.id, demand])).values()),
  }
}

export function createDemandImportBatchKey(
  source: DemandImportSource,
  demands: Atendimento[],
): string {
  const canonical = demands
    .map((demand) => [
      demand.id,
      demand.empresa_id,
      demand.venda_numero || '',
      demand.passageiro_nome,
      demand.tipo_servico,
      demand.status,
      Number(demand.valor_final ?? demand.valor_venda ?? demand.valor_cotacao ?? 0).toFixed(2),
    ].join('|'))
    .sort()
    .join('\n')
  let hash = 2_166_136_261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${source}:${(hash >>> 0).toString(16).padStart(8, '0')}:${demands.length}`
}

export async function rollbackDemandImportOnServer(
  jobIds: string[],
  reason: string,
): Promise<DemandImportRollbackClientResult> {
  const aggregate: DemandImportRollbackClientResult = {
    restored: 0,
    removed: 0,
    removedDemandIds: [],
    demands: [],
    jobIds: [],
  }
  for (const jobId of [...jobIds].reverse()) {
    const payload = await demandRequest(
      `/api/demands/import/${encodeURIComponent(jobId)}/rollback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
    )
    if (!Array.isArray(payload.demands)) {
      throw new DemandClientError(
        'O servidor retornou uma reversao de importacao invalida.',
        'INVALID_SERVER_RESPONSE',
        502,
      )
    }
    aggregate.restored += finiteNumber(payload.restored)
    aggregate.removed += finiteNumber(payload.removed)
    if (Array.isArray(payload.removedDemandIds)) {
      aggregate.removedDemandIds.push(
        ...payload.removedDemandIds.filter((value): value is string => typeof value === 'string'),
      )
    }
    aggregate.demands.push(...payload.demands.filter(isAtendimento))
    if (typeof payload.jobId === 'string') aggregate.jobIds.push(payload.jobId)
  }
  return {
    ...aggregate,
    removedDemandIds: Array.from(new Set(aggregate.removedDemandIds)),
    demands: Array.from(new Map(aggregate.demands.map((demand) => [demand.id, demand])).values()),
  }
}

export async function createDemandOnServer(
  demand: Atendimento,
  submit = true,
): Promise<DemandCreationClientResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch('/api/demands', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `demand:create:${demand.id}`,
      },
      body: JSON.stringify({ demand, submit }),
      signal: controller.signal,
    })
    const payload = await readPayload(response)
    if (!response.ok || payload.ok !== true) {
      throw new DemandClientError(
        text(payload.error) || 'Nao foi possivel criar a demanda no servidor.',
        text(payload.code),
        response.status,
      )
    }
    if (!isDemandCreationResult(payload)) {
      throw new DemandClientError('O servidor retornou uma resposta de demanda invalida.', 'INVALID_SERVER_RESPONSE', 502)
    }
    return payload
  } catch (error) {
    if (error instanceof DemandClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DemandClientError(
        'O servidor demorou para responder. A operacao pode ser consultada novamente com seguranca.',
        'DEMAND_REQUEST_TIMEOUT',
        504,
      )
    }
    throw new DemandClientError(
      error instanceof Error ? error.message : 'Falha de comunicacao ao criar a demanda.',
      'DEMAND_NETWORK_ERROR',
      503,
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

async function demandMutationRequest(
  demandId: string,
  operation: 'assignment' | 'status',
  body: Record<string, unknown>,
): Promise<DemandMutationClientResult> {
  const payload = await demandRequest(`/api/demands/${encodeURIComponent(demandId)}/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': String(body.idempotencyKey || ''),
    },
    body: JSON.stringify(body),
  })
  if (!isRelationalDemandItem(payload.item) || typeof payload.replayed !== 'boolean') {
    throw new DemandClientError(
      'O servidor retornou uma atualizacao de demanda invalida.',
      'INVALID_SERVER_RESPONSE',
      502,
    )
  }
  return {
    item: payload.item,
    replayed: payload.replayed,
  }
}

async function demandRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await readPayload(response)
    if (!response.ok || payload.ok !== true) {
      throw new DemandClientError(
        text(payload.error) || 'Nao foi possivel concluir a operacao de demanda.',
        text(payload.code),
        response.status,
        record(payload.details),
      )
    }
    return payload
  } catch (error) {
    if (error instanceof DemandClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DemandClientError(
        'O servidor demorou para responder. Atualize a fila antes de repetir a operacao.',
        'DEMAND_REQUEST_TIMEOUT',
        504,
      )
    }
    throw new DemandClientError(
      error instanceof Error ? error.message : 'Falha de comunicacao com o servidor.',
      'DEMAND_NETWORK_ERROR',
      503,
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json()
    return record(value)
  } catch {
    return {}
  }
}

function isRelationalDemandItem(value: unknown): value is RelationalDemandClientItem {
  const candidate = record(value)
  const demand = record(candidate.demand)
  return typeof candidate.id === 'string'
    && typeof candidate.demandNumber === 'string'
    && typeof candidate.companyId === 'string'
    && typeof candidate.companyName === 'string'
    && typeof candidate.operationalStatus === 'string'
    && typeof candidate.version === 'number'
    && typeof candidate.lifecycleVersion === 'number'
    && typeof demand.id === 'string'
    && typeof demand.empresa_id === 'string'
    && typeof demand.passageiro_nome === 'string'
}

function isDemandCreationResult(value: Record<string, unknown>): value is Record<string, unknown> & DemandCreationClientResult {
  const demand = record(value.demand)
  const relational = record(value.relational)
  const policy = record(value.policy)
  const approval = record(value.approval)
  return typeof demand.id === 'string'
    && typeof demand.empresa_id === 'string'
    && typeof demand.passageiro_nome === 'string'
    && typeof relational.id === 'string'
    && typeof relational.demandNumber === 'string'
    && typeof relational.lifecycleStatus === 'string'
    && typeof relational.lifecycleVersion === 'number'
    && typeof policy.blocked === 'boolean'
    && typeof policy.requiresAction === 'boolean'
    && typeof policy.submissionAllowed === 'boolean'
    && Array.isArray(policy.checkpoints)
    && typeof approval.required === 'boolean'
    && typeof approval.configured === 'boolean'
    && typeof value.replayed === 'boolean'
}

function isDemandPolicy(value: unknown): boolean {
  const policy = record(value)
  return typeof policy.blocked === 'boolean'
    && typeof policy.requiresAction === 'boolean'
    && Array.isArray(policy.checkpoints)
}

function isDemandApproval(value: unknown): boolean {
  const approval = record(value)
  return typeof approval.required === 'boolean'
    && typeof approval.configured === 'boolean'
}

function isDemandReapproval(value: unknown): boolean {
  const reapproval = record(value)
  return typeof reapproval.required === 'boolean'
    && Array.isArray(reapproval.changedFields)
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isAtendimento(value: unknown): value is Atendimento {
  const demand = record(value)
  return typeof demand.id === 'string'
    && typeof demand.empresa_id === 'string'
    && typeof demand.passageiro_nome === 'string'
    && typeof demand.tipo_servico === 'string'
    && typeof demand.status === 'string'
}

function isDemandImportFailure(value: unknown): value is DemandImportClientResult['failures'][number] {
  const failure = record(value)
  return typeof failure.index === 'number'
    && (failure.entityId === null || typeof failure.entityId === 'string')
    && Array.isArray(failure.issues)
    && failure.issues.every((issue) => typeof issue === 'string')
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function parseDemandRollout(value: unknown): DemandDomainRollout {
  const candidate = record(value)
  const readMode = candidate.readMode
  const writeMode = candidate.writeMode
  const status = candidate.status
  if (
    candidate.domainKey !== 'demands'
    || !['legacy', 'shadow', 'relational'].includes(String(readMode))
    || !['legacy', 'dual', 'relational'].includes(String(writeMode))
    || !['active', 'paused'].includes(String(status))
    || typeof candidate.version !== 'number'
    || !Array.isArray(candidate.pilotCompanyIds)
    || !candidate.pilotCompanyIds.every((item) => typeof item === 'string')
  ) {
    throw new DemandClientError(
      'O servidor retornou uma configuracao de rollout invalida.',
      'INVALID_SERVER_RESPONSE',
      502,
    )
  }
  return {
    domainKey: 'demands',
    readMode: readMode as DemandDomainRollout['readMode'],
    writeMode: writeMode as DemandDomainRollout['writeMode'],
    status: status as DemandDomainRollout['status'],
    version: candidate.version,
    pilotCompanyIds: candidate.pilotCompanyIds as string[],
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
