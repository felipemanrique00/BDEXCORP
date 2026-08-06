import { todayISODate } from '@/lib/date'
import type { Atendimento, OrigemAtendimento, TipoServico, VoucherEmitido, VoucherTipo } from '@/types'
import {
  addAtendimento,
  criarAtendimentoParaLista,
  getAllAtendimentos,
  getAtendimentoById,
  updateAtendimento,
} from '@/lib/atendimentos-storage'
import {
  persistDemandPatchWithCompatibility,
  persistNewDemandWithCompatibility,
} from '@/lib/demand-persistence-client'
import {
  getAllVouchersEmitidos,
  updateVoucherEmitido,
} from '@/lib/vouchers-emitidos-storage'
import { updateVoucherOnServer } from '@/lib/voucher-persistence-client'
import { gerarLancamentosDoAtendimento, type LancamentoFinanceiro } from '@/lib/financeiro'
import {
  createFinancialDemandSyncKey,
  syncFinancialEntriesFromDemandsOnServer,
} from '@/lib/finance-persistence-client'

export interface ResultadoSincronizacaoFinanceira {
  receber?: LancamentoFinanceiro
  pagar?: LancamentoFinanceiro
}

export interface ResultadoSincronizacaoVoucher {
  atendimento?: Atendimento
  criado: boolean
  atualizado: boolean
  financeiro: ResultadoSincronizacaoFinanceira
}

export interface ResultadoSincronizacaoGlobal {
  atendimentosFinanceiro: number
  vouchersCriados: number
  vouchersAtualizados: number
}

function hojeISO(): string {
  return todayISODate()
}

