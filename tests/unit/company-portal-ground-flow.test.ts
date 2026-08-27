import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  groundPortalDestinationLabel,
  groundPortalService,
  isOfflineGroundPortalItem,
  resolveGroundPortalFlowVisibility,
} from '@/components/company-portal-lab/ground-portal-contract'
import {
  projectCorporateDemandList,
  type CorporateDemandListItem,
} from '@/lib/company-portal-lab/demand-projection'
import type { RelationalDemandClientItem } from '@/lib/demands-client'
import {
  portalBusRequestDetailsSchema,
  portalCarRequestDetailsSchema,
} from '@/lib/offline-ground/request-model'

const root = process.cwd()
const formSource = read('components/company-portal-lab/ground-offline-request-form.tsx')
const flowSource = read('components/company-portal-lab/ground-demand-flow.tsx')
const readonlySource = read('components/company-portal-lab/ground-request-readonly.tsx')
const demandServiceSource = read('lib/server/demand-service.ts')
const groundServiceSource = read('lib/server/offline-ground-demand-service.ts')
const catalogServiceSource = read('lib/server/offline-ground-catalog-service.ts')

const ids = {
  employee: 'func-company-portal-offline-local-v1',
  pickup: '00000000-0000-4000-8000-000000000002',
  returned: '00000000-0000-4000-8000-000000000003',
  origin: '00000000-0000-4000-8000-000000000004',
  destination: '00000000-0000-4000-8000-000000000005',
  originTerminal: '00000000-0000-4000-8000-000000000006',
  destinationTerminal: '00000000-0000-4000-8000-000000000007',
}

describe('fluxo terrestre offline no Portal Empresa', () => {
  it('valida snapshots completos de carro e rodoviario', () => {
    expect(portalCarRequestDetailsSchema.safeParse({
      ground: {
        pickupLocationId: ids.pickup,
        returnLocationId: ids.returned,
        pickupAt: '2026-09-01T10:00:00-03:00',
        returnAt: '2026-09-03T10:00:00-03:00',
      },
      primary_driver: { employee_id: ids.employee, name: 'Motorista Teste' },
      pickup_location_name: 'Movida Congonhas',
      return_location_name: 'Movida Congonhas',
    }).success).toBe(true)

    expect(portalBusRequestDetailsSchema.safeParse({
      ground: {
        tripType: 'one_way',
        legs: [{
          originCityId: ids.origin,
          destinationCityId: ids.destination,
          originTerminalId: ids.originTerminal,
          destinationTerminalId: ids.destinationTerminal,
          departureDate: '2026-09-01',
        }],
      },
      travelers: [{ employee_id: ids.employee, name: 'Passageiro Teste' }],
      leg_snapshots: [{
        origin_city_name: 'Sao Paulo',
        destination_city_name: 'Rio de Janeiro',
        origin_terminal_name: 'Tiete',
        destination_terminal_name: 'Novo Rio',
      }],
    }).success).toBe(true)
  })

  it('usa somente catalogo aprovado e persiste nas tabelas normalizadas 0078', () => {
    expect(catalogServiceSource).toContain("location.review_status = 'verified'")
    expect(catalogServiceSource).toContain("terminal.review_status = 'verified'")
    expect(catalogServiceSource).toContain("route.review_status = 'verified'")
    expect(groundServiceSource).toContain('insert into car_demand_details')
    expect(groundServiceSource).toContain('insert into bus_demand_details')
    expect(groundServiceSource).toContain('insert into bus_demand_legs')
    expect(groundServiceSource).toContain('insert into demand_travelers')
    expect(groundServiceSource).toContain('GROUND_RENTAL_LOCATION_NOT_VERIFIED')
    expect(groundServiceSource).toContain('GROUND_BUS_TERMINAL_NOT_VERIFIED')
  })

  it('encapsula criacao, snapshot, cotacao, aprovacao, operacao e voucher', () => {
    expect(formSource).toContain("booking_mode: 'offline'")
    expect(formSource).toContain("tipo_servico: service === 'car' ? 'Carro' : 'Rodoviário'")
    expect(formSource).toContain('createCompanyPortalDemand(demand, demandScope)')
    expect(flowSource).toContain('<GroundQuoteWorkspace')
    expect(flowSource).toContain('<CorporateDemandApprovalPanel')
    expect(flowSource).toContain('<GroundOperationWorkspace')
    expect(flowSource).toContain('<GroundVoucherWorkspace')
    expect(readonlySource).toContain('data-company-portal-ground-request-snapshot')
    expect(readonlySource).not.toContain('<input')
    expect(readonlySource).not.toContain('<textarea')
  })

  it('carrega viajantes pelo escopo corporativo sem usar a consulta exclusiva da agencia', () => {
    expect(formSource).toContain("import { searchTravelers } from '@/lib/travelers/client'")
    expect(formSource).toContain('const request = internalUser')
    expect(formSource).toContain("listCompanyPortalAgencyDemandOptions(companyId, { participant: 'all', limit: 100 })")
    expect(formSource).toContain('searchTravelers({ companyId, limit: 100 }, controller.signal)')
  })

  it('bloqueia edicao normal no servidor e abre apenas a correcao auditada', () => {
    expect(demandServiceSource).toContain('GROUND_DEMAND_NORMAL_EDIT_LOCKED')
    expect(demandServiceSource).toContain('groundRequestAdjustmentAllowed')
    const item = fixture('bus', 'pending_choice', true)
    expect(resolveGroundPortalFlowVisibility(item, 'requester', { canEditRequest: true }).canEditAfterRejection).toBe(true)
    expect(resolveGroundPortalFlowVisibility(fixture('bus', 'pending_choice'), 'requester', { canEditRequest: false }).canEditAfterRejection).toBe(false)
  })

  it('identifica servico/destino e exclui online', () => {
    const car = fixture('car', 'draft')
    expect(groundPortalService(car)).toBe('car')
    expect(isOfflineGroundPortalItem(car)).toBe(true)
    expect(groundPortalDestinationLabel(car)).toContain('Congonhas')
    expect(isOfflineGroundPortalItem({ ...car, bookingMode: 'online' })).toBe(false)
    expect(resolveGroundPortalFlowVisibility(fixture('car', 'failed'), 'consultant', {
      canPrepareQuotation: true,
    }).showQuoteWorkspace).toBe(true)
  })
})

