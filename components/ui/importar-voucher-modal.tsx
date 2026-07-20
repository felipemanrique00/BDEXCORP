'use client'
import { todayISODate } from '@/lib/date'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { addAtendimento, registrarLog } from '@/lib/atendimentos-storage'
import { addVoucher, fileToBase64 } from '@/lib/vouchers-storage'
import { addVoucherEmitido } from '@/lib/vouchers-emitidos-storage'
import { sincronizarVoucherOperacional } from '@/lib/operational-sync'
import { parseVoucher, type VoucherParsed } from '@/lib/voucher-parser'
import { buscarFuncionariosPorNomeInteligente } from '@/lib/funcionario-identidade'
import {
  FileText, Upload, Sparkles, User as UserIcon, Hotel as HotelIcon, MapPin,
  Calendar, Tag, Loader2, CheckCircle2, AlertCircle, Info, DollarSign,
  Building2, BedDouble,
} from 'lucide-react'
import type { Atendimento, DetalhesHotel, Funcionario, Prioridade, VoucherEmitido } from '@/types'
import { CONFIG_COBRANCA_PADRAO, calcularFinanceiro } from '@/types'
import { formatCurrency } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: (a: Atendimento) => void
}

type FuncMatch = {
  id: string
  nome: string
  empresa_id: string
  codigo_identificacao?: string
  cpf?: string
  score: number
}

