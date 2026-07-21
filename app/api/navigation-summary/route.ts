import { NextResponse } from 'next/server'

import { getOperationalAlerts } from '@/lib/operational-alerts'
import { guardApiRequest } from '@/lib/security/api-guard'
import { scopeStorageEntriesForRead } from '@/lib/security/storage-scope'
import { getStorageEntriesByKeys } from '@/lib/server-db'
import { logError } from '@/lib/server/logger'
import type { Atendimento, Empresa, VoucherEmitido } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUMMARY_KEYS = [
  'bbt-data-v4',
  'bbt-atendimentos',
  'bbt-vouchers-emitidos',
  'bbt-caixa-entrada',
] as const

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'navigation-summary:get', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const entries = scopeStorageEntriesForRead(
      await getStorageEntriesByKeys(SUMMARY_KEYS),
      guard.user,
    )
    const atendimentos = arrayOf<Atendimento>(entries['bbt-atendimentos'])
    const vouchers = arrayOf<VoucherEmitido>(entries['bbt-vouchers-emitidos'])
    const inbox = arrayOf<Record<string, unknown>>(entries['bbt-caixa-entrada'])
    const empresas = persistedState(entries['bbt-data-v4']).empresas
    const abertas = atendimentos
      .filter((item) => ['pendente', 'em_andamento', 'aguardando_cliente'].includes(item.status))
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    const lastSeen = new URL(request.url).searchParams.get('lastSeen')?.trim().slice(0, 160) || ''

    return NextResponse.json({
      unreadInbox: inbox.filter((item) => item.lida !== true && item.status === 'pendente').length,
      newDemands: countNewDemands(abertas, lastSeen),
      activeAlerts: getOperationalAlerts({ atendimentos, vouchers, empresas }).length,
    })
  } catch (error) {
    logError('navigation_summary_failed', error, {
      requestId: guard.requestId,
      errorCode: 'NAVIGATION_SUMMARY_FAILED',
    })
    return NextResponse.json(
      { error: 'Falha ao atualizar indicadores de navegacao.', requestId: guard.requestId },
      { status: 500 },
    )
  }
}

function countNewDemands(items: Atendimento[], lastSeen: string): number {
  if (!lastSeen || items.length === 0) return 0
  const index = items.findIndex((item) => item.id === lastSeen)
  return index === -1 ? items.length : index
}

function persistedState(value: unknown): { empresas: Empresa[] } {
  if (!isRecord(value)) return { empresas: [] }
  const state = isRecord(value.state) ? value.state : value
  return { empresas: arrayOf<Empresa>(state.empresas) }
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
