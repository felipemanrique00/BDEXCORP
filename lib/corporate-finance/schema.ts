import { z } from 'zod'

import type {
  CarteiraCorporativa,
  CartaoCorporativo,
  FaturaCorporativa,
  MovimentoCarteiraCorporativa,
} from '@/types'

const id = z.string().trim().min(1).max(160)
const optionalId = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  id.optional(),
) as z.ZodType<string | undefined, z.ZodTypeDef, unknown>
const optionalText = (max: number): z.ZodType<string | undefined, z.ZodTypeDef, unknown> => (
  z.preprocess(
    (value) => String(value ?? '').trim() || undefined,
    z.string().max(max).optional(),
  ) as z.ZodType<string | undefined, z.ZodTypeDef, unknown>
)
const nonNegativeMoney = z.coerce.number().finite().min(0).max(999_999_999_999.99)
const positiveMoney = z.coerce.number().finite().positive().max(999_999_999_999.99)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoTimestamp = z.string().datetime({ offset: true })

export const walletStatusSchema = z.enum(['ativa', 'bloqueada', 'pendente_configuracao'])
export const walletProviderSchema = z.enum([
  'pendente',
  'stripe_issuing',
  'dock',
  'pismo',
  'efi_bank',
  'outro',
])
export const cardTypeSchema = z.enum(['fisico', 'virtual'])
export const cardStatusSchema = z.enum(['ativo', 'bloqueado', 'cancelado', 'pendente_emissao'])
export const cardBrandSchema = z.enum(['Visa', 'Mastercard', 'Elo', 'Outra'])
export const walletMovementTypeSchema = z.enum(['credito', 'debito', 'estorno', 'ajuste'])
export const walletMovementSourceSchema = z.enum(['pix', 'cartao', 'fatura', 'manual', 'integracao'])
export const walletMovementStatusSchema = z.enum(['pendente', 'processado', 'falhou', 'cancelado'])
export const corporateInvoiceStatusSchema = z.enum(['aberta', 'fechada', 'paga', 'vencida', 'cancelada'])

export const corporateWalletSchema = z.object({
  id,
  company_id: id,
  saldo_disponivel: z.coerce.number().finite().min(-999_999_999_999.99).max(999_999_999_999.99),
  limite_credito: nonNegativeMoney,
  limite_pix_diario: nonNegativeMoney,
  limite_cartao_mensal: nonNegativeMoney,
  status: walletStatusSchema,
  pix_habilitado: z.boolean(),
  cartao_habilitado: z.boolean(),
  provedor: walletProviderSchema.optional(),
  conta_virtual: optionalText(240),
  observacoes: optionalText(4_000),
  created_at: isoTimestamp,
  updated_at: isoTimestamp.optional(),
  version: z.coerce.number().int().positive().optional(),
}).strict().superRefine((wallet, context) => {
  if (wallet.saldo_disponivel + wallet.limite_credito < 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['saldo_disponivel'],
      message: 'Saldo nao pode exceder o limite de credito.',
    })
  }
})

export const corporateCardSchema = z.object({
  id,
  carteira_id: id,
  company_id: id,
  tipo: cardTypeSchema,
  apelido: z.string().trim().min(1).max(160),
  portador_nome: optionalText(240),
  funcionario_id: z.preprocess(
    (value) => String(value ?? '').trim() || null,
    id.nullable(),
  ),
  ultimos4: z.string().regex(/^\d{4}$/),
  bandeira: cardBrandSchema,
  limite: nonNegativeMoney,
  gasto_mes: nonNegativeMoney,
  status: cardStatusSchema,
  merchant_lock: optionalText(500),
  validade_mes: z.coerce.number().int().min(1).max(12).optional(),
  validade_ano: z.coerce.number().int().min(2000).max(9999).optional(),
  criado_por_user_id: optionalId,
  created_at: isoTimestamp,
  updated_at: isoTimestamp.optional(),
  version: z.coerce.number().int().positive().optional(),
}).strict().superRefine((card, context) => {
  if ((card.validade_mes === undefined) !== (card.validade_ano === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validade_mes'],
      message: 'Mes e ano de validade devem ser informados juntos.',
    })
  }
})

export const corporateWalletMovementSchema = z.object({
  id,
  carteira_id: id,
  company_id: id,
  tipo: walletMovementTypeSchema,
  origem: walletMovementSourceSchema,
  valor: positiveMoney,
  descricao: z.string().trim().min(2).max(2_000),
  status: walletMovementStatusSchema,
  atendimento_id: optionalId,
  lancamento_id: optionalId,
  cartao_id: optionalId,
  created_at: isoTimestamp,
  processado_em: isoTimestamp.optional(),
}).strict()

