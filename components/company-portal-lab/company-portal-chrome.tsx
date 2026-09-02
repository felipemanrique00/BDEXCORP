'use client'

import {
  ArrowLeft,
  BarChart3,
  Building2,
  ClipboardList,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TicketCheck,
  UserRoundCog,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type CSSProperties, type ReactNode } from 'react'

import { BBTLogo } from '@/components/branding/bbt-logo'
import {
  useEffectiveBranding,
  useScopedEffectiveBranding,
} from '@/components/branding/effective-branding-provider'
import { useCorporateContext } from '@/components/corporate-context-provider'
import { useImpersonation } from '@/components/impersonation/impersonation-provider'
import { hasPermission, logout } from '@/lib/auth'
import type {
  EffectiveBranding,
  EffectiveBrandingScope,
} from '@/lib/branding/effective-branding'
import { effectiveBrandingCssVariables } from '@/lib/branding/effective-branding'
import type { Permissoes, User } from '@/types'

export type CompanyPortalSection = 'demands' | 'approvals' | 'vouchers' | 'reports'

interface CompanyPortalLabShellProps {
  children: ReactNode
  activeSection?: CompanyPortalSection
  scope?: EffectiveBrandingScope | null
}

interface CompanyPortalDemandStickyHeaderProps {
  demandNumber: string
  serviceTypeLabel: string
  statusLabel: string
  scope?: EffectiveBrandingScope | null
  onBack: () => void
  onRefresh: () => void
}

const NAV_ITEMS: Array<{
  key: CompanyPortalSection
  label: string
  href: string
  icon: typeof ClipboardList
  permissions: Array<keyof Permissoes>
}> = [
  {
    key: 'demands',
    label: 'Demandas',
    href: '/dashboard/portal-empresa-lab',
    icon: ClipboardList,
    permissions: ['ver_demandas', 'criar_demandas'],
  },
  {
    key: 'approvals',
    label: 'Aprovações',
    href: '/dashboard/portal-empresa-lab?section=approvals',
    icon: ShieldCheck,
    permissions: ['ver_aprovacoes', 'decidir_aprovacoes', 'aprovar_demandas'],
  },
  {
    key: 'vouchers',
    label: 'Vouchers',
    href: '/dashboard/portal-empresa-lab?section=vouchers',
    icon: TicketCheck,
    permissions: ['ver_vouchers'],
  },
  {
    key: 'reports',
    label: 'Relatórios',
    href: '/dashboard/portal-empresa-lab?section=reports',
    icon: BarChart3,
    permissions: ['ver_relatorios', 'gerar_relatorios'],
  },
]

export function CompanyPortalLabShell({
  children,
  activeSection = 'demands',
}: CompanyPortalLabShellProps) {
  // The portal chrome follows the authenticated corporate context. A local
  // board filter or an opened request must not change its colors or logo.
  const { branding, status: brandingStatus } = useEffectiveBranding()
  const { user } = useCorporateContext()
  const { canStartRepresentation, openDialog: openImpersonationDialog } = useImpersonation()
  const primaryForeground = readableBrandTextColor(branding.primaryColor)
  const accentForeground = readableBrandTextColor(branding.accentColor)

  return (
    <div
      className="min-h-full bg-slate-50/60 dark:bg-slate-950/20"
      style={effectiveBrandingCssVariables(branding) as CSSProperties}
      data-company-portal-lab-shell
      data-branding-status={brandingStatus}
    >
      <header
        className="border-b-4 shadow-sm print:hidden"
        style={{
          backgroundColor: branding.primaryColor,
          borderBottomColor: branding.accentColor,
          color: primaryForeground,
        }}
        data-company-portal-header
      >
        <div className="mx-auto grid w-full max-w-[1800px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(420px,1fr)_auto] lg:gap-6">
          <Link
            href="/dashboard/portal-empresa-lab"
            className="inline-flex w-fit items-center rounded-xl bg-white/95 px-3 py-2 shadow-sm outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            aria-label="Ir para as demandas do Portal Empresa"
          >
            <BBTLogo variant="full" tone="color" size={34} />
          </Link>

          <CompanyPortalNavigation
            activeSection={activeSection}
            user={user}
            accentColor={branding.accentColor}
            accentForeground={accentForeground}
          />

          <div
            className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2"
            data-company-portal-account-controls
          >
            {user && (
              <div
                className="hidden min-w-0 text-right md:block"
                aria-label={`Sessão autenticada: ${user.name}, ${user.email}`}
                data-company-portal-session-identity
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.12em]">Usuário conectado</div>
                <div className="max-w-36 truncate text-sm font-semibold xl:max-w-48" title={user.name}>{user.name}</div>
                <div className="hidden max-w-48 truncate text-[11px] xl:block" title={user.email}>{user.email}</div>
              </div>
            )}
            {canStartRepresentation && (
              <button
                type="button"
                onClick={() => openImpersonationDialog()}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/90 px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                aria-label="Acessar como usuário"
                title="Acessar como usuário"
                data-company-portal-impersonation-launcher
              >
                <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                <span className="hidden xl:inline">Acessar como</span>
              </button>
            )}
            <CompanyPortalLogoutButton user={user} />
            <div
              className="flex min-w-0 shrink-0 items-center justify-end"
              aria-busy={brandingStatus === 'loading'}
              data-company-portal-customer-brand
            >
              <ResolvedCompanyBrandLogo branding={branding} />
            </div>
          </div>
        </div>
      </header>

      {children}
    </div>
  )
}

