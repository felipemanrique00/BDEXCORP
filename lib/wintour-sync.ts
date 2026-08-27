import { z } from 'zod'

import { WINTOUR_PAYMENT_METHODS } from '@/lib/integrations/wintour/wintour-xml'

export const WINTOUR_SYNC_STATES = [
  'blocked',
  'ready',
  'sending',
  'ambiguous',
  'received',
  'processing',
  'manual_review',
  'completed',
  'rejected',
  'failed',
  'cancelled',
] as const

export const WINTOUR_SYNC_OPERATIONS = ['create', 'update'] as const

export const WINTOUR_ADJUSTMENT_FIELDS = [
  'vl_tarifa',
  'vl_taxa_br',
  'outras_txs1_vista',
  'outras_txs2_vista',
  'outras_txs3_vista',
  'vl_tarifa_df',
  'vl_taxa_df',
  'outras_txs1_df',
  'outras_txs2_df',
  'outras_txs3_df',
  'vl_tarifa_cartao',
  'vl_taxa_br_cartao',
  'outras_txs1_cartao',
  'outras_txs2_cartao',
  'outras_txs3_cartao',
  'tarifa_y',
  'best_fare',
  'best_fare_disp',
  'outras_txs1_id_tx',
  'outras_txs2_id_tx',
  'outras_txs3_id_tx',
  'info_adcs',
  'info_internas',
  'dt_inicio_servicos',
  'dt_fim_servicos',
  'fop',
  'cta_cp',
  'cta_cartao',
  'cod_ccusto',
  'tour_code',
  'vl_comiss_ag',
  'solicitante',
  'aprovador',
  'gera_fin',
  'status',
  'data_lct',
  'cta_emissor',
  'cta_promotor',
  'cta_gerente',
  'cta_fornecedor',
  'cia',
  'cod_ccusto_cliente',
  'id_pa',
  'vl_comiss_emissor',
  'vl_over_emissor',
  'vl_comiss_promotor',
  'vl_comiss_gerente',
] as const

export const wintourSyncStateSchema = z.enum(WINTOUR_SYNC_STATES)
export const wintourSyncOperationSchema = z.enum(WINTOUR_SYNC_OPERATIONS)
export const wintourAdjustmentFieldSchema = z.enum(WINTOUR_ADJUSTMENT_FIELDS)

const uuidSchema = z.string().uuid()
const versionSchema = z.number().int().positive()
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)
const safeTextSchema = z.string().trim().min(1).max(2_000)
const nullableCode = (max: number) => z.string().trim().min(1).max(max).nullable()
const wintourPaymentMethodSchema = z.enum(WINTOUR_PAYMENT_METHODS)

export const wintourCompanyMappingSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  wintourAccountCode: z.string().trim().min(1).max(60),
}).strict()

export const wintourProductCodesSchema = z.object({
  air: nullableCode(10),
  hotel: nullableCode(10),
  car: nullableCode(10),
  bus: nullableCode(10),
}).strict()

export const wintourPaymentMethodCodesSchema = z.object({
  faturado: wintourPaymentMethodSchema.nullable(),
  pix: wintourPaymentMethodSchema.nullable(),
  cartao_corporativo: wintourPaymentMethodSchema.nullable(),
  cartao_agencia: wintourPaymentMethodSchema.nullable(),
  transferencia: wintourPaymentMethodSchema.nullable(),
  dinheiro: wintourPaymentMethodSchema.nullable(),
  outro: wintourPaymentMethodSchema.nullable(),
}).strict()

export const wintourServiceRouteTypesSchema = z.object({
  air: z.literal(1).nullable(),
  hotel: z.literal(2).nullable(),
  car: z.literal(3).nullable(),
  bus: z.union([z.literal(4), z.literal(7)]).nullable(),
}).strict()

export const wintourAccountDefaultsSchema = z.object({
  issuer: nullableCode(60),
  promoter: nullableCode(60),
  manager: nullableCode(60),
  supplier: nullableCode(60),
  agencyCostCenter: nullableCode(10),
  cardCp: nullableCode(10),
  cardMp: nullableCode(10),
  additionalFee: nullableCode(10),
  additionalFee2: nullableCode(10),
  issuanceFee: nullableCode(10),
}).strict()

