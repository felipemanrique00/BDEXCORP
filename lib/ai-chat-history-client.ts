'use client'

import type { AiChatHistoryMessage } from '@/lib/ai-chat-history'

const Endpoint = '/api/ia/chat-history'

export async function loadAiChatHistory(): Promise<AiChatHistoryMessage[]> {
  const payload = await request({ method: 'GET', cache: 'no-store' })
  if (!Array.isArray(payload.messages)) {
    throw new Error('Resposta invalida ao carregar o historico da IA.')
  }
  return payload.messages.filter(isMessage)
}

export async function appendAiChatHistory(
  messages: AiChatHistoryMessage[],
): Promise<void> {
  await request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}

export async function clearAiChatHistory(): Promise<void> {
  await request({ method: 'DELETE' })
}

async function request(init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(Endpoint, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(payload) || 'Nao foi possivel atualizar o historico da IA.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta invalida do servidor.')
  }
  return payload as Record<string, unknown>
}

function isMessage(value: unknown): value is AiChatHistoryMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && typeof message.timestamp === 'string'
    && (
      message.provedor === undefined
      || message.provedor === 'openai'
      || message.provedor === 'gemini'
      || message.provedor === 'local'
    )
  )
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const error = (value as Record<string, unknown>).error
  return typeof error === 'string' ? error : ''
}
