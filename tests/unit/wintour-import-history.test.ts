import { describe, expect, it } from 'vitest'

import {
  aggregateWintourImportHistory,
  type WintourImportHistoryRow,
} from '@/lib/wintour-import-history'

function row(
  id: string,
  overrides: Partial<WintourImportHistoryRow> = {},
): WintourImportHistoryRow {
  return {
    id,
    requested_by: 'user-1',
    requested_by_name: 'Importador',
    source: 'wintour',
    status: 'completed',
    total_rows: 100,
    processed_rows: 100,
    failed_rows: 0,
    summary: {
      inserted: 80,
      updated: 15,
      skipped: 5,
      failures: [],
      metadata: {
        batchKey: 'wintour:batch-001',
        chunkIndex: 1,
        chunkCount: 2,
        fileName: 'emissoes.xlsx',
        sourceFormat: 'xlsx',
        totalRecords: 150,
        totalValue: 25_000,
        totalCost: 22_000,
        totalMarkup: 3_000,
      },
    },
    created_at: '2026-07-20T10:00:00.000Z',
    finished_at: '2026-07-20T10:01:00.000Z',
    ...overrides,
  }
}

describe('aggregateWintourImportHistory', () => {
  it('consolidates chunks without duplicating declared file totals', () => {
    const secondSummary = {
      inserted: 40,
      updated: 8,
      skipped: 2,
      failures: [{ row: 2 }],
      metadata: {
        batchKey: 'wintour:batch-001',
        chunkIndex: 2,
        chunkCount: 2,
        fileName: 'emissoes.xlsx',
        sourceFormat: 'xlsx',
        totalRecords: 150,
        totalValue: 25_000,
        totalCost: 22_000,
        totalMarkup: 3_000,
      },
    }

    const [run] = aggregateWintourImportHistory([
      row('job-2', {
        total_rows: 50,
        processed_rows: 49,
        failed_rows: 1,
        summary: secondSummary,
        finished_at: '2026-07-20T10:02:00.000Z',
      }),
      row('job-1'),
    ])

    expect(run).toMatchObject({
      id: 'wintour:batch-001',
      total_records: 150,
      total_value: 25_000,
      total_cost: 22_000,
      total_markup: 3_000,
      created: 120,
      updated: 23,
      ignored: 7,
      errors: 1,
      status: 'completed',
    })
    expect(run.job_ids).toEqual(['job-2', 'job-1'])
  })

  it('uses the most restrictive in-flight status and sorts recent runs first', () => {
    const older = row('older', {
      summary: { inserted: 1, metadata: { batchKey: 'wintour:older' } },
      created_at: '2026-07-18T10:00:00.000Z',
      finished_at: null,
    })
    const processing = row('processing', {
      status: 'processing',
      summary: { inserted: 1, metadata: { batchKey: 'wintour:active' } },
      created_at: '2026-07-21T10:00:00.000Z',
      finished_at: null,
    })
    const failed = row('failed', {
      status: 'failed',
      summary: { inserted: 0, metadata: { batchKey: 'wintour:active' } },
      created_at: '2026-07-21T10:01:00.000Z',
      finished_at: '2026-07-21T10:02:00.000Z',
    })

    const runs = aggregateWintourImportHistory([older, processing, failed])

    expect(runs.map((run) => run.id)).toEqual(['wintour:active', 'wintour:older'])
    expect(runs[0].status).toBe('failed')
  })

  it('falls back safely when optional metadata is absent', () => {
    const [run] = aggregateWintourImportHistory([
      row('legacy-job', {
        requested_by: null,
        requested_by_name: null,
        total_rows: 12,
        failed_rows: 2,
        summary: { inserted: 10, failures: [{}, {}, {}] },
      }),
    ])

    expect(run).toMatchObject({
      id: 'legacy-job',
      file_name: 'Importacao wintour',
      source_format: 'xlsx',
      imported_by_user_id: '',
      imported_by_user_name: 'Usuario removido',
      total_records: 12,
      created: 10,
      errors: 3,
    })
  })
})
