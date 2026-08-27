'use client'

import {
  governanceJsonBody,
  requestGovernanceJson,
} from '@/lib/governance-client'
import {
  WINTOUR_PAYMENT_METHODS,
  type WintourPaymentMethod,
} from '@/lib/integrations/wintour/wintour-xml'

export { WINTOUR_PAYMENT_METHODS }

export const WINTOUR_UPDATE_FIELDS = [
  { code: 'vl_tarifa', label: 'Valor da tarifa (à vista/faturada)', kind: 'currency' },
  { code: 'vl_taxa_br', label: 'Taxa de embarque (à vista/faturada)', kind: 'currency' },
  { code: 'outras_txs1_vista', label: 'Outras taxas 1 (à vista/faturada)', kind: 'currency' },
  { code: 'outras_txs2_vista', label: 'Outras taxas 2 (à vista/faturada)', kind: 'currency' },
  { code: 'outras_txs3_vista', label: 'Outras taxas 3 (à vista/faturada)', kind: 'currency' },
  { code: 'vl_tarifa_df', label: 'Valor da tarifa (cartão/cheque fornecedor)', kind: 'currency' },
  { code: 'vl_taxa_df', label: 'Taxa de embarque (cartão/cheque fornecedor)', kind: 'currency' },
  { code: 'outras_txs1_df', label: 'Outras taxas 1 (cartão/cheque fornecedor)', kind: 'currency' },
  { code: 'outras_txs2_df', label: 'Outras taxas 2 (cartão/cheque fornecedor)', kind: 'currency' },
  { code: 'outras_txs3_df', label: 'Outras taxas 3 (cartão/cheque fornecedor)', kind: 'currency' },
  { code: 'vl_tarifa_cartao', label: 'Valor da tarifa (cartão MP)', kind: 'currency' },
  { code: 'vl_taxa_br_cartao', label: 'Taxa de embarque (cartão MP)', kind: 'currency' },
  { code: 'outras_txs1_cartao', label: 'Outras taxas 1 (cartão MP)', kind: 'currency' },
  { code: 'outras_txs2_cartao', label: 'Outras taxas 2 (cartão MP)', kind: 'currency' },
  { code: 'outras_txs3_cartao', label: 'Outras taxas 3 (cartão MP)', kind: 'currency' },
  { code: 'tarifa_y', label: 'Full fare', kind: 'currency' },
  { code: 'best_fare', label: 'Best fare', kind: 'currency' },
  { code: 'best_fare_disp', label: 'Best fare disponível', kind: 'currency' },
  { code: 'outras_txs1_id_tx', label: 'Conta de outras taxas 1', kind: 'text' },
  { code: 'outras_txs2_id_tx', label: 'Conta de outras taxas 2', kind: 'text' },
  { code: 'outras_txs3_id_tx', label: 'Conta de outras taxas 3', kind: 'text' },
  { code: 'info_adcs', label: 'Informações adicionais externas (acrescentar)', kind: 'append' },
  { code: 'info_internas', label: 'Informações adicionais internas (acrescentar)', kind: 'append' },
  { code: 'dt_inicio_servicos', label: 'Data inicial dos serviços', kind: 'date' },
  { code: 'dt_fim_servicos', label: 'Data final dos serviços', kind: 'date' },
  { code: 'fop', label: 'Forma de pagamento', kind: 'payment' },
  { code: 'cta_cp', label: 'Código do cartão próprio (CP)', kind: 'text' },
  { code: 'cta_cartao', label: 'Código do cartão máquina própria (MP)', kind: 'text' },
  { code: 'cod_ccusto', label: 'Centro de custos da agência', kind: 'text' },
  { code: 'tour_code', label: 'Tour code', kind: 'text' },
  { code: 'vl_comiss_ag', label: 'Comissão da agência', kind: 'currency' },
  { code: 'solicitante', label: 'Solicitante', kind: 'text' },
  { code: 'aprovador', label: 'Aprovador', kind: 'text' },
  { code: 'gera_fin', label: 'Gerar financeiro (1 ou 0)', kind: 'boolean-code' },
  { code: 'status', label: 'Código do status', kind: 'text' },
  { code: 'data_lct', label: 'Data de lançamento', kind: 'date' },
  { code: 'cta_emissor', label: 'Código do emissor', kind: 'text' },
  { code: 'cta_promotor', label: 'Código do promotor', kind: 'text' },
  { code: 'cta_gerente', label: 'Código do gerente', kind: 'text' },
  { code: 'cta_fornecedor', label: 'Código do fornecedor', kind: 'text' },
  { code: 'cia', label: 'Código do prestador/companhia', kind: 'text' },
  { code: 'cod_ccusto_cliente', label: 'Centro de custos do cliente', kind: 'text' },
  { code: 'id_pa', label: 'Filial da venda (alteração exclusiva)', kind: 'integer' },
  { code: 'vl_comiss_emissor', label: 'Comissão do emissor', kind: 'currency' },
  { code: 'vl_over_emissor', label: 'Over do emissor', kind: 'currency' },
  { code: 'vl_comiss_promotor', label: 'Comissão do promotor', kind: 'currency' },
  { code: 'vl_comiss_gerente', label: 'Comissão do gerente', kind: 'currency' },
] as const

