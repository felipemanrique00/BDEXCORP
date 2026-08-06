import { describe, expect, it } from 'vitest'

import {
  OFFLINE_TRAVEL_SERVICES,
  offlineIssueCreateSchema,
  offlineReservationCorrectionSchema,
  offlineReservationCreateSchema,
  offlineServiceMatchesDemand,
  offlineTravelServiceSchema,
  type OfflineTravelService,
} from '@/lib/offline-travel/schema'

const REQUIRED_DETAILS: Record<OfflineTravelService, Record<string, unknown>> = {
  aereo: { origin: 'GYN', destination: 'GRU', serviceNumber: 'BBT-1234' },
  hotelaria: { itemName: 'Hotel Central', destination: 'Sao Paulo' },
  locacao: { pickupLocation: 'Aeroporto GYN', returnLocation: 'Aeroporto GYN' },
  rodoviario: { origin: 'Goiania', destination: 'Brasilia' },
  ferroviario: { origin: 'Paris', destination: 'Londres' },
  transfer: { origin: 'Aeroporto GRU', destination: 'Hotel Central' },
  seguro: { policyNumber: 'AP-2026-001', coverage: 'Cobertura internacional' },
  pacotes: { itemName: 'Pacote corporativo Sao Paulo' },
  lazer: { description: 'Ingresso para evento corporativo' },
  maritimo: { itemName: 'Travessia Santos-Ilhabela' },
  outros: { description: 'Servico terrestre complementar' },
}

function reservationInput(serviceKey: OfflineTravelService) {
  return {
    demandId: 'demand-offline-1',
    companyId: 'company-1',
    expectedLifecycleVersion: 8,
    serviceKey,
    supplierName: 'Fornecedor Offline',
    supplierCode: 'SUP-001',
    externalReference: `REF-${serviceKey}`,
    channel: 'email',
    startsAt: '2026-08-10T10:00:00-03:00',
    endsAt: '2026-08-12T18:00:00-03:00',
    amounts: { gross: '1000.00', taxes: '100.00', total: '1100.00', currency: 'brl' },
    details: {
      ...REQUIRED_DETAILS[serviceKey],
      passengers: ['Ana Souza'],
      evidence: {
        receivedBy: 'email',
        attachmentIds: ['file-1', 'file-2'],
        supplierPayload: { confirmed: true, protocol: 'PROTO-001' },
      },
    },
    notes: 'Operacao registrada fora do integrador.',
    confirmed: true,
    idempotencyKey: `reserve-${serviceKey}-001`,
  }
}

function issueInput() {
  return {
    demandId: 'demand-offline-1',
    expectedLifecycleVersion: 12,
    issuedAt: '2026-08-03T14:00:00-03:00',
    supplierConfirmation: true,
    document: {
      kind: 'bilhete',
      reference: 'DOC-001',
      ticketNumber: 'TKT-001',
    },
    payment: { method: 'faturado', reference: 'FAT-001' },
    details: {
      evidenceSource: 'email',
      attachmentIds: ['file-1'],
      supplierPayload: { protocol: 'PROTO-001' },
    },
    confirmed: true,
    idempotencyKey: 'issue-offline-001',
  }
}

