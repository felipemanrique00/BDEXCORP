'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { AI_NAME, SYSTEM_NAME } from '@/lib/branding'
import { BBTLogo } from '@/components/branding/bbt-logo'
import { setCurrentUser } from '@/lib/auth'
import { authenticateWithServer, fetchServerSession } from '@/lib/client-session'
import { clearLocalSharedStorageForSessionChange } from '@/lib/storage-quota'

const heroImage =
  'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1800&q=85'

const accessPillars: Array<{ icon: LucideIcon; label: string; detail: string }> = [
  { icon: Building2, label: 'Gestão centralizada', detail: 'Empresas, grupos e centros de custo' },
  { icon: ShieldCheck, label: 'Governança', detail: 'Políticas, aprovações e rastreabilidade' },
  { icon: Sparkles, label: AI_NAME, detail: 'Inteligência aplicada à operação' },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [workspaceRequired, setWorkspaceRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    let alive = true
    async function prepararLogin() {
      const session = await fetchServerSession()
      if (!alive) return
      if (session.user) {
        setCurrentUser(session.user)
        router.push(session.user.must_change_password ? '/alterar-senha' : defaultRoute(session.user))
        return
      }
    }
    prepararLogin()
    return () => {
      alive = false
    }
  }, [router])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const serverLogin = await authenticateWithServer(email.trim(), password, workspace)
    const user = serverLogin.user

    if (!user) {
      if (serverLogin.code === 'WORKSPACE_REQUIRED') {
        setWorkspaceRequired(true)
        setError('Informe o identificador do ambiente da sua organizacao.')
      } else {
        setError(serverLogin.reachable ? 'E-mail, senha ou ambiente incorretos.' : 'Servico de autenticacao indisponivel.')
      }
      setLoading(false)
      return
    }

    clearLocalSharedStorageForSessionChange()
    setCurrentUser(user)
    toast.success(`Bem-vindo, ${user.name.split(' ')[0]}!`)
    router.push(user.must_change_password ? '/alterar-senha' : defaultRoute(user))
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.2fr)_minmax(430px,0.8fr)]">
        <section className="relative hidden min-h-screen overflow-hidden px-10 py-9 text-white lg:flex lg:flex-col lg:justify-between 2xl:px-14 2xl:py-12">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(105deg, rgba(24, 29, 72, 0.96) 0%, rgba(32, 38, 90, 0.88) 48%, rgba(49, 48, 111, 0.62) 100%), url("${heroImage}")`,
              backgroundPosition: 'center 45%',
            }}
          />
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)]" />

          <div className="relative flex items-center justify-between gap-6">
            <BBTLogo variant="full" tone="white" size={64} />
            <div className="border-l border-white/25 pl-5 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/70">Ambiente operacional</p>
              <p className="mt-1 text-sm font-semibold">Acesso corporativo</p>
            </div>
          </div>

          <div className="relative max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/75">Mobilidade corporativa</p>
            <h1 className="text-4xl font-semibold leading-[1.12] tracking-normal 2xl:text-5xl">
              Gestão corporativa de viagens com controle e clareza.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200/85">
              Uma operação conectada para atender viajantes, empresas e equipes com consistência do início ao fechamento.
            </p>
          </div>

          <div className="relative grid grid-cols-3 border-t border-white/20 pt-6">
            {accessPillars.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="min-w-0 border-r border-white/15 px-5 first:pl-0 last:border-r-0 last:pr-0">
                <Icon className="h-5 w-5 text-cyan-200" />
                <p className="mt-3 text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300/75">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center bg-[#f7f8fb] px-6 py-10 text-slate-900 dark:bg-[#10142b] dark:text-white sm:px-10 lg:px-12">
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)] lg:hidden" />
          <div className="w-full max-w-md">
            <BBTLogo variant="full" tone="color" size={58} className="mb-12 dark:hidden" />
            <BBTLogo variant="full" tone="white" size={58} className="mb-12 hidden dark:block" />

            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bbt-violet dark:text-cyan-200">Área segura</p>
              <h2 className="mt-3 text-3xl font-semibold text-bbt-primary dark:text-white">Acesso ao sistema</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                Entre com suas credenciais do {SYSTEM_NAME}.
              </p>
            </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="seu@email.com"
                      required
                      autoComplete="email"
                      className="bbt-input !h-12 !pl-11"
                    />
                  </div>
                </div>

                {workspaceRequired && (
                  <div>
                    <label htmlFor="login-workspace" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Ambiente da organizacao
                    </label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                      <input
                        id="login-workspace"
                        type="text"
                        value={workspace}
                        onChange={(event) => setWorkspace(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder="identificador-da-organizacao"
                        required
                        autoComplete="organization"
                        className="bbt-input !h-12 !pl-11"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Senha</label>
                    <Link href="/esqueci-senha" className="text-xs font-semibold text-bbt-violet hover:underline dark:text-cyan-300">
                      Esqueci minha senha
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Digite sua senha"
                      required
                      autoComplete="current-password"
                      className="bbt-input !h-12 !pl-11 !pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      tabIndex={-1}
                      aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={loading} className="bbt-button-primary !h-12 w-full">
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

            <div className="mt-9 flex items-start gap-3 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-400 dark:border-slate-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
              <p>Ambiente restrito. O acesso e as operações realizadas ficam vinculados ao usuário autenticado.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function defaultRoute(user: { role?: string } | null): string {
  return user?.role === 'master' ? '/dashboard' : '/dashboard/portal-empresa'
}