export const corporateInvoiceSchema = z.object({
  id,
  company_id: id,
  numero: z.string().trim().min(1).max(160),
  periodo_inicio: isoDate,
  periodo_fim: isoDate,
  vencimento: isoDate,
  valor_total: nonNegativeMoney,
  valor_pago: nonNegativeMoney,
  status: corporateInvoiceStatusSchema,
  lancamento_ids: z.array(id).max(20_000),
  atendimento_ids: z.array(id).max(20_000),
  observacoes: optionalText(8_000),
  created_at: isoTimestamp,
  updated_at: isoTimestamp.optional(),
  version: z.coerce.number().int().positive().optional(),
}).strict().superRefine((invoice, context) => {
  if (invoice.periodo_fim < invoice.periodo_inicio) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periodo_fim'],
      message: 'Fim do periodo anterior ao inicio.',
    })
  }
  if (invoice.vencimento < invoice.periodo_fim) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vencimento'],
      message: 'Vencimento anterior ao fim do periodo.',
    })
  }
  if (invoice.valor_pago > invoice.valor_total) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valor_pago'],
      message: 'Valor pago excede o total da fatura.',
    })
  }
})

export const corporateFinanceStateSchema = z.object({
  carteiras: z.array(corporateWalletSchema),
  cartoes: z.array(corporateCardSchema),
  movimentos: z.array(corporateWalletMovementSchema),
  faturas: z.array(corporateInvoiceSchema),
}).strict()

export const corporateWalletConfigSchema = z.object({
  company_id: id,
  status: walletStatusSchema.default('ativa'),
  limite_credito: nonNegativeMoney.default(0),
  limite_pix_diario: nonNegativeMoney.default(0),
  limite_cartao_mensal: nonNegativeMoney.default(0),
  pix_habilitado: z.boolean().default(false),
  cartao_habilitado: z.boolean().default(false),
  provedor: walletProviderSchema.default('pendente'),
  conta_virtual: optionalText(240),
  observacoes: optionalText(4_000),
  expectedVersion: z.coerce.number().int().positive().optional(),
}).strict()

export const corporateCardCreateSchema = z.object({
  company_id: id,
  tipo: cardTypeSchema,
  apelido: z.string().trim().min(1).max(160),
  portador_nome: optionalText(240),
  funcionario_id: z.preprocess(
    (value) => String(value ?? '').trim() || null,
    id.nullable().default(null),
  ),
  ultimos4: z.preprocess(
    (value) => String(value ?? '').replace(/\D/g, ''),
    z.string().regex(/^\d{4}$/),
  ),
  bandeira: cardBrandSchema,
  limite: nonNegativeMoney,
  merchant_lock: optionalText(500),
  validade_mes: z.coerce.number().int().min(1).max(12).optional(),
  validade_ano: z.coerce.number().int().min(2000).max(9999).optional(),
}).strict().superRefine((card, context) => {
  if ((card.validade_mes === undefined) !== (card.validade_ano === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validade_mes'],
      message: 'Mes e ano de validade devem ser informados juntos.',
    })
  }
})

export const corporateWalletMovementCreateSchema = z.object({
  company_id: id,
  tipo: walletMovementTypeSchema,
  origem: walletMovementSourceSchema.default('manual'),
  valor: positiveMoney,
  descricao: z.string().trim().min(2).max(2_000),
  atendimento_id: optionalId,
  lancamento_id: optionalId,
  cartao_id: optionalId,
  external_reference: optionalText(240),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict().superRefine((movement, context) => {
  if (movement.origem !== 'manual' && !movement.external_reference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['external_reference'],
      message: 'Movimentos externos exigem referencia confirmada pelo provedor.',
    })
  }
})

export const corporateInvoiceGenerateSchema = z.object({
  company_id: id,
  periodo_inicio: isoDate,
  periodo_fim: isoDate,
  vencimento: isoDate,
  observacoes: optionalText(8_000),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict().superRefine((invoice, context) => {
  if (invoice.periodo_fim < invoice.periodo_inicio) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periodo_fim'],
      message: 'Fim do periodo anterior ao inicio.',
    })
  }
  if (invoice.vencimento < invoice.periodo_fim) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vencimento'],
      message: 'Vencimento anterior ao fim do periodo.',
    })
  }
})