export type WintourUpdateFieldCode = typeof WINTOUR_UPDATE_FIELDS[number]['code']
export type WintourOutboundOperation = 'create' | 'update'
export type WintourOutboundUiState =
  | 'blocked'
  | 'ready'
  | 'ambiguous'
  | 'protocol'
  | 'manual_review'
  | 'completed'

export interface WintourSyncSettingsClient {
  enabled: boolean
  agencyName: string
  syncFrom: string
  maxAttempts: number
  discoveryBatchSize: number
  branchId: number | null
  branchName: string | null
  freeField: string | null
  productCodes: { air: string | null; hotel: string | null; car: string | null; bus: string | null }
  paymentMethodCodes: {
    faturado: WintourPaymentMethod | null
    pix: WintourPaymentMethod | null
    cartao_corporativo: WintourPaymentMethod | null
    cartao_agencia: WintourPaymentMethod | null
    transferencia: WintourPaymentMethod | null
    dinheiro: WintourPaymentMethod | null
    outro: WintourPaymentMethod | null
  }
  serviceRouteTypes: { air: 1 | null; hotel: 2 | null; car: 3 | null; bus: 4 | 7 | null }
  tariffNetDefault: 0 | 1 | null
  accountDefaults: {
    issuer: string | null
    promoter: string | null
    manager: string | null
    supplier: string | null
    agencyCostCenter: string | null
    cardCp: string | null
    cardMp: string | null
    additionalFee: string | null
    additionalFee2: string | null
    issuanceFee: string | null
  }
  customerAction: 'none' | 'I' | 'U' | 'IU'
  autoSend: boolean
  autoPoll: boolean
  companyMappings: Array<{
    companyId: string
    companyName: string
    wintourAccountCode: string
  }>
  version: number | null
  updatedAt: string | null
}

export interface WintourSaleLinkClient {
  id: string
  sourceType: string
  sourceId: string
  sourceLabel: string
  companyName: string | null
  travelerName: string | null
  wintourSaleNumber: string | null
  externalId: string
  version: number
  updatedAt: string
}