function diffDays(d1: string, d2: string): number {
  if (!d1 || !d2) return 0
  const a = new Date(d1 + 'T00:00:00')
  const b = new Date(d2 + 'T00:00:00')
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

export function ImportarVoucherModal({ open, onClose, onSaved }: Props) {
  const { empresas, funcionarios, hoteis } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const podeVerFinanceiro = hasPermission(user, 'ver_financeiro')

  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<VoucherParsed | null>(null)
  const [loading, setLoading] = useState(false)

  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState<string | null>(null)
  const [sugestoesFunc, setSugestoesFunc] = useState<FuncMatch[]>([])
  const [hotelId, setHotelId] = useState<number | ''>('')

  const [valorCusto, setValorCusto] = useState(0)
  const [valorVenda, setValorVenda] = useState(0)
  const [prioridade, setPrioridade] = useState<Prioridade>('media')
  const [observacoesExtra, setObservacoesExtra] = useState('')

  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) {
      setFile(null); setParsed(null); setLoading(false)
      setEmpresaId(''); setFuncionarioId(null); setSugestoesFunc([])
      setHotelId(''); setValorCusto(0); setValorVenda(0)
      setPrioridade('media'); setObservacoesExtra('')
    }
  }, [open])

  async function handleFile(f: File) {
    setFile(f)
    setLoading(true)
    try {
      const r = await parseVoucher(f)
      setParsed(r)

      // Empresa por nome
      let empresaDetectadaId = empresaId || ''
      if (r.empresa_nome) {
        const en = r.empresa_nome.toLowerCase()
        const emp = empresas.find((e) =>
          e.nome.toLowerCase().includes(en) || en.includes(e.nome.toLowerCase().split(' ')[0])
        )
        if (emp) {
          empresaDetectadaId = emp.id
          setEmpresaId(emp.id)
        }
      }

      // Match funcionário
      if (r.passageiro) {
        const matches = encontrarFuncionariosVinculaveis(r.passageiro, funcionarios, empresaDetectadaId || undefined)
        setSugestoesFunc(matches)
        const [melhor, segundo] = matches
        if (melhor && melhor.score >= 84 && (!segundo || melhor.score - segundo.score >= 8)) {
          setFuncionarioId(melhor.id)
          if (!empresaId) setEmpresaId(melhor.empresa_id)
        }
      }

      // Match hotel
      if (r.hotel) {
        const hn = r.hotel.toLowerCase().replace(/^hotel\s+/i, '').replace(/^hosp\s+/i, '')
        const h = hoteis.find((x) => {
          const xn = x.nome.toLowerCase().replace(/^hotel\s+/i, '')
          return xn.includes(hn) || hn.includes(xn.split(' ')[0])
        })
        if (h) setHotelId(h.id)
      }

      toast.success('Voucher analisado!')
    } catch (e: any) {
      console.error(e)
      toast.error('Erro ao ler voucher: ' + (e?.message || ''))
    } finally {
      setLoading(false)
    }
  }

  // Cálculo automático de valor do hotel
  useEffect(() => {
    if (!hotelId || !parsed) return
    const h = hoteis.find((x) => x.id === hotelId)
    if (!h) return

    let tarifa = 0
    if (parsed.tipo_apto === 'DBL' && h.tarifa_dbl) tarifa = h.tarifa_dbl
    else if (parsed.tipo_apto === 'TPL' && h.tarifa_tpl) tarifa = h.tarifa_tpl
    else if (h.tarifa_sgl) tarifa = h.tarifa_sgl
    else if (h.tarifa_dbl) tarifa = h.tarifa_dbl
    else if (h.tarifa_tpl) tarifa = h.tarifa_tpl

    const noites = parsed.noites || diffDays(parsed.data_checkin || '', parsed.data_checkout || '') || 1
    if (tarifa > 0) {
      const custo = tarifa * noites
      setValorCusto(custo)

      const empresa = empresas.find((e) => e.id === empresaId)
      const cfg = empresa?.config_cobranca || CONFIG_COBRANCA_PADRAO
      if (cfg.aplicar_markup && cfg.markup_padrao_pct > 0) {
        setValorVenda(custo * (1 + cfg.markup_padrao_pct / 100))
      } else {
        setValorVenda(custo)
      }
    }
  }, [hotelId, parsed, empresaId, empresas, hoteis])

  async function salvarComoDemanda() {
    if (!user) { toast.error('Faça login.'); return }
    if (!parsed || !empresaId || !parsed.passageiro) {
      toast.error('Faltam dados obrigatórios (empresa e passageiro).')
      return
    }

    setSalvando(true)
    try {
      const empresa = empresas.find((e) => e.id === empresaId)
      const cfg = empresa?.config_cobranca || CONFIG_COBRANCA_PADRAO
      const hotel = hotelId ? hoteis.find((x) => x.id === hotelId) : null

      const det: DetalhesHotel = {
        hotel_id: hotel?.id,
        hotel_nome: hotel?.nome || parsed.hotel,
        cidade: hotel?.cidade || parsed.cidade,
        data_checkin: parsed.data_checkin,
        data_checkout: parsed.data_checkout,
        num_hospedes: parsed.num_hospedes || 1,
        tipo_apto: parsed.tipo_apto,
        noites: parsed.noites || diffDays(parsed.data_checkin || '', parsed.data_checkout || '') || 1,
        localizador: parsed.voucher_numero,
      }

      const payload: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> = {
        empresa_id: empresaId,
        funcionario_id: funcionarioId,
        passageiro_nome: parsed.passageiro,
        tipo_servico: 'Hotel',
        valor_cotacao: valorVenda || 0,
        valor_final: valorVenda || undefined,
        valor_custo: valorCusto || 0,
        valor_venda: valorVenda || 0,
        taxa_ativa: cfg.aplicar_taxa,
        taxa_percentual: cfg.aplicar_taxa && !cfg.taxa_fixa_ativa ? cfg.taxa_padrao_pct : undefined,
        taxa_valor_fixo: cfg.aplicar_taxa && cfg.taxa_fixa_ativa ? cfg.taxa_valor_fixo : undefined,
        markup_desabilitado: !cfg.aplicar_markup,
        agente_user_id: user.id,
        status: 'finalizado',
        prioridade,
        origem: 'E-mail',
        observacoes: [
          `Voucher ${parsed.voucher_numero || ''} importado`,
          parsed.tipo_pagamento ? `Pagamento: ${parsed.tipo_pagamento}` : '',
          parsed.regime_alimentacao ? `Alimentação: ${parsed.regime_alimentacao}` : '',
          observacoesExtra,
        ].filter(Boolean).join(' | '),
        data_atendimento: parsed.data_emissao || todayISODate(),
        detalhes_hotel: det,
        origem_emissao: 'voucher_pdf',
        finalizado_em: parsed.data_emissao || todayISODate(),
      }

      const nova = addAtendimento(payload)
      if (!nova) throw new Error('Falha ao criar demanda')

      const voucherEstruturado: Omit<VoucherEmitido, 'id' | 'numero' | 'created_at' | 'updated_at'> = {
        tipo: 'Hotel',
        status: 'emitido',
        atendimento_id: nova.id,
        empresa_id: empresaId,
        funcionario_id: funcionarioId,
        passageiro_nome: parsed.passageiro,
        fornecedor_nome: hotel?.nome || parsed.hotel || 'Hotel nao informado',
        fornecedor_endereco: parsed.endereco || undefined,
        fornecedor_cidade: hotel?.cidade || parsed.cidade || undefined,
        fornecedor_telefone: parsed.telefone_hotel || hotel?.telefone || undefined,
        hotel_categoria: parsed.categoria || undefined,
        tipo_apartamento: parsed.tipo_apto_texto || parsed.tipo_apto || undefined,
        num_hospedes: parsed.num_hospedes || 1,
        data_checkin: parsed.data_checkin || undefined,
        data_checkout: parsed.data_checkout || undefined,
        noites: det.noites,
        regime: parsed.regime_alimentacao || undefined,
        forma_pagamento_voucher: parsed.tipo_pagamento || undefined,
        valor_diaria: det.noites && valorCusto ? valorCusto / det.noites : undefined,
        numero_confirmacao: parsed.voucher_numero || undefined,
        data_confirmacao: parsed.data_emissao || undefined,
        confirmado_por: user.name,
        tarifa_total: valorCusto || valorVenda || 0,
        total: valorVenda || valorCusto || 0,
        observacoes: payload.observacoes,
        observacoes_internas: [
          `demanda_origem=${nova.id}`,
          file ? `arquivo=${file.name}` : '',
        ].filter(Boolean).join(' | '),
        origem_voucher: 'pdf',
        arquivo_original_nome: file?.name,
        importado_em: new Date().toISOString(),
        emitido_por_user_id: user.id,
        emitido_por_user_name: user.name,
      }

      const voucher = addVoucherEmitido(voucherEstruturado)
      if (voucher) sincronizarVoucherOperacional(voucher, { agente_user_id: user.id, origem: 'E-mail' })

      // Salvar o arquivo PDF no IndexedDB
      if (file && funcionarioId) {
        try {
          const base64 = await fileToBase64(file)
          addVoucher({
            funcionario_id: funcionarioId,
            nome_arquivo: file.name,
            tamanho_bytes: file.size,
            mime_type: file.type || 'application/pdf',
            descricao: `Voucher ${parsed.voucher_numero || 'sem nº'} · ${parsed.passageiro}`,
            base64_data: base64,
          })
        } catch (e) {
          console.warn('Não conseguiu salvar PDF no IndexedDB:', e)
        }
      }

      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'importar',
        entidade: 'Atendimento', entidade_id: nova.id,
        descricao: `Importou voucher ${parsed.voucher_numero || ''} de ${parsed.passageiro}`,
      })

      toast.success('Demanda, voucher e financeiro sincronizados!')
      onSaved?.(nova)
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const calc = calcularFinanceiro({
    valor_cotacao: valorVenda,
    valor_custo: valorCusto,
    valor_venda: valorVenda,
    taxa_ativa: empresas.find((e) => e.id === empresaId)?.config_cobranca?.aplicar_taxa,
    taxa_percentual: empresas.find((e) => e.id === empresaId)?.config_cobranca?.taxa_padrao_pct,
    markup_desabilitado: !empresas.find((e) => e.id === empresaId)?.config_cobranca?.aplicar_markup,
  })

  return (
    <Modal open={open} onClose={onClose} title="Importar Voucher (PDF)" size="xl">
      {!parsed ? (
        <label className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
          loading
            ? 'border-bbt-accent bg-bbt-accent/5'
            : 'border-bbt-gray-100 dark:border-slate-700 hover:border-bbt-accent hover:bg-bbt-accent/5'
        }`}>
          {loading ? (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-bbt-accent animate-spin mb-3" />
              <p className="font-semibold">Analisando voucher...</p>
              <p className="text-xs text-slate-500 mt-1">Extraindo dados do PDF</p>
            </>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto text-bbt-accent mb-3" />
              <p className="font-semibold text-bbt-primary dark:text-white">Clique ou arraste o voucher em PDF</p>
              <p className="text-xs text-slate-500 mt-1">
                Sistema extrai automaticamente: hóspede, hotel, cidade, check-in/out, etc
              </p>
            </>
          )}
          <input
            type="file"
            accept=".pdf"
            disabled={loading}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
        </label>
      ) : (
        <div className="space-y-4">
          {/* Dados extraídos */}
          <div className="bbt-card p-4 bg-gradient-to-br from-bbt-accent/5 to-transparent border-bbt-accent/30">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-bbt-accent" /> Dados extraídos automaticamente
              {parsed.voucher_numero && <span className="ml-auto text-xs bbt-badge bg-bbt-accent/20 text-bbt-primary">Voucher {parsed.voucher_numero}</span>}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {parsed.passageiro && <DadoItem icon={UserIcon} label="Hóspede" value={parsed.passageiro} src={parsed.fontes.passageiro} />}
              {parsed.hotel && <DadoItem icon={HotelIcon} label="Hotel" value={parsed.hotel} src={parsed.fontes.hotel} />}
              {parsed.cidade && <DadoItem icon={MapPin} label="Cidade" value={parsed.cidade} src={parsed.fontes.cidade} />}
              {parsed.endereco && <DadoItem icon={MapPin} label="Endereço" value={parsed.endereco} src={parsed.fontes.endereco} />}
              {parsed.data_checkin && <DadoItem icon={Calendar} label="Check-in" value={formatarData(parsed.data_checkin)} src={parsed.fontes.data_checkin} />}
              {parsed.data_checkout && <DadoItem icon={Calendar} label="Check-out" value={formatarData(parsed.data_checkout)} src={parsed.fontes.data_checkout} />}
              {parsed.noites && <DadoItem icon={Calendar} label="Noites" value={String(parsed.noites)} src={parsed.fontes.noites} />}
              {parsed.num_hospedes && <DadoItem icon={UserIcon} label="Hóspedes" value={String(parsed.num_hospedes)} src={parsed.fontes.num_hospedes} />}
              {parsed.categoria && <DadoItem icon={BedDouble} label="Categoria" value={parsed.categoria} src={parsed.fontes.categoria} />}
              {parsed.tipo_apto_texto && <DadoItem icon={BedDouble} label="Tipo Apto" value={parsed.tipo_apto_texto} src={parsed.fontes.tipo_apto_texto} />}
              {parsed.tipo_pagamento && <DadoItem icon={DollarSign} label="Pagamento" value={parsed.tipo_pagamento} src={parsed.fontes.tipo_pagamento} />}
              {parsed.regime_alimentacao && <DadoItem icon={Tag} label="Alimentação" value={parsed.regime_alimentacao} src={parsed.fontes.regime_alimentacao} />}
              {parsed.telefone_hotel && <DadoItem icon={Tag} label="Telefone" value={parsed.telefone_hotel} src={parsed.fontes.telefone_hotel} />}
              {parsed.empresa_nome && <DadoItem icon={Building2} label="Empresa (arquivo)" value={parsed.empresa_nome} src="arquivo" />}
            </div>
          </div>

          {/* Ajustes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Campo label="Empresa *">
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="bbt-input">
                <option value="">Selecione...</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Hotel (catálogo)">
              <select value={hotelId} onChange={(e) => setHotelId(e.target.value ? Number(e.target.value) : '')} className="bbt-input">
                <option value="">— usar apenas o nome extraído —</option>
                {hoteis.slice(0, 200).map((h) => <option key={h.id} value={h.id}>{h.nome} · {h.cidade}/{h.uf}</option>)}
              </select>
            </Campo>
          </div>

          {sugestoesFunc.length > 0 && (
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
                Vincular hóspede a funcionário cadastrado
              </label>
              <div className="space-y-1">
                {sugestoesFunc.slice(0, 3).map((m) => (
                  <button key={m.id} type="button"
                    onClick={() => { setFuncionarioId(m.id); if (!empresaId) setEmpresaId(m.empresa_id) }}
                    className={`w-full text-left text-xs px-3 py-2 rounded border transition ${
                      funcionarioId === m.id ? 'bg-bbt-accent/20 border-bbt-accent' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-bbt-accent/5'
                    }`}>
                    <span className="font-medium">{m.nome}</span>
                    <span className="ml-2 text-[10px] text-slate-500">({m.score}% match)</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {podeVerFinanceiro && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Campo label="Custo (R$)">
                <input type="number" step="0.01" value={valorCusto || ''} onChange={(e) => setValorCusto(parseFloat(e.target.value) || 0)} className="bbt-input" />
              </Campo>
              <Campo label="Venda (R$)">
                <input type="number" step="0.01" value={valorVenda || ''} onChange={(e) => setValorVenda(parseFloat(e.target.value) || 0)} className="bbt-input" />
              </Campo>
            </div>
          )}

          <Campo label="Observações extras">
            <textarea value={observacoesExtra} onChange={(e) => setObservacoesExtra(e.target.value)} rows={2} className="bbt-input" />
          </Campo>

          {podeVerFinanceiro && (
            <div className="flex gap-2 text-xs">
              <div className="flex-1 p-2 bg-green-100 dark:bg-green-900/30 rounded text-green-700 dark:text-green-300">
                <div className="font-semibold">Markup</div>
                <div className="text-base font-bold">{formatCurrency(calc.markup)}</div>
              </div>
              <div className="flex-1 p-2 bg-bbt-primary text-white rounded">
                <div className="font-semibold opacity-80">Faturado</div>
                <div className="text-base font-bold">{formatCurrency(calc.total_faturado)}</div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
            <button onClick={() => { setFile(null); setParsed(null) }} className="bbt-button-ghost">Outro PDF</button>
            <button onClick={salvarComoDemanda} disabled={salvando || !empresaId || !parsed.passageiro}
              className="bbt-button-primary flex items-center gap-2">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Salvar como demanda
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function DadoItem({ icon: Icon, label, value, src }: { icon: any; label: string; value: string; src?: string }) {
  const srcColor = src === 'pdf' || src === 'ambos' ? 'bg-green-100 text-green-700 dark:bg-green-900/30'
    : src === 'arquivo' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' : 'bg-slate-100 text-slate-500'
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-white/50 dark:bg-slate-800/50">
      <Icon className="w-3.5 h-3.5 text-bbt-accent shrink-0" />
      <span className="text-slate-500">{label}:</span>
      <strong className="text-bbt-primary dark:text-white truncate flex-1">{value}</strong>
      {src && <span className={`text-[8px] px-1 rounded ${srcColor}`}>{src === 'ambos' ? '✓✓' : src === 'pdf' ? 'pdf' : 'arq'}</span>}
    </div>
  )
}

function encontrarFuncionariosVinculaveis(nome: string, funcionarios: Funcionario[], empresaId?: string): FuncMatch[] {
  return buscarFuncionariosPorNomeInteligente(funcionarios, nome, empresaId, 10)
    .map((match) => ({
      id: match.funcionario.id,
      nome: match.funcionario.nome,
      empresa_id: match.funcionario.company_id,
      codigo_identificacao: match.funcionario.codigo_identificacao,
      cpf: match.funcionario.cpf,
      score: match.score,
    }))
}

function formatarData(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
