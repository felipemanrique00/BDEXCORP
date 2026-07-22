'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Moon, Sun, LogOut, Settings, ChevronDown,
  Building2, Users, Hotel as HotelIcon, UserCircle2,
  FileText, ListChecks, Loader2, Sparkles, Download,
  Menu,
} from 'lucide-react'
import { SYSTEM_NAME, SYSTEM_TAGLINE } from '@/lib/branding'
import { getCurrentUser, hasPermission, logout, roleLabel, perfilBBTLabel } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { TransferenciasPendentesPainel } from '@/components/ui/transferencias-pendentes-painel'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import { safeSetRaw } from '@/lib/storage-quota'
import {
  buscarHoteisComIA,
  extrairDestinoHotel,
  hotelJaExiste,
  sugestaoParaHotel,
} from '@/lib/ia-hotel-search'
import Fuse from 'fuse.js'
import type { User } from '@/types'
import { toast } from 'sonner'

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
  const [iaSearching, setIaSearching] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchRevision, setSearchRevision] = useState(0)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const { empresas, funcionarios, hoteis, addHotel } = useStore()

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

  type SearchItem = { id: string; type: 'empresa' | 'funcionario' | 'hotel' | 'demanda' | 'voucher'; nome: string; sub: string; href: string }
  const searchItems: SearchItem[] = useMemo(() => {
    void searchRevision
    const out: SearchItem[] = []
    empresas.forEach((e) => out.push({ id: e.id, type: 'empresa', nome: e.nome, sub: e.cnpj, href: `/dashboard/empresas/${e.id}` }))
    funcionarios.forEach((f) => {
      const emp = empresas.find((e) => e.id === f.company_id)?.nome || ''
      out.push({ id: f.id, type: 'funcionario', nome: f.nome, sub: `${f.cargo}${emp ? ' · ' + emp : ''}`, href: `/dashboard/funcionarios/${f.id}` })
    })
    hoteis.forEach((h) => out.push({ id: String(h.id), type: 'hotel', nome: h.nome, sub: `${h.cidade} · ${h.uf}`, href: `/dashboard/hoteis/${h.id}` }))
    getAllAtendimentos().forEach((a) => {
      const destino =
        a.detalhes_hotel?.hotel_nome ||
        a.detalhes_hotel?.cidade ||
        a.detalhes_aereo?.destino ||
        a.detalhes_carro?.cidade_retirada ||
        a.detalhes_pacote?.destino ||
        a.tipo_servico
      out.push({
        id: a.id,
        type: 'demanda',
        nome: a.passageiro_nome,
        sub: `${a.tipo_servico} · ${destino} · ${a.status}`,
        href: '/dashboard/demandas',
      })
    })
    getAllVouchersEmitidos().forEach((v) => {
      out.push({
        id: v.id,
        type: 'voucher',
        nome: `${v.numero} · ${v.passageiro_nome}`,
        sub: `${v.tipo} · ${v.fornecedor_nome} · ${v.status}`,
        href: `/dashboard/vouchers/${v.id}`,
      })
    })
    return out
  }, [empresas, funcionarios, hoteis, searchRevision])

  const fuse = useMemo(() => new Fuse(searchItems, { keys: ['nome', 'sub'], threshold: 0.38, ignoreLocation: true, includeScore: true }), [searchItems])
  const results = useMemo(() => searchQuery.trim() ? fuse.search(searchQuery).slice(0, 8).map((r) => r.item) : [], [fuse, searchQuery])
  const podeBuscaIA = useMemo(() => /(hotel|hoteis|hotéis|hospedagem|pousada|diaria|diária|campo|cidade|ms|go|sp|rj|df)/i.test(searchQuery), [searchQuery])
  const podeCadastrarHoteis = user?.role === 'master' && hasPermission(user, 'cadastrar_hoteis')

  function goTo(href: string) {
    setSearchOpen(false); setSearchQuery('')
    router.push(href)
  }

  async function buscarCadastrarComIA() {
    const query = searchQuery.trim()
    if (!query || iaSearching) return
    if (!podeCadastrarHoteis) {
      toast.error('Você não tem permissão para cadastrar hotéis.')
      return
    }

    setIaSearching(true)
    try {
      const destino = extrairDestinoHotel(query)
      const response = await buscarHoteisComIA({
        query,
        cidade: destino.cidade,
        uf: destino.uf,
        knownHotels: hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
      const novos = response.suggestions.filter((s) => !hotelJaExiste(hoteis, s.nome, s.cidade, s.uf)).slice(0, 4)
      novos.forEach((s) => addHotel(sugestaoParaHotel(s)))
      toast.success(
        novos.length > 0
          ? `${novos.length} hotel(is) cadastrado(s) pela IA.`
          : 'A IA encontrou hotéis, mas não cadastrei duplicados.',
      )
      setSearchOpen(false)
      router.push(`/dashboard/hoteis?busca=${encodeURIComponent(destino.cidade || query)}`)
    } catch (e: any) {
      toast.error(e.message || 'Não consegui buscar hotéis agora.')
    } finally {
      setIaSearching(false)
    }
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
              onFocus={() => {
                setSearchRevision((revision) => revision + 1)
                setSearchOpen(true)
              }}
              placeholder="Busca global: empresas, viajantes, hotéis, demandas e vouchers..."
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

          {searchOpen && searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-bbt-gray-100 dark:border-slate-700 overflow-hidden z-50 max-h-96 overflow-y-auto">
              {results.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  <div>Nada encontrado para "{searchQuery}"</div>
                  {podeBuscaIA && podeCadastrarHoteis && (
                    <button
                      onClick={buscarCadastrarComIA}
                      disabled={iaSearching}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-bbt-accent px-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {iaSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Buscar e cadastrar hotéis com IA
                    </button>
                  )}
                </div>
              ) : (
                <>
                {results.map((r) => {
                  const TypeIcon =
                    r.type === 'empresa'
                      ? Building2
                      : r.type === 'funcionario'
                      ? Users
                      : r.type === 'hotel'
                      ? HotelIcon
                      : r.type === 'voucher'
                      ? FileText
                      : ListChecks
                  return (
                    <button key={r.type + r.id} onClick={() => goTo(r.href)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/50 transition text-left">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        r.type === 'empresa' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                        : r.type === 'funcionario' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'
                        : r.type === 'hotel' ? 'bg-green-100 dark:bg-green-900/30 text-green-600'
                        : r.type === 'voucher' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-600'
                      }`}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-bbt-text dark:text-slate-100 truncate">{r.nome}</div>
                        <div className="text-xs text-slate-500 truncate">{r.sub}</div>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{r.type}</span>
                    </button>
                  )
                })}
                {podeBuscaIA && podeCadastrarHoteis && (
                  <button
                    onClick={buscarCadastrarComIA}
                    disabled={iaSearching}
                    className="w-full flex items-center gap-3 p-3 border-t border-bbt-gray-100 dark:border-slate-700 bg-bbt-accent/5 hover:bg-bbt-accent/10 text-left transition"
                  >
                    <div className="w-8 h-8 rounded-lg bg-bbt-accent text-white flex items-center justify-center shrink-0">
                      {iaSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-bbt-primary dark:text-white">Buscar hotéis na web e cadastrar</div>
                      <div className="text-xs text-slate-500 truncate">Usa IA para descobrir fornecedores quando não existe no sistema.</div>
                    </div>
                  </button>
                )}
                </>
              )}
            </div>
          )}
        </div>

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
