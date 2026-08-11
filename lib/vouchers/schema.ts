import { z } from 'zod'

import type { VoucherEmitido, VoucherStatus } from '@/types'

const optionalText = (max: number) => z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || undefined
  },
  z.string().max(max).optional(),
)

const nullableIdentifier = z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || null
  },
  z.string().max(160).nullable(),
)

const optionalNonNegativeNumber = z.preprocess(
  (value) => value === '' || value === null || value === undefined ? undefined : value,
  z.coerce.number().finite().min(0).max(999_999_999_999.99).optional(),
)

const optionalPositiveInteger = z.preprocess(
  (value) => value === '' || value === null || value === undefined ? undefined : value,
  z.coerce.number().int().min(0).max(1_000_000).optional(),
)

const voucherGuestSchema = z.object({
  nome: z.string().trim().min(1).max(300),
  papel: optionalText(80),
  principal: z.boolean().optional(),
  codigo: optionalText(120),
  documento: optionalText(80),
  email: z.preprocess(
    (value) => String(value ?? '').trim().toLowerCase() || undefined,
    z.string().email().max(320).optional(),
  ),
  telefone: optionalText(80),
  quarto: optionalPositiveInteger,
}).strict()

const voucherRoomSchema = z.object({
  numero: z.coerce.number().int().positive().max(99),
  acomodacao: optionalText(160),
  categoria: optionalText(160),
  regime: optionalText(200),
  hospedes: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
}).strict()

const voucherAirSegmentSchema = z.object({
  sequencia: z.coerce.number().int().positive().max(100),
  companhia_codigo: z.string().trim().min(1).max(10),
  companhia_nome: z.string().trim().min(1).max(200),
  numero_voo: z.string().trim().min(1).max(80),
  classe_reserva: z.string().trim().min(1).max(40),
  cabine: z.string().trim().min(1).max(80),
  bagagens: z.coerce.number().int().min(0).max(20),
  origem_codigo: z.string().trim().min(1).max(10),
  origem_nome: optionalText(300),
  destino_codigo: z.string().trim().min(1).max(10),
  destino_nome: optionalText(300),
  saida_em: z.string().trim().min(1).max(64),
  chegada_em: z.string().trim().min(1).max(64),
}).strict()

const voucherAirTicketSchema = z.object({
  passageiro_nome: z.string().trim().min(1).max(300),
  passageiro_ordem: z.coerce.number().int().positive().max(100).optional(),
  passageiro_codigo: optionalText(120),
  numero_bilhete: z.string().trim().min(1).max(160),
  companhia_codigo: z.string().trim().min(1).max(10),
  companhia_nome: z.string().trim().min(1).max(200),
}).strict()

export const voucherIdentifierSchema = z.string().trim().min(1).max(160)
export const voucherTypeSchema = z.enum([
  'Hotel',
  'Aéreo',
  'Carro',
  'Pacote',
  'Rodoviário',
  'Ferroviário',
  'Transfer',
  'Seguro',
  'Lazer',
  'Marítimo',
  'Serviço',
])
export const voucherStatusSchema = z.enum(['rascunho', 'emitido', 'confirmado', 'cancelado'])

