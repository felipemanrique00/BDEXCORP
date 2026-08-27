import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AirRequestReadonly } from '@/components/company-portal-lab/air-request-readonly'
import type { Atendimento } from '@/types'

const demand: Atendimento = {
  id: 'at-lab-air-1',
  serial_os: 'OS-20260817-0001',
  empresa_id: 'company-lab',
  solicitante_id: 'requester-lab',
  solicitante_nome: 'Solicitante Laboratório',
  booking_mode: 'offline',
  funcionario_id: 'employee-lab',
  passageiro_nome: 'Viajante Laboratório',
  tipo_servico: 'Aéreo',
  valor_cotacao: 0,
  agente_user_id: 'user-lab',
  status: 'pendente',
  prioridade: 'alta',
  origem: 'Portal',
  observacoes: 'Assento no corredor.',
  data_atendimento: '2026-08-17',
  forma_pagamento: 'IV',
  centro_custo: 'ADMINISTRAÇÃO',
  detalhes_aereo: {
    trip_type: 'round_trip',
    classe: 'Econômica',
    baggage_pieces: 1,
    flexible_dates: true,
    flexible_times: false,
    preferred_airlines: ['LA', 'G3'],
    passengers: [{ employee_id: 'employee-lab', name: 'Viajante Laboratório' }],
    trechos: [
      {
        sequence: 1,
        direction: 'outbound',
        origin: 'GYN',
        destination: 'CGH',
        departure_date: '2026-09-05',
        earliest_time: '08:00',
        latest_time: '11:00',
      },
      {
        sequence: 2,
        direction: 'return',
        origin: 'CGH',
        destination: 'GYN',
        departure_date: '2026-09-08',
      },
    ],
  },
  created_at: '2026-08-17T10:00:00.000Z',
}

describe('dados aéreos enviados no Portal Empresa', () => {
  it('mostra a solicitação completa como somente leitura após o envio', () => {
    const html = renderToStaticMarkup(createElement(AirRequestReadonly, {
      demand,
      companyName: 'Empresa Laboratório',
    }))

    expect(html).toContain('data-company-portal-request-snapshot')
    expect(html).toContain('Dados enviados à agência · somente leitura')
    expect(html).toContain('GYN')
    expect(html).toContain('CGH')
    expect(html).toContain('Viajante Laboratório')
    expect(html).toContain('ADMINISTRAÇÃO')
    expect(html).toContain('Faturado')
    expect(html).toContain('Assento no corredor.')
    expect(html).not.toContain('Editar solicitação')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<textarea')
  })

  it('só oferece edição quando a rejeição governada abre a janela de ajuste', () => {
    const html = renderToStaticMarkup(createElement(AirRequestReadonly, {
      demand,
      companyName: 'Empresa Laboratório',
      canEditAfterRejection: true,
      editReason: 'Ajustar o horário de ida.',
      onEdit: () => undefined,
    }))

    expect(html).toContain('Ajuste liberado após a rejeição')
    expect(html).toContain('Ajustar o horário de ida.')
    expect(html).toContain('Editar solicitação')
  })
})
