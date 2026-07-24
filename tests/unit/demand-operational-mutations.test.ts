import { describe, expect, it } from 'vitest'

import {
  applyLegacyDemandAssignment,
  applyLegacyDemandStatus,
} from '@/lib/demands/operational-mutations'

const identity = {
  id: 'atd-001',
  demandNumber: 'OS-20260723-0001',
  companyId: 'company-001',
  passengerName: 'Aldo Fernandes Junior',
}

describe('demand operational compatibility projection', () => {
  it('closes the previous assignment and records the new assignee without mutating input', () => {
    const legacySnapshot = {
      id: identity.id,
      agente_user_id: 'c81d9486-d1df-49d0-a97f-50b5aca61e76',
      em_atendimento: true,
      historico_agentes: [{
        user_id: 'c81d9486-d1df-49d0-a97f-50b5aca61e76',
        user_name: 'Agente anterior',
        desde: '2026-07-23T10:00:00.000Z',
      }],
    }
    const result = applyLegacyDemandAssignment({
      ...identity,
      legacySnapshot,
      currentAssigneeUserId: 'c81d9486-d1df-49d0-a97f-50b5aca61e76',
      assigneeUserId: 'e6dac222-6ab5-4ab5-a063-ea3aa947ae80',
      assigneeName: 'Novo agente',
      actorUserId: '5fbb32c1-a650-488b-a7c4-41ce52de3504',
      reason: 'Rebalanceamento por SLA',
      changedAt: '2026-07-23T11:00:00.000Z',
    })

    expect(result).toMatchObject({
      agente_user_id: 'e6dac222-6ab5-4ab5-a063-ea3aa947ae80',
      em_atendimento: false,
      repassada_de: 'c81d9486-d1df-49d0-a97f-50b5aca61e76',
      repassada_para: 'e6dac222-6ab5-4ab5-a063-ea3aa947ae80',
      motivo_repasse: 'Rebalanceamento por SLA',
    })
    expect(result.historico_agentes).toEqual([
      {
        user_id: 'c81d9486-d1df-49d0-a97f-50b5aca61e76',
        user_name: 'Agente anterior',
        desde: '2026-07-23T10:00:00.000Z',
        ate: '2026-07-23T11:00:00.000Z',
      },
      {
        user_id: 'e6dac222-6ab5-4ab5-a063-ea3aa947ae80',
        user_name: 'Novo agente',
        desde: '2026-07-23T11:00:00.000Z',
      },
    ])
    expect(legacySnapshot.historico_agentes[0]).not.toHaveProperty('ate')
  })

  it('marks a self-assignment as accepted without duplicating an existing history entry', () => {
    const userId = 'e6dac222-6ab5-4ab5-a063-ea3aa947ae80'
    const result = applyLegacyDemandAssignment({
      ...identity,
      legacySnapshot: {
        agente_user_id: userId,
        em_atendimento: false,
        historico_agentes: [{ user_id: userId, user_name: 'Agente', desde: '2026-07-23T10:00:00.000Z' }],
      },
      currentAssigneeUserId: userId,
      assigneeUserId: userId,
      assigneeName: 'Agente',
      actorUserId: userId,
      reason: 'Aceite da fila',
      changedAt: '2026-07-23T11:00:00.000Z',
    })

    expect(result.em_atendimento).toBe(true)
    expect(result.historico_agentes).toHaveLength(1)
    expect(result).not.toHaveProperty('repassada_em')
  })

  it('records completion and clears stale completion when a demand is reopened', () => {
    const completed = applyLegacyDemandStatus({
      ...identity,
      legacySnapshot: { status: 'em_andamento', em_atendimento: true },
      status: 'finalizado',
      changedAt: '2026-07-23T12:00:00.000Z',
    })
    expect(completed).toMatchObject({
      status: 'finalizado',
      finalizado_em: '2026-07-23T12:00:00.000Z',
      em_atendimento: false,
    })

    const reopened = applyLegacyDemandStatus({
      ...identity,
      legacySnapshot: completed,
      status: 'em_andamento',
      changedAt: '2026-07-23T13:00:00.000Z',
    })
    expect(reopened.status).toBe('em_andamento')
    expect(reopened).not.toHaveProperty('finalizado_em')
  })
})
