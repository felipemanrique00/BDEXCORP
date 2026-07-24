'use client'

import type {
  AgentMemory,
  AgentOperationalState,
  AgentRun,
  AgentTask,
  AgentTaskStatus,
  NewAgentMemory,
  NewAgentRun,
  NewAgentTask,
} from '@/lib/ai-agent'

const Endpoint = '/api/ia/agent-state'

export async function loadAiAgentState(): Promise<AgentOperationalState> {
  const payload = await request(Endpoint, { method: 'GET', cache: 'no-store' })
  const state = payload.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Resposta invalida ao carregar o painel da IA.')
  }
  const candidate = state as Record<string, unknown>
  if (
    !Array.isArray(candidate.tasks)
    || !Array.isArray(candidate.approvals)
    || !Array.isArray(candidate.quotes)
    || !Array.isArray(candidate.runs)
    || !Array.isArray(candidate.memories)
  ) {
    throw new Error('Resposta incompleta ao carregar o painel da IA.')
  }
  return candidate as unknown as AgentOperationalState
}

export async function createAgentRun(input: NewAgentRun): Promise<AgentRun> {
  return createItem<AgentRun>('create_run', input)
}

export async function createAgentTask(input: NewAgentTask): Promise<AgentTask> {
  return createItem<AgentTask>('create_task', input)
}

export async function upsertAgentMemory(input: NewAgentMemory): Promise<AgentMemory> {
  return createItem<AgentMemory>('upsert_memory', input)
}

export async function updateAgentTask(
  taskId: string,
  input: { status: AgentTaskStatus; expectedVersion: number },
): Promise<AgentTask> {
  const payload = await request(
    `${Endpoint}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!isRecord(payload.task)) throw new Error('Resposta invalida ao atualizar a tarefa.')
  return payload.task as unknown as AgentTask
}

async function createItem<T>(
  action: 'create_run' | 'create_task' | 'upsert_memory',
  data: NewAgentRun | NewAgentTask | NewAgentMemory,
): Promise<T> {
  const payload = await request(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
  })
  if (!isRecord(payload.item)) throw new Error('Resposta invalida ao salvar o estado da IA.')
  return payload.item as T
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(payload) || 'Nao foi possivel atualizar o painel da IA.')
  }
  if (!isRecord(payload)) throw new Error('Resposta invalida do servidor.')
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(value: unknown): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : ''
}
