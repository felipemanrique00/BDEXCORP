import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/commercial-supplier-service.ts'),
  'utf8',
)
const itemRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/commercial-suppliers/[id]/route.ts'),
  'utf8',
)
const listRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/commercial-suppliers/route.ts'),
  'utf8',
)

describe('commercial supplier offline service contract', () => {
  it('persiste e devolve endereco estruturado e sistema de reserva', () => {
    expect(service).toContain('reservation_system')
    expect(service).toContain('insert into postal_addresses')
    expect(service).toContain('update postal_addresses set')
    expect(service).toContain('address.city_id = $')
    expect(service).toContain('address.id as resolved_address_id')
    expect(service).toContain('country.iso_alpha2::text as address_country_code')
    expect(service).toContain('subdivision.code::text as address_subdivision_code')
    expect(service).toContain('city.name as address_city_name')
  })

  it('devolve todos os contatos ativos com fax e preserva-os quando omitidos', () => {
    expect(service).toContain("'fax', contact.fax")
    expect(service).toContain('contact.fax || null')
    expect(service).toContain('input.contacts !== undefined')
    expect(service).toContain('contact.supplier_id = supplier.id')
    expect(service).toContain('contact.is_active')
  })

  it('oferece leitura administrativa individual', () => {
    expect(itemRoute).toContain('export async function GET')
    expect(itemRoute).toContain('getCommercialSupplier')
    expect(itemRoute).toContain("permission: 'cadastrar_hoteis'")
    expect(listRoute).toContain('export async function GET')
    expect(listRoute).toContain("permission: 'cadastrar_hoteis'")
  })
})
