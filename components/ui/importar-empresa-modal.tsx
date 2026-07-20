'use client'
import { todayISODate } from '@/lib/date'
import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import {
  Upload, FileSpreadsheet, FileText as FileIcon, Loader2, CheckCircle2,
  AlertTriangle, ChevronRight, Sparkles, X, RotateCcw,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { getCurrentUser, getAgentesBBT } from '@/lib/auth'
import { addAtendimento, updateAtendimento, getAllAtendimentos } from '@/lib/atendimentos-storage'
import {
  iniciarTransacao, commitarTransacao, registrarEvento, reverterTransacao,
  registrarExecutorRollback,
} from '@/lib/audit'
import {
  resolverFuncionario, detectarDuplicata, adicionarItemFila,
} from '@/lib/import-pipeline'
import { parsePDFEmissoes } from '@/lib/emissoes-pdf-parser'
import { parsePlanilhaEmissoes } from '@/lib/emissoes-parser'
import { gerarLancamentosDoAtendimento } from '@/lib/financeiro'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import {
  normalizarNome, normalizarValor, normalizarData, normalizarTipoServico,
  normalizarStatusEmissao,
} from '@/lib/normalizers'
import type { Atendimento, Empresa } from '@/types'
import { formatarValor } from '@/lib/normalizers'

// Registra o executor de rollback pra Atendimentos (uma vez só, idempotente)
if (typeof window !== 'undefined') {
  registrarExecutorRollback('Atendimento', (evt) => {
    if (!evt.entidade_id) return false
    if (evt.acao === 'criar' || evt.acao === 'importar') {
      // Estado anterior é null/undefined → apaga o atendimento criado
      const all = getAllAtendimentos()
      const idx = all.findIndex((a) => a.id === evt.entidade_id)
      if (idx >= 0) {
        // Não temos delete direto exposto, mas dá pra fazer via localStorage
        try {
          const STORAGE = 'bbt-atendimentos'
          const atual = loadJSON<any[]>(STORAGE, [])
          const filtrado = atual.filter((a: any) => a.id !== evt.entidade_id)
          safeSetJSON(STORAGE, filtrado)
          return true
        } catch { return false }
      }
    } else if (evt.acao === 'atualizar' && evt.estado_anterior) {
      // Restaura o estado anterior
      return updateAtendimento(evt.entidade_id, evt.estado_anterior)
    }
    return false
  })
}

interface Props {
  open: boolean
  onClose: () => void
  empresa: Empresa
  onCompleto?: (resumo: { criadas: number; atualizadas: number; ignoradas: number }) => void
}

type Fase = 'selecionar' | 'analisando' | 'preview' | 'importando' | 'concluido'

export function ImportarEmpresaModal({ open, onClose, empresa, onCompleto }: Props) {
  const { funcionarios } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null

  const [fase, setFase] = useState<Fase>('selecionar')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [dadosBrutos, setDadosBrutos] = useState<any>(null)
  const [analise, setAnalise] = useState<{
    novas: number
    duplicadas: number
    sem_passageiro: number
    funcionarios_resolvidos: number
    funcionarios_nao_resolvidos: number
    valor_total: number
  } | null>(null)
  const [resultado, setResultado] = useState<{
    criadas: number
    atualizadas: number
    ignoradas: number
    erros: number
    tx_id?: string
  } | null>(null)

  function reset() {
    setFase('selecionar')
    setArquivo(null)
    setDadosBrutos(null)
    setAnalise(null)
    setResultado(null)
  }

  async function handleArquivo(f: File) {
    setArquivo(f)
    setFase('analisando')
    try {
      const ext = f.name.toLowerCase().split('.').pop()
      let resumo: any
      let linhas: any[] = []
      if (ext === 'pdf') {
        resumo = await parsePDFEmissoes(f)
        linhas = resumo.linhas || []
      } else if (ext === 'xlsx' || ext === 'xls') {
        resumo = await parsePlanilhaEmissoes(f)
        linhas = resumo.linhas || []
      } else {
        throw new Error('Formato não suportado: ' + ext)
      }

      // Filtra somente as linhas dessa empresa específica
      const codigo = (empresa.codigo_cliente || '').toUpperCase().trim()
      const nomeEmp = empresa.nome.toLowerCase()

      const linhasDaEmpresa = linhas.filter((l: any) => {
        // PDF
        if (l.cod_cliente) {
          if (codigo && l.cod_cliente.toUpperCase() === codigo) return true
        }
        if (l.cliente_nome) {
          if (l.cliente_nome.toLowerCase().includes(nomeEmp.split(' ')[0])) return true
        }
        // Excel
        if (l.empresa_codigo) {
          if (codigo && l.empresa_codigo.toUpperCase() === codigo) return true
        }
        if (l.empresa_nome) {
          if (l.empresa_nome.toLowerCase().includes(nomeEmp.split(' ')[0])) return true
        }
        return false
      })

      if (linhasDaEmpresa.length === 0) {
        toast.error(`Nenhuma linha de ${empresa.nome} encontrada no arquivo`)
        setFase('selecionar')
        return
      }

      // Pré-análise
      const existentes = getAllAtendimentos()
      let novas = 0, duplicadas = 0, sem_passageiro = 0
      let funcionarios_resolvidos = 0, funcionarios_nao_resolvidos = 0
      let valor_total = 0

      for (const l of linhasDaEmpresa) {
        const passageiro = (l.passageiro || l.pax || '').trim()
        if (!passageiro) { sem_passageiro++; continue }

        const venda = l.venda_numero
        const dup = detectarDuplicata(existentes, {
          venda_numero: venda,
          passageiro,
          data: normalizarData(l.data_venda || ''),
          empresa_id: empresa.id,
        })
        if (dup) duplicadas++; else novas++

        const f = resolverFuncionario(funcionarios, { nome: passageiro }, empresa.id)
        if (f && f.score >= 70) funcionarios_resolvidos++
        else funcionarios_nao_resolvidos++

        valor_total += normalizarValor(l.total || l.total_tarifa || 0)
      }

      setDadosBrutos(linhasDaEmpresa)
      setAnalise({
        novas, duplicadas, sem_passageiro,
        funcionarios_resolvidos, funcionarios_nao_resolvidos,
        valor_total,
      })
      setFase('preview')
    } catch (e: any) {
      console.error(e)
      toast.error('Erro ao ler arquivo: ' + e.message)
      setFase('selecionar')
    }
  }

  async function executarImportacao() {
    if (!user || !dadosBrutos) return
    setFase('importando')

    const txId = iniciarTransacao({
      user_id: user.id,
      user_name: user.name,
      descricao: `Importação ${empresa.nome} (${dadosBrutos.length} linhas)`,
    })

    const existentes = getAllAtendimentos()
    const agentes = getAgentesBBT()

    let criadas = 0, atualizadas = 0, ignoradas = 0, erros = 0

    for (const l of dadosBrutos) {
      try {
        const passageiro = normalizarNome(l.passageiro || l.pax || '')
        if (!passageiro) { ignoradas++; continue }

        const dataVenda = normalizarData(l.data_venda) || todayISODate()
        const tipo = normalizarTipoServico(l.tipo_servico || 'Hotel')
        const total = normalizarValor(l.total || l.total_tarifa || 0)
        const custo = normalizarValor(l.custo || l.saldo_pagar || 0)
        const markup = normalizarValor(l.markup || l.previsao_lucro || 0)
        const status = normalizarStatusEmissao(l.status || l.status_origem || 'CF')

        // Agente por código emissor
        let agenteId = user.id
        const codEmissor = l.cod_emissor || l.emissor || ''
        if (codEmissor) {
          const ag = agentes.find((a) =>
            a.name.toLowerCase().split(' ')[0] === codEmissor.toLowerCase() ||
            a.name.toLowerCase().includes(codEmissor.toLowerCase())
          )
          if (ag) agenteId = ag.id
        }

        // Funcionário match
        const funcionarioMatch = resolverFuncionario(funcionarios, { nome: passageiro }, empresa.id)
        const funcionarioId = funcionarioMatch && funcionarioMatch.score >= 70 ? funcionarioMatch.id : null

        // Detalhes
        let dataCheckin: string | undefined, dataCheckout: string | undefined
        const desc = l.rota_descricao || l.descricao || l.rota_resumida || ''
        const m = desc.match(/(\d{2}\/\d{2}\/\d{2,4})\s*a\s*(\d{2}\/\d{2}\/\d{2,4})/)
        if (m) {
          dataCheckin = normalizarData(m[1])
          dataCheckout = normalizarData(m[2])
        }

        const venda = l.venda_numero
        const dup = detectarDuplicata(existentes, {
          venda_numero: venda,
          passageiro,
          data: dataVenda,
          empresa_id: empresa.id,
        })

        const payload: Partial<Atendimento> = {
          empresa_id: empresa.id,
          funcionario_id: funcionarioId,
          passageiro_nome: passageiro,
          tipo_servico: tipo,
          valor_cotacao: total,
          valor_final: total,
          valor_custo: custo,
          valor_venda: total,
          markup_valor: markup,
          agente_user_id: agenteId,
          status: status === 'finalizado' ? 'finalizado' : status === 'cancelado' ? 'cancelado' : 'em_andamento',
          prioridade: 'media',
          origem: 'Portal',
          observacoes: `Importado via pipeline. ${desc}`.slice(0, 500),
          data_atendimento: dataVenda,
          venda_numero: venda,
          emissor_codigo: codEmissor,
          origem_emissao: arquivo?.name.endsWith('.pdf') ? 'pdf_emissao' : 'planilha',
          detalhes_hotel: tipo === 'Hotel' ? {
            hotel_nome: l.produto || '',
            num_hospedes: 1,
            data_checkin: dataCheckin,
            data_checkout: dataCheckout,
          } : undefined,
          detalhes_aereo: tipo === 'Aéreo' ? {
            cia_aerea: l.produto,
          } : undefined,
        }

        if (dup) {
          const estadoAnterior = { ...dup }
          const ok = updateAtendimento(dup.id, payload)
          if (ok) {
            registrarEvento({
              user_id: user.id,
              user_name: user.name,
              acao: 'atualizar',
              entidade: 'Atendimento',
              entidade_id: dup.id,
              descricao: `Atualizado via importação: ${passageiro}`,
              tx_id: txId,
              estado_anterior: estadoAnterior,
              estado_novo: payload,
            })
            atualizadas++
          } else { erros++ }
        } else {
          const novo = addAtendimento(payload as any)
          if (novo) {
            registrarEvento({
              user_id: user.id,
              user_name: user.name,
              acao: 'importar',
              entidade: 'Atendimento',
              entidade_id: novo.id,
              descricao: `Criado via importação: ${passageiro}`,
              tx_id: txId,
            })
            // Gera lançamentos financeiros se finalizado
            if (novo.status === 'finalizado') {
              gerarLancamentosDoAtendimento(novo, empresa)
            }
            criadas++
          } else { erros++ }
        }
      } catch (e) {
        console.error('Erro processando linha:', e)
        erros++
      }
    }

    commitarTransacao(txId, { criadas, atualizadas, ignoradas, erros })

    setResultado({ criadas, atualizadas, ignoradas, erros, tx_id: txId })
    setFase('concluido')
    onCompleto?.({ criadas, atualizadas, ignoradas })
  }

  async function desfazerImportacao() {
    if (!resultado?.tx_id || !user) return
    const r = reverterTransacao(resultado.tx_id, user.id, user.name)
    toast.success(`Reverteu ${r.revertidos} de ${r.total}`)
    onCompleto?.({ criadas: -r.revertidos, atualizadas: 0, ignoradas: 0 })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Importar para: ${empresa.nome}`} size="lg">
      {fase === 'selecionar' && (
        <label className="block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition border-bbt-gray-100 dark:border-slate-700 hover:border-bbt-accent hover:bg-bbt-accent/5">
          <div className="flex justify-center gap-3 mb-3">
            <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
            <FileIcon className="w-10 h-10 text-red-500" />
          </div>
          <p className="font-semibold">Selecione PDF ou Excel</p>
          <p className="text-xs text-slate-500 mt-1">
            Filtra automaticamente apenas as vendas de <strong>{empresa.nome}</strong>
            {empresa.codigo_cliente && <> (código: <strong>{empresa.codigo_cliente}</strong>)</>}
          </p>
          <input
            type="file"
            accept=".pdf,.xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && handleArquivo(e.target.files[0])}
            className="hidden"
          />
        </label>
      )}

      {fase === 'analisando' && (
        <div className="text-center p-10">
          <Loader2 className="w-12 h-12 mx-auto text-bbt-accent animate-spin mb-3" />
          <p className="font-semibold">Analisando {arquivo?.name}...</p>
          <p className="text-xs text-slate-500 mt-1">Filtrando linhas da empresa, validando dados</p>
        </div>
      )}

      {fase === 'preview' && analise && (
        <div className="space-y-4">
          <div className="bbt-card p-4 bg-gradient-to-br from-bbt-accent/5 to-transparent border-bbt-accent/30">
            <h4 className="font-semibold flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-bbt-accent" /> Análise prévia
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Novas" valor={analise.novas} cor="text-green-600" />
              <Stat label="Atualizar (duplicadas)" valor={analise.duplicadas} cor="text-blue-600" />
              <Stat label="Sem passageiro (ignoradas)" valor={analise.sem_passageiro} cor="text-slate-500" />
              <Stat label="Valor total" valor={formatarValor(analise.valor_total)} cor="text-bbt-primary" />
              <Stat label="Funcionários reconhecidos" valor={analise.funcionarios_resolvidos} cor="text-green-600" />
              <Stat label="Não vinculados" valor={analise.funcionarios_nao_resolvidos} cor="text-amber-600" />
            </div>
          </div>

          <div className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              A importação será feita dentro de uma <strong>transação reversível</strong>.
              Se algo der errado, você pode <strong>desfazer com 1 clique</strong>.
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-bbt-gray-100 dark:border-slate-700">
            <button onClick={reset} className="bbt-button-ghost">Trocar arquivo</button>
            <button onClick={executarImportacao} className="bbt-button-primary flex items-center gap-2">
              <ChevronRight className="w-4 h-4" /> Importar {analise.novas + analise.duplicadas} linhas
            </button>
          </div>
        </div>
      )}

      {fase === 'importando' && (
        <div className="text-center p-10">
          <Loader2 className="w-12 h-12 mx-auto text-bbt-accent animate-spin mb-3" />
          <p className="font-semibold">Importando...</p>
          <p className="text-xs text-slate-500 mt-1">Validando, normalizando e persistindo. Não feche.</p>
        </div>
      )}

      {fase === 'concluido' && resultado && (
        <div className="space-y-4">
          <div className="text-center p-6">
            <CheckCircle2 className="w-14 h-14 mx-auto text-green-500 mb-3" />
            <h4 className="font-semibold text-xl">Importação concluída!</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Criadas" valor={resultado.criadas} cor="text-green-600" />
            <Stat label="Atualizadas" valor={resultado.atualizadas} cor="text-blue-600" />
            <Stat label="Ignoradas" valor={resultado.ignoradas} cor="text-slate-500" />
            <Stat label="Erros" valor={resultado.erros} cor={resultado.erros > 0 ? 'text-red-600' : 'text-slate-400'} />
          </div>
          <div className="flex gap-2 justify-end pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
            {resultado.tx_id && (
              <button
                onClick={desfazerImportacao}
                className="bbt-button-ghost text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" /> Desfazer importação
              </button>
            )}
            <button onClick={onClose} className="bbt-button-primary">Fechar</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Stat({ label, valor, cor }: { label: string; valor: any; cor: string }) {
  return (
    <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-bbt-gray-100 dark:border-slate-700">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold mt-1 ${cor}`}>{valor}</div>
    </div>
  )
}
