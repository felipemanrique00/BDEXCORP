import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const service = source('lib/server/hotel-supplier-rate-service.ts')
const linksRoute = source('app/api/commercial-suppliers/[id]/hotel-links/route.ts')
const linkRoute = source('app/api/commercial-suppliers/[id]/hotel-links/[linkId]/route.ts')
const ratesRoute = source('app/api/commercial-suppliers/[id]/hotel-links/[linkId]/rates/route.ts')
const rateRoute = source('app/api/commercial-suppliers/[id]/hotel-links/[linkId]/rates/[rateId]/route.ts')
const client = source('lib/hotel-supplier-rates/client.ts')

describe('hotel supplier rate administrative API contract', () => {
  it('protects every endpoint with the hotel administration permission and internal roles', () => {
    for (const route of [linksRoute, linkRoute, ratesRoute, rateRoute]) {
      expect(route).toContain("permission: 'cadastrar_hoteis'")
      expect(route).toContain("'tenant_admin'")
      expect(route).toContain("'supervisor'")
      expect(route).toContain("'agent'")
      expect(route).toContain("'operator'")
    }
  })

  it('keeps all mutations tenant-scoped, versioned and non-destructive', () => {
    expect(service).toContain('withTenantTransaction(principal.tenantId')
    expect(service).toContain('version = version + 1')
    expect(service).toContain('and version = $16')
    expect(service).toContain('and hotel_id = $4 and version = $5')
    expect(service).toContain('is_suspended = $16')
    expect(service).not.toMatch(/delete\s+from\s+hotel_supplier_rates/i)
    expect(service).not.toMatch(/delete\s+from\s+hotel_suppliers/i)
  })

  it('validates hotel, room and company/group scope in the authenticated tenant', () => {
    expect(service).toContain("service_types @> array['hotel']::text[]")
    expect(service).toContain('from hotel_room_types')
    expect(service).toContain('from companies')
    expect(service).toContain('from business_groups')
    expect(service).toContain("target.type === 'company' ? target.id : null")
    expect(service).toContain("target.type === 'group' ? target.id : null")
  })

  it('uses an idempotent hotel/supplier business key and audits actual creates and updates', () => {
    expect(service).toContain('on conflict (tenant_id, hotel_id, supplier_id) do nothing')
    expect(service).toContain("action: 'hotel_supplier.link.created'")
    expect(service).toContain("action: 'hotel_supplier.link.updated'")
    expect(service).toContain("action: 'hotel_supplier.rate.created'")
    expect(service).toContain("action: 'hotel_supplier.rate.updated'")
  })

  it('exposes the complete REST paths through the typed client', () => {
    expect(client).toContain('/api/commercial-suppliers/${encodeURIComponent(supplierId)}/hotel-links')
    expect(client).toContain('/${encodeURIComponent(linkId)}/rates')
    expect(client).toContain('/${encodeURIComponent(rateId)}')
    expect(client).toContain('replayed: payload.replayed === true')
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
