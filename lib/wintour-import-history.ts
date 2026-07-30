import type { WintourSourceFormat } from '@/lib/wintour-import'

export interface WintourImportHistoryRow {
  id: string
  requested_by: string | null
  requested_by_name: string | null
  source: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  total_rows: number
  processed_rows: number
  failed_rows: number
  summary: Record<string, unknown>
  created_at: string | Date
  finished_at: string | Date | null
}

export interface WintourImportRun {
  id: string
  job_ids?: string[]
  status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
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

const SOURCE_FORMATS = new Set<WintourSourceFormat>(['xml', 'xlsx', 'csv', 'pdf'])

export function aggregateWintourImportHistory(
  rows: readonly WintourImportHistoryRow[],
): WintourImportRun[] {
  const grouped = new Map<string, WintourImportRun>()

  for (const row of rows) {
    const summary = recordValue(row.summary)
    const metadata = recordValue(summary.metadata)
    const batchKey = optionalString(metadata.batchKey) || row.id
    const rawSourceFormat = String(metadata.sourceFormat || '')
    const sourceFormat = SOURCE_FORMATS.has(rawSourceFormat as WintourSourceFormat)
      ? rawSourceFormat as WintourSourceFormat
      : 'xlsx'
    const current = grouped.get(batchKey)
    const importedAt = isoDate(row.finished_at || row.created_at)
    const nextStatus = mergeStatus(current?.status, row.status)
    const declaredTotalRecords = nonNegativeNumber(metadata.totalRecords)
    const failureCount = Math.max(
      nonNegativeNumber(row.failed_rows) ?? 0,
      Array.isArray(summary.failures) ? summary.failures.length : 0,
    )

    if (!current) {
      grouped.set(batchKey, {
        id: batchKey,
        job_ids: [row.id],
        status: nextStatus,
        file_name: String(metadata.fileName || `Importacao ${row.source}`).slice(0, 255),
        source_format: sourceFormat,
        imported_at: importedAt,
        imported_by_user_id: row.requested_by || '',
        imported_by_user_name: row.requested_by_name || 'Usuario removido',
        periodo_inicio: optionalString(metadata.periodStart),
        periodo_fim: optionalString(metadata.periodEnd),
        total_records: declaredTotalRecords ?? nonNegativeNumber(row.total_rows) ?? 0,
        total_value: finiteNumber(metadata.totalValue),
        total_cost: finiteNumber(metadata.totalCost),
        total_markup: finiteNumber(metadata.totalMarkup),
        created: nonNegativeNumber(summary.inserted) ?? 0,
        updated: nonNegativeNumber(summary.updated) ?? 0,
        ignored: nonNegativeNumber(summary.skipped) ?? 0,
        errors: failureCount,
        fingerprints: [],
      })
      continue
    }

    current.job_ids = [...(current.job_ids || []), row.id]
    current.status = nextStatus
    if (importedAt > current.imported_at) current.imported_at = importedAt
    current.created += nonNegativeNumber(summary.inserted) ?? 0
    current.updated += nonNegativeNumber(summary.updated) ?? 0
    current.ignored += nonNegativeNumber(summary.skipped) ?? 0
    current.errors += failureCount
    if (declaredTotalRecords === undefined) {
      current.total_records += nonNegativeNumber(row.total_rows) ?? 0
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.imported_at.localeCompare(left.imported_at))
}

function mergeStatus(
  current: WintourImportRun['status'],
  incoming: WintourImportHistoryRow['status'],
): NonNullable<WintourImportRun['status']> {
  const statuses = new Set([current, incoming])
  if (statuses.has('failed')) return 'failed'
  if (statuses.has('processing')) return 'processing'
  if (statuses.has('queued')) return 'queued'
  if (statuses.has('cancelled')) return 'cancelled'
  return 'completed'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function optionalString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}

function isoDate(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}
