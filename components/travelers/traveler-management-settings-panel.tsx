'use client'

import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  UserPlus,
  UserX,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  getTravelerManagementSettings,
  patchTravelerManagementSettings,
} from '@/lib/travelers/management-settings-client'
import {
  emptyTravelerManagementDeclared,
  type TravelerManagementConfiguration,
  type TravelerManagementScopeType,
} from '@/lib/travelers/management-settings'

interface Props {
  scopeType: TravelerManagementScopeType
  scopeId: string
  scopeName: string
  canManage: boolean
  compact?: boolean
}

type SelectValue = 'inherit' | 'allow' | 'block'

export function TravelerManagementSettingsPanel({
  scopeType,
  scopeId,
  scopeName,
  canManage,
  compact = false,
}: Props) {
  const [configuration, setConfiguration] = useState<TravelerManagementConfiguration | null>(null)
  const [draft, setDraft] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const activeScopeRef = useRef(`${scopeType}:${scopeId}`)

  useEffect(() => {
    const scopeKey = `${scopeType}:${scopeId}`
    activeScopeRef.current = scopeKey
    const controller = new AbortController()
    setConfiguration(null)
    setDraft(emptyTravelerManagementDeclared().allowRequesterTravelerManagement)
    setLoading(true)
    setSaving(false)
    setError('')
    void getTravelerManagementSettings(scopeType, scopeId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || activeScopeRef.current !== scopeKey) return
        setConfiguration(result)
        setDraft(result.declared.allowRequesterTravelerManagement)
      })
      .catch((reason) => {
        if (!controller.signal.aborted && activeScopeRef.current === scopeKey) {
          setError(reason instanceof Error
            ? reason.message
            : 'Não foi possível carregar a configuração de viajantes.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeRef.current === scopeKey) setLoading(false)
      })
    return () => controller.abort()
  }, [scopeId, scopeType])

  const dirty = useMemo(() => configuration
    ? draft !== configuration.declared.allowRequesterTravelerManagement
    : false, [configuration, draft])

  async function save(nextValue = draft) {
    if (!configuration || saving || !canManage) return
    const scopeKey = `${scopeType}:${scopeId}`
    const currentConfiguration = configuration
    setSaving(true)
    try {
      const next = await patchTravelerManagementSettings(scopeType, scopeId, {
        values: { allowRequesterTravelerManagement: nextValue },
        expectedVersion: currentConfiguration.version,
      })
      if (activeScopeRef.current !== scopeKey) return
      setConfiguration(next)
      setDraft(next.declared.allowRequesterTravelerManagement)
      toast.success('Permissão de cadastro de viajantes atualizada.')
    } catch (reason) {
      if (activeScopeRef.current !== scopeKey) return
      toast.error(reason instanceof Error
        ? reason.message
        : 'Não foi possível salvar a configuração de viajantes.')
    } finally {
      if (activeScopeRef.current === scopeKey) setSaving(false)
    }
  }

  function resetToInherited() {
    setDraft(null)
    void save(null)
  }

  const inheritanceLabel = scopeType === 'company'
    ? configuration?.effective.groupId ? 'Herdar do grupo' : 'Usar padrão do sistema'
    : 'Usar padrão do sistema'
  const effective = configuration?.effective.allowRequesterTravelerManagement ?? false
  const source = configuration?.effective.sources.allowRequesterTravelerManagement || 'system'

  return (
    <section
      className={compact ? 'bbt-card p-5' : 'bbt-card p-6'}
      aria-labelledby={`traveler-management-${scopeType}-${scopeId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="bbt-section-label">Gestão de viajantes</p>
            <h2
              id={`traveler-management-${scopeType}-${scopeId}`}
              className="mt-1 font-semibold text-bbt-primary dark:text-white"
            >
              {scopeName}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Controle se solicitantes podem cadastrar viajantes e completar dados faltantes no portal.
              A equipe interna da agência permanece habilitada independentemente desta regra.
            </p>
          </div>
        </div>
        {!loading && configuration && (
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:border-slate-700">
            {scopeType === 'company' && configuration.effective.groupId
              ? 'Empresa → Grupo → Sistema'
              : 'Escopo → Sistema'}
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando configuração...
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {!loading && configuration && (
        <>
          <div className="mt-5 rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  effective
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                }`}>
                  {effective
                    ? <UserPlus className="h-4 w-4" aria-hidden="true" />
                    : <UserX className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div>
                  <div className="font-semibold text-bbt-primary dark:text-white">Cadastro pelo solicitante</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Quando permitido, o solicitante poderá incluir novos viajantes e informar dados obrigatórios que estejam faltando.
                  </p>
                </div>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                effective
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {effective && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                {effective ? 'Permitido' : 'Bloqueado'}
              </span>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                Regra neste escopo
              </span>
              <select
                value={toSelectValue(draft)}
                disabled={!canManage || saving}
                onChange={(event) => setDraft(fromSelectValue(event.target.value as SelectValue))}
                className="bbt-input h-10 py-1 text-sm"
              >
                <option value="inherit">{inheritanceLabel}</option>
                <option value="allow">Permitir cadastro e conclusão de dados</option>
                <option value="block">Bloquear cadastro no portal</option>
              </select>
            </label>
            <div className="mt-2 text-[11px] text-slate-500">
              Resultado efetivo: <strong className={effective
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-slate-700 dark:text-slate-200'}>
                {effective ? 'permitido' : 'bloqueado'}
              </strong> · origem: {sourceLabel(source)}
            </div>
          </div>

          {canManage ? (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
              <button
                type="button"
                disabled={saving || draft === null}
                onClick={resetToInherited}
                className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Restaurar herança
              </button>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void save()}
                className="bbt-button-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Save className="h-4 w-4" aria-hidden="true" />}
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
  if (value === true) return 'allow'
  if (value === false) return 'block'
  return 'inherit'
}

function fromSelectValue(value: SelectValue): boolean | null {
  if (value === 'allow') return true
  if (value === 'block') return false
  return null
}

function sourceLabel(value: 'company' | 'group' | 'system'): string {
  if (value === 'company') return 'empresa'
  if (value === 'group') return 'grupo'
  return 'sistema'
}
