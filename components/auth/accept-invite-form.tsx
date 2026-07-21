'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { AuthFormFrame } from '@/components/auth/auth-form-frame'

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!token) return setError('Convite incompleto.')
    if (password !== confirmation) return setError('A confirmacao nao corresponde a senha.')
    setSaving(true)
    try {
      const response = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Nao foi possivel aceitar o convite.')
      router.replace('/login?convite=aceito')
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Nao foi possivel aceitar o convite.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthFormFrame title="Ativar acesso" description="Defina sua senha para concluir o convite e acessar o ambiente da organizacao.">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">Senha</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required autoComplete="new-password" className="bbt-input h-11" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">Confirmar senha</span>
          <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required autoComplete="new-password" className="bbt-input h-11" />
        </label>
        <p className="text-xs leading-5 text-slate-500">Use ao menos 12 caracteres, com letra maiuscula, minuscula, numero e simbolo.</p>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving || !token} className="bbt-button-primary h-11 w-full">
          {saving ? 'Ativando...' : 'Ativar minha conta'}
        </button>
      </form>
    </AuthFormFrame>
  )
}
