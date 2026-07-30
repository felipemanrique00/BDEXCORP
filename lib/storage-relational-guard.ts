import { storageRecordKey } from '@/lib/storage-merge'

const DELETE_RECORD_KEY = '__bbt_deleted_record_key'

export interface DemandStorageRolloutGuard {
  status: 'active' | 'paused'
  writeMode: 'legacy' | 'dual' | 'relational'
  pilotCompanyIds: string[]
}

export function filterRelationalDemandStorageWrites(
  currentValue: unknown,
  incomingValue: unknown,
  rollout: DemandStorageRolloutGuard,
): unknown {
  if (
    rollout.status !== 'active'
    || rollout.writeMode !== 'relational'
    || !Array.isArray(incomingValue)
  ) {
    return incomingValue
  }

  const currentItems = Array.isArray(currentValue) ? currentValue : []
  const currentByKey = new Map(
    currentItems
      .map((item) => [storageRecordKey(item), item] as const)
      .filter(([key]) => Boolean(key)),
  )

  return incomingValue.filter((item) => {
    if (!isRecord(item)) return false
    const deletedKey = clean(item[DELETE_RECORD_KEY])
    if (deletedKey) {
      const current = currentByKey.get(deletedKey)
      return current ? !isProtectedDemand(current, rollout) : false
    }

    const current = currentByKey.get(storageRecordKey(item))
    return !isProtectedDemand(item, rollout)
      && (!current || !isProtectedDemand(current, rollout))
  })
}

function isProtectedDemand(
  value: unknown,
  rollout: DemandStorageRolloutGuard,
): boolean {
  if (!isRecord(value)) return true
  const companyId = clean(value.empresa_id || value.company_id)
  if (!companyId) return true
  return rollout.pilotCompanyIds.length === 0 || rollout.pilotCompanyIds.includes(companyId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
