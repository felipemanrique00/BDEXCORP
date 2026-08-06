'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  Database,
  Filter,
  Hotel,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'

import { GeographyCombobox } from '@/components/geography/geography-combobox'
import { PageHero } from '@/components/ui/page-hero'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { listCommercialSuppliers } from '@/lib/commercial-suppliers/client'
import {
  COMMERCIAL_SERVICE_TYPES,
  type CommercialServiceType,
  type CommercialSupplier,
} from '@/lib/commercial-suppliers/types'
import {
  getGeographySyncStatus,
  listGeographyCities,
  listGeographyCountries,
  syncGeographyFromIbge,
} from '@/lib/geography/client'
import type {
  GeographyCity,
  GeographyCountry,
  GeographySyncStatus,
} from '@/lib/geography/types'

export const OFFLINE_SERVICE_LABELS: Record<CommercialServiceType, string> = {
  hotel: 'Hotel',
  air: 'Aéreo',
  car: 'Locação de carro',
  bus: 'Rodoviário',
  transfer: 'Transfer',
  insurance: 'Seguro viagem',
  package: 'Pacote',
  other: 'Outro',
}

export const RESERVATION_SYSTEM_LABELS = {
  manual: 'Manual',
  email: 'E-mail',
  portal: 'Portal do fornecedor',
  api: 'API / integração',
  other: 'Outro canal',
} as const

type ReservationSystem = keyof typeof RESERVATION_SYSTEM_LABELS
type SupplierStatus = CommercialSupplier['status']
type OfflineSupplier = CommercialSupplier & {
  reservationSystem?: ReservationSystem
  address?: {
    cityName?: string | null
    subdivisionCode?: string | null
    countryCode?: string | null
  } | null
}

interface SupplierFilters {
  q: string
  serviceType: CommercialServiceType | ''
  cityId: string
  reservationSystem: ReservationSystem | ''
  status: SupplierStatus | ''
}

const EMPTY_FILTERS: SupplierFilters = {
  q: '',
  serviceType: '',
  cityId: '',
  reservationSystem: '',
  status: '',
}

