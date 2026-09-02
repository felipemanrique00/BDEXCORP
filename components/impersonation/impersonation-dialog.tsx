'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Clock3,
  Eye,
  KeyRound,
  Loader2,
  Search,
  ShieldAlert,
  UserRoundCog,
  X,
} from 'lucide-react'

import {
  ImpersonationClientError,
  listImpersonationTargets,
  type ImpersonationMode,
  type ImpersonationTarget,
  type StartImpersonationInput,
} from '@/lib/impersonation-client'

interface ImpersonationDialogProps {
  open: boolean
  presetTarget: ImpersonationTarget | null
  mfaRequired: boolean
  onClose: () => void
  onStart: (input: StartImpersonationInput) => Promise<void>
  onConfirmMfa: (code: string) => Promise<void>
  onMfaRequired: () => void
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ImpersonationDialog({
  open,
  presetTarget,
  mfaRequired,
  onClose,
  onStart,
  onConfirmMfa,
  onMfaRequired,
}: ImpersonationDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const listboxId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const mfaCodeRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<ImpersonationTarget[]>([])
  const [selectedTarget, setSelectedTarget] = useState<ImpersonationTarget | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [mode, setMode] = useState<ImpersonationMode>('test')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [confirmingMfa, setConfirmingMfa] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const selectedCompanyScope = selectedTarget?.companyScopes.find((scope) => scope.companyId === selectedCompanyId) || null
  const operateAvailable = Boolean(selectedCompanyScope?.allowedActions.length)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery(presetTarget?.name || '')
    setSelectedTarget(null)
    setSelectedCompanyId('')
    setTargets([])
    setActiveIndex(0)
    setSearchError('')
    setSubmitError('')
    setMfaCode('')
    setMfaError('')
    setConfirmingMfa(false)
    setMode('test')
    setReason('')
    setReference('')
    setConfirmed(false)
    setSubmitting(false)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const initialFocus = mfaCodeRef.current || searchRef.current
      initialFocus?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open, presetTarget])

  useEffect(() => {
    if (!open || mfaRequired) {
      setTargets([])
      setSearching(false)
      return
    }
    const cleanQuery = query.trim()
    if (!cleanQuery) {
      setTargets([])
      setSearching(false)
      setSearchError('')
      return
    }
    if (cleanQuery.length < 2) {
      setTargets([])
      setSearching(false)
      setSearchError('')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      setSearchError('')
      listImpersonationTargets(query, { limit: 20, signal: controller.signal })
        .then((result) => {
          setTargets(result.items)
          setActiveIndex(0)
          const authoritativePreset = presetTarget
            ? result.items.find((target) => target.membershipId === presetTarget.membershipId) || null
            : null
          if (presetTarget) {
            setSelectedTarget(authoritativePreset)
            setSelectedCompanyId(authoritativePreset ? defaultCompanyId(authoritativePreset) : '')
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setTargets([])
          if (error instanceof ImpersonationClientError && error.code === 'IMPERSONATION_MFA_REQUIRED') {
            setSearchError('')
            onMfaRequired()
            return
          }
          setSearchError(error instanceof Error ? error.message : 'Falha ao buscar usuários.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mfaRequired, onMfaRequired, open, presetTarget, query])

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => {
      if (mfaRequired) mfaCodeRef.current?.focus()
      else searchRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [mfaRequired, open])

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !submitting && !confirmingMfa) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!targets.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((value) => (value + 1) % targets.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((value) => (value - 1 + targets.length) % targets.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      chooseTarget(targets[activeIndex])
    }
  }

  function chooseTarget(target: ImpersonationTarget) {
    setSelectedTarget(target)
    const companyId = defaultCompanyId(target)
    setSelectedCompanyId(companyId)
    setQuery(target.name)
    const companyScope = target.companyScopes.find((scope) => scope.companyId === companyId)
    if (!companyScope?.allowedActions.length) setMode('test')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitError('')
    const cleanReason = reason.trim()
    const cleanReference = reference.trim()
    if (!selectedTarget) {
      setSubmitError('Selecione o usuário que será acessado.')
      searchRef.current?.focus()
      return
    }
    if (!selectedCompanyScope) {
      setSubmitError('Selecione a empresa deste atendimento.')
      return
    }
    if (cleanReason.length < 10) {
      setSubmitError('Informe um motivo com pelo menos 10 caracteres.')
      reasonRef.current?.focus()
      return
    }
    if (mode === 'operate' && !cleanReference) {
      setSubmitError('Informe o chamado ou a referência para o modo operação.')
      return
    }
    if (mode === 'operate' && !selectedCompanyScope.allowedActions.length) {
      setSubmitError('Este usuário não possui ações operacionais disponíveis na empresa selecionada.')
      return
    }
    if (!confirmed) {
      setSubmitError('Confirme que você compreende o escopo e o registro de auditoria.')
      return
    }
    setSubmitting(true)
    try {
      await onStart({
        targetMembershipId: selectedTarget.membershipId,
        companyId: selectedCompanyScope.companyId,
        mode,
        reason: cleanReason,
        ...(cleanReference ? { reference: cleanReference } : {}),
      })
    } catch (error) {
      if (error instanceof ImpersonationClientError && error.code === 'IMPERSONATION_MFA_REQUIRED') {
        setSubmitError('')
        onMfaRequired()
        setSubmitting(false)
        return
      }
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível iniciar o acesso assistido.')
      setSubmitting(false)
    }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault()
    const code = mfaCode.trim()
    setMfaError('')
    if (code.length < 6) {
      setMfaError('Informe o código do autenticador ou um código de recuperação.')
      mfaCodeRef.current?.focus()
      return
    }
    setConfirmingMfa(true)
    try {
      await onConfirmMfa(code)
      setMfaCode('')
      setMfaError('')
      setSubmitError('')
      setConfirmingMfa(false)
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : 'Não foi possível confirmar o MFA.')
      setConfirmingMfa(false)
      mfaCodeRef.current?.focus()
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting && !confirmingMfa) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleDialogKeyDown}
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <UserRoundCog className="h-5 w-5 text-bbt-accent" aria-hidden="true" />
              <h2 id={titleId} className="text-lg font-bold text-bbt-primary dark:text-white">Acessar como usuário</h2>
            </div>
            <p id={descriptionId} className="mt-1 text-sm text-slate-500">
              Acesso assistido temporário, limitado a 15 minutos e registrado na auditoria.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || confirmingMfa}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-bbt-accent dark:hover:bg-slate-800"
            aria-label="Fechar acesso assistido"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={mfaRequired ? submitMfa : submit} className="space-y-5 px-5 py-5 sm:px-6">
          {mfaRequired && (
            <section className="space-y-4" aria-labelledby={`${titleId}-mfa`}>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <div>
                    <h3 id={`${titleId}-mfa`} className="font-bold">Confirme o MFA para continuar</h3>
                    <p className="mt-1 text-xs leading-relaxed">
                      Por segurança, a personificação exige uma confirmação feita nos últimos 15 minutos. O acesso continuará visível quando esse prazo terminar.
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <label htmlFor={`${titleId}-mfa-code`} className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Código do autenticador ou de recuperação
                </label>
                <input
                  ref={mfaCodeRef}
                  id={`${titleId}-mfa-code`}
                  value={mfaCode}
                  onChange={(event) => {
                    setMfaCode(event.target.value.slice(0, 32))
                    setMfaError('')
                  }}
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={32}
                  required
                  disabled={confirmingMfa}
                  className="bbt-input mt-2 h-11"
                  placeholder="000000"
                />
              </div>
              {mfaError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
                  {mfaError}
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:justify-end">
                <button type="button" onClick={onClose} disabled={confirmingMfa} className="bbt-button-ghost min-h-11">Cancelar</button>
                <button type="submit" disabled={confirmingMfa || mfaCode.trim().length < 6} className="bbt-button-primary min-h-11">
                  {confirmingMfa ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {confirmingMfa ? 'Confirmando...' : 'Confirmar MFA'}
                </button>
              </div>
            </section>
          )}

          <fieldset disabled={mfaRequired} className={mfaRequired ? 'hidden' : 'contents'}>
          <section aria-labelledby={`${titleId}-target`}>
            <label id={`${titleId}-target`} htmlFor={`${titleId}-search`} className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Usuário da empresa
            </label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                ref={searchRef}
                id={`${titleId}-search`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={targets.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={targets[activeIndex] ? `${listboxId}-${targets[activeIndex].membershipId}` : undefined}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSelectedTarget(null)
                  setSelectedCompanyId('')
                  setMode('test')
                }}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                placeholder="Buscar por nome ou e-mail..."
                className="bbt-input h-11 pl-10 pr-10"
              />
              {searching && <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-bbt-accent" aria-label="Buscando usuários" />}
            </div>
            <div id={listboxId} role="listbox" aria-label="Usuários disponíveis" className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
              {searchError ? (
                <p className="p-3 text-sm text-red-600" role="alert">{searchError}</p>
              ) : !searching && targets.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">
                  {query.trim().length < 2 ? 'Digite ao menos 2 caracteres para buscar.' : 'Nenhum usuário elegível encontrado.'}
                </p>
              ) : targets.map((target, index) => {
                const selected = selectedTarget?.membershipId === target.membershipId
                return (
                  <button
                    id={`${listboxId}-${target.membershipId}`}
                    key={target.membershipId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseTarget(target)}
                    className={`flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 dark:border-slate-800 ${selected ? 'bg-cyan-50 dark:bg-cyan-950/30' : index === activeIndex ? 'bg-slate-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bbt-primary text-xs font-bold text-white">
                      {initials(target.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-bbt-primary dark:text-white">{target.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {target.email}{target.email ? ` · ${roleText(target.corporateProfile || target.roleKey)}` : roleText(target.corporateProfile || target.roleKey)}
                      </span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-cyan-600" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </section>

          {selectedTarget && (
            <div>
              <label htmlFor={`${titleId}-company`} className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Empresa do atendimento *
              </label>
              <select
                id={`${titleId}-company`}
                value={selectedCompanyId}
                onChange={(event) => {
                  const companyId = event.target.value
                  setSelectedCompanyId(companyId)
                  const scope = selectedTarget.companyScopes.find((item) => item.companyId === companyId)
                  if (!scope?.allowedActions.length) setMode('test')
                  setSubmitError('')
                }}
                required
                className="bbt-input mt-2 h-11"
              >
                <option value="">Selecione a empresa</option>
                {selectedTarget.companyScopes.map((scope) => (
                  <option key={scope.companyId} value={scope.companyId}>{scope.label}</option>
                ))}
              </select>
              {selectedTarget.companyScopes.length > 1 && !selectedCompanyScope && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Escolha a empresa para limitar este acesso antes de continuar.</p>
              )}
            </div>
          )}

          <fieldset>
            <legend className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Modo de acesso</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <ModeOption
                selected={mode === 'test'}
                title="Teste (somente leitura)"
                description="Veja o ambiente e valide permissões sem alterar dados."
                icon={<Eye className="h-5 w-5" />}
                onSelect={() => setMode('test')}
              />
              <ModeOption
                selected={mode === 'operate'}
                title="Operação assistida"
                description={!selectedCompanyScope
                  ? 'Selecione a empresa do atendimento para verificar as ações disponíveis.'
                  : operateAvailable
                    ? 'Execute ações permitidas ao usuário, com auditoria reforçada.'
                    : 'Este usuário não possui ações operacionais disponíveis nesta empresa.'}
                icon={<ShieldAlert className="h-5 w-5" />}
                onSelect={() => setMode('operate')}
                disabled={!operateAvailable}
              />
            </div>
          </fieldset>

          {selectedCompanyScope && operateAvailable && (
            <p className="text-xs text-slate-500" aria-live="polite">
              Ações disponíveis em {selectedCompanyScope.label}: {selectedCompanyScope.allowedActions.map(actionLabel).join(', ')}.
            </p>
          )}

          <div>
            <label htmlFor={`${titleId}-reason`} className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Motivo *</label>
            <textarea
              ref={reasonRef}
              id={`${titleId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, 500))}
              minLength={10}
              maxLength={500}
              rows={3}
              required
              placeholder="Ex.: apoiar o solicitante no pedido recebido por telefone"
              className="bbt-input mt-2 min-h-24 resize-y py-3"
            />
            <div className="mt-1 text-right text-[11px] text-slate-400">{reason.length}/500</div>
          </div>

          <div>
            <label htmlFor={`${titleId}-reference`} className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Chamado ou referência {mode === 'operate' ? '*' : '(opcional)'}
            </label>
            <input
              id={`${titleId}-reference`}
              value={reference}
              onChange={(event) => setReference(event.target.value.slice(0, 160))}
              maxLength={160}
              required={mode === 'operate'}
              placeholder="Ex.: atendimento #8452"
              className="bbt-input mt-2 h-11"
            />
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100">
            <Clock3 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <div><strong>Duração fixa: 15 minutos.</strong> O acesso será encerrado automaticamente.</div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-cyan-600"
            />
            <span>Confirmo que tenho autorização para este atendimento na empresa selecionada e que todas as ações serão atribuídas ao agente e ao usuário representado.</span>
          </label>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
              {submitError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={submitting} className="bbt-button-ghost min-h-11">Cancelar</button>
            <button type="submit" disabled={submitting || !selectedTarget || !selectedCompanyScope || (mode === 'operate' && !operateAvailable)} className="bbt-button-primary min-h-11">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCog className="h-4 w-4" />}
              {submitting ? 'Iniciando...' : mode === 'test' ? 'Iniciar teste' : 'Iniciar operação'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function ModeOption({
  selected,
  title,
  description,
  icon,
  onSelect,
  disabled = false,
}: {
  selected: boolean
  title: string
  description: string
  icon: React.ReactNode
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <label className={`flex min-h-24 gap-3 rounded-lg border-2 p-3 focus-within:ring-2 focus-within:ring-cyan-500 ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'} ${selected ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
      <input type="radio" name="impersonation-mode" checked={selected} onChange={onSelect} disabled={disabled} className="sr-only" />
      <span className={selected ? 'text-cyan-600' : 'text-slate-500'}>{icon}</span>
      <span>
        <span className="block text-sm font-bold text-bbt-primary dark:text-white">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{description}</span>
      </span>
    </label>
  )
}

function defaultCompanyId(target: ImpersonationTarget): string {
  return target.companyScopes.length === 1 ? target.companyScopes[0].companyId : ''
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function roleText(roleKey: string): string {
  const labels: Record<string, string> = {
    owner: 'Proprietário do grupo',
    ceo: 'CEO / Diretoria',
    group_admin: 'Administrador do grupo',
    executive_assistant: 'Secretaria executiva',
    group_finance: 'Financeiro do grupo',
    manager: 'Gestor',
    viewer: 'Visualizador',
    company_admin: 'Administrador da empresa',
    requester: 'Solicitante',
    approver: 'Autorizador',
    traveler: 'Viajante',
  }
  return labels[roleKey] || roleKey || 'Perfil corporativo'
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    'demand.create': 'criar pedidos',
    'demand.correct': 'corrigir pedidos devolvidos',
    'quote.select': 'escolher cotações',
    'approval.decide': 'decidir aprovações',
  }
  return labels[action] || action
}
