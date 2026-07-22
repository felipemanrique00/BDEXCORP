import { createHash } from 'node:crypto'

import type {
  TechEmissionRecord,
  TechEmissionSegment,
  TechEmissionSummaryItem,
  TechEmissionsReport,
} from '@/lib/integrations/tech/tech-emissions-types'

export interface TechEmissionQuery {
  startDate: string
  endDate: string
}

export function normalizeTechEmission(raw: Record<string, unknown>): TechEmissionRecord {
  const firstName = text(raw.NOMEPAX)
  const surname = text(raw.SOBRENOMEPAX)
  const passengerName = joinPassengerName(firstName, surname)
  const service = normalizeService(raw.TIPO)
  const segments = Array.from({ length: 6 }, (_, index) => normalizeSegment(raw, index + 1)).filter(
    (segment): segment is TechEmissionSegment => Boolean(segment),
  )
  const route = buildRoute(segments) || optionalText(raw.TRECHOS)
  const agencyName = text(raw.NOMEFANTASIAAGENCIA) || 'Agência não informada'
  const clientName = text(raw.NOMECLIENTE) || 'Cliente não informado'
  const osNumber = text(raw.NumeroOS)
  const ticket = optionalText(raw.BILHETE)
  const locator = optionalText(raw.LOCALIZADOR)
  const issuedAt = optionalDateTime(raw.DTEMISSAO)
  const externalId = stableEmissionId({
    agencyName,
    clientName,
    osNumber,
    ticket,
    locator,
    passengerName,
    service,
    issuedAt,
    route,
  })
  const customerFare = amount(raw.TARIFACLIENTE)
  const customerTaxes = amount(raw.TAXASEMBARQUECLIENTE) + amount(raw.TAXADUFEECLIENTE) + amount(raw.OUTROSVALORESCLIENTE)
  const supplierFare = amount(raw.TARIFAFORNECEDOR)
  const supplierTaxes = amount(raw.TAXASEMBARQUEFORNECEDOR) + amount(raw.TAXASFORNECEDOR) + amount(raw.OUTROSVALORESFORNECDOR)
  const customerTotal = hasValue(raw.TOTALCLIENTE) ? amount(raw.TOTALCLIENTE) : customerFare + customerTaxes
  const supplierTotal = hasValue(raw.TOTALFORNECEDOR) ? amount(raw.TOTALFORNECEDOR) : supplierFare + supplierTaxes
  const ticketCancelled = booleanValue(raw.BILHETECANCELADO)
  const reservationCancelled = booleanValue(raw.RESERVACANCELADA)
  const osStatus = optionalText(raw.OSStatus)
  const lowestFares = segments.map((segment) => segment.lowestFare).filter(isPositiveNumber)
  const highestFares = segments.map((segment) => segment.highestFare).filter(isPositiveNumber)

  return {
    externalId,
    saleNumber: ticket ? `TECH:${ticket}` : `TECH:OS${osNumber || 'SEM-OS'}:${externalId.slice(-8)}`,
    agencyName,
    clientName,
    osNumber,
    passengerName,
    ageGroup: optionalText(raw.FAIXA_ETARIA),
    service,
    locator,
    system: optionalText(raw.SISTEMA),
    supplier: optionalText(raw.FORNECEDOR),
    tripType: optionalText(raw.TIPOVIAGEM),
    ticket,
    payment: optionalText(raw.PAGAMENTO),
    customerFare,
    customerTaxes,
    customerTotal,
    supplierFare,
    supplierTaxes,
    supplierTotal,
    requester: optionalText(raw.SOLICITANTE),
    approver: optionalText(raw.APROVADOR),
    issuer: optionalText(raw.EMISSOR),
    costCenter: optionalText(raw.CENTROCUSTO),
    policyName: optionalText(raw.NOMEPOLITICA),
    advanceDays: optionalInteger(raw.DIASANTECEDENCIA),
    respectedAdvancePolicy: optionalBoolean(raw.RESPEITOUPOLANTECEDENCIA),
    respectedLowestFarePolicy: optionalBoolean(raw.RESPEITOUPOLMAISBARATA),
    policyType: optionalText(raw.TIPOPOLITICA),
    reason: firstText(raw.MOTIVOINFORMADO, raw.DESCRICAOMOTIVO),
    justification: firstText(raw.JUSTIFICATIVAINFORMADA, raw.DESCRICAOJUSTIFICATIVA),
    createdAt: optionalDateTime(raw.DTCRIACAO),
    approvedAt: optionalDateTime(raw.DTAPROVACAO),
    issuedAt,
    cancelled: ticketCancelled || reservationCancelled || normalizeSearch(osStatus).includes('CANCELAD'),
    reservationCancelled,
    ticketCancelled,
    osStatus,
    route,
    hotelDailyRate: optionalAmount(raw.VALORDIARIAHOTEL),
    lowestFare: lowestFares.length ? Math.min(...lowestFares) : undefined,
    highestFare: highestFares.length ? Math.max(...highestFares) : undefined,
    segments,
  }
}