export function OfflineSupplierCatalog() {
  const [suppliers, setSuppliers] = useState<OfflineSupplier[]>([])
  const [filters, setFilters] = useState<SupplierFilters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<SupplierFilters>(EMPTY_FILTERS)
  const [countries, setCountries] = useState<GeographyCountry[]>([])
  const [cities, setCities] = useState<GeographyCity[]>([])
  const [brazilId, setBrazilId] = useState('')
  const [cityQuery, setCityQuery] = useState('')
  const [cityLoading, setCityLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<GeographySyncStatus | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [canSyncGeography, setCanSyncGeography] = useState(false)

  const loadSuppliers = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const query: Record<string, string> = {
        includeInactive: 'true',
        limit: '200',
      }
      if (appliedFilters.q.trim()) query.q = appliedFilters.q.trim()
      if (appliedFilters.serviceType) query.serviceType = appliedFilters.serviceType
      if (appliedFilters.cityId) query.cityId = appliedFilters.cityId
      if (appliedFilters.reservationSystem) query.reservationSystem = appliedFilters.reservationSystem
      if (appliedFilters.status) query.status = appliedFilters.status
      setSuppliers(await listCommercialSuppliers(query) as OfflineSupplier[])
    } catch (error) {
      setSuppliers([])
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os fornecedores.')
    } finally {
      setLoading(false)
    }
  }, [appliedFilters])

  useEffect(() => {
    const user = getCurrentUser()
    setCanManage(Boolean(user && hasPermission(user, 'cadastrar_hoteis')))
    const syncAllowed = Boolean(user && hasPermission(user, 'alterar_configuracoes'))
    setCanSyncGeography(syncAllowed)

    void listGeographyCountries()
      .then((items) => {
        setCountries(items)
        setBrazilId(items.find((country) => country.isoAlpha2 === 'BR')?.id || '')
      })
      .catch(() => setCountries([]))
    if (syncAllowed) void getGeographySyncStatus().then(setSyncStatus).catch(() => undefined)
  }, [])

  useEffect(() => {
    void reloadKey
    void loadSuppliers()
  }, [loadSuppliers, reloadKey])

  useEffect(() => {
    if (!brazilId) {
      setCities([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCityLoading(true)
      void listGeographyCities({
        countryId: brazilId,
        q: cityQuery.trim() || undefined,
        limit: 100,
      }, controller.signal)
        .then(setCities)
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== 'AbortError') setCities([])
        })
        .finally(() => setCityLoading(false))
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [brazilId, cityQuery])

  const cityOptions = useMemo(() => cities.map((city) => ({
    value: city.id,
    label: [city.name, city.subdivisionCode].filter(Boolean).join(' / '),
    keywords: [city.name, city.subdivisionCode || ''],
  })), [cities])

  const activeCount = suppliers.filter((supplier) => supplier.status === 'active').length
  const hotelCount = suppliers.filter((supplier) => supplier.serviceTypes.includes('hotel')).length

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    setAppliedFilters(filters)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setCityQuery('')
  }

  async function synchronizeGeography() {
    setSyncing(true)
    try {
      const result = await syncGeographyFromIbge()
      toast.success(`Base atualizada: ${result.countries} países, ${result.subdivisions} estados e ${result.cities} cidades.`)
      setSyncStatus(await getGeographySyncStatus())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a base geográfica.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Cadastros comerciais"
        title="Fornecedores offline"
        icon={Building2}
        description="Entidades comerciais, propriedades, canais e tarifas usados nas cotações e reservas offline."
        metrics={[
          { icon: Building2, label: 'Fornecedores exibidos', value: suppliers.length },
          { icon: RefreshCw, label: 'Ativos', value: activeCount },
          { icon: Hotel, label: 'Atendem hotel', value: hotelCount },
          { icon: Database, label: 'Países na base', value: countries.length },
        ]}
        actions={canManage ? (
          <Link
            href="/dashboard/fornecedores/novo"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#20265a] hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Novo fornecedor
          </Link>
        ) : undefined}
      />

      <section className="bbt-card p-4" aria-labelledby="supplier-filter-title">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="supplier-filter-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
              <Filter className="h-4 w-4 text-bbt-accent" aria-hidden="true" /> Pesquisa
            </h2>
            <p className="mt-1 text-xs text-slate-500">Combine os filtros para localizar o cadastro operacional correto.</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={loading}
            className="bbt-button-ghost h-9 px-3"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
          </button>
        </div>

        <form onSubmit={applyFilters} className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
          <label className="block xl:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Nome, código ou documento</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                placeholder="Digite para pesquisar..."
                className="bbt-input pl-9"
                maxLength={160}
              />
            </span>
          </label>
          <SelectField
            label="Tipo de serviço"
            value={filters.serviceType}
            onChange={(serviceType) => setFilters((current) => ({ ...current, serviceType: serviceType as CommercialServiceType | '' }))}
          >
            <option value="">Todos os tipos</option>
            {COMMERCIAL_SERVICE_TYPES.map((service) => <option key={service} value={service}>{OFFLINE_SERVICE_LABELS[service]}</option>)}
          </SelectField>
          <GeographyCombobox
            id="supplier-filter-city"
            label="Cidade (Brasil)"
            value={filters.cityId}
            options={cityOptions}
            loading={cityLoading}
            disabled={!brazilId}
            emptyMessage="Nenhuma cidade encontrada."
            onSearchChange={setCityQuery}
            onChange={(cityId) => setFilters((current) => ({ ...current, cityId }))}
          />
          <SelectField
            label="Sistema / canal"
            value={filters.reservationSystem}
            onChange={(reservationSystem) => setFilters((current) => ({ ...current, reservationSystem: reservationSystem as ReservationSystem | '' }))}
          >
            <option value="">Todos os canais</option>
            {Object.entries(RESERVATION_SYSTEM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          <SelectField
            label="Status"
            value={filters.status}
            onChange={(status) => setFilters((current) => ({ ...current, status: status as SupplierStatus | '' }))}
          >
            <option value="">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="blocked">Bloqueado</option>
          </SelectField>
          <div className="flex items-end gap-2 lg:col-span-2 xl:col-span-4 xl:justify-end">
            <button type="button" onClick={clearFilters} className="bbt-button-ghost h-10 px-4">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Limpar
            </button>
            <button type="submit" className="bbt-button-primary h-10 px-5">
              <Filter className="h-4 w-4" aria-hidden="true" /> Aplicar filtros
            </button>
          </div>
        </form>
      </section>

      <section className="bbt-card overflow-hidden" aria-labelledby="supplier-results-title" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
          <div>
            <h2 id="supplier-results-title" className="font-semibold text-bbt-primary dark:text-white">Fornecedores cadastrados</h2>
            <p className="text-xs text-slate-500">{loading ? 'Atualizando resultados...' : `${suppliers.length} registro(s) encontrado(s).`}</p>
          </div>
        </div>

        {loading ? (
          <StatusState icon={Loader2} title="Carregando fornecedores..." spin />
        ) : loadError ? (
          <StatusState
            icon={RefreshCw}
            title="Não foi possível carregar os fornecedores"
            description={loadError}
            action={<button type="button" onClick={() => setReloadKey((value) => value + 1)} className="bbt-button-outline mt-4">Tentar novamente</button>}
          />
        ) : suppliers.length === 0 ? (
          <StatusState
            icon={Building2}
            title="Nenhum fornecedor encontrado"
            description="Revise os filtros ou cadastre um novo fornecedor offline."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">Lista de fornecedores comerciais offline</caption>
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
                <tr>
                  <th scope="col" className="px-4 py-3">Fornecedor</th>
                  <th scope="col" className="px-4 py-3">Localidade</th>
                  <th scope="col" className="px-4 py-3">Canal</th>
                  <th scope="col" className="px-4 py-3">Serviços</th>
                  <th scope="col" className="px-4 py-3">Contato de reservas</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {suppliers.map((supplier) => {
                  const contact = supplier.contacts.find((item) => item.type === 'reservation' && item.isPrimary)
                    || supplier.contacts.find((item) => item.type === 'reservation')
                    || supplier.contacts.find((item) => item.isPrimary)
                    || supplier.contacts[0]
                  const location = [
                    supplier.address?.cityName,
                    supplier.address?.subdivisionCode,
                    supplier.address?.countryCode,
                  ].filter(Boolean).join(' / ')
                  return (
                    <tr key={supplier.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        {canManage ? (
                          <Link href={`/dashboard/fornecedores/${supplier.id}`} className="font-semibold text-bbt-primary hover:text-bbt-accent hover:underline dark:text-white">
                            {supplier.tradeName || supplier.legalName}
                          </Link>
                        ) : (
                          <span className="font-semibold text-bbt-primary dark:text-white">{supplier.tradeName || supplier.legalName}</span>
                        )}
                        <div className="mt-0.5 text-xs text-slate-500">{supplier.internalCode} · {supplier.legalName}</div>
                        {supplier.documentNumber && <div className="mt-0.5 text-xs text-slate-400">{supplier.documentNumber}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {location || 'Não informada'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {RESERVATION_SYSTEM_LABELS[supplier.reservationSystem || 'manual']}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {supplier.serviceTypes.map((service) => (
                            <span key={service} className="bbt-badge bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                              {OFFLINE_SERVICE_LABELS[service]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="font-medium">{contact?.name || 'Não informado'}</div>
                        <div className="mt-0.5 text-slate-400">{contact?.email || contact?.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3"><SupplierStatusBadge status={supplier.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/fornecedores/${supplier.id}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-cyan-50 hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-300 dark:hover:bg-cyan-950/30"
                          aria-label={`Editar ${supplier.tradeName || supplier.legalName}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bbt-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Base geográfica oficial">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
            <Database className="h-4 w-4 text-bbt-accent" aria-hidden="true" /> Base geográfica oficial
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {syncStatus?.datasetVersion
              ? `Versão validada em ${new Date(syncStatus.datasetVersion.activatedAt).toLocaleString('pt-BR')} · ${syncStatus.datasetVersion.recordCount.toLocaleString('pt-BR')} registros.`
              : 'Países, estados e cidades são lidos da cópia validada no PostgreSQL.'}
          </p>
        </div>
        {canSyncGeography && (
          <button type="button" onClick={() => void synchronizeGeography()} disabled={syncing} className="bbt-button-outline shrink-0">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {syncing ? 'Sincronizando...' : 'Sincronizar localidades'}
          </button>
        )}
      </section>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="bbt-input">
        {children}
      </select>
    </label>
  )
}

function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const config = status === 'active'
    ? ['Ativo', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300']
    : status === 'blocked'
      ? ['Bloqueado', 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300']
      : ['Inativo', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300']
  return <span className={`bbt-badge ${config[1]}`}>{config[0]}</span>
}

function StatusState({
  icon: Icon,
  title,
  description,
  action,
  spin = false,
}: {
  icon: typeof Building2
  title: string
  description?: string
  action?: React.ReactNode
  spin?: boolean
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center" role="status">
      <Icon className={`h-7 w-7 text-slate-400 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />
      <p className="mt-3 font-semibold text-bbt-primary dark:text-white">{title}</p>
      {description && <p className="mt-1 max-w-xl text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  )
}
