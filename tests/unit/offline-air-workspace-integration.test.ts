import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { atendimentoToOfflineAirDemandSummary } from '@/components/travel/offline-air-demand-summary'
import type { Atendimento } from '@/types'

const consultantSource = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-air-quote-workspace.tsx'),
  'utf8',
)
const requesterSource = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-air-quote-choice-workspace.tsx'),
  'utf8',
)
const airQuoteAdapterSource = readFileSync(
  resolve(process.cwd(), 'components/travel/services/air/adapter.ts'),
  'utf8',
)
const mainWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-travel-workspace.tsx'),
  'utf8',
)
const portalSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)
const airQuoteReadModelSource = readFileSync(
  resolve(process.cwd(), 'lib/offline-travel/services/air/read-model.ts'),
  'utf8',
)
const airQuoteServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-air-quote-service.ts'),
  'utf8',
)

describe('offline air workspaces integration', () => {
  it('maps the relational/legacy demand into editable requested air segments', () => {
    const demand = {
      id: 'air-demand-1',
      serial_os: 'OS-20260806-0001',
      empresa_id: 'company-1',
      funcionario_id: 'employee-1',
      passageiro_nome: 'Maria Passageira',
      solicitante_nome: 'João Solicitante',
      tipo_servico: 'Aéreo',
      detalhes_aereo: {
        classe: 'Econômica',
        preferred_airlines: ['LATAM', 'Azul'],
        passengers: [
          { employee_id: 'employee-1', name: 'Maria Passageira' },
          { employee_id: 'employee-2', name: 'Joana Passageira' },
        ],
        trechos: [
          {
            sequence: 2,
            direction: 'return',
            origin: 'GYN - Goiânia',
            destination: 'REC - Recife',
            departure_date: '2026-08-14',
          },
          {
            sequence: 1,
            direction: 'outbound',
            origin: 'Recife (REC)',
            destination: '(GYN) Goiânia',
            departure_date: '2026-08-11',
            earliest_time: '02:00',
            latest_time: '05:00',
          },
        ],
      },
    } as Atendimento

    const summary = atendimentoToOfflineAirDemandSummary(demand, 'Empresa Teste')

    expect(summary).toMatchObject({
      id: 'air-demand-1',
      number: 'OS-20260806-0001',
      companyName: 'Empresa Teste',
      requestedCabin: 'Econômica',
      preferredAirlines: ['LATAM', 'Azul'],
    })
    expect(summary.passengers).toEqual([
      { id: 'employee-1', employeeId: 'employee-1', name: 'Maria Passageira', type: 'adulto' },
      { id: 'employee-2', employeeId: 'employee-2', name: 'Joana Passageira', type: 'adulto' },
    ])
    expect(summary.requestedSegments).toEqual([
      expect.objectContaining({
        originCode: 'REC',
        originName: 'Recife',
        destinationCode: 'GYN',
        destinationName: 'Goiânia',
        preferredPeriod: '02:00–05:00',
      }),
      expect.objectContaining({
        originCode: 'GYN',
        destinationCode: 'REC',
        departureDate: '2026-08-14',
      }),
    ])
  })

  it('keeps the legacy primary passenger when an old demand has no structured list', () => {
    const demand = {
      id: 'legacy-air-demand',
      empresa_id: 'company-1',
      funcionario_id: null,
      passageiro_nome: 'Passageiro Legado',
      tipo_servico: 'Aéreo',
      detalhes_aereo: {},
    } as Atendimento

    expect(atendimentoToOfflineAirDemandSummary(demand, 'Empresa Teste').passengers).toEqual([
      { name: 'Passageiro Legado', type: 'adulto' },
    ])
  })

  it('prefers canonical relational passengers when loading the approved air operation', () => {
    const operationSource = readFileSync(
      resolve(process.cwd(), 'components/travel/offline-travel-operation-form.tsx'),
      'utf8',
    )

    expect(operationSource).toContain('[...(Array.isArray(result.passengers) ? result.passengers : [])]')
    expect(operationSource).toContain('demandTravelerId: passenger.demandTravelerId')
    expect(operationSource).toContain('? { ...legacyDemandSummary, passengers: relationalPassengers }')
  })

  it('returns only safe relational passenger identifiers in the air quote list', () => {
    expect(airQuoteReadModelSource).toContain('passengers: OfflineAirDemandPassengerReadModel[]')
    expect(airQuoteReadModelSource).toContain('demandTravelerId: string')
    expect(airQuoteReadModelSource).toContain('identificationCode: string | null')
    expect(airQuoteReadModelSource).not.toContain('documentNumber')
    expect(airQuoteReadModelSource).not.toContain('birthDate')
    expect(airQuoteServiceSource).toContain('loadAirDemandPassengers')
    expect(airQuoteServiceSource).toContain('traveler.traveler_sequence')
    expect(airQuoteServiceSource).toContain("employee.identification_code")
  })

  it('publishes consultant quotes through the canonical adapter with lifecycle and idempotency guards', () => {
    expect(consultantSource).toContain('toOfflineAirQuoteCreateInput(value')
    expect(consultantSource).toContain('createOfflineAirQuoteFromServer')
    expect(consultantSource).toContain('expectedLifecycleVersion: lifecycleVersion || undefined')
    expect(consultantSource).toContain('offline-air-quote:${randomPart}')
    expect(consultantSource).toContain('Cotação aérea do pedido')
  })

  it('exposes a dedicated air quote tab without replacing hotel or reservation panels', () => {
    expect(mainWorkspaceSource).toContain("type OfflineWorkspacePanel = 'hotel_quote' | 'air_quote' | 'reservation'")
    expect(mainWorkspaceSource).toContain('Cotação de hotel')
    expect(mainWorkspaceSource).toContain('Cotação aérea')
    expect(mainWorkspaceSource).toContain('Reserva, emissão e correção')
    expect(mainWorkspaceSource).toContain('<OfflineAirQuoteWorkspace')
    expect(mainWorkspaceSource).toContain('<OfflineHotelQuoteForm')
    expect(mainWorkspaceSource).toContain('<OfflineTravelOperationForm')
  })

  it('lists only pending-choice air rounds and selects through the existing governed endpoint', () => {
    expect(requesterSource).toContain("lifecycleStatus: 'pending_choice', serviceType: 'air'")
    expect(requesterSource).toContain('listOfflineAirQuotesFromServer')
    expect(requesterSource).toContain('selectOfflineQuoteOptionFromServer')
    expect(requesterSource).toContain('expectedLifecycleVersion: lifecycleVersion')
    expect(requesterSource).toContain('offline-air-selection:${randomPart}')
    expect(requesterSource).toContain('<OfflineAirQuoteChoicePanel')
    expect(portalSource).toContain('<OfflineQuoteChoicePanel')
    expect(portalSource).toContain('<OfflineAirQuoteChoiceWorkspace')
    expect(requesterSource).toContain('round.list.passengers.map')
    expect(requesterSource).toContain('if (!round.list.passengers.length) return legacy')
    expect(airQuoteAdapterSource).toContain('createdAt: quote.createdAt')
  })
})
