'use client'

import {
  SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
  isSharedStorageKey,
} from '@/lib/storage-keys'
import {
  combineStorageSyncValues,
  createStorageSyncValue,
  mergeStorageValues,
} from '@/lib/storage-merge'
import {
  getStorageClearAcknowledgements,
  isFullStorageResetNewer,
  isStorageKeyClearNewer,
  normalizeStorageClearMetadata,
  wasStorageKeyCleared,
} from '@/lib/storage-clear-metadata'

type JsonValue = any

type RemoteEntries = Record<string, JsonValue>

const STORAGE_API = '/api/storage'
const REMOTE_SYNC_DEBOUNCE_MS = 450
const REMOTE_HYDRATE_TIMEOUT_MS = 3500
const LOCAL_COMPACTION_MIN_INTERVAL_MS = 60_000
const LOCAL_CACHE_ENTRY_LIMIT_CHARS = 512 * 1024

let remoteHydrated = false
let remoteHydratePromise: Promise<boolean> | null = null
let syncTimer: number | null = null
let remoteRetryDelayMs = 5_000
let pendingRemoteEntries: RemoteEntries = {}
let pendingRemoteDeletes = new Set<string>()
let memoryFallbackEntries: Record<string, string> = {}
let lastLocalCompactionAt = 0
let storageMutationGeneration = 0

const WINTour_KEEP_KEYS = new Set([
  'idv_externo',
  'data_lancamento',
  'dt_interna_cadastro',
  'codigo_produto',
  'grupo_produto',
  'codigo_fornecedor',
  'fornecedor_codigo',
  'fornecedor_nome',
  'cia_iata',
  'num_bilhete',
  'localizador',
  'forma_de_pagamento',
  'cliente_codigo',
  'cliente_nome',
  'ccustos_cliente',
  'desc_ccustos_cliente',
  'numero_requisicao',
  'passageiro',
  'passageiro_normalizado',
  'solicitante',
  'aprovador',
  'departamento',
  'projeto',
  'matricula',
  'motivo_viagem',
  'cod_status',
  'situacao_contabil',
  'dt_inicio_servicos',
  'dt_fim_servicos',
  'qtd_trechos_diarias',
  'rota_resumida',
  'cid_dest_principal',
  'tipo_emissao',
  'canal_captacao',
  'canal_venda',
  'moeda',
  'total_fornecedor',
  'total_cliente',
  'prev_lucro_bruto',
  'total_tarifa',
  'total_taxa',
  'total_du',
  'total_outras_txs',
  'total_fee',
  'total_nao_faturado',
  'hotel_nr_apts',
  'hotel_categ_apt',
  'hotel_tipo_apt',
  'hotel_dt_check_in',
  'hotel_dt_check_out',
  'hotel_nr_hospedes',
  'hotel_reg_alimentacao',
  'hotel_cod_tipo_pagto',
  'hotel_nr_confirmacao',
  'hotel_dt_confirmacao',
  'hotel_confirmado_por',
])

