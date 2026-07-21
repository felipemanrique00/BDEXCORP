'use client'
import { todayISODate } from '@/lib/date'
import { useState } from 'react'
import { Upload, FileText, Loader2, CheckCircle2, AlertTriangle, ChevronRight, Sparkles, Hotel as HotelIcon, Users } from 'lucide-react'
import { toast } from 'sonner'
import { detectarTipoArquivo, LABELS_TIPO, type TipoImportacao, type DeteccaoArquivo } from '@/lib/detector-arquivo'
import type { ResultadoParseMapa, RegistroMapa } from '@/lib/parser-mapa-producao'
import type { VoucherParsed } from '@/lib/parser-voucher-bbt'
import type { ResultadoParseFuncionarios, FuncionarioParsed } from '@/lib/parser-funcionarios-xlsx'
import type { ResultadoParseHoteis, HotelParsed } from '@/lib/parser-hoteis-xlsx'
import { useStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth'
import { addAtendimento, anexarVoucherAtendimento } from '@/lib/atendimentos-storage'
import { upsertVoucherEmitido } from '@/lib/vouchers-emitidos-storage'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente, normalizarTextoIdentidade } from '@/lib/funcionario-identidade'
import type { Empresa, Funcionario, Hotel } from '@/types'
import { CONFIG_COBRANCA_PADRAO } from '@/types'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'

type Fase = 'selecionar' | 'detectando' | 'extraindo' | 'preview' | 'salvando' | 'concluido'

