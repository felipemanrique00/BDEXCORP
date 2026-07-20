'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useStore } from '@/lib/store'
import { addEmissao } from '@/lib/emissoes-storage'
import { toast } from 'sonner'
import { FileText, Hotel as HotelIcon, Calendar, DollarSign } from 'lucide-react'
import type { Hotel } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  hotel: Hotel | null
  empresaIdPadrao?: string
  onSuccess?: () => void
}

export function RegistrarEmissaoModal({ open, onClose, hotel, empresaIdPadrao, onSuccess }: Props) {
  const { empresas } = useStore()
  const [empresaId, setEmpresaId] = useState(empresaIdPadrao || empresas[0]?.id || '')
  const [funcionarioNome, setFuncionarioNome] = useState('')
  const [dataCheckin, setDataCheckin] = useState(todayISODate())
  const [dataCheckout, setDataCheckout] = useState(addDaysISODate(todayISODate(), 1))
  const [valorTotal, setValorTotal] = useState<number>(hotel?.tarifa_sgl || hotel?.tarifa_dbl || 0)
  const [observacoes, setObservacoes] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hotel || !empresaId || !funcionarioNome.trim()) {
      toast.error('Preencha os campos obrigatórios.')
      return
    }
    const result = addEmissao({
      hotel_id: hotel.id,
      empresa_id: empresaId,
      funcionario_nome: funcionarioNome.trim(),
      data_checkin: dataCheckin,
      data_checkout: dataCheckout,
      valor_total: valorTotal || 0,
      observacoes: observacoes.trim(),
    })
    if (result) {
      toast.success('Emissão registrada!')
      setFuncionarioNome('')
      setObservacoes('')
      onSuccess?.()
      onClose()
    } else {
      toast.error('Erro ao registrar emissão.')
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
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">Hóspede *</label>
          <input type="text" value={funcionarioNome} onChange={(e) => setFuncionarioNome(e.target.value)} className="bbt-input" required autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><Calendar className="inline w-3 h-3" /> Check-in</label>
            <input type="date" value={dataCheckin} onChange={(e) => setDataCheckin(e.target.value)} className="bbt-input" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><Calendar className="inline w-3 h-3" /> Check-out</label>
            <input type="date" value={dataCheckout} onChange={(e) => setDataCheckout(e.target.value)} className="bbt-input" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5"><DollarSign className="inline w-3 h-3" /> Valor Total (R$)</label>
          <input type="number" step="0.01" value={valorTotal || ''} onChange={(e) => setValorTotal(parseFloat(e.target.value) || 0)} className="bbt-input" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">Observações</label>
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="bbt-input" />
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary flex items-center gap-2">
            <FileText className="w-4 h-4" /> Registrar
          </button>
        </div>
      </form>
    </Modal>
  )
}