function norm(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function joinUnique(parts: Array<string | undefined | null>, separator = ' | ', maxLength = 1200): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const text = String(part || '').trim()
    if (!text) continue
    const key = norm(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out.join(separator).slice(0, maxLength)
}

function asTipoServico(tipo: VoucherTipo): TipoServico {
  if (tipo === 'Hotel' || tipo === 'Aéreo' || tipo === 'Carro' || tipo === 'Pacote') return tipo
  return 'Outro'
}

export function asVoucherTipo(tipo: TipoServico): VoucherTipo {
  if (tipo === 'Hotel' || tipo === 'Carro' || tipo === 'Pacote') return tipo
  if (tipo === 'Aéreo') return 'Aéreo'
  return 'Pacote'
}

function dataPrincipalVoucher(v: VoucherEmitido): string {
  return v.data_checkin || v.data_ida || v.retirada_data || v.data_confirmacao || v.importado_em?.slice(0, 10) || v.created_at?.slice(0, 10) || ''
}

function dataPrincipalAtendimento(a: Atendimento): string {
  return (
    a.detalhes_hotel?.data_checkin ||
    a.detalhes_aereo?.data_ida ||
    a.detalhes_carro?.data_retirada ||
    a.detalhes_pacote?.data_ida ||
    a.data_atendimento ||
    a.created_at?.slice(0, 10) ||
    ''
  )
}

function fornecedorAtendimento(a: Atendimento): string {
  return (
    a.detalhes_hotel?.hotel_nome ||
    a.detalhes_aereo?.cia_aerea ||
    a.detalhes_carro?.locadora ||
    a.detalhes_pacote?.descricao ||
    ''
  )
}

function fornecedorVoucher(v: VoucherEmitido): string {
  return v.fornecedor_nome || v.cia_aerea || v.locadora || ''
}

function valorVendaVoucher(v: VoucherEmitido): number {
  return Number(v.total || v.tarifa_total || 0)
}

function valorCustoVoucher(v: VoucherEmitido): number {
  if (v.tarifa_total) return Number(v.tarifa_total)
  if (v.tipo === 'Hotel' && v.valor_diaria && v.noites) return Number(v.valor_diaria) * Number(v.noites)
  return Number(v.total || 0)
}

function fingerprintVoucher(v: VoucherEmitido): string {
  return [
    v.tipo,
    v.empresa_id,
    v.funcionario_id || '',
    norm(v.passageiro_nome),
    norm(fornecedorVoucher(v)),
    dataPrincipalVoucher(v),
    v.localizador || v.numero_confirmacao || v.numero || '',
  ].join('|')
}

function matchAtendimentoVoucher(a: Atendimento, v: VoucherEmitido): boolean {
  if (a.id === v.atendimento_id) return true
  if ((a.voucher_ids || []).includes(v.id)) return true
  if (a.empresa_id !== v.empresa_id) return false
  if (a.funcionario_id && v.funcionario_id && a.funcionario_id !== v.funcionario_id) return false
  if (asVoucherTipo(a.tipo_servico) !== v.tipo) return false

  const mesmoPassageiro = norm(a.passageiro_nome) === norm(v.passageiro_nome)
  const mesmaData = !dataPrincipalVoucher(v) || dataPrincipalAtendimento(a) === dataPrincipalVoucher(v)
  const mesmoFornecedor = !fornecedorVoucher(v) || norm(fornecedorAtendimento(a)) === norm(fornecedorVoucher(v))
  const mesmoLocalizador = Boolean(
    (v.localizador && (
      a.detalhes_aereo?.localizador === v.localizador ||
      a.detalhes_carro?.localizador === v.localizador ||
      a.detalhes_hotel?.localizador === v.localizador ||
      a.detalhes_pacote?.localizador === v.localizador
    )) ||
    (v.numero_confirmacao && (
      a.detalhes_hotel?.localizador === v.numero_confirmacao ||
      a.detalhes_aereo?.localizador === v.numero_confirmacao
    ))
  )

  return mesmoPassageiro && mesmaData && (mesmoFornecedor || mesmoLocalizador)
}

function detalhesDoVoucher(v: VoucherEmitido): Pick<Atendimento, 'detalhes_hotel' | 'detalhes_aereo' | 'detalhes_carro' | 'detalhes_pacote'> {
  if (v.tipo === 'Hotel') {
    return {
      detalhes_hotel: {
        hotel_nome: v.fornecedor_nome,
        cidade: v.fornecedor_cidade,
        data_checkin: v.data_checkin,
        data_checkout: v.data_checkout,
        num_hospedes: v.num_hospedes,
        tipo_apto: v.tipo_apartamento?.toUpperCase().includes('TRIP') ? 'TPL'
          : v.tipo_apartamento?.toUpperCase().includes('DUP') ? 'DBL'
          : 'SGL',
        noites: v.noites,
        tarifa_unitaria: v.valor_diaria,
        localizador: v.numero_confirmacao || v.localizador,
      },
    }
  }

  if (v.tipo === 'Aéreo') {
    return {
      detalhes_aereo: {
        cia_aerea: v.cia_aerea || v.fornecedor_nome,
        origem: v.origem,
        destino: v.destino,
        data_ida: v.data_ida,
        data_volta: v.data_volta,
        classe: v.classe as any,
        localizador: v.localizador || v.numero_confirmacao,
      },
    }
  }

  if (v.tipo === 'Carro') {
    return {
      detalhes_carro: {
        locadora: v.locadora || v.fornecedor_nome,
        cidade_retirada: v.retirada_local,
        data_retirada: v.retirada_data,
        data_devolucao: v.devolucao_data,
        categoria: v.categoria_carro,
        localizador: v.localizador || v.numero_confirmacao,
      },
    }
  }

  return {
    detalhes_pacote: {
      destino: v.destino || v.fornecedor_cidade,
      data_ida: v.data_ida || v.data_checkin,
      data_volta: v.data_volta || v.data_checkout,
      descricao: v.fornecedor_nome,
      localizador: v.localizador || v.numero_confirmacao,
    },
  }
}

function patchAtendimentoDoVoucher(v: VoucherEmitido): Partial<Atendimento> {
  const venda = valorVendaVoucher(v)
  const custo = valorCustoVoucher(v)
  const ids = [v.id]
  return {
    empresa_id: v.empresa_id,
    funcionario_id: v.funcionario_id || null,
    passageiro_nome: v.passageiro_nome,
    tipo_servico: asTipoServico(v.tipo),
    valor_cotacao: venda,
    valor_final: venda,
    valor_venda: venda,
    valor_custo: custo,
    agente_user_id: v.emitido_por_user_id,
    status: v.status === 'cancelado' ? 'cancelado' : 'finalizado',
    prioridade: 'media',
    origem: v.origem_voucher === 'pdf' ? 'E-mail' : 'Portal',
    observacoes: joinUnique([
      v.observacoes,
      `Voucher ${v.id}${v.numero_confirmacao ? ` / confirmacao ${v.numero_confirmacao}` : ''}`,
    ], ' | ', 900),
    observacoes_internas: joinUnique([
      v.observacoes_internas,
      `voucher_fingerprint=${fingerprintVoucher(v)}`,
      v.arquivo_original_nome ? `arquivo=${v.arquivo_original_nome}` : '',
    ], ' | ', 1200),
    data_atendimento: v.data_confirmacao || v.importado_em?.slice(0, 10) || v.created_at?.slice(0, 10) || hojeISO(),
    voucher_ids: ids,
    origem_emissao: isWintourVoucher(v) ? 'wintour_planilha' : v.origem_voucher === 'pdf' ? 'voucher_pdf' : v.origem_voucher === 'importado' ? 'planilha' : 'manual',
    centro_custo: v.centro_custo,
    numero_solicitacao: v.numero_solicitacao,
    finalizado_em: v.status === 'cancelado' ? undefined : v.data_confirmacao || v.created_at,
    ...detalhesDoVoucher(v),
  }
}

function mergeAtendimentoVoucher(a: Atendimento, v: VoucherEmitido): Partial<Atendimento> {
  const patch = patchAtendimentoDoVoucher(v)
  const voucherIds = new Set([...(a.voucher_ids || []), v.id])
  return {
    ...patch,
    voucher_ids: Array.from(voucherIds),
    observacoes: joinUnique([a.observacoes, patch.observacoes], ' | ', 900),
    observacoes_internas: joinUnique([a.observacoes_internas, patch.observacoes_internas], ' | ', 1200),
  }
}

function isWintourVoucher(v: VoucherEmitido): boolean {
  return Boolean(
    v.fingerprint?.toLowerCase().includes('wintour') ||
    v.observacoes?.toLowerCase().includes('wintour') ||
    v.observacoes_internas?.toLowerCase().includes('wintour') ||
    v.arquivo_original_nome?.toLowerCase().includes('wintour'),
  )
}

export function sincronizarFinanceiroAtendimento(atendimento: Atendimento): ResultadoSincronizacaoFinanceira {
  if (typeof window === 'undefined') return {}
  if (!['finalizado', 'em_andamento', 'aguardando_cliente'].includes(atendimento.status)) return {}
  return gerarLancamentosDoAtendimento(atendimento, undefined)
}

async function sincronizarFinanceiroAtendimentoGovernado(
  atendimento: Atendimento,
): Promise<ResultadoSincronizacaoFinanceira> {
  if (!['finalizado', 'em_andamento', 'aguardando_cliente'].includes(atendimento.status)) {
    return {}
  }
  const stateFingerprint = [
    atendimento.updated_at || '',
    atendimento.status,
    atendimento.valor_venda || atendimento.valor_final || atendimento.valor_cotacao || 0,
    atendimento.valor_custo || 0,
  ].join('|')
  const result = await syncFinancialEntriesFromDemandsOnServer(
    [atendimento.id],
    createFinancialDemandSyncKey('voucher-governed', [atendimento.id], stateFingerprint),
  )
  return {
    receber: result.entries.find((entry) => entry.tipo === 'receber'),
    pagar: result.entries.find((entry) => entry.tipo === 'pagar'),
  }
}

export function sincronizarVoucherOperacional(
  voucher: VoucherEmitido,
  opts: { agente_user_id?: string; origem?: OrigemAtendimento } = {}
): ResultadoSincronizacaoVoucher {
  if (typeof window === 'undefined') return { criado: false, atualizado: false, financeiro: {} }

  const existentes = getAllAtendimentos()
  let atendimento = voucher.atendimento_id ? getAtendimentoById(voucher.atendimento_id) : undefined
  if (!atendimento) atendimento = existentes.find((a) => matchAtendimentoVoucher(a, voucher))

  if (atendimento) {
    const patch = mergeAtendimentoVoucher(atendimento, voucher)
    if (opts.agente_user_id && !atendimento.agente_user_id) patch.agente_user_id = opts.agente_user_id
    if (opts.origem && !atendimento.origem) patch.origem = opts.origem
    updateAtendimento(atendimento.id, patch)
    if (!voucher.atendimento_id) updateVoucherEmitido(voucher.id, { atendimento_id: atendimento.id })
    const atualizado = getAtendimentoById(atendimento.id) || { ...atendimento, ...patch }
    return {
      atendimento: atualizado,
      criado: false,
      atualizado: true,
      financeiro: sincronizarFinanceiroAtendimento(atualizado),
    }
  }

  const patch = patchAtendimentoDoVoucher(voucher)
  const novo = addAtendimento({
    ...(patch as Omit<Atendimento, 'id' | 'created_at' | 'updated_at'>),
    agente_user_id: opts.agente_user_id || patch.agente_user_id || 'usr-felipe-master',
    origem: opts.origem || patch.origem || 'Portal',
    valor_cotacao: patch.valor_cotacao || 0,
    observacoes: patch.observacoes || '',
    data_atendimento: patch.data_atendimento || hojeISO(),
  })

  if (novo) {
    updateVoucherEmitido(voucher.id, { atendimento_id: novo.id })
    return {
      atendimento: novo,
      criado: true,
      atualizado: false,
      financeiro: sincronizarFinanceiroAtendimento(novo),
    }
  }

  return { criado: false, atualizado: false, financeiro: {} }
}

export async function sincronizarVoucherOperacionalGovernado(
  voucher: VoucherEmitido,
  opts: { agente_user_id?: string; origem?: OrigemAtendimento } = {},
): Promise<ResultadoSincronizacaoVoucher> {
  if (typeof window === 'undefined') {
    return { criado: false, atualizado: false, financeiro: {} }
  }

  const existentes = getAllAtendimentos()
  let atendimento = voucher.atendimento_id ? getAtendimentoById(voucher.atendimento_id) : undefined
  if (!atendimento) atendimento = existentes.find((item) => matchAtendimentoVoucher(item, voucher))

  if (atendimento) {
    const patch = mergeAtendimentoVoucher(atendimento, voucher)
    if (opts.agente_user_id && !atendimento.agente_user_id) patch.agente_user_id = opts.agente_user_id
    if (opts.origem && !atendimento.origem) patch.origem = opts.origem
    const persisted = await persistDemandPatchWithCompatibility(
      atendimento,
      patch,
      `Sincronizacao do voucher ${voucher.id}`,
    )
    if (!voucher.atendimento_id) {
      await updateVoucherOnServer(
        voucher.id,
        { atendimento_id: persisted.demand.id },
        voucher.version,
      )
    }
    return {
      atendimento: persisted.demand,
      criado: false,
      atualizado: true,
      financeiro: await sincronizarFinanceiroAtendimentoGovernado(persisted.demand),
    }
  }

  const patch = patchAtendimentoDoVoucher(voucher)
  const prepared = criarAtendimentoParaLista({
    ...(patch as Omit<Atendimento, 'id' | 'created_at' | 'updated_at'>),
    agente_user_id: opts.agente_user_id || patch.agente_user_id || 'system-unassigned',
    origem: opts.origem || patch.origem || 'Portal',
    valor_cotacao: patch.valor_cotacao || 0,
    observacoes: patch.observacoes || '',
    data_atendimento: patch.data_atendimento || hojeISO(),
  }, existentes)
  const persisted = await persistNewDemandWithCompatibility(prepared, true)
  await updateVoucherOnServer(
    voucher.id,
    { atendimento_id: persisted.demand.id },
    voucher.version,
  )
  return {
    atendimento: persisted.demand,
    criado: true,
    atualizado: false,
    financeiro: await sincronizarFinanceiroAtendimentoGovernado(persisted.demand),
  }
}

export function sincronizarTudoOperacional(): ResultadoSincronizacaoGlobal {
  if (typeof window === 'undefined') {
    return { atendimentosFinanceiro: 0, vouchersCriados: 0, vouchersAtualizados: 0 }
  }

  let atendimentosFinanceiro = 0
  let vouchersCriados = 0
  let vouchersAtualizados = 0

  for (const atendimento of getAllAtendimentos()) {
    const r = sincronizarFinanceiroAtendimento(atendimento)
    if (r.receber || r.pagar) atendimentosFinanceiro++
  }

  for (const voucher of getAllVouchersEmitidos()) {
    const r = sincronizarVoucherOperacional(voucher)
    if (r.criado) vouchersCriados++
    if (r.atualizado) vouchersAtualizados++
  }

  return { atendimentosFinanceiro, vouchersCriados, vouchersAtualizados }
}