export function safeGetRaw(key: string): string | null {
  if (typeof window === 'undefined') return null
  if (Object.prototype.hasOwnProperty.call(memoryFallbackEntries, key)) return memoryFallbackEntries[key]
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeRemove(key: string): void {
  if (typeof window === 'undefined') return
  delete memoryFallbackEntries[key]
  try {
    localStorage.removeItem(key)
  } catch {}
  queueRemoteDelete(key)
}

export function loadJSON<T>(key: string, fallback: T): T {
  const raw = safeGetRaw(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function safeSetJSON(key: string, value: JsonValue): boolean {
  try {
    return safeSetRaw(key, JSON.stringify(value))
  } catch {
    return false
  }
}

export function safeSetRaw(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  const previousRaw = safeGetRaw(key)

  if (shouldKeepSharedValueInMemory(key, value)) {
    keepValueInMemory(key, value)
    queueRemoteSet(key, value, previousRaw)
    return true
  }

  try {
    localStorage.setItem(key, value)
    delete memoryFallbackEntries[key]
    queueRemoteSet(key, value, previousRaw)
    return true
  } catch (error) {
    if (!isQuotaError(error)) {
      console.warn(`[storage] Falha ao salvar ${key}.`)
      return false
    }
  }

  compactarLocalStorage(true)
  try {
    localStorage.setItem(key, value)
    delete memoryFallbackEntries[key]
    queueRemoteSet(key, value, previousRaw)
    return true
  } catch (error) {
    if (isQuotaError(error)) {
      console.warn(`[storage] Sem espaco local para ${key}. Dados principais foram preservados em memoria nesta sessao.`)
    } else {
      console.warn(`[storage] Falha ao salvar ${key} apos compactacao.`)
    }
    memoryFallbackEntries[key] = value
    queueRemoteSet(key, value, previousRaw)
    return true
  }
}

export async function hydrateServerStorage(force = false): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (remoteHydrated && !force) return true
  if (remoteHydratePromise && !force) return remoteHydratePromise

  const hydrationGeneration = storageMutationGeneration
  remoteHydratePromise = (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REMOTE_HYDRATE_TIMEOUT_MS)
    try {
      const response = await fetch(STORAGE_API, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return false
      const payload = await response.json()
      if (!payload?.enabled || !payload?.entries || typeof payload.entries !== 'object') {
        remoteHydrated = true
        return false
      }
      if (hydrationGeneration !== storageMutationGeneration) return false

      const remoteEntries = payload.entries as RemoteEntries
      const scoped = payload.scoped === true
      const remoteMetadata = remoteEntries[SYSTEM_STORAGE_META_KEY]
      const localMetadata = rawToValue(safeGetRaw(SYSTEM_STORAGE_META_KEY) || 'null')
      const fullResetIsNewer = isFullStorageResetNewer(remoteMetadata, localMetadata)

      if (scoped || fullResetIsNewer) clearSharedLocalStorage()
      if (fullResetIsNewer) await clearBrowserOnlySystemData()

      for (const key of SHARED_STORAGE_KEYS) {
        if (key === SYSTEM_STORAGE_META_KEY) continue
        if (isStorageKeyClearNewer(remoteMetadata, localMetadata, key)) removeLocalOnly(key)
      }
      if (normalizeStorageClearMetadata(remoteMetadata)) {
        writeLocalOnly(SYSTEM_STORAGE_META_KEY, valueToRaw(remoteMetadata))
      }

      for (const [key, value] of Object.entries(remoteEntries)) {
        if (!isSharedStorageKey(key)) continue
        if (key === SYSTEM_STORAGE_META_KEY) continue
        const remoteRaw = valueToRaw(value)
        const localRaw = scoped ? null : safeGetRaw(key)
        const mergedValue = scoped
          ? value
          : mergeStorageValues(key, localRaw ? rawToValue(localRaw) : undefined, value)
        const mergedRaw = valueToRaw(mergedValue)
        writeLocalOnly(key, mergedRaw)
        if (!scoped && mergedRaw !== remoteRaw) pendingRemoteEntries[key] = mergedValue
      }
      if (!scoped) {
        seedMissingRemoteKeys(remoteEntries, remoteMetadata)
        if (Object.keys(pendingRemoteEntries).length) scheduleRemoteFlush()
      }

      remoteHydrated = true
      return true
    } catch {
      return false
    } finally {
      window.clearTimeout(timeout)
      remoteHydratePromise = null
    }
  })()

  return remoteHydratePromise
}

export async function syncLocalStorageToServer(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const entries: RemoteEntries = {}
  for (const key of SHARED_STORAGE_KEYS) {
    if (key === SYSTEM_STORAGE_META_KEY) continue
    const raw = safeGetRaw(key)
    if (raw != null) entries[key] = rawToValue(raw)
  }
  if (!Object.keys(entries).length) return false
  try {
    const response = await fetch(STORAGE_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, clearAcks: currentStorageClearAcknowledgements() }),
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => null)
    await applyRemoteClearMetadata(payload?.metadata)
    for (const key of normalizeRejectedKeys(payload?.rejectedKeys)) removeLocalOnly(key)
    return true
  } catch {
    return false
  }
}

export async function flushPendingRemoteStorage(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (syncTimer) {
    window.clearTimeout(syncTimer)
    syncTimer = null
  }
  return flushRemoteStorage()
}

export function clearLocalSharedStorageForSessionChange(): void {
  if (typeof window === 'undefined') return
  resetClientStorageSyncState()
  clearSharedLocalStorage()
}

export function prepareSharedStorageForSystemReset(): void {
  if (typeof window === 'undefined') return
  resetClientStorageSyncState()
  clearSharedLocalStorage()
}

export async function applyFullStorageResetLocally(metadata: unknown): Promise<void> {
  if (typeof window === 'undefined') return
  resetClientStorageSyncState()
  clearSharedLocalStorage()
  const normalizedMetadata = normalizeStorageClearMetadata(metadata)
  if (normalizedMetadata) {
    writeLocalOnly(SYSTEM_STORAGE_META_KEY, valueToRaw(normalizedMetadata))
  }
  await clearBrowserOnlySystemData()
}

