import { describe, expect, it } from 'vitest'

import {
  collectVisiblePortalDemandIds,
  isPortalDemandVisible,
  mergePortalDemands,
  mergePortalVouchers,
  parsePortalNavigation,
  PORTAL_REQUESTS_CHOICE_HREF,
} from '@/lib/portal-relational-sync'
import type { Atendimento, VoucherEmitido } from '@/types'

const requesterScope = {
  allowedCompanyIds: new Set(['company-a']),
  requesterRestricted: true,
  requesterId: 'requester-a',
  requesterEmail: 'requester.a@example.com',
  employeeIds: new Set(['employee-a']),
}

describe('portal relational synchronization', () => {
  it('merges relational demands over legacy data without leaking another requester', () => {
    const duplicateLegacy = demand('legacy-id', {
      serial_os: 'OS-001',
      solicitante_id: 'requester-a',
      observacoes: 'snapshot legado',
    })
    const relational = demand('server-id', {
      serial_os: 'OS-001',
      solicitante_id: 'requester-a',
      observacoes: 'snapshot relacional',
    })
    const anotherRequester = demand('other-requester', {
      solicitante_id: 'requester-b',
      funcionario_id: 'employee-b',
      agente_user_id: 'user-requester-a',
    })
    const ownTraveler = demand('own-traveler', {
      solicitante_id: undefined,
      funcionario_id: 'employee-a',
    })
    const outsideCompany = demand('outside-company', {
      empresa_id: 'company-b',
      solicitante_id: 'requester-a',
    })

    const merged = mergePortalDemands(
      [duplicateLegacy, anotherRequester, ownTraveler, outsideCompany],
      [relational],
      requesterScope,
    )

    expect(merged.map((item) => item.id).sort()).toEqual(['own-traveler', 'server-id'])
    expect(merged.find((item) => item.serial_os === 'OS-001')?.observacoes)
      .toBe('snapshot relacional')
  })

  it('never treats the assigned consultant as proof of requester ownership', () => {
    const assignedToCurrentUser = demand('assigned-to-current-user', {
      solicitante_id: 'requester-b',
      funcionario_id: 'employee-b',
      agente_user_id: 'user-requester-a',
    })

    expect(isPortalDemandVisible(assignedToCurrentUser, requesterScope)).toBe(false)
  })

  it('accepts a server-scoped demand for another requester record of the same authenticated user', () => {
    const secondCompanyRequesterRecord = demand('server-owned-second-requester-record', {
      solicitante_id: 'requester-record-from-company-b',
    })
    expect(isPortalDemandVisible(secondCompanyRequesterRecord, {
      ...requesterScope,
      trustedServerDemandIds: new Set([secondCompanyRequesterRecord.id]),
    })).toBe(true)
    expect(isPortalDemandVisible(secondCompanyRequesterRecord, requesterScope)).toBe(false)
  })

  it('shows only vouchers tied to an owned demand, requester email, or own traveler', () => {
    const relational = voucher('server-voucher', {
      atendimento_id: 'own-demand',
      fingerprint: 'same-voucher',
      observacoes: 'relacional',
    })
    const legacyDuplicate = voucher('legacy-voucher', {
      atendimento_id: 'own-demand',
      fingerprint: 'same-voucher',
      observacoes: 'legado',
    })
    const byEmail = voucher('by-email', {
      solicitante_email: 'REQUESTER.A@example.com',
    })
    const byTraveler = voucher('by-traveler', {
      funcionario_id: 'employee-a',
    })
    const anotherRequester = voucher('other-requester-voucher', {
      atendimento_id: 'other-demand',
      solicitante_email: 'requester.b@example.com',
      funcionario_id: 'employee-b',
    })

    const merged = mergePortalVouchers(
      [legacyDuplicate, byEmail, byTraveler, anotherRequester],
      [relational],
      requesterScope,
      new Set(['own-demand']),
    )

    expect(merged.map((item) => item.id).sort())
      .toEqual(['by-email', 'by-traveler', 'server-voucher'])
    expect(merged.find((item) => item.fingerprint === 'same-voucher')?.observacoes)
      .toBe('relacional')
  })

  it('preserves every authorized demand id alias before OS deduplication', () => {
    const legacy = demand('legacy-demand-id', {
      serial_os: 'OS-ALIAS-001',
      solicitante_id: 'requester-a',
    })
    const relational = demand('relational-demand-id', {
      serial_os: 'OS-ALIAS-001',
      solicitante_id: 'requester-a',
    })
    const aliases = collectVisiblePortalDemandIds([legacy], [relational], requesterScope)
    const mergedVouchers = mergePortalVouchers(
      [voucher('legacy-linked-voucher', { atendimento_id: legacy.id })],
      [],
      requesterScope,
      aliases,
    )

    expect(mergePortalDemands([legacy], [relational], requesterScope).map((item) => item.id))
      .toEqual(['relational-demand-id'])
    expect([...aliases].sort()).toEqual(['legacy-demand-id', 'relational-demand-id'])
    expect(mergedVouchers.map((item) => item.id)).toEqual(['legacy-linked-voucher'])
  })

  it('never lets e-mail or employee fallback override a linked demand owner', () => {
    const forged = voucher('forged-linked-voucher', {
      atendimento_id: 'another-requester-demand',
      solicitante_email: 'requester.a@example.com',
      funcionario_id: 'employee-a',
    })

    expect(mergePortalVouchers(
      [],
      [forged],
      requesterScope,
      new Set(['own-demand']),
    )).toEqual([])
  })

  it('keeps the full authorized company scope for non-requester profiles', () => {
    const scope = {
      ...requesterScope,
      requesterRestricted: false,
    }
    const merged = mergePortalDemands(
      [demand('requester-a', { solicitante_id: 'requester-a' })],
      [demand('requester-b', { solicitante_id: 'requester-b' })],
      scope,
    )
    expect(merged).toHaveLength(2)
  })

  it('parses the stable requests and choice deep link and ignores unknown values', () => {
    expect(PORTAL_REQUESTS_CHOICE_HREF)
      .toBe('/dashboard/portal-empresa?tab=pedidos&panel=escolha-cotacao')
    expect(parsePortalNavigation('?tab=pedidos&panel=escolha-cotacao')).toEqual({
      tab: 'pedidos',
      panel: 'escolha-cotacao',
    })
    expect(parsePortalNavigation('?tab=admin&panel=interno')).toEqual({
      tab: null,
      panel: null,
    })
  })
})

function demand(id: string, patch: Partial<Atendimento> = {}): Atendimento {
  return {
    id,
    empresa_id: 'company-a',
    solicitante_id: 'requester-a',
    funcionario_id: null,
    passageiro_nome: 'Viajante de teste',
    tipo_servico: 'Hotel',
    valor_cotacao: 0,
    agente_user_id: 'agent-a',
    status: 'pendente',
    prioridade: 'media',
    observacoes: '',
    data_atendimento: '2026-08-04',
    created_at: `2026-08-04T10:00:0${id.length % 10}.000Z`,
    ...patch,
  }
}

function voucher(id: string, patch: Partial<VoucherEmitido> = {}): VoucherEmitido {
  return {
    id,
    numero: id,
    tipo: 'Hotel',
    status: 'emitido',
    empresa_id: 'company-a',
    funcionario_id: null,
    passageiro_nome: 'Viajante de teste',
    fornecedor_nome: 'Hotel de teste',
    total: 100,
    emitido_por_user_id: 'operator-a',
    emitido_por_user_name: 'Operador',
    created_at: `2026-08-04T11:00:0${id.length % 10}.000Z`,
    ...patch,
  }
}
