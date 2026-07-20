import { mergeStorageClearMetadata } from '@/lib/storage-clear-metadata'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'

type JsonRecord = Record<string, any>

const STATE_ARRAY_KEYS = ['empresas', 'gruposEmpresariais', 'funcionarios', 'hoteis', 'politicas']
const DELETE_RECORD_KEY = '__bbt_deleted_record_key'

type DeleteRecordMarker = {
  [DELETE_RECORD_KEY]: string
}

export function mergeStorageValues(key: string, currentValue: any, incomingValue: any): any {
  if (currentValue == null) return incomingValue
  if (incomingValue == null) return currentValue

  if (key === SYSTEM_STORAGE_META_KEY) {
    return mergeStorageClearMetadata(currentValue, incomingValue)
  }

  if (key === 'bbt-vouchers-last-numero' || key === 'bbt-voucher-sequencia') {
    const current = Number(currentValue || 0)
    const incoming = Number(incomingValue || 0)
    return String(Math.max(Number.isFinite(current) ? current : 0, Number.isFinite(incoming) ? incoming : 0))
  }

  if (key === 'bbt-data-v4') return mergePersistedStore(currentValue, incomingValue)

  if (Array.isArray(currentValue) && Array.isArray(incomingValue)) {
    return normalizeMergedArray(key, mergeRecordArrays(currentValue, incomingValue))
  }

  if (isPlainObject(currentValue) && isPlainObject(incomingValue)) {
    return { ...currentValue, ...incomingValue }
  }

  return incomingValue
}

function mergePersistedStore(currentValue: any, incomingValue: any): any {
  const currentState = currentValue?.state && isPlainObject(currentValue.state) ? currentValue.state : currentValue
  const incomingState = incomingValue?.state && isPlainObject(incomingValue.state) ? incomingValue.state : incomingValue
  const state: JsonRecord = {
    ...(isPlainObject(currentState) ? currentState : {}),
    ...(isPlainObject(incomingState) ? incomingState : {}),
  }

  for (const arrayKey of STATE_ARRAY_KEYS) {
    const currentArray = Array.isArray(currentState?.[arrayKey]) ? currentState[arrayKey] : []
    const incomingArray = Array.isArray(incomingState?.[arrayKey]) ? incomingState[arrayKey] : []
    state[arrayKey] = mergeRecordArrays(currentArray, incomingArray)
  }

  if (incomingValue?.state || currentValue?.state) {
    return {
      ...(isPlainObject(currentValue) ? currentValue : {}),
      ...(isPlainObject(incomingValue) ? incomingValue : {}),
      state,
    }
  }

  return state
}

function mergeRecordArrays(currentItems: any[], incomingItems: any[]): any[] {
  const map = new Map<string, any>()
  const withoutKey: any[] = []

  const addItems = (items: any[]) => {
    for (const item of items) {
      const deletedKey = getDeleteRecordKey(item)
      if (deletedKey) {
        map.delete(deletedKey)
        continue
      }

      const key = storageRecordKey(item)
      if (!key) {
        withoutKey.push(item)
        continue
      }
      const existing = map.get(key)
      map.set(key, existing ? chooseNewest(existing, item) : item)
    }
  }
  addItems(currentItems)
  addItems(incomingItems)

  return [...map.values(), ...withoutKey]
}

export function storageRecordKey(item: any): string {
  if (item == null || typeof item !== 'object') return `primitive:${typeof item}:${String(item)}`

  const fingerprint = clean(item.fingerprint)
  if (fingerprint) return `fingerprint:${fingerprint}`

  const wintourFingerprint = clean(String(item.observacoes_internas || '').match(/wintour_fingerprint=([^|\s]+)/)?.[1])
  if (wintourFingerprint) return `wintour:${wintourFingerprint}`

  const venda = clean(item.venda_numero)
  if (venda) {
    const owner = clean(item.empresa_id || item.company_id || item.cliente_codigo || item.empresa_codigo)
    return owner ? `venda:${owner}:${venda}` : `venda:${venda}`
  }

  const codigoFuncionario = onlyDigits(item.codigo_identificacao)
  if (codigoFuncionario) return `func-codigo:${codigoFuncionario}`

  const email = clean(item.email)
  if (email) return `email:${clean(item.company_id)}:${email.toLowerCase()}`

  const accountEmail = clean(item.user?.email)
  if (accountEmail) return `account-email:${accountEmail.toLowerCase()}`

  const cnpj = onlyDigits(item.cnpj || item.cnpj_matriz)
  if (cnpj) return `cnpj:${cnpj}`

  const cpf = onlyDigits(item.cpf)
  if (cpf) return `cpf:${clean(item.company_id)}:${cpf}`

  const numero = clean(item.numero)
  if (numero) return `numero:${numero}`

  const id = clean(item.id)
  if (id) return `id:${id}`

  const composite = [
    item.empresa_id || item.company_id,
    item.passageiro_nome || item.nome,
    item.tipo_servico || item.tipo,
    item.data_atendimento || item.data || item.created_at,
    item.localizador,
  ].map(clean).filter(Boolean)

  if (composite.length >= 3) return `composite:${composite.join('|')}`

  const serialized = stableStringify(item)
  return serialized ? `json:${serialized}` : ''
}

