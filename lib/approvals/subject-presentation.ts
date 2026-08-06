export interface HotelQuoteApprovalSummary {
  demandNumber: string
  passengerName: string
  destination: string
  checkIn: string
  checkOut: string
  optionCount: number
  expiresAt: string | null
  hotelName: string
  hotelCategory: string | null
  hotelAddress: string | null
  hotelPhone: string | null
  roomCategory: string | null
  mealPlan: string | null
  supplierName: string | null
  nights: number
  roomCount: number
  nightlyRate: number
  nightlyTaxes: number
  roomSubtotal: number
  taxesSubtotal: number
  serviceFee: number
  total: number
  currency: string
  refundable: boolean
  cancellationDeadline: string | null
  cancellationPolicy: string | null
  paymentTerms: string | null
  notes: string | null
  reason: string | null
  policyLabels: string[]
}

export interface ApprovalPresentationContext {
  instanceType?: string | null
  demandNumber?: string | null
  companyName?: string | null
  requesterName?: string | null
  travelerName?: string | null
  serviceType?: string | null
  destination?: string | null
  travelStartDate?: string | null
  travelEndDate?: string | null
}

export interface ApprovalBusinessSummary {
  instanceType: string | null
  demandNumber: string | null
  companyName: string | null
  requesterName: string | null
  travelerName: string | null
  service: string | null
  destination: string | null
  travelStartDate: string | null
  travelEndDate: string | null
  amount: number | null
  currency: string
  urgent: boolean | null
  reason: string | null
  policyLabels: string[]
  budgetAvailable: number | null
  percentageAboveLowest: number | null
  percentageAboveAverage: number | null
}

export type ApprovalSubjectPresentation =
  | {
      kind: 'hotel_quote'
      hotelQuote: HotelQuoteApprovalSummary
    }
  | {
      kind: 'business'
      business: ApprovalBusinessSummary
    }

export function extractHotelQuoteApprovalSummary(
  subject: Record<string, unknown>,
): HotelQuoteApprovalSummary | null {
  const snapshot = parseSnapshot(subject.quoteSnapshot)
  if (!snapshot) return null

  const quote = asRecord(snapshot.quote)
  const demand = asRecord(snapshot.demand)
  const option = asRecord(snapshot.option)
  const hotel = asRecord(option?.hotel)
  const breakdown = asRecord(option?.breakdown)

  const demandNumber = text(demand?.number)
  const hotelName = text(hotel?.name) || text(option?.title)
  if (!demandNumber || !hotelName || !demand || !option || !breakdown) return null

  const total = number(breakdown.total) ?? number(option.amount) ?? number(subject.amount)
  if (total === null) return null

  return {
    demandNumber,
    passengerName: text(demand.passengerName) || 'Não informado',
    destination: text(demand.cityName) || text(subject.destination) || 'Não informado',
    checkIn: text(demand.checkIn) || text(option.startsAt) || '',
    checkOut: text(demand.checkOut) || text(option.endsAt) || '',
    optionCount: number(quote?.optionCount) ?? 1,
    expiresAt: text(quote?.expiresAt),
    hotelName,
    hotelCategory: text(hotel?.category),
    hotelAddress: text(hotel?.address),
    hotelPhone: text(hotel?.phone),
    roomCategory: text(hotel?.roomCategory) || text(breakdown.roomCategory),
    mealPlan: text(hotel?.mealPlan) || text(breakdown.mealPlan),
    supplierName: text(option.supplierName),
    nights: number(breakdown.nights) ?? 0,
    roomCount: number(breakdown.roomCount) ?? 0,
    nightlyRate: number(breakdown.nightlyRate) ?? 0,
    nightlyTaxes: number(breakdown.nightlyTaxes) ?? 0,
    roomSubtotal: number(breakdown.roomSubtotal) ?? 0,
    taxesSubtotal: number(breakdown.taxesSubtotal) ?? 0,
    serviceFee: number(breakdown.serviceFee) ?? 0,
    total,
    currency: text(breakdown.currency) || text(option.currency) || text(subject.currency) || 'BRL',
    refundable: boolean(breakdown.refundable) ?? boolean(option.refundable) ?? false,
    cancellationDeadline: text(breakdown.cancellationDeadline),
    cancellationPolicy: text(hotel?.cancellationPolicy) || text(breakdown.cancellationPolicy),
    paymentTerms: text(hotel?.paymentTerms) || text(breakdown.paymentTerms),
    notes: text(breakdown.notes),
    reason: approvalReason(subject),
    policyLabels: approvalPolicyLabels(subject.policyViolationCodes),
  }
}

