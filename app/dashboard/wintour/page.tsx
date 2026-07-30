'use client'
import { todayISODate } from '@/lib/date'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, CheckCircle2, Clock, Database, FileSpreadsheet,
  FileText, Loader2, RefreshCw, Search, Upload, Users,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { getAgentesBBT, getCurrentUser, hasPermission } from '@/lib/auth'
import {
  atualizarAtendimentoNaLista,
  criarAtendimentoParaLista,
  getAllAtendimentos,
  persistirAtendimentos,
  persistirAtendimentosRecebidosDoServidor,
  registrarLog,
} from '@/lib/atendimentos-storage'
import {
  DemandClientError,
  importDemandBatchesOnServer,
} from '@/lib/demands-client'
import { criarSequenciadorSerialOS } from '@/lib/atendimento-serial'
import {
  createVoucherBatchKey,
  upsertVoucherBatchOnServer,
} from '@/lib/voucher-persistence-client'
import { asVoucherTipo } from '@/lib/operational-sync'
import { gerarLancamentosDosAtendimentos } from '@/lib/financeiro'
import {
  createFinancialDemandSyncKey,
  syncFinancialEntriesFromDemandsOnServer,
} from '@/lib/finance-persistence-client'
import { parsePDFEmissoes } from '@/lib/emissoes-pdf-parser'
import {
  buildWintourResult,
  criarIndiceDuplicatasWintour,
  criarFingerprintWintour,
  encontrarDuplicataWintourNoIndice,
  encontrarEmpresaWintour,
  encontrarFuncionarioWintour,
  parseWintourFile,
  registrarAtendimentoNoIndiceWintour,
  type WintourImportResult,
  type WintourSaleRecord,
} from '@/lib/wintour-import'
import { addWintourImportRun, getAllWintourImportRuns } from '@/lib/wintour-import-storage'
import { listWintourImportRunsFromServer } from '@/lib/wintour-import-history-client'
import type { WintourImportRun } from '@/lib/wintour-import-history'
import {
  getWintourEmissorMap,
  removeWintourEmissorMapping,
  setWintourEmissorMapping,
  type WintourEmissorMap,
} from '@/lib/wintour-emissor-map-storage'
import {
  deleteWintourEmissorMappingOnServer,
  listWintourEmissorMappingsFromServer,
  upsertWintourEmissorMappingOnServer,
} from '@/lib/wintour-emissor-mapping-client'
import { CONFIG_COBRANCA_PADRAO, VOUCHER_PREFIX, type Atendimento, type Empresa, type Funcionario, type Hotel, type VoucherEmitido, type VoucherTipo } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  commitPendingRemoteStorage,
  compactarLocalStorage,
  compactarWintourDados,
} from '@/lib/storage-quota'
import { criarSequenciadorCodigoIdentificacao } from '@/lib/funcionario-identidade'
import { createEntityId } from '@/lib/ids'

type ImportOutcome = { criadas: number; atualizadas: number; ignoradas: number; erros: number; empresas: number; funcionarios: number; hoteis: number; vouchers: number; financeiro: number }
const PREVIEW_LIMIT = 300
const IMPORT_YIELD_INTERVAL = 200

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

function normalizarBuscaLocal(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hashCurto(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36).toUpperCase().slice(0, 8) || '0'
}

function gerarIdCadastro(prefix: 'emp' | 'func'): string {
  return createEntityId(prefix)
}

function mergeWintourHistory(
  serverItems: WintourImportRun[],
  legacyItems: WintourImportRun[],
): WintourImportRun[] {
  const merged = new Map<string, WintourImportRun>()
  for (const item of serverItems) merged.set(`server:${item.id}`, item)
  const serverFingerprints = new Set(serverItems.map((item) => [
    item.file_name.trim().toUpperCase(),
    item.imported_at.slice(0, 10),
    item.created,
    item.updated,
  ].join('|')))
  for (const item of legacyItems) {
    const fingerprint = [
      item.file_name.trim().toUpperCase(),
      item.imported_at.slice(0, 10),
      item.created,
      item.updated,
    ].join('|')
    if (!serverFingerprints.has(fingerprint)) merged.set(`legacy:${item.id}`, item)
  }
  return [...merged.values()]
    .sort((left, right) => right.imported_at.localeCompare(left.imported_at))
    .slice(0, 60)
}

type HotelWintourIndex = {
  porNome: Map<string, Hotel>
  porNomeCidade: Map<string, Hotel>
}

function criarIndiceHoteisWintour(hoteis: Hotel[]): HotelWintourIndex {
  const index: HotelWintourIndex = { porNome: new Map(), porNomeCidade: new Map() }
  for (const hotel of hoteis) registrarHotelNoIndice(index, hotel)
  return index
}

function registrarHotelNoIndice(index: HotelWintourIndex, hotel: Hotel): void {
  const nome = normalizarBuscaLocal(hotel.nome)
  if (!nome) return
  const cidade = normalizarBuscaLocal(hotel.cidade || '')
  if (!index.porNome.has(nome)) index.porNome.set(nome, hotel)
  if (!index.porNomeCidade.has(`${nome}|${cidade}`)) index.porNomeCidade.set(`${nome}|${cidade}`, hotel)
}

function mapTipoApto(value?: string): 'SGL' | 'DBL' | 'TPL' | undefined {
  const text = normalizarBuscaLocal(value || '')
  if (!text) return undefined
  if (/tri|tpl|trip/.test(text)) return 'TPL'
  if (/dupl|dbl|casal|double/.test(text)) return 'DBL'
  return 'SGL'
}

