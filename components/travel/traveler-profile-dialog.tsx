'use client'

import { AlertTriangle, Loader2, ShieldCheck, UserRoundPlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DateInput } from '@/components/ui/date-input'
import { Modal } from '@/components/ui/modal'
import { todayISODate } from '@/lib/date'
import { normalizarCPF, normalizarTelefone } from '@/lib/normalizers'
import { assessAirTravelerProfile, type AirTravelerProfileIssue } from '@/lib/travelers/air-profile'
import { maskCPF, maskPhone, onlyDigits } from '@/lib/utils'

export interface TravelerProfileDialogSubmission {
  name?: string
  cpf?: string
  birthDate?: string
  email?: string
  phone?: string
}

interface TravelerProfileDialogProps {
  open: boolean
  mode: 'create' | 'complete'
  travelerName?: string
  profileIssues?: readonly AirTravelerProfileIssue[]
  onClose: () => void
  onSubmit: (value: TravelerProfileDialogSubmission) => Promise<void>
}

interface FormErrors {
  name?: string
  cpf?: string
  birthDate?: string
  email?: string
  phone?: string
  form?: string
}

const VALID_TEST_CPF = '52998224725'
const VALID_TEST_BIRTH_DATE = '1990-01-01'
const VALID_TEST_NAME = 'Viajante Teste'

export function TravelerProfileDialog({
  open,
  mode,
  travelerName = '',
  profileIssues = [],
  onClose,
  onSubmit,
}: TravelerProfileDialogProps) {
  const [name, setName] = useState(travelerName)
  const [cpf, setCpf] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)
  const issueSet = useMemo(() => new Set(profileIssues), [profileIssues])
  const asksName = mode === 'create' || issueSet.has('first_name') || issueSet.has('last_name')
  const asksCpf = mode === 'create' || issueSet.has('cpf')
  const asksBirthDate = mode === 'create' || issueSet.has('birth_date')

  useEffect(() => {
    if (!open) return
    setName(travelerName)
    setCpf('')
    setBirthDate('')
    setEmail('')
    setPhone('')
    setErrors({})
    setSaving(false)
  }, [open, travelerName])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // This dialog is rendered inside the demand forms. Keep its submit from
    // bubbling into the parent form while the traveler mutation is running.
    event.stopPropagation()
    if (saving) return
    const nextErrors = validateDraft({
      mode,
      asksName,
      asksCpf,
      asksBirthDate,
      name,
      cpf,
      birthDate,
      email,
      phone,
    })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      window.requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus()
      })
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        ...(asksName ? { name: name.trim().replace(/\s+/g, ' ') } : {}),
        ...(asksCpf ? { cpf: normalizarCPF(cpf) } : {}),
        ...(asksBirthDate ? { birthDate } : {}),
        ...(mode === 'create' && email.trim() ? { email: email.trim().toLowerCase() } : {}),
        ...(mode === 'create' && phone.trim() ? { phone: normalizarTelefone(phone) } : {}),
      })
      onClose()
    } catch (cause) {
      setErrors({
        form: cause instanceof Error ? cause.message : 'Não foi possível salvar o viajante.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose() }}
      title={mode === 'create' ? 'Cadastrar viajante' : 'Completar cadastro do viajante'}
      size="md"
    >
      <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate aria-busy={saving}>
        <div className="flex items-start gap-3 rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100">
          {mode === 'create'
            ? <UserRoundPlus className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
          <div>
            <strong>{mode === 'create' ? 'Cadastro mínimo para viagens' : 'Dados obrigatórios do viajante'}</strong>
            <p className="mt-1 text-xs leading-5 opacity-80">
              {mode === 'create'
                ? 'A empresa fica travada no contexto da solicitação. CPF e nascimento não aparecem na lista de busca.'
                : 'Somente as informações ausentes ou inválidas podem ser corrigidas por este formulário.'}
            </p>
          </div>
        </div>

        {asksName && (
          <Field htmlFor="traveler-profile-name" label="Nome completo *" error={errors.name}>
            <input
              id="traveler-profile-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                clearError(setErrors, 'name')
              }}
              className="bbt-input"
              autoComplete="name"
              maxLength={240}
              placeholder="Primeiro nome e sobrenome"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'traveler-profile-name-error' : undefined}
              autoFocus
              disabled={saving}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {asksCpf && (
            <Field htmlFor="traveler-profile-cpf" label="CPF *" error={errors.cpf}>
              <input
                id="traveler-profile-cpf"
                value={maskCPF(onlyDigits(cpf).slice(0, 11))}
                onChange={(event) => {
                  setCpf(onlyDigits(event.target.value).slice(0, 11))
                  clearError(setErrors, 'cpf')
                }}
                className="bbt-input tabular-nums"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                aria-invalid={Boolean(errors.cpf)}
                aria-describedby={errors.cpf ? 'traveler-profile-cpf-error' : undefined}
                autoFocus={!asksName}
                disabled={saving}
              />
            </Field>
          )}
          {asksBirthDate && (
            <Field htmlFor="traveler-profile-birth-date" label="Data de nascimento *" error={errors.birthDate}>
              <DateInput
                id="traveler-profile-birth-date"
                value={birthDate}
                onChange={(event) => {
                  setBirthDate(event.target.value)
                  clearError(setErrors, 'birthDate')
                }}
                max={todayISODate()}
                aria-invalid={Boolean(errors.birthDate)}
                aria-describedby={errors.birthDate ? 'traveler-profile-birth-date-error' : undefined}
                autoFocus={!asksName && !asksCpf}
                disabled={saving}
              />
            </Field>
          )}
        </div>

        {mode === 'create' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor="traveler-profile-email" label="E-mail" error={errors.email}>
              <input
                id="traveler-profile-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearError(setErrors, 'email')
                }}
                className="bbt-input"
                autoComplete="email"
                maxLength={254}
                placeholder="viajante@empresa.com.br"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'traveler-profile-email-error' : undefined}
                disabled={saving}
              />
            </Field>
            <Field htmlFor="traveler-profile-phone" label="Telefone" error={errors.phone}>
              <input
                id="traveler-profile-phone"
                value={phone ? maskPhone(phone) : ''}
                onChange={(event) => {
                  setPhone(onlyDigits(event.target.value).slice(0, 11))
                  clearError(setErrors, 'phone')
                }}
                className="bbt-input tabular-nums"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(00) 00000-0000"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'traveler-profile-phone-error' : undefined}
                disabled={saving}
              />
            </Field>
          </div>
        )}

        {errors.form && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
            {errors.form}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Dados pessoais protegidos pelo escopo da empresa
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="bbt-button-outline">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="bbt-button-primary min-w-28">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? 'Salvando...' : mode === 'create' ? 'Cadastrar viajante' : 'Salvar dados'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function Field({ htmlFor, label, error, children }: {
  htmlFor: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</label>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-300">
          {error}
        </span>
      )}
    </div>
  )
}