function resetClientStorageSyncState(): void {
  storageMutationGeneration += 1
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = null
  pendingRemoteEntries = {}
  pendingRemoteDeletes = new Set()
  remoteHydrated = false
  remoteHydratePromise = null
  remoteRetryDelayMs = 5_000
}

export function compactarLocalStorage(force = false): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  if (!force && now - lastLocalCompactionAt < LOCAL_COMPACTION_MIN_INTERVAL_MS) return
  lastLocalCompactionAt = now

  // Dados operacionais nao podem ser descartados por compactacao preventiva.
  // Se nao couber localmente, safeSetRaw preserva em memoria e sincroniza no storage compartilhado.
  compactarArrayKey('bbt-atendimentos', Number.MAX_SAFE_INTEGER, compactarAtendimento)
  compactarArrayKey('bbt-vouchers-emitidos', Number.MAX_SAFE_INTEGER, compactarVoucherEmitido)
  compactarArrayKey('bbt-financeiro', Number.MAX_SAFE_INTEGER, compactarFinanceiro)
  compactarArrayKey('bbt-auditoria', 300)
  compactarArrayKey('bbt-transacoes', 300)
  compactarArrayKey('bbt-alertas', 1000)
  compactarArrayKey('bbt-transferencias', 1000)
  compactarArrayKey('bbt-fila-importacao', 500)
  compactarArrayKey('bbt-supplier-action-logs-v1', 500)
  compactarArrayKey('bbt-supplier-reservations-v1', 1500)
  compactarArrayKey('bbt-mensagens-thread', 300)
  compactarArrayKey('bbt-ia-chat-historico-v12', 60)
  compactarArrayKey('bbt-resumos-executivos-v12', 30)
  compactarArrayKey('bbt-wintour-imports-v1', 60, compactarWintourRun)
  compactarUniqueArrayKey('bbt-alertas-resolvidos', 5_000, 'oldest-first')
  compactarUniqueArrayKey('bbt-travel-desk-v11', 30, 'newest-first')
  compactarBbtData()
}

export function compactarAtendimento<T extends Record<string, any>>(item: T): T {
  const next: Record<string, any> = { ...item }
  delete next.raw
  if (next.wintour_dados) next.wintour_dados = compactarWintourDados(next.wintour_dados)
  if (next.observacoes) next.observacoes = limitarTexto(next.observacoes, 900)
  if (next.observacoes_internas) next.observacoes_internas = limitarTexto(next.observacoes_internas, 1200)
  if (Array.isArray(next.historico_agentes)) next.historico_agentes = next.historico_agentes.slice(-20)
  return next as T
}

export function compactarVoucherEmitido<T extends Record<string, any>>(item: T): T {
  const next: Record<string, any> = { ...item }
  delete next.raw
  if (next.observacoes) next.observacoes = limitarTexto(next.observacoes, 700)
  if (next.observacoes_internas) next.observacoes_internas = limitarTexto(next.observacoes_internas, 1000)
  if (Array.isArray(next.passageiros)) next.passageiros = next.passageiros.slice(0, 20)
  return next as T
}

export function compactarFinanceiro<T extends Record<string, any>>(item: T): T {
  const next: Record<string, any> = { ...item }
  if (next.descricao) next.descricao = limitarTexto(next.descricao, 300)
  if (next.observacoes) next.observacoes = limitarTexto(next.observacoes, 500)
  return next as T
}

export function compactarWintourDados(data: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!WINTour_KEEP_KEYS.has(key)) continue
    if (value == null || value === '') continue
    if (typeof value === 'number' && value === 0) continue
    out[key] = typeof value === 'string' ? limitarTexto(value, 180) : value
  }
  return out
}

function isQuotaError(error: any): boolean {
  return (
    error?.name === 'QuotaExceededError' ||
    error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error?.code === 22 ||
    String(error?.message || '').toLowerCase().includes('quota')
  )
}

function queueRemoteSet(key: string, rawValue: string, previousRaw: string | null): void {
  if (typeof window === 'undefined' || !isSharedStorageKey(key) || key === SYSTEM_STORAGE_META_KEY) return
  pendingRemoteDeletes.delete(key)
  const syncValue = createStorageSyncValue(
    key,
    previousRaw == null ? undefined : rawToValue(previousRaw),
    rawToValue(rawValue),
  )
  pendingRemoteEntries[key] = Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key)
    ? combineStorageSyncValues(key, pendingRemoteEntries[key], syncValue)
    : syncValue
  scheduleRemoteFlush()
}

