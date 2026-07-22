import type { Atendimento, Empresa, TipoServico, VoucherEmitido } from '@/types'
import { addDaysISODate, todayISODate } from '@/lib/date'

export type OperationalAlertSeverity = 'critico' | 'alto' | 'medio' | 'baixo'
export type OperationalAlertKind =
  | 'checkin_hoje'
  | 'checkout_hoje'
  | 'aereo_hoje'
  | 'aereo_amanha'
  | 'aereo_sem_localizador'
  | 'hotel_sem_datas'
  | 'vencida'
  | 'sem_agente'
  | 'wintour'

export interface OperationalAlert {
  id: string
  kind: OperationalAlertKind
  severity: OperationalAlertSeverity
  title: string
  detail: string
  date?: string
  service?: TipoServico
  entityType: 'demanda' | 'voucher'
  entityId: string
  href: string
}

export function getOperationalAlerts(params: {
  atendimentos: Atendimento[]
  vouchers?: VoucherEmitido[]
  empresas?: Empresa[]
  today?: string
}): OperationalAlert[] {
  const today = params.today || hojeIso()
  const tomorrow = addDays(today, 1)
  const empresasById = new Map((params.empresas || []).map((e) => [e.id, e]))
  const alerts: OperationalAlert[] = []

  params.atendimentos
    .filter((a) => !['cancelado', 'finalizado'].includes(a.status))
    .forEach((a) => {
      const empresa = empresasById.get(a.empresa_id)?.nome || 'Empresa nao identificada'
      const principal = dataPrincipal(a)
      const local = destinoServico(a)

      if (!a.agente_user_id) {
        alerts.push({
          id: `sem-agente-${a.id}`,
          kind: 'sem_agente',
          severity: 'alto',
          title: 'Demanda sem agente',
          detail: `${a.passageiro_nome} - ${empresa}${local ? ` - ${local}` : ''}`,
          date: principal,
          service: a.tipo_servico,
          entityType: 'demanda',
          entityId: a.id,
          href: '/dashboard/demandas',
        })
      }

      if (a.tipo_servico === 'Hotel' && !a.detalhes_hotel?.data_checkin) {
        alerts.push(alertFromAtendimento(a, 'hotel_sem_datas', 'medio', 'Hotel sem data operacional', empresa, local, principal))
      }
      if (a.tipo_servico === 'Hotel' && a.detalhes_hotel?.data_checkin === today) {
        alerts.push(alertFromAtendimento(a, 'checkin_hoje', 'critico', 'Check-in hoje', empresa, local, today))
      }
      if (a.tipo_servico === 'Hotel' && a.detalhes_hotel?.data_checkout === today) {
        alerts.push(alertFromAtendimento(a, 'checkout_hoje', 'medio', 'Check-out hoje', empresa, local, today))
      }
      if (a.tipo_servico === 'Aéreo' && !a.detalhes_aereo?.localizador) {
        alerts.push(alertFromAtendimento(a, 'aereo_sem_localizador', 'medio', 'Aereo sem localizador', empresa, local, principal))
      }
      if (a.tipo_servico === 'Aéreo' && a.detalhes_aereo?.data_ida === today) {
        alerts.push(alertFromAtendimento(a, 'aereo_hoje', 'critico', 'Embarque aereo hoje', empresa, local, today))
      }
      if (a.tipo_servico === 'Aéreo' && a.detalhes_aereo?.data_ida === tomorrow) {
        alerts.push(alertFromAtendimento(a, 'aereo_amanha', 'alto', 'Embarque aereo amanha', empresa, local, tomorrow))
      }
      if (principal && principal < today) {
        alerts.push(alertFromAtendimento(a, 'vencida', 'alto', 'Data operacional vencida', empresa, local, principal))
      }
      if (a.origem_emissao?.startsWith('wintour')) {
        const data = a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida
        if (data === today || data === tomorrow) {
          alerts.push(alertFromAtendimento(a, 'wintour', data === today ? 'critico' : 'medio', 'Importada do Wintour no radar', empresa, local, data))
        }
      }
    })

  ;(params.vouchers || [])
    .filter((v) => !['cancelado'].includes(String(v.status || '').toLowerCase()))
    .forEach((v) => {
      const dataEntrada = v.data_checkin || v.data_ida || v.retirada_data
      const dataSaida = v.data_checkout || v.data_volta || v.devolucao_data
      const isAereo = v.tipo === 'Aéreo'
      const isWintour = Boolean(
        v.fingerprint?.toLowerCase().includes('wintour') ||
        v.observacoes?.toLowerCase().includes('wintour') ||
        v.observacoes_internas?.toLowerCase().includes('wintour') ||
        v.arquivo_original_nome?.toLowerCase().includes('wintour'),
      )

      if (dataEntrada === today) {
        alerts.push(alertFromVoucher(v, isAereo ? 'aereo_hoje' : 'checkin_hoje', 'critico', isAereo ? 'Voucher aereo hoje' : 'Voucher com entrada hoje', dataEntrada))
      }
      if (dataEntrada === tomorrow) {
        alerts.push(alertFromVoucher(v, isAereo ? 'aereo_amanha' : 'checkin_hoje', 'alto', isAereo ? 'Voucher aereo amanha' : 'Voucher com entrada amanha', dataEntrada))
      }
      if (dataSaida === today) {
        alerts.push(alertFromVoucher(v, 'checkout_hoje', 'medio', isAereo ? 'Retorno aereo hoje' : 'Saida/devolucao hoje', dataSaida))
      }
      if (isWintour && (dataEntrada === today || dataEntrada === tomorrow || dataSaida === today)) {
        alerts.push(alertFromVoucher(v, 'wintour', dataEntrada === today || dataSaida === today ? 'critico' : 'medio', 'Voucher Wintour no radar', dataEntrada === today || dataEntrada === tomorrow ? dataEntrada : dataSaida))
      }
    })

  return uniqueAlerts(alerts).sort(
    (a, b) =>
      severityWeight(b.severity) - severityWeight(a.severity) ||
      String(a.date || '').localeCompare(String(b.date || '')),
  )
}

