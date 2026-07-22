'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { AuthFormFrame } from '@/components/auth/auth-form-frame'
import { clearCurrentUser } from '@/lib/auth'

export function ChangePasswordForm({ required }: { required: boolean }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmation) return setError('A confirmacao nao corresponde a nova senha.')
    setSaving(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Nao foi possivel alterar a senha.')
      clearCurrentUser()
      router.replace('/login?senha=alterada')
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Nao foi possivel alterar a senha.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthFormFrame
      title={required ? 'Defina uma nova senha' : 'Alterar senha'}
      description={required
        ? 'Por seguranca, a senha provisoria precisa ser substituida antes de acessar o sistema.'
        : 'Informe sua senha atual e escolha uma nova senha segura.'}
      backHref={required ? '/sair' : '/dashboard/configuracoes'}
      backLabel={required ? 'Sair desta conta' : 'Voltar para configuracoes'}
    >
      <form onSubmit={submit} className="space-y-4">
        <PasswordField label="Senha atual" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="Nova senha" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
        <PasswordField label="Confirmar nova senha" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        <p className="text-xs leading-5 text-slate-500">Use ao menos 12 caracteres, com letra maiuscula, minuscula, numero e simbolo.</p>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving} className="bbt-button-primary h-11 w-full">
          {saving ? 'Salvando...' : 'Alterar senha'}
        </button>
      </form>
    </AuthFormFrame>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={label === 'Senha atual' ? 1 : 12}
        required
        className="bbt-input h-11"
      />
    </label>
  )
}
