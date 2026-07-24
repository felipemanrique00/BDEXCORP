'use client'
/**
 * V10: Visualização e impressão de Voucher Emitido
 * Layout fiel ao voucher real BBT (com logo, dados completos, A4 imprimível)
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { canViewCompany, getCurrentUser, hasPermission } from '@/lib/auth'
import {
  getVoucherFromServer,
  removeVoucherOnServer,
  updateVoucherOnServer,
} from '@/lib/voucher-persistence-client'
import type { VoucherEmitido } from '@/types'
import {
  Printer, ArrowLeft, Edit3, Trash2, MessageCircle, Mail, Copy, CheckCircle2, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

const BBT_INFO = {
  nome: 'BBT AGENCIA DE VIAGENS E TURISMO GLOBAIS',
  endereco: 'Rua 22, Quadra 31 Lote 05 - Setor Barcelos',
  cep_cidade: 'Cep: 75383-321 - Trindade - GO',
  email: 'financeiro@agenciabbt.com.br',
  cnpj: '20.027.725/0001-80',
  mtur: '09.062567.10.0001-0',
  telefone: '+55 (62) 3550-0851 / 98495-8417',
}

export default function VoucherViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { empresas, gruposEmpresariais } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const [voucher, setVoucher] = useState<VoucherEmitido | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let active = true
    void getVoucherFromServer(id)
      .then((value) => {
        if (active) setVoucher(value)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Voucher não encontrado.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id])

  if (loading) return <div className="py-12 text-center text-slate-500">Carregando...</div>

  if (!voucher) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="text-slate-500 mb-4">Voucher não encontrado.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const empresa = empresas.find((e) => e.id === voucher.empresa_id)
  const canManageVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_reservas')
  const canRemoveVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_cancelamentos')

  if (!canViewCompany(user, voucher.empresa_id, empresas, gruposEmpresariais)) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para acessar este voucher.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  function imprimir() {
    window.print()
  }

  async function alterarStatus(novoStatus: VoucherEmitido['status']) {
    if (!canManageVoucher) {
      toast.error('Você não tem permissão para alterar vouchers.')
      return
    }
    try {
      const updated = await updateVoucherOnServer(
        voucher!.id,
        { status: novoStatus },
        voucher!.version,
      )
      setVoucher(updated)
      toast.success(`Status alterado para ${novoStatus}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao alterar o status.')
    }
  }

  async function excluir() {
    if (!canRemoveVoucher) {
      toast.error('Você não tem permissão para excluir vouchers.')
      return
    }
    if (!confirm(`Excluir voucher ${voucher!.id}?`)) return
    try {
      await removeVoucherOnServer(voucher!.id)
      toast.success('Voucher excluído')
      router.push('/dashboard/vouchers')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao excluir o voucher.')
    }
  }

  function copiarLink() {
    const url = window.location.href
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado'))
  }

  function compartilharWhatsApp() {
    const txt = `Voucher BBT ${voucher!.id}\n${voucher!.passageiro_nome}\n${voucher!.fornecedor_nome}\n${voucher!.tipo === 'Hotel' ? `${formatDataBR(voucher!.data_checkin)} → ${formatDataBR(voucher!.data_checkout)}` : ''}`
    const url = `https://wa.me/?text=${encodeURIComponent(txt)}`
    window.open(url, '_blank')
  }

  function compartilharEmail() {
    const subj = `Voucher BBT ${voucher!.id} - ${voucher!.passageiro_nome}`
    const body = `Segue voucher de reserva:\n\n${voucher!.id}\nPassageiro: ${voucher!.passageiro_nome}\nFornecedor: ${voucher!.fornecedor_nome}\n\nAcesse: ${window.location.href}`
    window.location.href = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`
  }

  return (
    <>
      {/* Toolbar - oculta na impressão */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/dashboard/vouchers" className="text-xs text-slate-500 hover:text-bbt-accent flex items-center gap-1 mb-2">
              <ArrowLeft className="w-3 h-3" /> Voltar
            </Link>
            <h1 className="text-2xl font-bold text-bbt-primary dark:text-white">Voucher {voucher.id}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={imprimir} className="bbt-button-primary flex items-center gap-2 text-sm">
              <Printer className="w-4 h-4" /> Imprimir / PDF
            </button>
            {canManageVoucher && (
              <Link href={`/dashboard/vouchers/${voucher.id}/editar`} className="bbt-button-ghost flex items-center gap-2 text-sm">
                <Edit3 className="w-4 h-4" /> Editar
              </Link>
            )}
            <button onClick={compartilharWhatsApp} className="bbt-button-ghost flex items-center gap-2 text-sm">
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </button>
            <button onClick={compartilharEmail} className="bbt-button-ghost flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4" /> E-mail
            </button>
            <button onClick={copiarLink} className="bbt-button-ghost flex items-center gap-2 text-sm">
              <Copy className="w-4 h-4" /> Copiar Link
            </button>
            {canRemoveVoucher && (
              <button onClick={excluir} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded text-sm flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="bbt-card p-3 flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Status:</span>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            voucher.status === 'rascunho' ? 'bg-slate-100 text-slate-700' :
            voucher.status === 'emitido' ? 'bg-blue-100 text-blue-700' :
            voucher.status === 'confirmado' ? 'bg-green-100 text-green-700' :
            'bg-red-100 text-red-700'
          }`}>{voucher.status}</span>
          {canManageVoucher && <div className="flex gap-1 ml-auto">
            {voucher.status !== 'confirmado' && (
              <button onClick={() => alterarStatus('confirmado')} className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Marcar Confirmado
              </button>
            )}
            {voucher.status !== 'cancelado' && (
              <button onClick={() => alterarStatus('cancelado')} className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Cancelar
              </button>
            )}
          </div>}
        </div>
      </div>

      {/* VOUCHER (área imprimível) */}
      <div className="bg-white text-black p-8 mt-4 max-w-[210mm] mx-auto print:p-6 print:max-w-none print:mx-0 voucher-print" style={{ minHeight: '297mm' }}>
        <style jsx global>{`
          @media print {
            @page { size: A4; margin: 1.2cm; }
            body { background: white !important; }
            .print\\:hidden { display: none !important; }
          }
          .voucher-print {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: 11px;
            color: #1a1a1a;
          }
          .voucher-print h1, .voucher-print h2, .voucher-print h3 {
            color: #0a2540;
          }
          .voucher-print table { border-collapse: collapse; width: 100%; }
          .voucher-print td, .voucher-print th {
            border: 1px solid #999;
            padding: 4px 6px;
            font-size: 10px;
          }
          .voucher-print th {
            background: #f0f0f0;
            font-weight: 600;
            text-align: center;
          }
        `}</style>

        {/* Cabeçalho */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-bbt-primary">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gradient-to-br from-cyan-400 to-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-3xl">
              B
            </div>
            <div className="text-xs leading-relaxed">
              <div className="font-bold text-base text-bbt-primary">{BBT_INFO.nome}</div>
              <div>{BBT_INFO.endereco}</div>
              <div>{BBT_INFO.cep_cidade}</div>
              <div>Tel: {BBT_INFO.telefone}</div>
              <div>E-mail: {BBT_INFO.email}</div>
              <div>CNPJ: {BBT_INFO.cnpj}</div>
              <div>Ministério do Turismo: {BBT_INFO.mtur}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-bbt-primary">VOUCHER Nº {voucher.id}</div>
            <div className="text-xs mt-1">Data de Emissão: {formatDataBR(voucher.created_at.slice(0, 10))}</div>
            <div className="text-xs mt-1">Tipo: {voucher.tipo}</div>
            {voucher.status === 'cancelado' && (
              <div className="text-2xl font-bold text-red-600 mt-2 border-2 border-red-600 px-3 py-1 rotate-[-12deg] inline-block">
                CANCELADO
              </div>
            )}
          </div>
        </div>

        {/* Para / Cliente */}
        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="font-bold text-xs text-slate-600 uppercase">Para (To):</div>
            <div className="font-semibold">{voucher.fornecedor_nome}</div>
            {voucher.fornecedor_endereco && <div>Endereço: {voucher.fornecedor_endereco}</div>}
            {voucher.fornecedor_cidade && <div>Cidade: {voucher.fornecedor_cidade}</div>}
            {voucher.fornecedor_telefone && <div>Telefone: {voucher.fornecedor_telefone}</div>}
          </div>
          <div>
            <div className="font-bold text-xs text-slate-600 uppercase">Cliente (Client):</div>
            <div className="font-semibold">{voucher.passageiro_nome}</div>
            {voucher.cpf && <div>CPF: {voucher.cpf}</div>}
            {empresa && <div className="text-slate-600">Empresa: {empresa.nome}</div>}
            {voucher.passageiros && voucher.passageiros.length > 1 && (
              <div className="text-xs mt-1">
                <span className="font-semibold">Hóspedes:</span> {voucher.passageiros.join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Detalhes por tipo */}
        {voucher.tipo === 'Hotel' && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 italic">Dados da Hospedagem:</h3>
            <table>
              <thead>
                <tr>
                  <th>Nr. Apts</th>
                  <th>Categoria</th>
                  <th>Tipo apt.</th>
                  <th>Check-In</th>
                  <th>Check-Out</th>
                  <th>Noites</th>
                  <th>Hóspedes</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  <td>{voucher.num_apartamentos || 1}</td>
                  <td>{voucher.hotel_categoria}</td>
                  <td>{voucher.tipo_apartamento}</td>
                  <td>{formatDataBR(voucher.data_checkin)}</td>
                  <td>{formatDataBR(voucher.data_checkout)}</td>
                  <td>{voucher.noites}</td>
                  <td>{voucher.num_hospedes}</td>
                </tr>
              </tbody>
            </table>

            <table className="mt-2">
              <thead>
                <tr>
                  <th>Tipo de Pagamento</th>
                  <th>Regime de Alimentação</th>
                  <th>Nr. Confirmação</th>
                  <th>Dt. Confirm.</th>
                  <th>Confirmado por</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  <td>{voucher.forma_pagamento_voucher}</td>
                  <td>{voucher.regime}</td>
                  <td>{voucher.numero_confirmacao}</td>
                  <td>{formatDataBR(voucher.data_confirmacao)}</td>
                  <td>{voucher.confirmado_por}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {voucher.tipo === 'Aéreo' && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 italic">Dados do Voo:</h3>
            <table>
              <thead>
                <tr>
                  <th>Cia</th>
                  <th>Voo</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Ida</th>
                  <th>Volta</th>
                  <th>Classe</th>
                  <th>Localizador</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  <td>{voucher.cia_aerea}</td>
                  <td>{voucher.numero_voo}</td>
                  <td>{voucher.origem}</td>
                  <td>{voucher.destino}</td>
                  <td>{formatDataBR(voucher.data_ida)}</td>
                  <td>{formatDataBR(voucher.data_volta)}</td>
                  <td>{voucher.classe}</td>
                  <td>{voucher.localizador}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {voucher.tipo === 'Carro' && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 italic">Dados da Locação:</h3>
            <table>
              <thead>
                <tr>
                  <th>Locadora</th>
                  <th>Categoria</th>
                  <th>Retirada</th>
                  <th>Data Retirada</th>
                  <th>Devolução</th>
                  <th>Data Devolução</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  <td>{voucher.locadora}</td>
                  <td>{voucher.categoria_carro}</td>
                  <td>{voucher.retirada_local}</td>
                  <td>{formatDataBR(voucher.retirada_data)}</td>
                  <td>{voucher.devolucao_local}</td>
                  <td>{formatDataBR(voucher.devolucao_data)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Financeiro */}
        <div className="mb-4">
          <h3 className="font-bold text-sm mb-2 italic">Valores:</h3>
          <table>
            <tbody>
              {voucher.valor_diaria && (
                <tr><td className="font-semibold w-1/3">Valor Diária</td><td className="text-right">{formatCurrency(voucher.valor_diaria)}</td></tr>
              )}
              <tr><td className="font-semibold">Tarifa Total</td><td className="text-right">{formatCurrency(voucher.tarifa_total || 0)}</td></tr>
              {(voucher.taxas || 0) > 0 && (
                <tr><td className="font-semibold">Taxas</td><td className="text-right">{formatCurrency(voucher.taxas || 0)}</td></tr>
              )}
              <tr className="bg-slate-100 font-bold">
                <td>TOTAL</td>
                <td className="text-right">{formatCurrency(voucher.total)}</td>
              </tr>
              {voucher.centro_custo && (
                <tr><td className="font-semibold">Centro de Custo</td><td>{voucher.centro_custo}</td></tr>
              )}
              {voucher.numero_solicitacao && (
                <tr><td className="font-semibold">Nº Solicitação</td><td>{voucher.numero_solicitacao}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Obs */}
        {voucher.observacoes && (
          <div className="mb-4">
            <div className="font-bold text-xs italic">Obs (Remarks):</div>
            <div className="border border-slate-400 p-2 min-h-[60px] whitespace-pre-wrap">{voucher.observacoes}</div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-6 pt-4 border-t border-slate-300 text-[10px] text-slate-600">
          <div className="italic mb-2">Sr. Cliente, evite cancelamento de última hora devido cobrança de no-show.</div>
          <div className="text-right mt-6 pt-2 border-t border-slate-400">
            Voucher cadastrado por: <strong>{voucher.emitido_por_user_name}</strong>
          </div>
        </div>
      </div>
    </>
  )
}

function formatDataBR(iso?: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}
