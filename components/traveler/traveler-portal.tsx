'use client'

import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  Building2,
  CalendarDays,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  History,
  Hotel,
  IdCard,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Plane,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TicketCheck,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { hasPermission } from '@/lib/auth'
import {
  clearTravelerOverviewOffline,
  loadTravelerOverviewOffline,
  saveTravelerOverviewOffline,
  type TravelerOfflineIdentity,
} from '@/lib/traveler/offline-store'
import type {
  TravelerPortalOverview,
  TravelerReservation,
  TravelerTrip,
} from '@/lib/traveler/types'
import { cn } from '@/lib/utils'
import type { User } from '@/types'

type Tab = 'upcoming' | 'history' | 'profile'
type DataSource = 'online' | 'offline' | null

export function TravelerPortal({ user }: { user: User }) {
  const identity = useMemo<TravelerOfflineIdentity | null>(() => (
    user.tenant_id ? { tenantId: user.tenant_id, userId: user.id } : null
  ), [user.id, user.tenant_id])
  const [tab, setTab] = useState<Tab>('upcoming')
  const [overview, setOverview] = useState<TravelerPortalOverview | null>(null)
  const [source, setSource] = useState<DataSource>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [offlineSavedAt, setOfflineSavedAt] = useState<string | null>(null)
  const [savingOffline, setSavingOffline] = useState(false)
  const canAccess = hasPermission(user, 'acessar_portal_viajante')

  const loadOverview = useCallback(async () => {
    if (!canAccess || !identity) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/traveler/overview', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.overview) {
        throw new Error(payload?.error || 'Nao foi possivel carregar suas viagens.')
      }
      setOverview(payload.overview as TravelerPortalOverview)
      setSource('online')
    } catch (loadError) {
      const snapshot = await loadTravelerOverviewOffline(identity).catch(() => null)
      if (snapshot) {
        setOverview(snapshot.overview)
        setOfflineSavedAt(snapshot.savedAt)
        setSource('offline')
        setError('Sem conexao com o servidor. Exibindo a ultima copia offline salva.')
      } else {
        setOverview(null)
        setSource(null)
        setError(errorMessage(loadError))
      }
    } finally {
      setLoading(false)
    }
  }, [canAccess, identity])

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine)
    updateConnection()
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    if (!identity) return
    void loadTravelerOverviewOffline(identity)
      .then((snapshot) => setOfflineSavedAt(snapshot?.savedAt || null))
      .catch(() => setOfflineSavedAt(null))
  }, [identity])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  async function saveOffline() {
    if (!identity || !overview || source !== 'online') return
    setSavingOffline(true)
    try {
      const snapshot = await saveTravelerOverviewOffline(identity, overview)
      setOfflineSavedAt(snapshot.savedAt)
      toast.success('Viagens disponibilizadas offline neste dispositivo.')
    } catch (saveError) {
      toast.error(errorMessage(saveError))
    } finally {
      setSavingOffline(false)
    }
  }

  async function clearOffline() {
    try {
      await clearTravelerOverviewOffline()
      setOfflineSavedAt(null)
      toast.success('Copia offline removida deste dispositivo.')
    } catch (clearError) {
      toast.error(errorMessage(clearError))
    }
  }

  if (!canAccess) {
    return (
      <PortalState
        icon={ShieldCheck}
        title="Acesso nao autorizado"
        description="Seu perfil nao possui acesso ao portal do viajante."
      />
    )
  }
  if (loading && !overview) {
    return <PortalState icon={Loader2} title="Carregando suas viagens" spinning />
  }
  if (!overview) {
    return (
      <PortalState
        icon={AlertTriangle}
        title="Nao foi possivel carregar suas viagens"
        description={error || undefined}
        action={() => void loadOverview()}
      />
    )
  }

  const trips = tab === 'history' ? overview.pastTrips : overview.upcomingTrips
  const nextTrip = overview.upcomingTrips[0] || null

  return (
    <div className="mx-auto max-w-6xl space-y-4 animate-fade-in">
      <header className="bbt-page-header min-h-[150px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="bbt-section-label">Portal do viajante</p>
            <ConnectionBadge online={online} source={source} />
          </div>
          <h1 className="bbt-page-title mt-2 flex items-center gap-2">
            <Navigation className="h-6 w-6 shrink-0 text-bbt-accent" />
            Minha viagem
          </h1>
          <p className="bbt-page-subtitle max-w-2xl">
            Reservas, vouchers e atualizacoes vinculados ao seu cadastro.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {offlineSavedAt ? (
            <button type="button" className="bbt-button-ghost" onClick={() => void clearOffline()}>
              <Trash2 className="h-4 w-4" />
              Remover offline
            </button>
          ) : (
            <button
              type="button"
              className="bbt-button-ghost"
              onClick={() => void saveOffline()}
              disabled={savingOffline || source !== 'online'}
            >
              {savingOffline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Disponibilizar offline
            </button>
          )}
          <button
            type="button"
            className="bbt-button-outline"
            onClick={() => void loadOverview()}
            disabled={loading || !online}
            title="Atualizar viagens"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </header>

      {error ? (
        <div
          className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          role="status"
        >
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {offlineSavedAt ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Copia offline atualizada em {formatDateTime(offlineSavedAt)}. Vouchers em PDF exigem conexao e sessao valida.
        </p>
      ) : null}

      {overview.identitySource === 'unlinked' ? (
        <UnlinkedIdentity supportEmail={overview.support.email} />
      ) : (
        <>
          {nextTrip ? <NextTrip trip={nextTrip} /> : null}

          <div className="border-b border-slate-200 dark:border-slate-800">
            <div
              className="grid grid-cols-3 gap-0 sm:flex sm:gap-1"
              role="tablist"
              aria-label="Visoes do portal do viajante"
            >
              <TabButton
                active={tab === 'upcoming'}
                count={overview.upcomingTrips.length}
                icon={CalendarDays}
                label="Proximas"
                onClick={() => setTab('upcoming')}
              />
              <TabButton
                active={tab === 'history'}
                count={overview.pastTrips.length}
                icon={History}
                label="Historico"
                onClick={() => setTab('history')}
              />
              <TabButton
                active={tab === 'profile'}
                icon={UserRound}
                label="Meu cadastro"
                onClick={() => setTab('profile')}
              />
            </div>
          </div>

          {tab === 'profile' ? (
            <ProfilePanel overview={overview} />
          ) : trips.length ? (
            <section className="grid gap-4 xl:grid-cols-2" aria-live="polite">
              {trips.map((trip) => <TripCard key={trip.id} trip={trip} online={online} />)}
            </section>
          ) : (
            <EmptyTrips history={tab === 'history'} />
          )}
        </>
      )}

      <SupportBar overview={overview} />
    </div>
  )
}

function NextTrip({ trip }: { trip: TravelerTrip }) {
  return (
    <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bbt-badge bg-cyan-50 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
            Proxima viagem
          </span>
          <StatusBadge status={trip.status} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-bbt-primary dark:text-white sm:text-2xl">
          {trip.destination || serviceLabel(trip.serviceType)}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {trip.companyName}
          {trip.demandNumber ? ` · OS ${trip.demandNumber}` : ''}
        </p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <Detail icon={CalendarDays} label="Periodo" value={formatPeriod(trip.startDate, trip.endDate)} />
          <Detail icon={TicketCheck} label="Servicos" value={String(trip.reservations.length || 1)} />
          <Detail icon={FileCheck2} label="Vouchers" value={String(trip.vouchers.length)} />
        </div>
      </div>
      <div className="flex min-h-40 items-center justify-center bg-[#20265a] p-6 text-center text-white">
        <div>
          <MapPin className="mx-auto h-8 w-8 text-bbt-accent" />
          <p className="mt-3 text-xs font-semibold uppercase text-cyan-100/70">Destino</p>
          <p className="mt-1 text-lg font-bold">{trip.destination || 'A confirmar'}</p>
          <p className="mt-2 text-sm text-slate-300">{formatPeriod(trip.startDate, trip.endDate)}</p>
        </div>
      </div>
    </section>
  )
}

function TripCard({ trip, online }: { trip: TravelerTrip; online: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-500">{trip.companyName}</p>
            <h2 className="mt-1 truncate text-lg font-bold text-bbt-primary dark:text-white">
              {trip.destination || serviceLabel(trip.serviceType)}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {formatPeriod(trip.startDate, trip.endDate)}
            </p>
          </div>
          <StatusBadge status={trip.status} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3 text-center dark:border-slate-800">
          <Metric label="Reservas" value={trip.reservations.length} />
          <Metric label="Vouchers" value={trip.vouchers.length} />
          <Metric label="Atualizacoes" value={trip.updates.length} />
        </div>

        {trip.vouchers.length ? (
          <div className="mt-4 space-y-2">
            {trip.vouchers.map((voucher) => (
              <div key={voucher.id} className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Voucher {voucher.code}
                  </p>
                  <p className="text-xs text-slate-500">{statusLabel(voucher.status)}</p>
                </div>
                {voucher.downloadUrl ? (
                  <a
                    className={cn(
                      'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition',
                      online
                        ? 'border-bbt-accent/40 text-bbt-primary hover:bg-cyan-50 dark:text-white dark:hover:bg-cyan-950/30'
                        : 'pointer-events-none border-slate-200 text-slate-400 dark:border-slate-800',
                    )}
                    href={voucher.downloadUrl}
                    aria-disabled={!online}
                  >
                    <Download className="h-4 w-4" />
                    PDF
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">Arquivo indisponivel</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="mt-4 flex h-10 w-full items-center justify-between rounded-md text-sm font-semibold text-bbt-primary hover:bg-slate-50 dark:text-white dark:hover:bg-slate-800"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <span>{expanded ? 'Ocultar detalhes' : 'Ver detalhes'}</span>
          <ArrowRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/30 sm:p-5">
          {trip.reservations.length ? (
            <div className="space-y-3">
              {trip.reservations.map((reservation) => (
                <ReservationDetails key={reservation.id} reservation={reservation} online={online} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhuma reserva detalhada vinculada.</p>
          )}
          {trip.updates.length ? (
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 className="text-sm font-bold text-bbt-primary dark:text-white">Atualizacoes recentes</h3>
              <ol className="mt-3 space-y-3">
                {trip.updates.map((update) => (
                  <li key={update.id} className="flex gap-3 text-sm">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {eventLabel(update.type)}
                        {update.toStatus ? ` · ${statusLabel(update.toStatus)}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(update.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function ReservationDetails({
  reservation,
  online,
}: {
  reservation: TravelerReservation
  online: boolean
}) {
  const Icon = serviceIcon(reservation.serviceType)
  const title = reservation.flightNumber
    ? `Voo ${reservation.flightNumber}`
    : reservation.hotelName || serviceLabel(reservation.serviceType)
  return (
    <section className="min-w-0 border-b border-slate-200 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-bbt-primary shadow-sm dark:bg-slate-800 dark:text-white">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-bbt-primary dark:text-white">{title}</h3>
              <p className="truncate text-xs text-slate-500">
                {reservation.provider}
                {reservation.reference ? ` · ${reservation.reference}` : ''}
              </p>
            </div>
            <StatusBadge status={reservation.status} compact />
          </div>
          <div className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            {reservation.origin || reservation.destination ? (
              <p>{[reservation.origin, reservation.destination].filter(Boolean).join(' → ')}</p>
            ) : null}
            {reservation.startAt ? <p>{formatDateTime(reservation.startAt)}</p> : null}
            {reservation.terminal ? <p>Terminal: {reservation.terminal}</p> : null}
            {reservation.gate ? <p>Portao: {reservation.gate}</p> : null}
            {reservation.address ? <p className="sm:col-span-2">{reservation.address}</p> : null}
          </div>
          {reservation.checkInUrl && online ? (
            <a
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-cyan-700 hover:underline dark:text-cyan-300"
              href={reservation.checkInUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir check-in <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ProfilePanel({ overview }: { overview: TravelerPortalOverview }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {overview.profiles.map((profile) => (
        <article key={profile.id} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bbt-primary text-white">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-bbt-primary dark:text-white">{profile.name}</h2>
              <p className="text-sm text-slate-500">{profile.companyName}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <ProfileField label="ID do viajante" value={profile.identificationCode} icon={IdCard} />
            <ProfileField label="Documento" value={profile.documentMasked || 'Nao informado'} icon={ShieldCheck} />
            <ProfileField label="E-mail" value={profile.email || 'Nao informado'} icon={Mail} />
            <ProfileField label="Telefone" value={profile.phone || 'Nao informado'} icon={Phone} />
            <ProfileField label="Departamento" value={profile.department || 'Nao informado'} icon={Building2} />
            <ProfileField label="Centro de custo" value={profile.costCenter || 'Nao informado'} icon={FileCheck2} />
          </dl>
        </article>
      ))}
    </section>
  )
}

function SupportBar({ overview }: { overview: TravelerPortalOverview }) {
  const { support } = overview
  if (!support.phone && !support.email && !support.emergencyPhone) return null
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <p className="text-sm font-bold text-bbt-primary dark:text-white">{support.label}</p>
        <p className="text-xs text-slate-500">Atendimento vinculado ao seu ambiente corporativo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {support.emergencyPhone ? (
          <a className="bbt-button-primary" href={`tel:${phoneHref(support.emergencyPhone)}`}>
            <Phone className="h-4 w-4" />
            Emergencia
          </a>
        ) : support.phone ? (
          <a className="bbt-button-primary" href={`tel:${phoneHref(support.phone)}`}>
            <Phone className="h-4 w-4" />
            Ligar
          </a>
        ) : null}
        {support.email ? (
          <a className="bbt-button-outline" href={`mailto:${support.email}`}>
            <Mail className="h-4 w-4" />
            E-mail
          </a>
        ) : null}
      </div>
    </section>
  )
}

function UnlinkedIdentity({ supportEmail }: { supportEmail: string | null }) {
  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <IdCard className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div>
          <h2 className="font-bold text-amber-950 dark:text-amber-100">Cadastro de viajante nao vinculado</h2>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/75">
            Sua conta esta ativa, mas ainda nao existe um vinculo seguro com o cadastro de viajante.
          </p>
          {supportEmail ? (
            <a className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-amber-900 underline dark:text-amber-100" href={`mailto:${supportEmail}`}>
              Solicitar vinculacao
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function EmptyTrips({ history }: { history: boolean }) {
  return (
    <section className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-5 text-center dark:border-slate-700 dark:bg-slate-900">
      <CalendarDays className="h-8 w-8 text-slate-400" />
      <h2 className="mt-3 font-bold text-bbt-primary dark:text-white">
        {history ? 'Nenhuma viagem no historico' : 'Nenhuma proxima viagem'}
      </h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        Reservas vinculadas ao seu ID de viajante aparecerao aqui automaticamente.
      </p>
    </section>
  )
}

function PortalState({
  icon: Icon,
  title,
  description,
  action,
  spinning = false,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: () => void
  spinning?: boolean
}) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="max-w-md text-center">
        <Icon className={cn('mx-auto h-9 w-9 text-bbt-primary dark:text-white', spinning && 'animate-spin')} />
        <h1 className="mt-4 text-lg font-bold text-bbt-primary dark:text-white">{title}</h1>
        {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
        {action ? (
          <button type="button" className="bbt-button-primary mt-5" onClick={action}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        ) : null}
      </div>
    </div>
  )
}

function TabButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  count?: number
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'flex h-12 min-w-0 items-center justify-center gap-1.5 border-b-2 px-1 text-xs font-semibold transition sm:h-11 sm:shrink-0 sm:gap-2 sm:px-3 sm:text-sm',
        active
          ? 'border-bbt-accent text-bbt-primary dark:text-white'
          : 'border-transparent text-slate-500 hover:text-bbt-primary dark:hover:text-white',
      )}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 text-center leading-tight">{label}</span>
      {typeof count === 'number' ? (
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{count}</span>
      ) : null}
    </button>
  )
}

function ConnectionBadge({ online, source }: { online: boolean; source: DataSource }) {
  const isOffline = !online || source === 'offline'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold',
      isOffline ? 'bg-amber-300/15 text-amber-100' : 'bg-cyan-300/15 text-cyan-100',
    )}>
      {isOffline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
      {isOffline ? 'Modo offline' : 'Atualizado'}
    </span>
  )
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const tone = statusTone(status)
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center rounded font-semibold',
      compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
      tone,
    )}>
      {statusLabel(status)}
    </span>
  )
}

function Detail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-bbt-accent" />
      <span>
        <span className="block text-xs text-slate-500">{label}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{value}</span>
      </span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-bold text-bbt-primary dark:text-white">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  )
}

function ProfileField({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="flex min-w-0 gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={value}>{value}</dd>
      </div>
    </div>
  )
}

function serviceIcon(serviceType: string): LucideIcon {
  if (/hotel|hosped/i.test(serviceType)) return Hotel
  if (/air|aereo|voo/i.test(serviceType)) return Plane
  return BedDouble
}

function serviceLabel(serviceType: string): string {
  if (/hotel|hosped/i.test(serviceType)) return 'Hospedagem'
  if (/air|aereo|voo/i.test(serviceType)) return 'Viagem aerea'
  if (/voucher/i.test(serviceType)) return 'Voucher'
  return serviceType || 'Viagem corporativa'
}

function statusLabel(status: string): string {
  const normalized = status.toLowerCase()
  if (/confirm/.test(normalized)) return 'Confirmado'
  if (/emit|issued/.test(normalized)) return 'Emitido'
  if (/cancel/.test(normalized)) return 'Cancelado'
  if (/final|conclu|closed/.test(normalized)) return 'Concluido'
  if (/pending|pendente|aguard/.test(normalized)) return 'Pendente'
  if (/draft|rascunho/.test(normalized)) return 'Rascunho'
  if (/reserved|reservado/.test(normalized)) return 'Reservado'
  return status.replace(/[_-]+/g, ' ')
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase()
  if (/cancel|reject/.test(normalized)) return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
  if (/confirm|emit|issued|reserved|conclu|final/.test(normalized)) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
  if (/pending|aguard/.test(normalized)) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
}

function eventLabel(eventType: string): string {
  return eventType.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return 'Datas a confirmar'
  if (start && end && start !== end) return `${formatDate(start)} a ${formatDate(end)}`
  return formatDate(start || end || '')
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
}

function phoneHref(value: string): string {
  return value.replace(/[^\d+]/g, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Nao foi possivel carregar suas viagens.'
}
