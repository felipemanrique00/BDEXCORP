import type { Atendimento, Empresa, Funcionario, Hotel, VoucherEmitido } from '@/types'
import type { SupplierIntegration } from '@/lib/supplier-integrations'

export type UnifiedEntityKind = 'demanda' | 'voucher' | 'voucher_importado' | 'empresa' | 'funcionario' | 'hotel' | 'fornecedor'

export interface UnifiedEntity {
  kind: UnifiedEntityKind
  id: string
  title: string
  subtitle?: string
  href?: string
  searchText: string
  payload?: Record<string, any>
}

export function buildUnifiedIndex(ctx: {
  empresas: Empresa[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  atendimentos: Atendimento[]
  vouchers: VoucherEmitido[]
  fornecedores?: SupplierIntegration[]
}): UnifiedEntity[] {
  const empresasById = new Map(ctx.empresas.map((e) => [e.id, e]))
  const funcionariosById = new Map(ctx.funcionarios.map((f) => [f.id, f]))

  return [
    ...ctx.empresas.map((e) => ({
      kind: 'empresa' as const,
      id: e.id,
      title: e.nome,
      subtitle: e.responsavel || e.cnpj || undefined,
      href: '/dashboard/empresas',
      searchText: textoBusca([e.nome, e.cnpj, e.codigo_cliente, e.responsavel, e.email_responsavel, e.telefone]),
      payload: { cnpj: e.cnpj, telefone: e.telefone, ativa: e.ativa },
    })),
    ...ctx.funcionarios.map((f) => ({
      kind: 'funcionario' as const,
      id: f.id,
      title: f.nome,
      subtitle: empresasById.get(f.company_id)?.nome,
      href: '/dashboard/funcionarios',
      searchText: textoBusca([f.nome, f.cpf, f.email, f.telefone, f.cargo, f.centro_custo, empresasById.get(f.company_id)?.nome]),
      payload: { empresa_id: f.company_id, cpf: f.cpf, telefone: f.telefone, email: f.email },
    })),
    ...ctx.hoteis.map((h) => ({
      kind: 'hotel' as const,
      id: String(h.id),
      title: h.nome,
      subtitle: [h.cidade, h.uf].filter(Boolean).join('/'),
      href: `/dashboard/hoteis?busca=${encodeURIComponent(h.nome)}`,
      searchText: textoBusca([h.nome, h.cidade, h.uf, h.telefone, h.observacoes, h.info_faturamento]),
      payload: { cidade: h.cidade, uf: h.uf, telefone: h.telefone, faturado: h.faturado },
    })),
    ...(ctx.fornecedores || []).map((s) => ({
      kind: 'fornecedor' as const,
      id: s.id,
      title: s.nome,
      subtitle: [s.tipo, s.modo, s.status].filter(Boolean).join(' - '),
      href: '/dashboard/fornecedores',
      searchText: textoBusca([s.nome, s.tipo, s.status, s.modo, s.portal_url, s.observacoes, ...s.servicos, ...s.capacidades]),
      payload: { servicos: s.servicos, capacidades: s.capacidades, status: s.status, modo: s.modo },
    })),
    ...ctx.atendimentos.map((a) => ({
      kind: 'demanda' as const,
      id: a.id,
      title: a.passageiro_nome,
      subtitle: [a.tipo_servico, empresasById.get(a.empresa_id)?.nome, a.status].filter(Boolean).join(' - '),
      href: '/dashboard/demandas',
      searchText: textoBusca([
        a.passageiro_nome,
        a.serial_os,
        a.tipo_servico,
        a.status,
        a.prioridade,
        a.observacoes,
        empresasById.get(a.empresa_id)?.nome,
        funcionariosById.get(a.funcionario_id || '')?.nome,
        a.detalhes_hotel?.hotel_nome,
        a.detalhes_hotel?.cidade,
        a.detalhes_hotel?.data_checkin,
        a.detalhes_aereo?.destino,
        a.detalhes_aereo?.data_ida,
        a.venda_numero,
        a.numero_solicitacao,
      ]),
      payload: {
        serial_os: a.serial_os,
        empresa_id: a.empresa_id,
        funcionario_id: a.funcionario_id,
        data: a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida || a.data_atendimento,
        voucher_ids: a.voucher_ids || [],
      },
    })),
    ...ctx.vouchers.map((v) => ({
      kind: (v.origem_voucher === 'importado' || v.origem_voucher === 'pdf' ? 'voucher_importado' : 'voucher') as UnifiedEntityKind,
      id: v.id,
      title: `${v.id} - ${v.passageiro_nome}`,
      subtitle: [v.fornecedor_nome, v.fornecedor_cidade, empresasById.get(v.empresa_id)?.nome].filter(Boolean).join(' - '),
      href: `/dashboard/vouchers/${v.id}`,
      searchText: textoBusca([
        v.id,
        v.numero,
        v.passageiro_nome,
        ...(v.passageiros || []),
        v.fornecedor_nome,
        v.fornecedor_cidade,
        v.fornecedor_telefone,
        v.data_checkin,
        v.data_ida,
        v.numero_confirmacao,
        v.localizador,
        v.arquivo_original_nome,
        empresasById.get(v.empresa_id)?.nome,
        funcionariosById.get(v.funcionario_id || '')?.nome,
      ]),
      payload: {
        empresa_id: v.empresa_id,
        funcionario_id: v.funcionario_id,
        atendimento_id: v.atendimento_id,
        origem_voucher: v.origem_voucher,
        data: v.data_checkin || v.data_ida || v.created_at?.slice(0, 10),
      },
    })),
  ]
}

export function searchUnifiedIndex(query: string, index: UnifiedEntity[], limit = 12): UnifiedEntity[] {
  const terms = normalizar(query).split(' ').filter((t) => t.length > 2)
  if (!terms.length) return index.slice(0, limit)

  return index
    .map((item) => {
      const haystack = normalizar(`${item.title} ${item.subtitle || ''} ${item.searchText}`)
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 20 : 0), 0) + (haystack.includes(normalizar(query)) ? 60 : 0)
      return { item, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item)
}

function textoBusca(values: Array<string | number | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function normalizar(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