export function buildTechEmissionsReport(
  query: TechEmissionQuery,
  emissions: TechEmissionRecord[],
): TechEmissionsReport {
  const byClient: Record<string, TechEmissionSummaryItem> = {}
  const byIssuer: Record<string, TechEmissionSummaryItem> = {}
  const byService: Record<string, TechEmissionSummaryItem> = {}
  let customer = 0
  let supplier = 0
  for (const emission of emissions) {
    customer += emission.customerTotal
    supplier += emission.supplierTotal
    incrementSummary(byClient, emission.clientName, emission)
    incrementSummary(byIssuer, emission.issuer || 'Emissor não informado', emission)
    incrementSummary(byService, emission.service, emission)
  }
  return {
    source: 'tech-travel',
    period: query,
    fetchedAt: new Date().toISOString(),
    total: emissions.length,
    totals: { customer, supplier, result: customer - supplier },
    byClient,
    byIssuer,
    byService,
    emissions,
  }
}

function normalizeSegment(raw: Record<string, unknown>, index: number): TechEmissionSegment | null {
  const origin = text(raw[`ORIGEM${index}`])
  const destination = text(raw[`DESTINO${index}`])
  const departureAt = optionalDateTime(raw[`DTPARTIDA${index}`])
  const arrivalAt = optionalDateTime(raw[`DTCHEGADA${index}`])
  const flightNumber = optionalText(raw[`VOO${index}`])
  if (!origin && !destination && !departureAt && !arrivalAt && !flightNumber) return null
  return {
    origin,
    destination,
    departureAt,
    arrivalAt,
    flightNumber,
    fare: optionalAmount(raw[`TARIFA${index}`]),
    fee: optionalAmount(raw[`TAXADUFEE${index}`]),
    boardingTax: optionalAmount(raw[`TAXAEMBARQUE${index}`]),
    fareFamily: optionalText(raw[`CLASSEFAMILIA${index}`]),
    lowestFare: optionalAmount(raw[`MENORTARIFA${index}`]),
    highestFare: optionalAmount(raw[`MAIORTARIFA${index}`]),
    connections: optionalInteger(raw[`QTDCONEXOES${index}`]),
    alternativeFare: optionalAmount(raw[`TARIFA_ALTERNATIVA${index}`]),
    alternativeDate: optionalDateTime(raw[`DATA_ALTERNATIVA${index}`]),
    netFare: optionalAmount(raw[`TARIFA_NET${index}`]),
  }
}

function incrementSummary(target: Record<string, TechEmissionSummaryItem>, key: string, emission: TechEmissionRecord): void {
  const current = target[key] || { count: 0, customerTotal: 0, supplierTotal: 0 }
  current.count += 1
  current.customerTotal += emission.customerTotal
  current.supplierTotal += emission.supplierTotal
  target[key] = current
}

function stableEmissionId(value: Record<string, unknown>): string {
  return `tech_${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`
}

function buildRoute(segments: TechEmissionSegment[]): string | undefined {
  const points: string[] = []
  for (const segment of segments) {
    if (segment.origin && points.at(-1) !== segment.origin) points.push(segment.origin)
    if (segment.destination && points.at(-1) !== segment.destination) points.push(segment.destination)
  }
  return points.length ? points.join('/') : undefined
}

function joinPassengerName(firstName: string, surname: string): string {
  if (!surname) return firstName
  if (!firstName) return surname
  if (normalizeSearch(firstName).endsWith(normalizeSearch(surname))) return firstName
  return `${firstName} ${surname}`.trim()
}

function normalizeService(value: unknown): TechEmissionRecord['service'] {
  const normalized = normalizeSearch(value)
  if (normalized.includes('AEREO')) return 'Aéreo'
  if (normalized.includes('HOTEL')) return 'Hotel'
  return 'Outro'
}

function optionalDateTime(value: unknown): string | undefined {
  const raw = optionalText(value)
  if (!raw) return undefined
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?/)
  if (iso) return iso[2] ? `${iso[1]}T${iso[2]}` : iso[1]
  const brazilian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brazilian) return `${brazilian[3]}-${brazilian[2].padStart(2, '0')}-${brazilian[1].padStart(2, '0')}`
  return undefined
}

function amount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value ?? '').trim().replace(/\s|R\$/gi, '')
  if (!raw) return 0
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function optionalAmount(value: unknown): number | undefined {
  if (!hasValue(value)) return undefined
  const parsed = amount(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function hasValue(value: unknown): boolean {
  return value != null && String(value).trim() !== ''
}

function optionalInteger(value: unknown): number | undefined {
  if (!hasValue(value)) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['1', 'TRUE', 'SIM', 'YES'].includes(String(value ?? '').trim().toUpperCase())
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (!hasValue(value)) return undefined
  return booleanValue(value)
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = optionalText(value)
    if (result) return result
  }
  return undefined
}

function text(value: unknown): string {
  return optionalText(value) || ''
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined
  const result = String(value).replace(/\s+/g, ' ').trim()
  return result || undefined
}

function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
