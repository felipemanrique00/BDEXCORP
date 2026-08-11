'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeft,
  Building2,
  FileCheck2,
  Hotel,
  Loader2,
  MapPin,
  Save,
  Tags,
} from 'lucide-react'
import { toast } from 'sonner'

import { GeographyCombobox } from '@/components/geography/geography-combobox'
import { OfflineSupplierHotelLinks } from '@/components/suppliers/offline-supplier-hotel-links'
import { OfflineSupplierRates } from '@/components/suppliers/offline-supplier-rates'
import {
  OFFLINE_SERVICE_LABELS,
  RESERVATION_SYSTEM_LABELS,
} from '@/components/suppliers/offline-supplier-catalog'
import { PageHero } from '@/components/ui/page-hero'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  createCommercialSupplier,
  getCommercialSupplier,
  updateCommercialSupplier,
} from '@/lib/commercial-suppliers/client'
import {
  COMMERCIAL_SERVICE_TYPES,
  type CommercialReservationSystem,
  type CommercialServiceType,
  type CommercialSupplier,
  type CommercialSupplierContact,
} from '@/lib/commercial-suppliers/types'
import {
  listGeographyCities,
  listGeographyCountries,
  listGeographySubdivisions,
} from '@/lib/geography/client'
import type {
  GeographyCity,
  GeographyCountry,
  GeographySubdivision,
} from '@/lib/geography/types'

type EditorTab = 'general' | 'hotels' | 'rates' | 'agreements'

interface ContactDraft {
  name: string
  email: string
  phone: string
  fax: string
}

interface SupplierDraft {
  internalCode: string
  legalName: string
  tradeName: string
  documentType: CommercialSupplier['documentType']
  documentNumber: string
  serviceTypes: CommercialServiceType[]
  reservationSystem: CommercialReservationSystem
  status: CommercialSupplier['status']
  website: string
  paymentTerms: string
  notes: string
  countryId: string
  subdivisionId: string
  cityId: string
  cityLabel: string
  postalCode: string
  street: string
  streetNumber: string
  complement: string
  district: string
  latitude: string
  longitude: string
  formattedAddress: string
  reservationContact: ContactDraft
  financialContact: ContactDraft
}

const EMPTY_CONTACT: ContactDraft = { name: '', email: '', phone: '', fax: '' }

const EMPTY_DRAFT: SupplierDraft = {
  internalCode: '',
  legalName: '',
  tradeName: '',
  documentType: 'cnpj',
  documentNumber: '',
  serviceTypes: ['hotel'],
  reservationSystem: 'manual',
  status: 'active',
  website: '',
  paymentTerms: '',
  notes: '',
  countryId: '',
  subdivisionId: '',
  cityId: '',
  cityLabel: '',
  postalCode: '',
  street: '',
  streetNumber: '',
  complement: '',
  district: '',
  latitude: '',
  longitude: '',
  formattedAddress: '',
  reservationContact: { ...EMPTY_CONTACT },
  financialContact: { ...EMPTY_CONTACT },
}

const TABS: Array<{ id: EditorTab; label: string; icon: typeof Building2 }> = [
  { id: 'general', label: 'Dados gerais', icon: Building2 },
  { id: 'hotels', label: 'Hotéis vinculados', icon: Hotel },
  { id: 'rates', label: 'Tarifas', icon: Tags },
  { id: 'agreements', label: 'Acordos por empresa', icon: FileCheck2 },
]

