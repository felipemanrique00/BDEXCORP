import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  enrichVoucherWithProjection,
  enrichVouchersFromDatabase,
  maskGuestDocument,
  type VoucherEnrichmentProjection,
} from '@/lib/server/voucher-enrichment-service'
import type { VoucherEmitido } from '@/types'

function baseVoucher(overrides: Partial<VoucherEmitido> = {}): VoucherEmitido {
  return {
    id: 'H-26264',
    numero: '26264',
    tipo: 'Hotel',
    status: 'emitido',
    atendimento_id: 'demand-01',
    empresa_id: 'company-01',
    funcionario_id: 'employee-01',
    passageiro_nome: 'Hospede legado',
    cpf: '12345678901',
    fornecedor_nome: 'Fornecedor legado',
    tarifa_total: 400,
    taxas: 30,
    total: 430,
    emitido_por_user_id: 'issuer-01',
    emitido_por_user_name: 'Consultor BBT',
    created_at: '2026-08-04T18:00:00.000Z',
    ...overrides,
  }
}

describe('voucher enrichment service', () => {
  it('projects the approved hotel and final reservation without conflating the operational supplier', () => {
    const projection: VoucherEnrichmentProjection = {
      reservation: {
        id: 'reservation-01',
        createdAt: '2026-08-04T17:00:00.000Z',
        startAt: '2026-09-03T14:00:00-03:00',
        endAt: '2026-09-05T12:00:00-03:00',
        grossAmount: '405.00',
        taxAmount: '30.00',
        finalAmount: '435.00',
        currency: 'BRL',
        metadata: {
          supplierName: 'Operadora que efetivou a reserva',
          supplierCode: 'OPER-001',
          externalReference: 'LOC-13728',
          channel: 'email',
          details: {
            itemName: 'Nome digitado que nao deve vencer o snapshot',
            destination: 'Destino digitado',
          },
        },
      },
      demand: {
        number: 'OS-20260804-0004',
        createdAt: '2026-08-04T13:00:00.000Z',
        costCenter: '1001',
      },
      company: {
        name: 'Empresa Brasil - Teste CC',
        documentNumber: '12.345.678/0001-00',
      },
      employee: {
        department: 'Financeiro',
        businessUnit: 'Matriz',
      },
      requester: {
        name: 'Solicitante Teste',
        email: 'SOLICITANTE@EXAMPLE.COM',
      },
      emission: {
        issuedAt: '2026-08-04T18:30:00.000Z',
        metadata: {
          payment: { method: 'faturado', reference: 'FAT-30-DIAS' },
        },
      },
      selectionSnapshot: {
        demand: { cityName: 'Ribeirao Preto/SP' },
        option: {
          refundable: false,
          hotel: {
            name: 'Hotel Homologacao Ribeirao 02',
            address: 'Av. Teste, 123',
            phone: '(16) 3000-4000',
            email: 'reservas@hotel.example',
            category: 'Standard',
            roomCategory: 'Single',
            mealPlan: 'Cafe da Manha',
            cancellationDeadline: '2026-09-01T15:00:00-03:00',
            cancellationPolicy: 'Nao reembolsavel apos o prazo.',
            noShowPolicy: 'Uma diaria em caso de no-show.',
            paymentTerms: 'Faturado na agencia em 30 dias.',
          },
          breakdown: {
            nights: 2,
            roomCount: 1,
            nightlyRate: 200,
            nightlyTaxes: 15,
            roomSubtotal: 400,
            taxesSubtotal: 30,
            serviceFee: 5,
            total: 435,
            currency: 'BRL',
          },
        },
      },
      guests: [
        {
          name: 'Alexandre Paiva Bezerra',
          role: 'responsible',
          primary: true,
          code: '13728',
          document: '843.828.561-91',
          email: 'ALEXANDRE@EXAMPLE.COM',
          phone: '(62) 99999-0000',
          roomNumber: 1,
        },
        {
          name: 'Eduardo da Mata',
          role: 'companion',
          primary: false,
          document: '12345678900',
          roomNumber: 1,
        },
      ],
      rooms: [
        { number: 1, occupancyCode: 'single', guests: ['Alexandre Paiva Bezerra', 'Eduardo da Mata'] },
      ],
      approvals: [
        { name: 'Aprovadora Fluxo Local', decidedAt: '2026-08-04T17:30:00.000Z' },
        { name: 'Aprovadora Fluxo Local', decidedAt: '2026-08-04T17:31:00.000Z' },
      ],
    }

    const voucher = enrichVoucherWithProjection(baseVoucher(), projection)

    expect(voucher).toMatchObject({
      empresa_nome: 'Empresa Brasil - Teste CC',
      empresa_documento: '12.345.678/0001-00',
      unidade_negocio: 'Matriz',
      departamento: 'Financeiro',
      solicitante_nome: 'Solicitante Teste',
      solicitante_email: 'solicitante@example.com',
      autorizadores: ['Aprovadora Fluxo Local'],
      autorizado_em: '2026-08-04T17:31:00.000Z',
      numero_solicitacao: 'OS-20260804-0004',
      centro_custo: '1001',
      reserva_id: 'reservation-01',
      fornecedor_nome: 'Operadora que efetivou a reserva',
      fornecedor_codigo: 'OPER-001',
      canal_reserva: 'email',
      localizador: 'LOC-13728',
      numero_confirmacao: 'LOC-13728',
      hotel_nome: 'Hotel Homologacao Ribeirao 02',
      hotel_endereco: 'Av. Teste, 123',
      hotel_cidade: 'Ribeirao Preto/SP',
      hotel_telefone: '(16) 3000-4000',
      hotel_email: 'reservas@hotel.example',
      hotel_categoria: 'Standard',
      tipo_apartamento: 'Single',
      regime: 'Cafe da Manha',
      checkin_em: '2026-09-03T17:00:00.000Z',
      checkout_em: '2026-09-05T15:00:00.000Z',
      data_checkin: '2026-09-03',
      data_checkout: '2026-09-05',
      noites: 2,
      num_apartamentos: 1,
      num_hospedes: 2,
      valor_diaria: 200,
      taxas_diaria: 15,
      taxa_servico: 5,
      tarifa_total: 400,
      taxas: 30,
      total: 435,
      moeda: 'BRL',
      forma_pagamento_voucher: 'Faturado',
      referencia_pagamento: 'FAT-30-DIAS',
      condicoes_pagamento: 'Faturado na agencia em 30 dias.',
      prazo_cancelamento: '2026-09-01T15:00:00-03:00',
      politica_cancelamento: 'Nao reembolsavel apos o prazo.',
      politica_no_show: 'Uma diaria em caso de no-show.',
      reembolsavel: false,
      passageiro_nome: 'Alexandre Paiva Bezerra',
      passageiros: ['Alexandre Paiva Bezerra', 'Eduardo da Mata'],
      cpf: '***.***.***-91',
    })
    expect(voucher.hospedes_detalhes).toEqual([
      expect.objectContaining({
        nome: 'Alexandre Paiva Bezerra',
        papel: 'Responsável',
        principal: true,
        codigo: '13728',
        documento: '***.***.***-91',
        email: 'alexandre@example.com',
        quarto: 1,
      }),
      expect.objectContaining({
        nome: 'Eduardo da Mata',
        papel: 'Acompanhante',
        documento: '***.***.***-00',
        quarto: 1,
      }),
    ])
    expect(voucher.quartos).toEqual([{
      numero: 1,
      acomodacao: 'Single',
      categoria: 'Standard',
      regime: 'Cafe da Manha',
      hospedes: ['Alexandre Paiva Bezerra', 'Eduardo da Mata'],
    }])
  })

  it('keeps valid legacy data when relational sources are absent and never exposes a raw document', () => {
    const base = baseVoucher({
      hotel_nome: 'Hotel legado',
      localizador: 'LOC-LEGADO',
      cpf: '12345678901',
    })

    const voucher = enrichVoucherWithProjection(base, {
      reservation: { metadata: {} },
      guests: [{ name: 'Hospede sem documento' }],
    })

    expect(voucher.hotel_nome).toBe('Hotel legado')
    expect(voucher.localizador).toBe('LOC-LEGADO')
    expect(voucher.cpf).toBe('***.***.***-01')
    expect(voucher.hospedes_detalhes).toEqual([{ nome: 'Hospede sem documento' }])
    expect(voucher).not.toHaveProperty('hotel_endereco')
    expect(voucher).not.toHaveProperty('politica_cancelamento')
  })

  it('loads the batch with one query and returns vouchers in the original order', async () => {
    const first = baseVoucher({ id: 'H-1', numero: '1' })
    const second = baseVoucher({ id: 'H-2', numero: '2' })
    const query = vi.fn().mockResolvedValue({
      rows: [{
        voucher_id: 'H-2',
        reservation_id: 'reservation-02',
        reservation_created_at: '2026-08-04T10:00:00.000Z',
        reservation_start_at: '2026-09-10T14:00:00.000Z',
        reservation_end_at: '2026-09-12T12:00:00.000Z',
        reservation_gross_amount: '500.00',
        reservation_tax_amount: '20.00',
        reservation_final_amount: '520.00',
        reservation_currency: 'BRL',
        reservation_metadata: {
          supplierName: 'Fornecedor relacional',
          externalReference: 'LOC-2',
        },
        demand_number: 'OS-2',
        demand_created_at: '2026-08-03T10:00:00.000Z',
        demand_cost_center: 'CC-2',
        company_name: 'Empresa 2',
        company_document_number: null,
        employee_department: null,
        employee_business_unit: null,
        requester_name: null,
        requester_email: null,
        emission_issued_at: null,
        emission_metadata: {},
        selection_snapshot: {},
        guests: [],
        rooms: [],
        approvals: [],
        authorized_at: null,
      }],
    })
    const client = { query } as unknown as PoolClient

    const enriched = await enrichVouchersFromDatabase(client, 'tenant-01', [first, second])

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[1]).toEqual(['tenant-01', ['H-1', 'H-2']])
    expect(String(query.mock.calls[0]?.[0])).toContain("nullif(traveler.document_number_snapshot, '')")
    expect(String(query.mock.calls[0]?.[0])).toContain('traveler_employee.company_id = traveler.company_id')
    expect(enriched.map((voucher) => voucher.id)).toEqual(['H-1', 'H-2'])
    expect(enriched[0]).toEqual(first)
    expect(enriched[0]).not.toBe(first)
    expect(enriched[1]).toMatchObject({
      reserva_id: 'reservation-02',
      numero_solicitacao: 'OS-2',
      centro_custo: 'CC-2',
      empresa_nome: 'Empresa 2',
      fornecedor_nome: 'Fornecedor relacional',
      localizador: 'LOC-2',
      tarifa_total: 500,
      taxas: 20,
      total: 520,
      moeda: 'BRL',
    })
  })

  it('masks CPF and generic documents deterministically', () => {
    expect(maskGuestDocument('843.828.561-91')).toBe('***.***.***-91')
    expect(maskGuestDocument('AB-12345678')).toBe('****5678')
    expect(maskGuestDocument('123')).toBe('***')
    expect(maskGuestDocument('***.***.***-91')).toBe('***.***.***-91')
    expect(maskGuestDocument('')).toBeUndefined()
  })
})