export const corporateInvoiceSettleSchema = z.object({
  valor_pago: positiveMoney.optional(),
  expectedVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict()

export type CorporateWalletConfigPayload = z.infer<typeof corporateWalletConfigSchema>
export type CorporateCardCreatePayload = z.infer<typeof corporateCardCreateSchema>
export type CorporateWalletMovementCreatePayload = z.infer<typeof corporateWalletMovementCreateSchema>
export type CorporateInvoiceGeneratePayload = z.infer<typeof corporateInvoiceGenerateSchema>
export type CorporateInvoiceSettlePayload = z.infer<typeof corporateInvoiceSettleSchema>

export function normalizeLegacyCorporateFinanceState(value: unknown): {
  carteiras: CarteiraCorporativa[]
  cartoes: CartaoCorporativo[]
  movimentos: MovimentoCarteiraCorporativa[]
  faturas: FaturaCorporativa[]
  unresolved: {
    carteiras: unknown[]
    cartoes: unknown[]
    movimentos: unknown[]
    faturas: unknown[]
  }
} {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const unresolved = {
    carteiras: [] as unknown[],
    cartoes: [] as unknown[],
    movimentos: [] as unknown[],
    faturas: [] as unknown[],
  }
  const parseList = <T>(
    source: unknown,
    schema: z.ZodTypeAny,
    rejected: unknown[],
  ): T[] => {
    if (!Array.isArray(source)) return []
    return source.flatMap((item) => {
      const parsed = schema.safeParse(item)
      if (!parsed.success) {
        rejected.push(item)
        return []
      }
      return [parsed.data as T]
    })
  }
  return {
    carteiras: parseList<CarteiraCorporativa>(
      record.carteiras,
      corporateWalletSchema,
      unresolved.carteiras,
    ),
    cartoes: parseList<CartaoCorporativo>(
      record.cartoes,
      corporateCardSchema,
      unresolved.cartoes,
    ),
    movimentos: parseList<MovimentoCarteiraCorporativa>(
      record.movimentos,
      corporateWalletMovementSchema,
      unresolved.movimentos,
    ),
    faturas: parseList<FaturaCorporativa>(
      record.faturas,
      corporateInvoiceSchema,
      unresolved.faturas,
    ),
    unresolved,
  }
}

export function walletStatusToDatabase(value: CarteiraCorporativa['status']): string {
  if (value === 'ativa') return 'active'
  if (value === 'bloqueada') return 'blocked'
  return 'pending_configuration'
}

export function walletStatusFromDatabase(value: string): CarteiraCorporativa['status'] {
  if (value === 'active') return 'ativa'
  if (value === 'blocked') return 'bloqueada'
  return 'pendente_configuracao'
}

export function walletProviderToDatabase(value?: CarteiraCorporativa['provedor']): string {
  if (value === 'outro') return 'other'
  return value || 'pending'
}

export function walletProviderFromDatabase(value: string): CarteiraCorporativa['provedor'] {
  return value === 'other' ? 'outro' : value as CarteiraCorporativa['provedor']
}

export function cardTypeToDatabase(value: CartaoCorporativo['tipo']): string {
  return value === 'fisico' ? 'physical' : 'virtual'
}

export function cardTypeFromDatabase(value: string): CartaoCorporativo['tipo'] {
  return value === 'physical' ? 'fisico' : 'virtual'
}

export function cardStatusToDatabase(value: CartaoCorporativo['status']): string {
  if (value === 'ativo') return 'active'
  if (value === 'bloqueado') return 'blocked'
  if (value === 'cancelado') return 'cancelled'
  return 'pending_issuance'
}

export function cardStatusFromDatabase(value: string): CartaoCorporativo['status'] {
  if (value === 'active') return 'ativo'
  if (value === 'blocked') return 'bloqueado'
  if (value === 'cancelled') return 'cancelado'
  return 'pendente_emissao'
}

export function cardBrandToDatabase(value: NonNullable<CartaoCorporativo['bandeira']>): string {
  return value === 'Outra' ? 'Other' : value
}

export function cardBrandFromDatabase(value: string): NonNullable<CartaoCorporativo['bandeira']> {
  return value === 'Other' ? 'Outra' : value as NonNullable<CartaoCorporativo['bandeira']>
}

export function movementTypeToDatabase(value: MovimentoCarteiraCorporativa['tipo']): string {
  if (value === 'credito') return 'credit'
  if (value === 'debito') return 'debit'
  if (value === 'estorno') return 'refund'
  return 'adjustment'
}

export function movementTypeFromDatabase(value: string): MovimentoCarteiraCorporativa['tipo'] {
  if (value === 'credit') return 'credito'
  if (value === 'debit') return 'debito'
  if (value === 'refund') return 'estorno'
  return 'ajuste'
}

export function movementSourceToDatabase(value: MovimentoCarteiraCorporativa['origem']): string {
  if (value === 'cartao') return 'card'
  if (value === 'fatura') return 'invoice'
  if (value === 'integracao') return 'integration'
  return value
}

export function movementSourceFromDatabase(value: string): MovimentoCarteiraCorporativa['origem'] {
  if (value === 'card') return 'cartao'
  if (value === 'invoice') return 'fatura'
  if (value === 'integration') return 'integracao'
  return value as MovimentoCarteiraCorporativa['origem']
}

export function movementStatusFromDatabase(value: string): MovimentoCarteiraCorporativa['status'] {
  if (value === 'processed') return 'processado'
  if (value === 'failed') return 'falhou'
  if (value === 'cancelled') return 'cancelado'
  return 'pendente'
}

export function invoiceStatusFromDatabase(value: string): FaturaCorporativa['status'] {
  if (value === 'closed') return 'fechada'
  if (value === 'paid') return 'paga'
  if (value === 'overdue') return 'vencida'
  if (value === 'cancelled') return 'cancelada'
  return 'aberta'
}

export function invoiceStatusToDatabase(value: FaturaCorporativa['status']): string {
  if (value === 'fechada') return 'closed'
  if (value === 'paga') return 'paid'
  if (value === 'vencida') return 'overdue'
  if (value === 'cancelada') return 'cancelled'
  return 'open'
}