export function OfflineSupplierEditor({
  mode,
  supplierId,
}: {
  mode: 'create' | 'edit'
  supplierId?: string
}) {
  const router = useRouter()
  const [supplier, setSupplier] = useState<CommercialSupplier | null>(null)
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_DRAFT))
  const [activeTab, setActiveTab] = useState<EditorTab>('general')
  const [loading, setLoading] = useState(mode === 'edit')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [countries, setCountries] = useState<GeographyCountry[]>([])
  const [subdivisions, setSubdivisions] = useState<GeographySubdivision[]>([])
  const [cities, setCities] = useState<GeographyCity[]>([])
  const [cityQuery, setCityQuery] = useState('')
  const [geoLoading, setGeoLoading] = useState({ countries: true, subdivisions: false, cities: false })
  const [canManage, setCanManage] = useState(false)
  const initializedCountryRef = useRef(false)

  const dirty = JSON.stringify(draft) !== baseline
  const resolvedSupplierId = supplier?.id || supplierId || ''
  const hotelModuleEnabled = Boolean(resolvedSupplierId && supplier?.serviceTypes.includes('hotel'))

  useEffect(() => {
    const user = getCurrentUser()
    setCanManage(Boolean(user && hasPermission(user, 'cadastrar_hoteis')))
  }, [])

  useEffect(() => {
    let active = true
    setGeoLoading((current) => ({ ...current, countries: true }))
    void listGeographyCountries()
      .then((items) => {
        if (!active) return
        setCountries(items)
        if (mode === 'create' && !initializedCountryRef.current) {
          const brazil = items.find((country) => country.isoAlpha2 === 'BR')
          if (brazil) {
            initializedCountryRef.current = true
            setDraft((current) => ({ ...current, countryId: brazil.id }))
          }
        }
      })
      .catch(() => {
        if (active) setCountries([])
      })
      .finally(() => {
        if (active) setGeoLoading((current) => ({ ...current, countries: false }))
      })
    return () => { active = false }
  }, [mode])

  useEffect(() => {
    if (mode !== 'edit' || !supplierId) return
    let active = true
    setLoading(true)
    setLoadError('')
    void getCommercialSupplier(supplierId)
      .then((item) => {
        if (!active) return
        const next = supplierToDraft(item)
        initializedCountryRef.current = true
        setSupplier(item)
        setDraft(next)
        setBaseline(JSON.stringify(next))
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o fornecedor.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [mode, supplierId])

  useEffect(() => {
    if (!draft.countryId) {
      setSubdivisions([])
      return
    }
    const controller = new AbortController()
    setGeoLoading((current) => ({ ...current, subdivisions: true }))
    void listGeographySubdivisions(draft.countryId, controller.signal)
      .then(setSubdivisions)
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') setSubdivisions([])
      })
      .finally(() => setGeoLoading((current) => ({ ...current, subdivisions: false })))
    return () => controller.abort()
  }, [draft.countryId])

  useEffect(() => {
    if (!draft.countryId || !draft.subdivisionId) {
      setCities([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setGeoLoading((current) => ({ ...current, cities: true }))
      void listGeographyCities({
        countryId: draft.countryId,
        subdivisionId: draft.subdivisionId,
        q: cityQuery.trim() || undefined,
        limit: 150,
      }, controller.signal)
        .then(setCities)
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== 'AbortError') setCities([])
        })
        .finally(() => setGeoLoading((current) => ({ ...current, cities: false })))
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [cityQuery, draft.countryId, draft.subdivisionId])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (hotelModuleEnabled || activeTab === 'general') return
    setActiveTab('general')
  }, [activeTab, hotelModuleEnabled])

  const countryOptions = useMemo(() => countries.map((country) => ({
    value: country.id,
    label: country.name,
    keywords: [country.isoAlpha2, country.isoAlpha3 || ''],
  })), [countries])
  const subdivisionOptions = useMemo(() => subdivisions.map((subdivision) => ({
    value: subdivision.id,
    label: `${subdivision.code} - ${subdivision.name}`,
    keywords: [subdivision.code, subdivision.name],
  })), [subdivisions])
  const cityOptions = useMemo(() => {
    const options = cities.map((city) => ({ value: city.id, label: city.name }))
    if (draft.cityId && !options.some((option) => option.value === draft.cityId) && draft.cityLabel) {
      options.unshift({ value: draft.cityId, label: draft.cityLabel })
    }
    return options
  }, [cities, draft.cityId, draft.cityLabel])

  function patchDraft(patch: Partial<SupplierDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function toggleService(service: CommercialServiceType) {
    setDraft((current) => ({
      ...current,
      serviceTypes: current.serviceTypes.includes(service)
        ? current.serviceTypes.filter((item) => item !== service)
        : [...current.serviceTypes, service],
    }))
  }

  async function saveSupplier(event?: FormEvent) {
    event?.preventDefault()
    if (!canManage) return
    const validationError = validateDraft(draft)
    if (validationError) {
      setFormError(validationError)
      toast.error(validationError)
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const payload = draftToPayload(draft, supplier)
      const saved = mode === 'edit' && supplier
        ? await updateCommercialSupplier(supplier.id, { ...payload, expectedVersion: supplier.version })
        : await createCommercialSupplier(payload)
      const next = supplierToDraft(saved)
      setSupplier(saved)
      setDraft(next)
      setBaseline(JSON.stringify(next))
      toast.success(mode === 'edit' ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.')
      if (mode === 'create') router.replace(`/dashboard/fornecedores/${saved.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar o fornecedor.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  function leaveEditor(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!dirty || window.confirm('Existem alterações não salvas. Deseja sair mesmo assim?')) return
    event.preventDefault()
  }

  if (loading) return <EditorState icon={Loader2} title="Carregando cadastro..." spin />
  if (loadError) {
    return (
      <EditorState
        icon={Building2}
        title="Não foi possível abrir o fornecedor"
        description={loadError}
        action={<Link href="/dashboard/fornecedores" className="bbt-button-outline mt-4">Voltar aos fornecedores</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Cadastro comercial offline"
        title={mode === 'create' ? 'Novo fornecedor' : (supplier?.tradeName || supplier?.legalName || 'Fornecedor')}
        icon={Building2}
        description={mode === 'create'
          ? 'Cadastre primeiro os dados gerais; hotéis, tarifas e acordos serão habilitados após salvar.'
          : `${supplier?.internalCode || ''} · ${RESERVATION_SYSTEM_LABELS[supplier?.reservationSystem || 'manual']}`}
        actions={(
          <>
            <Link
              href="/dashboard/fornecedores"
              onClick={leaveEditor}
              className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar
            </Link>
            {canManage && activeTab === 'general' && (
              <button
                type="button"
                onClick={() => void saveSupplier()}
                disabled={saving || !dirty}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#20265a] hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            )}
          </>
        )}
      />

      {!canManage && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Você pode consultar este cadastro, mas não possui permissão para alterá-lo.
        </div>
      )}

      <AccessibleTabs
        active={activeTab}
        onChange={setActiveTab}
        disabledTabs={hotelModuleEnabled ? [] : ['hotels', 'rates', 'agreements']}
      />

      {activeTab === 'general' && (
        <section id="supplier-panel-general" role="tabpanel" aria-labelledby="supplier-tab-general" tabIndex={0}>
          <form onSubmit={(event) => void saveSupplier(event)} className="space-y-6">
            {formError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {formError}
              </div>
            )}

            <GeneralDataSection draft={draft} disabled={!canManage || saving} patchDraft={patchDraft} toggleService={toggleService} />
            <AddressSection
              draft={draft}
              disabled={!canManage || saving}
              patchDraft={patchDraft}
              countryOptions={countryOptions}
              subdivisionOptions={subdivisionOptions}
              cityOptions={cityOptions}
              geoLoading={geoLoading}
              setCityQuery={setCityQuery}
            />
            <ContactsSection draft={draft} disabled={!canManage || saving} patchDraft={patchDraft} />
            <CommercialTermsSection draft={draft} disabled={!canManage || saving} patchDraft={patchDraft} />

            {canManage && (
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-bbt-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                <span className="mr-auto text-xs text-slate-500">{dirty ? 'Existem alterações não salvas.' : 'Cadastro atualizado.'}</span>
                <Link href="/dashboard/fornecedores" onClick={leaveEditor} className="bbt-button-ghost">Cancelar</Link>
                <button type="submit" disabled={saving || !dirty} className="bbt-button-primary">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  {saving ? 'Salvando...' : 'Salvar fornecedor'}
                </button>
              </div>
            )}
          </form>
        </section>
      )}

      {activeTab === 'hotels' && resolvedSupplierId && (
        <section id="supplier-panel-hotels" role="tabpanel" aria-labelledby="supplier-tab-hotels" tabIndex={0}>
          <OfflineSupplierHotelLinks supplierId={resolvedSupplierId} canManage={canManage} />
        </section>
      )}
      {activeTab === 'rates' && resolvedSupplierId && (
        <section id="supplier-panel-rates" role="tabpanel" aria-labelledby="supplier-tab-rates" tabIndex={0}>
          <OfflineSupplierRates supplierId={resolvedSupplierId} scope="global" canManage={canManage} />
        </section>
      )}
      {activeTab === 'agreements' && resolvedSupplierId && (
        <section id="supplier-panel-agreements" role="tabpanel" aria-labelledby="supplier-tab-agreements" tabIndex={0}>
          <OfflineSupplierRates supplierId={resolvedSupplierId} scope="restricted" canManage={canManage} />
        </section>
      )}
    </div>
  )
}

function GeneralDataSection({
  draft,
  disabled,
  patchDraft,
  toggleService,
}: {
  draft: SupplierDraft
  disabled: boolean
  patchDraft: (patch: Partial<SupplierDraft>) => void
  toggleService: (service: CommercialServiceType) => void
}) {
  return (
    <FormCard title="Identificação e operação" description="Dados fiscais e canal utilizado na reserva offline." icon={Building2}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Código interno" required>
          <input className="bbt-input" value={draft.internalCode} onChange={(event) => patchDraft({ internalCode: event.target.value })} disabled={disabled} required maxLength={120} />
        </Field>
        <Field label="Tipo de documento">
          <select className="bbt-input" value={draft.documentType} onChange={(event) => patchDraft({ documentType: event.target.value as SupplierDraft['documentType'] })} disabled={disabled}>
            <option value="cnpj">CNPJ</option>
            <option value="cpf">CPF</option>
            <option value="foreign_tax_id">Documento estrangeiro</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="CNPJ / documento">
          <input className="bbt-input" value={draft.documentNumber} onChange={(event) => patchDraft({ documentNumber: event.target.value })} disabled={disabled} maxLength={80} inputMode="numeric" />
        </Field>
        <Field label="Status">
          <select className="bbt-input" value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as SupplierDraft['status'] })} disabled={disabled}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="blocked">Bloqueado</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Razão social" required>
            <input className="bbt-input" value={draft.legalName} onChange={(event) => patchDraft({ legalName: event.target.value })} disabled={disabled} required maxLength={300} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Nome fantasia">
            <input className="bbt-input" value={draft.tradeName} onChange={(event) => patchDraft({ tradeName: event.target.value })} disabled={disabled} maxLength={300} />
          </Field>
        </div>
        <Field label="Sistema / canal de reserva">
          <select className="bbt-input" value={draft.reservationSystem} onChange={(event) => patchDraft({ reservationSystem: event.target.value as CommercialReservationSystem })} disabled={disabled}>
            {Object.entries(RESERVATION_SYSTEM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2 xl:col-span-3">
          <Field label="Website">
            <input type="url" className="bbt-input" value={draft.website} onChange={(event) => patchDraft({ website: event.target.value })} disabled={disabled} placeholder="https://..." maxLength={500} />
          </Field>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Tipos de serviço *</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {COMMERCIAL_SERVICE_TYPES.map((service) => (
            <label key={service} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-bbt-gray-100 px-3 py-2 text-sm dark:border-slate-700">
              <input type="checkbox" checked={draft.serviceTypes.includes(service)} onChange={() => toggleService(service)} disabled={disabled} className="h-4 w-4 accent-bbt-accent" />
              {OFFLINE_SERVICE_LABELS[service]}
            </label>
          ))}
        </div>
      </fieldset>
    </FormCard>
  )
}

function AddressSection({
  draft,
  disabled,
  patchDraft,
  countryOptions,
  subdivisionOptions,
  cityOptions,
  geoLoading,
  setCityQuery,
}: {
  draft: SupplierDraft
  disabled: boolean
  patchDraft: (patch: Partial<SupplierDraft>) => void
  countryOptions: Array<{ value: string; label: string; keywords: string[] }>
  subdivisionOptions: Array<{ value: string; label: string; keywords: string[] }>
  cityOptions: Array<{ value: string; label: string }>
  geoLoading: { countries: boolean; subdivisions: boolean; cities: boolean }
  setCityQuery: (value: string) => void
}) {
  return (
    <FormCard title="Endereço" description="Localidade oficial e dados de localização do fornecedor." icon={MapPin}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GeographyCombobox
          id="supplier-country"
          label="País"
          value={draft.countryId}
          options={countryOptions}
          loading={geoLoading.countries}
          disabled={disabled || geoLoading.countries}
          onChange={(countryId) => {
            patchDraft({ countryId, subdivisionId: '', cityId: '', cityLabel: '' })
            setCityQuery('')
          }}
        />
        <GeographyCombobox
          id="supplier-subdivision"
          label="Estado / província"
          value={draft.subdivisionId}
          options={subdivisionOptions}
          loading={geoLoading.subdivisions}
          disabled={disabled || !draft.countryId || geoLoading.subdivisions}
          emptyMessage="Nenhum estado carregado. Sincronize a base de localidades no cadastro de fornecedores."
          onChange={(subdivisionId) => {
            patchDraft({ subdivisionId, cityId: '', cityLabel: '' })
            setCityQuery('')
          }}
        />
        <GeographyCombobox
          id="supplier-city"
          label="Cidade"
          value={draft.cityId}
          options={cityOptions}
          loading={geoLoading.cities}
          disabled={disabled || !draft.subdivisionId}
          emptyMessage="Nenhuma cidade encontrada. Verifique se a base de localidades foi sincronizada."
          onSearchChange={setCityQuery}
          onChange={(cityId, option) => patchDraft({ cityId, cityLabel: option?.label || '' })}
        />
        <Field label="CEP">
          <input className="bbt-input" value={draft.postalCode} onChange={(event) => patchDraft({ postalCode: event.target.value })} disabled={disabled} inputMode="numeric" maxLength={40} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Logradouro">
            <input className="bbt-input" value={draft.street} onChange={(event) => patchDraft({ street: event.target.value })} disabled={disabled} maxLength={500} />
          </Field>
        </div>
        <Field label="Número">
          <input className="bbt-input" value={draft.streetNumber} onChange={(event) => patchDraft({ streetNumber: event.target.value })} disabled={disabled} maxLength={80} />
        </Field>
        <Field label="Bairro">
          <input className="bbt-input" value={draft.district} onChange={(event) => patchDraft({ district: event.target.value })} disabled={disabled} maxLength={200} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Complemento">
            <input className="bbt-input" value={draft.complement} onChange={(event) => patchDraft({ complement: event.target.value })} disabled={disabled} maxLength={300} />
          </Field>
        </div>
        <Field label="Latitude">
          <input type="number" step="any" min="-90" max="90" className="bbt-input" value={draft.latitude} onChange={(event) => patchDraft({ latitude: event.target.value })} disabled={disabled} placeholder="-16.6869" />
        </Field>
        <Field label="Longitude">
          <input type="number" step="any" min="-180" max="180" className="bbt-input" value={draft.longitude} onChange={(event) => patchDraft({ longitude: event.target.value })} disabled={disabled} placeholder="-49.2648" />
        </Field>
        <div className="md:col-span-2 xl:col-span-4">
          <Field label="Endereço formatado / referência">
            <input className="bbt-input" value={draft.formattedAddress} onChange={(event) => patchDraft({ formattedAddress: event.target.value })} disabled={disabled} maxLength={1000} />
          </Field>
        </div>
      </div>
    </FormCard>
  )
}

function ContactsSection({ draft, disabled, patchDraft }: {
  draft: SupplierDraft
  disabled: boolean
  patchDraft: (patch: Partial<SupplierDraft>) => void
}) {
  function patchContact(key: 'reservationContact' | 'financialContact', patch: Partial<ContactDraft>) {
    patchDraft({ [key]: { ...draft[key], ...patch } } as Pick<SupplierDraft, typeof key>)
  }

  return (
    <FormCard title="Contatos por departamento" description="Informe e-mail ou telefone quando um contato for preenchido." icon={Building2}>
      <div className="grid gap-5 xl:grid-cols-2">
        <ContactCard title="Departamento de reservas" contact={draft.reservationContact} disabled={disabled} onChange={(patch) => patchContact('reservationContact', patch)} />
        <ContactCard title="Departamento financeiro" contact={draft.financialContact} disabled={disabled} onChange={(patch) => patchContact('financialContact', patch)} />
      </div>
    </FormCard>
  )
}

function ContactCard({ title, contact, disabled, onChange }: {
  title: string
  contact: ContactDraft
  disabled: boolean
  onChange: (patch: Partial<ContactDraft>) => void
}) {
  return (
    <fieldset className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
      <legend className="px-2 text-sm font-semibold text-bbt-primary dark:text-white">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Nome"><input className="bbt-input" value={contact.name} onChange={(event) => onChange({ name: event.target.value })} disabled={disabled} maxLength={200} /></Field></div>
        <Field label="E-mail"><input type="email" className="bbt-input" value={contact.email} onChange={(event) => onChange({ email: event.target.value })} disabled={disabled} maxLength={320} /></Field>
        <Field label="Telefone"><input type="tel" className="bbt-input" value={contact.phone} onChange={(event) => onChange({ phone: event.target.value })} disabled={disabled} maxLength={80} /></Field>
        <Field label="Fax"><input type="tel" className="bbt-input" value={contact.fax} onChange={(event) => onChange({ fax: event.target.value })} disabled={disabled} maxLength={80} /></Field>
      </div>
    </fieldset>
  )
}

function CommercialTermsSection({ draft, disabled, patchDraft }: {
  draft: SupplierDraft
  disabled: boolean
  patchDraft: (patch: Partial<SupplierDraft>) => void
}) {
  return (
    <FormCard title="Condições comerciais" description="Orientações padrão para cotação, faturamento e operação." icon={FileCheck2}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Condições de pagamento">
          <textarea className="bbt-input min-h-28 py-2" value={draft.paymentTerms} onChange={(event) => patchDraft({ paymentTerms: event.target.value })} disabled={disabled} maxLength={4000} />
        </Field>
        <Field label="Observações operacionais">
          <textarea className="bbt-input min-h-28 py-2" value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} disabled={disabled} maxLength={4000} />
        </Field>
      </div>
    </FormCard>
  )
}

function AccessibleTabs({
  active,
  onChange,
  disabledTabs,
}: {
  active: EditorTab
  onChange: (tab: EditorTab) => void
  disabledTabs: EditorTab[]
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: EditorTab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const enabled = TABS.filter((tab) => !disabledTabs.includes(tab.id))
    const index = enabled.findIndex((tab) => tab.id === current)
    const next = event.key === 'Home'
      ? enabled[0]
      : event.key === 'End'
        ? enabled[enabled.length - 1]
        : enabled[(index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.id)
    document.getElementById(`supplier-tab-${next.id}`)?.focus()
  }

  return (
    <nav className="bbt-card overflow-x-auto p-2" aria-label="Seções do cadastro">
      <div className="flex min-w-max gap-1" role="tablist" aria-label="Cadastro do fornecedor">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const disabled = disabledTabs.includes(tab.id)
          return (
            <button
              key={tab.id}
              id={`supplier-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              aria-controls={`supplier-panel-${tab.id}`}
              aria-disabled={disabled}
              tabIndex={active === tab.id ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-bbt-accent/30 ${
                active === tab.id
                  ? 'bg-bbt-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
              title={disabled ? 'Salve o fornecedor com o tipo de serviço Hotel para habilitar esta seção.' : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function FormCard({ title, description, icon: Icon, children }: {
  title: string
  description: string
  icon: typeof Building2
  children: ReactNode
}) {
  return (
    <section className="bbt-card p-5">
      <div className="mb-5 flex items-start gap-3 border-b border-bbt-gray-100 pb-4 dark:border-slate-700">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300"><Icon className="h-4 w-4" aria-hidden="true" /></div>
        <div><h2 className="font-semibold text-bbt-primary dark:text-white">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}{required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
    </label>
  )
}

function EditorState({ icon: Icon, title, description, action, spin = false }: {
  icon: typeof Building2
  title: string
  description?: string
  action?: ReactNode
  spin?: boolean
}) {
  return (
    <div className="bbt-card flex min-h-[28rem] flex-col items-center justify-center p-8 text-center" role="status">
      <Icon className={`h-8 w-8 text-slate-400 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />
      <h1 className="mt-4 text-lg font-semibold text-bbt-primary dark:text-white">{title}</h1>
      {description && <p className="mt-2 max-w-xl text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  )
}

function supplierToDraft(supplier: CommercialSupplier): SupplierDraft {
  const reservation = contactDraft(supplier.contacts, 'reservation')
  const financial = contactDraft(supplier.contacts, 'financial')
  const paymentTerms = typeof supplier.paymentTerms.description === 'string'
    ? supplier.paymentTerms.description
    : typeof supplier.paymentTerms.notes === 'string'
      ? supplier.paymentTerms.notes
      : ''
  return {
    internalCode: supplier.internalCode,
    legalName: supplier.legalName,
    tradeName: supplier.tradeName || '',
    documentType: supplier.documentType,
    documentNumber: supplier.documentNumber || '',
    serviceTypes: supplier.serviceTypes,
    reservationSystem: supplier.reservationSystem,
    status: supplier.status,
    website: supplier.website || '',
    paymentTerms,
    notes: supplier.notes || '',
    countryId: supplier.address?.countryId || '',
    subdivisionId: supplier.address?.subdivisionId || '',
    cityId: supplier.address?.cityId || '',
    cityLabel: supplier.address?.cityName || '',
    postalCode: supplier.address?.postalCode || '',
    street: supplier.address?.street || '',
    streetNumber: supplier.address?.streetNumber || '',
    complement: supplier.address?.complement || '',
    district: supplier.address?.district || '',
    latitude: supplier.address?.latitude == null ? '' : String(supplier.address.latitude),
    longitude: supplier.address?.longitude == null ? '' : String(supplier.address.longitude),
    formattedAddress: supplier.address?.formattedAddress || '',
    reservationContact: reservation,
    financialContact: financial,
  }
}

function contactDraft(contacts: CommercialSupplierContact[], type: CommercialSupplierContact['type']): ContactDraft {
  const contact = contacts.find((item) => item.type === type && item.isPrimary)
    || contacts.find((item) => item.type === type)
  return {
    name: contact?.name || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    fax: contact?.fax || '',
  }
}

function draftToPayload(draft: SupplierDraft, currentSupplier?: CommercialSupplier | null) {
  const managedContacts = [
    contactToPayload('reservation', draft.reservationContact),
    contactToPayload('financial', draft.financialContact),
  ].flatMap((contact) => contact ? [contact] : [])
  const preservedContacts = (currentSupplier?.contacts || [])
    .filter((contact) => contact.type !== 'reservation' && contact.type !== 'financial')
    .map((contact) => ({
      type: contact.type,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      fax: contact.fax,
      isPrimary: contact.isPrimary,
    }))
  const addressValues = {
    countryId: draft.countryId || null,
    subdivisionId: draft.subdivisionId || null,
    cityId: draft.cityId || null,
    postalCode: draft.postalCode.trim() || null,
    street: draft.street.trim() || null,
    streetNumber: draft.streetNumber.trim() || null,
    complement: draft.complement.trim() || null,
    district: draft.district.trim() || null,
    latitude: draft.latitude === '' ? null : Number(draft.latitude),
    longitude: draft.longitude === '' ? null : Number(draft.longitude),
    formattedAddress: draft.formattedAddress.trim() || null,
  }
  const hasAddress = Object.values(addressValues).some((value) => value !== null && value !== '')
  return {
    internalCode: draft.internalCode.trim(),
    legalName: draft.legalName.trim(),
    tradeName: draft.tradeName.trim() || null,
    documentType: draft.documentType,
    documentNumber: draft.documentNumber.trim() || null,
    serviceTypes: draft.serviceTypes,
    reservationSystem: draft.reservationSystem,
    status: draft.status,
    website: draft.website.trim() || null,
    notes: draft.notes.trim() || null,
    paymentTerms: { ...(currentSupplier?.paymentTerms || {}), description: draft.paymentTerms.trim() },
    contacts: [...preservedContacts, ...managedContacts],
    address: hasAddress ? addressValues : null,
  }
}

function contactToPayload(type: 'reservation' | 'financial', contact: ContactDraft) {
  const hasValue = Object.values(contact).some((value) => value.trim())
  if (!hasValue) return null
  return {
    type,
    name: contact.name.trim() || null,
    email: contact.email.trim() || null,
    phone: contact.phone.trim() || null,
    fax: contact.fax.trim() || null,
    isPrimary: true,
  }
}

function validateDraft(draft: SupplierDraft): string | null {
  if (!draft.internalCode.trim()) return 'Informe o código interno.'
  if (draft.legalName.trim().length < 2) return 'Informe a razão social.'
  if (!draft.serviceTypes.length) return 'Selecione ao menos um tipo de serviço.'
  for (const [label, contact] of [
    ['reservas', draft.reservationContact],
    ['financeiro', draft.financialContact],
  ] as const) {
    const filled = Object.values(contact).some((value) => value.trim())
    if (filled && !contact.email.trim() && !contact.phone.trim()) {
      return `Informe e-mail ou telefone para o contato de ${label}.`
    }
  }
  if (draft.latitude && (Number(draft.latitude) < -90 || Number(draft.latitude) > 90)) return 'Latitude deve estar entre -90 e 90.'
  if (draft.longitude && (Number(draft.longitude) < -180 || Number(draft.longitude) > 180)) return 'Longitude deve estar entre -180 e 180.'
  return null
}
