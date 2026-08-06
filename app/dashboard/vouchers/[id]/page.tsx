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
import { formatDateBR as formatDateValueBR } from '@/lib/date'
import { resolveVoucherPresentationSettings } from '@/lib/vouchers/presentation'

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
  const empresaNome = voucher.empresa_nome || empresa?.nome || 'Empresa não informada'
  const hotelNome = voucher.hotel_nome
  const hospedes: NonNullable<VoucherEmitido['hospedes_detalhes']> = voucher.hospedes_detalhes?.length
    ? voucher.hospedes_detalhes
    : (voucher.passageiros?.length ? voucher.passageiros : [voucher.passageiro_nome]).map((nome, index) => ({
        nome,
        principal: index === 0,
      }))
  const fallbackRoomCount = voucher.num_apartamentos
    || ([voucher.tipo_apartamento, voucher.hotel_categoria, voucher.regime].some(Boolean) ? 1 : 0)
  const quartos: NonNullable<VoucherEmitido['quartos']> = voucher.quartos?.length
    ? voucher.quartos
    : Array.from({ length: fallbackRoomCount }, (_, index) => ({
        numero: index + 1,
        acomodacao: voucher.tipo_apartamento,
        categoria: voucher.hotel_categoria,
        regime: voucher.regime,
        ...(fallbackRoomCount === 1 ? { hospedes: hospedes.map((hospede) => hospede.nome) } : {}),
      }))
  const moeda = voucher.moeda || 'BRL'
  const presentation = voucher.presentation_settings ?? resolveVoucherPresentationSettings({})
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
    const serviceLine = voucher!.tipo === 'Hotel'
      ? `Hotel: ${voucher!.hotel_nome || 'Não informado'}\nCheck-in: ${formatDateTimeBR(voucher!.checkin_em || voucher!.data_checkin)}\nCheck-out: ${formatDateTimeBR(voucher!.checkout_em || voucher!.data_checkout)}`
      : `Serviço: ${voucher!.fornecedor_nome}`
    const txt = [
      `Voucher BBT ${voucher!.id}`,
      `Viajante: ${voucher!.passageiro_nome}`,
      serviceLine,
      `Localizador: ${voucher!.localizador || voucher!.numero_confirmacao || 'Não informado'}`,
    ].join('\n')
    const url = `https://wa.me/?text=${encodeURIComponent(txt)}`
    window.open(url, '_blank')
  }

  function compartilharEmail() {
    const subj = `Voucher BBT ${voucher!.id} - ${voucher!.passageiro_nome}`
    const hotelLine = voucher!.tipo === 'Hotel'
      ? `Hotel: ${voucher!.hotel_nome || 'Não informado'}\nCheck-in: ${formatDateTimeBR(voucher!.checkin_em || voucher!.data_checkin)}\nCheck-out: ${formatDateTimeBR(voucher!.checkout_em || voucher!.data_checkout)}\n`
      : ''
    const body = `Segue voucher de reserva:\n\n${voucher!.id}\nViajante: ${voucher!.passageiro_nome}\n${hotelLine}Localizador: ${voucher!.localizador || voucher!.numero_confirmacao || 'Não informado'}\n\nAcesse: ${window.location.href}`
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
      <div className="voucher-print mx-auto mt-4 min-h-[297mm] max-w-[210mm] bg-white p-8 text-black print:m-0 print:min-h-0 print:max-w-none print:p-0">
        <style jsx global>{`
          @media print {
            @page { size: A4; margin: 1.2cm; }
            html, body { background: white !important; }
            .print\\:hidden { display: none !important; }
            .voucher-print { width: 100% !important; }
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
            padding: 5px 7px;
            font-size: 10px;
            vertical-align: top;
          }
          .voucher-print th {
            background: #f0f0f0;
            font-weight: 600;
            text-align: center;
          }
          .voucher-section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .voucher-label {
            color: #64748b;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
          }
          .voucher-value {
            color: #0f172a;
            font-size: 11px;
            font-weight: 600;
          }
        `}</style>

        {/* Cabeçalho */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-bbt-primary">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/bbt-corporativo-mark-color.webp"
              alt="BBT Corporativo"
              className="h-20 w-20 rounded-lg object-contain"
            />
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
            {presentation.showAdministrativeData && (
              <div className="text-xs mt-1">Data de Emissão: {formatDataBR(voucher.created_at.slice(0, 10))}</div>
            )}
            <div className="text-xs mt-1">Tipo: {voucher.tipo}</div>
            {voucher.status === 'cancelado' && (
              <div className="text-2xl font-bold text-red-600 mt-2 border-2 border-red-600 px-3 py-1 rotate-[-12deg] inline-block">
                CANCELADO
              </div>
            )}
          </div>
        </div>

        {/* Identificação do pedido */}
        <div className="voucher-section mb-4 grid grid-cols-3 gap-3 rounded-md border border-slate-300 bg-slate-50 p-3">
          <VoucherInfo
            label="Cliente / empresa"
            value={[empresaNome, voucher.empresa_documento].filter(Boolean).join('\n')}
          />
          <VoucherInfo label="Viajante responsável" value={voucher.passageiro_nome} />
          {presentation.showAdministrativeData && (
            <>
              <VoucherInfo label="Pedido / OS" value={voucher.numero_solicitacao || voucher.atendimento_id} />
              <VoucherInfo
                label="Solicitante"
                value={[voucher.solicitante_nome, voucher.solicitante_email].filter(Boolean).join('\n')}
              />
              <VoucherInfo label="Centro de custo" value={voucher.centro_custo} />
              <VoucherInfo label="Unidade de negócio" value={voucher.unidade_negocio} />
            </>
          )}
        </div>

        {/* Detalhes por tipo */}
        {voucher.tipo === 'Hotel' && (
          <div className="voucher-section mb-4">
            <h3 className="mb-2 text-sm font-bold text-bbt-primary">Confirmação da hospedagem</h3>
            <div className="mb-3 grid grid-cols-[1.5fr_1fr] gap-4 rounded-md border border-slate-400 p-3">
              <div>
                <div className="voucher-label">Hotel escolhido</div>
                <div className="text-base font-bold text-bbt-primary">{displayValue(hotelNome)}</div>
                <div className="mt-1 text-[10px] leading-relaxed text-slate-700">
                  {voucher.hotel_endereco && <div>{voucher.hotel_endereco}</div>}
                  {voucher.hotel_cidade && <div>{voucher.hotel_cidade}</div>}
                  {[voucher.hotel_telefone, voucher.hotel_email].filter(Boolean).length > 0 && (
                    <div>{[voucher.hotel_telefone, voucher.hotel_email].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <VoucherInfo label="Check-in" value={formatDateTimeBR(voucher.checkin_em || voucher.data_checkin)} />
                <VoucherInfo label="Check-out" value={formatDateTimeBR(voucher.checkout_em || voucher.data_checkout)} />
                <VoucherInfo label="Noites" value={voucher.noites} />
                <VoucherInfo label="Quartos" value={voucher.num_apartamentos || quartos.length || undefined} />
              </div>
            </div>

            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">Hóspedes</h4>
            <table className="mb-3">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Nome</th>
                  <th>Papel</th>
                  <th>Código</th>
                  <th>Documento</th>
                  <th>Quarto</th>
                </tr>
              </thead>
              <tbody>
                {hospedes.map((hospede, index) => (
                  <tr key={`${hospede.nome}-${index}`}>
                    <td className="text-center">{index + 1}</td>
                    <td>
                      <div className="font-semibold">{hospede.nome}</div>
                      {(hospede.email || hospede.telefone) && (
                        <div className="mt-0.5 text-[9px] text-slate-500">
                          {[hospede.email, hospede.telefone].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>{hospede.principal ? 'Responsável' : displayValue(hospede.papel || 'Acompanhante')}</td>
                    <td>{displayValue(hospede.codigo)}</td>
                    <td>{displayValue(hospede.documento)}</td>
                    <td className="text-center">{displayValue(hospede.quarto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {quartos.length > 0 && (
              <>
                <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">Acomodações escolhidas</h4>
                <table className="mb-3">
                  <thead>
                    <tr>
                      <th className="w-16">Quarto</th>
                      <th>Acomodação</th>
                      <th>Categoria</th>
                      <th>Regime</th>
                      <th>Hóspedes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quartos.map((quarto) => (
                      <tr key={quarto.numero}>
                        <td className="text-center font-semibold">{quarto.numero}</td>
                        <td>{displayValue(quarto.acomodacao || voucher.tipo_apartamento)}</td>
                        <td>{displayValue(quarto.categoria || voucher.hotel_categoria)}</td>
                        <td>{displayValue(quarto.regime || voucher.regime)}</td>
                        <td>{displayValue(quarto.hospedes?.join(', '))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="grid grid-cols-3 gap-3 rounded-md border border-slate-300 bg-slate-50 p-3">
              <VoucherInfo
                label="Fornecedor operacional"
                value={[
                  voucher.fornecedor_nome,
                  presentation.showAdministrativeData ? voucher.fornecedor_codigo : undefined,
                ].filter(Boolean).join(' · ')}
              />
              <VoucherInfo label="Localizador / confirmação" value={voucher.numero_confirmacao || voucher.localizador} />
              {presentation.showAdministrativeData && (
                <>
                  <VoucherInfo label="Canal da reserva" value={voucher.canal_reserva} />
                  <VoucherInfo label="Forma de pagamento" value={voucher.forma_pagamento_voucher} />
                  <VoucherInfo label="Condições cotadas" value={voucher.condicoes_pagamento} />
                  <VoucherInfo label="Confirmado por" value={voucher.confirmado_por} />
                </>
              )}
            </div>
          </div>
        )}

        {voucher.tipo === 'Aéreo' && voucher.trechos_aereos?.length ? (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 italic">Itinerário aéreo:</h3>
            <table>
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Trecho</th>
                  <th>Companhia / voo</th>
                  <th>Classe</th>
                  <th>Bagagem</th>
                </tr>
              </thead>
              <tbody>
                {voucher.trechos_aereos.map((trecho) => (
                  <tr key={`${trecho.sequencia}-${trecho.numero_voo}`}>
                    <td>
                      <strong>Sai:</strong> {formatDateTimeBR(trecho.saida_em)}<br />
                      <strong>Chega:</strong> {formatDateTimeBR(trecho.chegada_em)}
                    </td>
                    <td>
                      {displayValue([trecho.origem_codigo, trecho.origem_nome].filter(Boolean).join(' - '))}<br />
                      → {displayValue([trecho.destino_codigo, trecho.destino_nome].filter(Boolean).join(' - '))}
                    </td>
                    <td>{displayValue(`${trecho.companhia_nome} · ${trecho.companhia_codigo} ${trecho.numero_voo}`)}</td>
                    <td>{displayValue(`${trecho.cabine} · ${trecho.classe_reserva}`)}</td>
                    <td className="text-center">{trecho.bagagens} volume(s)</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 grid grid-cols-3 gap-3 rounded-md border border-slate-300 bg-slate-50 p-3">
              <VoucherInfo label="Sistema de reserva" value={voucher.sistema_reserva} />
              <VoucherInfo label="Localizador" value={voucher.localizador || voucher.numero_confirmacao} />
              <VoucherInfo label="Prazo de emissão" value={formatDateTimeBR(voucher.prazo_emissao)} />
            </div>

            {voucher.bilhetes_aereos?.length ? (
              <div className="mt-3">
                <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">Bilhetes emitidos</h4>
                <table>
                  <thead><tr><th>Passageiro</th><th>Número do bilhete</th><th>Companhia emissora</th></tr></thead>
                  <tbody>
                    {voucher.bilhetes_aereos.map((bilhete) => (
                      <tr key={`${bilhete.passageiro_nome}-${bilhete.numero_bilhete}`}>
                        <td>{bilhete.passageiro_nome}</td>
                        <td>{bilhete.numero_bilhete}</td>
                        <td>{bilhete.companhia_nome} ({bilhete.companhia_codigo})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : voucher.tipo === 'Aéreo' && (
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

        {!['Hotel', 'Aéreo', 'Carro'].includes(voucher.tipo) && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 italic">Dados do Serviço:</h3>
            <table>
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Referência</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Início</th>
                  <th>Fim</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  <td>{voucher.tipo}</td>
                  <td>{voucher.numero_confirmacao || voucher.localizador || '—'}</td>
                  <td>{voucher.origem || '—'}</td>
                  <td>{voucher.destino || voucher.fornecedor_cidade || '—'}</td>
                  <td>{formatDataBR(voucher.data_ida)}</td>
                  <td>{formatDataBR(voucher.data_volta)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Financeiro */}
        {presentation.showConfirmedValues && <div className="voucher-section mb-4">
          <h3 className="mb-2 text-sm font-bold text-bbt-primary">Valores confirmados</h3>
          <table>
            <tbody>
              {voucher.valor_diaria !== undefined && (
                <tr>
                  <td className="w-2/3">
                    <span className="font-semibold">Diária por quarto</span>
                    {voucher.noites && (
                      <span className="ml-2 text-[9px] text-slate-500">
                        {voucher.noites} noite(s) × {voucher.num_apartamentos || quartos.length} quarto(s)
                      </span>
                    )}
                  </td>
                  <td className="text-right">{formatVoucherMoney(voucher.valor_diaria, moeda)}</td>
                </tr>
              )}
              {voucher.taxas_diaria !== undefined && (
                <tr><td className="font-semibold">Taxas por diária</td><td className="text-right">{formatVoucherMoney(voucher.taxas_diaria, moeda)}</td></tr>
              )}
              <tr><td className="font-semibold">{voucher.tipo === 'Hotel' ? 'Subtotal das diárias' : 'Tarifa total'}</td><td className="text-right">{formatVoucherMoney(voucher.tarifa_total || 0, moeda)}</td></tr>
              {(voucher.taxas || 0) > 0 && (
                <tr><td className="font-semibold">Taxas totais</td><td className="text-right">{formatVoucherMoney(voucher.taxas || 0, moeda)}</td></tr>
              )}
              {(voucher.rav || 0) > 0 && (
                <tr><td className="font-semibold">RAV</td><td className="text-right">{formatVoucherMoney(voucher.rav || 0, moeda)}</td></tr>
              )}
              {(voucher.rac || 0) > 0 && (
                <tr><td className="font-semibold">RAC</td><td className="text-right">{formatVoucherMoney(voucher.rac || 0, moeda)}</td></tr>
              )}
              {(voucher.tarifa_referencia || 0) > 0 && (
                <tr><td className="font-semibold">Tarifa de referência</td><td className="text-right">{formatVoucherMoney(voucher.tarifa_referencia || 0, moeda)}</td></tr>
              )}
              {(voucher.taxa_servico || 0) > 0 && (
                <tr><td className="font-semibold">Taxa de serviço</td><td className="text-right">{formatVoucherMoney(voucher.taxa_servico || 0, moeda)}</td></tr>
              )}
              <tr className="bg-bbt-primary font-bold text-white">
                <td>TOTAL ({moeda})</td>
                <td className="text-right">{formatVoucherMoney(voucher.total, moeda)}</td>
              </tr>
            </tbody>
          </table>
        </div>}

        {presentation.showCancellationTerms && hasVoucherCancellationContent(voucher) && (
          <div className={`voucher-section mb-4 rounded-md border p-3 ${
            voucher.reembolsavel === false
              ? 'border-red-300 bg-red-50'
              : 'border-amber-300 bg-amber-50'
          }`}>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-800">Cancelamento e condições</div>
            <div className="grid grid-cols-3 gap-3">
              <VoucherInfo
                label="Condição da tarifa"
                value={voucher.reembolsavel === false ? 'Não reembolsável' : voucher.reembolsavel === true ? 'Reembolsável' : undefined}
              />
              <VoucherInfo label="Prazo de cancelamento" value={formatDateTimeBR(voucher.prazo_cancelamento)} />
              <VoucherInfo label="Política" value={voucher.politica_cancelamento} />
            </div>
            {voucher.politica_no_show && <div className="mt-2 text-[10px]"><strong>No-show:</strong> {voucher.politica_no_show}</div>}
          </div>
        )}

        {presentation.showAdministrativeData && <div className="voucher-section mb-4">
          <h3 className="mb-2 text-sm font-bold text-bbt-primary">Dados administrativos</h3>
          <div className="grid grid-cols-3 gap-3 rounded-md border border-slate-300 p-3">
            <VoucherInfo label="Pedido / OS" value={voucher.numero_solicitacao || voucher.atendimento_id} />
            <VoucherInfo label="Solicitante" value={voucher.solicitante_nome} />
            <VoucherInfo label="Autorizador(es)" value={voucher.autorizadores?.join(', ')} />
            <VoucherInfo label="Reserva registrada em" value={formatDateTimeBR(voucher.data_reserva)} />
            <VoucherInfo label="Aprovado em" value={formatDateTimeBR(voucher.autorizado_em)} />
            <VoucherInfo label="Emitido em" value={formatDateTimeBR(voucher.created_at)} />
            <VoucherInfo label="Centro de custo" value={voucher.centro_custo} />
            <VoucherInfo label="Departamento" value={voucher.departamento} />
            <VoucherInfo label="Referência do pagamento" value={voucher.referencia_pagamento} />
          </div>
        </div>}

        {/* Obs */}
        {voucher.observacoes && (
          <div className="voucher-section mb-4">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">Observações ao cliente</div>
            <div className="border border-slate-400 p-2 min-h-[60px] whitespace-pre-wrap">{voucher.observacoes}</div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-6 pt-4 border-t border-slate-300 text-[10px] text-slate-600">
          <div className="italic mb-2">
            {presentation.showCancellationTerms
              ? 'Apresente este voucher no check-in e confira os prazos e condições descritos acima.'
              : 'Apresente este voucher no check-in.'}
          </div>
          {presentation.showAdministrativeData && (
            <div className="text-right mt-6 pt-2 border-t border-slate-400">
              Voucher cadastrado por: <strong>{voucher.emitido_por_user_name}</strong>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
function formatDataBR(value?: string): string {
  return formatDateValueBR(value, '—')
}

function formatDateTimeBR(value?: string): string {
  if (!value) return 'Não informado'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDataBR(value)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return formatDataBR(value)
  const hasTime = /T\d{2}:\d{2}/.test(value)
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}

function formatVoucherMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'BRL',
  }).format(value)
}

function displayValue(value: unknown): string {
  const normalized = String(value ?? '').trim()
  return normalized || 'Não informado'
}

function hasVoucherCancellationContent(voucher: VoucherEmitido): boolean {
  return typeof voucher.reembolsavel === 'boolean'
    || [
      voucher.prazo_cancelamento,
      voucher.politica_cancelamento,
      voucher.politica_no_show,
    ].some((value) => String(value || '').trim().length > 0)
}

function VoucherInfo({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="voucher-label">{label}</div>
      <div className="voucher-value whitespace-pre-wrap">{displayValue(value)}</div>
    </div>
  )
}
