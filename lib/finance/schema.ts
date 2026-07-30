import { z } from 'zod'

import type {
  FormaPagamento,
  LancamentoFinanceiro,
  StatusLancamento,
  TipoLancamento,
} from '@/lib/financeiro'

const optionalText = (max: number) => z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || undefined
  },
  z.string().max(max).optional(),
)

const optionalIdentifier = z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || undefined
  },
  z.string().max(160).optional(),
)

const moneySchema = z.coerce.number().finite().min(0).max(999_999_999_999.99)
const isoDateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)

export const financialEntryIdentifierSchema = z.string().trim().min(1).max(160)
export const financialEntryTypeSchema = z.enum(['pagar', 'receber'])
export const financialEntryStatusSchema = z.enum([
  'pendente',
  'pago',
  'parcial',
  'cancelado',
  'atrasado',
])
export const financialPaymentMethodSchema = z.enum([
  'PIX',
  'Boleto',
  'TED',
  'Cartão',
  'Dinheiro',
  'Faturamento',
  'Outro',
])

const financialEntryObjectSchema = z.object({
  id: financialEntryIdentifierSchema,
  tipo: financialEntryTypeSchema,
  atendimento_id: optionalIdentifier,
  empresa_id: z.string().trim().min(1).max(160),
  fornecedor_nome: optionalText(300),
  valor: moneySchema,
  valor_pago: moneySchema,
  data_emissao: isoDateOnlySchema,
  data_vencimento: isoDateOnlySchema,
  data_pagamento: isoDateOnlySchema.optional(),
  descricao: z.string().trim().min(1).max(1_000),
  categoria: optionalText(160),
  forma_pagamento: financialPaymentMethodSchema.optional(),
  status: financialEntryStatusSchema,
  observacoes: optionalText(8_000),
  numero_documento: optionalText(240),
  created_at: z.string().trim().min(8).max(64),
  updated_at: optionalText(64),
  created_by: optionalIdentifier,
  version: z.coerce.number().int().positive().optional(),
}).strict()

function validateSettledAmount(
  entry: { valor: number; valor_pago: number },
  context: z.RefinementCtx,
) {
  if (entry.valor_pago > entry.valor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valor_pago'],
      message: 'O valor liquidado nao pode superar o valor do lancamento.',
    })
  }
}

export const financialEntrySchema = financialEntryObjectSchema.superRefine(
  validateSettledAmount,
)

export const financialEntryCreateSchema = financialEntryObjectSchema.omit({
  id: true,
  status: true,
  valor_pago: true,
  created_at: true,
  updated_at: true,
  created_by: true,
  version: true,
}).strict()

export const financialEntryPatchSchema = financialEntryObjectSchema.omit({
  id: true,
  empresa_id: true,
  atendimento_id: true,
  created_at: true,
  updated_at: true,
  created_by: true,
  version: true,
}).partial().strict()

export const financialEntrySettlementSchema = z.object({
  valor: moneySchema.refine((value) => value > 0, 'Informe um valor maior que zero.'),
  data_pagamento: isoDateOnlySchema,
  forma_pagamento: financialPaymentMethodSchema,
  expectedVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export const financialDemandSyncSchema = z.object({
  demandIds: z.array(z.string().trim().min(1).max(160)).min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export function financialTypeToDatabase(type: TipoLancamento): 'payable' | 'receivable' {
  return type === 'pagar' ? 'payable' : 'receivable'
}

export function financialTypeFromDatabase(type: string): TipoLancamento {
  return type === 'payable' ? 'pagar' : 'receber'
}

export function financialStatusToDatabase(status: StatusLancamento): string {
  if (status === 'pago') return 'paid'
  if (status === 'parcial') return 'partial'
  if (status === 'cancelado') return 'cancelled'
  if (status === 'atrasado') return 'overdue'
  return 'pending'
}

export function financialStatusFromDatabase(status: string): StatusLancamento {
  if (status === 'paid') return 'pago'
  if (status === 'partial') return 'parcial'
  if (status === 'cancelled') return 'cancelado'
  if (status === 'overdue') return 'atrasado'
  return 'pendente'
}

export function normalizeLegacyFinancialEntry(value: unknown): LancamentoFinanceiro | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = financialEntrySchema.safeParse(
    Object.fromEntries(
      Object.keys(financialEntryObjectSchema.shape).map((key) => [key, record[key]]),
    ),
  )
  return parsed.success ? parsed.data as LancamentoFinanceiro : null
}

export function recalculateFinancialStatus(
  entry: Pick<LancamentoFinanceiro, 'status' | 'valor' | 'valor_pago' | 'data_vencimento'>,
  today: string,
): StatusLancamento {
  if (entry.status === 'cancelado') return 'cancelado'
  if (entry.valor_pago >= entry.valor - 0.01) return 'pago'
  if (entry.valor_pago > 0) return 'parcial'
  if (entry.data_vencimento < today) return 'atrasado'
  return 'pendente'
}

export type FinancialEntryCreatePayload = z.infer<typeof financialEntryCreateSchema>
export type FinancialEntryPatchPayload = z.infer<typeof financialEntryPatchSchema>
export type FinancialPaymentMethod = FormaPagamento
