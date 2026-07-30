'use client'

import { FormEvent, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

interface MfaStatusPayload {
  required: boolean
  enabled: boolean
  enabledAt: string | null
  remainingRecoveryCodes: number
}

export function MfaSecurityCard() {
  const [status, setStatus] = useState<MfaStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/auth/mfa/status', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.mfa) throw new Error(payload?.error || 'Falha ao consultar o MFA.')
        setStatus(payload.mfa)
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(requestError instanceof Error ? requestError.message : 'Falha ao consultar o MFA.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  async function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/mfa/recovery-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.recoveryCodes)) {
        throw new Error(payload?.error || 'Não foi possível renovar os códigos.')
      }
      setRecoveryCodes(payload.recoveryCodes)
      setStatus((current) => current ? {
        ...current,
        remainingRecoveryCodes: payload.recoveryCodes.length,
      } : current)
      setPassword('')
      setCode('')
      setFormOpen(false)
      toast.success('Novos códigos de recuperação gerados.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível renovar os códigos.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'))
    toast.success('Códigos copiados.')
  }

  return (
    <section className="bbt-card p-6" aria-labelledby="mfa-security-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-bbt-violet dark:bg-cyan-950/40 dark:text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 id="mfa-security-title" className="font-semibold text-bbt-primary dark:text-white">
              Autenticação em duas etapas
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Protege ações administrativas mesmo quando uma senha é comprometida.
            </p>
          </div>
        </div>
        {!loading && status?.enabled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ativa
          </span>
        )}
      </div>

      {loading && <p className="mt-5 text-sm text-slate-500">Consultando configuração de segurança...</p>}

      {!loading && status && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700">
          {status.enabled ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <p>
                  Ativada em{' '}
                  <strong>{status.enabledAt ? new Date(status.enabledAt).toLocaleString('pt-BR') : 'data não informada'}</strong>
                </p>
                <p className="mt-1">
                  Códigos de recuperação disponíveis: <strong>{status.remainingRecoveryCodes}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormOpen((open) => !open)
                  setRecoveryCodes([])
                  setError('')
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" /> Renovar códigos
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {status.required
                ? 'A ativação é obrigatória para este perfil e será solicitada no próximo login.'
                : 'A autenticação em duas etapas ainda não está ativa para esta conta.'}
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={regenerate} className="mt-5 grid gap-4 border-t border-slate-200 pt-5 dark:border-slate-700 sm:grid-cols-2">
          <div>
            <label htmlFor="mfa-current-password" className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
              Senha atual
            </label>
            <input
              id="mfa-current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className="bbt-input"
            />
          </div>
          <div>
            <label htmlFor="mfa-current-code" className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
              Código atual
            </label>
            <input
              id="mfa-current-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
              autoComplete="one-time-code"
              placeholder="6 dígitos ou recuperação"
              className="bbt-input"
            />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-3 text-xs leading-5 text-slate-500">
              A renovação invalida todos os códigos de recuperação anteriores.
            </p>
            <button type="submit" disabled={submitting} className="bbt-button-primary inline-flex h-10 items-center gap-2 px-4">
              <KeyRound className="h-4 w-4" />
              {submitting ? 'Validando...' : 'Gerar novos códigos'}
            </button>
          </div>
        </form>
      )}

      {recoveryCodes.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-bbt-primary dark:text-white">
              Guarde estes códigos. Eles não serão exibidos novamente.
            </p>
            <button type="button" onClick={copyCodes} className="inline-flex items-center gap-2 text-sm font-semibold text-bbt-violet hover:underline dark:text-cyan-300">
              <Copy className="h-4 w-4" /> Copiar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900 sm:grid-cols-5">
            {recoveryCodes.map((recoveryCode) => (
              <code key={recoveryCode} className="rounded bg-white px-2 py-1.5 text-center text-xs font-semibold shadow-sm dark:bg-slate-800">
                {recoveryCode}
              </code>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </section>
  )
}