function clearError(
  setErrors: React.Dispatch<React.SetStateAction<FormErrors>>,
  field: Exclude<keyof FormErrors, 'form'>,
) {
  setErrors((current) => {
    if (!current[field] && !current.form) return current
    return { ...current, [field]: undefined, form: undefined }
  })
}

function validateDraft(input: {
  mode: 'create' | 'complete'
  asksName: boolean
  asksCpf: boolean
  asksBirthDate: boolean
  name: string
  cpf: string
  birthDate: string
  email: string
  phone: string
}): FormErrors {
  const errors: FormErrors = {}
  if (input.asksName) {
    const nameAssessment = assessAirTravelerProfile({
      name: input.name,
      documentNumber: VALID_TEST_CPF,
      birthDate: VALID_TEST_BIRTH_DATE,
    })
    if (nameAssessment.profileIssues.includes('first_name') || nameAssessment.profileIssues.includes('last_name')) {
      errors.name = 'Informe o primeiro nome e pelo menos um sobrenome.'
    }
  }
  if (input.asksCpf && !normalizarCPF(input.cpf)) {
    errors.cpf = 'Informe um CPF válido.'
  }
  if (input.asksBirthDate) {
    const birthAssessment = assessAirTravelerProfile({
      name: VALID_TEST_NAME,
      documentNumber: VALID_TEST_CPF,
      birthDate: input.birthDate,
    })
    if (birthAssessment.profileIssues.includes('birth_date')) {
      errors.birthDate = 'Informe uma data de nascimento válida e que não esteja no futuro.'
    }
  }
  if (input.mode === 'create' && input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = 'Informe um e-mail válido.'
  }
  if (input.mode === 'create' && input.phone.trim() && !normalizarTelefone(input.phone)) {
    errors.phone = 'Informe um telefone com DDD.'
  }
  return errors
}

export default TravelerProfileDialog
