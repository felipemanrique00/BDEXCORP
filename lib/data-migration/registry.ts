import registryJson from '@/config/storage-domain-registry.json'
import { SHARED_STORAGE_KEYS, type SharedStorageKey } from '@/lib/storage-keys'

export type StorageDataClassification =
  | 'critical'
  | 'operational'
  | 'transient'
  | 'preference'
  | 'cache'
  | 'legacy'

export type StorageMigrationState = 'legacy' | 'shadow' | 'relational'

export interface StorageDomainRegistryEntry {
  key: SharedStorageKey
  domain: string
  classification: StorageDataClassification
  target: string
  migrationState: StorageMigrationState
  priority: number
}

const entries = registryJson as StorageDomainRegistryEntry[]

export const STORAGE_DOMAIN_REGISTRY: readonly StorageDomainRegistryEntry[] = entries

export function storageDomainEntry(key: SharedStorageKey): StorageDomainRegistryEntry {
  const entry = entries.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`Chave de storage sem classificacao: ${key}`)
  return entry
}

export function validateStorageDomainRegistry(): string[] {
  const errors: string[] = []
  const knownKeys = new Set<string>(SHARED_STORAGE_KEYS)
  const seen = new Set<string>()

  entries.forEach((entry, index) => {
    if (!knownKeys.has(entry.key)) errors.push(`Entrada ${index} referencia chave desconhecida: ${entry.key}`)
    if (seen.has(entry.key)) errors.push(`Chave duplicada no registro: ${entry.key}`)
    seen.add(entry.key)
    if (!entry.domain.trim()) errors.push(`Dominio vazio para ${entry.key}`)
    if (!entry.target.trim()) errors.push(`Destino vazio para ${entry.key}`)
    if (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 10) {
      errors.push(`Prioridade invalida para ${entry.key}`)
    }
  })

  SHARED_STORAGE_KEYS.forEach((key) => {
    if (!seen.has(key)) errors.push(`Chave compartilhada sem classificacao: ${key}`)
  })
  return errors
}