function queueRemoteDelete(key: string): void {
  if (typeof window === 'undefined' || !isSharedStorageKey(key) || key === SYSTEM_STORAGE_META_KEY) return
  delete pendingRemoteEntries[key]
  pendingRemoteDeletes.add(key)
  scheduleRemoteFlush()
}

function scheduleRemoteFlush(delayMs = REMOTE_SYNC_DEBOUNCE_MS): void {
  if (typeof window === 'undefined') return
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(flushRemoteStorage, delayMs)
}

async function flushRemoteStorage(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const entries = pendingRemoteEntries
  const deletes = Array.from(pendingRemoteDeletes)
  pendingRemoteEntries = {}
  pendingRemoteDeletes = new Set()
  syncTimer = null

  try {
    if (Object.keys(entries).length) {
      const response = await fetch(STORAGE_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, clearAcks: currentStorageClearAcknowledgements() }),
      })
      if (!response.ok) throw new Error(`Falha ao sincronizar storage: HTTP ${response.status}`)

      const payload = await response.json().catch(() => null)
      await applyRemoteClearMetadata(payload?.metadata)
      for (const key of normalizeRejectedKeys(payload?.rejectedKeys)) {
        if (Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key)) continue
        if (pendingRemoteDeletes.has(key)) continue
        removeLocalOnly(key)
      }
      const mergedEntries = payload?.entries && typeof payload.entries === 'object'
        ? payload.entries as RemoteEntries
        : {}
      for (const [key, value] of Object.entries(mergedEntries)) {
        if (!isSharedStorageKey(key)) continue
        if (Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key)) continue
        if (pendingRemoteDeletes.has(key)) continue
        writeLocalOnly(key, valueToRaw(value))
      }
    }
    const effectiveDeletes = deletes.filter(
      (key) => !Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key),
    )
    if (effectiveDeletes.length) {
      const response = await fetch(STORAGE_API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: effectiveDeletes }),
      })
      if (!response.ok) throw new Error(`Falha ao remover storage: HTTP ${response.status}`)
      const payload = await response.json().catch(() => null)
      await applyRemoteClearMetadata(payload?.metadata)
    }
    remoteRetryDelayMs = 5_000
    return true
  } catch {
    for (const [key, value] of Object.entries(entries)) {
      pendingRemoteEntries[key] = Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key)
        ? combineStorageSyncValues(key, value, pendingRemoteEntries[key])
        : value
    }
    deletes.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(pendingRemoteEntries, key)) pendingRemoteDeletes.add(key)
    })
    scheduleRemoteFlush(remoteRetryDelayMs)
    remoteRetryDelayMs = Math.min(remoteRetryDelayMs * 2, 30_000)
    return false
  }
}

function seedMissingRemoteKeys(remoteEntries: RemoteEntries, remoteMetadata: unknown): void {
  const missing: RemoteEntries = {}
  for (const key of SHARED_STORAGE_KEYS) {
    if (key === SYSTEM_STORAGE_META_KEY) continue
    if (Object.prototype.hasOwnProperty.call(remoteEntries, key)) continue
    if (wasStorageKeyCleared(remoteMetadata, key)) {
      removeLocalOnly(key)
      continue
    }
    const raw = safeGetRaw(key)
    if (raw != null) missing[key] = rawToValue(raw)
  }
  if (!Object.keys(missing).length) return
  pendingRemoteEntries = { ...missing, ...pendingRemoteEntries }
  scheduleRemoteFlush()
}

function writeLocalOnly(key: string, rawValue: string): boolean {
  if (shouldKeepSharedValueInMemory(key, rawValue, true)) {
    keepValueInMemory(key, rawValue)
    return true
  }

  try {
    localStorage.setItem(key, rawValue)
    delete memoryFallbackEntries[key]
    return true
  } catch (error) {
    if (!isQuotaError(error)) return false
  }

  compactarLocalStorage(true)
  try {
    localStorage.setItem(key, rawValue)
    delete memoryFallbackEntries[key]
    return true
  } catch {
    memoryFallbackEntries[key] = rawValue
    return false
  }
}

function shouldKeepSharedValueInMemory(
  key: string,
  rawValue: string,
  remoteAvailable = remoteHydrated,
): boolean {
  return remoteAvailable && isSharedStorageKey(key) && rawValue.length > LOCAL_CACHE_ENTRY_LIMIT_CHARS
}

function keepValueInMemory(key: string, rawValue: string): void {
  memoryFallbackEntries[key] = rawValue
  try {
    localStorage.removeItem(key)
  } catch {}
}

