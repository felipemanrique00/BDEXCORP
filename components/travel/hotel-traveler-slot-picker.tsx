'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import {
  TravelerProfileDialog,
  type TravelerProfileDialogSubmission,
} from '@/components/travel/traveler-profile-dialog'
import {
  airPassengerProfileIssueMessage,
  normalizeAirPassengerProfileIssues,
  type AirPassengerProfileIssue,
} from '@/lib/air-demand/passenger-selection'
import { getCurrentUser } from '@/lib/auth'
import {
  completeTravelerMissingProfile,
  createTraveler,
  searchTravelers,
} from '@/lib/travelers/client'
import { getTravelerManagementSettings } from '@/lib/travelers/management-settings-client'
import type { TravelerDirectoryItem } from '@/lib/travelers/types'
import { isRequesterUser, userAccessKind } from '@/lib/user-access-kind'
import type { HotelDemandGuest } from '@/types'

export interface HotelTravelerManagementCapabilities {
  canCreate: boolean
  canComplete: boolean
  canCompleteName: boolean
}

export function useHotelTravelerManagementCapabilities(
  companyId: string,
  enabled = true,
): HotelTravelerManagementCapabilities {
  const { includesCompany } = useCorporateCompanyScope()
  const [sessionUser, setSessionUser] = useState<ReturnType<typeof getCurrentUser>>(null)
  const [requesterSettingEnabled, setRequesterSettingEnabled] = useState(false)
  const requesterUser = isRequesterUser(sessionUser)
  const internalDemandOperator = Boolean(
    sessionUser
    && userAccessKind(sessionUser) === 'internal'
    && companyId
    && includesCompany(companyId, 'criar_demandas'),
  )
  const agencyCanCreate = Boolean(companyId) && (
    internalDemandOperator
    || includesCompany(companyId, 'cadastrar_funcionarios')
    || includesCompany(companyId, 'gerenciar_funcionarios')
  )
  const agencyCanComplete = Boolean(companyId) && (
    internalDemandOperator
    || includesCompany(companyId, 'gerenciar_funcionarios')
  )

  useEffect(() => {
    setSessionUser(getCurrentUser())
  }, [])

  useEffect(() => {
    if (!enabled || !companyId || !requesterUser) {
      setRequesterSettingEnabled(false)
      return
    }
    const controller = new AbortController()
    setRequesterSettingEnabled(false)
    void getTravelerManagementSettings('company', companyId, controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) {
          setRequesterSettingEnabled(
            configuration.effective.allowRequesterTravelerManagement,
          )
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRequesterSettingEnabled(false)
      })
    return () => controller.abort()
  }, [companyId, enabled, requesterUser])

  if (!enabled || !companyId || !sessionUser) {
    return { canCreate: false, canComplete: false, canCompleteName: false }
  }
  if (requesterUser) {
    return {
      canCreate: requesterSettingEnabled,
      canComplete: requesterSettingEnabled,
      canCompleteName: false,
    }
  }
  return {
    canCreate: agencyCanCreate,
    canComplete: agencyCanComplete,
    canCompleteName: agencyCanComplete,
  }
}

interface HotelTravelerSlotPickerProps {
  companyId: string
  label: string
  role: HotelDemandGuest['role']
  slotIndex: number
  allowsExternal: boolean
  required?: boolean
  value?: HotelDemandGuest
  disabled: boolean
  excludedEmployeeIds: Set<string>
  capabilities: HotelTravelerManagementCapabilities
  externalContactFields?: boolean
  surface?: 'card' | 'subtle'
  onChange: (value: HotelDemandGuest | null) => void
}

type ProfileDialogState = 'create' | 'complete' | null

