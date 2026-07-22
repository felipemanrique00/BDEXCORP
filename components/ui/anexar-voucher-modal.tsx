'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import { Upload, FileText, Download, Trash2, Eye, Paperclip } from 'lucide-react'
import {
  addVoucher, deleteVoucher, downloadVoucher, getVouchersByDemanda, openVoucherInNewTab,
  formatBytes, type Voucher,
} from '@/lib/vouchers-storage'
import { anexarVoucherAtendimento, registrarLog, updateAtendimento } from '@/lib/atendimentos-storage'
import { getCurrentUser } from '@/lib/auth'
import { formatDate } from '@/lib/utils'
import type { Atendimento } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  atendimento: Atendimento | null
}

export function AnexarVoucherModal({ open, onClose, atendimento }: Props) {
  const [uploading, setUploading] = useState(false)
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [descricao, setDescricao] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  useEffect(() => {
    let active = true
    if (!open || !atendimento) {
      setVouchers([])
      return () => { active = false }
    }

    void getVouchersByDemanda(atendimento.id)
      .then((files) => {
        if (active) setVouchers(files)
      })
      .catch(() => {
        if (active) setVouchers([])
      })

    return () => { active = false }
  }, [open, atendimento])

  async function reload() {
    if (!atendimento) return
    setVouchers(await getVouchersByDemanda(atendimento.id))
  }

  async function handleFile(file: File) {
    if (!atendimento) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Apenas PDF.'); return
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Máximo 15MB por arquivo.'); return
    }
    setPendingFile(file)
    setDescricao(`Voucher ${atendimento.tipo_servico} - ${atendimento.passageiro_nome}`)
  }

  async function confirmUpload() {
    if (!pendingFile || !atendimento) return
    const user = getCurrentUser()
    if (!user) { toast.error('Faça login.'); return }

    setUploading(true)
    try {
      const voucher = await addVoucher({
        file: pendingFile,
        funcionario_id: atendimento.funcionario_id,
        demanda_id: atendimento.id,
        descricao: descricao || 'Voucher',
      })

      anexarVoucherAtendimento(atendimento.id, voucher.id)

      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'anexar_voucher',
        entidade: 'Atendimento', entidade_id: atendimento.id,
        descricao: `Anexou ${pendingFile.name} à demanda de ${atendimento.passageiro_nome}`,
      })

      toast.success('Voucher anexado!')
      setPendingFile(null); setDescricao('')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao processar arquivo.')
    } finally {
      setUploading(false)
    }
  }

  async function removerVoucher(v: Voucher) {
    if (!atendimento) return
    try {
      await deleteVoucher(v.id)
      const atualIds = (atendimento.voucher_ids || []).filter((id) => id !== v.id)
      updateAtendimento(atendimento.id, { voucher_ids: atualIds })
      toast.success('Voucher removido.')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel remover o voucher.')
    }
  }

  if (!atendimento) return null

  return (
    <Modal open={open} onClose={onClose} title="Anexar Vouchers à Demanda" size="lg">
      <div className="space-y-4">
        <div className="bg-bbt-accent/10 border border-bbt-accent/30 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Demanda</div>
          <div className="font-semibold text-bbt-primary dark:text-white">{atendimento.passageiro_nome} · {atendimento.tipo_servico}</div>
        </div>

        {!pendingFile ? (
          <label className="block border-2 border-dashed border-bbt-gray-100 dark:border-slate-700 rounded-xl p-6 text-center cursor-pointer hover:border-bbt-accent hover:bg-bbt-accent/5 transition">
            <Upload className="w-8 h-8 mx-auto text-bbt-accent mb-2" />
            <p className="font-medium text-bbt-primary dark:text-white text-sm">Clique para selecionar PDF</p>
            <p className="text-xs text-slate-500 mt-1">Até 15MB por arquivo · armazenamento privado da empresa</p>
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
          </label>
        ) : (
          <div className="space-y-3 p-3 border-2 border-bbt-accent rounded-lg bg-bbt-accent/5">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-red-600" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{pendingFile.name}</div>
                <div className="text-xs text-slate-500">{formatBytes(pendingFile.size)}</div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Descrição</label>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="bbt-input" autoFocus />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingFile(null)} className="bbt-button-ghost text-sm" disabled={uploading}>Cancelar</button>
              <button onClick={confirmUpload} className="bbt-button-primary text-sm" disabled={uploading}>{uploading ? 'Enviando...' : 'Anexar'}</button>
            </div>
          </div>
        )}

        <div>
          <h4 className="font-semibold text-sm text-bbt-primary dark:text-white mb-2 flex items-center gap-2">
            <Paperclip className="w-4 h-4" /> Vouchers desta demanda ({vouchers.length})
          </h4>
          {vouchers.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-bbt-gray-100 dark:border-slate-700 rounded-lg">
              Nenhum voucher anexado ainda.
            </div>
          ) : (
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 border border-bbt-gray-100 dark:border-slate-700 rounded-lg">
              {vouchers.map((v) => (
                <div key={v.id} className="p-3 flex items-center gap-3 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                  <FileText className="w-6 h-6 text-red-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{v.descricao}</div>
                    <div className="text-xs text-slate-500">{v.nome_arquivo} · {formatBytes(v.tamanho_bytes)} · {formatDate(v.data_upload)}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { if (!openVoucherInNewTab(v)) toast.error('Voucher inválido ou pop-up bloqueado.') }} className="p-1.5 rounded hover:bg-bbt-accent/10 text-slate-400 hover:text-bbt-accent transition" title="Ver"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => { if (downloadVoucher(v)) toast.success('Download iniciado'); else toast.error('Voucher inválido.') }} className="p-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-400 hover:text-blue-600 transition" title="Baixar"><Download className="w-4 h-4" /></button>
                    <button onClick={() => removerVoucher(v)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-600 transition" title="Remover"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
          <button onClick={onClose} className="bbt-button-ghost">Fechar</button>
        </div>
      </div>
    </Modal>
  )
}
