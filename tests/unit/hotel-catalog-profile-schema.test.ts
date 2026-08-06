import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createHotelCatalogSchema } from '@/lib/hotel-catalog/schema'

const COUNTRY_ID = '10000000-0000-4000-8000-000000000001'
const SUBDIVISION_ID = '10000000-0000-4000-8000-000000000002'
const CITY_ID = '10000000-0000-4000-8000-000000000003'
const SUPPLIER_ID = '10000000-0000-4000-8000-000000000004'
const serviceSource = readFileSync(resolve(process.cwd(), 'lib/server/hotel-catalog-service.ts'), 'utf8')
const catalogPageSource = readFileSync(resolve(process.cwd(), 'app/dashboard/hoteis/catalogo/page.tsx'), 'utf8')

describe('hotel catalog profile schema', () => {
  it('accepts the commercial profile and a valid active room type', () => {
    const result = createHotelCatalogSchema.parse(validHotelInput())

    expect(result).toMatchObject({
      chainName: 'Rede Atlântica',
      brandName: 'Comfort',
      starRating: 4,
      supplierIds: [SUPPLIER_ID],
    })
    expect(result.roomTypes).toEqual([
      expect.objectContaining({
        code: 'DBL-STD',
        name: 'Double Standard',
        occupancyType: 'double',
        maxGuests: 2,
        maxAdults: 2,
        maxChildren: 0,
      }),
    ])
  })

  it.each([0, 6, 3.5])('rejects invalid star rating %s', (starRating) => {
    const result = createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      starRating,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['starRating'] }),
      ]))
    }
  })

  it('requires at least one room type when an active hotel is linked to a supplier', () => {
    const result = createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      roomTypes: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['roomTypes'],
          message: 'Hotel ativo vinculado a fornecedor deve possuir ao menos um tipo de quarto.',
        }),
      ]))
    }
  })

  it('allows an unlinked active hotel or an inactive linked hotel without room types', () => {
    expect(createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      supplierIds: [],
      roomTypes: [],
    }).success).toBe(true)

    expect(createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      status: 'inactive',
      roomTypes: [],
    }).success).toBe(true)
  })

  it('rejects duplicate room codes without case sensitivity', () => {
    const room = validHotelInput().roomTypes[0]
    const result = createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      roomTypes: [room, { ...room, code: room.code.toLocaleLowerCase('en-US') }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['roomTypes', 1, 'code'],
          message: 'Os codigos de quarto devem ser unicos no hotel.',
        }),
      ]))
    }
  })

  it('rejects room capacity incompatible with its occupancy', () => {
    const room = validHotelInput().roomTypes[0]
    const result = createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      roomTypes: [{
        ...room,
        occupancyType: 'triple',
        maxGuests: 2,
        maxAdults: 2,
      }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['roomTypes', 0, 'maxGuests'] }),
      ]))
    }
  })

  it('enforces the exact capacity of a single room', () => {
    const room = validHotelInput().roomTypes[0]
    const result = createHotelCatalogSchema.safeParse({
      ...validHotelInput(),
      roomTypes: [{
        ...room,
        occupancyType: 'single',
        maxGuests: 2,
        maxAdults: 1,
        maxChildren: 1,
      }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['roomTypes', 0, 'occupancyType'] }),
      ]))
    }
  })

  it('persists and maps the hotel commercial profile fields', () => {
    expect(serviceSource).toContain('chain_name, brand_name, star_rating')
    expect(serviceSource).toContain('chain_name = $19, brand_name = $20, star_rating = $21')
    expect(serviceSource).toContain('chainName: row.chain_name')
    expect(serviceSource).toContain('brandName: row.brand_name')
    expect(serviceSource).toContain('starRating: row.star_rating')
  })

  it('exposes an editable and removable room type collection in the catalog UI', () => {
    expect(catalogPageSource).toContain('Adicionar tipo de quarto')
    expect(catalogPageSource).toContain('Remover tipo de quarto')
    expect(catalogPageSource).toContain('Tipos de quarto cadastrados para o hotel')
    expect(catalogPageSource).toContain('HOTEL_ROOM_CATEGORIES.map')
    expect(catalogPageSource).toContain('Categoria do quarto')
    expect(catalogPageSource).toContain('Hospedes')
    expect(catalogPageSource).toContain('Rede')
    expect(catalogPageSource).toContain('Bandeira')
    expect(catalogPageSource).toContain('Classificacao')
  })
})

function validHotelInput() {
  return {
    name: 'Hotel Exemplo Paulista',
    countryId: COUNTRY_ID,
    subdivisionId: SUBDIVISION_ID,
    cityId: CITY_ID,
    chainName: 'Rede Atlântica',
    brandName: 'Comfort',
    starRating: 4,
    billingEnabled: true,
    billingInfo: 'Faturado em 30 dias.',
    amenities: { breakfast: true },
    status: 'active' as const,
    supplierIds: [SUPPLIER_ID],
    roomTypes: [{
      code: 'DBL-STD',
      name: 'Double Standard',
      occupancyType: 'double' as const,
      maxGuests: 2,
      maxAdults: 2,
      maxChildren: 0,
      bedConfiguration: '1 cama de casal',
    }],
  }
}