export default function ImportarPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas, funcionarios, addEmpresa, addFuncionario, updateFuncionario } = useStore()

  const [fase, setFase] = useState<Fase>('selecionar')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [deteccao, setDeteccao] = useState<DeteccaoArquivo | null>(null)
  const [resultadoMapa, setResultadoMapa] = useState<ResultadoParseMapa | null>(null)
  const [resultadoVoucher, setResultadoVoucher] = useState<VoucherParsed | null>(null)
  const [resultadoFuncs, setResultadoFuncs] = useState<ResultadoParseFuncionarios | null>(null)
  const [resultadoHoteis, setResultadoHoteis] = useState<ResultadoParseHoteis | null>(null)
  const [registrosEditados, setRegistrosEditados] = useState<RegistroMapa[]>([])
  const [registrosIgnorados, setRegistrosIgnorados] = useState<Set<string>>(new Set())
  const [resumoFinal, setResumoFinal] = useState<{ criados: number; atualizados: number; ignorados: number; funcionarios: number } | null>(null)
  const [empresaDestino, setEmpresaDestino] = useState<string>('')

  function reset() {
    setFase('selecionar'); setArquivo(null); setDeteccao(null); setResultadoMapa(null)
    setResultadoVoucher(null); setResultadoFuncs(null); setResultadoHoteis(null); setRegistrosEditados([])
    setRegistrosIgnorados(new Set()); setResumoFinal(null); setEmpresaDestino('')
  }

  async function confirmarPersistenciaImportacao(): Promise<boolean> {
    try {
      await commitPendingRemoteStorage()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a importacao no servidor.')
      setFase('preview')
      return false
    }
  }

  async function handleArquivo(f: File) {
    setArquivo(f); setFase('detectando')
    try {
      const det = await detectarTipoArquivo(f)
      setDeteccao(det)
      if (det.tipo === 'desconhecido') {
        setFase('selecionar')
        toast.error(`Tipo não identificado. ${det.motivo}. Escolha manualmente abaixo.`)
        return
      }
      // Aceita confiança alta OU média
      if (det.confianca === 'alta' || det.confianca === 'media') {
        await extrairDados(f, det.tipo)
      } else {
        setFase('selecionar')
        toast.info(`Detectei como "${LABELS_TIPO[det.tipo].titulo}" (confiança baixa). Confirme ou escolha outro tipo.`)
      }
    } catch (e: any) {
      console.error('[Importar] Erro detecção:', e)
      toast.error('Erro ao detectar: ' + (e.message || e))
      setFase('selecionar')
    }
  }

  async function extrairDados(f: File, tipo: TipoImportacao) {
    setFase('extraindo')
    try {
      if (tipo === 'mapa_producao_pdf') {
        const { parseMapaProducao } = await import('@/lib/parser-mapa-producao')
        const r = await parseMapaProducao(f)
        setResultadoMapa(r); setRegistrosEditados([...r.registros])
      } else if (tipo === 'voucher_bbt_pdf') {
        const { parseVoucherBBT } = await import('@/lib/parser-voucher-bbt')
        const r = await parseVoucherBBT(f)
        setResultadoVoucher(r)
        const func = encontrarFuncionarioPorNome(r.cliente_nome)
        if (func?.company_id) setEmpresaDestino(func.company_id)
      } else if (tipo === 'planilha_funcionarios') {
        const { parsePlanilhaFuncionarios } = await import('@/lib/parser-funcionarios-xlsx')
        const r = await parsePlanilhaFuncionarios(f)
        setResultadoFuncs(r)
        if (r.empresa_nome_arquivo) {
          const emp = empresas.find((e) =>
            e.nome.toUpperCase().includes(r.empresa_nome_arquivo!) ||
            (e.codigo_cliente || '').toUpperCase() === r.empresa_nome_arquivo
          )
          if (emp) setEmpresaDestino(emp.id)
        }
      } else if (tipo === 'planilha_hoteis') {
        const { parsePlanilhaHoteis } = await import('@/lib/parser-hoteis-xlsx')
        const r = await parsePlanilhaHoteis(f)
        setResultadoHoteis(r)
      } else if (tipo === 'planilha_emissoes') {
        // Emissões: tenta parsear como mapa de produção (mesmo formato de colunas)
        try {
          const { parseMapaProducao } = await import('@/lib/parser-mapa-producao')
          const r = await parseMapaProducao(f)
          setResultadoMapa(r); setRegistrosEditados([...r.registros])
        } catch {
          toast.error('Planilha de emissões não reconhecida. Verifique se é o Mapa de Produção BBT.')
          setFase('selecionar'); return
        }
      } else if (tipo === 'wintour_xml') {
        toast.info('XML Wintour detectado. Abrindo a tela propria de integracao Wintour.')
        window.location.href = '/dashboard/wintour'
        return
      } else {
        toast.error(`Tipo "${tipo}" ainda não tem importador`); setFase('selecionar'); return
      }
      setFase('preview')
    } catch (e: any) {
      console.error(e); toast.error('Erro extraindo: ' + e.message); setFase('selecionar')
    }
  }

  async function salvarMapa() {
    if (!resultadoMapa || !user) return
    setFase('salvando')
    try {
      let empresaId: string | null = null
      const clienteNome = resultadoMapa.cliente_filtro
      if (clienteNome) {
        const norm = clienteNome.toLowerCase()
        let emp = empresas.find((e) => e.nome.toLowerCase() === norm || e.nome.toLowerCase().includes(norm.split(' ')[0]))
        if (!emp) {
          const codigo = clienteNome.split(' ')[0].toUpperCase().slice(0, 8)
          emp = addEmpresa({
            nome: clienteNome, cnpj: '', codigo_cliente: codigo,
            endereco: '', responsavel: '', email_responsavel: '', telefone: '',
            centro_custo_padrao: '', ativa: true,
            config_cobranca: { ...CONFIG_COBRANCA_PADRAO },
          } as any) || undefined
        }
        if (emp) empresaId = emp.id
      }
      if (!empresaId) { toast.error('Empresa não identificada'); setFase('preview'); return }

      let criados = 0, atualizados = 0, ignorados = 0, novosFuncs = 0
      const funcionariosAtuais = [...funcionarios]
      const nomeFallbackMap = new Map<string, Funcionario>(
        funcionariosAtuais.map((f) => [`${f.company_id}|${normalizarTextoIdentidade(f.nome)}`, f]),
      )

      for (const reg of registrosEditados) {
        if (registrosIgnorados.has(reg.venda_numero)) { ignorados++; continue }
        let funcId: string | null = null
        if (reg.passageiro_completo) {
          const chave = `${empresaId}|${normalizarTextoIdentidade(reg.passageiro_completo)}`
          const matchNome = encontrarFuncionarioPorNomeInteligente(funcionariosAtuais, reg.passageiro_completo, empresaId, 84)
          const existente = matchNome && !matchNome.ambiguo ? matchNome.funcionario : nomeFallbackMap.get(chave)
          if (existente) {
            funcId = existente.id
          } else {
            const novoFunc = addFuncionario({
              nome: reg.passageiro_completo, cpf: '', email: '', telefone: '', cargo: '',
              centro_custo: reg.centro_custo, data_nascimento: null, company_id: empresaId,
              ativo: true,
            } as any)
            if (novoFunc) {
              funcionariosAtuais.push(novoFunc); nomeFallbackMap.set(chave, novoFunc); funcId = novoFunc.id; novosFuncs++
            }
          }
        }
        const tipoServico = reg.tipo_registro === 'HTL' ? 'Hotel' : reg.tipo_registro === 'TKT' ? 'Aéreo' : reg.tipo_registro === 'CAR' ? 'Carro' : 'Outro'
        try {
          addAtendimento({
            empresa_id: empresaId, funcionario_id: funcId,
            passageiro_nome: reg.passageiro_completo, tipo_servico: tipoServico as any,
            valor_cotacao: reg.tarifa, valor_final: reg.tarifa, valor_custo: reg.a_pagar,
            valor_venda: reg.a_receber || reg.tarifa, markup_valor: reg.markup,
            agente_user_id: user.id,
            status: reg.status === 'CF' ? 'finalizado' : reg.status === 'CA' ? 'cancelado' : 'em_andamento',
            prioridade: 'media', origem: 'Portal',
            observacoes: `Importado do Mapa de Produção. ${reg.rota_descricao}`.slice(0, 500),
            data_atendimento: reg.data_venda || todayISODate(),
            venda_numero: reg.venda_numero, emissor_codigo: reg.emissor, origem_emissao: 'pdf_emissao',
            detalhes_hotel: tipoServico === 'Hotel' ? {
              hotel_nome: reg.produto || reg.fornecedor, num_hospedes: 1,
              data_checkin: reg.data_inicio_servico, data_checkout: reg.data_fim_servico,
            } : undefined,
            detalhes_aereo: tipoServico === 'Aéreo' ? {
              cia_aerea: reg.produto, localizador: reg.forma_documento,
            } : undefined,
          } as any)
          criados++
        } catch (e) { console.error(e); ignorados++ }
      }
      if (!await confirmarPersistenciaImportacao()) return
      setResumoFinal({ criados, atualizados, ignorados, funcionarios: novosFuncs })
      setFase('concluido')
      toast.success(`✓ ${criados} demandas criadas`)
    } catch (e: any) {
      toast.error('Erro: ' + e.message); setFase('preview')
    }
  }

  async function salvarFuncionarios() {
    if (!resultadoFuncs || !empresaDestino) { toast.error('Selecione a empresa destino'); return }
    setFase('salvando')
    let criados = 0, atualizados = 0, ignorados = 0
    const baseAtual = [...funcionarios]
    for (const f of resultadoFuncs.funcionarios) {
      if (!f.nome) { ignorados++; continue }
      const dados = {
        nome: f.nome, cpf: f.cpf, email: '', telefone: '', cargo: f.cargo,
        centro_custo: f.centro_custo, data_nascimento: f.data_nascimento || null,
        aliases_nome: f.aliases_nome || [],
        company_id: empresaDestino, ativo: true,
      } as any
      const existente = encontrarFuncionarioConfiavel(baseAtual, dados, empresaDestino)
      if (existente) {
        const cargoImportado = ['Diretor', 'Gerente', 'Colaborador'].includes(f.cargo) ? f.cargo as Funcionario['cargo'] : existente.cargo
        const patch: Partial<Funcionario> = {
          nome: f.nome || existente.nome,
          cpf: f.cpf || existente.cpf,
          cargo: cargoImportado,
          centro_custo: f.centro_custo || existente.centro_custo,
          data_nascimento: f.data_nascimento || existente.data_nascimento,
          aliases_nome: Array.from(new Set([...(existente.aliases_nome || []), ...(f.aliases_nome || [])])),
          ativo: true,
        }
        updateFuncionario(existente.id, patch)
        Object.assign(existente, patch)
        atualizados++
        continue
      }
      const novo = addFuncionario(dados)
      if (novo) { baseAtual.push(novo); criados++ }
    }
    if (!await confirmarPersistenciaImportacao()) return
    setResumoFinal({ criados, atualizados, ignorados, funcionarios: criados })
    setFase('concluido')
    toast.success(`✓ ${criados} funcionários cadastrados, ${atualizados} atualizados`)
  }

  async function salvarHoteis() {
    if (!resultadoHoteis) return
    setFase('salvando')
    let criados = 0, atualizados = 0, ignorados = 0
    const { hoteis: hoteisExistentes, addHotel, updateHotel } = useStore.getState()
    const existentesPorNome = new Map<string, Hotel>(hoteisExistentes.map((h) => [h.nome.toLowerCase().trim(), h]))

    for (const h of resultadoHoteis.hoteis) {
      if (!h.nome) { ignorados++; continue }
      const chave = h.nome.toLowerCase().trim()
      const existente = existentesPorNome.get(chave)
      const dados: Omit<Hotel, 'id'> = {
        nome: h.nome,
        cidade: h.cidade,
        uf: h.uf,
        categoria: (h.categoria || undefined) as any,
        observacoes: h.observacoes || null,
        telefone: h.telefone || null,
        faturado: h.faturado,
        info_faturamento: h.info_faturamento || null,
        bebedouro: h.bebedouro || null,
        valor_agua: h.valor_agua,
        cafe_manha: h.cafe_manha || null,
        estacionamento: h.estacionamento || null,
        tarifa_sgl: h.tarifa_sgl,
        tarifa_dbl: h.tarifa_dbl,
        tarifa_tpl: h.tarifa_tpl,
        formas_pagamento: [],
      }
      if (existente) {
        if (updateHotel) {
          updateHotel(existente.id, dados)
          atualizados++
        } else {
          ignorados++
        }
      } else {
        addHotel(dados)
        criados++
      }
    }
    if (!await confirmarPersistenciaImportacao()) return
    setResumoFinal({ criados, atualizados, ignorados, funcionarios: 0 })
    setFase('concluido')
    toast.success(`✓ ${criados} hotéis cadastrados, ${atualizados} atualizados`)
  }

  async function salvarVoucherImportado() {
    if (!resultadoVoucher || !user) return
    if (!empresaDestino) {
      toast.error('Selecione a empresa destino para vincular o voucher.')
      return
    }

    setFase('salvando')
    try {
      const func = encontrarFuncionarioPorNome(resultadoVoucher.cliente_nome)
      const funcionarioId = func?.company_id === empresaDestino ? func.id : null
      const passageiro = resultadoVoucher.cliente_nome || 'Hóspede não informado'
      const dataAtendimento = resultadoVoucher.data_emissao || todayISODate()

      const atendimento = addAtendimento({
        empresa_id: empresaDestino,
        funcionario_id: funcionarioId,
        passageiro_nome: passageiro,
        tipo_servico: 'Hotel',
        valor_cotacao: 0,
        valor_final: 0,
        valor_custo: 0,
        valor_venda: 0,
        agente_user_id: user.id,
        status: 'finalizado',
        prioridade: 'media',
        origem: 'Portal',
        observacoes: [
          `Demanda criada automaticamente a partir do voucher importado ${resultadoVoucher.voucher_numero || ''}.`,
          resultadoVoucher.observacoes,
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500),
        data_atendimento: dataAtendimento,
        origem_emissao: 'voucher_pdf',
        detalhes_hotel: {
          hotel_nome: resultadoVoucher.hotel_nome,
          cidade: resultadoVoucher.hotel_cidade,
          data_checkin: resultadoVoucher.data_checkin,
          data_checkout: resultadoVoucher.data_checkout,
          num_hospedes: resultadoVoucher.num_hospedes,
          tipo_apto: resultadoVoucher.tipo_apartamento,
          noites: resultadoVoucher.noites,
          localizador: resultadoVoucher.numero_confirmacao,
        },
      } as any)

      const numeroVoucher = normalizarNumeroVoucher(resultadoVoucher.voucher_numero)
      const voucher = upsertVoucherEmitido({
        id: numeroVoucher.id,
        numero: numeroVoucher.numero,
        tipo: 'Hotel',
        status: 'emitido',
        atendimento_id: atendimento?.id,
        empresa_id: empresaDestino,
        funcionario_id: funcionarioId,
        passageiro_nome: passageiro,
        passageiros: [passageiro],
        fornecedor_nome: resultadoVoucher.hotel_nome || 'Hotel não identificado',
        fornecedor_endereco: resultadoVoucher.hotel_endereco || undefined,
        fornecedor_cidade: resultadoVoucher.hotel_cidade || undefined,
        fornecedor_telefone: resultadoVoucher.hotel_telefone || undefined,
        hotel_categoria: resultadoVoucher.categoria || undefined,
        tipo_apartamento: resultadoVoucher.tipo_apartamento || undefined,
        num_apartamentos: resultadoVoucher.num_apartamentos,
        num_hospedes: resultadoVoucher.num_hospedes,
        data_checkin: resultadoVoucher.data_checkin || undefined,
        data_checkout: resultadoVoucher.data_checkout || undefined,
        noites: resultadoVoucher.noites,
        regime: resultadoVoucher.regime_alimentacao || undefined,
        forma_pagamento_voucher: resultadoVoucher.tipo_pagamento || undefined,
        numero_confirmacao: resultadoVoucher.numero_confirmacao || undefined,
        data_confirmacao: resultadoVoucher.data_confirmacao || undefined,
        confirmado_por: resultadoVoucher.confirmado_por || undefined,
        total: 0,
        observacoes: resultadoVoucher.observacoes || undefined,
        origem_voucher: 'importado',
        arquivo_original_nome: arquivo?.name,
        importado_em: new Date().toISOString(),
        fingerprint: criarFingerprintVoucher(resultadoVoucher),
        emitido_por_user_id: user.id,
        emitido_por_user_name: user.name,
        created_at: resultadoVoucher.data_emissao ? `${resultadoVoucher.data_emissao}T00:00:00.000Z` : new Date().toISOString(),
      })

      if (!voucher) throw new Error('Não foi possível salvar o voucher.')
      if (atendimento) anexarVoucherAtendimento(atendimento.id, voucher.id)

      if (!await confirmarPersistenciaImportacao()) return

      setResumoFinal({ criados: (atendimento ? 1 : 0) + 1, atualizados: 0, ignorados: 0, funcionarios: 0 })
      setFase('concluido')
      toast.success(`Voucher ${voucher.id} importado e vinculado às demandas.`)
    } catch (e: any) {
      toast.error('Erro ao salvar voucher: ' + (e.message || e))
      setFase('preview')
    }
  }

  function toggleIgnorar(venda: string) {
    setRegistrosIgnorados((p) => { const n = new Set(p); n.has(venda) ? n.delete(venda) : n.add(venda); return n })
  }
  function editarRegistro(idx: number, campo: keyof RegistroMapa, valor: any) {
    setRegistrosEditados((p) => { const n = [...p]; n[idx] = { ...n[idx], [campo]: valor }; return n })
  }

  function encontrarFuncionarioPorNome(nome: string): Funcionario | undefined {
    const match = encontrarFuncionarioPorNomeInteligente(funcionarios, nome, empresaDestino || undefined, 84)
    return match && !match.ambiguo ? match.funcionario : undefined
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Importação · Multi-formato</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Upload className="w-6 h-6 text-bbt-accent" /> Importar Dados
          </h1>
          <p className="bbt-page-subtitle">
            Suba qualquer arquivo: o sistema detecta o tipo e te guia.
          </p>
        </div>
      </div>

      {fase === 'selecionar' && !arquivo && (
        <div className="space-y-4">
          <label className="block border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition border-bbt-gray-100 dark:border-slate-700 hover:border-bbt-accent hover:bg-bbt-accent/5">
            <Upload className="w-12 h-12 mx-auto text-bbt-accent mb-3" />
            <p className="font-semibold text-lg">Clique para selecionar</p>
            <p className="text-sm text-slate-500 mt-1">PDF do Mapa de Produção, Voucher BBT, ou Excel de Funcionários</p>
            <input type="file" accept=".pdf,.xlsx,.xls,.csv,.xml" onChange={(e) => e.target.files?.[0] && handleArquivo(e.target.files[0])} className="hidden" />
          </label>
          <div className="bbt-card p-4">
            <h3 className="font-semibold mb-3 text-sm">Tipos suportados</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TipoCard icone={FileText} cor="text-red-500" titulo="Mapa de Produção (PDF)" desc="Analítico com vendas, custos, status CF/ND" />
              <TipoCard icone={HotelIcon} cor="text-blue-500" titulo="Voucher BBT (PDF)" desc="Voucher de hospedagem do sistema BBT" />
              <TipoCard icone={Users} cor="text-green-500" titulo="Funcionários (XLSX)" desc="Nome, CPF, Centro de Custo, Cargo" />
              <TipoCard icone={HotelIcon} cor="text-purple-500" titulo="Hotéis (XLSX)" desc="Nome, Cidade, UF, Tarifas, Faturamento" />
              <TipoCard icone={Upload} cor="text-bbt-accent" titulo="Wintour (XML/XLSX)" desc="Vendas e emissoes diarias para demandas/financeiro" />
            </div>
          </div>
        </div>
      )}

      {(fase === 'detectando' || fase === 'extraindo') && (
        <div className="bbt-card p-12 text-center">
          <Loader2 className="w-14 h-14 mx-auto text-bbt-accent animate-spin mb-4" />
          <p className="font-semibold">{fase === 'detectando' ? 'Detectando tipo do arquivo...' : 'Extraindo dados...'}</p>
          <p className="text-xs text-slate-500 mt-1">{arquivo?.name}</p>
        </div>
      )}

      {fase === 'selecionar' && arquivo && deteccao && deteccao.tipo === 'desconhecido' && (
        <div className="bbt-card p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="font-semibold">Tipo não identificado</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{deteccao.motivo}</p>
              <p className="text-xs text-slate-400 mt-1">Arquivo: <strong>{arquivo.name}</strong> ({(arquivo.size / 1024).toFixed(1)} KB)</p>
            </div>
          </div>
          {deteccao.preview && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500 hover:text-bbt-accent">Ver preview do que foi extraído (debug)</summary>
              <pre className="mt-2 p-3 bg-slate-100 dark:bg-slate-800 rounded text-[10px] overflow-x-auto max-h-48 whitespace-pre-wrap">{deteccao.preview}</pre>
            </details>
          )}
          <p className="text-xs text-slate-500">Selecione manualmente o tipo abaixo:</p>
          <div className="grid grid-cols-2 gap-2">
            {(['mapa_producao_pdf', 'voucher_bbt_pdf', 'planilha_funcionarios', 'planilha_hoteis', 'planilha_emissoes'] as TipoImportacao[]).map((t) => (
              <button key={t} onClick={() => extrairDados(arquivo, t)} className="bbt-button-ghost text-left p-3 text-xs">
                <strong>{LABELS_TIPO[t].titulo}</strong>
                <div className="text-slate-500 mt-1">{LABELS_TIPO[t].descricao}</div>
              </button>
            ))}
          </div>
          <button onClick={reset} className="text-xs text-bbt-accent hover:underline">Cancelar</button>
        </div>
      )}

      {fase === 'preview' && resultadoMapa && (
        <PreviewMapa resultado={resultadoMapa} registros={registrosEditados} ignorados={registrosIgnorados}
          onToggleIgnorar={toggleIgnorar} onEditar={editarRegistro} onSalvar={salvarMapa} onCancelar={reset} />
      )}
      {fase === 'preview' && resultadoVoucher && (
        <PreviewVoucher
          resultado={resultadoVoucher}
          empresas={empresas}
          empresaDestino={empresaDestino}
          onChangeEmpresa={setEmpresaDestino}
          onSalvar={salvarVoucherImportado}
          onCancelar={reset}
        />
      )}
      {fase === 'preview' && resultadoFuncs && (
        <PreviewFuncionarios resultado={resultadoFuncs} empresas={empresas}
          empresaDestino={empresaDestino} onChangeEmpresa={setEmpresaDestino}
          onSalvar={salvarFuncionarios} onCancelar={reset} />
      )}
      {fase === 'preview' && resultadoHoteis && (
        <PreviewHoteis resultado={resultadoHoteis} onSalvar={salvarHoteis} onCancelar={reset} />
      )}

      {fase === 'salvando' && (
        <div className="bbt-card p-12 text-center">
          <Loader2 className="w-14 h-14 mx-auto text-bbt-accent animate-spin mb-4" />
          <p className="font-semibold">Salvando no sistema...</p>
        </div>
      )}

      {fase === 'concluido' && resumoFinal && (
        <div className="bbt-card p-8 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
          <h2 className="text-2xl font-bold">Importação concluída!</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
            <Stat label="Criados" valor={resumoFinal.criados} cor="text-green-600" />
            <Stat label="Atualizados" valor={resumoFinal.atualizados} cor="text-blue-600" />
            <Stat label="Ignorados" valor={resumoFinal.ignorados} cor="text-slate-500" />
            <Stat label="Funcionários novos" valor={resumoFinal.funcionarios} cor="text-purple-600" />
          </div>
          <button onClick={reset} className="bbt-button-primary">Importar outro arquivo</button>
        </div>
      )}
    </div>
  )
}