export const wintourSyncSettingsInputSchema = z.object({
  enabled: z.boolean(),
  syncFrom: z.string().datetime({ offset: true }),
  agencyName: z.string().trim().min(1).max(50),
  branchId: z.number().int().positive().max(2_147_483_647).nullable(),
  branchName: z.string().trim().min(1).max(60).nullable(),
  freeField: z.string().max(1_200).nullable(),
  productCodes: wintourProductCodesSchema,
  paymentMethodCodes: wintourPaymentMethodCodesSchema,
  serviceRouteTypes: wintourServiceRouteTypesSchema,
  tariffNetDefault: z.union([z.literal(0), z.literal(1)]).nullable(),
  accountDefaults: wintourAccountDefaultsSchema,
  customerAction: z.enum(['none', 'I', 'U', 'IU']),
  autoSend: z.boolean().default(false),
  autoPoll: z.boolean().default(false),
  companyMappings: z.array(wintourCompanyMappingSchema).max(500),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  discoveryBatchSize: z.number().int().min(1).max(500).default(100),
  expectedVersion: versionSchema.nullable(),
}).strict()

export const wintourSyncDashboardFiltersSchema = z.object({
  state: wintourSyncStateSchema.optional(),
  operation: wintourSyncOperationSchema.optional(),
  companyId: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict().default({})

export const discoverWintourSyncSalesInputSchema = z.object({
  companyIds: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict()

export const prepareWintourSyncJobInputSchema = z.object({
  saleLinkId: uuidSchema,
  expectedVersion: versionSchema,
  operation: wintourSyncOperationSchema.optional(),
}).strict()

export const retryWintourSyncJobInputSchema = z.object({
  jobId: uuidSchema,
  expectedJobVersion: versionSchema,
  reason: safeTextSchema,
}).strict()

export const reconcileWintourSyncJobInputSchema = z.object({
  jobId: uuidSchema,
  expectedJobVersion: versionSchema,
  targetState: z.enum(['manual_review', 'completed', 'rejected', 'failed', 'cancelled']),
  wintourSaleNumber: z.string().regex(/^[1-9][0-9]{0,9}$/).optional(),
  reason: safeTextSchema,
}).strict()

export const recoverStaleWintourSyncJobsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
}).strict()

export const prepareReadyWintourSyncJobsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
}).strict()

export const bindWintourSaleNumberInputSchema = z.object({
  saleLinkId: uuidSchema,
  expectedVersion: versionSchema,
  wintourSaleNumber: z.string().regex(/^[1-9][0-9]{0,9}$/),
  reason: safeTextSchema,
}).strict()

export const wintourSaleAdjustmentChangeSchema = z.object({
  field: wintourAdjustmentFieldSchema,
  content: z.string().max(4_000),
  remark: z.enum(['append', 'xxmanter']).optional(),
}).strict().superRefine((change, context) => {
  if (change.field === 'info_adcs' || change.field === 'info_internas') {
    if (change.remark !== undefined && change.remark !== 'append') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remark'],
        message: 'Informacoes livres exigem remark append.',
      })
    }
    return
  }
  if (change.field === 'fop' && change.content === 'XX') {
    if (change.remark !== undefined && change.remark !== 'xxmanter') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remark'],
        message: 'fop=XX exige remark xxmanter explicito.',
      })
    }
    return
  }
  if (change.remark !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['remark'],
      message: 'Remark nao permitido para este campo/conteudo.',
    })
  }
})

export const createWintourSaleAdjustmentInputSchema = z.object({
  saleLinkId: uuidSchema,
  expectedVersion: versionSchema,
  reason: safeTextSchema,
  recalculateCalculatedFields: z.boolean().default(false),
  changes: z.array(wintourSaleAdjustmentChangeSchema).min(1).max(47),
}).strict().superRefine((input, context) => {
  const fields = input.changes.map((change) => change.field)
  if (new Set(fields).size !== fields.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['changes'],
      message: 'Cada campo pode aparecer uma unica vez por ajuste.',
    })
  }
  if (fields.includes('id_pa') && fields.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['changes'],
      message: 'id_pa deve ser a unica alteracao da venda.',
    })
  }
})

