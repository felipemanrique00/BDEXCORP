export const DEMAND_REQUEST_ADJUSTMENT_METADATA_KEY = 'requestAdjustment' as const

export type DemandRequestAdjustmentSource =
  | 'merit_approval_rejected'
  | 'cost_approval_rejected'

export type DemandRequestAdjustmentAction =
  | 'edit_request'
  | 'choose_another_option'

export interface DemandRequestAdjustment {
  status: 'open' | 'resolved'
  source: DemandRequestAdjustmentSource
  reason: string
  approvalInstanceId: string
  allowedActions: DemandRequestAdjustmentAction[]
  requestedAt: string
  requestedBy: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolution: 'request_edited' | 'new_option_selected' | null
  resolutionReason: string | null
}

export interface OpenDemandRequestAdjustmentInput {
  source: DemandRequestAdjustmentSource
  reason: string
  approvalInstanceId: string
  allowedActions: readonly DemandRequestAdjustmentAction[]
  requestedAt: string
  requestedBy?: string | null
}

export interface ResolveDemandRequestAdjustmentInput {
  resolvedAt: string
  resolvedBy?: string | null
  resolution: Exclude<DemandRequestAdjustment['resolution'], null>
  resolutionReason?: string | null
}

const ADJUSTMENT_SOURCES = new Set<DemandRequestAdjustmentSource>([
  'merit_approval_rejected',
  'cost_approval_rejected',
])

const ADJUSTMENT_ACTIONS = new Set<DemandRequestAdjustmentAction>([
  'edit_request',
  'choose_another_option',
])

export function createOpenDemandRequestAdjustment(
  input: OpenDemandRequestAdjustmentInput,
): DemandRequestAdjustment {
  return {
    status: 'open',
    source: input.source,
    reason: normalizedText(input.reason),
    approvalInstanceId: normalizedText(input.approvalInstanceId),
    allowedActions: uniqueActions(input.allowedActions),
    requestedAt: normalizedText(input.requestedAt),
    requestedBy: nullableText(input.requestedBy),
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    resolutionReason: null,
  }
}

export function readDemandRequestAdjustment(metadata: unknown): DemandRequestAdjustment | null {
  const root = recordValue(metadata)
  const value = recordValue(root[DEMAND_REQUEST_ADJUSTMENT_METADATA_KEY])
  const status = value.status === 'open' || value.status === 'resolved' ? value.status : null
  const source = typeof value.source === 'string' && ADJUSTMENT_SOURCES.has(value.source as DemandRequestAdjustmentSource)
    ? value.source as DemandRequestAdjustmentSource
    : null
  const approvalInstanceId = normalizedText(value.approvalInstanceId)
  const requestedAt = normalizedText(value.requestedAt)
  if (!status || !source || !approvalInstanceId || !requestedAt) return null

  const resolution = value.resolution === 'request_edited' || value.resolution === 'new_option_selected'
    ? value.resolution
    : null
  return {
    status,
    source,
    reason: normalizedText(value.reason),
    approvalInstanceId,
    allowedActions: uniqueActions(Array.isArray(value.allowedActions) ? value.allowedActions : []),
    requestedAt,
    requestedBy: nullableText(value.requestedBy),
    resolvedAt: nullableText(value.resolvedAt),
    resolvedBy: nullableText(value.resolvedBy),
    resolution,
    resolutionReason: nullableText(value.resolutionReason),
  }
}

export function demandRequestAdjustmentAllows(
  metadata: unknown,
  action: DemandRequestAdjustmentAction,
): boolean {
  const adjustment = readDemandRequestAdjustment(metadata)
  return adjustment?.status === 'open' && adjustment.allowedActions.includes(action)
}

export function resolveDemandRequestAdjustment(
  current: DemandRequestAdjustment,
  input: ResolveDemandRequestAdjustmentInput,
): DemandRequestAdjustment {
  return {
    ...current,
    status: 'resolved',
    resolvedAt: normalizedText(input.resolvedAt),
    resolvedBy: nullableText(input.resolvedBy),
    resolution: input.resolution,
    resolutionReason: nullableText(input.resolutionReason),
  }
}

function uniqueActions(values: readonly unknown[]): DemandRequestAdjustmentAction[] {
  return Array.from(new Set(values.filter((value): value is DemandRequestAdjustmentAction => (
    typeof value === 'string' && ADJUSTMENT_ACTIONS.has(value as DemandRequestAdjustmentAction)
  ))))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown): string | null {
  return normalizedText(value) || null
}