export interface WintourSyncJobClient {
  id: string
  operation: WintourOutboundOperation
  status: string
  uiState: WintourOutboundUiState
  sourceType: string
  sourceId: string
  sourceLabel: string
  companyName: string | null
  travelerName: string | null
  saleLinkId: string | null
  saleLinkVersion: number
  wintourSaleNumber: string | null
  externalId: string | null
  protocol: string | null
  protocolStatus: string | null
  blockedReasons: string[]
  humanActionRequired: boolean
  downloadAvailable: boolean
  preparable: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface WintourSyncDashboardClient {
  settings: WintourSyncSettingsClient
  jobs: WintourSyncJobClient[]
  saleLinks: WintourSaleLinkClient[]
  availableCompanies: Array<{ id: string; name: string; customerCode: string | null }>
  capabilities: {
    prepare: boolean
    send: boolean
    poll: boolean
    reconcile: boolean
    download: boolean
  }
  counts: Record<WintourOutboundUiState, number>
}

export interface WintourAdjustmentChangeClient {
  field: WintourUpdateFieldCode
  content: string
  remark?: 'append' | 'xxmanter'
}

export interface WintourAdjustmentInputClient {
  saleLinkId: string
  expectedVersion: number
  reason: string
  recalculateCalculatedFields?: boolean
  changes: WintourAdjustmentChangeClient[]
}

export type WintourReconcileTargetState =
  | 'manual_review'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled'

export async function getWintourSyncDashboardFromServer(filters: {
  state?: WintourOutboundUiState | ''
  operation?: WintourOutboundOperation | ''
  limit?: number
} = {}): Promise<WintourSyncDashboardClient> {
  const query = new URLSearchParams()
  if (filters.state) query.set('state', filters.state)
  if (filters.operation) query.set('operation', filters.operation)
  if (filters.limit) query.set('limit', String(Math.min(Math.max(filters.limit, 1), 200)))
  const suffix = query.size ? `?${query}` : ''
  const payload = await requestGovernanceJson<{ ok: true; dashboard: unknown }>(
    `/api/integrations/wintour/sync${suffix}`,
  )
  return normalizeDashboard(payload.dashboard)
}

export async function saveWintourSyncSettingsOnServer(
  settings: Omit<WintourSyncSettingsClient, 'updatedAt'>,
): Promise<WintourSyncSettingsClient> {
  const payload = await requestGovernanceJson<{ ok: true; settings: unknown }>(
    '/api/integrations/wintour/sync/settings',
    {
      method: 'PUT',
      ...governanceJsonBody({
        enabled: settings.enabled,
        agencyName: settings.agencyName,
        syncFrom: dateStartIso(settings.syncFrom),
        maxAttempts: settings.maxAttempts,
        discoveryBatchSize: settings.discoveryBatchSize,
        branchId: settings.branchId,
        branchName: settings.branchName,
        freeField: settings.freeField,
        productCodes: settings.productCodes,
        paymentMethodCodes: settings.paymentMethodCodes,
        serviceRouteTypes: settings.serviceRouteTypes,
        tariffNetDefault: settings.tariffNetDefault,
        accountDefaults: settings.accountDefaults,
        customerAction: settings.customerAction,
        autoSend: settings.autoSend,
        autoPoll: settings.autoPoll,
        companyMappings: settings.companyMappings.map(({ companyId, wintourAccountCode }) => ({
          companyId,
          wintourAccountCode,
        })),
        expectedVersion: settings.version,
      }),
    },
  )
  return normalizeSettings(payload.settings)
}

export async function discoverWintourSalesOnServer(input: {
  companyIds?: string[]
  limit?: number
} = {}): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    '/api/integrations/wintour/sync/discover',
    { method: 'POST', ...governanceJsonBody(input) },
  )
}

export async function prepareWintourSyncSaleOnServer(
  saleLinkId: string,
  expectedVersion: number,
): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    `/api/integrations/wintour/sync/sale-links/${encodeURIComponent(saleLinkId)}/prepare`,
    { method: 'POST', ...governanceJsonBody({ expectedVersion }) },
  )
}

export async function bindWintourSaleNumberOnServer(input: {
  saleLinkId: string
  expectedVersion: number
  wintourSaleNumber: string
  reason: string
}): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    '/api/integrations/wintour/sync/sale-links/bind',
    { method: 'POST', ...governanceJsonBody(input) },
  )
}

export async function createWintourSaleAdjustmentOnServer(
  input: WintourAdjustmentInputClient,
): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    '/api/integrations/wintour/sync/adjustments',
    { method: 'POST', ...governanceJsonBody(input) },
  )
}

export async function downloadWintourSyncXmlFromServer(jobId: string): Promise<{
  blob: Blob
  filename: string
}> {
  const response = await fetch(
    `/api/integrations/wintour/sync/jobs/${encodeURIComponent(jobId)}/download`,
    { method: 'GET', cache: 'no-store', credentials: 'same-origin' },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Não foi possível baixar o XML do Wintour.')
  }
  const disposition = response.headers.get('Content-Disposition') || ''
  const filenameMatch = disposition.match(/filename="([^"\\/]+)"/i)
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || `wintour-${jobId}.xml`,
  }
}

