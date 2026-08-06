import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0067_demand_operational_status_projection.sql'),
  'utf8',
)

describe('demand operational status projection migration', () => {
  it('repairs the legacy status from the lifecycle source of truth', () => {
    expect(migration).toMatch(/lifecycle_status in \('draft', 'submitted'\) then 'pendente'/i)
    expect(migration).toMatch(/'pending_choice'[\s\S]*then 'aguardando_cliente'/i)
    expect(migration).toMatch(/'issued', 'refunded', 'closed'[\s\S]*then 'finalizado'/i)
    expect(migration).toMatch(/'rejected', 'canceled', 'expired'[\s\S]*then 'cancelado'/i)
    expect(migration).toMatch(/else 'em_andamento'/i)
  })

  it('keeps the compatibility snapshot and concurrency version consistent', () => {
    expect(migration).toContain("metadata -> 'legacySnapshot'")
    expect(migration).toContain("jsonb_build_object('status', projected.projected_status)")
    expect(migration).toContain('version = demand.version + 1')
    expect(migration).toContain("'operational_status_reconciled'")
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })
})
