'use client'
import { todayISODate } from '@/lib/date'
/**
 * V10: Novo Voucher — formulário completo
 * Pode ser pré-preenchido a partir de uma demanda (?atendimento=ID)
 */
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/lib/store'
import { getCurrentUser, getEmpresasPermitidas, hasPermission } from '@/lib/auth'
import { getAtendimentoById, getAtendimentoBySerialOS } from '@/lib/atendimentos-storage'
import { sincronizarVoucherOperacionalGovernado } from '@/lib/operational-sync'
import { createVoucherOnServer } from '@/lib/voucher-persistence-client'
import type { VoucherEmitido, VoucherTipo, Atendimento } from '@/types'
import {
  FileText, ArrowLeft, Save, Hotel as HotelIcon, Plane, Car, Package,
  User as UserIcon, Building2, Calendar, MapPin, DollarSign, Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-input'

function NovoVoucherInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { empresas, gruposEmpresariais, funcionarios, hoteis } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const canManageVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_reservas')
  const empresasPermitidas = getEmpresasPermitidas(user, empresas, gruposEmpresariais)

  const atendimentoId = params.get('atendimento')
  const serialOS = params.get('os')

  const [tipo, setTipo] = useState<VoucherTipo>('Hotel')
  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState<string | null>(null)
  const [passageiroNome, setPassageiroNome] = useState('')
  const [passageiros, setPassageiros] = useState<string[]>([])
  const [cpf, setCpf] = useState('')

  const [fornecedorNome, setFornecedorNome] = useState('')
  const [fornecedorEndereco, setFornecedorEndereco] = useState('')
  const [fornecedorCidade, setFornecedorCidade] = useState('')
  const [fornecedorTelefone, setFornecedorTelefone] = useState('')

  // Hotel
  const [hotelCategoria, setHotelCategoria] = useState('STANDARD')
  const [tipoApto, setTipoApto] = useState('INDIVIDUAL')
  const [numApts, setNumApts] = useState(1)
  const [numHospedes, setNumHospedes] = useState(1)
  const [checkin, setCheckin] = useState('')
  const [checkout, setCheckout] = useState('')
  const [regime, setRegime] = useState('CAFÉ DA MANHÃ')
  const [formaPagVoucher, setFormaPagVoucher] = useState('FATURAR SOMENTE DIÁRIAS E TAXAS')
  const [valorDiaria, setValorDiaria] = useState(0)

  // Aéreo
  const [ciaAerea, setCiaAerea] = useState('')
  const [numeroVoo, setNumeroVoo] = useState('')
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [dataIda, setDataIda] = useState('')
  const [dataVolta, setDataVolta] = useState('')
  const [classeVoo, setClasseVoo] = useState('Econômica')
  const [localizador, setLocalizador] = useState('')

  // Carro
  const [locadora, setLocadora] = useState('')
  const [categoriaCarro, setCategoriaCarro] = useState('')
  const [retiradaLocal, setRetiradaLocal] = useState('')
  const [retiradaData, setRetiradaData] = useState('')
  const [devolucaoLocal, setDevolucaoLocal] = useState('')
  const [devolucaoData, setDevolucaoData] = useState('')

  // Confirmação
  const [numConfirmacao, setNumConfirmacao] = useState('000000')
  const [dataConfirmacao, setDataConfirmacao] = useState(todayISODate())
  const [confirmadoPor, setConfirmadoPor] = useState(user?.name || '')

  // Financeiro
  const [tarifaTotal, setTarifaTotal] = useState(0)
  const [taxas, setTaxas] = useState(0)
  const [centroCusto, setCentroCusto] = useState('')
  const [numeroSolicitacao, setNumeroSolicitacao] = useState('')

  const [observacoes, setObservacoes] = useState('')
  const [obsInternas, setObsInternas] = useState('')

  const [salvando, setSalvando] = useState(false)

  // Pré-preencher se vier de uma demanda
  useEffect(() => {
    if (!atendimentoId && !serialOS) return
    const a = atendimentoId ? getAtendimentoById(atendimentoId) : getAtendimentoBySerialOS(serialOS || '')
    if (!a) {
      toast.error('Demanda não encontrada')
      return
    }
    setTipo(a.tipo_servico as VoucherTipo)
    setEmpresaId(a.empresa_id)
    setFuncionarioId(a.funcionario_id || null)
    setPassageiroNome(a.passageiro_nome)
    setCentroCusto(a.centro_custo || '')
    setNumeroSolicitacao(a.numero_solicitacao || a.serial_os || '')
    setObservacoes(a.observacoes || '')
    if (a.detalhes_hotel) {
      const h = a.detalhes_hotel
      const hotelObj = hoteis.find((x) => x.id === h.hotel_id)
      setFornecedorNome(h.hotel_nome || hotelObj?.nome || '')
      if (hotelObj) {
        setFornecedorCidade(hotelObj.cidade || '')
        setFornecedorTelefone(hotelObj.telefone || '')
      }
      setCheckin(h.data_checkin || '')
      setCheckout(h.data_checkout || '')
      setNumHospedes(h.num_hospedes || 1)
      if (h.tipo_apto === 'SGL') setTipoApto('INDIVIDUAL')
      else if (h.tipo_apto === 'DBL') setTipoApto('DUPLO')
      else if (h.tipo_apto === 'TPL') setTipoApto('TRIPLO')
      if (h.tarifa_unitaria) setValorDiaria(h.tarifa_unitaria)
    }
    if (a.detalhes_aereo) {
      const ae = a.detalhes_aereo
      setOrigem(ae.origem || '')
      setDestino(ae.destino || '')
      setDataIda(ae.data_ida || '')
      setDataVolta(ae.data_volta || '')
      setLocalizador(ae.localizador || '')
    }
    if (a.valor_venda || a.valor_final || a.valor_cotacao) {
      setTarifaTotal(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
    }
  }, [atendimentoId, serialOS, hoteis])

  const noites = (() => {
    if (!checkin || !checkout) return 0
    const d1 = new Date(checkin)
    const d2 = new Date(checkout)
    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
    return diff > 0 ? diff : 0
  })()

  const totalCalculado = (() => {
    if (tipo === 'Hotel' && valorDiaria > 0 && noites > 0) {
      return valorDiaria * noites + (taxas || 0)
    }
    return tarifaTotal + taxas
  })()

  async function salvar() {
    if (!user || user?.role !== 'master' || !canManageVoucher) {
      toast.error('Você não tem permissão para criar vouchers.')
      return
    }
    if (!empresaId) { toast.error('Selecione a empresa.'); return }
    if (!empresasPermitidas.some((empresa) => empresa.id === empresaId)) {
      toast.error('Você não tem permissão para emitir vouchers para esta empresa.')
      return
    }
    if (!passageiroNome.trim()) { toast.error('Informe o nome do passageiro.'); return }
    if (!fornecedorNome.trim()) { toast.error('Informe o fornecedor.'); return }

    setSalvando(true)
    const dados: Omit<VoucherEmitido, 'id' | 'numero' | 'created_at' | 'updated_at'> = {
      tipo,
      status: 'emitido',
      atendimento_id: atendimentoId || undefined,
      empresa_id: empresaId,
      funcionario_id: funcionarioId,
      passageiro_nome: passageiroNome.trim(),
      passageiros: passageiros.length > 0 ? passageiros : undefined,
      cpf: cpf || undefined,
      fornecedor_nome: fornecedorNome.trim(),
      fornecedor_endereco: fornecedorEndereco || undefined,
      fornecedor_cidade: fornecedorCidade || undefined,
      fornecedor_telefone: fornecedorTelefone || undefined,
      hotel_categoria: tipo === 'Hotel' ? hotelCategoria : undefined,
      tipo_apartamento: tipo === 'Hotel' ? tipoApto : undefined,
      num_apartamentos: tipo === 'Hotel' ? numApts : undefined,
      num_hospedes: tipo === 'Hotel' ? numHospedes : undefined,
      data_checkin: tipo === 'Hotel' ? checkin || undefined : undefined,
      data_checkout: tipo === 'Hotel' ? checkout || undefined : undefined,
      noites: tipo === 'Hotel' ? noites : undefined,
      regime: tipo === 'Hotel' ? regime : undefined,
      forma_pagamento_voucher: tipo === 'Hotel' ? formaPagVoucher : undefined,
      valor_diaria: tipo === 'Hotel' ? valorDiaria : undefined,
      cia_aerea: tipo === 'Aéreo' ? ciaAerea : undefined,
      numero_voo: tipo === 'Aéreo' ? numeroVoo : undefined,
      origem: tipo === 'Aéreo' ? origem : undefined,
      destino: tipo === 'Aéreo' ? destino : undefined,
      data_ida: tipo === 'Aéreo' ? dataIda || undefined : undefined,
      data_volta: tipo === 'Aéreo' ? dataVolta || undefined : undefined,
      classe: tipo === 'Aéreo' ? classeVoo : undefined,
      localizador: tipo === 'Aéreo' ? localizador : undefined,
      locadora: tipo === 'Carro' ? locadora : undefined,
      categoria_carro: tipo === 'Carro' ? categoriaCarro : undefined,
      retirada_local: tipo === 'Carro' ? retiradaLocal : undefined,
      retirada_data: tipo === 'Carro' ? retiradaData || undefined : undefined,
      devolucao_local: tipo === 'Carro' ? devolucaoLocal : undefined,
      devolucao_data: tipo === 'Carro' ? devolucaoData || undefined : undefined,
      numero_confirmacao: numConfirmacao || undefined,
      data_confirmacao: dataConfirmacao || undefined,
      confirmado_por: confirmadoPor || undefined,
      tarifa_total: tarifaTotal,
      taxas: taxas || undefined,
      total: totalCalculado,
      centro_custo: centroCusto || undefined,
      numero_solicitacao: numeroSolicitacao || undefined,
      observacoes: observacoes || undefined,
      observacoes_internas: obsInternas || undefined,
      emitido_por_user_id: user.id,
      emitido_por_user_name: user.name,
    }

    try {
      const v = await createVoucherOnServer(dados)
      await sincronizarVoucherOperacionalGovernado(v, { agente_user_id: user.id, origem: 'Portal' })
      toast.success(`Voucher ${v.id} criado e sincronizado com demandas/financeiro!`)
      router.push(`/dashboard/vouchers/${v.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar o voucher.')
    } finally {
      setSalvando(false)
    }
  }

  if (!canManageVoucher) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para criar vouchers.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/vouchers" className="text-xs text-slate-500 hover:text-bbt-accent flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> Voltar para Vouchers
          </Link>
          <h1 className="text-3xl font-bold text-bbt-primary dark:text-white flex items-center gap-3">
            <FileText className="w-8 h-8 text-bbt-accent" /> Novo Voucher
          </h1>
          {atendimentoId && (
            <p className="text-xs text-green-600 mt-1">✓ Pré-preenchido a partir da demanda {atendimentoId}</p>
          )}
        </div>
        <button onClick={salvar} disabled={salvando} className="bbt-button-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {salvando ? 'Salvando...' : 'Salvar Voucher'}
        </button>
      </div>

      {/* Tipo */}
      <div className="bbt-card p-4">
        <label className="block text-xs font-semibold uppercase text-slate-600 mb-2 tracking-wider">Tipo de Voucher</label>
        <div className="grid grid-cols-4 gap-2">
          {([
            { v: 'Hotel', Icon: HotelIcon },
            { v: 'Aéreo', Icon: Plane },
            { v: 'Carro', Icon: Car },
            { v: 'Pacote', Icon: Package },
          ] as const).map(({ v, Icon }) => (
            <button key={v} type="button" onClick={() => setTipo(v as VoucherTipo)}
              className={`p-3 rounded-lg border-2 text-center transition ${
                tipo === v ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-bbt-accent/50'
              }`}>
              <Icon className="w-5 h-5 mx-auto mb-1" />
              <div className="text-xs font-semibold">{v}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Cliente / Passageiro */}
      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-bbt-accent" /> Cliente</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Empresa *">
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="bbt-input">
              <option value="">Selecione...</option>
              {empresasPermitidas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Field>
          <Field label="Funcionário (opcional)">
            <select value={funcionarioId || ''} onChange={(e) => {
              const id = e.target.value || null
              setFuncionarioId(id)
              if (id) {
                const f = funcionarios.find((x) => x.id === id)
                if (f) {
                  setPassageiroNome(f.nome)
                  setCpf(f.cpf || '')
                }
              }
            }} className="bbt-input">
              <option value="">—</option>
              {funcionarios.filter((f) => !empresaId || f.company_id === empresaId).map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </Field>
          <Field label="Passageiro *">
            <input value={passageiroNome} onChange={(e) => setPassageiroNome(e.target.value)} className="bbt-input" />
          </Field>
          <Field label="CPF">
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} className="bbt-input" placeholder="000.000.000-00" />
          </Field>
        </div>
      </div>

      {/* Fornecedor */}
      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-bbt-accent" /> Fornecedor</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome do Fornecedor *">
            <input value={fornecedorNome} onChange={(e) => setFornecedorNome(e.target.value)} className="bbt-input" placeholder="Ex: STRASSEN HOTEL" />
          </Field>
          <Field label="Telefone">
            <input value={fornecedorTelefone} onChange={(e) => setFornecedorTelefone(e.target.value)} className="bbt-input" placeholder="(62) 0000-0000" />
          </Field>
          <Field label="Endereço">
            <input value={fornecedorEndereco} onChange={(e) => setFornecedorEndereco(e.target.value)} className="bbt-input" />
          </Field>
          <Field label="Cidade">
            <input value={fornecedorCidade} onChange={(e) => setFornecedorCidade(e.target.value)} className="bbt-input" />
          </Field>
        </div>
      </div>

      {/* Detalhes específicos por tipo */}
      {tipo === 'Hotel' && (
        <div className="bbt-card p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2"><HotelIcon className="w-4 h-4 text-bbt-accent" /> Hospedagem</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Categoria"><input value={hotelCategoria} onChange={(e) => setHotelCategoria(e.target.value)} className="bbt-input" /></Field>
            <Field label="Tipo de Apto">
              <select value={tipoApto} onChange={(e) => setTipoApto(e.target.value)} className="bbt-input">
                <option>INDIVIDUAL</option><option>DUPLO</option><option>TRIPLO</option><option>QUADRUPLO</option>
              </select>
            </Field>
            <Field label="Nr. Apts"><input type="number" min={1} value={numApts} onChange={(e) => setNumApts(Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Hóspedes"><input type="number" min={1} value={numHospedes} onChange={(e) => setNumHospedes(Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Check-in" htmlFor="voucher-new-checkin"><DateInput id="voucher-new-checkin" value={checkin} onChange={(e) => setCheckin(e.target.value)} className="bbt-input" /></Field>
            <Field label="Check-out" htmlFor="voucher-new-checkout"><DateInput id="voucher-new-checkout" value={checkout} onChange={(e) => setCheckout(e.target.value)} className="bbt-input" /></Field>
            <Field label="Noites"><input value={noites} readOnly className="bbt-input bg-slate-50 dark:bg-slate-800" /></Field>
            <Field label="Valor Diária (R$)"><input type="number" step="0.01" value={valorDiaria} onChange={(e) => setValorDiaria(Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Regime de Alimentação">
              <select value={regime} onChange={(e) => setRegime(e.target.value)} className="bbt-input">
                <option>CAFÉ DA MANHÃ</option>
                <option>SEM REFEIÇÃO</option>
                <option>MEIA PENSÃO</option>
                <option>PENSÃO COMPLETA</option>
                <option>ALL INCLUSIVE</option>
              </select>
            </Field>
            <Field label="Forma de Pagamento (no voucher)">
              <select value={formaPagVoucher} onChange={(e) => setFormaPagVoucher(e.target.value)} className="bbt-input">
                <option>FATURAR SOMENTE DIÁRIAS E TAXAS</option>
                <option>FATURAR TUDO</option>
                <option>PAGO ANTECIPADO</option>
                <option>NO LOCAL</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      {tipo === 'Aéreo' && (
        <div className="bbt-card p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2"><Plane className="w-4 h-4 text-bbt-accent" /> Voo</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Cia Aérea"><input value={ciaAerea} onChange={(e) => setCiaAerea(e.target.value)} className="bbt-input" placeholder="LATAM, GOL, AZUL..." /></Field>
            <Field label="Nº Voo"><input value={numeroVoo} onChange={(e) => setNumeroVoo(e.target.value)} className="bbt-input" /></Field>
            <Field label="Localizador (PNR)"><input value={localizador} onChange={(e) => setLocalizador(e.target.value)} className="bbt-input" /></Field>
            <Field label="Classe">
              <select value={classeVoo} onChange={(e) => setClasseVoo(e.target.value)} className="bbt-input">
                <option>Econômica</option><option>Premium Economy</option><option>Executiva</option><option>Primeira</option>
              </select>
            </Field>
            <Field label="Origem"><input value={origem} onChange={(e) => setOrigem(e.target.value)} className="bbt-input" /></Field>
            <Field label="Destino"><input value={destino} onChange={(e) => setDestino(e.target.value)} className="bbt-input" /></Field>
            <Field label="Data Ida" htmlFor="voucher-new-data-ida"><DateInput id="voucher-new-data-ida" value={dataIda} onChange={(e) => setDataIda(e.target.value)} className="bbt-input" /></Field>
            <Field label="Data Volta" htmlFor="voucher-new-data-volta"><DateInput id="voucher-new-data-volta" value={dataVolta} onChange={(e) => setDataVolta(e.target.value)} className="bbt-input" /></Field>
          </div>
        </div>
      )}

      {tipo === 'Carro' && (
        <div className="bbt-card p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2"><Car className="w-4 h-4 text-bbt-accent" /> Locação</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Locadora"><input value={locadora} onChange={(e) => setLocadora(e.target.value)} className="bbt-input" placeholder="Localiza, Movida..." /></Field>
            <Field label="Categoria"><input value={categoriaCarro} onChange={(e) => setCategoriaCarro(e.target.value)} className="bbt-input" placeholder="Compacto, SUV..." /></Field>
            <Field label=""><div /></Field>
            <Field label="Local Retirada"><input value={retiradaLocal} onChange={(e) => setRetiradaLocal(e.target.value)} className="bbt-input" /></Field>
            <Field label="Data Retirada" htmlFor="voucher-new-data-retirada"><DateInput id="voucher-new-data-retirada" value={retiradaData} onChange={(e) => setRetiradaData(e.target.value)} className="bbt-input" /></Field>
            <Field label=""><div /></Field>
            <Field label="Local Devolução"><input value={devolucaoLocal} onChange={(e) => setDevolucaoLocal(e.target.value)} className="bbt-input" /></Field>
            <Field label="Data Devolução" htmlFor="voucher-new-data-devolucao"><DateInput id="voucher-new-data-devolucao" value={devolucaoData} onChange={(e) => setDevolucaoData(e.target.value)} className="bbt-input" /></Field>
          </div>
        </div>
      )}

      {/* Confirmação */}
      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-bbt-accent" /> Confirmação</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Nº Confirmação"><input value={numConfirmacao} onChange={(e) => setNumConfirmacao(e.target.value)} className="bbt-input" /></Field>
          <Field label="Data Confirmação" htmlFor="voucher-new-data-confirmacao"><DateInput id="voucher-new-data-confirmacao" value={dataConfirmacao} onChange={(e) => setDataConfirmacao(e.target.value)} className="bbt-input" /></Field>
          <Field label="Confirmado Por"><input value={confirmadoPor} onChange={(e) => setConfirmadoPor(e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      {/* Financeiro */}
      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-bbt-accent" /> Financeiro</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Tarifa Total (R$)">
            <input type="number" step="0.01" value={tarifaTotal} onChange={(e) => setTarifaTotal(Number(e.target.value))} className="bbt-input" />
          </Field>
          <Field label="Taxas (R$)">
            <input type="number" step="0.01" value={taxas} onChange={(e) => setTaxas(Number(e.target.value))} className="bbt-input" />
          </Field>
          <Field label="TOTAL">
            <input value={`R$ ${totalCalculado.toFixed(2)}`} readOnly className="bbt-input bg-bbt-accent/10 font-bold text-bbt-primary" />
          </Field>
          <Field label="Centro de Custo"><input value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} className="bbt-input" /></Field>
          <Field label="Nº Solicitação"><input value={numeroSolicitacao} onChange={(e) => setNumeroSolicitacao(e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      {/* Observações */}
      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Observações</h2>
        <Field label="Obs. Externa (aparece no voucher)">
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} className="bbt-input" />
        </Field>
        <Field label="Obs. Interna (NÃO aparece no voucher)">
          <textarea value={obsInternas} onChange={(e) => setObsInternas(e.target.value)} rows={2} className="bbt-input" />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/dashboard/vouchers" className="bbt-button-ghost">Cancelar</Link>
        <button onClick={salvar} disabled={salvando} className="bbt-button-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {salvando ? 'Salvando...' : 'Salvar e Visualizar'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1 tracking-wider">{label}</label>
      {children}
    </div>
  )
}

export default function NovoVoucherPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <NovoVoucherInner />
    </Suspense>
  )
}