function fixture(
  service: 'car' | 'bus',
  lifecycleStatus: string,
  canCorrectRequest = false,
): CorporateDemandListItem {
  const item: RelationalDemandClientItem = {
    id: `${service}-demand-1`, demandNumber: 'OS-1001', companyId: 'company-1', companyName: 'Empresa Teste',
    employeeId: ids.employee, employeeMatchStatus: 'matched', employeeMatchConfidence: 1,
    assignedToUserId: null, assignedToName: null, serviceType: service,
    passengerName: 'Viajante Teste', operationalStatus: 'aguardando_cliente', lifecycleStatus,
    lifecycleVersion: 2, priority: 'media', travelStartDate: '2026-09-01', travelEndDate: '2026-09-03',
    destination: 'Congonhas', costCenter: 'ADM', estimatedAmount: 0, finalAmount: 0, slaDueAt: null,
    version: 2, policyEvaluationId: null, approvalInstanceId: null, submittedAt: null,
    createdAt: '2026-08-17T10:00:00.000Z', updatedAt: '2026-08-17T10:00:00.000Z', governance: {},
    demand: {
      id: `${service}-demand-1`, empresa_id: 'company-1', solicitante_id: 'requester-1', funcionario_id: ids.employee,
      passageiro_nome: 'Viajante Teste', tipo_servico: service === 'car' ? 'Carro' : 'Rodoviário', booking_mode: 'offline',
      valor_cotacao: 0, agente_user_id: 'user-1', status: 'aguardando_cliente', prioridade: 'media', observacoes: '',
      data_atendimento: '2026-08-17', created_at: '2026-08-17T10:00:00.000Z',
      ...(service === 'car' ? { detalhes_carro: { return_location_name: 'Movida Congonhas' } } : {}),
    },
  }
  return projectCorporateDemandList(item, {
    requesterOwnedByCurrentUser: true,
    canChooseQuote: lifecycleStatus === 'pending_choice',
    canDecideAssignedApproval: false,
    canCorrectRequest,
  })
}

function read(path: string): string { return readFileSync(resolve(root, path), 'utf8') }
