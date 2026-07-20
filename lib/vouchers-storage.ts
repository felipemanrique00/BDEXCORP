// ============================================================
// Vouchers Storage - IndexedDB (capacidade ~2GB vs 5MB)
// Migração automática do localStorage existente
// ============================================================

import { safeGetRaw, safeRemove } from '@/lib/storage-quota'

export interface Voucher {
  id: string
  funcionario_id: string
  nome_arquivo: string
  tamanho_bytes: number
  mime_type: string
  descricao: string
  base64_data: string
  data_upload: string
}

const DB_NAME = 'bbt-storage'
const DB_VERSION = 1
const STORE_VOUCHERS = 'vouchers'
const LEGACY_KEY = 'bbt-vouchers'
const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB por arquivo (IndexedDB aguenta MUITO mais)

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_VOUCHERS)) {
        const store = db.createObjectStore(STORE_VOUCHERS, { keyPath: 'id' })
        store.createIndex('funcionario_id', 'funcionario_id', { unique: false })
      }
    }
  })
  return dbPromise
}

// Migração automática do localStorage antigo (roda 1x)
let migrated = false
async function migrateFromLocalStorage(): Promise<void> {
  if (migrated || typeof window === 'undefined') return
  migrated = true
  try {
    const raw = safeGetRaw(LEGACY_KEY)
    if (!raw) return
    const old: Voucher[] = JSON.parse(raw)
    if (!Array.isArray(old) || old.length === 0) return

    const db = await openDB()
    const tx = db.transaction(STORE_VOUCHERS, 'readwrite')
    const store = tx.objectStore(STORE_VOUCHERS)
    for (const v of old) {
      try { store.put(v) } catch {}
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
    safeRemove(LEGACY_KEY)
  } catch (e) {
    console.warn('Falha na migração de vouchers:', e)
  }
}

// Cache em memória pra operações sync (UI precisa ser responsiva)
let memoryCache: Voucher[] = []
let cacheLoaded = false

async function loadCache(): Promise<Voucher[]> {
  if (cacheLoaded) return memoryCache
  if (typeof window === 'undefined') return []
  try {
    await migrateFromLocalStorage()
    const db = await openDB()
    return await new Promise<Voucher[]>((resolve, reject) => {
      const tx = db.transaction(STORE_VOUCHERS, 'readonly')
      const store = tx.objectStore(STORE_VOUCHERS)
      const req = store.getAll()
      req.onsuccess = () => {
        memoryCache = req.result as Voucher[]
        cacheLoaded = true
        resolve(memoryCache)
      }
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('Erro carregando vouchers:', e)
    cacheLoaded = true
    return []
  }
}

// Inicia carregamento assim que o módulo importa no cliente
if (typeof window !== 'undefined') {
  loadCache()
}

// ======== API Sync (para componentes já existentes) ========

export function getAllVouchers(): Voucher[] {
  return memoryCache
}

export function getVouchersByFuncionario(funcionarioId: string): Voucher[] {
  return memoryCache.filter((v) => v.funcionario_id === funcionarioId)
}

export function addVoucher(data: Omit<Voucher, 'id' | 'data_upload'>): Voucher | null {
  if (data.tamanho_bytes > MAX_FILE_SIZE) {
    console.warn('Voucher maior que 15MB')
    return null
  }
  const novo: Voucher = {
    ...data,
    id: `vch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    data_upload: new Date().toISOString(),
  }
  memoryCache.push(novo)
  // Grava async no IndexedDB
  persistVoucher(novo).catch((e) => {
    console.error('Erro persistindo voucher:', e)
    memoryCache = memoryCache.filter((v) => v.id !== novo.id)
  })
  return novo
}

export function deleteVoucher(id: string): boolean {
  memoryCache = memoryCache.filter((v) => v.id !== id)
  removeVoucher(id).catch((e) => console.error('Erro removendo voucher:', e))
  return true
}

export async function clearAllVoucherFiles(): Promise<void> {
  memoryCache = []
  cacheLoaded = true
  migrated = true
  if (typeof window === 'undefined') return

  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_VOUCHERS, 'readwrite')
    tx.objectStore(STORE_VOUCHERS).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Limpeza de vouchers cancelada.'))
  })
  memoryCache = []
  cacheLoaded = true
  safeRemove(LEGACY_KEY)
}

// ======== Internos async ========

async function persistVoucher(v: Voucher): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VOUCHERS, 'readwrite')
    tx.objectStore(STORE_VOUCHERS).put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function removeVoucher(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VOUCHERS, 'readwrite')
    tx.objectStore(STORE_VOUCHERS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ======== Utilitários (inalterados) ========

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function downloadVoucher(voucher: Voucher): boolean {
  const blob = voucherPdfBlob(voucher)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = voucher.nome_arquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return true
}

export function openVoucherInNewTab(voucher: Voucher): boolean {
  const blob = voucherPdfBlob(voucher)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const win = window.open('about:blank', '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    return false
  }
  win.opener = null
  win.location.replace(url)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

export function voucherPdfBlob(voucher: Pick<Voucher, 'base64_data'>): Blob | null {
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(voucher.base64_data || '')
  if (!match) return null

  try {
    const binary = atob(match[1].replace(/\s/g, ''))
    if (!binary.startsWith('%PDF-')) return null
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: 'application/pdf' })
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export function getTotalStorageSize(): number {
  return memoryCache.reduce((sum, v) => sum + v.tamanho_bytes, 0)
}

/**
 * Retorna estimativa de uso do IndexedDB (navegadores modernos)
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const est = await navigator.storage.estimate()
    return { usage: est.usage || 0, quota: est.quota || 0 }
  } catch {
    return null
  }
}

/** Para componentes novos que quiserem esperar o carregamento */
export async function waitForVouchers(): Promise<Voucher[]> {
  return loadCache()
}
