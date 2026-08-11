'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useStore } from '@/lib/store'
import { addEmissao } from '@/lib/emissoes-storage'
import {
  createManualHotelBookingOnServer,
  ManualHotelBookingClientError,
} from '@/lib/manual-hotel-booking-client'
import { toast } from 'sonner'
import { FileText, Hotel as HotelIcon, Calendar, DollarSign, Loader2 } from 'lucide-react'
import type { Hotel } from '@/types'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import { DateInput } from '@/components/ui/date-input'
import { NumericDecimalInput } from '@/components/ui/decimal-input'

interface Props {
  open: boolean
  onClose: () => void
  hotel: Hotel | null
  empresaIdPadrao?: string
  onSuccess?: () => void
}

export function RegistrarEmissaoModal({ open, onClose, hotel, empresaIdPadrao, onSuccess }: Props) {
  const { empresas, funcionarios } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const empresasPermitidas = useMemo(
    () => empresas.filter((empresa) => includesCompany(empresa.id, 'operar_emissoes')),
    [empresas, includesCompany],
  )
  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState('')
  const [dataCheckin, setDataCheckin] = useState(todayISODate())
  const [dataCheckout, setDataCheckout] = useState(addDaysISODate(todayISODate(), 1))
  const [valorTotal, setValorTotal] = useState(0)
  const [observacoes, setObservacoes] = useState('')
  const [busy, setBusy] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const funcionariosEmpresa = useMemo(
    () => funcionarios
      .filter((funcionario) => funcionario.company_id === empresaId && funcionario.ativo)
      .sort((left, right) => left.nome.localeCompare(right.nome)),
    [empresaId, funcionarios],
  )

  useEffect(() => {
    if (!open) return
    const defaultCompanyId = empresaIdPadrao
      && empresasPermitidas.some((empresa) => empresa.id === empresaIdPadrao)
      ? empresaIdPadrao
      : empresasPermitidas[0]?.id || ''
    setEmpresaId(defaultCompanyId)
    setFuncionarioId('')
    setDataCheckin(todayISODate())
    setDataCheckout(addDaysISODate(todayISODate(), 1))
    setValorTotal(hotel?.tarifa_sgl || hotel?.tarifa_dbl || 0)
    setObservacoes('')
    setIdempotencyKey(`manual-hotel:${crypto.randomUUID()}`)
  }, [empresaIdPadrao, empresasPermitidas, hotel, open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const funcionario = funcionariosEmpresa.find((item) => item.id === funcionarioId)
    if (!hotel || !empresaId || !funcionario) {
      toast.error('Preencha os campos obrigatórios.')
      return
    }
    setBusy(true)
    try {
      await createManualHotelBookingOnServer({
        hotel_id: hotel.id,
        empresa_id: empresaId,
        funcionario_id: funcionario.id,
        data_checkin: dataCheckin,
        data_checkout: dataCheckout,
        valor_total: valorTotal || 0,
        observacoes: observacoes.trim(),
      }, idempotencyKey)
      toast.success('Emissão registrada!')
      onSuccess?.()
      onClose()
    } catch (error) {
      if (
        error instanceof ManualHotelBookingClientError
        && error.code === 'MANUAL_HOTEL_RELATIONAL_WRITE_DISABLED'
      ) {
        const result = addEmissao({
          hotel_id: hotel.id,
          empresa_id: empresaId,
          funcionario_id: funcionario.id,
          funcionario_nome: funcionario.nome,
          data_checkin: dataCheckin,
          data_checkout: dataCheckout,
          valor_total: valorTotal || 0,
          observacoes: observacoes.trim(),
        })
        if (result) {
          try {
            await commitPendingRemoteStorage()
          } catch (commitError) {
            toast.error(
              commitError instanceof Error
                ? commitError.message
                : 'Falha ao confirmar o registro no servidor.',
            )
            return
          }
          toast.success('Emissão registrada no modo legado.')
          onSuccess?.()
          onClose()
        } else {
          toast.error('Erro ao registrar emissão.')
        }
      } else {
        toast.error(error instanceof Error ? error.message : 'Erro ao registrar emissão.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!hotel) return null

  return (
    <Modal open={open} onClose={onClose} title="Registrar Emissão" size="md">
      <div className="mb-4 p-3 bg-bbt-accent/10 border border-bbt-accent/30 rounded-lg flex items-center gap-3">
        <HotelIcon className="w-5 h-5 text-bbt-primary dark:text-bbt-accent" />
        <div>
          <div className="font-semibold text-bbt-primary dark:text-white">{hotel.nome}</div>
          <div className="text-xs text-slate-500">{hotel.cidade} · {hotel.uf}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">Empresa *</label>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="bbt-input" required>
            <option value="">Selecione a empresa</option>
            {empresasPermitidas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">Funcionário / hóspede *</label>
          <select
            value={funcionarioId}
            onChange={(event) => setFuncionarioId(event.target.value)}
            className="bbt-input"
            required
            autoFocus
          >
            <option value="">Selecione pelo ID único</option>
            {funcionariosEmpresa.map((funcionario) => (
              <option key={funcionario.id} value={funcionario.id}>
                {funcionario.codigo_identificacao} - {funcionario.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="manual-emission-checkin" className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><Calendar className="inline w-3 h-3" /> Check-in</label>
            <DateInput id="manual-emission-checkin" value={dataCheckin} onChange={(e) => setDataCheckin(e.target.value)} className="bbt-input" />
          </div>
          <div>
            <label htmlFor="manual-emission-checkout" className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><Calendar className="inline w-3 h-3" /> Check-out</label>
            <DateInput id="manual-emission-checkout" value={dataCheckout} onChange={(e) => setDataCheckout(e.target.value)} className="bbt-input" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><DollarSign className="inline w-3 h-3" /> Valor Total (R$)</label>
          <NumericDecimalInput value={valorTotal} emptyValue={0} blankWhenZero onNumberChange={(value) => setValorTotal(value ?? 0)} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">Observações</label>
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="bbt-input" />
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button
            type="submit"
            disabled={busy}
            className="bbt-button-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileText className="w-4 h-4" />}
            {busy ? 'Registrando...' : 'Registrar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
