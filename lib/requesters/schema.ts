import { z } from 'zod'

import type { SolicitanteEmpresa, StatusSolicitanteEmpresa } from '@/types'

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

const booleanValue = z.preprocess(
  (value) => {
    if (value === 'true' || value === 1 || value === '1') return true
    if (value === 'false' || value === 0 || value === '0') return false
    return value
  },
  z.boolean(),
)

export const requesterIdentifierSchema = z.string().trim().min(1).max(160)
export const requesterCompanyIdentifierSchema = z.string().trim().min(1).max(160)
export const requesterStatusSchema = z.enum(['ativo', 'bloqueado', 'pendente'])

export const requesterPayloadSchema = z.object({
  company_id: requesterCompanyIdentifierSchema,
  user_id: nullableIdentifier.default(null),
  funcionario_id: nullableIdentifier.default(null),
  nome: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  telefone: optionalText(40).default(''),
  cargo: optionalText(160).default(''),
  departamento: optionalText(160).default(''),
  centro_custo: optionalText(160).default(''),
  status: requesterStatusSchema.default('ativo'),
  pode_criar_demanda: booleanValue.default(true),
  pode_ver_vouchers: booleanValue.default(true),
  pode_ver_financeiro: booleanValue.default(false),
  limite_por_solicitacao: z.coerce.number().finite().min(0).max(999_999_999_999.99).default(0),
  observacoes: optionalText(4_000),
}).strict()

export const requesterMutationSchema = z.object({
  id: requesterIdentifierSchema.optional(),
  editingId: requesterIdentifierSchema.optional(),
  solicitante: requesterPayloadSchema,
  criarAcesso: z.boolean().default(false),
  password: z.string().max(256).default(''),
}).strict()

export type RequesterPayload = z.infer<typeof requesterPayloadSchema>
export type RequesterMutation = z.infer<typeof requesterMutationSchema>

export function requesterStatusToDatabase(status: StatusSolicitanteEmpresa): string {
  if (status === 'bloqueado') return 'blocked'
  if (status === 'pendente') return 'pending'
  return 'active'
}

export function requesterStatusFromDatabase(status: string): StatusSolicitanteEmpresa {
  if (status === 'blocked' || status === 'inactive') return 'bloqueado'
  if (status === 'pending') return 'pendente'
  return 'ativo'
}

export function normalizeLegacyRequester(value: unknown): SolicitanteEmpresa | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = requesterPayloadSchema.safeParse({
    company_id: record.company_id,
    user_id: record.user_id,
    funcionario_id: record.funcionario_id,
    nome: record.nome,
    email: record.email,
    telefone: record.telefone,
    cargo: record.cargo,
    departamento: record.departamento,
    centro_custo: record.centro_custo,
    status: record.status,
    pode_criar_demanda: record.pode_criar_demanda,
    pode_ver_vouchers: record.pode_ver_vouchers,
    pode_ver_financeiro: record.pode_ver_financeiro,
    limite_por_solicitacao: record.limite_por_solicitacao,
    observacoes: record.observacoes,
  })
  const id = String(record.id || '').trim()
  if (!parsed.success || !id) return null

  const createdAt = validIsoDate(record.created_at) || new Date().toISOString()
  const updatedAt = validIsoDate(record.updated_at)
  return {
    id,
    ...parsed.data,
    created_at: createdAt,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  }
}

function validIsoDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