export default function WintourPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas, funcionarios, adicionarCadastrosEmLote } = useStore()
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<WintourImportResult | null>(null)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [autoEmpresa, setAutoEmpresa] = useState(true)
  const [autoFuncionario, setAutoFuncionario] = useState(true)
  const [importando, setImportando] = useState(false)
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [historico, setHistorico] = useState<WintourImportRun[]>(() => getAllWintourImportRuns())
  const [historicoErro, setHistoricoErro] = useState<string | null>(null)
  const [emissorMap, setEmissorMap] = useState<Record<string, WintourEmissorMap>>(() => getWintourEmissorMap())
  const [emissorSavingCode, setEmissorSavingCode] = useState<string | null>(null)

  const podeImportar = !user || hasPermission(user, 'importar_planilhas') || hasPermission(user, 'gerenciar_usuarios')
  const agentesBBT = useMemo(() => getAgentesBBT(), [])
  const emissoresDetectados = useMemo(() => {
    const byCodigo = new Map<string, { codigo: string; nome: string; qtd: number }>()
    for (const record of resultado?.records || []) {
      const codigo = String(record.emissor_codigo || '').trim().toUpperCase()
      if (!codigo) continue
      const atual = byCodigo.get(codigo) || { codigo, nome: record.emissor_nome || codigo, qtd: 0 }
      atual.qtd++
      if (!atual.nome || atual.nome === codigo) atual.nome = record.emissor_nome || codigo
      byCodigo.set(codigo, atual)
    }
    return Array.from(byCodigo.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [resultado])

  useEffect(() => {
    let active = true
    listWintourImportRunsFromServer()
      .then((items) => {
        if (!active) return
        setHistorico(mergeWintourHistory(items, getAllWintourImportRuns()))
        setHistoricoErro(null)
      })
      .catch((error) => {
        if (!active) return
        console.error('[wintour:history]', error)
        setHistoricoErro(error instanceof Error ? error.message : 'Falha ao carregar o historico.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    listWintourEmissorMappingsFromServer()
      .then((serverMappings) => {
        if (!active) return
        setEmissorMap({
          ...getWintourEmissorMap(),
          ...serverMappings,
        })
      })
      .catch((error) => {
        console.error('[wintour:emissor-mappings]', error)
      })
    return () => {
      active = false
    }
  }, [])

  const analisePrevia = useMemo(() => {
    const records = (resultado?.records || []).slice(0, PREVIEW_LIMIT)
    const atendimentos = getAllAtendimentos()
    const duplicateIndex = criarIndiceDuplicatasWintour(atendimentos)
    return records.map((record) => {
      const matchEmpresa = encontrarEmpresaWintour(record, empresas)
      const matchFuncionario = encontrarFuncionarioWintour(record, funcionarios, matchEmpresa.empresa?.id)
      const duplicata = encontrarDuplicataWintourNoIndice(record, duplicateIndex, matchEmpresa.empresa?.id)
      return { record, matchEmpresa, matchFuncionario, duplicata }
    })
  }, [resultado, empresas, funcionarios])

  if (!podeImportar) {
    return <div className="p-8 text-center text-red-600">Você não tem permissão para importar dados do Wintour.</div>
  }

  async function handleArquivo(file: File) {
    setArquivo(file)
    setLoading(true)
    setResultado(null)
    setOutcome(null)
    try {
      const ext = file.name.toLowerCase().split('.').pop() || ''
      let parsed: WintourImportResult
      if (ext === 'pdf') {
        const pdf = await parsePDFEmissoes(file)
        const records: WintourSaleRecord[] = pdf.linhas.map((linha) => ({
          source: 'pdf',
          venda_numero: linha.venda_numero,
          data_venda: linha.data_venda,
          produto: linha.produto,
          tipo_servico: linha.tipo_servico,
          empresa_codigo: linha.cod_cliente || '',
          empresa_nome: linha.cliente_nome,
          passageiro: linha.passageiro,
          forma_pagamento: linha.forma_pagamento,
          valor_total: linha.total,
          valor_custo: linha.custo,
          markup: linha.markup,
          status: linha.status === 'CA' ? 'cancelado' : linha.status === 'ND' ? 'em_andamento' : 'finalizado',
          status_original: linha.status,
          emissor_codigo: linha.emissor,
          descricao: linha.rota_descricao,
          fornecedor: linha.fornecedor || linha.produto,
          cia: linha.tipo_servico === 'Aéreo' ? linha.produto : undefined,
          localizador: linha.form_nr_doc,
          warnings: [],
        }))
        parsed = buildWintourResult(file.name, 'pdf', records)
      } else {
        parsed = await parseWintourFile(file)
      }

      setResultado(parsed)
      setSelecionados(new Set(parsed.records.map((_, index) => index)))
      toast.success(`${parsed.records.length} venda(s) detectada(s) no arquivo Wintour.`)
    } catch (error: any) {
      console.error(error)
      toast.error(`Erro ao ler Wintour: ${error?.message || 'arquivo invalido'}`)
    } finally {
      setLoading(false)
    }
  }

  function toggle(index: number) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
  }

  function toggleTodos() {
    if (!resultado) return
    if (selecionados.size === resultado.records.length) setSelecionados(new Set())
    else setSelecionados(new Set(resultado.records.map((_, index) => index)))
  }

  function fuzzyAgente(record: WintourSaleRecord) {
    const emissor = String(record.emissor_codigo || record.emissor_nome || '').toLowerCase().trim()
    if (!emissor) return undefined
    return agentesBBT.find((agente) => {
      const nome = agente.name.toLowerCase()
      const email = agente.email.toLowerCase()
      return nome.includes(emissor) || email.includes(emissor) || emissor.includes(nome.split(' ')[0])
    })
  }

  function mappingEmissor(record: WintourSaleRecord): WintourEmissorMap | undefined {
    const codigo = String(record.emissor_codigo || '').trim().toUpperCase()
    return codigo ? emissorMap[codigo] : undefined
  }

  function agenteIdPara(record: WintourSaleRecord): string {
    const mapped = mappingEmissor(record)
    if (mapped?.user_id) return mapped.user_id
    return fuzzyAgente(record)?.id || user?.id || 'usr-felipe-master'
  }

  function agenteNomePara(record: WintourSaleRecord): string {
    const mapped = mappingEmissor(record)
    if (mapped?.user_name) return mapped.user_name
    return fuzzyAgente(record)?.name || 'Sem mapeamento'
  }

  async function alterarEmissor(codigo: string, userId: string) {
    const agente = agentesBBT.find((item) => item.id === userId)
    setEmissorSavingCode(codigo)
    try {
      if (!agente) {
        await deleteWintourEmissorMappingOnServer(codigo)
        removeWintourEmissorMapping(codigo)
        setEmissorMap((current) => {
          const next = { ...current }
          delete next[codigo]
          return next
        })
      } else {
        const mapping = await upsertWintourEmissorMappingOnServer(codigo, agente.id)
        setWintourEmissorMapping(mapping.codigo, mapping.user_id, mapping.user_name)
        setEmissorMap((current) => ({ ...current, [mapping.codigo]: mapping }))
      }
      toast.success('Mapeamento de emissor atualizado.')
    } catch (error) {
      console.error('[wintour:emissor-mapping:update]', error)
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel atualizar o emissor.')
    } finally {
      setEmissorSavingCode((current) => current === codigo ? null : current)
    }
  }

  function criarEmpresaMinima(record: WintourSaleRecord): Empresa {
    const nome = record.empresa_nome || record.empresa_codigo || 'Cliente Wintour'
    const codigo = (record.empresa_codigo || nome).replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase()
    return {
      id: gerarIdCadastro('emp'),
      nome,
      cnpj: record.empresa_cnpj || '',
      codigo_cliente: codigo,
      endereco: record.empresa_endereco || '',
      responsavel: record.solicitante_nome || '',
      email_responsavel: record.empresa_email || '',
      telefone: record.empresa_telefone || '',
      centro_custo_padrao: record.centro_custo || '',
      ativa: true,
      config_cobranca: { ...CONFIG_COBRANCA_PADRAO },
      created_at: new Date().toISOString(),
    }
  }

  function criarFuncionarioMinimo(record: WintourSaleRecord, empresaId: string, codigoIdentificacao: string): Funcionario | null {
    if (!record.passageiro) return null
    return {
      id: gerarIdCadastro('func'),
      codigo_identificacao: codigoIdentificacao,
      company_id: empresaId,
      nome: record.passageiro,
      cpf: record.cpf || '',
      data_nascimento: '',
      telefone: '',
      email: '',
      passaporte: '',
      passaporte_validade: '',
      milhagem: '',
      preferencias: '',
      cargo: 'Colaborador',
      centro_custo: record.centro_custo || '',
      matricula: record.matricula,
      lotacao: record.departamento || record.projeto,
      ativo: true,
      aliases_nome: [],
      created_at: new Date().toISOString(),
    }
  }

  function garantirHotelWintour(
    record: WintourSaleRecord,
    hotelIndex: HotelWintourIndex,
    proximoHotelId: () => number,
  ): { id?: number; criado: boolean; hotel?: Hotel } {
    if (record.tipo_servico !== 'Hotel') return { criado: false }
    const nome = record.fornecedor_nome || record.fornecedor || ''
    if (!nome) return { criado: false }
    const nomeNorm = normalizarBuscaLocal(nome)
    const cidadeNorm = normalizarBuscaLocal(record.fornecedor_cidade || record.destino || '')
    const existente = cidadeNorm
      ? hotelIndex.porNomeCidade.get(`${nomeNorm}|${cidadeNorm}`)
      : hotelIndex.porNome.get(nomeNorm)
    if (existente) return { id: existente.id, criado: false, hotel: existente }

    const novo: Hotel = {
      id: proximoHotelId(),
      nome,
      cidade: record.fornecedor_cidade || record.destino || '',
      uf: record.fornecedor_estado || '',
      categoria: undefined,
      observacoes: [
        'Importado automaticamente do XML Wintour.',
        record.hotel_regime ? `Regime: ${record.hotel_regime}` : '',
        record.hotel_tipo_pagto ? `Pagamento: ${record.hotel_tipo_pagto}` : '',
        record.fornecedor_codigo ? `Codigo fornecedor: ${record.fornecedor_codigo}` : '',
      ].filter(Boolean).join(' | '),
      telefone: record.fornecedor_telefone || null,
      faturado: String(record.forma_pagamento || '').toUpperCase() === 'IV' || /fatur/i.test(record.hotel_tipo_pagto || ''),
      info_faturamento: record.hotel_tipo_pagto || null,
      bebedouro: null,
      valor_agua: null,
      cafe_manha: record.hotel_regime || null,
      estacionamento: null,
      tarifa_sgl: null,
      tarifa_dbl: null,
      tarifa_tpl: null,
      formas_pagamento: [],
    }
    registrarHotelNoIndice(hotelIndex, novo)
    return { id: novo.id, criado: true, hotel: novo }
  }

  function payloadAtendimento(record: WintourSaleRecord, empresa: Empresa, funcionario: Funcionario | null, agenteUserId: string, hotelId?: number): Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> {
    const fingerprint = criarFingerprintWintour(record)
    const origemEmissao = record.source === 'xml' ? 'wintour_xml' : record.source === 'pdf' ? 'wintour_pdf' : 'wintour_planilha'
    const noites = record.qtd_trechos_diarias || undefined
    const observacoesBase = [
      `Importado do Wintour (${record.source.toUpperCase()}).`,
      record.descricao,
      record.localizador ? `Localizador: ${record.localizador}.` : '',
      record.data_inicio_servico ? `Check-in/inicio: ${record.data_inicio_servico}.` : '',
      record.data_fim_servico ? `Check-out/fim: ${record.data_fim_servico}.` : '',
      record.hotel_confirmacao ? `Confirmacao hotel: ${record.hotel_confirmacao}.` : '',
      record.solicitante_nome ? `Solicitante: ${record.solicitante_nome}.` : '',
      record.centro_custo ? `Centro de custo: ${record.centro_custo}.` : '',
    ].filter(Boolean).join(' ')

    return {
      empresa_id: empresa.id,
      funcionario_id: funcionario?.id || null,
      passageiro_nome: record.passageiro || 'Passageiro nao informado',
      tipo_servico: record.tipo_servico,
      valor_cotacao: record.valor_total || record.valor_custo,
      valor_final: record.valor_total || record.valor_custo,
      valor_custo: record.valor_custo,
      valor_venda: record.valor_total || record.valor_custo,
      markup_valor: record.markup,
      agente_user_id: agenteUserId,
      status: record.status,
      prioridade: 'media',
      origem: 'Portal',
      observacoes: observacoesBase.slice(0, 500),
      observacoes_internas: [
        `wintour_fingerprint=${fingerprint}`,
        `arquivo=${arquivo?.name || ''}`,
        record.status_original ? `status_original=${record.status_original}` : '',
        record.solicitante_nome ? `solicitante=${record.solicitante_nome}` : '',
        record.aprovador_nome ? `aprovador=${record.aprovador_nome}` : '',
        record.departamento ? `departamento=${record.departamento}` : '',
        record.projeto ? `projeto=${record.projeto}` : '',
        record.matricula ? `matricula=${record.matricula}` : '',
        record.data_inicio_servico ? `data_inicio_servico=${record.data_inicio_servico}` : '',
        record.data_fim_servico ? `data_fim_servico=${record.data_fim_servico}` : '',
        record.hotel_confirmacao ? `hotel_confirmacao=${record.hotel_confirmacao}` : '',
        record.hotel_confirmado_por ? `hotel_confirmado_por=${record.hotel_confirmado_por}` : '',
      ].filter(Boolean).join(' | '),
      wintour_dados: compactarWintourDados(record.wintour_dados),
      data_atendimento: record.data_venda || todayISODate(),
      venda_numero: record.venda_numero || undefined,
      emissor_codigo: record.emissor_codigo,
      emissor_nome: agenteNomePara(record),
      solicitante_nome: record.solicitante_nome,
      origem_emissao: origemEmissao,
      forma_pagamento: ['IV', 'PX', 'CP', 'CC'].includes(String(record.forma_pagamento || '').toUpperCase())
        ? String(record.forma_pagamento).toUpperCase() as any
        : undefined,
      centro_custo: record.centro_custo,
      projeto_obra: record.projeto,
      numero_solicitacao: record.numero_requisicao,
      autorizador_nome: record.aprovador_nome,
      detalhes_hotel: record.tipo_servico === 'Hotel' ? {
        hotel_id: hotelId,
        hotel_nome: record.fornecedor_nome || record.fornecedor || record.produto || '',
        cidade: record.fornecedor_cidade || record.destino,
        data_checkin: record.data_inicio_servico,
        data_checkout: record.data_fim_servico,
        num_hospedes: record.hotel_num_hospedes || 1,
        tipo_apto: mapTipoApto(record.hotel_tipo_apto || record.hotel_categoria),
        noites,
        tarifa_unitaria: noites && noites > 0 ? Math.round((record.valor_total || 0) / noites) : undefined,
        localizador: record.hotel_confirmacao || record.localizador,
      } : undefined,
      detalhes_aereo: record.tipo_servico === 'Aéreo' ? {
        cia_aerea: record.cia || record.fornecedor || record.produto,
        origem: record.origem,
        destino: record.destino,
        data_ida: record.data_inicio_servico || record.data_venda,
        data_volta: record.data_fim_servico,
        localizador: record.localizador,
      } : undefined,
      detalhes_carro: record.tipo_servico === 'Carro' ? {
        locadora: record.fornecedor || record.produto,
        cidade_retirada: record.destino,
        data_retirada: record.data_inicio_servico,
        data_devolucao: record.data_fim_servico,
        localizador: record.localizador,
      } : undefined,
      detalhes_pacote: record.tipo_servico === 'Pacote' ? {
        destino: record.destino,
        data_ida: record.data_inicio_servico,
        data_volta: record.data_fim_servico,
        descricao: record.descricao,
        localizador: record.localizador,
      } : undefined,
    }
  }

  function voucherFromWintourRecord(
    record: WintourSaleRecord,
    atendimento: Atendimento,
    empresa: Empresa,
    funcionario: Funcionario | null
  ): VoucherEmitido {
    const tipo: VoucherTipo = asVoucherTipo(record.tipo_servico)
    const base = [
      record.venda_numero,
      record.tipo_servico,
      record.passageiro,
      record.fornecedor_nome || record.fornecedor || record.produto,
      record.data_inicio_servico,
      record.data_fim_servico,
      record.localizador || record.hotel_confirmacao,
      record.valor_total || record.valor_custo,
    ].join('|')
    const numero = `W${hashCurto(base)}`
    const fornecedor = record.fornecedor_nome || record.fornecedor || record.cia || record.produto || record.tipo_servico
    const valorTotal = record.valor_total || record.valor_custo || 0
    const valorCusto = record.valor_custo || record.total_tarifa || valorTotal
    const status = record.status === 'cancelado'
      ? 'cancelado'
      : record.hotel_confirmacao || record.localizador || record.status === 'finalizado'
        ? 'confirmado'
        : 'emitido'

    return {
      id: `${VOUCHER_PREFIX[tipo]}-${numero}`,
      numero,
      tipo,
      status,
      atendimento_id: atendimento.id,
      empresa_id: empresa.id,
      funcionario_id: funcionario?.id || null,
      passageiro_nome: record.passageiro || atendimento.passageiro_nome,
      cpf: record.cpf,
      fornecedor_nome: fornecedor,
      fornecedor_endereco: record.fornecedor_endereco,
      fornecedor_cidade: record.fornecedor_cidade || record.destino,
      fornecedor_telefone: record.fornecedor_telefone,
      fornecedor_email: record.fornecedor_email,
      hotel_categoria: tipo === 'Hotel' ? record.hotel_categoria : undefined,
      tipo_apartamento: tipo === 'Hotel' ? record.hotel_tipo_apto : undefined,
      num_apartamentos: tipo === 'Hotel' ? record.hotel_num_apts : undefined,
      num_hospedes: tipo === 'Hotel' ? record.hotel_num_hospedes || 1 : undefined,
      data_checkin: tipo === 'Hotel' ? record.data_inicio_servico : undefined,
      data_checkout: tipo === 'Hotel' ? record.data_fim_servico : undefined,
      noites: tipo === 'Hotel' ? record.qtd_trechos_diarias : undefined,
      regime: tipo === 'Hotel' ? record.hotel_regime : undefined,
      forma_pagamento_voucher: tipo === 'Hotel' ? record.hotel_tipo_pagto || String(record.forma_pagamento || '') : undefined,
      valor_diaria: tipo === 'Hotel' && record.qtd_trechos_diarias ? valorCusto / record.qtd_trechos_diarias : undefined,
      cia_aerea: tipo === 'Aéreo' ? record.cia || fornecedor : undefined,
      origem: tipo === 'Aéreo' ? record.origem : undefined,
      destino: tipo === 'Aéreo' || tipo === 'Pacote' ? record.destino : undefined,
      data_ida: tipo === 'Aéreo' || tipo === 'Pacote' ? record.data_inicio_servico || record.data_venda : undefined,
      data_volta: tipo === 'Aéreo' || tipo === 'Pacote' ? record.data_fim_servico : undefined,
      localizador: tipo === 'Aéreo' ? record.localizador : undefined,
      locadora: tipo === 'Carro' ? fornecedor : undefined,
      categoria_carro: tipo === 'Carro' ? record.hotel_categoria : undefined,
      retirada_local: tipo === 'Carro' ? record.destino || record.fornecedor_cidade : undefined,
      retirada_data: tipo === 'Carro' ? record.data_inicio_servico : undefined,
      devolucao_local: tipo === 'Carro' ? record.destino || record.fornecedor_cidade : undefined,
      devolucao_data: tipo === 'Carro' ? record.data_fim_servico : undefined,
      numero_confirmacao: record.hotel_confirmacao || record.localizador || record.venda_numero,
      data_confirmacao: record.hotel_data_confirmacao || record.data_venda,
      confirmado_por: record.hotel_confirmado_por || agenteNomePara(record),
      tarifa_total: valorCusto,
      taxas: record.total_taxa || record.total_outras_txs || record.total_fee,
      total: valorTotal,
      centro_custo: record.centro_custo,
      numero_solicitacao: record.numero_requisicao,
      observacoes: [
        `Importado do Wintour (${record.source.toUpperCase()})`,
        record.descricao,
        record.solicitante_nome ? `Solicitante: ${record.solicitante_nome}` : '',
      ].filter(Boolean).join(' | '),
      observacoes_internas: [
        `atendimento=${atendimento.id}`,
        `venda=${record.venda_numero}`,
        record.emissor_codigo ? `emissor=${record.emissor_codigo}` : '',
        record.situacao_contabil ? `situacao_contabil=${record.situacao_contabil}` : '',
        record.info_internas,
      ].filter(Boolean).join(' | '),
      origem_voucher: 'importado',
      arquivo_original_nome: resultado?.file_name,
      importado_em: new Date().toISOString(),
      fingerprint: `wintour_voucher|${hashCurto(base)}|${normalizarBuscaLocal(base)}`,
      emitido_por_user_id: atendimento.agente_user_id,
      emitido_por_user_name: atendimento.emissor_nome || agenteNomePara(record),
      created_at: new Date().toISOString(),
    }
  }

  async function importar() {
    if (!resultado || !user) return
    setImportando(true)
    setImportProgress({ processed: 0, total: resultado.records.length })
    let criadas = 0
    let atualizadas = 0
    let ignoradas = 0
    let erros = 0
    let novasEmpresas = 0
    let novosFuncionarios = 0
    let novosHoteis = 0
    let vouchersSincronizados = 0
    let financeiroSincronizado = 0
    let demandasPersistidasRelacionalmente = false
    const fingerprints: string[] = []

    try {
      compactarLocalStorage()
      const empresasAtuais = [...useStore.getState().empresas]
      const funcionariosAtuais = [...useStore.getState().funcionarios]
      const hoteisAtuais = [...useStore.getState().hoteis]
      const empresasParaAdicionar: Empresa[] = []
      const funcionariosParaAdicionar: Funcionario[] = []
      const hoteisParaAdicionar: Hotel[] = []
      const funcionariosPorEmpresa = new Map<string, Funcionario[]>()
      for (const funcionario of funcionariosAtuais) {
        const lista = funcionariosPorEmpresa.get(funcionario.company_id)
        if (lista) lista.push(funcionario)
        else funcionariosPorEmpresa.set(funcionario.company_id, [funcionario])
      }
      const proximoCodigoFuncionario = criarSequenciadorCodigoIdentificacao(funcionariosAtuais)
      const hotelIndex = criarIndiceHoteisWintour(hoteisAtuais)
      let maiorHotelId = hoteisAtuais.reduce((max, hotel) => Math.max(max, hotel.id), 0)
      const proximoHotelId = () => ++maiorHotelId
      const atendimentosAtuais = getAllAtendimentos()
      const duplicateIndex = criarIndiceDuplicatasWintour(atendimentosAtuais)
      const atendimentoIndexById = new Map(atendimentosAtuais.map((atendimento, index) => [atendimento.id, index]))
      const proximoSerialOS = criarSequenciadorSerialOS(atendimentosAtuais)
      const atendimentosSalvos = new Map<string, Atendimento>()
      const vouchersParaSalvar = new Map<string, ReturnType<typeof voucherFromWintourRecord>>()

      for (let index = 0; index < resultado.records.length; index++) {
        if (index > 0 && index % IMPORT_YIELD_INTERVAL === 0) {
          setImportProgress({ processed: index, total: resultado.records.length })
          await yieldToBrowser()
        }
        if (!selecionados.has(index)) { ignoradas++; continue }
        const record = resultado.records[index]
        if (!record.passageiro && !record.venda_numero) { ignoradas++; continue }

        let empresa = encontrarEmpresaWintour(record, empresasAtuais).empresa
        if (!empresa && autoEmpresa && (record.empresa_nome || record.empresa_codigo)) {
          empresa = criarEmpresaMinima(record)
          if (empresa) {
            empresasAtuais.push(empresa)
            empresasParaAdicionar.push(empresa)
            novasEmpresas++
          }
        }
        if (!empresa) { ignoradas++; continue }

        let funcionariosDaEmpresa = funcionariosPorEmpresa.get(empresa.id) || []
        let funcionario = encontrarFuncionarioWintour(record, funcionariosDaEmpresa, empresa.id).funcionario || null
        if (!funcionario && autoFuncionario && record.passageiro) {
          funcionario = criarFuncionarioMinimo(record, empresa.id, proximoCodigoFuncionario())
          if (funcionario) {
            funcionariosAtuais.push(funcionario)
            funcionariosParaAdicionar.push(funcionario)
            if (funcionariosDaEmpresa.length === 0) {
              funcionariosDaEmpresa = []
              funcionariosPorEmpresa.set(empresa.id, funcionariosDaEmpresa)
            }
            funcionariosDaEmpresa.push(funcionario)
            novosFuncionarios++
          }
        }

        const hotelImportado = garantirHotelWintour(record, hotelIndex, proximoHotelId)
        if (hotelImportado.criado && hotelImportado.hotel) {
          hoteisParaAdicionar.push(hotelImportado.hotel)
          novosHoteis++
        }

        const duplicata = encontrarDuplicataWintourNoIndice(record, duplicateIndex, empresa.id)
        const payload = payloadAtendimento(record, empresa, funcionario, agenteIdPara(record), hotelImportado.id)
        fingerprints.push(criarFingerprintWintour(record))
        let atendimentoSalvo: Atendimento | null = null

        if (duplicata) {
          atendimentoSalvo = atualizarAtendimentoNaLista(atendimentosAtuais, duplicata.id, payload, atendimentoIndexById)
          if (atendimentoSalvo) atualizadas++
          else erros++
        } else {
          const novo = criarAtendimentoParaLista(payload, atendimentosAtuais, proximoSerialOS())
          atendimentosAtuais.push(novo)
          atendimentoIndexById.set(novo.id, atendimentosAtuais.length - 1)
          atendimentoSalvo = novo
          criadas++
        }

        if (atendimentoSalvo) {
          registrarAtendimentoNoIndiceWintour(duplicateIndex, atendimentoSalvo)
          const voucher = voucherFromWintourRecord(record, atendimentoSalvo, empresa, funcionario)
          const ids = new Set([...(atendimentoSalvo.voucher_ids || []), voucher.id])
          atendimentoSalvo.voucher_ids = Array.from(ids)
          vouchersParaSalvar.set(voucher.id, voucher)
          atendimentosSalvos.set(atendimentoSalvo.id, atendimentoSalvo)
        }
      }

      if (empresasParaAdicionar.length || funcionariosParaAdicionar.length || hoteisParaAdicionar.length) {
        adicionarCadastrosEmLote({
          empresas: empresasParaAdicionar,
          funcionarios: funcionariosParaAdicionar,
          hoteis: hoteisParaAdicionar,
        })
        await commitPendingRemoteStorage()
      }

      const demandasDoLote = Array.from(atendimentosSalvos.values())
      if (demandasDoLote.length) {
        try {
          const importacao = await importDemandBatchesOnServer(
            demandasDoLote,
            'wintour',
            `wintour:${hashCurto(`${resultado.file_name}|${fingerprints.join('|')}`)}`,
            (processed, total) => setImportProgress({ processed, total }),
            {
              fileName: resultado.file_name,
              sourceFormat: resultado.source_format,
              periodStart: resultado.summary.periodo_inicio,
              periodEnd: resultado.summary.periodo_fim,
              totalRecords: resultado.records.length,
              totalValue: resultado.summary.total_venda,
              totalCost: resultado.summary.total_custo,
              totalMarkup: resultado.summary.total_markup,
            },
          )
          const retornadas = new Map(importacao.demands.map((demanda) => [demanda.id, demanda]))
          const listaSincronizada = atendimentosAtuais.map((demanda) => retornadas.get(demanda.id) || demanda)
          if (!persistirAtendimentosRecebidosDoServidor(listaSincronizada)) {
            toast.warning('O lote foi salvo no servidor, mas o cache local sera renovado no proximo carregamento.')
          }
          importacao.demands.forEach((demanda) => atendimentosSalvos.set(demanda.id, demanda))
          criadas = importacao.inserted
          atualizadas = importacao.updated
          ignoradas += Math.max(0, importacao.skipped - importacao.failures.length)
          erros += importacao.failures.length
          demandasPersistidasRelacionalmente = true
        } catch (error) {
          if (!(error instanceof DemandClientError) || error.code !== 'DEMAND_RELATIONAL_WRITE_DISABLED') {
            throw error
          }
          if (!persistirAtendimentos(atendimentosAtuais)) {
            throw new Error('Nao foi possivel salvar os atendimentos importados no modo legado.')
          }
          await commitPendingRemoteStorage()
        }
      }

      const demandasFinanceiras = Array.from(atendimentosSalvos.values())
      if (demandasPersistidasRelacionalmente && demandasFinanceiras.length) {
        const ids = demandasFinanceiras.map((demanda) => demanda.id)
        const stateFingerprint = demandasFinanceiras
          .map((demanda) => [
            demanda.id,
            demanda.updated_at || '',
            demanda.status,
            demanda.valor_venda || demanda.valor_final || demanda.valor_cotacao || 0,
            demanda.valor_custo || 0,
          ].join('|'))
          .sort()
          .join('\n')
        const financeiro = await syncFinancialEntriesFromDemandsOnServer(
          ids,
          createFinancialDemandSyncKey('wintour', ids, stateFingerprint),
        )
        financeiroSincronizado = financeiro.entries.length
      } else {
        const financeiro = gerarLancamentosDosAtendimentos(demandasFinanceiras)
        financeiroSincronizado = financeiro.total
      }
      const vouchersDoLote = Array.from(vouchersParaSalvar.values())
      if (vouchersDoLote.length) {
        const vouchersPersistidos = await upsertVoucherBatchOnServer(
          vouchersDoLote,
          createVoucherBatchKey(`wintour-${resultado.file_name}`, vouchersDoLote),
        )
        vouchersSincronizados = vouchersPersistidos.length
      }
      compactarLocalStorage()

      if (!demandasPersistidasRelacionalmente) {
        addWintourImportRun({
          file_name: resultado.file_name,
          source_format: resultado.source_format,
          imported_by_user_id: user.id,
          imported_by_user_name: user.name,
          periodo_inicio: resultado.summary.periodo_inicio,
          periodo_fim: resultado.summary.periodo_fim,
          total_records: resultado.records.length,
          total_value: resultado.summary.total_venda,
          total_cost: resultado.summary.total_custo,
          total_markup: resultado.summary.total_markup,
          created: criadas,
          updated: atualizadas,
          ignored: ignoradas,
          errors: erros,
          fingerprints,
        })
      }

      registrarLog({
        user_id: user.id,
        user_name: user.name,
        acao: 'importar',
        entidade: 'Wintour',
        entidade_id: resultado.file_name,
        descricao: `Importacao Wintour: ${criadas} criadas, ${atualizadas} atualizadas, ${ignoradas} ignoradas, ${erros} erros.`,
      })

      setOutcome({
        criadas,
        atualizadas,
        ignoradas,
        erros,
        empresas: novasEmpresas,
        funcionarios: novosFuncionarios,
        hoteis: novosHoteis,
        vouchers: vouchersSincronizados,
        financeiro: financeiroSincronizado,
      })
      try {
        const serverHistory = await listWintourImportRunsFromServer()
        setHistorico(mergeWintourHistory(serverHistory, getAllWintourImportRuns()))
        setHistoricoErro(null)
      } catch (historyError) {
        console.error('[wintour:history-refresh]', historyError)
        setHistoricoErro(historyError instanceof Error ? historyError.message : 'Falha ao atualizar o historico.')
      }
      toast.success(`Wintour sincronizado: ${criadas} novas, ${atualizadas} atualizadas, ${vouchersSincronizados} voucher(s).`)
    } catch (error: any) {
      console.error(error)
      toast.error(`Erro ao importar Wintour: ${error?.message || error}`)
    } finally {
      setImportando(false)
      setImportProgress(null)
    }
  }

  function resetar() {
    setArquivo(null)
    setResultado(null)
    setSelecionados(new Set())
    setOutcome(null)
    setImportProgress(null)
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Integracao diaria</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Database className="w-6 h-6 text-bbt-accent" /> Wintour
          </h1>
          <p className="bbt-page-subtitle">
            Importe vendas/emissoes do dia para alimentar demandas, financeiro, vouchers e consultas da IA.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_.9fr] gap-4">
        <div className="bbt-card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-bbt-accent mt-0.5" />
            <div>
              <h2 className="font-semibold text-bbt-primary dark:text-white">Fluxo recomendado</h2>
              <p className="text-sm text-slate-500 mt-1">
                No Wintour, exporte as vendas do dia pela interface oficial de exportacao Wintour/XML. Se o suporte ainda nao liberou a interface, use XLSX/CSV ou PDF do mapa/emissoes como ponte.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <Step numero="1" titulo="Exportar" texto="Gere o arquivo diario no Wintour com vendas/emissoes do periodo." />
            <Step numero="2" titulo="Conferir" texto="O BBT mostra empresa, viajante, valores, duplicatas e avisos antes de gravar." />
            <Step numero="3" titulo="Sincronizar" texto="Cada venda vira demanda finalizada ou atualiza a venda existente." />
          </div>
        </div>

        <div className="bbt-card p-5 space-y-3">
          <h2 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-bbt-accent" /> Historico
          </h2>
          {historico.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma importacao Wintour registrada ainda.</p>
          ) : (
            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
              {historico.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-lg border border-bbt-gray-100 dark:border-slate-700 p-2 text-xs">
                  <div className="font-semibold truncate">{item.file_name}</div>
                  <div className="text-slate-500">{formatDate(item.imported_at)} · {item.created} novas · {item.updated} atualizadas</div>
                </div>
              ))}
            </div>
          )}
          {historicoErro && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{historicoErro}</p>
          )}
        </div>
      </div>

      {!resultado ? (
        <label className="bbt-card p-10 text-center cursor-pointer hover:border-bbt-accent hover:bg-bbt-accent/5 transition block border-2 border-dashed border-bbt-gray-100 dark:border-slate-700">
          {loading ? (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-bbt-accent mb-3 animate-spin" />
              <p className="font-semibold text-bbt-primary dark:text-white">Lendo arquivo Wintour...</p>
              <p className="text-xs text-slate-500 mt-1">{arquivo?.name}</p>
            </>
          ) : (
            <>
              <div className="flex justify-center gap-3 mb-3">
                <FileText className="w-10 h-10 text-blue-500" />
                <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
                <Upload className="w-10 h-10 text-bbt-accent" />
              </div>
              <p className="font-semibold text-bbt-primary dark:text-white">Selecionar arquivo diario do Wintour</p>
              <p className="text-xs text-slate-500 mt-1">XML oficial, XLSX, XLS, CSV ou PDF de emissoes</p>
            </>
          )}
          <input
            type="file"
            accept=".xml,.xlsx,.xls,.csv,.pdf"
            disabled={loading}
            onChange={(event) => event.target.files?.[0] && handleArquivo(event.target.files[0])}
            className="hidden"
          />
        </label>
      ) : (
        <div className="space-y-5">
          <div className="bbt-card p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-bbt-primary dark:text-white">{resultado.file_name}</h2>
                <p className="text-xs text-slate-500">
                  {resultado.source_format.toUpperCase()} · {resultado.summary.periodo_inicio || 'sem periodo'} {resultado.summary.periodo_fim ? `ate ${resultado.summary.periodo_fim}` : ''}
                </p>
              </div>
              <button onClick={resetar} className="bbt-button-ghost text-sm flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Trocar arquivo
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Stat label="Vendas" value={String(resultado.summary.total_vendas)} />
              <Stat label="Venda total" value={formatCurrency(resultado.summary.total_venda)} />
              <Stat label="Custo" value={formatCurrency(resultado.summary.total_custo)} />
              <Stat label="Markup" value={formatCurrency(resultado.summary.total_markup)} />
              <Stat label="Selecionadas" value={String(selecionados.size)} />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoEmpresa} onChange={(e) => setAutoEmpresa(e.target.checked)} />
                Criar empresa se nao existir
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoFuncionario} onChange={(e) => setAutoFuncionario(e.target.checked)} />
                Criar viajante se nao existir
              </label>
              {resultado.warnings.map((warning, index) => (
                <span key={index} className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {warning}
                </span>
              ))}
            </div>
          </div>

          {emissoresDetectados.length > 0 && (
            <div className="bbt-card p-5">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-bbt-accent" /> Mapeamento de emissores Wintour
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {emissoresDetectados.map((emissor) => (
                  <div key={emissor.codigo} className="rounded-lg border border-bbt-gray-100 dark:border-slate-700 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <div className="font-semibold">{emissor.codigo}</div>
                        <div className="text-xs text-slate-500">{emissor.qtd} venda(s) no arquivo</div>
                      </div>
                      <span className="text-[10px] px-2 py-1 rounded bg-bbt-gray-50 dark:bg-slate-800">
                        {emissorMap[emissor.codigo]?.user_name || fuzzyAgente({ emissor_codigo: emissor.codigo } as WintourSaleRecord)?.name || 'Nao mapeado'}
                      </span>
                    </div>
                    <select
                      value={emissorMap[emissor.codigo]?.user_id || fuzzyAgente({ emissor_codigo: emissor.codigo } as WintourSaleRecord)?.id || ''}
                      onChange={(event) => void alterarEmissor(emissor.codigo, event.target.value)}
                      disabled={emissorSavingCode === emissor.codigo}
                      className="bbt-input w-full text-sm"
                    >
                      <option value="">Nao mapear / usar usuario atual</option>
                      {agentesBBT.map((agente) => (
                        <option key={agente.id} value={agente.id}>{agente.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-3">
                O vínculo é salvo com segurança para o tenant. Na próxima importação, o mesmo emissor do Wintour será associado ao agente BBT correto para produtividade e faturamento.
              </p>
            </div>
          )}

          <div className="bbt-card overflow-hidden">
            <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Search className="w-4 h-4 text-bbt-accent" /> Previa de sincronizacao
                </h3>
                {resultado.records.length > PREVIEW_LIMIT && (
                  <p className="text-xs text-slate-500 mt-1">
                    Exibindo os primeiros {PREVIEW_LIMIT} de {resultado.records.length} registros. A sincronizacao processa todos os selecionados.
                  </p>
                )}
              </div>
              <button onClick={toggleTodos} className="text-xs text-bbt-accent hover:underline">
                {selecionados.size === resultado.records.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead className="bg-bbt-gray-50 dark:bg-slate-900/40 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-center">OK</th>
                    <th className="px-2 py-2 text-left">Venda</th>
                    <th className="px-2 py-2 text-left">Data</th>
                    <th className="px-2 py-2 text-left">Empresa</th>
                    <th className="px-2 py-2 text-left">Viajante</th>
                    <th className="px-2 py-2 text-left">Check-in/out</th>
                    <th className="px-2 py-2 text-left">Emissor</th>
                    <th className="px-2 py-2 text-left">Solicitante/CC</th>
                    <th className="px-2 py-2 text-left">Tipo</th>
                    <th className="px-2 py-2 text-right">Venda</th>
                    <th className="px-2 py-2 text-right">Custo</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {analisePrevia.map(({ record, matchEmpresa, matchFuncionario, duplicata }, index) => {
                    const selecionado = selecionados.has(index)
                    const empresaStatus = matchEmpresa.empresa ? matchEmpresa.empresa.nome : autoEmpresa ? 'Criar no BBT' : 'Nao encontrada'
                    const funcionarioStatus = matchFuncionario.funcionario ? matchFuncionario.funcionario.nome : autoFuncionario ? 'Criar viajante' : 'Nao localizado'
                    const bloqueado = !matchEmpresa.empresa && !autoEmpresa && !record.empresa_nome && !record.empresa_codigo
                    return (
                      <tr key={`${criarFingerprintWintour(record)}-${index}`} className={`border-t border-bbt-gray-100 dark:border-slate-700 ${!selecionado ? 'opacity-50' : ''}`}>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={selecionado} disabled={bloqueado} onChange={() => toggle(index)} />
                        </td>
                        <td className="px-2 py-2 font-mono">{record.venda_numero || 'fingerprint'}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{record.data_venda || '-'}</td>
                        <td className="px-2 py-2 min-w-[210px]">
                          <div className="font-medium truncate">{empresaStatus}</div>
                          <div className="text-[10px] text-slate-500 truncate">{record.empresa_codigo || record.empresa_nome}</div>
                        </td>
                        <td className="px-2 py-2 min-w-[210px]">
                          <div className="font-medium truncate">{record.passageiro || '-'}</div>
                          <div className="text-[10px] text-slate-500 truncate">{funcionarioStatus}</div>
                        </td>
                        <td className="px-2 py-2 min-w-[160px] whitespace-nowrap">
                          <div className="font-medium">{record.data_inicio_servico || '-'}</div>
                          <div className="text-[10px] text-slate-500">{record.data_fim_servico || '-'}</div>
                        </td>
                        <td className="px-2 py-2 min-w-[160px]">
                          <div className="font-medium truncate">{agenteNomePara(record)}</div>
                          <div className="text-[10px] text-slate-500 truncate">{record.emissor_codigo || '-'}</div>
                        </td>
                        <td className="px-2 py-2 min-w-[180px]">
                          <div className="font-medium truncate">{record.solicitante_nome || '-'}</div>
                          <div className="text-[10px] text-slate-500 truncate">{record.centro_custo || record.departamento || record.projeto || '-'}</div>
                        </td>
                        <td className="px-2 py-2">{record.tipo_servico}</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(record.valor_total)}</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(record.valor_custo)}</td>
                        <td className="px-2 py-2">
                          <span className="rounded px-1.5 py-0.5 bg-bbt-gray-50 dark:bg-slate-800">{record.status}</span>
                        </td>
                        <td className="px-2 py-2">
                          {duplicata ? (
                            <span className="text-blue-600">Atualizar</span>
                          ) : record.warnings.length > 0 ? (
                            <span title={record.warnings.join('\n')} className="text-amber-600">Revisar</span>
                          ) : (
                            <span className="text-green-600">Criar</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!outcome ? (
            <div className="flex justify-end gap-2">
              <button onClick={resetar} className="bbt-button-ghost">Cancelar</button>
              <button onClick={importar} disabled={importando || selecionados.size === 0} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
                {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {importando && importProgress
                  ? `Processando ${importProgress.processed.toLocaleString('pt-BR')} de ${importProgress.total.toLocaleString('pt-BR')}`
                  : `Sincronizar ${selecionados.size.toLocaleString('pt-BR')} venda(s)`}
              </button>
            </div>
          ) : (
            <div className="bbt-card p-5 border-2 border-green-300 dark:border-green-700">
              <h3 className="font-semibold text-green-700 dark:text-green-400 flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5" /> Importacao Wintour concluida
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-9 gap-3">
                <Stat label="Criadas" value={String(outcome.criadas)} />
                <Stat label="Atualizadas" value={String(outcome.atualizadas)} />
                <Stat label="Ignoradas" value={String(outcome.ignoradas)} />
                <Stat label="Erros" value={String(outcome.erros)} />
                <Stat label="Empresas" value={String(outcome.empresas)} />
                <Stat label="Viajantes" value={String(outcome.funcionarios)} />
                <Stat label="Vouchers" value={String(outcome.vouchers)} />
                <Stat label="Financeiro" value={String(outcome.financeiro)} />
                <Stat label="Hotéis" value={String(outcome.hoteis)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Step({ numero, titulo, texto }: { numero: string; titulo: string; texto: string }) {
  return (
    <div className="rounded-lg border border-bbt-gray-100 dark:border-slate-700 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-full bg-bbt-accent text-white text-xs font-bold flex items-center justify-center">{numero}</span>
        <span className="font-semibold">{titulo}</span>
      </div>
      <p className="text-xs text-slate-500">{texto}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bbt-gray-50 dark:bg-slate-800 p-3">
      <div className="break-words text-[10px] uppercase leading-tight tracking-wider text-slate-500 [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-0.5 break-words font-bold leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</div>
    </div>
  )
}
