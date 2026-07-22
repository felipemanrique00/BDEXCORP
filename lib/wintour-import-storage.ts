import type { WintourSourceFormat } from '@/lib/wintour-import'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

export interface WintourImportRun {
  id: string
  file_name: string
  source_format: WintourSourceFormat
  imported_at: string
  imported_by_user_id: string
  imported_by_user_name: string
  periodo_inicio?: string
  periodo_fim?: string
  total_records: number
  total_value: number
  total_cost: number
  total_markup: number
  created: number
  updated: number
  ignored: number
  errors: number
  fingerprints: string[]
}

const STORAGE_KEY = 'bbt-wintour-imports-v1'

function loadRuns(): WintourImportRun[] {
  if (typeof window === 'undefined') return []
  const parsed = loadJSON<WintourImportRun[]>(STORAGE_KEY, [])
  return Array.isArray(parsed) ? parsed : []
}

function saveRuns(runs: WintourImportRun[]): boolean {
  if (typeof window === 'undefined') return false
  return safeSetJSON(STORAGE_KEY, runs.slice(0, 60).map((run) => ({
    ...run,
    fingerprints: run.fingerprints.slice(0, 500),
  })))
}

export function getAllWintourImportRuns(): WintourImportRun[] {
  return loadRuns().sort((a, b) => b.imported_at.localeCompare(a.imported_at))
}

export function getUltimaImportacaoWintour(): WintourImportRun | undefined {
  return getAllWintourImportRuns()[0]
}

export function addWintourImportRun(run: Omit<WintourImportRun, 'id' | 'imported_at'>): WintourImportRun | null {
  const novo: WintourImportRun = {
    ...run,
    id: createEntityId('wintour'),
    imported_at: new Date().toISOString(),
  }
  const runs = getAllWintourImportRuns()
  runs.unshift(novo)
  return saveRuns(runs) ? novo : null
}