export const claimWintourSyncJobsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  leaseSeconds: z.number().int().min(30).max(900).default(180),
}).strict()

export const claimWintourPollJobsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  leaseSeconds: z.number().int().min(30).max(900).default(180),
}).strict()

export const recordWintourPollResultInputSchema = z.object({
  jobId: uuidSchema,
  attemptId: uuidSchema,
  pollLeaseToken: uuidSchema,
  expectedJobVersion: versionSchema,
  state: z.enum(['received', 'processing', 'manual_review', 'completed', 'rejected', 'failed']),
  protocolCode: z.string().trim().min(1).max(240),
  wintourSaleNumber: z.string().regex(/^[1-9][0-9]{0,9}$/).optional(),
  responseFingerprint: fingerprintSchema.optional(),
  redactedPayload: z.record(z.string(), z.unknown()).default({}),
  nextPollSeconds: z.number().int().min(30).max(86_400).default(300),
}).strict()

export const recordWintourSyncAttemptResultInputSchema = z.object({
  jobId: uuidSchema,
  attemptId: uuidSchema,
  leaseToken: uuidSchema,
  expectedJobVersion: versionSchema,
  expectedAttemptVersion: versionSchema,
  state: z.enum(['ambiguous', 'manual_review', 'failed']),
  responseFingerprint: fingerprintSchema.optional(),
  errorCode: z.string().trim().min(1).max(120).optional(),
  errorMessage: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((input, context) => {
  if (input.state === 'failed' && !input.errorCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'Falha exige codigo.' })
  }
})

