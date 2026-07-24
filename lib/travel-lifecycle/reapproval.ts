import { sha256 } from '@/lib/policy/evaluator'
import type { ReapprovalAssessment, ReapprovalTolerance } from '@/lib/travel-lifecycle/types'

const CRITICAL_FIELDS = [
  'amount',
  'currency',
  'supplierId',
  'route',
  'startDate',
  'endDate',
  'serviceClass',
  'hotelId',
  'category',
  'costCenterId',
  'projectId',
  'budgetId',
  'paymentMethodId',
  'travelerId',
  'cancellationRule',
  'riskLevel',
] as const

export function assessTravelReapproval(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
  tolerance: ReapprovalTolerance = {},
): ReapprovalAssessment {
  const ignored = new Set(tolerance.ignoredFields || [])
  const fields = Array.from(new Set([...CRITICAL_FIELDS, ...(tolerance.extraCriticalFields || [])]))
    .filter((field) => !ignored.has(field))
  const materialChanges: ReapprovalAssessment['materialChanges'] = []

  for (const field of fields) {
    const before = getPath(previous, field)
    const after = getPath(current, field)
    if (equivalent(before, after)) continue

    if (field === 'amount' && withinAmountTolerance(before, after, tolerance)) continue
    materialChanges.push({
      field,
      previous: before,
      current: after,
      reason: reapprovalReason(field),
    })
  }

  return {
    required: materialChanges.length > 0,
    changedFields: materialChanges.map((change) => change.field),
    materialChanges,
    previousHash: sha256(previous),
    currentHash: sha256(current),
  }
}

function withinAmountTolerance(
  previous: unknown,
  current: unknown,
  tolerance: ReapprovalTolerance,
): boolean {
  const before = strictNumber(previous)
  const after = strictNumber(current)
  if (before === null || after === null) return false
  const difference = Math.abs(after - before)
  if (tolerance.amountAbsolute !== undefined && difference <= tolerance.amountAbsolute) return true
  if (tolerance.amountPercentage !== undefined && before !== 0) {
    return (difference / Math.abs(before)) * 100 <= tolerance.amountPercentage
  }
  return difference === 0
}

function equivalent(left: unknown, right: unknown): boolean {
  return sha256(left) === sha256(right)
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path]
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[segment]
  }, source)
}

function strictNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function reapprovalReason(field: string): string {
  const reasons: Record<string, string> = {
    amount: 'Valor alterado acima da tolerancia configurada.',
    currency: 'Moeda da operacao alterada.',
    supplierId: 'Fornecedor alterado.',
    route: 'Rota alterada.',
    startDate: 'Data inicial alterada.',
    endDate: 'Data final alterada.',
    serviceClass: 'Classe de servico alterada.',
    hotelId: 'Hotel alterado.',
    category: 'Categoria alterada.',
    costCenterId: 'Centro de custo alterado.',
    projectId: 'Projeto alterado.',
    budgetId: 'Orcamento alterado.',
    paymentMethodId: 'Forma de pagamento alterada.',
    travelerId: 'Viajante alterado.',
    cancellationRule: 'Regra de cancelamento alterada.',
    riskLevel: 'Nivel de risco alterado.',
  }
  return reasons[field] || `Campo critico ${field} alterado.`
}