export async function retryWintourSyncJobOnServer(input: {
  jobId: string
  expectedJobVersion: number
  reason: string
}): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    `/api/integrations/wintour/sync/jobs/${encodeURIComponent(input.jobId)}/retry`,
    {
      method: 'POST',
      ...governanceJsonBody({
        expectedJobVersion: input.expectedJobVersion,
        reason: input.reason,
      }),
    },
  )
}

export async function reconcileWintourSyncJobOnServer(input: {
  jobId: string
  expectedJobVersion: number
  targetState: WintourReconcileTargetState
  wintourSaleNumber?: string
  reason: string
}): Promise<Record<string, unknown>> {
  return requestGovernanceJson<Record<string, unknown> & { ok: true }>(
    `/api/integrations/wintour/sync/jobs/${encodeURIComponent(input.jobId)}/reconcile`,
    {
      method: 'POST',
      ...governanceJsonBody({
        expectedJobVersion: input.expectedJobVersion,
        targetState: input.targetState,
        wintourSaleNumber: input.wintourSaleNumber || undefined,
        reason: input.reason,
      }),
    },
  )
}

export function wintourUiStateFromStatus(
  status: string,
  options: { protocol?: string | null; blockedReasons?: string[] } = {},
): WintourOutboundUiState {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('ambiguous')) return 'ambiguous'
  if (options.blockedReasons?.length) {
    return normalized.includes('manual') ? 'manual_review' : 'blocked'
  }
  if (normalized.includes('complete') || normalized.includes('success') || normalized === 'processed') {
    return 'completed'
  }
  if (
    normalized.includes('manual')
    || normalized.includes('failed')
    || normalized.includes('dead')
    || normalized === 'rejected'
    || normalized === 'cancelled'
  ) {
    return 'manual_review'
  }
  if (options.protocol || normalized.includes('protocol') || normalized === 'received' || normalized === 'processing') {
    return 'protocol'
  }
  if (normalized.includes('block')) return 'blocked'
  return 'ready'
}

