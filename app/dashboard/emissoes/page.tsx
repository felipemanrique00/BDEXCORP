'use client'
import { todayISODate } from '@/lib/date'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  FileSpreadsheet, FileText, CheckCircle2, Users, Building2, Loader2, Sparkles,
  CloudDownload, Link2, ShieldCheck,
} from 'lucide-react'
import type { ResumoEmissao, LinhaEmissao } from '@/lib/emissoes-parser'
import type { ResumoEmissaoPDF, LinhaEmissaoPDF } from '@/lib/emissoes-pdf-parser'
import { useStore } from '@/lib/store'
import {
  atualizarAtendimentoNaLista,
  criarAtendimentoParaLista,
  getAllAtendimentos,
  persistirAtendimentos,
  persistirAtendimentosRecebidosDoServidor,
  registrarLog,
} from '@/lib/atendimentos-storage'
import {
  createDemandImportBatchKey,
  DemandClientError,
  importDemandBatchesOnServer,
} from '@/lib/demands-client'
import {
  createFinancialDemandSyncKey,
  syncFinancialEntriesFromDemandsOnServer,
} from '@/lib/finance-persistence-client'
import { gerarLancamentosDosAtendimentos } from '@/lib/financeiro'
import {
  createVoucherBatchKey,
  upsertVoucherBatchOnServer,
} from '@/lib/voucher-persistence-client'
import { voucherFromImportedEmission } from '@/lib/emissions/imported-emission-voucher'
import { getCurrentUser, hasPermission, getAgentesBBT } from '@/lib/auth'
import { formatCurrency } from '@/lib/utils'
import { encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'
import { normalizeExternalCompanyName } from '@/lib/integrations/company-mapping'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import type { Atendimento, Empresa, VoucherEmitido } from '@/types'
import type { TechEmissionRecord, TechEmissionsReport } from '@/lib/integrations/tech/tech-emissions-types'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { DateInput } from '@/components/ui/date-input'

const SKIP_TECH_CLIENT = '__skip__'

interface LinhaUnif {
  venda_numero: string
  data_venda: string
  passageiro: string
  tipo_servico: Atendimento['tipo_servico']
  empresa_nome: string
  empresa_id?: string
  cod_cliente?: string
  total: number
  custo: number
  markup?: number
  cod_emissor?: string
  status: string
  descricao?: string
  produto?: string
  tech?: TechEmissionRecord
}

// Tipo unificado para ambos os formatos
type ResumoUnif = {
  formato: 'xlsx' | 'pdf' | 'tech'
  total_vendas: number
  total_tarifa?: number
  total_faturado?: number
  total_custo?: number
  total_markup?: number
  total_lucro?: number
  por_emissor: Record<string, { qtd: number; lucro: number }>
  por_cliente: Record<string, { qtd: number; lucro: number }>
  por_produto?: Record<string, { qtd: number; lucro: number }>
  periodo_detectado: { inicio?: string; fim?: string; startDate?: string; endDate?: string } | string
  linhasXLSX?: LinhaEmissao[]
  linhasPDF?: LinhaEmissaoPDF[]
  linhasTech?: TechEmissionRecord[]
}

export default function ImportarEmissoesPage() {
  const router = useRouter()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas, funcionarios } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const empresasPermitidasImportacao = useMemo(
    () => empresas.filter((empresa) => (
      includesCompany(empresa.id, 'importar_planilhas') && includesCompany(empresa.id, 'criar_demandas')
    )),
    [empresas, includesCompany],
  )

  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [resumo, setResumo] = useState<ResumoUnif | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ criadas: number; atualizadas: number; ignoradas: number } | null>(null)
  const [techStartDate, setTechStartDate] = useState(() => daysAgoISO(30))
  const [techEndDate, setTechEndDate] = useState(() => todayISODate())
  const [techLoading, setTechLoading] = useState(false)
  const [techCompanyMappings, setTechCompanyMappings] = useState<Record<string, string>>({})

  // check permissão
  if (user && (!hasPermission(user, 'importar_planilhas') || empresasPermitidasImportacao.length === 0)) {
    return <div className="p-8 text-center text-red-600">Você não tem permissão para importar planilhas.</div>
  }

  async function handleFile(f: File) {
    setFile(f)
    setLoading(true)
    setResumo(null)
    setResultado(null)
    try {
      const ext = f.name.toLowerCase().split('.').pop()
      if (ext === 'pdf') {
        const { parsePDFEmissoes } = await import('@/lib/emissoes-pdf-parser')
        const r = await parsePDFEmissoes(f)
        setResumo({
          formato: 'pdf',
          total_vendas: r.total_vendas,
          total_tarifa: r.total_faturado,
          total_faturado: r.total_faturado,
          total_custo: r.total_custo,
          total_markup: r.total_markup,
          total_lucro: r.total_markup,
          por_emissor: r.por_emissor,
          por_cliente: r.por_cliente,
          por_produto: r.por_produto,
          periodo_detectado: r.periodo_detectado,
          linhasPDF: r.linhas,
        })
        toast.success(`${r.total_vendas} venda(s) detectada(s) no PDF`)
      } else {
        const { parsePlanilhaEmissoes } = await import('@/lib/emissoes-parser')
        const r = await parsePlanilhaEmissoes(f)
        setResumo({
          formato: 'xlsx',
          total_vendas: r.total_vendas,
          total_tarifa: r.total_tarifa,
          total_faturado: r.total_tarifa,
          total_custo: r.total_custo,
          total_markup: r.total_markup,
          total_lucro: r.total_lucro,
          por_emissor: r.por_emissor,
          por_cliente: r.por_cliente,
          periodo_detectado: r.periodo_detectado || '',
          linhasXLSX: r.linhas,
        })
        toast.success(`${r.total_vendas} venda(s) detectada(s) na planilha`)
      }
    } catch (e: any) {
      console.error(e)
      toast.error('Erro ao ler arquivo: ' + (e?.message || 'formato inválido'))
    } finally {
      setLoading(false)
    }
  }

  async function consultarTechTravel() {
    if (!techStartDate || !techEndDate || techEndDate < techStartDate) {
      toast.error('Informe um período válido para consultar a Tech Travel.')
      return
    }
    setTechLoading(true)
    setResumo(null)
    setResultado(null)
    try {
      const response = await fetch('/api/integrations/tech/emissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: techStartDate, endDate: techEndDate }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.report) {
        throw new Error(payload?.error || 'A Tech Travel não retornou o relatório de emissões.')
      }

      const report = payload.report as TechEmissionsReport
      const savedMappings = await loadTechCompanyMappings()
      const mappings: Record<string, string> = {}
      for (const clientName of Object.keys(report.byClient)) {
        const centrallyMapped = empresasPermitidasImportacao.filter((empresa) =>
          (empresa.tech_travel_client_names || []).some((alias) => normalizeCompanyName(alias) === normalizeCompanyName(clientName)),
        )
        if (centrallyMapped.length === 1) {
          mappings[clientName] = centrallyMapped[0].id
          continue
        }
        const savedCompanyId = savedMappings[normalizeExternalCompanyName(clientName)]
        if (savedCompanyId && empresasPermitidasImportacao.some((empresa) => empresa.id === savedCompanyId)) {
          mappings[clientName] = savedCompanyId
          continue
        }
        const exactMatches = empresasPermitidasImportacao.filter((empresa) => normalizeCompanyName(empresa.nome) === normalizeCompanyName(clientName))
        if (exactMatches.length === 1) mappings[clientName] = exactMatches[0].id
      }
      setTechCompanyMappings(mappings)
      setResumo({
        formato: 'tech',
        total_vendas: report.total,
        total_tarifa: report.totals.customer,
        total_faturado: report.totals.customer,
        total_custo: report.totals.supplier,
        total_markup: report.totals.result,
        total_lucro: report.totals.result,
        por_emissor: Object.fromEntries(Object.entries(report.byIssuer).map(([key, value]) => [key, { qtd: value.count, lucro: value.customerTotal - value.supplierTotal }])),
        por_cliente: Object.fromEntries(Object.entries(report.byClient).map(([key, value]) => [key, { qtd: value.count, lucro: value.customerTotal - value.supplierTotal }])),
        por_produto: Object.fromEntries(Object.entries(report.byService).map(([key, value]) => [key, { qtd: value.count, lucro: value.customerTotal - value.supplierTotal }])),
        periodo_detectado: report.period,
        linhasTech: report.emissions,
      })
      toast.success(`${report.total} emissão(ões) carregada(s) diretamente da Tech Travel.`)
    } catch (error) {
      console.error('[tech-emissions]', error)
      toast.error(error instanceof Error ? error.message : 'Falha ao consultar a Tech Travel.')
    } finally {
      setTechLoading(false)
    }
  }

  async function atualizarMapeamentoTech(clientName: string, companyId: string) {
    try {
      const response = await fetch('/api/integrations/tech/emission-company-mappings', {
        method: !companyId || companyId === SKIP_TECH_CLIENT ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalName: clientName,
          ...(!companyId || companyId === SKIP_TECH_CLIENT ? {} : { companyId }),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Nao foi possivel salvar o mapeamento da empresa.')
      }
      setTechCompanyMappings((current) => ({
        ...current,
        [clientName]: companyId,
      }))
    } catch (error) {
      console.error('[tech-company-mapping]', error)
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar o mapeamento da empresa.')
    }
  }

  /**
   * Mapeia cada linha para:
   * - Empresa (pelo Cod. Cliente ou Nome Cliente)
   * - Funcionário (pelo nome do Pax)
   * - Agente (pelo código emissor)
   * E cria/atualiza o Atendimento
   */
  async function importar() {
    if (!resumo || !user) return
    if (resumo.formato === 'tech') {
      const unresolved = Object.keys(resumo.por_cliente).filter((clientName) => !techCompanyMappings[clientName])
      if (unresolved.length > 0) {
        toast.error('Mapeie todos os clientes da Tech Travel antes de importar.')
        return
      }
    }
    setImportando(true)

    const existentes = getAllAtendimentos()
    const proximaLista = existentes.slice()
    const indexById = new Map(proximaLista.map((atendimento, index) => [atendimento.id, index]))
    const byCompanyAndSale = new Map<string, Atendimento>()
    const byTechExternalId = new Map<string, Atendimento>()
    for (const atendimento of proximaLista) {
      if (atendimento.venda_numero) byCompanyAndSale.set(emissionSaleKey(atendimento.empresa_id, atendimento.venda_numero), atendimento)
      const techId = String(atendimento.wintour_dados?.tech_emission_id || '')
      if (techId) byTechExternalId.set(techId, atendimento)
    }
    const agentes = getAgentesBBT()
    const demandasAlteradas = new Map<string, Atendimento>()
    const vouchersParaSalvar = new Map<string, VoucherEmitido>()
    let demandasPersistidasRelacionalmente = false

    let criadas = 0, atualizadas = 0, ignoradas = 0

    try {
      const linhas: LinhaUnif[] = resumo.formato === 'tech'
        ? (resumo.linhasTech || []).map((emission) => ({
            venda_numero: emission.saleNumber,
            data_venda: dateOnly(emission.issuedAt) || dateOnly(emission.createdAt) || todayISODate(),
            passageiro: emission.passengerName,
            tipo_servico: emission.service,
            empresa_nome: emission.clientName,
            empresa_id: techCompanyMappings[emission.clientName],
            total: emission.customerTotal,
            custo: emission.supplierTotal,
            cod_emissor: emission.issuer,
            status: emission.cancelled ? 'CA' : 'CF',
            descricao: emission.route || emission.supplier,
            produto: emission.supplier || emission.system,
            tech: emission,
          }))
        : resumo.formato === 'pdf'
          ? (resumo.linhasPDF || []).map((l) => ({
            venda_numero: l.venda_numero,
            data_venda: l.data_venda,
            passageiro: l.passageiro,
            tipo_servico: l.tipo_servico,
            empresa_nome: l.cliente_nome,
            cod_cliente: l.cod_cliente,
            total: l.total,
            custo: l.custo,
            markup: l.markup,
            cod_emissor: l.emissor,
            status: l.status,
            descricao: l.rota_descricao,
            produto: l.produto,
          }))
          : (resumo.linhasXLSX || []).filter((l) => l.valido).map((l) => ({
            venda_numero: l.venda_numero,
            data_venda: l.data_venda,
            passageiro: l.pax,
            tipo_servico: l.tipo_servico === 'Outro' ? 'Hotel' : l.tipo_servico,
            empresa_nome: l.nome_cliente,
            cod_cliente: l.cod_cliente,
            total: l.total_tarifa,
            custo: l.saldo_pagar,
            markup: l.markup,
            cod_emissor: l.cod_emissor,
            status: l.status || 'CF',
            descricao: l.rota_resumida,
            produto: l.contrato,
          }))

      for (const linha of linhas) {
        if (!linha.passageiro || !linha.venda_numero) { ignoradas++; continue }
        if (linha.empresa_id === SKIP_TECH_CLIENT) { ignoradas++; continue }

        let empresa = linha.empresa_id ? empresasPermitidasImportacao.find((item) => item.id === linha.empresa_id) : undefined
        if (!empresa && linha.cod_cliente) {
          empresa = empresasPermitidasImportacao.find((e) =>
            (e.codigo_cliente || '').toLowerCase() === linha.cod_cliente!.toLowerCase()
          )
        }
        if (!empresa && linha.empresa_nome) {
          empresa = findCompanyByExternalName(empresasPermitidasImportacao, linha.empresa_nome)
        }
        if (!empresa) { ignoradas++; continue }

        const matchFuncionario = encontrarFuncionarioPorNomeInteligente(funcionarios, linha.passageiro, empresa.id, 84)
        const matchedFuncionarioId = matchFuncionario && !matchFuncionario.ambiguo ? matchFuncionario.funcionario.id : null

        let agenteUserId = user.id
        if (linha.cod_emissor) {
          const emissorNorm = linha.cod_emissor.toLowerCase()
          const ag = agentes.find((a) =>
            a.name.toLowerCase().split(' ')[0] === emissorNorm ||
            a.name.toLowerCase().includes(emissorNorm)
          )
          if (ag) agenteUserId = ag.id
        }

        const existente = linha.tech
          ? byTechExternalId.get(linha.tech.externalId) || byCompanyAndSale.get(emissionSaleKey(empresa.id, linha.venda_numero))
          : byCompanyAndSale.get(emissionSaleKey(empresa.id, linha.venda_numero))
        if (existente) agenteUserId = existente.agente_user_id || agenteUserId

        let dataCheckin: string | undefined
        let dataCheckout: string | undefined
        if (linha.tech?.segments[0]) {
          dataCheckin = dateOnly(linha.tech.segments[0].departureAt)
          dataCheckout = dateOnly(linha.tech.segments[0].arrivalAt)
        } else if (linha.descricao) {
          const m = linha.descricao.match(/(\d{2}\/\d{2}\/\d{2,4})\s*a\s*(\d{2}\/\d{2}\/\d{2,4})/)
          if (m) {
            const parseD = (s: string) => {
              const [d, mo, y] = s.split('/')
              const yyyy = y.length === 2 ? '20' + y : y
              return `${yyyy}-${mo}-${d}`
            }
            dataCheckin = parseD(m[1])
            dataCheckout = parseD(m[2])
          }
        }

        const firstSegment = linha.tech?.segments[0]
        const lastSegment = linha.tech?.segments.at(-1)
        const payload: Partial<Atendimento> = {
          empresa_id: empresa.id,
          funcionario_id: matchedFuncionarioId || existente?.funcionario_id || null,
          passageiro_nome: linha.passageiro,
          tipo_servico: linha.tipo_servico,
          valor_cotacao: linha.total,
          valor_final: linha.total,
          valor_custo: linha.custo,
          valor_venda: linha.total,
          markup_valor: linha.tech ? linha.total - linha.custo : linha.markup,
          agente_user_id: agenteUserId,
          status: linha.status === 'CA' ? 'cancelado' : linha.status === 'CF' ? 'finalizado' : linha.status === 'ND' ? 'em_andamento' : 'finalizado',
          prioridade: 'media',
          origem: linha.tech ? 'Outro' : 'Portal',
          observacoes: `${linha.tech ? 'Importado pela API Tech Travel' : `Importado via ${resumo.formato.toUpperCase()}`}. ${linha.descricao || ''}`.slice(0, 500),
          data_atendimento: linha.data_venda || todayISODate(),
          venda_numero: linha.venda_numero,
          emissor_codigo: linha.cod_emissor,
          solicitante_nome: linha.tech?.requester,
          autorizador_nome: linha.tech?.approver,
          centro_custo: linha.tech?.costCenter,
          numero_solicitacao: linha.tech?.osNumber,
          motivo: linha.tech?.reason,
          observacoes_internas: linha.tech ? [
            linha.tech.policyName ? `Política: ${linha.tech.policyName}` : '',
            linha.tech.justification ? `Justificativa: ${linha.tech.justification}` : '',
          ].filter(Boolean).join(' | ') || undefined : existente?.observacoes_internas,
          origem_emissao: linha.tech ? 'tech_travel_api' : resumo.formato === 'pdf' ? 'pdf_emissao' : 'planilha',
          wintour_dados: linha.tech ? {
            ...existente?.wintour_dados,
            ...buildTechMetadata(linha.tech),
          } : existente?.wintour_dados,
          detalhes_hotel: linha.tipo_servico === 'Hotel' ? {
            ...existente?.detalhes_hotel,
            hotel_nome: linha.produto || '',
            cidade: linha.tech?.route || firstSegment?.destination,
            num_hospedes: 1,
            data_checkin: dataCheckin,
            data_checkout: dataCheckout,
            tarifa_unitaria: linha.tech?.hotelDailyRate,
            localizador: linha.tech?.locator,
          } : undefined,
          detalhes_aereo: linha.tipo_servico === 'Aéreo' ? {
            ...existente?.detalhes_aereo,
            origem: firstSegment?.origin,
            destino: lastSegment?.destination || firstSegment?.destination,
            data_ida: dateOnly(firstSegment?.departureAt),
            data_volta: linha.tech && linha.tech.segments.length > 1 ? dateOnly(lastSegment?.departureAt) : undefined,
            data_compra: dateOnly(linha.tech?.createdAt),
            data_emissao: dateOnly(linha.tech?.issuedAt),
            cia_aerea: linha.produto,
            localizador: linha.tech?.locator,
            numero_bilhete: linha.tech?.ticket,
            numero_voo: firstSegment?.flightNumber,
            tarifa: linha.tech?.customerFare,
            taxas: linha.tech?.customerTaxes,
            status_bilhete: linha.tech?.cancelled ? 'Cancelado' : linha.tech?.osStatus,
          } : undefined,
        }

        let atendimentoSalvo: Atendimento | null = null
        if (existente) {
          const atualizado = atualizarAtendimentoNaLista(proximaLista, existente.id, payload, indexById)
          if (atualizado) {
            atualizadas++
            atendimentoSalvo = atualizado
            byCompanyAndSale.set(emissionSaleKey(empresa.id, linha.venda_numero), atualizado)
            if (linha.tech) byTechExternalId.set(linha.tech.externalId, atualizado)
          } else {
            ignoradas++
          }
        } else {
          const nova = criarAtendimentoParaLista(payload as Parameters<typeof criarAtendimentoParaLista>[0], proximaLista)
          proximaLista.push(nova)
          indexById.set(nova.id, proximaLista.length - 1)
          byCompanyAndSale.set(emissionSaleKey(empresa.id, linha.venda_numero), nova)
          if (linha.tech) byTechExternalId.set(linha.tech.externalId, nova)
          atendimentoSalvo = nova
          criadas++
        }

        if (atendimentoSalvo) {
          const voucher = voucherFromImportedEmission(
            linha,
            atendimentoSalvo,
            matchedFuncionarioId || atendimentoSalvo.funcionario_id || null,
            resumo.formato,
            { id: user.id, name: user.name },
          )
          const voucherIds = new Set([...(atendimentoSalvo.voucher_ids || []), voucher.id])
          atendimentoSalvo.voucher_ids = [...voucherIds]
          vouchersParaSalvar.set(voucher.id, voucher)
          demandasAlteradas.set(atendimentoSalvo.id, atendimentoSalvo)
        }
      }

      if (demandasAlteradas.size > 0) {
        const demandasDoLote = Array.from(demandasAlteradas.values())
        try {
          const importacao = await importDemandBatchesOnServer(
            demandasDoLote,
            resumo.formato === 'tech' ? 'tech_travel' : 'emissions',
            createDemandImportBatchKey(
              resumo.formato === 'tech' ? 'tech_travel' : 'emissions',
              demandasDoLote,
            ),
          )
          const retornadas = new Map(importacao.demands.map((demanda) => [demanda.id, demanda]))
          const listaSincronizada = proximaLista.map((demanda) => retornadas.get(demanda.id) || demanda)
          if (!persistirAtendimentosRecebidosDoServidor(listaSincronizada)) {
            toast.warning('As emissoes foram salvas no servidor, mas o cache local sera renovado ao recarregar.')
          }
          criadas = importacao.inserted
          atualizadas = importacao.updated
          ignoradas += importacao.skipped
          demandasPersistidasRelacionalmente = true
        } catch (error) {
          if (!(error instanceof DemandClientError) || error.code !== 'DEMAND_RELATIONAL_WRITE_DISABLED') {
            throw error
          }
          if (!persistirAtendimentos(proximaLista)) {
            throw new Error('Não foi possível persistir as emissões no modo legado.')
          }
          await commitPendingRemoteStorage()
        }
      }

      const demandasDoLote = Array.from(demandasAlteradas.values())
      if (demandasDoLote.length > 0) {
        if (demandasPersistidasRelacionalmente) {
          const ids = demandasDoLote.map((demanda) => demanda.id)
          const stateFingerprint = demandasDoLote
            .map((demanda) => [
              demanda.id,
              demanda.updated_at || '',
              demanda.status,
              demanda.valor_venda || demanda.valor_final || demanda.valor_cotacao || 0,
              demanda.valor_custo || 0,
            ].join('|'))
            .sort()
            .join('\n')
          await syncFinancialEntriesFromDemandsOnServer(
            ids,
            createFinancialDemandSyncKey(
              resumo.formato === 'tech' ? 'tech-travel' : 'emissions',
              ids,
              stateFingerprint,
            ),
          )

          const vouchersDoLote = [...vouchersParaSalvar.values()]
          if (vouchersDoLote.length > 0) {
            await upsertVoucherBatchOnServer(
              vouchersDoLote,
              createVoucherBatchKey(
                resumo.formato === 'tech' ? 'tech-travel-emissions' : 'emissions',
                vouchersDoLote,
              ),
            )
          }
        } else {
          gerarLancamentosDosAtendimentos(demandasDoLote)
        }
      }

      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'importar',
        entidade: 'Emissoes', entidade_id: typeof resumo.periodo_detectado === 'string' ? resumo.periodo_detectado : JSON.stringify(resumo.periodo_detectado),
        descricao: `Importou ${criadas} novas, atualizou ${atualizadas}, ignorou ${ignoradas} via ${resumo.formato.toUpperCase()}.`,
      })

      setResultado({ criadas, atualizadas, ignoradas })
      toast.success(`${criadas} novas · ${atualizadas} atualizadas · ${ignoradas} ignoradas`, { duration: 5000 })
    } catch (e: any) {
      console.error(e)
      toast.error('Erro na importação: ' + e?.message)
    } finally {
      setImportando(false)
    }
  }

  function resetar() {
    setFile(null); setResumo(null); setResultado(null); setTechCompanyMappings({})
  }

  const techClients = resumo?.formato === 'tech' ? Object.keys(resumo.por_cliente).sort((left, right) => left.localeCompare(right)) : []
  const unresolvedTechClients = techClients.filter((clientName) => !techCompanyMappings[clientName])

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Importação · Vendas</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <FileSpreadsheet className="w-6 h-6 text-bbt-accent" /> Importação de Emissões
          </h1>
          <p className="bbt-page-subtitle">
            Consulte a Tech Travel ou importe arquivos de emissão sem duplicar vendas existentes.
          </p>
        </div>
      </div>

      <div className="bbt-card p-4 bg-gradient-to-br from-bbt-accent/5 to-transparent border-bbt-accent/30">
        <div className="flex gap-3">
          <Sparkles className="w-5 h-5 text-bbt-accent shrink-0 mt-0.5" />
          <div className="text-sm space-y-1.5">
            <div className="font-semibold text-bbt-primary dark:text-white">Consolidação protegida</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              A consulta da Tech Travel ocorre no servidor. Passageiros são vinculados pelo cadastro e clientes externos exigem mapeamento explícito.
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Reimportações atualizam a mesma emissão pela identificação estável da Tech e pela empresa, preservando o histórico operacional.
            </div>
          </div>
        </div>
      </div>

      {!resumo ? (
        <div className="space-y-4">
          <section className="bbt-card p-5" aria-labelledby="tech-travel-emissions-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                  <CloudDownload className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 id="tech-travel-emissions-title" className="font-semibold text-bbt-primary dark:text-white">Tech Travel · Emissões</h2>
                  <p className="mt-1 text-xs text-slate-500">Relatório oficial por período, com valores, políticas, OS, passageiros e trechos.</p>
                </div>
              </div>
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_auto] lg:w-auto">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <label htmlFor="tech-travel-start-date">Início</label>
                  <DateInput id="tech-travel-start-date" aria-label="Data inicial do relatório Tech Travel" value={techStartDate} onChange={(event) => setTechStartDate(event.target.value)} className="bbt-input mt-1 w-full" />
                </div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <label htmlFor="tech-travel-end-date">Fim</label>
                  <DateInput id="tech-travel-end-date" aria-label="Data final do relatório Tech Travel" value={techEndDate} onChange={(event) => setTechEndDate(event.target.value)} className="bbt-input mt-1 w-full" />
                </div>
                <button type="button" onClick={consultarTechTravel} disabled={techLoading} className="bbt-button-primary flex h-10 items-center justify-center gap-2 self-end disabled:cursor-not-allowed disabled:opacity-60">
                  {techLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                  Consultar
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-bbt-gray-100 pt-3 text-xs text-slate-500 dark:border-slate-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Credencial protegida no servidor; nenhum token é enviado ao navegador.
            </div>
          </section>

          <div className="flex items-center gap-3 text-xs font-semibold uppercase text-slate-400">
            <span className="h-px flex-1 bg-bbt-gray-100 dark:bg-slate-700" />
            Importação por arquivo
            <span className="h-px flex-1 bg-bbt-gray-100 dark:bg-slate-700" />
          </div>

          <label className="bbt-card p-10 text-center cursor-pointer hover:border-bbt-accent hover:bg-bbt-accent/5 transition block border-2 border-dashed border-bbt-gray-100 dark:border-slate-700">
          {loading ? (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-bbt-accent mb-3 animate-spin" />
              <p className="font-semibold text-bbt-primary dark:text-white">Analisando arquivo...</p>
              <p className="text-xs text-slate-500 mt-1">Extraindo linhas de emissão</p>
            </>
          ) : (
            <>
              <div className="flex justify-center gap-3 mb-3">
                <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
                <FileText className="w-10 h-10 text-red-500" />
              </div>
              <p className="font-semibold text-bbt-primary dark:text-white">Clique para selecionar o arquivo</p>
              <p className="text-xs text-slate-500 mt-1">.xlsx, .xls ou .pdf · extraído do seu sistema de emissão</p>
              <p className="text-[10px] text-slate-400 mt-2">PDF recomendado — mostra valores detalhados (Tarifa, Custo, Markup)</p>
            </>
          )}
          <input type="file" accept=".xlsx,.xls,.pdf" disabled={loading}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden" />
          </label>
        </div>
      ) : (
        <div className="space-y-5">
          {/* RESUMO */}
          <div className="bbt-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-bbt-primary dark:text-white">
                Resumo {resumo.formato === 'tech' ? 'da Tech Travel' : resumo.formato === 'pdf' ? 'do PDF' : 'da planilha'}
                {resumo.periodo_detectado && typeof resumo.periodo_detectado === 'object' && (resumo.periodo_detectado.inicio || resumo.periodo_detectado.startDate) && (
                  <span className="ml-2 text-xs text-slate-500 font-normal">
                    Período: {resumo.periodo_detectado.inicio || resumo.periodo_detectado.startDate} → {resumo.periodo_detectado.fim || resumo.periodo_detectado.endDate}
                  </span>
                )}
                {typeof resumo.periodo_detectado === 'string' && (
                  <span className="ml-2 text-xs text-slate-500 font-normal">Período: {resumo.periodo_detectado}</span>
                )}
              </h3>
              <button onClick={resetar} className="text-xs text-red-600 hover:underline">{resumo.formato === 'tech' ? 'Nova consulta' : 'Trocar arquivo'}</button>
            </div>

            <div className={`grid grid-cols-2 gap-3 mb-4 ${resumo.formato === 'tech' ? 'md:grid-cols-4' : 'md:grid-cols-5'}`}>
              <Stat label="Emissões" value={String(resumo.total_vendas)} color="bbt" />
              <Stat label={resumo.formato === 'tech' ? 'Valor cliente' : 'Tarifa Total'} value={formatCurrency(resumo.total_tarifa)} color="blue" />
              <Stat label={resumo.formato === 'tech' ? 'Valor fornecedor' : 'Custo Total'} value={formatCurrency(resumo.total_custo)} color="orange" />
              {resumo.formato === 'tech' ? (
                <Stat label="Resultado bruto" value={formatCurrency(resumo.total_lucro)} color="green" highlight />
              ) : (
                <>
                  <Stat label="Markup" value={formatCurrency(resumo.total_markup)} color="green" />
                  <Stat label="Lucro Previsto" value={formatCurrency(resumo.total_lucro)} color="bbt" highlight />
                </>
              )}
            </div>

            {/* Por emissor */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Por Emissor
                </h4>
                <div className="space-y-1">
                  {(Object.entries(resumo.por_emissor) as Array<[string, {qtd: number; lucro: number}]>).sort((a, b) => b[1].lucro - a[1].lucro).slice(0, 6).map(([emissor, v]) => (
                    <div key={emissor} className="flex justify-between text-xs p-2 rounded bg-bbt-gray-50 dark:bg-slate-800">
                      <span className="font-medium">{emissor}</span>
                      <span className="text-slate-500">{v.qtd} · {formatCurrency(v.lucro)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2 flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Top Clientes
                </h4>
                <div className="space-y-1">
                  {(Object.entries(resumo.por_cliente) as Array<[string, {qtd: number; lucro: number}]>).sort((a, b) => b[1].lucro - a[1].lucro).slice(0, 6).map(([cli, v]) => (
                    <div key={cli} className="flex justify-between text-xs p-2 rounded bg-bbt-gray-50 dark:bg-slate-800">
                      <span className="font-medium truncate">{cli}</span>
                      <span className="text-slate-500 shrink-0 ml-2">{v.qtd} · {formatCurrency(v.lucro)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {resumo.formato === 'tech' && (
            <section className="bbt-card p-5" aria-labelledby="tech-company-mapping-title">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="tech-company-mapping-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
                    <Link2 className="h-4 w-4 text-bbt-accent" /> Vincular clientes às empresas
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">O vínculo fica salvo no cadastro compartilhado da empresa para as próximas consultas.</p>
                </div>
                {unresolvedTechClients.length > 0 && (
                  <Link href="/dashboard/empresas" className="text-xs font-semibold text-bbt-accent hover:underline">Cadastrar empresa</Link>
                )}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {techClients.map((clientName) => (
                  <label key={clientName} className="grid gap-1 rounded-lg border border-bbt-gray-100 p-3 text-xs dark:border-slate-700">
                    <span className="flex items-center justify-between gap-3 font-semibold text-slate-700 dark:text-slate-200">
                      <span className="truncate" title={clientName}>{clientName}</span>
                      <span className="shrink-0 font-normal text-slate-400">{resumo.por_cliente[clientName]?.qtd || 0} emissão(ões)</span>
                    </span>
                    <select
                      aria-label={`Empresa correspondente a ${clientName}`}
                      value={techCompanyMappings[clientName] || ''}
                      onChange={(event) => atualizarMapeamentoTech(clientName, event.target.value)}
                      className="bbt-input w-full"
                    >
                      <option value="">Selecione a empresa correta</option>
                      {empresasPermitidasImportacao.filter((empresa) => empresa.ativa).map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
                      <option value={SKIP_TECH_CLIENT}>Não importar este cliente</option>
                    </select>
                  </label>
                ))}
              </div>
              {unresolvedTechClients.length > 0 && (
                <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Existem {unresolvedTechClients.length} cliente(s) sem vínculo. Selecione uma empresa ou marque para não importar.
                </p>
              )}
            </section>
          )}

          {/* PREVIEW DE LINHAS */}
          <div className="bbt-card overflow-hidden">
            <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
              <h4 className="font-semibold text-sm">Preview — primeiras 10 linhas</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-bbt-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">Venda</th>
                    <th className="px-2 py-2 text-left font-semibold">Data</th>
                    <th className="px-2 py-2 text-left font-semibold">Cliente</th>
                    <th className="px-2 py-2 text-left font-semibold">Pax</th>
                    <th className="px-2 py-2 text-left font-semibold">Prod.</th>
                    <th className="px-2 py-2 text-right font-semibold">Tarifa</th>
                    <th className="px-2 py-2 text-right font-semibold">Custo</th>
                    <th className="px-2 py-2 text-right font-semibold">Lucro</th>
                    <th className="px-2 py-2 text-left font-semibold">Emissor</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const linhasPreview: Array<{
                      venda_numero: string
                      data_venda: string
                      cliente: string
                      pax: string
                      produto: string
                      total: number
                      custo: number
                      markup: number
                      emissor: string
                    }> = resumo.formato === 'tech'
                      ? (resumo.linhasTech || []).map((emission) => ({
                          venda_numero: emission.saleNumber,
                          data_venda: dateOnly(emission.issuedAt) || '-',
                          cliente: emission.clientName,
                          pax: emission.passengerName,
                          produto: emission.service,
                          total: emission.customerTotal,
                          custo: emission.supplierTotal,
                          markup: emission.customerTotal - emission.supplierTotal,
                          emissor: emission.issuer || '-',
                        }))
                      : resumo.formato === 'pdf'
                        ? (resumo.linhasPDF || []).map((l) => ({
                          venda_numero: l.venda_numero,
                          data_venda: l.data_venda,
                          cliente: l.cliente_nome,
                          pax: l.passageiro,
                          produto: l.produto,
                          total: l.total,
                          custo: l.custo,
                          markup: l.markup,
                          emissor: l.emissor,
                        }))
                        : (resumo.linhasXLSX || []).map((l) => ({
                          venda_numero: l.venda_numero,
                          data_venda: l.data_venda,
                          cliente: l.nome_cliente,
                          pax: l.pax,
                          produto: l.produto,
                          total: l.total_tarifa,
                          custo: l.saldo_pagar,
                          markup: l.previsao_lucro,
                          emissor: l.cod_emissor,
                        }))
                    return linhasPreview.slice(0, 10).map((l, i) => (
                      <tr key={i} className="border-t border-bbt-gray-100 dark:border-slate-700">
                        <td className="px-2 py-1.5 font-mono">{l.venda_numero}</td>
                        <td className="px-2 py-1.5 text-slate-500">{l.data_venda}</td>
                        <td className="px-2 py-1.5 truncate max-w-[140px]">{l.cliente}</td>
                        <td className="px-2 py-1.5 font-medium truncate max-w-[140px]">{l.pax}</td>
                        <td className="px-2 py-1.5">
                          <span className="bbt-badge text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            {l.produto}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(l.total)}</td>
                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(l.custo)}</td>
                        <td className="px-2 py-1.5 text-right text-green-600 font-semibold">{formatCurrency(l.markup)}</td>
                        <td className="px-2 py-1.5">{l.emissor}</td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
            {(() => {
              const qtd = resumo.formato === 'tech'
                ? (resumo.linhasTech?.length || 0)
                : resumo.formato === 'pdf'
                  ? (resumo.linhasPDF?.length || 0)
                  : (resumo.linhasXLSX?.length || 0)
              if (qtd > 10) {
                return (
                  <div className="p-2 text-center text-xs text-slate-500 bg-bbt-gray-50 dark:bg-slate-900/40">
                    ... e mais {qtd - 10} linhas
                  </div>
                )
              }
              return null
            })()}
          </div>

          {/* AÇÃO */}
          {!resultado ? (
            <div className="flex justify-end gap-2">
              <button onClick={resetar} className="bbt-button-ghost">Cancelar</button>
              <button onClick={importar} disabled={importando || unresolvedTechClients.length > 0}
                className="bbt-button-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Importar {resumo.total_vendas} venda(s)
              </button>
            </div>
          ) : (
            <div className="bbt-card p-5 border-2 border-green-300 dark:border-green-700">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <h3 className="font-semibold text-lg text-green-700 dark:text-green-400">Importação concluída!</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Criadas" value={String(resultado.criadas)} color="green" />
                <Stat label="Atualizadas" value={String(resultado.atualizadas)} color="blue" />
                <Stat label="Ignoradas" value={String(resultado.ignoradas)} color="slate" />
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={resetar} className="bbt-button-ghost">Nova importação</button>
                <button onClick={() => router.push('/dashboard/meu-perfil')} className="bbt-button-primary">
                  Ver demandas importadas
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function daysAgoISO(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function dateOnly(value?: string): string | undefined {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0]
}

function emissionSaleKey(companyId: string, saleNumber: string): string {
  return `${companyId}\u0000${normalizeCompanyName(saleNumber)}`
}

function normalizeCompanyName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function findCompanyByExternalName(companies: Empresa[], externalName: string): Empresa | undefined {
  const normalized = normalizeCompanyName(externalName)
  if (!normalized) return undefined
  const exact = companies.filter((company) => normalizeCompanyName(company.nome) === normalized)
  if (exact.length === 1) return exact[0]

  const ignored = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'SA', 'S', 'A', 'LTDA', 'ME', 'EIRELI'])
  const sourceTokens = normalized.split(' ').filter((token) => token.length > 2 && !ignored.has(token))
  if (sourceTokens.length === 0) return undefined
  const candidates = companies
    .map((company) => {
      const targetTokens = new Set(normalizeCompanyName(company.nome).split(' ').filter((token) => token.length > 2 && !ignored.has(token)))
      const common = sourceTokens.filter((token) => targetTokens.has(token)).length
      return { company, score: common / Math.max(sourceTokens.length, targetTokens.size, 1) }
    })
    .filter((candidate) => candidate.score >= 0.75)
    .sort((left, right) => right.score - left.score)
  if (candidates.length === 1 || (candidates[0] && candidates[0].score - (candidates[1]?.score || 0) >= 0.15)) {
    return candidates[0]?.company
  }
  return undefined
}

async function loadTechCompanyMappings(): Promise<Record<string, string>> {
  const response = await fetch('/api/integrations/tech/emission-company-mappings', {
    method: 'GET',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.mappings)) {
    throw new Error(payload?.error || 'Nao foi possivel carregar os mapeamentos da Tech Travel.')
  }
  const mappings: Record<string, string> = {}
  for (const mapping of payload.mappings) {
    const normalized = normalizeExternalCompanyName(String(mapping?.normalizedExternalName || mapping?.externalName || ''))
    const companyId = String(mapping?.companyId || '').trim()
    if (normalized && companyId) mappings[normalized] = companyId
  }
  return mappings
}

function buildTechMetadata(emission: TechEmissionRecord): Record<string, string | number | boolean | null | undefined> {
  return {
    tech_emission_id: emission.externalId,
    tech_os: emission.osNumber,
    tech_agency: emission.agencyName,
    tech_client: emission.clientName,
    tech_locator: emission.locator,
    tech_system: emission.system,
    tech_supplier: emission.supplier,
    tech_ticket: emission.ticket,
    tech_payment: emission.payment,
    tech_route: emission.route,
    tech_policy: emission.policyName,
    tech_advance_days: emission.advanceDays,
    tech_respected_advance_policy: emission.respectedAdvancePolicy,
    tech_respected_lowest_fare_policy: emission.respectedLowestFarePolicy,
    tech_lowest_fare: emission.lowestFare,
    tech_highest_fare: emission.highestFare,
    tech_issued_at: emission.issuedAt,
    tech_os_status: emission.osStatus,
    tech_cancelled: emission.cancelled,
  }
}

function Stat({ label, value, color = 'slate', highlight = false }: { label: string; value: string; color?: string; highlight?: boolean }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white shadow-md',
  }
  return (
    <div className={`rounded-lg p-3 ${colors[color]} ${highlight ? 'ring-2 ring-bbt-accent ring-offset-2 dark:ring-offset-slate-900' : ''}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  )
}