function clearSharedLocalStorage(): void {
  for (const key of SHARED_STORAGE_KEYS) {
    delete memoryFallbackEntries[key]
    try {
      localStorage.removeItem(key)
    } catch {}
  }
}

function removeLocalOnly(key: string): void {
  delete memoryFallbackEntries[key]
  try {
    localStorage.removeItem(key)
  } catch {}
}

async function clearBrowserOnlySystemData(): Promise<void> {
  const localKeys = ['bbt-storage', 'bbt-vouchers', 'bbt-last-seen-demanda']
  for (const key of localKeys) removeLocalOnly(key)
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('bbt-filtro-'))
      .forEach(removeLocalOnly)
  } catch {}

  const { clearAllVoucherFiles } = await import('@/lib/vouchers-storage')
  await clearAllVoucherFiles()
}

async function applyRemoteClearMetadata(metadata: unknown): Promise<void> {
  const normalizedMetadata = normalizeStorageClearMetadata(metadata)
  if (!normalizedMetadata) return

  const localMetadata = rawToValue(safeGetRaw(SYSTEM_STORAGE_META_KEY) || 'null')
  if (isFullStorageResetNewer(normalizedMetadata, localMetadata)) {
    pendingRemoteEntries = {}
    pendingRemoteDeletes = new Set()
    clearSharedLocalStorage()
    await clearBrowserOnlySystemData()
  } else {
    for (const key of SHARED_STORAGE_KEYS) {
      if (key === SYSTEM_STORAGE_META_KEY) continue
      if (isStorageKeyClearNewer(normalizedMetadata, localMetadata, key)) removeLocalOnly(key)
    }
  }
  writeLocalOnly(SYSTEM_STORAGE_META_KEY, valueToRaw(normalizedMetadata))
}

function currentStorageClearAcknowledgements(): Record<string, string> {
  return getStorageClearAcknowledgements(rawToValue(safeGetRaw(SYSTEM_STORAGE_META_KEY) || 'null'))
}

function normalizeRejectedKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(isSharedStorageKey) : []
}

function rawToValue(rawValue: string): JsonValue {
  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

function valueToRaw(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function compactarArrayKey(key: string, maxItems: number, mapper?: (item: any) => any): void {
  const raw = safeGetRaw(key)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const compacted = parsed.slice(-maxItems).map((item) => mapper ? mapper(item) : item)
    const serialized = JSON.stringify(compacted)
    if (serialized !== raw) localStorage.setItem(key, serialized)
  } catch {}
}

function compactarUniqueArrayKey(
  key: string,
  maxItems: number,
  order: 'oldest-first' | 'newest-first',
): void {
  const raw = safeGetRaw(key)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const seen = new Set<string>()
    const unique = parsed.filter((item) => {
      const fingerprint = stableJson(item)
      if (seen.has(fingerprint)) return false
      seen.add(fingerprint)
      return true
    })
    const compacted = order === 'newest-first' ? unique.slice(0, maxItems) : unique.slice(-maxItems)
    const serialized = JSON.stringify(compacted)
    if (serialized !== raw) localStorage.setItem(key, serialized)
  } catch {}
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function compactarWintourRun<T extends Record<string, any>>(item: T): T {
  const next: Record<string, any> = { ...item }
  if (Array.isArray(next.fingerprints)) next.fingerprints = next.fingerprints.slice(0, 500)
  return next as T
}

function compactarBbtData(): void {
  const raw = safeGetRaw('bbt-data-v4')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const state = parsed?.state || parsed
    if (Array.isArray(state?.hoteis)) {
      state.hoteis = state.hoteis.map((hotel: any) => ({
        ...hotel,
        observacoes: hotel?.observacoes ? limitarTexto(hotel.observacoes, 500) : hotel?.observacoes,
        info_faturamento: hotel?.info_faturamento ? limitarTexto(hotel.info_faturamento, 300) : hotel?.info_faturamento,
      }))
    }
    if (Array.isArray(state?.empresas)) {
      state.empresas = state.empresas.map((empresa: any) => ({
        ...empresa,
        observacoes: empresa?.observacoes ? limitarTexto(empresa.observacoes, 500) : empresa?.observacoes,
      }))
    }
    const serialized = JSON.stringify(parsed)
    if (serialized !== raw) localStorage.setItem('bbt-data-v4', serialized)
  } catch {}
}

function limitarTexto(value: any, max: number): string {
  const text = String(value || '')
  return text.length > max ? text.slice(0, max) : text
}
