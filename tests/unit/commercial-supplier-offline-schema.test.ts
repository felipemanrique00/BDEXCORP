import { describe, expect, it } from 'vitest'

import {
  commercialSupplierQuerySchema,
  createCommercialSupplierSchema,
  updateCommercialSupplierSchema,
} from '@/lib/commercial-suppliers/schema'

const BASE_SUPPLIER = {
  internalCode: 'HOTEL-DEMO',
  legalName: 'Hotel Demo Ltda',
  documentType: 'cnpj' as const,
  documentNumber: '12.345.678/0001-90',
  serviceTypes: ['hotel'] as const,
}

describe('commercial supplier offline schema', () => {
  it('aplica sistema manual e colecoes vazias por padrao', () => {
    const result = createCommercialSupplierSchema.parse(BASE_SUPPLIER)

    expect(result.reservationSystem).toBe('manual')
    expect(result.contacts).toEqual([])
    expect(result.paymentTerms).toEqual({})
  })

  it('aceita endereco estruturado, coordenadas e fax complementar', () => {
    const result = createCommercialSupplierSchema.parse({
      ...BASE_SUPPLIER,
      reservationSystem: 'email',
      address: {
        countryId: '00000000-0000-4000-8000-000000000001',
        subdivisionId: '00000000-0000-4000-8000-000000000002',
        cityId: '00000000-0000-4000-8000-000000000003',
        postalCode: '74000-000',
        street: 'Rua de Teste',
        streetNumber: '100',
        latitude: -16.6869,
        longitude: -49.2648,
      },
      contacts: [{
        type: 'reservation',
        email: 'reservas@example.test',
        fax: '55 62 3000-0001',
        isPrimary: true,
      }],
    })

    expect(result.reservationSystem).toBe('email')
    expect(result.address?.cityId).toBe('00000000-0000-4000-8000-000000000003')
    expect(result.contacts[0]?.fax).toBe('55 62 3000-0001')
  })

  it('rejeita localidade hierarquica sem pais e sistema desconhecido', () => {
    expect(createCommercialSupplierSchema.safeParse({
      ...BASE_SUPPLIER,
      address: { cityId: '00000000-0000-4000-8000-000000000003' },
    }).success).toBe(false)
    expect(createCommercialSupplierSchema.safeParse({
      ...BASE_SUPPLIER,
      reservationSystem: 'legacy',
    }).success).toBe(false)
  })

  it('mantem contatos opcionais no patch e valida filtros novos', () => {
    const patch = updateCommercialSupplierSchema.parse({
      expectedVersion: 3,
      reservationSystem: 'portal',
      address: null,
    })
    const query = commercialSupplierQuerySchema.parse({
      cityId: '00000000-0000-4000-8000-000000000003',
      reservationSystem: 'api',
    })

    expect(patch.contacts).toBeUndefined()
    expect(patch.address).toBeNull()
    expect(query.reservationSystem).toBe('api')
    expect(query.cityId).toBe('00000000-0000-4000-8000-000000000003')
  })
})