export function HotelTravelerSlotPicker(props: HotelTravelerSlotPickerProps) {
  const inputId = useId()
  const listboxId = useId()
  const [query, setQuery] = useState(props.value?.name || '')
  const [email, setEmail] = useState(props.value?.email || '')
  const [phone, setPhone] = useState(props.value?.phone || '')
  const [items, setItems] = useState<TravelerDirectoryItem[]>([])
  const [selectedProfile, setSelectedProfile] = useState<TravelerDirectoryItem | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [error, setError] = useState('')
  const [external, setExternal] = useState(props.value?.is_external === true)
  const [profileDialog, setProfileDialog] = useState<ProfileDialogState>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setQuery(props.value?.name || '')
    setEmail(props.value?.email || '')
    setPhone(props.value?.phone || '')
    setExternal(props.value?.is_external === true)
    setOpen(false)
    setError('')
    setProfileDialog(null)
    setSelectedProfile((current) => (
      current?.id === props.value?.employee_id ? current : null
    ))
  }, [props.value?.employee_id, props.value?.email, props.value?.is_external, props.value?.name, props.value?.phone])

  useEffect(() => {
    const employeeId = props.value?.employee_id
    if (!employeeId || external || !props.companyId) {
      setProfileLoading(false)
      return
    }
    const controller = new AbortController()
    setProfileLoading(true)
    void searchTravelers({ companyId: props.companyId, ids: [employeeId], limit: 1 }, controller.signal)
      .then((matches) => {
        if (!controller.signal.aborted) setSelectedProfile(matches[0] || null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSelectedProfile(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false)
      })
    return () => controller.abort()
  }, [external, props.companyId, props.value?.employee_id])

  useEffect(() => {
    if (!open || external || !props.companyId || props.disabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void searchTravelers(
        { companyId: props.companyId, q: query.trim() || undefined, limit: 20 },
        controller.signal,
      )
        .then((result) => setItems(result))
        .catch((cause) => {
          if (controller.signal.aborted) return
          setItems([])
          setError(cause instanceof Error ? cause.message : 'Não foi possível buscar viajantes.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, query.trim() ? 250 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [external, open, props.companyId, props.disabled, query])

  const selectedIssues = useMemo(() => normalizeAirPassengerProfileIssues(
    selectedProfile?.profileIssues,
    selectedProfile?.name || props.value?.name || '',
  ), [props.value?.name, selectedProfile])
  const editableIssues = selectedIssues.filter((issue) => canEditIssue(issue, props.capabilities))

  function choose(item: TravelerDirectoryItem) {
    setQuery(item.name)
    setEmail(item.email || '')
    setPhone(item.phone || '')
    setSelectedProfile(item)
    setOpen(false)
    props.onChange(guestFromTraveler(item, props.slotIndex, props.role))
  }

  function emitExternal(next: { name?: string; email?: string; phone?: string }) {
    const nextName = next.name ?? query
    const nextEmail = next.email ?? email
    const nextPhone = next.phone ?? phone
    props.onChange(nextName.trim().length >= 2 ? {
      slot_index: props.slotIndex,
      role: props.role,
      name: nextName.trim(),
      email: nextEmail.trim() || undefined,
      phone: nextPhone.trim() || undefined,
      is_external: true,
    } : null)
  }

  async function saveTravelerProfile(value: TravelerProfileDialogSubmission) {
    if (!props.companyId || !profileDialog) {
      throw new Error('O contexto da empresa ou do cadastro nao esta disponivel.')
    }
    if (profileDialog === 'create') {
      const created = await createTraveler({
        companyId: props.companyId,
        name: value.name || query,
        cpf: value.cpf || '',
        birthDate: value.birthDate || '',
        email: value.email,
        phone: value.phone,
      })
      setItems((current) => mergeTravelerList(current, created))
      choose(created)
      return
    }
    if (!selectedProfile) {
      throw new Error('Selecione novamente o viajante que precisa ser atualizado.')
    }
    const updated = await completeTravelerMissingProfile(selectedProfile.id, {
      ...(props.capabilities.canCompleteName && value.name ? { name: value.name } : {}),
      ...(value.cpf ? { cpf: value.cpf } : {}),
      ...(value.birthDate ? { birthDate: value.birthDate } : {}),
    })
    setItems((current) => mergeTravelerList(current, updated))
    choose(updated)
  }

  const surfaceClass = props.surface === 'subtle'
    ? 'rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40'
    : 'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60'

  return (
    <div className={surfaceClass}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {props.label}
        </label>
        {props.allowsExternal && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={external}
              disabled={props.disabled}
              onChange={(event) => {
                const checked = event.target.checked
                setExternal(checked)
                setQuery('')
                setEmail('')
                setPhone('')
                setOpen(false)
                setSelectedProfile(null)
                props.onChange(null)
              }}
            />
            Hóspede externo
          </label>
        )}
      </div>

      {external ? (
        <div className={`grid gap-2 ${props.externalContactFields ? 'sm:grid-cols-2' : ''}`}>
          <input
            id={inputId}
            value={query}
            disabled={props.disabled}
            onChange={(event) => {
              setQuery(event.target.value)
              emitExternal({ name: event.target.value })
            }}
            className={`bbt-input ${props.externalContactFields ? 'sm:col-span-2' : ''}`}
            placeholder="Nome completo do acompanhante"
            required={props.required}
          />
          {props.externalContactFields && (
            <>
              <input
                type="email"
                value={email}
                disabled={props.disabled}
                onChange={(event) => {
                  setEmail(event.target.value)
                  emitExternal({ email: event.target.value })
                }}
                className="bbt-input"
                placeholder="E-mail (opcional)"
                aria-label={`E-mail de ${props.label}`}
              />
              <input
                value={phone}
                disabled={props.disabled}
                onChange={(event) => {
                  setPhone(event.target.value)
                  emitExternal({ phone: event.target.value })
                }}
                className="bbt-input"
                placeholder="Telefone (opcional)"
                aria-label={`Telefone de ${props.label}`}
              />
            </>
          )}
        </div>
      ) : (
        <div
          className="relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
          }}
        >
          <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id={inputId}
            value={query}
            disabled={props.disabled}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpen(true)
                window.requestAnimationFrame(() => {
                  listboxRef.current
                    ?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
                    ?.focus()
                })
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setSelectedProfile(null)
              if (props.value) props.onChange(null)
            }}
            className="bbt-input pl-9 pr-9"
            placeholder="Buscar viajante da empresa"
            autoComplete="off"
            required={props.required}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && !props.disabled}
            aria-controls={listboxId}
            aria-busy={loading || profileLoading}
          />
          {loading || profileLoading ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-bbt-accent" aria-hidden="true" />
          ) : props.value ? (
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                setQuery('')
                setSelectedProfile(null)
                props.onChange(null)
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Limpar ${props.label}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}

          {open && !props.disabled && (
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={`Viajantes para ${props.label}`}
              className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              {items.map((item) => {
                const unavailable = props.excludedEmployeeIds.has(item.id)
                  && props.value?.employee_id !== item.id
                const issues = normalizeAirPassengerProfileIssues(item.profileIssues, item.name)
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={props.value?.employee_id === item.id}
                    disabled={unavailable}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                    className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-cyan-950/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-bbt-primary dark:text-white">{item.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {item.identificationCode}{item.department ? ` · ${item.department}` : ''}{unavailable ? ' · já selecionado' : ''}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      issues.length
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    }`}>
                      {issues.length ? `${issues.length} pendência(s)` : 'Completo'}
                    </span>
                  </button>
                )
              })}
              {!loading && !error && items.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-slate-500">
                  Nenhum viajante ativo encontrado.
                </div>
              )}
              {error && <div role="alert" className="px-3 py-3 text-center text-xs text-red-600">{error}</div>}
              {props.capabilities.canCreate && (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false)
                    setProfileDialog('create')
                  }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 border-t border-slate-100 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 dark:border-slate-700 dark:text-cyan-300 dark:hover:bg-cyan-950/30"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Cadastrar novo viajante
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!external && props.value?.employee_id && selectedIssues.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
          {selectedIssues.map((issue) => (
            <span key={issue} className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {airPassengerProfileIssueMessage(issue)}
            </span>
          ))}
          {editableIssues.length > 0 && props.capabilities.canComplete ? (
            <button
              type="button"
              disabled={props.disabled || profileLoading}
              onClick={() => setProfileDialog('complete')}
              className="rounded px-2 py-0.5 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-40 dark:text-cyan-300 dark:hover:bg-cyan-950/30"
            >
              Completar cadastro
            </button>
          ) : (
            <span className="text-[10px] text-slate-500">Correção disponível para a agência ou administrador.</span>
          )}
        </div>
      )}
      {!external && selectedProfile && selectedIssues.length === 0 && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Cadastro completo
        </div>
      )}

      <TravelerProfileDialog
        open={Boolean(profileDialog)}
        mode={profileDialog || 'create'}
        travelerName={profileDialog === 'complete'
          ? selectedProfile?.name || props.value?.name || ''
          : query.trim()}
        profileIssues={profileDialog === 'complete' ? editableIssues : []}
        onClose={() => setProfileDialog(null)}
        onSubmit={saveTravelerProfile}
      />
    </div>
  )
}

function canEditIssue(
  issue: AirPassengerProfileIssue,
  capabilities: HotelTravelerManagementCapabilities,
): boolean {
  return capabilities.canComplete && (
    capabilities.canCompleteName
    || issue === 'cpf'
    || issue === 'birth_date'
  )
}

function guestFromTraveler(
  traveler: TravelerDirectoryItem,
  slotIndex: number,
  role: HotelDemandGuest['role'],
): HotelDemandGuest {
  return {
    slot_index: slotIndex,
    role,
    employee_id: traveler.id,
    name: traveler.name,
    email: traveler.email || undefined,
    phone: traveler.phone || undefined,
    is_external: false,
  }
}

function mergeTravelerList(
  current: TravelerDirectoryItem[],
  traveler: TravelerDirectoryItem,
): TravelerDirectoryItem[] {
  if (!current.some((item) => item.id === traveler.id)) return [traveler, ...current]
  return current.map((item) => item.id === traveler.id ? traveler : item)
}