function normalizeDashboard(value: unknown): WintourSyncDashboardClient {
  const source = objectValue(value)
  const rawLinks = arrayValue(source.saleLinks).map(objectValue)
  const rawJobs = arrayValue(source.jobs).map(objectValue)
  const availableCompanies = arrayValue(source.availableCompanies).map((item) => {
    const company = objectValue(item)
    return {
      id: stringValue(company.id),
      name: stringValue(company.name) || stringValue(company.customerCode) || 'Empresa',
      customerCode: nullableString(company.customerCode),
    }
  }).filter((company) => Boolean(company.id))
  const companyNames = new Map(availableCompanies.map((company) => [company.id, company.name]))
  const settings = normalizeSettings(source.settings)
  settings.companyMappings = settings.companyMappings.map((mapping) => ({
    ...mapping,
    companyName: mapping.companyName || companyNames.get(mapping.companyId) || mapping.companyId,
  }))

  const saleLinks: WintourSaleLinkClient[] = rawLinks.map((link) => ({
    id: stringValue(link.id),
    sourceType: 'travel_emission',
    sourceId: stringValue(link.emissionId),
    sourceLabel: `Emissão ${shortIdentifier(link.emissionId)}`,
    companyName: companyNames.get(stringValue(link.companyId)) || null,
    travelerName: null,
    wintourSaleNumber: nullableString(link.wintourSaleNumber),
    externalId: stringValue(link.idvExterno),
    version: numberValue(link.version, 1),
    updatedAt: stringValue(link.updatedAt),
  })).filter((link) => Boolean(link.id))

  const jobsByLink = new Map<string, Record<string, unknown>>()
  for (const job of rawJobs) {
    const saleLinkId = stringValue(job.saleLinkId)
    if (saleLinkId && !jobsByLink.has(saleLinkId)) jobsByLink.set(saleLinkId, job)
  }

  const jobs: WintourSyncJobClient[] = rawLinks.map((link) => {
    const saleLinkId = stringValue(link.id)
    const job = jobsByLink.get(saleLinkId)
    const blockedReasons = stringArray(link.blockedReasons)
    const linkState = stringValue(link.state) || 'ready'
    const linkOverridesHistoricalJob = blockedReasons.length > 0
      || linkState === 'blocked'
      || linkState === 'manual_review'
    const state = linkOverridesHistoricalJob
      ? linkState
      : stringValue(job?.state) || linkState
    const protocol = nullableString(job?.latestProtocolCode)
    const uiState = wintourUiStateFromStatus(state, { protocol, blockedReasons })
    const operation: WintourOutboundOperation = stringValue(job?.operation) === 'update' ? 'update' : 'create'
    return {
      id: stringValue(job?.id) || `link:${saleLinkId}`,
      operation,
      status: state,
      uiState,
      sourceType: 'travel_emission',
      sourceId: stringValue(link.emissionId),
      sourceLabel: `Emissão ${shortIdentifier(link.emissionId)}`,
      companyName: companyNames.get(stringValue(link.companyId)) || null,
      travelerName: null,
      saleLinkId,
      saleLinkVersion: numberValue(link.version, 1),
      wintourSaleNumber: nullableString(link.wintourSaleNumber),
      externalId: nullableString(link.idvExterno),
      protocol,
      protocolStatus: nullableString(job?.latestProtocolKind),
      blockedReasons,
      humanActionRequired: ['ambiguous', 'protocol', 'manual_review', 'blocked'].includes(uiState),
      downloadAvailable: Boolean(job?.downloadAvailable),
      preparable: !job && state === 'ready',
      version: numberValue(job?.version, numberValue(link.version, 1)),
      createdAt: stringValue(job?.preparedAt) || stringValue(link.updatedAt),
      updatedAt: stringValue(job?.updatedAt) || stringValue(link.updatedAt),
    }
  }).filter((job) => Boolean(job.saleLinkId))

  const listedSaleLinks = new Set(rawLinks.map((link) => stringValue(link.id)))
  for (const job of rawJobs) {
    const saleLinkId = stringValue(job.saleLinkId)
    if (!saleLinkId || listedSaleLinks.has(saleLinkId)) continue
    const state = stringValue(job.state) || 'manual_review'
    const protocol = nullableString(job.latestProtocolCode)
    const operation: WintourOutboundOperation = stringValue(job.operation) === 'update' ? 'update' : 'create'
    jobs.push({
      id: stringValue(job.id),
      operation,
      status: state,
      uiState: wintourUiStateFromStatus(state, { protocol }),
      sourceType: 'travel_emission',
      sourceId: saleLinkId,
      sourceLabel: `Sincronização ${shortIdentifier(job.id)}`,
      companyName: null,
      travelerName: null,
      saleLinkId,
      saleLinkVersion: 1,
      wintourSaleNumber: null,
      externalId: null,
      protocol,
      protocolStatus: nullableString(job.latestProtocolKind),
      blockedReasons: [],
      humanActionRequired: ['received', 'processing', 'manual_review'].includes(state),
      downloadAvailable: job.downloadAvailable === true,
      preparable: false,
      version: numberValue(job.version, 1),
      createdAt: stringValue(job.preparedAt),
      updatedAt: stringValue(job.updatedAt),
    })
  }

  const counts = emptyCounts()
  for (const job of jobs) counts[job.uiState] += 1

  const rawCapabilities = objectValue(source.capabilities)
  return {
    settings,
    jobs,
    saleLinks,
    availableCompanies,
    capabilities: {
      prepare: rawCapabilities.prepare !== false,
      send: rawCapabilities.send === true,
      poll: rawCapabilities.poll === true,
      reconcile: rawCapabilities.reconcile === true,
      download: rawCapabilities.download === true,
    },
    counts,
  }
}