function CompanyPortalLogoutButton({ user }: { user: User | null }) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    setError('')

    const sessionEnded = await logout()
    if (sessionEnded) {
      window.location.replace('/login')
      return
    }

    setError('Não foi possível encerrar a sessão. Tente novamente.')
    setSigningOut(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={signingOut}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/90 px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-wait disabled:opacity-70"
        aria-label={signingOut
          ? 'Encerrando sessão'
          : `Sair do Portal Empresa${user ? `. Sessão de ${user.name}` : ''}`}
        aria-busy={signingOut}
        title="Sair do Portal Empresa"
        data-company-portal-logout
      >
        {signingOut
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <LogOut className="h-4 w-4" aria-hidden="true" />}
        <span className="hidden xl:inline">{signingOut ? 'Saindo...' : 'Sair'}</span>
      </button>
      {error && <span className="sr-only" role="alert">{error}</span>}
    </>
  )
}

function ResolvedCompanyBrandLogo({ branding }: { branding: EffectiveBranding }) {
  if (branding.isLogoFallback) {
    return (
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 bg-white/95 text-slate-900 shadow-sm sm:h-10 sm:w-10"
        style={{ borderColor: branding.accentColor }}
        role="img"
        aria-label={`Logomarca não cadastrada para ${branding.displayName}`}
        title={`Logomarca não cadastrada para ${branding.displayName}`}
        data-company-logo-fallback
      >
        <Building2 className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span
      className="inline-flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/95 p-1 shadow-sm sm:h-10 sm:w-24 lg:w-28"
      data-effective-brand-logo={branding.scopeId || 'system'}
      title={branding.displayName}
    >
      {/* Scoped URLs passed by effective branding are already restricted to same-origin or HTTPS. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={branding.logoUrl}
        alt={branding.logoAlt}
        width={112}
        height={40}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  )
}

function CompanyPortalNavigation({
  activeSection,
  user,
  accentColor,
  accentForeground,
}: {
  activeSection: CompanyPortalSection
  user: User | null
  accentColor: string
  accentForeground: string
}) {
  return (
    <nav
      className="order-3 col-span-2 flex min-w-0 gap-2 overflow-x-auto pb-0.5 lg:order-none lg:col-span-1 lg:justify-center"
      aria-label="Navegação do Portal Empresa"
    >
      {NAV_ITEMS.map((item) => {
        const active = item.key === activeSection
        const allowed = active || item.permissions.some((permission) => hasPermission(user, permission))
        const Icon = item.icon
        const commonClassName = 'inline-flex min-w-[132px] shrink-0 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent'

        if (!allowed) {
          return (
            <span
              key={item.key}
              className={`${commonClassName} cursor-not-allowed border-white/15 bg-slate-200/55 text-slate-600 opacity-75`}
              aria-disabled="true"
              title="Sem permissão neste perfil"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </span>
          )
        }

        return (
          <Link
            key={item.key}
            href={item.href}
            className={`${commonClassName} ${active ? 'border-transparent shadow-sm' : 'border-white/30 bg-white/85 text-slate-700 hover:bg-white'}`}
            style={active ? { backgroundColor: accentColor, color: accentForeground } : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function CompanyPortalDemandStickyHeader({
  demandNumber,
  serviceTypeLabel,
  statusLabel,
  scope,
  onBack,
  onRefresh,
}: CompanyPortalDemandStickyHeaderProps) {
  const effectiveBranding = useEffectiveBranding()
  const scopedBranding = useScopedEffectiveBranding(scope ?? null)
  const { branding } = scope === undefined ? effectiveBranding : scopedBranding
  const accentForeground = readableBrandTextColor(branding.accentColor)

  return (
    <header
      className="sticky top-2 z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur sm:p-4 dark:border-slate-700 dark:bg-slate-900/95"
      style={{ borderTopColor: branding.accentColor, borderTopWidth: 4 }}
      data-company-portal-demand-header
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="bbt-button-ghost h-10 w-10 shrink-0 p-0"
            aria-label="Voltar às demandas"
            title="Voltar às demandas"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Detalhe da demanda</div>
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-xl dark:text-white">
              Pedido {demandNumber} <span aria-hidden="true">|</span> {serviceTypeLabel}
            </h1>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span
            className="inline-flex min-h-9 items-center rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ backgroundColor: branding.accentColor, color: accentForeground }}
            aria-label={`Status do pedido: ${statusLabel}`}
          >
            <span className="mr-1.5 opacity-75" aria-hidden="true">Status:</span>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="bbt-button-ghost min-h-10"
            aria-label="Atualizar pedido"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>
    </header>
  )
}

/** Returns a high-contrast foreground for a sanitized six-digit brand color. */
export function readableBrandTextColor(color: string): '#000000' | '#FFFFFF' {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return '#FFFFFF'

  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ))
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
  const darkTextContrast = (luminance + 0.05) / 0.05
  const whiteTextContrast = 1.05 / (luminance + 0.05)
  return darkTextContrast >= whiteTextContrast ? '#000000' : '#FFFFFF'
}
