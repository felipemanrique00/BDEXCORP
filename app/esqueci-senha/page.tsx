'use client'

import { useState, type FormEvent } from 'react'

import { AuthFormFrame } from '@/components/auth/auth-form-frame'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSending(true)
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Nao foi possivel solicitar a recuperacao.')
      setMessage(payload.message)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Nao foi possivel solicitar a recuperacao.')
    } finally {
      setSending(false)
    }
  }

  return (
    <AuthFormFrame title="Recuperar acesso" description="Informe o e-mail cadastrado para receber um link seguro de redefinicao.">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">E-mail</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="bbt-input h-11" />
        </label>
        {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={sending} className="bbt-button-primary h-11 w-full">
          {sending ? 'Enviando...' : 'Enviar link seguro'}
        </button>
      </form>
    </AuthFormFrame>
  )
}
