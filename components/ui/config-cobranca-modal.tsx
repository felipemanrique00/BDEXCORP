'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import { DollarSign, Percent, AlertCircle, Save } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Empresa, ConfigCobrancaEmpresa } from '@/types'
import { CONFIG_COBRANCA_PADRAO } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  empresa: Empresa | null
}

export function ConfigCobrancaModal({ open, onClose, empresa }: Props) {
  const { updateConfigCobranca } = useStore()
  const [config, setConfig] = useState<ConfigCobrancaEmpresa>(CONFIG_COBRANCA_PADRAO)

  useEffect(() => {
    if (!open || !empresa) return
    setConfig(empresa.config_cobranca || { ...CONFIG_COBRANCA_PADRAO })
  }, [open, empresa])

  if (!empresa) return null

  function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresa) return
    updateConfigCobranca(empresa.id, config)
    toast.success('Configuração de cobrança salva!')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Cobrança · ${empresa.nome}`} size="lg">
      <form onSubmit={salvar} className="space-y-5">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-300">
          <AlertCircle className="w-4 h-4 inline mr-1" />
          Estas configurações se aplicam a TODAS as novas demandas criadas para esta empresa.
          Você ainda pode editar caso a caso na hora de criar a demanda.
        </div>

        {/* MARKUP */}
        <div className="border-2 border-green-200 dark:border-green-800 rounded-xl p-4">
          <label className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-300 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.aplicar_markup}
              onChange={(e) => setConfig({ ...config, aplicar_markup: e.target.checked })}
              className="w-4 h-4"
            />
            <DollarSign className="w-5 h-5" />
            Aplicar MARKUP nesta empresa
          </label>

          {config.aplicar_markup ? (
            <div className="pl-6 pt-2 border-t border-green-200 dark:border-green-700">
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
                Markup padrão sugerido (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  value={config.markup_padrao_pct}
                  onChange={(e) => setConfig({ ...config, markup_padrao_pct: parseFloat(e.target.value) || 0 })}
                  className="bbt-input w-32"
                />
                <span className="text-sm text-slate-500">% sobre o custo</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2 italic">
                Ex: Custo R$ 100 + markup 10% = Venda R$ 110
              </div>
            </div>
          ) : (
            <div className="pl-6 text-xs text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 p-2 rounded mt-2">
              ⚠️ Sem markup: venda será igual ao custo. Cliente paga exatamente o que você paga ao fornecedor.
            </div>
          )}
        </div>

        {/* TAXA */}
        <div className="border-2 border-purple-200 dark:border-purple-800 rounded-xl p-4">
          <label className="flex items-center gap-2 font-semibold text-purple-700 dark:text-purple-300 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.aplicar_taxa}
              onChange={(e) => setConfig({ ...config, aplicar_taxa: e.target.checked })}
              className="w-4 h-4"
            />
            <Percent className="w-5 h-5" />
            Cobrar TAXA DE SERVIÇO adicional
          </label>

          {config.aplicar_taxa ? (
            <div className="pl-6 pt-2 border-t border-purple-200 dark:border-purple-700 space-y-3">
              <div className="flex gap-3 items-center text-sm">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={!config.taxa_fixa_ativa}
                    onChange={() => setConfig({ ...config, taxa_fixa_ativa: false })}
                  />
                  Percentual
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={config.taxa_fixa_ativa}
                    onChange={() => setConfig({ ...config, taxa_fixa_ativa: true })}
                  />
                  Valor fixo
                </label>
              </div>

              {config.taxa_fixa_ativa ? (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">
                    Taxa fixa (R$ por demanda)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={config.taxa_valor_fixo}
                    onChange={(e) => setConfig({ ...config, taxa_valor_fixo: parseFloat(e.target.value) || 0 })}
                    className="bbt-input w-40"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">
                    Taxa padrão (% sobre a venda)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={100}
                      value={config.taxa_padrao_pct}
                      onChange={(e) => setConfig({ ...config, taxa_padrao_pct: parseFloat(e.target.value) || 0 })}
                      className="bbt-input w-32"
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pl-6 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded mt-2">
              Sem taxa adicional. O cliente paga só o valor de venda.
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
            Observações internas
          </label>
          <textarea
            value={config.observacoes}
            onChange={(e) => setConfig({ ...config, observacoes: e.target.value })}
            rows={2}
            className="bbt-input"
            placeholder="Ex: Empresa não aceita taxa de serviço conforme contrato XYZ"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary flex items-center gap-2">
            <Save className="w-4 h-4" /> Salvar Configuração
          </button>
        </div>
      </form>
    </Modal>
  )
}
