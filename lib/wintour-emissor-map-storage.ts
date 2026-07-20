import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

export interface WintourEmissorMap {
  codigo: string
  user_id: string
  user_name: string
  updated_at: string
}

const STORAGE_KEY = 'bbt-wintour-emissor-map-v1'

function normalizeCodigo(value: string): string {
  return String(value || '').trim().toUpperCase()
}

function load(): Record<string, WintourEmissorMap> {
  if (typeof window === 'undefined') return {}
  const parsed = loadJSON<Record<string, WintourEmissorMap>>(STORAGE_KEY, {})
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function save(data: Record<string, WintourEmissorMap>): boolean {
  if (typeof window === 'undefined') return false
  return safeSetJSON(STORAGE_KEY, data)
}

export function getWintourEmissorMap(): Record<string, WintourEmissorMap> {
  return load()
}

export function getWintourEmissorMapping(codigo: string): WintourEmissorMap | undefined {
  return load()[normalizeCodigo(codigo)]
}

export function setWintourEmissorMapping(codigo: string, userId: string, userName: string): boolean {
  const key = normalizeCodigo(codigo)
  if (!key || !userId) return false
  const data = load()
  data[key] = {
    codigo: key,
    user_id: userId,
    user_name: userName,
    updated_at: new Date().toISOString(),
  }
  return save(data)
}

export function removeWintourEmissorMapping(codigo: string): boolean {
  const data = load()
  delete data[normalizeCodigo(codigo)]
  return save(data)
}
