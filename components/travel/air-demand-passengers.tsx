'use client'

import { AlertTriangle, CheckCircle2, Loader2, Plus, Search, Star, Trash2, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import {
  TravelerProfileDialog,
  type TravelerProfileDialogSubmission,
} from '@/components/travel/traveler-profile-dialog'
import {
  airPassengerProfileIssueLabel,
  MAX_AIR_PASSENGERS,
  normalizeAirPassengerProfileIssues,
  normalizeAirPassengers,
  type AirPassengerProfileIssue,
  type AirPassengerSelection,
  type AirPassengerValidationState,
} from '@/lib/air-demand/passenger-selection'
import {
  completeTravelerMissingProfile,
  createTraveler,
  searchTravelers,
} from '@/lib/travelers/client'
import { getCurrentUser } from '@/lib/auth'
import { getTravelerManagementSettings } from '@/lib/travelers/management-settings-client'
import type { TravelerDirectoryItem } from '@/lib/travelers/types'
import { isRequesterUser, userAccessKind } from '@/lib/user-access-kind'

type DirectoryTraveler = TravelerDirectoryItem

type ProfileDialogState =
  | { mode: 'create'; name: string }
  | { mode: 'complete'; traveler: DirectoryTraveler }
  | null

interface AirDemandPassengersProps {
  companyId: string
  value: readonly AirPassengerSelection[]
  onChange: (value: AirPassengerSelection[]) => void
  onValidationChange?: (value: AirPassengerValidationState) => void
  onPrimaryTravelerChange?: (
    passenger: AirPassengerSelection | null,
    profile: TravelerDirectoryItem | null,
  ) => void
  legacyUnlinkedPassengerName?: string
  disabled?: boolean
}

export function AirDemandPassengers({
  companyId,
  value,
  onChange,
  onValidationChange,
  onPrimaryTravelerChange,
  legacyUnlinkedPassengerName = '',
  disabled = false,
}: AirDemandPassengersProps) {
  const { includesCompany } = useCorporateCompanyScope()
  const currentUser = getCurrentUser()
  const requesterUser = isRequesterUser(currentUser)
  const titleId = useId()
  const listboxId = useId()
  const passengers = useMemo(() => normalizeAirPassengers(value), [value])
  const selectedIds = useMemo(() => new Set(passengers.map((item) => item.employee_id)), [passengers])
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<DirectoryTraveler[]>([])
  const [profiles, setProfiles] = useState<Record<string, DirectoryTraveler>>({})
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lookupFailures, setLookupFailures] = useState<Record<string, string>>({})
  const [retryVersion, setRetryVersion] = useState(0)
  const [requesterManagementEnabled, setRequesterManagementEnabled] = useState(false)
  const [profileDialog, setProfileDialog] = useState<ProfileDialogState>(null)
  const attemptedHydration = useRef(new Set<string>())
  const lastPrimaryNotification = useRef('')
  const listboxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setItems([])
    setProfiles({})
    attemptedHydration.current.clear()
    setQuery('')
    setOpen(false)
    setError('')
    setLookupFailures({})
    setRetryVersion(0)
    lastPrimaryNotification.current = ''
    setRequesterManagementEnabled(false)
    setProfileDialog(null)
  }, [companyId])

  const canManageInAgencyFlow = Boolean(companyId)
    && currentUser !== null
    && userAccessKind(currentUser) === 'internal'
    && includesCompany(companyId, 'criar_demandas')
  const canCreateByPermission = Boolean(companyId) && (
    includesCompany(companyId, 'cadastrar_funcionarios')
    || includesCompany(companyId, 'gerenciar_funcionarios')
    || canManageInAgencyFlow
  )
  const canCompleteByPermission = Boolean(companyId)
    && (
      includesCompany(companyId, 'gerenciar_funcionarios')
      || canManageInAgencyFlow
    )
  const canCreateTraveler = canCreateByPermission || requesterManagementEnabled
  const canCompleteTraveler = canCompleteByPermission || requesterManagementEnabled

  function canEditProfileIssue(issue: AirPassengerProfileIssue): boolean {
    return canCompleteTraveler && (
      canCompleteByPermission
      || issue === 'cpf'
      || issue === 'birth_date'
    )
  }

  useEffect(() => {
    if (
      !companyId
      || !requesterUser
      || (canCreateByPermission && canCompleteByPermission)
    ) {
      setRequesterManagementEnabled(false)
      return
    }
    const controller = new AbortController()
    void getTravelerManagementSettings('company', companyId, controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) {
          setRequesterManagementEnabled(
            configuration.effective.allowRequesterTravelerManagement,
          )
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRequesterManagementEnabled(false)
      })
    return () => controller.abort()
  }, [canCompleteByPermission, canCreateByPermission, companyId, requesterUser])

  useEffect(() => {
    if (!open || !companyId || disabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void searchTravelers(
        { companyId, q: query.trim() || undefined, limit: 20 },
        controller.signal,
      )
        .then((result) => {
          const travelers = result as DirectoryTraveler[]
          setItems(travelers)
          setProfiles((current) => mergeProfiles(current, travelers))
        })
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
  }, [companyId, disabled, open, query])

  useEffect(() => {
    if (!companyId) return
    const hydrationAttempts = attemptedHydration.current
    const missing = passengers.filter((passenger) => (
      !profiles[passenger.employee_id]
      && !hydrationAttempts.has(passenger.employee_id)
    ))
    if (!missing.length) return
    const controller = new AbortController()
    let settled = false
    missing.forEach((passenger) => hydrationAttempts.add(passenger.employee_id))
    const requestedIds = missing.map((passenger) => passenger.employee_id)
    void searchTravelers({
      companyId,
      ids: requestedIds,
      limit: requestedIds.length,
    }, controller.signal)
      .then((matches) => {
        const travelers = matches as DirectoryTraveler[]
        const returnedIds = new Set(travelers.map((item) => item.id))
        setProfiles((current) => mergeProfiles(current, travelers))
        setLookupFailures((current) => {
          const next = { ...current }
          requestedIds.forEach((employeeId) => {
            if (returnedIds.has(employeeId)) delete next[employeeId]
            else next[employeeId] = 'Viajante inativo, removido ou fora da empresa selecionada.'
          })
          return next
        })
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        const message = cause instanceof Error
          ? cause.message
          : 'Não foi possível validar este viajante agora.'
        setLookupFailures((current) => ({
          ...current,
          ...Object.fromEntries(requestedIds.map((employeeId) => [employeeId, message])),
        }))
      })
      .finally(() => { settled = true })
    return () => {
      controller.abort()
      if (!settled) requestedIds.forEach((employeeId) => hydrationAttempts.delete(employeeId))
    }
  }, [companyId, passengers, profiles, retryVersion])

  const validation = useMemo<AirPassengerValidationState>(() => {
    const blockingIssues = passengers.flatMap((passenger) => {
      const profile = profiles[passenger.employee_id]
      const issues = normalizeAirPassengerProfileIssues(profile?.profileIssues, passenger.name || profile?.name || '')
      return issues.length ? [{
        employeeId: passenger.employee_id,
        name: passenger.name || profile?.name || passenger.employee_id,
        issues,
      }] : []
    })
    return {
      passengerCount: passengers.length,
      blockingIssues,
      pendingVerificationIds: passengers
        .filter((passenger) => (
          !hasProfileValidation(profiles[passenger.employee_id])
          && !lookupFailures[passenger.employee_id]
        ))
        .map((passenger) => passenger.employee_id),
      lookupErrors: passengers.flatMap((passenger) => {
        const message = lookupFailures[passenger.employee_id]
        return message ? [{
          employeeId: passenger.employee_id,
          name: passenger.name || passenger.employee_id,
          message,
        }] : []
      }),
    }
  }, [lookupFailures, passengers, profiles])
  const hasEditableBlockingIssue = validation.blockingIssues.some((entry) => (
    entry.issues.some((issue) => canEditProfileIssue(issue))
  ))
  const hasRestrictedBlockingIssue = validation.blockingIssues.some((entry) => (
    entry.issues.some((issue) => !canEditProfileIssue(issue))
  ))

  useEffect(() => {
    onValidationChange?.(validation)
  }, [onValidationChange, validation])

  useEffect(() => {
    const primary = passengers[0] || null
    const primaryProfile = primary ? profiles[primary.employee_id] || null : null
    const signature = [
      companyId,
      primary?.employee_id || '',
      primary?.name || '',
      primaryProfile ? 'loaded' : 'pending',
      primaryProfile?.costCenterId || '',
      primaryProfile?.costCenter || '',
    ].join('|')
    if (signature === lastPrimaryNotification.current) return
    lastPrimaryNotification.current = signature
    onPrimaryTravelerChange?.(primary, primaryProfile)
  }, [companyId, onPrimaryTravelerChange, passengers, profiles])

  function addPassenger(item: DirectoryTraveler) {
    if (disabled || selectedIds.has(item.id) || passengers.length >= MAX_AIR_PASSENGERS) return
    setProfiles((current) => ({ ...current, [item.id]: item }))
    onChange([...passengers, { employee_id: item.id, name: item.name }])
    setQuery('')
    setOpen(false)
  }

  function removePassenger(employeeId: string) {
    if (disabled) return
    onChange(passengers.filter((passenger) => passenger.employee_id !== employeeId))
  }

  function makePrimary(employeeId: string) {
    if (disabled || passengers[0]?.employee_id === employeeId) return
    const selected = passengers.find((passenger) => passenger.employee_id === employeeId)
    if (!selected) return
    onChange([selected, ...passengers.filter((passenger) => passenger.employee_id !== employeeId)])
  }

  function retryPassengerValidation() {
    const failedIds = passengers
      .map((passenger) => passenger.employee_id)
      .filter((employeeId) => Boolean(lookupFailures[employeeId]))
    failedIds.forEach((employeeId) => attemptedHydration.current.delete(employeeId))
    setLookupFailures((current) => Object.fromEntries(
      Object.entries(current).filter(([employeeId]) => !failedIds.includes(employeeId)),
    ))
    setRetryVersion((current) => current + 1)
  }

  async function saveTravelerProfile(value: TravelerProfileDialogSubmission) {
    if (!companyId || !profileDialog) return
    if (profileDialog.mode === 'create') {
      const created = await createTraveler({
        companyId,
        name: value.name || profileDialog.name,
        cpf: value.cpf || '',
        birthDate: value.birthDate || '',
        email: value.email,
        phone: value.phone,
      })
      setItems((current) => mergeTravelerList(current, created))
      setProfiles((current) => ({ ...current, [created.id]: created }))
      addPassenger(created)
      return
    }

    const updated = await completeTravelerMissingProfile(
      profileDialog.traveler.id,
      {
        ...(canCompleteByPermission && value.name ? { name: value.name } : {}),
        ...(value.cpf ? { cpf: value.cpf } : {}),
        ...(value.birthDate ? { birthDate: value.birthDate } : {}),
      },
    )
    attemptedHydration.current.add(updated.id)
    setItems((current) => mergeTravelerList(current, updated))
    setProfiles((current) => ({ ...current, [updated.id]: updated }))
    setLookupFailures((current) => {
      const next = { ...current }
      delete next[updated.id]
      return next
    })
    if (updated.name !== profileDialog.traveler.name) {
      onChange(passengers.map((passenger) => (
        passenger.employee_id === updated.id
          ? { ...passenger, name: updated.name }
          : passenger
      )))
    }
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-bbt-gray-100 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/30"
      aria-labelledby={titleId}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="rounded-lg bg-bbt-accent/10 p-2 text-bbt-accent dark:bg-bbt-accent/15">
            <UsersRound className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h4 id={titleId} className="font-semibold text-bbt-primary dark:text-white">
              Passageiros
            </h4>
            <p className="text-xs text-slate-500">
              Selecione viajantes ativos da empresa. O primeiro será o passageiro principal da demanda.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
          {passengers.length}/{MAX_AIR_PASSENGERS}
        </span>
      </header>

      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          value={query}
          disabled={disabled || !companyId || passengers.length >= MAX_AIR_PASSENGERS}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              return
            }
            if (event.key === 'ArrowDown') {
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
          }}
          className="bbt-input pl-9 pr-9"
          placeholder={companyId ? 'Buscar por nome, matrícula, código ou e-mail' : 'Selecione primeiro a empresa'}
          aria-label="Buscar viajante para a demanda aérea"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(companyId) && !disabled}
          aria-controls={listboxId}
          aria-busy={loading}
          autoComplete="off"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-bbt-accent" aria-hidden="true" />}

        {open && companyId && !disabled && (
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Viajantes encontrados"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {items.map((item) => {
              const selected = selectedIds.has(item.id)
              const issues = normalizeAirPassengerProfileIssues(item.profileIssues, item.name)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addPassenger(item)}
                  className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-bbt-accent/10 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-bbt-accent/15"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-bbt-primary dark:text-white">{item.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[item.identificationCode, item.department].filter(Boolean).join(' · ') || item.email || 'Viajante ativo'}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    selected
                      ? 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                      : issues.length
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  }`}>
                    {selected ? 'Já adicionado' : issues.length ? `${issues.length} pendência(s)` : 'Cadastro completo'}
                  </span>
                </button>
              )
            })}
            {!loading && !error && items.length === 0 && (
              <div className="space-y-3 px-3 py-5 text-center text-xs text-slate-500">
                <p>Nenhum viajante ativo encontrado.</p>
                {canCreateTraveler && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setOpen(false)
                      setProfileDialog({ mode: 'create', name: query.trim() })
                    }}
                    className="bbt-button-outline mx-auto h-8 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Cadastrar novo viajante
                  </button>
                )}
              </div>
            )}
            {error && <div role="alert" className="px-3 py-4 text-center text-xs text-red-600">{error}</div>}
          </div>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {loading
            ? 'Buscando viajantes.'
            : open && companyId
              ? `${items.length} viajante(s) encontrado(s).`
              : ''}
        </span>
      </div>

      {passengers.length === 0 && legacyUnlinkedPassengerName ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <strong>Passageiro legado: {legacyUnlinkedPassengerName}</strong>
          <p className="mt-1 text-xs">
            Este pedido antigo não possui vínculo com a base de viajantes. O nome será preservado nesta edição; selecione um viajante acima para atualizar o vínculo.
          </p>
        </div>
      ) : passengers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-5 text-center text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          Adicione ao menos um passageiro para enviar a solicitação aérea.
        </div>
      ) : (
        <div className="space-y-2" aria-label="Passageiros selecionados">
          {passengers.map((passenger, index) => {
            const profile = profiles[passenger.employee_id]
            const name = passenger.name || profile?.name || passenger.employee_id
            const discriminator = [
              profile?.identificationCode || profile?.registrationCode,
              profile?.department,
            ].filter(Boolean).join(' · ')
            const issues = normalizeAirPassengerProfileIssues(profile?.profileIssues, name)
            const actionableIssues = issues.filter(canEditProfileIssue)
            const verified = hasProfileValidation(profile)
            const lookupFailure = lookupFailures[passenger.employee_id]
            return (
              <article key={passenger.employee_id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-sm text-bbt-primary dark:text-white">{name}</strong>
                        {index === 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                            <Star className="h-3 w-3" aria-hidden="true" /> Principal
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        Passageiro {index + 1}{discriminator ? ` · ${discriminator}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {verified && issues.length === 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Cadastro apto para emissão
                          </span>
                        )}
                        {issues.map((issue) => (
                          <span key={issue} className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Falta {airPassengerProfileIssueLabel(issue)}
                          </span>
                        ))}
                        {lookupFailure ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-300">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {lookupFailure}
                          </span>
                        ) : !verified && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Conferindo CPF e data de nascimento…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {actionableIssues.length > 0 && canCompleteTraveler && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Completar cadastro de ${name}`}
                        onClick={() => setProfileDialog({
                          mode: 'complete',
                          traveler: profile || {
                            id: passenger.employee_id,
                            companyId,
                            identificationCode: '',
                            name,
                            email: null,
                            phone: null,
                            jobTitle: null,
                            department: null,
                            costCenterId: null,
                            costCenter: null,
                            registrationCode: null,
                            profileIssues: actionableIssues,
                          },
                        })}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-bbt-accent hover:bg-bbt-accent/10 disabled:opacity-40 dark:hover:bg-bbt-accent/15"
                      >
                        Completar cadastro
                      </button>
                    )}
                    {index > 0 && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Tornar ${name} o passageiro principal`}
                        onClick={() => makePrimary(passenger.employee_id)}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                      >
                        Tornar principal
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removePassenger(passenger.employee_id)}
                      className="rounded-md p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/30"
                      aria-label={`Remover ${name}`}
                      title={`Remover ${name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {validation.blockingIssues.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          {hasEditableBlockingIssue ? (
            <p>Complete os dados disponíveis nos passageiros destacados antes de enviar.</p>
          ) : (
            <p>O cadastro possui dados que você não pode alterar. Solicite a correção à agência ou ao administrador da empresa.</p>
          )}
          {hasRestrictedBlockingIssue && hasEditableBlockingIssue && (
            <p className="mt-1">Pendências de primeiro ou último nome precisam ser corrigidas pela agência ou por um administrador.</p>
          )}
          <p className="mt-1">Dados obrigatórios: CPF, data de nascimento, primeiro e último nome.</p>
        </div>
      )}
      {validation.lookupErrors.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
          <span>Não foi possível validar todos os passageiros selecionados.</span>
          <button type="button" onClick={retryPassengerValidation} disabled={disabled} className="font-semibold underline disabled:opacity-50">
            Tentar novamente
          </button>
        </div>
      )}

      <TravelerProfileDialog
        open={Boolean(profileDialog)}
        mode={profileDialog?.mode || 'create'}
        travelerName={profileDialog?.mode === 'complete'
          ? profileDialog.traveler.name
          : profileDialog?.name || query.trim()}
        profileIssues={profileDialog?.mode === 'complete'
          ? normalizeAirPassengerProfileIssues(
              profileDialog.traveler.profileIssues,
              profileDialog.traveler.name,
            ).filter(canEditProfileIssue)
          : []}
        onClose={() => setProfileDialog(null)}
        onSubmit={saveTravelerProfile}
      />
    </section>
  )
}

function mergeTravelerList(
  current: DirectoryTraveler[],
  traveler: DirectoryTraveler,
): DirectoryTraveler[] {
  if (!current.some((item) => item.id === traveler.id)) return [traveler, ...current]
  return current.map((item) => item.id === traveler.id ? traveler : item)
}

function hasProfileValidation(profile: DirectoryTraveler | undefined): boolean {
  return Boolean(profile && Object.prototype.hasOwnProperty.call(profile, 'profileIssues'))
}

function mergeProfiles(
  current: Record<string, DirectoryTraveler>,
  travelers: readonly DirectoryTraveler[],
): Record<string, DirectoryTraveler> {
  if (!travelers.length) return current
  const next = { ...current }
  travelers.forEach((traveler) => { next[traveler.id] = traveler })
  return next
}

export default AirDemandPassengers
