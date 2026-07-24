import { describe, expect, it } from 'vitest'

import {
  assessDemandUpdate,
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
  costCenter: 'TI',
  project: 'EXPANSAO',
  paymentMethod: 'invoice',
  passengerName: 'Aldo Fernandes Junior',
}

describe('demand update governance', () => {
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

  it('bloqueia alteracao material depois de reserva ou emissao', () => {
    expect(lifecycleAllowsMaterialDemandEdit('quoting')).toBe(true)
    expect(lifecycleAllowsMaterialDemandEdit('reserved')).toBe(false)
    expect(lifecycleAllowsMaterialDemandEdit('issued')).toBe(false)
    expect(lifecycleAllowsMaterialDemandEdit('closed')).toBe(false)
  })
})