export function createStorageSyncValue(key: string, previousValue: any, nextValue: any): any {
  if (key === 'bbt-data-v4') {
    return createPersistedStoreSyncValue(previousValue, nextValue)
  }
  if (!Array.isArray(previousValue) || !Array.isArray(nextValue)) return nextValue
  return createArraySyncValue(previousValue, nextValue)
}

export function combineStorageSyncValues(key: string, previousPatch: any, nextPatch: any): any {
  if (key === 'bbt-data-v4') {
    return combinePersistedStoreSyncValues(previousPatch, nextPatch)
  }
  if (!Array.isArray(previousPatch) || !Array.isArray(nextPatch)) return nextPatch
  return combineArraySyncValues(previousPatch, nextPatch)
}

function createPersistedStoreSyncValue(previousValue: any, nextValue: any): any {
  const previousState = persistedState(previousValue)
  const nextState = persistedState(nextValue)
  if (!isPlainObject(nextState)) return nextValue

  const state = { ...nextState }
  for (const arrayKey of STATE_ARRAY_KEYS) {
    const previousItems = Array.isArray(previousState?.[arrayKey]) ? previousState[arrayKey] : []
    const nextItems = Array.isArray(nextState[arrayKey]) ? nextState[arrayKey] : []
    state[arrayKey] = createArraySyncValue(previousItems, nextItems)
  }
  return nextValue?.state ? { ...nextValue, state } : state
}

function combinePersistedStoreSyncValues(previousPatch: any, nextPatch: any): any {
  const previousState = persistedState(previousPatch)
  const nextState = persistedState(nextPatch)
  if (!isPlainObject(nextState)) return nextPatch

  const state = { ...nextState }
  for (const arrayKey of STATE_ARRAY_KEYS) {
    const previousItems = Array.isArray(previousState?.[arrayKey]) ? previousState[arrayKey] : []
    const nextItems = Array.isArray(nextState[arrayKey]) ? nextState[arrayKey] : []
    state[arrayKey] = combineArraySyncValues(previousItems, nextItems)
  }
  return nextPatch?.state ? { ...nextPatch, state } : state
}

function createArraySyncValue(previousItems: any[], nextItems: any[]): any[] {
  const nextKeys = new Set(
    nextItems.map(storageRecordKey).filter(Boolean),
  )
  const markers = previousItems
    .map(storageRecordKey)
    .filter((recordKey) => recordKey && !nextKeys.has(recordKey))
    .map(createDeleteRecordMarker)
  return [...nextItems, ...markers]
}

function combineArraySyncValues(previousPatch: any[], nextPatch: any[]): any[] {
  const nextItems = nextPatch.filter((item) => !getDeleteRecordKey(item))
  const nextKeys = new Set(nextItems.map(storageRecordKey).filter(Boolean))
  const markerKeys = new Set<string>()

  for (const item of [...previousPatch, ...nextPatch]) {
    const deletedKey = getDeleteRecordKey(item)
    if (deletedKey && !nextKeys.has(deletedKey)) markerKeys.add(deletedKey)
  }

  return [...nextItems, ...Array.from(markerKeys, createDeleteRecordMarker)]
}

function persistedState(value: any): any {
  return value?.state && isPlainObject(value.state) ? value.state : value
}

function createDeleteRecordMarker(recordKey: string): DeleteRecordMarker {
  return { [DELETE_RECORD_KEY]: recordKey }
}

function getDeleteRecordKey(item: any): string {
  if (!isPlainObject(item)) return ''
  return clean(item[DELETE_RECORD_KEY])
}

function normalizeMergedArray(key: string, items: any[]): any[] {
  if (key === 'bbt-travel-desk-v11') {
    return [...items]
      .sort((left, right) => recordTime(right) - recordTime(left))
      .slice(0, 30)
  }
  if (key === 'bbt-alertas-resolvidos') return items.slice(-5_000)
  return items
}

function chooseNewest(a: any, b: any): any {
  if (!isPlainObject(a) || !isPlainObject(b)) return b

  const aTime = recordTime(a)
  const bTime = recordTime(b)
  if (bTime > aTime) return { ...a, ...b }
  if (aTime > bTime) return { ...b, ...a }
  return { ...a, ...b }
}

function recordTime(item: any): number {
  if (!item || typeof item !== 'object') return 0
  for (const field of ['updated_at', 'imported_at', 'created_at', 'timestamp', 'data_atendimento']) {
    const value = item[field]
    if (!value) continue
    const parsed = Date.parse(String(value))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function clean(value: any): string {
  return String(value ?? '').trim()
}

function onlyDigits(value: any): string {
  return clean(value).replace(/\D/g, '')
}

function isPlainObject(value: any): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: any): string {
  try {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    if (!isPlainObject(value)) return JSON.stringify(value) ?? ''
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    return `{${entries.join(',')}}`
  } catch {
    return ''
  }
}
