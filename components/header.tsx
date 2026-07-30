'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Moon, Sun, LogOut, Settings, ChevronDown,
  Building2, Users, Hotel as HotelIcon, UserCircle2,
  FileText, ListChecks, Loader2, Sparkles, Download, Menu,
  Network, Plane, TicketCheck, ShieldCheck, Workflow,
} from 'lucide-react'
import { SYSTEM_NAME, SYSTEM_TAGLINE } from '@/lib/branding'
import { getCurrentUser, hasPermission, logout, roleLabel, perfilBBTLabel } from '@/lib/auth'
import { TransferenciasPendentesPainel } from '@/components/ui/transferencias-pendentes-painel'
import { safeSetRaw } from '@/lib/storage-quota'
import { searchUniversalClient } from '@/lib/universal-search-client'
import type {
  UniversalSearchItem,
  UniversalSearchKind,
} from '@/lib/universal-search-contract'
import type { User } from '@/types'
import { toast } from 'sonner'
import { CorporateContextSelector } from '@/components/corporate-context-selector'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface HeaderProps {
  onOpenNavigation?: () => void
}

export function Header({ onOpenNavigation }: HeaderProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchResults, setSearchResults] = useState<UniversalSearchItem[]>([])
  const [profileOpen, setProfileOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setUser(getCurrentUser()) }, [])

  useEffect(() => {
    const saved = localStorage.getItem('bbt-theme')
    const isDark = saved === 'dark'
    setDarkMode(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstallPrompt(null), { once: true })
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearching(false)
      setSearchError('')
      setSearchResults([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      setSearchError('')
      searchUniversalClient(query, { signal: controller.signal, limit: 12 })
        .then((result) => setSearchResults(result.items))
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setSearchResults([])
          setSearchError(error instanceof Error ? error.message : 'Falha ao executar a busca.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  const toggleDark = () => {
    const next = !darkMode
    setDarkMode(next)
    document.documentElement.classList.toggle('dark', next)
    safeSetRaw('bbt-theme', next ? 'dark' : 'light')
    // V17: notifica componentes (mapa, etc) sobre mudança de tema
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bbt-theme-change', { detail: { dark: next } }))
    }
  }

  const handleLogout = async () => {
    const encerrado = await logout()
    if (!encerrado) {
      toast.error('Não foi possível encerrar a sessão. Tente novamente.')
      return
    }
    window.location.replace('/login')
  }

  async function installPWA() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice.catch(() => null)
    if (choice?.outcome === 'accepted') {
      toast.success('BBT instalado como app.')
      setInstallPrompt(null)
    }
  }

  const podeBuscaIA = /(hotel|hoteis|hotéis|hospedagem|pousada|diaria|diária|cidade|destino)/i.test(searchQuery)
    && Boolean(user && hasPermission(user, 'usar_ia'))

  function goTo(href: string) {
    setSearchOpen(false); setSearchQuery('')
    router.push(href)
  }

  function openBiaSearch() {
    const query = searchQuery.trim()
    if (!query) return
    setSearchOpen(false)
    setSearchQuery('')
    router.push(`/dashboard/ia-chat?pergunta=${encodeURIComponent(`Pesquise hotéis para: ${query}`)}`)
  }

  if (!user) return null

  return (
    <header className="bbt-app-header top-0 z-20 border-b border-bbt-gray-100 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center gap-3 px-4 py-3 pt-4 sm:px-6">

        {onOpenNavigation && (
          <button
            type="button"
            onClick={onOpenNavigation}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-bbt-gray-100 text-bbt-primary transition hover:border-bbt-accent hover:bg-bbt-accent/5 focus:outline-none focus:ring-2 focus:ring-bbt-accent/25 dark:border-slate-700 dark:text-white md:hidden"
            aria-label="Abrir menu principal"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {/* Esquerda — Busca global */}
        <div ref={searchRef} className="relative min-w-0 max-w-2xl flex-1">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 pointer-events-none z-10" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Buscar empresas, viajantes, OS, reservas, vouchers, políticas..."
              aria-label="Busca global"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-bbt-gray-100 bg-[#f8f9fc] pl-11 pr-9 text-sm text-bbt-text transition placeholder:text-slate-400 focus:border-bbt-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-bbt-accent/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 z-10"
                aria-label="Limpar">
                <span className="text-lg leading-none">×</span>
              </button>
            )}
          </div>

          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-bbt-gray-100 dark:border-slate-700 overflow-hidden z-50 max-h-96 overflow-y-auto">
              {searching ? (
                <div className="flex items-center justify-center gap-2 p-5 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando no escopo autorizado...
                </div>
              ) : searchError ? (
                <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">
                  {searchError}
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  <div>Nada encontrado para "{searchQuery}"</div>
                  {podeBuscaIA && (
                    <button
                      type="button"
                      onClick={openBiaSearch}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-bbt-accent px-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Pesquisar hotéis com a BIA
                    </button>
                  )}
                </div>
              ) : (
                <>
                {searchResults.map((result) => {
                  const presentation = searchKindPresentation(result.kind)
                  const TypeIcon = presentation.icon
                  return (
                    <button key={`${result.kind}:${result.id}`} onClick={() => goTo(result.href)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/50 transition text-left">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${presentation.className}`}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium text-bbt-text dark:text-slate-100">{result.title}</div>
                        <div className="truncate text-xs text-slate-500">{result.subtitle}</div>
                        {result.companyName && result.companyName !== result.title && (
                          <div className="truncate text-[11px] text-slate-400">{result.companyName}</div>
                        )}
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{presentation.label}</span>
                    </button>
                  )
                })}
                {podeBuscaIA && (
                  <button
                    type="button"
                    onClick={openBiaSearch}
                    className="w-full flex items-center gap-3 p-3 border-t border-bbt-gray-100 dark:border-slate-700 bg-bbt-accent/5 hover:bg-bbt-accent/10 text-left transition"
                  >
                    <div className="w-8 h-8 rounded-lg bg-bbt-accent text-white flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-bbt-primary dark:text-white">Pesquisar hotéis com a BIA</div>
                      <div className="text-xs text-slate-500 truncate">A BIA pesquisa fontes externas e pede confirmação antes de cadastrar.</div>
                    </div>
                  </button>
                )}
                </>
              )}
            </div>
          )}
        </div>

        <CorporateContextSelector />

        {/* CENTRO — Perfil (CENTRALIZADO) */}
        <div ref={profileRef} className="relative ml-auto shrink-0">
          <button onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition hover:border-bbt-gray-100 hover:bg-bbt-gray-50 dark:hover:border-slate-700 dark:hover:bg-slate-800">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bbt-primary text-sm font-bold text-white ring-2 ring-bbt-accent/25">
              {user.name.split(' ').slice(0, 2).map((n) => n[0]).join('')}
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-sm font-semibold text-bbt-primary dark:text-white leading-tight">{user.name}</div>
              <div className="text-[11px] text-slate-500 leading-tight">
                {SYSTEM_NAME} · {SYSTEM_TAGLINE}
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-lg border border-bbt-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
              <div className="border-b-4 border-bbt-accent bg-bbt-primary p-4 text-white">
                <div className="font-semibold truncate">{user.name}</div>
                <div className="text-xs opacity-90 truncate">{user.email}</div>
                <div className="mt-1 flex gap-1 flex-wrap">
                  <span className="text-[10px] bg-white/20 backdrop-blur px-2 py-0.5 rounded-full">
                    {user.perfil_bbt ? perfilBBTLabel(user.perfil_bbt) : roleLabel(user.role)}
                  </span>
                </div>
              </div>
              <div className="p-1">
                {user.role === 'master' && (
                  <Link href="/dashboard/meu-perfil" onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-bbt-gray-50 dark:hover:bg-slate-900 text-bbt-text dark:text-slate-200 transition">
                    <UserCircle2 className="w-4 h-4 text-bbt-accent" /> Meu Perfil (minhas demandas)
                  </Link>
                )}
                <Link href="/dashboard/configuracoes" onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-bbt-gray-50 dark:hover:bg-slate-900 text-bbt-text dark:text-slate-200 transition">
                  <Settings className="w-4 h-4 text-slate-500" /> Configurações
                </Link>
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition">
                  <LogOut className="w-4 h-4" /> Sair
                </button>
              </div>
            </div>
          )}
        </div>

        {/* DIREITA — Ações rápidas */}
        <div className="flex shrink-0 items-center gap-1">
          <TransferenciasPendentesPainel />
          {installPrompt && (
            <button onClick={installPWA}
              className="p-2.5 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
              title="Instalar app"
              aria-label="Instalar aplicativo">
              <Download className="w-4 h-4" />
            </button>
          )}
          <button onClick={toggleDark}
            className="p-2.5 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            title={darkMode ? 'Modo claro' : 'Modo escuro'}
            aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}>
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  )
}

function searchKindPresentation(kind: UniversalSearchKind) {
  switch (kind) {
    case 'group':
      return { icon: Network, label: 'Grupo', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' }
    case 'company':
      return { icon: Building2, label: 'Empresa', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' }
    case 'employee':
      return { icon: Users, label: 'Viajante', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }
    case 'hotel':
      return { icon: HotelIcon, label: 'Hotel', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }
    case 'demand':
      return { icon: ListChecks, label: 'Demanda', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' }
    case 'reservation':
      return { icon: TicketCheck, label: 'Reserva', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' }
    case 'emission':
      return { icon: Plane, label: 'Emissao', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' }
    case 'voucher':
      return { icon: FileText, label: 'Voucher', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
    case 'policy':
      return { icon: ShieldCheck, label: 'Politica', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' }
    case 'workflow':
      return { icon: Workflow, label: 'Workflow', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' }
  }
}
