import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  createAiAgentRun,
  createAiAgentTask,
  listAiAgentOperationalState,
  upsertAiAgentMemory,
} from '@/lib/server/ai-agent-operation-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const companyId = z.string().trim().min(1).max(200).optional()
const entityType = z.enum(['atendimento', 'voucher', 'empresa', 'funcionario', 'hotel', 'cotacao'])

const createRunSchema = z.object({
  action: z.literal('create_run'),
  data: z.object({
    company_id: companyId,
    input: z.string().trim().min(1).max(12_000),
    intent: z.string().trim().min(1).max(100),
    status: z.enum(['concluido', 'pendente', 'falhou']),
    summary: z.string().trim().min(1).max(4_000),
    plan: z.array(z.string().trim().min(1).max(500)).max(20),
    created_entities: z.array(z.object({
      type: z.string().trim().min(1).max(100),
      id: z.string().trim().min(1).max(200),
      label: z.string().trim().min(1).max(300),
    }).strict()).max(50).optional(),
    blocked_by: z.array(z.string().trim().min(1).max(1_000)).max(30).optional(),
  }).strict(),
}).strict()

const createTaskSchema = z.object({
  action: z.literal('create_task'),
  data: z.object({
    company_id: companyId,
    kind: z.enum([
      'cotacao', 'aprovacao', 'emissao', 'reserva_hotel', 'reserva_aereo',
      'reserva_carro', 'voucher', 'monitoramento', 'emergencia', 'financeiro',
      'notificacao', 'integracao_externa',
    ]),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(4_000),
    status: z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada']),
    priority: z.enum(['baixa', 'media', 'alta', 'urgente']),
    requires_human: z.boolean(),
    entity_type: entityType.optional(),
    entity_id: z.string().trim().min(1).max(200).optional(),
    due_at: z.union([
      z.string().date(),
      z.string().datetime({ offset: true }),
    ]).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }).strict().superRefine((data, context) => {
    if (Boolean(data.entity_type) !== Boolean(data.entity_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tipo e identificador da entidade devem ser informados juntos.',
        path: ['entity_id'],
      })
    }
  }),
}).strict()

const upsertMemorySchema = z.object({
  action: z.literal('upsert_memory'),
  data: z.object({
    company_id: companyId,
    entity_type: z.enum(['funcionario', 'empresa', 'hotel', 'fornecedor', 'sistema']),
    entity_id: z.string().trim().min(1).max(200),
    key: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(4_000),
    source: z.string().trim().min(1).max(300),
    confidence: z.enum(['alta', 'media', 'baixa']),
  }).strict(),
}).strict()

const createSchema = z.discriminatedUnion('action', [
  createRunSchema,
  createTaskSchema,
  upsertMemorySchema,
])

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'ai-agent-state:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const state = await listAiAgentOperationalState(guard.principal!)
    return NextResponse.json(
      { ok: true, state },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'ai-agent-state:create', limit: 100, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 96 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const input = createSchema.parse(body.body)
    const item = input.action === 'create_run'
      ? await createAiAgentRun(guard.principal!, input.data)
      : input.action === 'create_task'
        ? await createAiAgentTask(guard.principal!, input.data)
        : await upsertAiAgentMemory(guard.principal!, input.data)
    return NextResponse.json(
      { ok: true, item },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
