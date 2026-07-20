import type { Atendimento } from '@/types'

export function normalizarSerialOS(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

export function serialOSFromAtendimento(
  atendimento: Pick<Atendimento, 'id' | 'created_at' | 'data_atendimento' | 'serial_os'>,
  index = 0,
): string {
  if (atendimento.serial_os) return normalizarSerialOS(atendimento.serial_os)
  const baseDate = normalizarData(atendimento.data_atendimento || atendimento.created_at) || normalizarData(new Date().toISOString())
  const compactDate = baseDate.replace(/-/g, '')
  const hash = hashString(atendimento.id || `${baseDate}-${index}`)
  return `OS-${compactDate}-${String(hash % 10000).padStart(4, '0')}`
}

export function ensureAtendimentoSerial(atendimento: Atendimento, index = 0): Atendimento {
  const serial = serialOSFromAtendimento(atendimento, index)
  return atendimento.serial_os === serial ? atendimento : { ...atendimento, serial_os: serial }
}

export function gerarProximoSerialOS(atendimentos: Atendimento[], date = new Date()): string {
  const compactDate = normalizarData(date.toISOString()).replace(/-/g, '')
  const prefix = `OS-${compactDate}-`
  const next = atendimentos.reduce((maior, item, index) => {
    const serial = serialOSFromAtendimento(item, index)
    if (!serial.startsWith(prefix)) return maior
    const value = Number(serial.slice(prefix.length))
    return Number.isFinite(value) ? Math.max(maior, value + 1) : maior
  }, 1)
  return `${prefix}${String(next).padStart(4, '0')}`
}

export function criarSequenciadorSerialOS(atendimentos: Atendimento[], date = new Date()): () => string {
  const compactDate = normalizarData(date.toISOString()).replace(/-/g, '')
  const prefix = `OS-${compactDate}-`
  let next = 1

  atendimentos.forEach((item, index) => {
    const serial = serialOSFromAtendimento(item, index)
    if (!serial.startsWith(prefix)) return
    const value = Number(serial.slice(prefix.length))
    if (Number.isFinite(value)) next = Math.max(next, value + 1)
  })

  return () => `${prefix}${String(next++).padStart(4, '0')}`
}

export function matchesSerialOS(atendimento: Atendimento, query: string, index = 0): boolean {
  const normalizedQuery = normalizarSerialOS(query)
  if (!normalizedQuery) return false
  const serial = serialOSFromAtendimento(atendimento, index)
  return serial === normalizedQuery || serial.replace(/\D/g, '') === normalizedQuery.replace(/\D/g, '')
}

function normalizarData(value: string): string {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return new Date().toISOString().slice(0, 10)
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}
