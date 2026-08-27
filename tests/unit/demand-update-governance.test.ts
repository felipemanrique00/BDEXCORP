import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assessDemandUpdate,
  lifecycleAllowsNormalAirDemandEdit,
  lifecycleAllowsNormalHotelDemandEdit,
  lifecycleAllowsMaterialDemandEdit,
  type DemandUpdateSnapshot,
} from '@/lib/demands/update-governance'

const base: DemandUpdateSnapshot = {
  companyId: 'company-a',
  employeeId: 'employee-a',
  serviceType: 'hotel',
  amount: 1_000,
  route: 'Goiania',
  startDate: '2026-08-10',
  endDate: '2026-08-12',
  costCenterId: null,
  costCenter: 'TI',
  project: 'EXPANSAO',
  paymentMethod: 'invoice',
  passengerName: 'Aldo Fernandes Junior',
  passengerIds: ['employee-a'],
}

const demandServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)

describe('demand update governance', () => {
  it('mantem a elegibilidade de edicao segura para o bundle do navegador', () => {
    const hotelGuestsSource = readFileSync(
      resolve(process.cwd(), 'lib/offline-travel/hotel-guests.ts'),
      'utf8',
    )
    const eligibilitySource = readFileSync(
      resolve(process.cwd(), 'lib/demands/edit-eligibility.ts'),
      'utf8',
    )

    expect(hotelGuestsSource).toContain('@/lib/demands/edit-eligibility')
    expect(hotelGuestsSource).not.toContain('@/lib/demands/update-governance')
    expect(eligibilitySource).not.toMatch(/node:|createHash|crypto/)
  })

  it('detecta mudancas materiais em dados financeiros e de viagem', () => {
    const assessment = assessDemandUpdate(base, {
      ...base,
      amount: 1_250,
      startDate: '2026-08-11',
    })

    expect(assessment.material).toBe(true)
    expect(assessment.changedFields).toEqual(expect.arrayContaining(['amount', 'startDate']))
    expect(assessment.previousHash).not.toBe(assessment.currentHash)
  })

  it('nao considera uma copia equivalente como mudanca material', () => {
    const assessment = assessDemandUpdate(base, { ...base })

    expect(assessment.material).toBe(false)
    expect(assessment.changedFields).toEqual([])
    expect(assessment.previousHash).toBe(assessment.currentHash)
  })

  it('considera a troca ou reordenacao de passageiros aereos uma mudanca material', () => {
    const assessment = assessDemandUpdate(
      { ...base, serviceType: 'air', passengerIds: ['employee-a', 'employee-b'] },
      { ...base, serviceType: 'air', passengerIds: ['employee-b', 'employee-a'] },
    )

    expect(assessment.material).toBe(true)
    expect(assessment.changedFields).toContain('passengerIds')
    expect(demandServiceSource).toContain('AIR_DEMAND_PASSENGERS_EDIT_LOCKED')
    expect(demandServiceSource).toContain('AIR_DEMAND_PASSENGERS_REQUIRED_FOR_PRIMARY_CHANGE')
  })

  it('evaluates every structured air passenger against corporate policies', () => {
    expect(demandServiceSource).toContain('loadDemandPolicyTravelers')
    expect(demandServiceSource).toContain('for (const traveler of policyTravelers)')
    expect(demandServiceSource).toContain('travelerSequence: traveler.sequence')
  })

  it('bloqueia alteracao material depois de reserva ou emissao', () => {
    expect(lifecycleAllowsMaterialDemandEdit('quoting')).toBe(true)
    expect(lifecycleAllowsMaterialDemandEdit('reserved')).toBe(false)
    expect(lifecycleAllowsMaterialDemandEdit('issued')).toBe(false)
    expect(lifecycleAllowsMaterialDemandEdit('closed')).toBe(false)
  })

  it('bloqueia a hospedagem enviada salvo devolucao auditada', () => {
    expect(lifecycleAllowsNormalHotelDemandEdit('draft')).toBe(true)
    expect(lifecycleAllowsNormalHotelDemandEdit('draft', false, true)).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('draft', true, true)).toBe(true)
    expect(lifecycleAllowsNormalHotelDemandEdit('submitted')).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('quoting')).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('pending_choice')).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('submitted', true)).toBe(true)
    expect(lifecycleAllowsNormalHotelDemandEdit('pending_choice', true)).toBe(true)
    expect(lifecycleAllowsNormalHotelDemandEdit('quoting', true)).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('pending_cost_approval')).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('approved')).toBe(false)
    expect(lifecycleAllowsNormalHotelDemandEdit('reserved')).toBe(false)
    expect(demandServiceSource).toContain('HOTEL_DEMAND_NORMAL_EDIT_LOCKED')
    expect(demandServiceSource).toContain('hotelRequestAdjustmentAllowed')
    expect(demandServiceSource).toContain('requestAdjustmentEditAllowed')
  })

  it('mantem toda solicitacao aerea persistida bloqueada salvo devolucao auditada', () => {
    expect(lifecycleAllowsNormalAirDemandEdit('draft')).toBe(false)
    expect(lifecycleAllowsNormalAirDemandEdit('submitted')).toBe(false)
    expect(lifecycleAllowsNormalAirDemandEdit('pending_choice')).toBe(false)
    expect(lifecycleAllowsNormalAirDemandEdit('submitted', true)).toBe(true)
    expect(lifecycleAllowsNormalAirDemandEdit('pending_choice', true)).toBe(true)
    expect(lifecycleAllowsNormalAirDemandEdit('quoting', true)).toBe(false)
    expect(demandServiceSource).toContain('AIR_DEMAND_NORMAL_EDIT_LOCKED')
    expect(demandServiceSource).toContain("demandRequestAdjustmentAllows(\n      current.metadata,\n      'edit_request'")
    expect(demandServiceSource).toContain('supersedeDemandQuoteRoundsForRequestAdjustment(')
    expect(demandServiceSource).toContain("'return_for_adjustment'")
  })
})