export const voucherSchema = z.object({
  id: voucherIdentifierSchema,
  numero: z.string().trim().min(1).max(80),
  tipo: voucherTypeSchema,
  status: voucherStatusSchema,
  atendimento_id: optionalText(160),
  empresa_id: z.string().trim().min(1).max(160),
  funcionario_id: nullableIdentifier.default(null),
  passageiro_nome: z.string().trim().min(2).max(300),
  passageiros: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  cpf: optionalText(40),
  hospedes_detalhes: z.array(voucherGuestSchema).max(100).optional(),
  empresa_nome: optionalText(300),
  empresa_documento: optionalText(80),
  unidade_negocio: optionalText(160),
  departamento: optionalText(160),
  solicitante_nome: optionalText(300),
  solicitante_email: z.preprocess(
    (value) => String(value ?? '').trim().toLowerCase() || undefined,
    z.string().email().max(320).optional(),
  ),
  autorizadores: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  autorizado_em: optionalText(64),
  data_solicitacao: optionalText(64),
  reserva_id: optionalText(160),
  data_reserva: optionalText(64),
  fornecedor_nome: z.string().trim().min(1).max(300),
  fornecedor_codigo: optionalText(160),
  fornecedor_endereco: optionalText(500),
  fornecedor_cidade: optionalText(200),
  fornecedor_telefone: optionalText(80),
  fornecedor_email: z.preprocess(
    (value) => String(value ?? '').trim().toLowerCase() || undefined,
    z.string().email().max(320).optional(),
  ),
  canal_reserva: optionalText(80),
  hotel_nome: optionalText(300),
  hotel_endereco: optionalText(500),
  hotel_cidade: optionalText(200),
  hotel_telefone: optionalText(80),
  hotel_email: z.preprocess(
    (value) => String(value ?? '').trim().toLowerCase() || undefined,
    z.string().email().max(320).optional(),
  ),
  hotel_categoria: optionalText(120),
  tipo_apartamento: optionalText(120),
  quartos: z.array(voucherRoomSchema).max(99).optional(),
  num_apartamentos: optionalPositiveInteger,
  num_hospedes: optionalPositiveInteger,
  data_checkin: optionalText(64),
  data_checkout: optionalText(64),
  checkin_em: optionalText(64),
  checkout_em: optionalText(64),
  noites: optionalPositiveInteger,
  regime: optionalText(200),
  forma_pagamento_voucher: optionalText(300),
  referencia_pagamento: optionalText(200),
  condicoes_pagamento: optionalText(1_000),
  prazo_cancelamento: optionalText(64),
  politica_cancelamento: optionalText(4_000),
  politica_no_show: optionalText(4_000),
  reembolsavel: z.boolean().optional(),
  cia_aerea: optionalText(200),
  numero_voo: optionalText(120),
  origem: optionalText(200),
  destino: optionalText(200),
  data_ida: optionalText(64),
  data_volta: optionalText(64),
  classe: optionalText(120),
  localizador: optionalText(160),
  sistema_reserva: optionalText(120),
  prazo_emissao: optionalText(64),
  tarifa_referencia: optionalNonNegativeNumber,
  rav: optionalNonNegativeNumber,
  rac: optionalNonNegativeNumber,
  cambio: optionalNonNegativeNumber,
  milhagem: optionalNonNegativeNumber,
  trechos_aereos: z.array(voucherAirSegmentSchema).max(100).optional(),
  bilhetes_aereos: z.array(voucherAirTicketSchema).max(100).optional(),
  locadora: optionalText(200),
  categoria_carro: optionalText(160),
  retirada_local: optionalText(300),
  retirada_data: optionalText(64),
  devolucao_local: optionalText(300),
  devolucao_data: optionalText(64),
  numero_confirmacao: optionalText(160),
  data_confirmacao: optionalText(64),
  confirmado_por: optionalText(200),
  valor_diaria: optionalNonNegativeNumber,
  taxas_diaria: optionalNonNegativeNumber,
  taxa_servico: optionalNonNegativeNumber,
  tarifa_total: optionalNonNegativeNumber,
  taxas: optionalNonNegativeNumber,
  total: z.coerce.number().finite().min(0).max(999_999_999_999.99),
  moeda: z.preprocess(
    (value) => String(value ?? '').trim().toUpperCase() || undefined,
    z.string().regex(/^[A-Z]{3}$/).optional(),
  ),
  centro_custo: optionalText(160),
  numero_solicitacao: optionalText(160),
  observacoes: optionalText(8_000),
  observacoes_internas: optionalText(8_000),
  origem_voucher: z.enum(['criado', 'importado', 'pdf', 'ia']).optional(),
  arquivo_original_nome: optionalText(500),
  importado_em: optionalText(64),
  fingerprint: optionalText(500),
  emitido_por_user_id: optionalText(160).default(''),
  emitido_por_user_name: optionalText(200).default(''),
  created_at: optionalText(64).default(''),
  updated_at: optionalText(64),
  version: z.coerce.number().int().positive().optional(),
}).strict()

export const voucherCreateSchema = voucherSchema.omit({
  id: true,
  numero: true,
  created_at: true,
  updated_at: true,
  version: true,
  emitido_por_user_id: true,
  emitido_por_user_name: true,
})

export const voucherPatchSchema = voucherSchema.omit({
  id: true,
  empresa_id: true,
  numero: true,
  created_at: true,
  updated_at: true,
  version: true,
  emitido_por_user_id: true,
  emitido_por_user_name: true,
}).partial().strict()

export const voucherBatchSchema = z.object({
  vouchers: z.array(voucherSchema).min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export type VoucherCreatePayload = z.infer<typeof voucherCreateSchema>
export type VoucherPatchPayload = z.infer<typeof voucherPatchSchema>

export function voucherStatusToDatabase(status: VoucherStatus): string {
  if (status === 'rascunho') return 'draft'
  if (status === 'emitido') return 'issued'
  if (status === 'confirmado') return 'confirmed'
  return 'cancelled'
}

export function voucherStatusFromDatabase(status: string): VoucherStatus {
  if (status === 'draft') return 'rascunho'
  if (status === 'issued') return 'emitido'
  if (status === 'confirmed') return 'confirmado'
  return 'cancelado'
}

export function normalizeLegacyVoucher(value: unknown): VoucherEmitido | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = voucherSchema.safeParse(pickVoucherFields(record))
  return parsed.success ? parsed.data as VoucherEmitido : null
}

export function assertVoucherStatusTransition(from: VoucherStatus, to: VoucherStatus): void {
  if (from === to) return
  const allowed: Record<VoucherStatus, VoucherStatus[]> = {
    rascunho: ['emitido', 'cancelado'],
    emitido: ['confirmado', 'cancelado'],
    confirmado: ['cancelado'],
    cancelado: [],
  }
  if (!allowed[from].includes(to)) {
    throw new Error(`Transicao de voucher invalida: ${from} -> ${to}.`)
  }
}

function pickVoucherFields(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(voucherSchema.shape).map((key) => [key, record[key]]),
  )
}