export const recordWintourSubmissionSuccessInputSchema = z.object({
  jobId: uuidSchema,
  attemptId: uuidSchema,
  leaseToken: uuidSchema,
  expectedJobVersion: versionSchema,
  expectedAttemptVersion: versionSchema,
  protocolCode: z.string().trim().min(1).max(240),
  responseFingerprint: fingerprintSchema.optional(),
  redactedPayload: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const recordWintourSyncProtocolInputSchema = z.object({
  jobId: uuidSchema,
  attemptId: uuidSchema,
  expectedJobVersion: versionSchema,
  protocolKind: z.literal('manual'),
  protocolCode: z.string().trim().min(1).max(240),
  state: z.enum(['received', 'processing', 'manual_review', 'completed', 'rejected', 'failed', 'cancelled']),
  responseFingerprint: fingerprintSchema.optional(),
  redactedPayload: z.record(z.string(), z.unknown()).default({}),
}).strict()

export type WintourSyncState = z.infer<typeof wintourSyncStateSchema>
export type WintourSyncOperation = z.infer<typeof wintourSyncOperationSchema>
export type WintourAdjustmentField = z.infer<typeof wintourAdjustmentFieldSchema>
export type WintourSyncSettingsInput = z.infer<typeof wintourSyncSettingsInputSchema>
export type WintourSyncDashboardFilters = z.input<typeof wintourSyncDashboardFiltersSchema>
export type DiscoverWintourSyncSalesInput = z.infer<typeof discoverWintourSyncSalesInputSchema>
export type PrepareWintourSyncJobInput = z.infer<typeof prepareWintourSyncJobInputSchema>
export type RetryWintourSyncJobInput = z.infer<typeof retryWintourSyncJobInputSchema>
export type ReconcileWintourSyncJobInput = z.infer<typeof reconcileWintourSyncJobInputSchema>
export type RecoverStaleWintourSyncJobsInput = z.input<typeof recoverStaleWintourSyncJobsInputSchema>
export type PrepareReadyWintourSyncJobsInput = z.input<typeof prepareReadyWintourSyncJobsInputSchema>
export type BindWintourSaleNumberInput = z.infer<typeof bindWintourSaleNumberInputSchema>
export type CreateWintourSaleAdjustmentInput = z.input<typeof createWintourSaleAdjustmentInputSchema>
export type ClaimWintourSyncJobsInput = z.input<typeof claimWintourSyncJobsInputSchema>
export type ClaimWintourPollJobsInput = z.input<typeof claimWintourPollJobsInputSchema>
export type RecordWintourPollResultInput = z.input<typeof recordWintourPollResultInputSchema>
export type RecordWintourSyncAttemptResultInput = z.infer<typeof recordWintourSyncAttemptResultInputSchema>
export type RecordWintourSubmissionSuccessInput = z.input<typeof recordWintourSubmissionSuccessInputSchema>
export type RecordWintourSyncProtocolInput = z.input<typeof recordWintourSyncProtocolInputSchema>

export interface WintourSyncSettings {
  enabled: boolean
  syncFrom: string
  agencyName: string
  branchId: number | null
  branchName: string | null
  freeField: string | null
  productCodes: z.infer<typeof wintourProductCodesSchema>
  paymentMethodCodes: z.infer<typeof wintourPaymentMethodCodesSchema>
  serviceRouteTypes: z.infer<typeof wintourServiceRouteTypesSchema>
  tariffNetDefault: 0 | 1 | null
  accountDefaults: z.infer<typeof wintourAccountDefaultsSchema>
  customerAction: 'none' | 'I' | 'U' | 'IU'
  autoSend: boolean
  autoPoll: boolean
  companyMappings: Array<{ companyId: string; wintourAccountCode: string }>
  maxAttempts: number
  discoveryBatchSize: number
  version: number
  updatedAt: string
}

export interface WintourSaleLinkSummary {
  id: string
  companyId: string
  emissionId: string
  sourceItemKey: string
  sourceTicketId: string | null
  idvExterno: string
  wintourSaleNumber: string | null
  state: WintourSyncState
  blockedReasons: string[]
  version: number
  updatedAt: string
}

export interface WintourSyncJobSummary {
  id: string
  saleLinkId: string
  operation: WintourSyncOperation
  state: WintourSyncState
  attemptCount: number
  maxAttempts: number
  lastErrorCode: string | null
  latestProtocolCode: string | null
  latestProtocolKind: 'submission' | 'poll' | 'manual' | null
  downloadAvailable: boolean
  version: number
  preparedAt: string
  updatedAt: string
}

export interface WintourSyncDashboard {
  settings: WintourSyncSettings | null
  countsByState: Partial<Record<WintourSyncState, number>>
  saleLinks: WintourSaleLinkSummary[]
  jobs: WintourSyncJobSummary[]
  availableCompanies: Array<{ id: string; name: string; customerCode: string | null }>
  capabilities: {
    prepare: boolean
    send: boolean
    poll: boolean
    reconcile: boolean
    download: boolean
  }
}

export interface WintourDiscoveryResult {
  scanned: number
  created: number
  refreshed: number
  ready: number
  blocked: number
}

export interface WintourPrepareReadyResult {
  scanned: number
  prepared: number
  replayed: number
  blocked: number
}

export interface ClaimedWintourSyncJob {
  id: string
  saleLinkId: string
  companyId: string
  emissionId: string
  operation: WintourSyncOperation
  idvExterno: string
  wintourSaleNumber: string | null
  payloadBytes: Uint8Array
  payloadSha256: string
  payloadFilename: string
  payloadContentType: 'application/xml'
  serializerVersion: string
  freeField: string | null
  attemptId: string
  attemptNumber: number
  leaseToken: string
  leaseExpiresAt: string
  jobVersion: number
  attemptVersion: number
}

export interface WintourWorkerTarget {
  tenantId: string
  enabled: true
  autoSend: boolean
  autoPoll: boolean
  updatedBy: string | null
}

export interface ClaimedWintourPollJob {
  id: string
  saleLinkId: string
  operation: WintourSyncOperation
  attemptId: string
  protocolCode: string
  pollLeaseToken: string
  pollLeaseExpiresAt: string
  jobVersion: number
}

export interface WintourSyncJobArtifact {
  jobId: string
  operation: WintourSyncOperation
  filename: string
  contentType: 'application/xml'
  bytes: Uint8Array
  sha256: string
  serializerVersion: string
}
