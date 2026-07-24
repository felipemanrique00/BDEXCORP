'use client'

import type {
  ExecutiveReportSnapshot,
  NewExecutiveReportSnapshot,
} from '@/lib/report-snapshot'

const Endpoint = '/api/report-snapshots'

export async function loadExecutiveReportSnapshots(): Promise<ExecutiveReportSnapshot[]> {
  const payload = await request(Endpoint, { method: 'GET', cache: 'no-store' })
  if (!Array.isArray(payload.snapshots)) {
    throw new Error('Resposta invalida ao carregar os resumos executivos.')
  }
  return payload.snapshots as ExecutiveReportSnapshot[]
}

export async function saveExecutiveReportSnapshot(
  input: NewExecutiveReportSnapshot,
): Promise<ExecutiveReportSnapshot> {
  const payload = await request(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isRecord(payload.snapshot)) {
    throw new Error('Resposta invalida ao salvar o resumo executivo.')
  }
  return payload.snapshot as unknown as ExecutiveReportSnapshot
}

export async function removeExecutiveReportSnapshot(snapshotId: string): Promise<void> {
  await request(`${Endpoint}/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' })
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Nao foi possivel concluir a operacao.')
  }
  if (!isRecord(payload)) throw new Error('Resposta invalida do servidor.')
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
