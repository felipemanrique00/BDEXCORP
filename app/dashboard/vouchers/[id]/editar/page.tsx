'use client'
/**
 * V10: Editar voucher emitido
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import {
  canEditCompany,
  getCurrentUser,
  getEmpresasPermitidas,
  hasPermission,
} from '@/lib/auth'
import {
  getVoucherFromServer,
  updateVoucherOnServer,
} from '@/lib/voucher-persistence-client'
import type { VoucherEmitido, VoucherTipo, VoucherStatus } from '@/types'
import {
  FileText, ArrowLeft, Save, Hotel as HotelIcon, Plane, Car, Package,
  Building2, Tag, DollarSign, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'

export default function EditarVoucherPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { empresas, gruposEmpresariais, funcionarios } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const empresasPermitidas = getEmpresasPermitidas(user, empresas, gruposEmpresariais)

  const [v, setV] = useState<VoucherEmitido | null>(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    void getVoucherFromServer(id)
      .then((found) => {
        if (active) setV(found)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Voucher não encontrado.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id])

  if (loading) return <div className="text-center py-12 text-slate-500">Carregando...</div>
  if (!v) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="text-slate-500 mb-4">Voucher não encontrado.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const canManageVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_reservas')
    && canEditCompany(user, v.empresa_id, empresas, gruposEmpresariais)

  if (!canManageVoucher) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para editar este voucher.</p>
        <Link href={`/dashboard/vouchers/${v.id}`} className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  function update<K extends keyof VoucherEmitido>(key: K, val: VoucherEmitido[K]) {
    setV((prev) => prev ? { ...prev, [key]: val } : prev)
  }

  async function salvar() {
    if (
      !v
      || !canManageVoucher
      || !canEditCompany(user, v.empresa_id, empresas, gruposEmpresariais)
    ) {
      toast.error('Você não tem permissão para salvar este voucher.')
      return
    }
    setSalvando(true)

    // Recalcular noites e total
    const noites = (() => {
      if (!v.data_checkin || !v.data_checkout) return v.noites
      const d1 = new Date(v.data_checkin)
      const d2 = new Date(v.data_checkout)
      const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
      return diff > 0 ? diff : 0
    })()

    const total = v.tipo === 'Hotel' && v.valor_diaria && noites
      ? v.valor_diaria * noites + (v.taxas || 0)
      : (v.tarifa_total || 0) + (v.taxas || 0)

    try {
      const updated = await updateVoucherOnServer(
        v.id,
        { ...v, noites, total },
        v.version,
      )
      setV(updated)
      toast.success('Voucher atualizado!')
      router.push(`/dashboard/vouchers/${v.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar o voucher.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/dashboard/vouchers/${v.id}`} className="text-xs text-slate-500 hover:text-bbt-accent flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> Voltar para visualização
          </Link>
          <h1 className="text-3xl font-bold text-bbt-primary dark:text-white flex items-center gap-3">
            <FileText className="w-8 h-8 text-bbt-accent" /> Editar {v.id}
          </h1>
        </div>
        <button onClick={salvar} disabled={salvando} className="bbt-button-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-bbt-accent" /> Status e Tipo</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Status">
            <select value={v.status} onChange={(e) => update('status', e.target.value as VoucherStatus)} className="bbt-input">
              <option value="rascunho">Rascunho</option>
              <option value="emitido">Emitido</option>
              <option value="confirmado">Confirmado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </Field>
          <Field label="Tipo">
            <select value={v.tipo} onChange={(e) => update('tipo', e.target.value as VoucherTipo)} className="bbt-input">
              <option>Hotel</option><option>Aéreo</option><option>Carro</option><option>Pacote</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-bbt-accent" /> Cliente</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Empresa">
            <select value={v.empresa_id} onChange={(e) => update('empresa_id', e.target.value)} className="bbt-input">
              {empresasPermitidas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Field>
          <Field label="Funcionário">
            <select value={v.funcionario_id || ''} onChange={(e) => update('funcionario_id', e.target.value || null)} className="bbt-input">
              <option value="">—</option>
              {funcionarios.filter((f) => f.company_id === v.empresa_id).map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </Field>
          <Field label="Passageiro"><input value={v.passageiro_nome} onChange={(e) => update('passageiro_nome', e.target.value)} className="bbt-input" /></Field>
          <Field label="CPF"><input value={v.cpf || ''} onChange={(e) => update('cpf', e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-bbt-accent" /> Fornecedor</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome"><input value={v.fornecedor_nome} onChange={(e) => update('fornecedor_nome', e.target.value)} className="bbt-input" /></Field>
          <Field label="Telefone"><input value={v.fornecedor_telefone || ''} onChange={(e) => update('fornecedor_telefone', e.target.value)} className="bbt-input" /></Field>
          <Field label="Endereço"><input value={v.fornecedor_endereco || ''} onChange={(e) => update('fornecedor_endereco', e.target.value)} className="bbt-input" /></Field>
          <Field label="Cidade"><input value={v.fornecedor_cidade || ''} onChange={(e) => update('fornecedor_cidade', e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      {v.tipo === 'Hotel' && (
        <div className="bbt-card p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2"><HotelIcon className="w-4 h-4 text-bbt-accent" /> Hospedagem</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Categoria"><input value={v.hotel_categoria || ''} onChange={(e) => update('hotel_categoria', e.target.value)} className="bbt-input" /></Field>
            <Field label="Tipo Apto"><input value={v.tipo_apartamento || ''} onChange={(e) => update('tipo_apartamento', e.target.value)} className="bbt-input" /></Field>
            <Field label="Apts"><input type="number" value={v.num_apartamentos || 1} onChange={(e) => update('num_apartamentos', Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Hóspedes"><input type="number" value={v.num_hospedes || 1} onChange={(e) => update('num_hospedes', Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Check-in"><input type="date" value={v.data_checkin || ''} onChange={(e) => update('data_checkin', e.target.value)} className="bbt-input" /></Field>
            <Field label="Check-out"><input type="date" value={v.data_checkout || ''} onChange={(e) => update('data_checkout', e.target.value)} className="bbt-input" /></Field>
            <Field label="Valor Diária"><input type="number" step="0.01" value={v.valor_diaria || 0} onChange={(e) => update('valor_diaria', Number(e.target.value))} className="bbt-input" /></Field>
            <Field label="Regime"><input value={v.regime || ''} onChange={(e) => update('regime', e.target.value)} className="bbt-input" /></Field>
            <Field label="Forma Pgto Voucher"><input value={v.forma_pagamento_voucher || ''} onChange={(e) => update('forma_pagamento_voucher', e.target.value)} className="bbt-input" /></Field>
          </div>
        </div>
      )}

      {v.tipo === 'Aéreo' && (
        <div className="bbt-card p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2"><Plane className="w-4 h-4 text-bbt-accent" /> Voo</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Cia"><input value={v.cia_aerea || ''} onChange={(e) => update('cia_aerea', e.target.value)} className="bbt-input" /></Field>
            <Field label="Voo"><input value={v.numero_voo || ''} onChange={(e) => update('numero_voo', e.target.value)} className="bbt-input" /></Field>
            <Field label="Localizador"><input value={v.localizador || ''} onChange={(e) => update('localizador', e.target.value)} className="bbt-input" /></Field>
            <Field label="Classe"><input value={v.classe || ''} onChange={(e) => update('classe', e.target.value)} className="bbt-input" /></Field>
            <Field label="Origem"><input value={v.origem || ''} onChange={(e) => update('origem', e.target.value)} className="bbt-input" /></Field>
            <Field label="Destino"><input value={v.destino || ''} onChange={(e) => update('destino', e.target.value)} className="bbt-input" /></Field>
            <Field label="Ida"><input type="date" value={v.data_ida || ''} onChange={(e) => update('data_ida', e.target.value)} className="bbt-input" /></Field>
            <Field label="Volta"><input type="date" value={v.data_volta || ''} onChange={(e) => update('data_volta', e.target.value)} className="bbt-input" /></Field>
          </div>
        </div>
      )}

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-bbt-accent" /> Confirmação</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Nº Confirmação"><input value={v.numero_confirmacao || ''} onChange={(e) => update('numero_confirmacao', e.target.value)} className="bbt-input" /></Field>
          <Field label="Data Confirmação"><input type="date" value={v.data_confirmacao || ''} onChange={(e) => update('data_confirmacao', e.target.value)} className="bbt-input" /></Field>
          <Field label="Confirmado Por"><input value={v.confirmado_por || ''} onChange={(e) => update('confirmado_por', e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-bbt-accent" /> Financeiro</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Tarifa Total"><input type="number" step="0.01" value={v.tarifa_total || 0} onChange={(e) => update('tarifa_total', Number(e.target.value))} className="bbt-input" /></Field>
          <Field label="Taxas"><input type="number" step="0.01" value={v.taxas || 0} onChange={(e) => update('taxas', Number(e.target.value))} className="bbt-input" /></Field>
          <Field label="Total"><input type="number" step="0.01" value={v.total || 0} onChange={(e) => update('total', Number(e.target.value))} className="bbt-input" /></Field>
          <Field label="Centro de Custo"><input value={v.centro_custo || ''} onChange={(e) => update('centro_custo', e.target.value)} className="bbt-input" /></Field>
          <Field label="Nº Solicitação"><input value={v.numero_solicitacao || ''} onChange={(e) => update('numero_solicitacao', e.target.value)} className="bbt-input" /></Field>
        </div>
      </div>

      <div className="bbt-card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Observações</h2>
        <Field label="Externa"><textarea value={v.observacoes || ''} onChange={(e) => update('observacoes', e.target.value)} rows={3} className="bbt-input" /></Field>
        <Field label="Interna"><textarea value={v.observacoes_internas || ''} onChange={(e) => update('observacoes_internas', e.target.value)} rows={2} className="bbt-input" /></Field>
      </div>

      <div className="flex justify-end gap-2">
        <Link href={`/dashboard/vouchers/${v.id}`} className="bbt-button-ghost">Cancelar</Link>
        <button onClick={salvar} disabled={salvando} className="bbt-button-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1 tracking-wider">{label}</label>
      {children}
    </div>
  )
}