function normalizeSettings(value: unknown): WintourSyncSettingsClient {
  const hasSettings = Boolean(value && typeof value === 'object' && !Array.isArray(value))
  const source = objectValue(value)
  const productCodes = objectValue(source.productCodes)
  const paymentMethodCodes = objectValue(source.paymentMethodCodes)
  const serviceRouteTypes = objectValue(source.serviceRouteTypes)
  const accountDefaults = objectValue(source.accountDefaults)
  return {
    enabled: source.enabled === true,
    agencyName: stringValue(source.agencyName),
    syncFrom: stringValue(source.syncFrom).slice(0, 10),
    maxAttempts: numberValue(source.maxAttempts, 3),
    discoveryBatchSize: numberValue(source.discoveryBatchSize, 100),
    branchId: nullableNumber(source.branchId),
    branchName: nullableString(source.branchName),
    freeField: nullableString(source.freeField),
    productCodes: {
      air: nullableString(productCodes.air),
      hotel: nullableString(productCodes.hotel),
      car: nullableString(productCodes.car),
      bus: nullableString(productCodes.bus),
    },
    paymentMethodCodes: {
      faturado: paymentMethod(paymentMethodCodes.faturado),
      pix: paymentMethod(paymentMethodCodes.pix),
      cartao_corporativo: paymentMethod(paymentMethodCodes.cartao_corporativo),
      cartao_agencia: paymentMethod(paymentMethodCodes.cartao_agencia),
      transferencia: paymentMethod(paymentMethodCodes.transferencia),
      dinheiro: paymentMethod(paymentMethodCodes.dinheiro),
      outro: paymentMethod(paymentMethodCodes.outro),
    },
    serviceRouteTypes: {
      air: hasSettings ? literalNumber(serviceRouteTypes.air, 1) : 1,
      hotel: hasSettings ? literalNumber(serviceRouteTypes.hotel, 2) : 2,
      car: hasSettings ? literalNumber(serviceRouteTypes.car, 3) : 3,
      bus: hasSettings ? busRouteType(serviceRouteTypes.bus) : null,
    },
    tariffNetDefault: source.tariffNetDefault === 0 || source.tariffNetDefault === 1 ? source.tariffNetDefault : null,
    accountDefaults: {
      issuer: nullableString(accountDefaults.issuer),
      promoter: nullableString(accountDefaults.promoter),
      manager: nullableString(accountDefaults.manager),
      supplier: nullableString(accountDefaults.supplier),
      agencyCostCenter: nullableString(accountDefaults.agencyCostCenter),
      cardCp: nullableString(accountDefaults.cardCp),
      cardMp: nullableString(accountDefaults.cardMp),
      additionalFee: nullableString(accountDefaults.additionalFee),
      additionalFee2: nullableString(accountDefaults.additionalFee2),
      issuanceFee: nullableString(accountDefaults.issuanceFee),
    },
    customerAction: customerAction(source.customerAction),
    autoSend: source.autoSend === true,
    autoPoll: source.autoPoll === true,
    companyMappings: arrayValue(source.companyMappings).map((item) => {
      const mapping = objectValue(item)
      return {
        companyId: stringValue(mapping.companyId),
        companyName: stringValue(mapping.companyName),
        wintourAccountCode: stringValue(mapping.wintourAccountCode),
      }
    }).filter((mapping) => Boolean(mapping.companyId && mapping.wintourAccountCode)),
    version: source.version === null || source.version === undefined ? null : numberValue(source.version, 1),
    updatedAt: nullableString(source.updatedAt),
  }
}

function emptyCounts(): Record<WintourOutboundUiState, number> {
  return { blocked: 0, ready: 0, ambiguous: 0, protocol: 0, manual_review: 0, completed: 0 }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function nullableString(value: unknown): string | null {
  const normalized = stringValue(value)
  return normalized || null
}

function numberValue(value: unknown, fallback: number): number {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const normalized = Number(value)
  return Number.isInteger(normalized) ? normalized : null
}

function paymentMethod(value: unknown): WintourPaymentMethod | null {
  const normalized = stringValue(value)
  return (WINTOUR_PAYMENT_METHODS as readonly string[]).includes(normalized)
    ? normalized as WintourPaymentMethod
    : null
}

function literalNumber<T extends 1 | 2 | 3>(value: unknown, literal: T): T | null {
  return Number(value) === literal ? literal : null
}

function busRouteType(value: unknown): 4 | 7 | null {
  return Number(value) === 4 ? 4 : Number(value) === 7 ? 7 : null
}

function customerAction(value: unknown): 'none' | 'I' | 'U' | 'IU' {
  return value === 'I' || value === 'U' || value === 'IU' ? value : 'none'
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map(stringValue).filter(Boolean)
}

function shortIdentifier(value: unknown): string {
  const normalized = stringValue(value)
  return normalized.length > 12 ? `${normalized.slice(0, 8)}…` : normalized || 'sem ID'
}

function dateStartIso(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value
}
