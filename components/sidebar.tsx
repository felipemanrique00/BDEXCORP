'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  UserCircle2,
} from 'lucide-react'

import { BBTLogo } from '@/components/branding/bbt-logo'
import { CorporateContextSelector } from '@/components/corporate-context-selector'
import { logout } from '@/lib/auth'
import { getUltimaVista, NOVA_DEMANDA_EVENT } from '@/lib/notificacoes'
import { buildSidebarMenu, type SidebarMenuItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import type { User } from '@/types'

interface SidebarProps {
  user: User
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ user, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [naoLidas, setNaoLidas] = useState(0)
  const [novasDemandas, setNovasDemandas] = useState(0)
  const [alertasHoje, setAlertasHoje] = useState(0)
  const pendingNewDemandsRef = useRef(0)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    operacao: true,
    integracoes: true,
    financeiro: true,
    cadastros: true,
    inteligencia: true,
    admin: false,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setCollapsed(window.innerWidth >= 768 && window.innerWidth < 1180)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (pathname.startsWith('/dashboard/demandas')) pendingNewDemandsRef.current = 0
    void atualizarBadges()
    const interval = window.setInterval(() => void atualizarBadges(), 15_000)
    const handleNovaDemanda = () => {
      pendingNewDemandsRef.current += 1
      setNovasDemandas((current) => Math.max(current, pendingNewDemandsRef.current))
      window.setTimeout(() => void atualizarBadges(), 750)
    }
    window.addEventListener(NOVA_DEMANDA_EVENT, handleNovaDemanda)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(NOVA_DEMANDA_EVENT, handleNovaDemanda)
    }
  }, [pathname])

  async function atualizarBadges() {
    if (typeof window === 'undefined') return
    try {
      const query = new URLSearchParams()
      const lastSeen = getUltimaVista()
      if (lastSeen) query.set('lastSeen', lastSeen)
      const response = await fetch(`/api/navigation-summary?${query.toString()}`, { cache: 'no-store' })
      if (!response.ok) return
      const summary = await response.json()
      setNaoLidas(nonNegativeInteger(summary.unreadInbox))
      setNovasDemandas(Math.max(nonNegativeInteger(summary.newDemands), pendingNewDemandsRef.current))
      setAlertasHoje(nonNegativeInteger(summary.activeAlerts))
    } catch {
      // Os ultimos indicadores validos permanecem visiveis durante indisponibilidade temporaria.
    }
  }

  const grupos = buildSidebarMenu({ user, naoLidas, novasDemandas, alertasHoje })

  function toggleGroup(id: string) {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] md:hidden"
          aria-label="Fechar menu principal"
        />
      )}
      <aside
        className={cn(
          'bbt-sidebar invisible fixed inset-y-0 left-0 z-50 flex h-screen w-72 -translate-x-full flex-col border-r border-[#343a72] text-white transition-all duration-300 md:visible md:sticky md:top-0 md:translate-x-0',
          mobileOpen && 'visible translate-x-0',
          collapsed ? 'md:w-[72px]' : 'md:w-72',
        )}
        aria-label="Menu principal"
      >
      <div className="border-b border-white/10 px-3 py-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          {!collapsed ? (
            <Link href="/dashboard" className="flex min-w-0 items-center">
              <BBTLogo variant="full" tone="white" size={38} />
            </Link>
          ) : (
            <Link href="/dashboard" className="flex w-full justify-center">
              <BBTLogo variant="mark" tone="white" size={34} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white md:flex"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-b border-white/10 px-4 py-3 md:hidden">
          <CorporateContextSelector placement="mobile-menu" />
        </div>
      )}

      {!collapsed && (
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 border-l-2 border-cyan-300 bg-white/[0.045] px-3 py-2">
            <BellRing className="h-4 w-4 text-cyan-300" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white">Operação em tempo real</div>
              <div className="truncate text-[11px] text-slate-300/70">{alertasHoje} alerta(s) ativos hoje</div>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3">
        {grupos.map((grupo) => {
          const itensVisiveis = grupo.itens.filter((item) => !item.hidden)
          if (itensVisiveis.length === 0) return null
          const aberto = collapsed || openGroups[grupo.id]

          return (
            <div key={grupo.id} className="mb-2">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(grupo.id)}
                  className="flex w-full items-center justify-between px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/45 transition hover:text-cyan-100"
                >
                  <span>{grupo.label}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !aberto && '-rotate-90')} />
                </button>
              )}
              {aberto && (
                <ul className="space-y-1 px-2">
                  {itensVisiveis.map((item) => (
                    <li key={`${grupo.id}-${item.label}`}>
                      <SidebarItem
                        item={item}
                        active={isActive(pathname, item)}
                        collapsed={collapsed}
                        onNavigate={onMobileClose}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href="/dashboard/meu-perfil"
          onClick={onMobileClose}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-white/10',
            pathname === '/dashboard/meu-perfil' ? 'bg-white/10 text-white' : 'text-slate-200/75',
          )}
        >
          <UserCircle2 className="h-5 w-5 shrink-0" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{user.name}</div>
              <div className="truncate text-[10px] text-cyan-100/55">{user.perfil_bbt || user.role}</div>
            </div>
          )}
        </Link>
        <button
          type="button"
          aria-label="Sair"
          onClick={async () => {
            const encerrado = await logout()
            if (encerrado) window.location.replace('/login')
            else toast.error('Não foi possível encerrar a sessão. Tente novamente.')
          }}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-200/70 transition hover:bg-red-500/15 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
      </aside>
    </>
  )
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}

function SidebarItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: SidebarMenuItem
  active: boolean
  collapsed: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const hasBadge = Boolean(item.badge && item.badge > 0)

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm transition',
        active
          ? 'border-cyan-300 bg-cyan-300/10 text-white'
          : 'border-transparent text-slate-200/75 hover:bg-white/[0.07] hover:text-white',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-cyan-300' : 'text-slate-300/80')} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{item.label}</span>
            {item.description && (
              <span className={cn('block truncate text-[11px]', active ? 'text-cyan-50/65' : 'text-slate-400')}>
                {item.description}
              </span>
            )}
          </span>
          {hasBadge && (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', active ? 'bg-cyan-300 text-[#20265a]' : 'bg-white/90 text-[#20265a]')}>
              {item.badge! > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
      {collapsed && hasBadge && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-cyan-300" />}
    </Link>
  )
}

function isActive(pathname: string, item: SidebarMenuItem): boolean {
  const hrefPath = item.href.split('?')[0]
  const rules = item.activeWhen || [hrefPath]
  if (hrefPath === '/dashboard') return pathname === '/dashboard'
  return rules.some((rule) => pathname === rule || pathname.startsWith(`${rule}/`))
}