function alertFromAtendimento(
  a: Atendimento,
  kind: OperationalAlertKind,
  severity: OperationalAlertSeverity,
  title: string,
  empresa: string,
  local: string,
  date?: string,
): OperationalAlert {
  return {
    id: `${kind}-${a.id}`,
    kind,
    severity,
    title,
    detail: `${a.passageiro_nome} - ${empresa}${local ? ` - ${local}` : ''}`,
    date,
    service: a.tipo_servico,
    entityType: 'demanda',
    entityId: a.id,
    href: '/dashboard/demandas',
  }
}

function alertFromVoucher(
  v: VoucherEmitido,
  kind: OperationalAlertKind,
  severity: OperationalAlertSeverity,
  title: string,
  date?: string,
): OperationalAlert {
  return {
    id: `${kind}-${v.id}`,
    kind,
    severity,
    title,
    detail: `${v.passageiro_nome} - ${v.fornecedor_nome}`,
    date,
    service: v.tipo as TipoServico,
    entityType: 'voucher',
    entityId: v.id,
    href: `/dashboard/vouchers/${v.id}`,
  }
}

function dataPrincipal(a: Atendimento): string {
  return (
    a.detalhes_hotel?.data_checkin ||
    a.detalhes_aereo?.data_ida ||
    a.detalhes_carro?.data_retirada ||
    a.detalhes_pacote?.data_ida ||
    ''
  )
}

function destinoServico(a: Atendimento): string {
  return (
    a.detalhes_hotel?.hotel_nome ||
    a.detalhes_hotel?.cidade ||
    a.detalhes_aereo?.destino ||
    a.detalhes_carro?.cidade_retirada ||
    a.detalhes_pacote?.destino ||
    ''
  )
}

function hojeIso(): string {
  return todayISODate()
}

function addDays(iso: string, days: number): string {
  return addDaysISODate(iso, days)
}

function severityWeight(severity: OperationalAlertSeverity): number {
  return severity === 'critico' ? 4 : severity === 'alto' ? 3 : severity === 'medio' ? 2 : 1
}

function uniqueAlerts(alerts: OperationalAlert[]): OperationalAlert[] {
  const map = new Map<string, OperationalAlert>()
  alerts.forEach((alert) => map.set(alert.id, alert))
  return Array.from(map.values())
}