function TipoCard({ icone: Icon, cor, titulo, desc }: any) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
      <Icon className={`w-5 h-5 ${cor} shrink-0 mt-0.5`} />
      <div><div className="font-semibold text-sm">{titulo}</div><div className="text-xs text-slate-500">{desc}</div></div>
    </div>
  )
}

function normalizarBusca(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizarNumeroVoucher(raw: string): { id: string; numero: string } {
  const m = String(raw || '').match(/([A-Z])\s*[- ]?\s*(\d+)/i)
  if (m) {
    const letra = m[1].toUpperCase()
    const numero = m[2]
    return { id: `${letra}-${numero}`, numero }
  }
  const fallback = String(Date.now()).slice(-6)
  return { id: `H-${fallback}`, numero: fallback }
}

function criarFingerprintVoucher(v: VoucherParsed): string {
  return normalizarBusca([
    v.voucher_numero,
    v.cliente_nome,
    v.hotel_nome,
    v.data_checkin,
    v.data_checkout,
  ].join('|'))
}

function Stat({ label, valor, cor }: any) {
  return (
    <div className="p-3 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold ${cor}`}>{valor}</div>
    </div>
  )
}

function PreviewMapa({ resultado, registros, ignorados, onToggleIgnorar, onEditar, onSalvar, onCancelar }: any) {
  const ativos = registros.filter((r: RegistroMapa) => !ignorados.has(r.venda_numero)).length
  return (
    <div className="space-y-4">
      <div className="bbt-card p-4 bg-gradient-to-br from-bbt-accent/5 to-transparent border-bbt-accent/30">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-bbt-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold">Mapa de Produção identificado</h3>
            <div className="text-sm mt-1 space-y-0.5">
              <div><strong>Cliente:</strong> {resultado.cliente_filtro || '⚠️ não detectado'}</div>
              <div><strong>Período:</strong> {resultado.periodo_inicio} a {resultado.periodo_fim}</div>
              <div><strong>Total declarado no PDF:</strong> {resultado.totais_pdf.numero_vendas} vendas</div>
              <div><strong>Extraídos:</strong> {resultado.estatisticas.extraidos} registros · <span className="text-amber-600">{resultado.estatisticas.com_warnings} com avisos</span></div>
            </div>
            {resultado.warnings_globais.length > 0 && (
              <div className="mt-2 space-y-1">
                {resultado.warnings_globais.map((w: string, i: number) => (
                  <div key={i} className="text-xs text-amber-600 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5" /> {w}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          {Object.entries(resultado.estatisticas.por_tipo).map(([k, v]) => (
            <div key={k} className="bg-white dark:bg-slate-800 rounded p-2">
              <div className="text-slate-400 uppercase text-[10px]">{k}</div>
              <div className="font-bold">{v as number}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bbt-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-bbt-gray-50 dark:bg-slate-900/30 sticky top-0">
            <tr>
              <th className="px-2 py-2">✓</th>
              <th className="px-2 py-2 text-left">Venda</th>
              <th className="px-2 py-2 text-left">Data</th>
              <th className="px-2 py-2 text-left">Tipo</th>
              <th className="px-2 py-2 text-left">Produto</th>
              <th className="px-2 py-2 text-left">Passageiro</th>
              <th className="px-2 py-2 text-left">Período</th>
              <th className="px-2 py-2 text-right">Tarifa</th>
              <th className="px-2 py-2 text-right">A Pagar</th>
              <th className="px-2 py-2 text-right">Markup</th>
              <th className="px-2 py-2 text-left">Emissor</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {registros.map((r: RegistroMapa, idx: number) => {
              const ig = ignorados.has(r.venda_numero)
              const wn = r.warnings.length > 0
              return (
                <tr key={r.venda_numero + idx} className={`border-t border-bbt-gray-100 dark:border-slate-700 ${ig ? 'opacity-40' : ''} ${wn ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={!ig} onChange={() => onToggleIgnorar(r.venda_numero)} />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{r.venda_numero}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.data_venda}</td>
                  <td className="px-2 py-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{r.tipo_registro}</span></td>
                  <td className="px-2 py-1.5 truncate max-w-[100px]" title={r.produto}>{r.produto}</td>
                  <td className="px-2 py-1.5 truncate max-w-[180px]">
                    <input value={r.passageiro_completo} onChange={(e) => onEditar(idx, 'passageiro_completo', e.target.value)}
                      className="bg-transparent border-b border-transparent hover:border-bbt-accent focus:border-bbt-accent focus:outline-none w-full" />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-500 text-[10px]">
                    {r.data_inicio_servico ? `${r.data_inicio_servico} → ${r.data_fim_servico}` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">{r.tarifa.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right text-orange-600">{r.a_pagar.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right text-green-600 font-semibold">{r.markup.toFixed(2)}</td>
                  <td className="px-2 py-1.5">{r.emissor}</td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status === 'CF' ? 'bg-green-100 text-green-700' : r.status === 'CA' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {wn && <span title={r.warnings.join('\n')} className="text-amber-600 cursor-help"><AlertTriangle className="w-3 h-3" /></span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-white dark:bg-slate-900 border-t border-bbt-gray-100 dark:border-slate-700 -mx-4 px-4 py-3">
        <div className="text-sm">
          <strong className="text-bbt-accent">{ativos}</strong> de <strong>{registros.length}</strong> registros serão importados
        </div>
        <div className="flex gap-2">
          <button onClick={onCancelar} className="bbt-button-ghost">Cancelar</button>
          <button onClick={onSalvar} disabled={ativos === 0} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
            <ChevronRight className="w-4 h-4" /> Importar {ativos} registros
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewVoucher({
  resultado,
  empresas,
  empresaDestino,
  onChangeEmpresa,
  onSalvar,
  onCancelar,
}: {
  resultado: VoucherParsed
  empresas: Empresa[]
  empresaDestino: string
  onChangeEmpresa: (id: string) => void
  onSalvar: () => void
  onCancelar: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="bbt-card p-4 bg-gradient-to-br from-bbt-accent/5 to-transparent">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <HotelIcon className="w-5 h-5 text-bbt-accent" /> Voucher {resultado.voucher_numero}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Campo label="Hóspede" valor={resultado.cliente_nome} />
          <Campo label="Hotel" valor={resultado.hotel_nome} />
          <Campo label="Cidade" valor={resultado.hotel_cidade} />
          <Campo label="Telefone Hotel" valor={resultado.hotel_telefone || '—'} />
          <Campo label="Endereço" valor={resultado.hotel_endereco} colSpan />
          <Campo label="Check-In" valor={resultado.data_checkin} />
          <Campo label="Check-Out" valor={resultado.data_checkout} />
          <Campo label="Noites" valor={String(resultado.noites)} />
          <Campo label="Hóspedes" valor={String(resultado.num_hospedes)} />
          <Campo label="Categoria" valor={resultado.categoria} />
          <Campo label="Tipo Apto" valor={resultado.tipo_apartamento} />
          <Campo label="Tipo Pagamento" valor={resultado.tipo_pagamento} />
          <Campo label="Regime" valor={resultado.regime_alimentacao} />
          <Campo label="Cadastrado por" valor={resultado.cadastrado_por} />
        </div>
        {resultado.warnings.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs space-y-1">
            {resultado.warnings.map((w, i) => (<div key={i} className="text-amber-700 dark:text-amber-300">⚠️ {w}</div>))}
          </div>
        )}
      </div>
      <div className="bbt-card p-4 space-y-3">
        <div>
          <label className="text-sm font-semibold">Empresa destino para vincular: *</label>
          <select value={empresaDestino} onChange={(e) => onChangeEmpresa(e.target.value)} className="bbt-input w-full mt-1">
            <option value="">Selecione...</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500">
          Ao salvar, o sistema cria uma demanda de origem <strong>voucher_pdf</strong>, cadastra este voucher na aba
          <strong> Vouchers</strong> e liga os dois registros para a IA localizar depois por passageiro, empresa, cidade ou data.
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancelar} className="bbt-button-ghost">Cancelar</button>
        <button onClick={onSalvar} disabled={!empresaDestino} className="bbt-button-primary disabled:opacity-50 flex items-center gap-2">
          <ChevronRight className="w-4 h-4" /> Salvar voucher + demanda
        </button>
      </div>
    </div>
  )
}

function Campo({ label, valor, colSpan }: any) {
  return (
    <div className={colSpan ? 'md:col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-medium">{valor || '—'}</div>
    </div>
  )
}

function PreviewFuncionarios({ resultado, empresas, empresaDestino, onChangeEmpresa, onSalvar, onCancelar }: any) {
  return (
    <div className="space-y-4">
      <div className="bbt-card p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Users className="w-5 h-5 text-bbt-accent" /> Planilha de Funcionários
        </h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Total linhas" valor={resultado.total_linhas} cor="text-bbt-primary" />
          <Stat label="Funcionários válidos" valor={resultado.funcionarios.length} cor="text-green-600" />
          <Stat label="CPFs duplicados" valor={resultado.duplicatas_internas} cor="text-amber-600" />
        </div>
        <div>
          <label className="text-sm font-semibold">Empresa destino: *</label>
          <select value={empresaDestino} onChange={(e) => onChangeEmpresa(e.target.value)} className="bbt-input w-full mt-1">
            <option value="">Selecione...</option>
            {empresas.map((e: Empresa) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          {resultado.empresa_nome_arquivo && (
            <div className="text-xs text-slate-500 mt-1">Dica: Detectado pelo nome do arquivo: <strong>{resultado.empresa_nome_arquivo}</strong></div>
          )}
          {empresas.length === 0 && (
            <div className="text-xs text-amber-600 mt-2">
              ⚠️ Você ainda não tem empresas. Cadastre uma em Menu &gt; Empresas, depois volta aqui.
            </div>
          )}
        </div>
      </div>

      <div className="bbt-card overflow-x-auto max-h-[400px]">
        <table className="w-full text-xs">
          <thead className="bg-bbt-gray-50 dark:bg-slate-900/30 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left">Nome</th>
              <th className="px-2 py-2 text-left">CPF</th>
              <th className="px-2 py-2 text-left">Cargo</th>
              <th className="px-2 py-2 text-left">CC</th>
              <th className="px-2 py-2 text-left">Departamento</th>
              <th className="px-2 py-2 text-left">Nascimento</th>
            </tr>
          </thead>
          <tbody>
            {resultado.funcionarios.slice(0, 100).map((f: FuncionarioParsed, i: number) => (
              <tr key={i} className="border-t border-bbt-gray-100 dark:border-slate-700">
                <td className="px-2 py-1.5">{f.nome}</td>
                <td className="px-2 py-1.5 font-mono">{f.cpf || <span className="text-amber-500">—</span>}</td>
                <td className="px-2 py-1.5 truncate max-w-[200px]">{f.cargo}</td>
                <td className="px-2 py-1.5">{f.centro_custo}</td>
                <td className="px-2 py-1.5 truncate max-w-[180px]">{f.descricao_cc}</td>
                <td className="px-2 py-1.5">{f.data_nascimento}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {resultado.funcionarios.length > 100 && (
          <div className="p-2 text-xs text-slate-500 text-center bg-bbt-gray-50">
            ... e mais {resultado.funcionarios.length - 100} (todos serão importados)
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancelar} className="bbt-button-ghost">Cancelar</button>
        <button onClick={onSalvar} disabled={!empresaDestino} className="bbt-button-primary disabled:opacity-50 flex items-center gap-2">
          <ChevronRight className="w-4 h-4" /> Importar {resultado.funcionarios.length} funcionários
        </button>
      </div>
    </div>
  )
}

function PreviewHoteis({ resultado, onSalvar, onCancelar }: any) {
  return (
    <div className="space-y-4">
      <div className="bbt-card p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <HotelIcon className="w-5 h-5 text-bbt-accent" /> Planilha de Hotéis
        </h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Stat label="Total de linhas" valor={resultado.total_linhas} cor="text-bbt-primary" />
          <Stat label="Hotéis válidos" valor={resultado.hoteis.length} cor="text-green-600" />
          <Stat label="Duplicatas" valor={resultado.duplicatas_internas} cor="text-amber-600" />
        </div>
        {resultado.warnings_globais.length > 0 && (
          <div className="text-xs text-amber-600 space-y-1">
            {resultado.warnings_globais.map((w: string, i: number) => (
              <div key={i}>⚠️ {w}</div>
            ))}
          </div>
        )}
        <div className="text-xs text-slate-500 mt-2">
          Dica: Hotéis com nome igual aos já cadastrados serão <strong>atualizados</strong> (não duplicados).
        </div>
      </div>

      <div className="bbt-card overflow-x-auto max-h-[450px]">
        <table className="w-full text-xs">
          <thead className="bg-bbt-gray-50 dark:bg-slate-900/30 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left">Nome</th>
              <th className="px-2 py-2 text-left">Cidade</th>
              <th className="px-2 py-2 text-left">UF</th>
              <th className="px-2 py-2 text-left">Telefone</th>
              <th className="px-2 py-2 text-center">Cat.</th>
              <th className="px-2 py-2 text-right">SGL</th>
              <th className="px-2 py-2 text-right">DBL</th>
              <th className="px-2 py-2 text-right">TPL</th>
              <th className="px-2 py-2 text-center">Faturado</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {resultado.hoteis.slice(0, 200).map((h: HotelParsed, i: number) => (
              <tr key={i} className={`border-t border-bbt-gray-100 dark:border-slate-700 ${h.warnings.length > 0 ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>
                <td className="px-2 py-1.5 font-medium">{h.nome}</td>
                <td className="px-2 py-1.5">{h.cidade || <span className="text-amber-500">—</span>}</td>
                <td className="px-2 py-1.5">{h.uf || <span className="text-amber-500">—</span>}</td>
                <td className="px-2 py-1.5">{h.telefone || '—'}</td>
                <td className="px-2 py-1.5 text-center">{h.categoria ? '★'.repeat(parseInt(h.categoria)) : '—'}</td>
                <td className="px-2 py-1.5 text-right">{h.tarifa_sgl ? `R$ ${h.tarifa_sgl.toFixed(2)}` : '—'}</td>
                <td className="px-2 py-1.5 text-right">{h.tarifa_dbl ? `R$ ${h.tarifa_dbl.toFixed(2)}` : '—'}</td>
                <td className="px-2 py-1.5 text-right">{h.tarifa_tpl ? `R$ ${h.tarifa_tpl.toFixed(2)}` : '—'}</td>
                <td className="px-2 py-1.5 text-center">
                  {h.faturado ? <span className="text-green-600">✓</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-1.5">
                  {h.warnings.length > 0 && (
                    <span title={h.warnings.join('\n')} className="text-amber-600 cursor-help">
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resultado.hoteis.length > 200 && (
          <div className="p-2 text-xs text-slate-500 text-center bg-bbt-gray-50">
            ... e mais {resultado.hoteis.length - 200} (todos serão importados)
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancelar} className="bbt-button-ghost">Cancelar</button>
        <button onClick={onSalvar} disabled={resultado.hoteis.length === 0} className="bbt-button-primary disabled:opacity-50 flex items-center gap-2">
          <ChevronRight className="w-4 h-4" /> Importar {resultado.hoteis.length} hotéis
        </button>
      </div>
    </div>
  )
}