/**
 * Produces the allow-listed presentation DTO that may cross the requester
 * boundary. It deliberately contains no identifiers, hashes or raw snapshot.
 */
export function buildApprovalSubjectPresentation(
  subject: Record<string, unknown>,
  context: ApprovalPresentationContext = {},
): ApprovalSubjectPresentation {
  const hotelQuote = extractHotelQuoteApprovalSummary(subject)
  return hotelQuote
    ? { kind: 'hotel_quote', hotelQuote }
    : { kind: 'business', business: extractApprovalBusinessSummary(subject, context) }
}

export function extractApprovalBusinessSummary(
  subject: Record<string, unknown>,
  context: ApprovalPresentationContext = {},
): ApprovalBusinessSummary {
  return {
    instanceType: text(context.instanceType),
    demandNumber: text(context.demandNumber),
    companyName: text(context.companyName),
    requesterName: text(context.requesterName),
    travelerName: text(context.travelerName),
    service: approvalServiceLabel(text(subject.product) || text(context.serviceType)),
    destination: text(subject.destination) || text(context.destination),
    travelStartDate: text(context.travelStartDate),
    travelEndDate: text(context.travelEndDate),
    amount: number(subject.amount),
    currency: text(subject.currency) || 'BRL',
    urgent: boolean(subject.urgent),
    reason: approvalReason(subject),
    policyLabels: approvalPolicyLabels(subject.policyViolationCodes),
    budgetAvailable: number(subject.budgetAvailable),
    percentageAboveLowest: number(subject.percentageAboveLowest),
    percentageAboveAverage: number(subject.percentageAboveAverage),
  }
}

export function approvalServiceLabel(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toLocaleLowerCase('pt-BR')
  const labels: Record<string, string> = {
    hotel: 'Hotel',
    hotelaria: 'Hotel',
    hospedagem: 'Hotel',
    aereo: 'Aéreo',
    aéreo: 'Aéreo',
    flight: 'Aéreo',
    carro: 'Locação de carro',
    car: 'Locação de carro',
    rodoviario: 'Rodoviário',
    rodoviário: 'Rodoviário',
    bus: 'Rodoviário',
    pacote: 'Pacote',
    seguro: 'Seguro-viagem',
  }
  return labels[normalized] || titleCase(value.replace(/[_-]+/g, ' '))
}

export function approvalPolicyLabel(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('pt-BR')
  const labels: Record<string, string> = {
    'local-hotel-selection-approval': 'Aprovação da cotação de hotel escolhida',
    'approval.dual-merit-cost': 'Aprovação de mérito e custo',
    'approval.international': 'Aprovação para viagem internacional',
    'approval.expiry-deadline': 'Prazo de aprovação em risco',
    'approval.separation-of-duties': 'Separação de funções na aprovação',
    'budget.required': 'Validação de orçamento obrigatória',
  }
  if (labels[normalized]) return labels[normalized]

  const translated = normalized
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      approval: 'aprovação',
      merit: 'mérito',
      cost: 'custo',
      budget: 'orçamento',
      hotel: 'hotel',
      selection: 'escolha',
      urgent: 'urgência',
      international: 'internacional',
      policy: 'política',
      required: 'obrigatória',
      local: '',
    })[word] ?? word)
    .filter(Boolean)
    .join(' ')
  return translated ? titleCase(translated) : 'Política aplicável'
}

function approvalReason(subject: Record<string, unknown>): string | null {
  return text(subject.reason)
    || text(subject.approvalReason)
    || text(subject.motivo)
    || text(subject.justification)
}

function approvalPolicyLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    const code = text(item)
    return code ? [approvalPolicyLabel(code)] : []
  }))]
}

function parseSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return asRecord(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function boolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function titleCase(value: string): string {
  const normalized = value.trim()
  return normalized ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1) : normalized
}