describe('offline travel schemas', () => {
  it('keeps the canonical catalog restricted to all eleven supported service families', () => {
    expect(OFFLINE_TRAVEL_SERVICES).toHaveLength(11)
    expect(new Set(OFFLINE_TRAVEL_SERVICES).size).toBe(11)
    for (const service of OFFLINE_TRAVEL_SERVICES) {
      expect(offlineTravelServiceSchema.parse(service)).toBe(service)
    }
    expect(offlineTravelServiceSchema.safeParse('servico-nao-cadastrado').success).toBe(false)
  })

  it.each(OFFLINE_TRAVEL_SERVICES)(
    'accepts %s with its required evidence and preserves dynamic evidence',
    (serviceKey) => {
      const parsed = offlineReservationCreateSchema.parse(reservationInput(serviceKey))

      expect(parsed.serviceKey).toBe(serviceKey)
      expect(parsed.amounts).toEqual({ gross: 1000, taxes: 100, total: 1100, currency: 'BRL' })
      expect(parsed.details.evidence).toEqual(expect.objectContaining({
        receivedBy: 'email',
        attachmentIds: ['file-1', 'file-2'],
        supplierPayload: { confirmed: true, protocol: 'PROTO-001' },
      }))
    },
  )

  it.each([
    ['aereo', { destination: 'GRU' }, 'origin'],
    ['rodoviario', { origin: 'Goiania' }, 'destination'],
    ['ferroviario', { destination: 'Londres' }, 'origin'],
    ['transfer', { origin: 'Aeroporto GRU' }, 'destination'],
    ['hotelaria', { destination: 'Sao Paulo' }, 'itemName'],
    ['hotelaria', { itemName: 'Hotel Central' }, 'destination'],
    ['locacao', { returnLocation: 'Aeroporto GYN' }, 'pickupLocation'],
    ['locacao', { pickupLocation: 'Aeroporto GYN' }, 'returnLocation'],
  ] as const)(
    'rejects %s when required evidence %s is absent',
    (serviceKey, details, missingField) => {
      const result = offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join('.') === `details.${missingField}`)).toBe(true)
      }
    },
  )

  it.each(['seguro'] as const)(
    'accepts alternative evidence and rejects %s without either alternative',
    (serviceKey) => {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details: { itemName: 'Plano executivo' },
      }).success).toBe(true)
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details: {},
      }).success).toBe(false)
    },
  )

  it.each(['pacotes', 'lazer', 'maritimo', 'outros'] as const)(
    'accepts item name or description and rejects empty evidence for %s',
    (serviceKey) => {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details: { itemName: 'Produto configuravel' },
      }).success).toBe(true)
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details: { description: 'Descricao configuravel' },
      }).success).toBe(true)
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        details: {},
      }).success).toBe(false)
    },
  )

  it('requires a demand or Serial/OS and validates chronological dates', () => {
    const withoutLink = reservationInput('aereo')
    delete (withoutLink as Partial<typeof withoutLink>).demandId
    expect(offlineReservationCreateSchema.safeParse(withoutLink).success).toBe(false)

    expect(offlineReservationCreateSchema.safeParse({
      ...withoutLink,
      serialOs: 'OS-OFFLINE-001',
    }).success).toBe(true)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('aereo'),
      startsAt: 'data-invalida',
    }).success).toBe(false)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('aereo'),
      startsAt: '2026-08-12T18:00:00-03:00',
      endsAt: '2026-08-10T10:00:00-03:00',
    }).success).toBe(false)
  })

  it('requires service dates without over-constraining leisure and other services', () => {
    for (const serviceKey of ['hotelaria', 'locacao'] as const) {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        startsAt: undefined,
      }).success).toBe(false)
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        endsAt: undefined,
      }).success).toBe(false)
    }
    for (const serviceKey of ['aereo', 'rodoviario', 'ferroviario', 'transfer', 'maritimo'] as const) {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        startsAt: undefined,
      }).success).toBe(false)
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        endsAt: undefined,
      }).success).toBe(true)
    }
    for (const serviceKey of ['seguro', 'pacotes'] as const) {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        endsAt: undefined,
      }).success).toBe(false)
    }
    for (const serviceKey of ['lazer', 'outros'] as const) {
      expect(offlineReservationCreateSchema.safeParse({
        ...reservationInput(serviceKey),
        startsAt: undefined,
        endsAt: undefined,
      }).success).toBe(true)
    }
  })

  it('matches demand service aliases without mixing independent products in one lifecycle', () => {
    expect(offlineServiceMatchesDemand('Aéreo', 'aereo')).toBe(true)
    expect(offlineServiceMatchesDemand('Hotel', 'hotelaria')).toBe(true)
    expect(offlineServiceMatchesDemand('Carro', 'locacao')).toBe(true)
    expect(offlineServiceMatchesDemand('Hotel', 'aereo')).toBe(false)
    expect(offlineServiceMatchesDemand('Pacote', 'pacotes')).toBe(true)
    expect(offlineServiceMatchesDemand('air', 'aereo')).toBe(true)
    expect(offlineServiceMatchesDemand('car', 'locacao')).toBe(true)
    expect(offlineServiceMatchesDemand('bus', 'rodoviario')).toBe(true)
    expect(offlineServiceMatchesDemand('insurance', 'seguro')).toBe(true)
    expect(offlineServiceMatchesDemand('package', 'pacotes')).toBe(true)
    expect(offlineServiceMatchesDemand('other', 'outros')).toBe(true)
    expect(offlineServiceMatchesDemand('Pacote', 'aereo')).toBe(false)
    expect(offlineServiceMatchesDemand('Multisserviço', 'maritimo')).toBe(false)
    expect(offlineServiceMatchesDemand('Aéreo + Hotel', 'hotelaria')).toBe(false)
    expect(offlineServiceMatchesDemand('Aéreo + Hotel', 'aereo')).toBe(false)
  })

  it('normalizes money and rejects negative or inconsistent amounts', () => {
    const defaults = offlineReservationCreateSchema.parse({
      ...reservationInput('hotelaria'),
      amounts: { gross: '1000.50', total: '1000.50' },
    })
    expect(defaults.amounts).toEqual({ gross: 1000.5, taxes: 0, total: 1000.5, currency: 'BRL' })

    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: -1, taxes: 0, total: 0, currency: 'BRL' },
    }).success).toBe(false)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: 100, taxes: 10, total: 110.02, currency: 'BRL' },
    }).success).toBe(false)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: 100, taxes: 10, total: 109.99, currency: 'BRL' },
    }).success).toBe(false)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: '0.10', taxes: '0.20', total: '0.30', currency: 'BRL' },
    }).success).toBe(true)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: '1.001', taxes: 0, total: 1, currency: 'BRL' },
    }).success).toBe(false)
    expect(offlineReservationCreateSchema.safeParse({
      ...reservationInput('hotelaria'),
      amounts: { gross: 100, taxes: 0, total: 100, currency: 'REAL' },
    }).success).toBe(false)
  })

  it('requires an expected reservation version and a reason for corrections', () => {
    const source = reservationInput('hotelaria')
    const correction = {
      expectedVersion: 3,
      reason: 'A taxa enviada pelo hotel estava incorreta.',
      serviceKey: source.serviceKey,
      supplierName: source.supplierName,
      supplierCode: source.supplierCode,
      externalReference: source.externalReference,
      channel: source.channel,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      amounts: source.amounts,
      details: source.details,
      notes: source.notes,
      confirmed: true,
    }

    expect(offlineReservationCorrectionSchema.parse(correction).expectedVersion).toBe(3)
    expect(offlineReservationCorrectionSchema.safeParse({ ...correction, expectedVersion: 0 }).success).toBe(false)
    expect(offlineReservationCorrectionSchema.safeParse({ ...correction, reason: 'x' }).success).toBe(false)
    expect(offlineReservationCorrectionSchema.safeParse({ ...correction, confirmed: false }).success).toBe(false)
  })

  it.each([
    ['reservation', () => reservationInput('aereo'), offlineReservationCreateSchema],
    ['issue', issueInput, offlineIssueCreateSchema],
  ] as const)('requires bounded idempotency for %s', (_name, inputFactory, schema) => {
    expect(schema.safeParse({ ...inputFactory(), idempotencyKey: '1234567' }).success).toBe(false)
    expect(schema.safeParse({ ...inputFactory(), idempotencyKey: 'x'.repeat(201) }).success).toBe(false)
    expect(schema.parse({ ...inputFactory(), idempotencyKey: '  operation-key-001  ' }).idempotencyKey)
      .toBe('operation-key-001')
  })

  it('validates issuance confirmation, document, payment, date and dynamic details', () => {
    const parsed = offlineIssueCreateSchema.parse(issueInput())
    expect(parsed).toMatchObject({
      supplierConfirmation: true,
      confirmed: true,
      partial: false,
      generateVoucher: true,
      details: {
        evidenceSource: 'email',
        attachmentIds: ['file-1'],
      },
    })

    expect(offlineIssueCreateSchema.safeParse({ ...issueInput(), issuedAt: 'data-invalida' }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({ ...issueInput(), supplierConfirmation: false }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({ ...issueInput(), confirmed: false }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({
      ...issueInput(),
      document: { kind: 'bilhete', reference: 'x' },
    }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({
      ...issueInput(),
      payment: { method: 'cheque' },
    }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({ ...issueInput(), partial: true }).success).toBe(false)
  })

  it.each([
    '4111 1111 1111 1111',
    '5500-0000-0000-0004',
    'CVV 123',
    'CVC: 1234',
    '123',
  ])('rejects sensitive card data in payment reference: %s', (reference) => {
    expect(offlineIssueCreateSchema.safeParse({
      ...issueInput(),
      payment: { method: 'cartao_corporativo', reference },
    }).success).toBe(false)
    expect(offlineIssueCreateSchema.safeParse({
      ...issueInput(),
      payment: { method: 'cartao_corporativo', reference: 'AUTORIZACAO-ABC-9876' },
    }).success).toBe(true)
  })
})
