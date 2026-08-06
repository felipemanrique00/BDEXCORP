'use client'

import { Eye, EyeOff, Loader2, RefreshCw, Save, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  getVoucherPresentationSettings,
  patchVoucherPresentationSettings,
} from '@/lib/vouchers/presentation-client'
import {
  emptyVoucherPresentationDeclared,
  type VoucherPresentationConfiguration,
  type VoucherPresentationDeclared,
  type VoucherPresentationScopeType,
} from '@/lib/vouchers/presentation'

interface Props {
  scopeType: VoucherPresentationScopeType
  scopeId: string
  scopeName: string
  canManage: boolean
  compact?: boolean
}

const FIELDS = [
  {
    key: 'showConfirmedValues',
    label: 'Valores confirmados',
    description: 'Diárias, taxas, subtotais e valor total confirmado.',
  },
  {
    key: 'showCancellationTerms',
    label: 'Cancelamento e condições',
    description: 'Reembolso, prazo, política de cancelamento e no-show.',
  },
  {
    key: 'showAdministrativeData',
    label: 'Dados administrativos',
    description: 'OS, solicitante, aprovadores, centro de custo, pagamento e datas internas.',
  },
] as const

type FieldKey = (typeof FIELDS)[number]['key']
type SelectValue = 'inherit' | 'show' | 'hide'

export function VoucherPresentationSettingsPanel({
  scopeType,
  scopeId,
  scopeName,
  canManage,
  compact = false,
}: Props) {
  const [configuration, setConfiguration] = useState<VoucherPresentationConfiguration | null>(null)
  const [draft, setDraft] = useState<VoucherPresentationDeclared>(emptyVoucherPresentationDeclared)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const activeScopeRef = useRef(`${scopeType}:${scopeId}`)

  useEffect(() => {
    const scopeKey = `${scopeType}:${scopeId}`
    activeScopeRef.current = scopeKey
    const controller = new AbortController()
    setConfiguration(null)
    setDraft(emptyVoucherPresentationDeclared())
    setLoading(true)
    setSaving(false)
    setError('')
    void getVoucherPresentationSettings(scopeType, scopeId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || activeScopeRef.current !== scopeKey) return
        setConfiguration(result)
        setDraft(result.declared)
      })
      .catch((reason) => {
        if (!controller.signal.aborted && activeScopeRef.current === scopeKey) {
          setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a configuração do voucher.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeRef.current === scopeKey) setLoading(false)
      })
    return () => controller.abort()
  }, [scopeId, scopeType])

  const dirty = useMemo(() => configuration
    ? FIELDS.some(({ key }) => draft[key] !== configuration.declared[key])
    : false, [configuration, draft])

  async function save(nextDraft = draft) {
    if (!configuration || saving || !canManage) return
    const scopeKey = `${scopeType}:${scopeId}`
    const currentConfiguration = configuration
    setSaving(true)
    try {
      const next = await patchVoucherPresentationSettings(scopeType, scopeId, {
        values: nextDraft,
        expectedVersion: currentConfiguration.version,
      })
      if (activeScopeRef.current !== scopeKey) return
      setConfiguration(next)
      setDraft(next.declared)
      toast.success('Exibição do voucher atualizada.')
    } catch (reason) {
      if (activeScopeRef.current !== scopeKey) return
      toast.error(reason instanceof Error ? reason.message : 'Não foi possível salvar a configuração do voucher.')
    } finally {
      if (activeScopeRef.current === scopeKey) setSaving(false)
    }
  }

  function resetToInherited() {
    const inherited = emptyVoucherPresentationDeclared()
    setDraft(inherited)
    void save(inherited)
  }

  const inheritanceLabel = scopeType === 'company'
    ? configuration?.effective.groupId ? 'Herdar do grupo' : 'Usar padrão do sistema'
    : 'Usar padrão do sistema'

  return (
    <section className={compact ? 'bbt-card p-5' : 'bbt-card p-6'} aria-labelledby={`voucher-presentation-${scopeType}-${scopeId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="bbt-section-label">Apresentação do voucher</p>
            <h2 id={`voucher-presentation-${scopeType}-${scopeId}`} className="mt-1 font-semibold text-bbt-primary dark:text-white">
              {scopeName}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Os dados permanecem preservados internamente; esta regra controla o documento exibido e impresso.
            </p>
          </div>
        </div>
        {!loading && configuration && (
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:border-slate-700">
            {scopeType === 'company' && configuration.effective.groupId ? 'Empresa → Grupo → Sistema' : 'Escopo → Sistema'}
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração...
        </div>
      )}

      {!loading && error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && configuration && (
        <>
          <div className={`mt-5 grid gap-3 ${compact ? '' : 'lg:grid-cols-3'}`}>
            {FIELDS.map((field) => {
              const effective = configuration.effective[field.key]
              const source = configuration.effective.sources[field.key]
              return (
                <div key={field.key} className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-bbt-primary dark:text-white">{field.label}</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{field.description}</p>
                    </div>
                    {effective
                      ? <Eye className="h-4 w-4 shrink-0 text-green-600" aria-label="Exibição ativa" />
                      : <EyeOff className="h-4 w-4 shrink-0 text-red-500" aria-label="Exibição ocultada" />}
                  </div>
                  <label className="mt-3 block">
                    <span className="sr-only">Regra para {field.label}</span>
                    <select
                      value={toSelectValue(draft[field.key])}
                      disabled={!canManage || saving}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        [field.key]: fromSelectValue(event.target.value as SelectValue),
                      }))}
                      className="bbt-input h-10 py-1 text-sm"
                    >
                      <option value="inherit">{inheritanceLabel}</option>
                      <option value="show">Exibir</option>
                      <option value="hide">Ocultar</option>
                    </select>
                  </label>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Resultado: <strong className={effective ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-300'}>
                      {effective ? 'Exibir' : 'Ocultar'}
                    </strong> · origem: {sourceLabel(source)}
                  </div>
                </div>
              )
            })}
          </div>

          {canManage ? (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
              <button
                type="button"
                disabled={saving || FIELDS.every(({ key }) => draft[key] === null)}
                onClick={resetToInherited}
                className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" /> Restaurar herança
              </button>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void save()}
                className="bbt-button-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Salvando...' : 'Salvar configuração'}
              </button>
            </div>
          ) : (
            <p className="mt-4 border-t border-bbt-gray-100 pt-3 text-xs text-slate-500 dark:border-slate-700">
              Configuração somente para consulta. É necessária a permissão de alterar configurações.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function toSelectValue(value: boolean | null): SelectValue {
  if (value === true) return 'show'
  if (value === false) return 'hide'
  return 'inherit'
}

function fromSelectValue(value: SelectValue): boolean | null {
  if (value === 'show') return true
  if (value === 'hide') return false
  return null
}

function sourceLabel(value: 'company' | 'group' | 'system'): string {
  if (value === 'company') return 'empresa'
  if (value === 'group') return 'grupo'
  return 'sistema'
}
