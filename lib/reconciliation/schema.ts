import { z } from 'zod'

export const reconciliationSeveritySchema = z.enum([
  'critico',
  'alto',
  'medio',
  'baixo',
  'info',
])

export const reconciliationAlertTypeSchema = z.enum([
  'venda_duplicada',
  'valor_divergente',
  'data_invalida',
  'passageiro_sem_funcionario',
  'empresa_sem_codigo',
  'demanda_sem_emissao',
  'emissao_sem_demanda',
  'funcionario_sem_cpf',
  'voucher_sem_demanda',
  'agente_sobrecarregado',
  'demanda_atrasada',
  'valor_zerado',
])

export const reconciliationAlertStatusSchema = z.enum([
  'open',
  'resolved',
  'ignored',
  'auto_resolved',
])

export const reconciliationEntitySchema = z.object({
  tipo: z.string().trim().min(1).max(160),
  id: z.string().trim().min(1).max(240),
  nome: z.string().trim().min(1).max(500).optional(),
}).strict()

export const reconciliationListQuerySchema = z.object({
  companyId: z.string().trim().min(1).max(240).optional(),
  severity: reconciliationSeveritySchema.optional(),
  type: reconciliationAlertTypeSchema.optional(),
  status: reconciliationAlertStatusSchema.default('open'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict()

export const reconciliationRunSchema = z.object({
  companyId: z.string().trim().min(1).max(240).optional(),
}).strict()

export const reconciliationAlertIdSchema = z.string().uuid()

export const reconciliationResolutionSchema = z.object({
  resolutionKind: z.enum(['manual', 'ignored', 'employee_linked', 'source_corrected']),
  note: z.string().trim().min(3).max(2000),
  employeeId: z.string().trim().min(1).max(240).optional(),
  expectedVersion: z.coerce.number().int().positive(),
  confirmed: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.resolutionKind === 'employee_linked' && !value.employeeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['employeeId'],
      message: 'O funcionário vinculado é obrigatório.',
    })
  }
  if (value.resolutionKind !== 'employee_linked' && value.employeeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['employeeId'],
      message: 'O funcionário só pode ser informado em uma resolução por vínculo.',
    })
  }
})

export type ReconciliationSeverity = z.infer<typeof reconciliationSeveritySchema>
export type ReconciliationAlertType = z.infer<typeof reconciliationAlertTypeSchema>
export type ReconciliationAlertStatus = z.infer<typeof reconciliationAlertStatusSchema>
export type ReconciliationListQuery = z.infer<typeof reconciliationListQuerySchema>

export interface RelationalReconciliationAlert {
  id: string
  companyId: string
  alertKey: string
  type: ReconciliationAlertType
  severity: ReconciliationSeverity
  title: string
  description: string
  entities: Array<{ tipo: string; id: string; nome?: string }>
  suggestedAction: string | null
  status: ReconciliationAlertStatus
  occurrenceCount: number
  firstDetectedAt: string
  lastDetectedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionKind: string | null
  resolutionNote: string | null
  version: number
}

export interface ReconciliationCounts {
  critico: number
  alto: number
  medio: number
  baixo: number
  info: number
}

export interface ReconciliationRunSummary {
  id: string
  scannedDemands: number
  scannedEmployees: number
  detectedAlerts: number
  activeAlerts: number
  autoResolvedAlerts: number
  counts: ReconciliationCounts
  startedAt: string
  completedAt: string
}
