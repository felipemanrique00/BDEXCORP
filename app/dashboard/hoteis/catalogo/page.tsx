'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Hotel,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { GeographyCombobox } from '@/components/geography/geography-combobox'
import { Modal } from '@/components/ui/modal'
import { PageHero } from '@/components/ui/page-hero'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { listCommercialSuppliers } from '@/lib/commercial-suppliers/client'
import type { CommercialSupplier } from '@/lib/commercial-suppliers/types'
import {
  listGeographyCities,
  listGeographyCountries,
  listGeographySubdivisions,
} from '@/lib/geography/client'
import type { GeographyCity, GeographyCountry, GeographySubdivision } from '@/lib/geography/types'
import {
  createHotelCatalogItem,
  deleteHotelCatalogMedia,
  getHotelCatalogItem,
  listHotelCatalog,
  reorderHotelCatalogMedia,
  updateHotelCatalogItem,
  uploadHotelCatalogMedia,
} from '@/lib/hotel-catalog/client'
import {
  HOTEL_ROOM_CATEGORIES,
  isCanonicalHotelRoomCategory,
} from '@/lib/hotel-catalog/room-categories'
import type { HotelCatalogItem, HotelCatalogMedia, HotelCatalogRoomType } from '@/lib/hotel-catalog/types'

type OccupancyType = HotelCatalogRoomType['occupancyType']

interface RoomTypeDraft {
  clientId: string
  code: string
  name: string
  occupancyType: OccupancyType
  maxGuests: string
  maxAdults: string
  maxChildren: string
  bedConfiguration: string
}

interface HotelDraft {
  name: string
  countryId: string
  subdivisionId: string
  cityId: string
  cityLabel: string
  address: string
  phone: string
  email: string
  website: string
  category: string
  chainName: string
  brandName: string
  starRating: string
  billingEnabled: boolean
  billingInfo: string
  supplierIds: string[]
  roomTypes: RoomTypeDraft[]
}

const OCCUPANCY_OPTIONS: Array<{ value: OccupancyType; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'twin', label: 'Twin' },
  { value: 'triple', label: 'Triplo' },
  { value: 'quadruple', label: 'Quadruplo' },
  { value: 'family', label: 'Familiar' },
]

const OCCUPANCY_CAPACITY: Record<OccupancyType, { guests: number; adults: number; children: number }> = {
  single: { guests: 1, adults: 1, children: 0 },
  double: { guests: 2, adults: 2, children: 0 },
  twin: { guests: 2, adults: 2, children: 0 },
  triple: { guests: 3, adults: 3, children: 0 },
  quadruple: { guests: 4, adults: 4, children: 0 },
  family: { guests: 4, adults: 2, children: 2 },
}

let roomDraftSequence = 0

function createRoomTypeDraft(occupancyType: OccupancyType = 'single'): RoomTypeDraft {
  roomDraftSequence += 1
  const capacity = OCCUPANCY_CAPACITY[occupancyType]
  return {
    clientId: `room-draft-${roomDraftSequence}`,
    code: '',
    name: 'Standard',
    occupancyType,
    maxGuests: String(capacity.guests),
    maxAdults: String(capacity.adults),
    maxChildren: String(capacity.children),
    bedConfiguration: '',
  }
}

function roomTypeToDraft(room: HotelCatalogRoomType): RoomTypeDraft {
  return {
    ...createRoomTypeDraft(room.occupancyType),
    code: room.code,
    name: room.name,
    maxGuests: String(room.maxGuests),
    maxAdults: String(room.maxAdults),
    maxChildren: String(room.maxChildren),
    bedConfiguration: room.bedConfiguration || '',
  }
}

const EMPTY_DRAFT: HotelDraft = {
  name: '',
  countryId: '',
  subdivisionId: '',
  cityId: '',
  cityLabel: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  category: '',
  chainName: '',
  brandName: '',
  starRating: '',
  billingEnabled: false,
  billingInfo: '',
  supplierIds: [],
  roomTypes: [],
}

function validateHotelDraft(
  draft: HotelDraft,
  status: HotelCatalogItem['status'],
): { formError: string | null; roomErrors: Record<string, string[]> } {
  let formError: string | null = null
  const roomErrors: Record<string, string[]> = {}

  if (!draft.name.trim() || !draft.countryId || !draft.subdivisionId || !draft.cityId) {
    formError = 'Informe nome, pais, estado e cidade.'
  } else if (draft.starRating && !['1', '2', '3', '4', '5'].includes(draft.starRating)) {
    formError = 'A classificacao deve estar entre 1 e 5 estrelas.'
  } else if (status === 'active' && draft.supplierIds.length > 0 && draft.roomTypes.length === 0) {
    formError = 'Hotel ativo vinculado a fornecedor deve possuir ao menos um tipo de quarto.'
  }

  const codeIndexes = new Map<string, number[]>()
  draft.roomTypes.forEach((room, index) => {
    const code = room.code.trim().toLocaleLowerCase('pt-BR')
    if (!code) return
    codeIndexes.set(code, [...(codeIndexes.get(code) || []), index])
  })

  draft.roomTypes.forEach((room, index) => {
    const errors: string[] = []
    const guests = parseCapacity(room.maxGuests)
    const adults = parseCapacity(room.maxAdults)
    const children = parseCapacity(room.maxChildren)
    if (!room.code.trim()) errors.push('Informe o codigo do quarto.')
    if (!room.name.trim()) errors.push('Selecione a categoria do quarto.')
    if (room.code.trim() && (codeIndexes.get(room.code.trim().toLocaleLowerCase('pt-BR'))?.length || 0) > 1) {
      errors.push('O codigo deve ser unico neste hotel.')
    }
    if (guests == null || guests < 1 || guests > 12) errors.push('Hospedes deve ser um inteiro entre 1 e 12.')
    if (adults == null || adults < 1 || adults > 12) errors.push('Adultos deve ser um inteiro entre 1 e 12.')
    if (children == null || children < 0 || children > 10) errors.push('Criancas deve ser um inteiro entre 0 e 10.')
    if (guests != null && adults != null && children != null) {
      if (adults + children < guests) errors.push('Adultos e criancas devem comportar o total de hospedes.')
      if (guests < adults || guests < children) errors.push('O total nao pode ser menor que as capacidades individuais.')
      const minimumGuests = room.occupancyType === 'single'
        ? 1
        : room.occupancyType === 'triple'
          ? 3
          : room.occupancyType === 'quadruple'
            ? 4
            : 2
      if (guests < minimumGuests) errors.push(`A ocupacao exige no minimo ${minimumGuests} hospede(s).`)
      if (room.occupancyType === 'single' && (guests !== 1 || adults !== 1 || children !== 0)) {
        errors.push('Quarto single deve comportar um adulto e nenhuma crianca.')
      }
    }
    if (errors.length) roomErrors[room.clientId] = errors
  })

  if (!formError && Object.keys(roomErrors).length > 0) {
    formError = 'Revise os tipos de quarto destacados antes de salvar.'
  }
  return { formError, roomErrors }
}

function parseCapacity(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export default function HotelCatalogPage() {
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([])
  const [suppliers, setSuppliers] = useState<CommercialSupplier[]>([])
  const [countries, setCountries] = useState<GeographyCountry[]>([])
  const [subdivisions, setSubdivisions] = useState<GeographySubdivision[]>([])
  const [cities, setCities] = useState<GeographyCity[]>([])
  const [cityQuery, setCityQuery] = useState('')
  const [geographyLoading, setGeographyLoading] = useState({ subdivisions: false, cities: false })
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<HotelCatalogItem | null>(null)
  const [draft, setDraft] = useState<HotelDraft>(EMPTY_DRAFT)
  const [canManage, setCanManage] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [roomErrors, setRoomErrors] = useState<Record<string, string[]>>({})

  const loadBase = useCallback(async () => {
    setLoading(true)
    try {
      const [hotelItems, supplierItems, countryItems] = await Promise.all([
        listHotelCatalog({ includeInactive: 'true', limit: '200' }),
        listCommercialSuppliers({ serviceType: 'hotel', limit: '200' }),
        listGeographyCountries(),
      ])
      setHotels(hotelItems)
      setSuppliers(supplierItems)
      setCountries(countryItems)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel carregar o catalogo de hoteis.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const user = getCurrentUser()
    setCanManage(Boolean(user && hasPermission(user, 'cadastrar_hoteis')))
    void loadBase()
  }, [loadBase])

  useEffect(() => {
    if (!modalOpen || !draft.countryId) {
      setSubdivisions([])
      setGeographyLoading((current) => ({ ...current, subdivisions: false }))
      return
    }
    let active = true
    setSubdivisions([])
    setGeographyLoading((current) => ({ ...current, subdivisions: true }))
    void listGeographySubdivisions(draft.countryId)
      .then((items) => {
        if (active) setSubdivisions(items)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Nao foi possivel carregar os estados.')
      })
      .finally(() => {
        if (active) setGeographyLoading((current) => ({ ...current, subdivisions: false }))
      })
    return () => { active = false }
  }, [draft.countryId, modalOpen])

  useEffect(() => {
    if (!modalOpen || !draft.countryId || !draft.subdivisionId) {
      setCities([])
      setGeographyLoading((current) => ({ ...current, cities: false }))
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setGeographyLoading((current) => ({ ...current, cities: true }))
      void listGeographyCities({
        countryId: draft.countryId,
        subdivisionId: draft.subdivisionId,
        q: cityQuery.trim() || undefined,
        limit: 200,
      })
        .then((items) => {
          if (active) setCities(items)
        })
        .catch((error) => {
          if (active) toast.error(error instanceof Error ? error.message : 'Nao foi possivel carregar as cidades.')
        })
        .finally(() => {
          if (active) setGeographyLoading((current) => ({ ...current, cities: false }))
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [cityQuery, draft.countryId, draft.subdivisionId, modalOpen])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return hotels
    return hotels.filter((item) => [
      item.name,
      item.chainName || '',
      item.brandName || '',
      item.cityName || '',
      item.subdivisionCode || '',
      ...item.suppliers.map((supplier) => supplier.supplierName),
    ].some((value) => value.toLocaleLowerCase('pt-BR').includes(normalized)))
  }, [hotels, query])

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

  function openCreate() {
    const brazil = countries.find((country) => country.isoAlpha2 === 'BR')
    const next = {
      ...EMPTY_DRAFT,
      countryId: brazil?.id || countries[0]?.id || '',
      supplierIds: [],
      roomTypes: [createRoomTypeDraft()],
    }
    setEditing(null)
    setDraft(next)
    setFormError(null)
    setRoomErrors({})
    setCityQuery('')
    setSubdivisions([])
    setCities([])
    setModalOpen(true)
  }

  function openEdit(hotel: HotelCatalogItem) {
    const brazil = countries.find((country) => country.isoAlpha2 === 'BR')
    setEditing(hotel)
    setDraft({
      name: hotel.name,
      countryId: hotel.countryId || brazil?.id || '',
      subdivisionId: hotel.subdivisionId || '',
      cityId: hotel.cityId || '',
      cityLabel: hotel.cityName || '',
      address: hotel.address || '',
      phone: hotel.phone || '',
      email: hotel.email || '',
      website: hotel.website || '',
      category: hotel.category || '',
      chainName: hotel.chainName || '',
      brandName: hotel.brandName || '',
      starRating: hotel.starRating == null ? '' : String(hotel.starRating),
      billingEnabled: hotel.billingEnabled,
      billingInfo: hotel.billingInfo || '',
      supplierIds: hotel.suppliers.filter((supplier) => supplier.isActive).map((supplier) => supplier.supplierId),
      roomTypes: hotel.roomTypes.filter((room) => room.isActive).map(roomTypeToDraft),
    })
    setFormError(null)
    setRoomErrors({})
    setCityQuery('')
    setSubdivisions([])
    setCities([])
    setModalOpen(true)
  }

  function updateRoomType(clientId: string, patch: Partial<RoomTypeDraft>) {
    setFormError(null)
    setDraft((current) => ({
      ...current,
      roomTypes: current.roomTypes.map((room) => (room.clientId === clientId ? { ...room, ...patch } : room)),
    }))
    setRoomErrors((current) => {
      if (!current[clientId]) return current
      const next = { ...current }
      delete next[clientId]
      return next
    })
  }

  function changeOccupancy(clientId: string, occupancyType: OccupancyType) {
    const capacity = OCCUPANCY_CAPACITY[occupancyType]
    updateRoomType(clientId, {
      occupancyType,
      maxGuests: String(capacity.guests),
      maxAdults: String(capacity.adults),
      maxChildren: String(capacity.children),
    })
  }

  function removeRoomType(clientId: string) {
    setFormError(null)
    setDraft((current) => ({
      ...current,
      roomTypes: current.roomTypes.filter((room) => room.clientId !== clientId),
    }))
    setRoomErrors((current) => {
      const next = { ...current }
      delete next[clientId]
      return next
    })
  }

  async function saveHotel() {
    const validation = validateHotelDraft(draft, editing?.status || 'active')
    setFormError(validation.formError)
    setRoomErrors(validation.roomErrors)
    if (validation.formError) {
      toast.error(validation.formError)
      return
    }
    const payload = {
      name: draft.name.trim(),
      countryId: draft.countryId,
      subdivisionId: draft.subdivisionId,
      cityId: draft.cityId,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      address: draft.address.trim() || null,
      website: draft.website.trim() || null,
      category: draft.category.trim() || null,
      chainName: draft.chainName.trim() || null,
      brandName: draft.brandName.trim() || null,
      starRating: draft.starRating ? Number(draft.starRating) : null,
      billingEnabled: draft.billingEnabled,
      billingInfo: draft.billingInfo.trim() || null,
      amenities: editing?.amenities || {},
      supplierIds: draft.supplierIds,
      roomTypes: draft.roomTypes.map((room) => ({
        code: room.code.trim(),
        name: room.name.trim(),
        occupancyType: room.occupancyType,
        maxGuests: Number(room.maxGuests),
        maxAdults: Number(room.maxAdults),
        maxChildren: Number(room.maxChildren),
        bedConfiguration: room.bedConfiguration.trim() || null,
      })),
      status: editing?.status || 'active',
    }
    setSaving(true)
    try {
      if (editing) {
        await updateHotelCatalogItem(editing.id, { ...payload, expectedVersion: editing.version })
        toast.success('Hotel atualizado no catalogo relacional.')
      } else {
        await createHotelCatalogItem(payload)
        toast.success('Hotel cadastrado no catalogo relacional.')
      }
      setModalOpen(false)
      setFormError(null)
      setRoomErrors({})
      await loadBase()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar o hotel.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Catalogo relacional"
        title="Hoteis offline"
        icon={Hotel}
        description="Propriedades vinculadas a cidades oficiais e aos fornecedores comerciais que podem reserva-las."
        metrics={[
          { icon: Hotel, label: 'Hoteis cadastrados', value: hotels.length },
          { icon: MapPin, label: 'Com cidade oficial', value: hotels.filter((hotel) => hotel.cityId).length },
          { icon: Building2, label: 'Com fornecedor', value: hotels.filter((hotel) => hotel.suppliers.length > 0).length },
        ]}
        actions={canManage ? (
          <button type="button" onClick={openCreate} disabled={loading || countries.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#20265a] hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60">
            <Plus className="h-4 w-4" /> Novo hotel
          </button>
        ) : undefined}
      />

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Propriedades cadastradas</h2>
            <p className="text-xs text-slate-500">A propriedade e o fornecedor sao cadastros independentes e podem ter relacao muitos-para-muitos.</p>
          </div>
          <label className="relative block w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hotel, cidade ou fornecedor..." className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
          </label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando catalogo...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">Nenhum hotel relacional encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
                <tr><th className="px-4 py-3">Hotel</th><th className="px-4 py-3">Localidade</th><th className="px-4 py-3">Fornecedores</th><th className="px-4 py-3">Faturamento</th><th className="px-4 py-3 text-right">Acao</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((hotel) => (
                  <tr key={hotel.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{hotel.name}</div>
                      <div className="text-xs text-slate-500">
                        {[hotel.chainName, hotel.brandName, hotel.starRating ? `${hotel.starRating} estrela(s)` : null, `${hotel.roomTypes.length} tipo(s) de quarto`].filter(Boolean).join(' | ')}
                      </div>
                    </td>
                    <td className="px-4 py-3"><div>{hotel.cityName || 'Sem cidade vinculada'}</div><div className="text-xs text-slate-500">{[hotel.subdivisionCode, hotel.countryCode].filter(Boolean).join(' / ')}</div></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{hotel.suppliers.length ? hotel.suppliers.map((supplier) => <span key={supplier.id} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">{supplier.supplierName}</span>) : <span className="text-xs text-amber-600">Sem fornecedor</span>}</div></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${hotel.billingEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{hotel.billingEnabled ? 'Habilitado' : 'Nao habilitado'}</span></td>
                    <td className="px-4 py-3 text-right">{canManage && <button type="button" onClick={() => openEdit(hotel)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-cyan-700 dark:hover:bg-slate-800" title="Editar hotel"><Pencil className="h-4 w-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editing ? 'Editar hotel' : 'Novo hotel'} size="2xl">
        <div className="space-y-5">
          {formError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {formError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Nome do hotel *" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} /></div>
            <Field label="Categoria descritiva" value={draft.category} onChange={(value) => setDraft((current) => ({ ...current, category: value }))} placeholder="Ex.: Resort, executivo" />
            <Field label="Rede" value={draft.chainName} onChange={(value) => setDraft((current) => ({ ...current, chainName: value }))} placeholder="Ex.: Accor" />
            <Field label="Bandeira" value={draft.brandName} onChange={(value) => setDraft((current) => ({ ...current, brandName: value }))} placeholder="Ex.: Novotel" />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Classificacao</span>
              <select value={draft.starRating} onChange={(event) => setDraft((current) => ({ ...current, starRating: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950">
                <option value="">Nao informada</option>
                {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} estrela{rating > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <GeographyCombobox
              id="hotel-country"
              label="Pais *"
              value={draft.countryId}
              options={countryOptions}
              disabled={saving || (loading && countries.length === 0)}
              loading={loading && countries.length === 0}
              required
              onChange={(countryId) => {
                setDraft((current) => ({
                  ...current,
                  countryId,
                  subdivisionId: '',
                  cityId: '',
                  cityLabel: '',
                }))
                setCityQuery('')
                setSubdivisions([])
                setCities([])
              }}
            />
            <GeographyCombobox
              id="hotel-subdivision"
              label="Estado / provincia *"
              value={draft.subdivisionId}
              options={subdivisionOptions}
              disabled={saving || !draft.countryId || geographyLoading.subdivisions}
              loading={geographyLoading.subdivisions}
              required
              emptyMessage="Nenhum estado carregado. Sincronize a base de localidades no cadastro de fornecedores."
              onChange={(subdivisionId) => {
                setDraft((current) => ({
                  ...current,
                  subdivisionId,
                  cityId: '',
                  cityLabel: '',
                }))
                setCityQuery('')
                setCities([])
              }}
            />
            <GeographyCombobox
              id="hotel-city"
              label="Cidade *"
              value={draft.cityId}
              options={cityOptions}
              disabled={saving || !draft.subdivisionId}
              loading={geographyLoading.cities}
              required
              emptyMessage="Nenhuma cidade encontrada. Verifique se a base de localidades foi sincronizada."
              onSearchChange={setCityQuery}
              onChange={(cityId, option) => setDraft((current) => ({
                ...current,
                cityId,
                cityLabel: option?.label || '',
              }))}
            />
            <div className="sm:col-span-2 lg:col-span-3"><Field label="Endereco" value={draft.address} onChange={(value) => setDraft((current) => ({ ...current, address: value }))} /></div>
            <Field label="Telefone" value={draft.phone} onChange={(value) => setDraft((current) => ({ ...current, phone: value }))} />
            <Field label="E-mail" value={draft.email} onChange={(value) => setDraft((current) => ({ ...current, email: value }))} type="email" />
            <Field label="Website" value={draft.website} onChange={(value) => setDraft((current) => ({ ...current, website: value }))} placeholder="https://..." />
          </div>

          {editing ? (
            <HotelCatalogMediaEditor
              hotel={editing}
              disabled={saving}
              onChanged={async () => {
                const refreshed = await getHotelCatalogItem(editing.id)
                setEditing(refreshed)
              }}
            />
          ) : (
            <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="flex items-start gap-3">
                <ImageIcon className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Fotos do hotel e dos quartos</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Salve o hotel primeiro. Depois, abra-o para enviar, remover e ordenar fotos privadas do catalogo.</p>
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="hotel-room-types-title" className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="hotel-room-types-title" className="text-sm font-semibold text-slate-900 dark:text-white">Tipos de quarto ativos</h3>
                <p className="mt-1 text-xs text-slate-500">Cadastre acomodacao, categoria, ocupacao e capacidades usadas nas cotacoes offline.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormError(null)
                  setDraft((current) => ({ ...current, roomTypes: [...current.roomTypes, createRoomTypeDraft()] }))
                }}
                disabled={saving || draft.roomTypes.length >= 100}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-900 dark:text-cyan-300 dark:hover:bg-cyan-950/30"
              >
                <Plus className="h-4 w-4" /> Adicionar tipo de quarto
              </button>
            </div>

            {draft.roomTypes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                Nenhum tipo de quarto ativo. Para tornar o hotel cotavel, adicione pelo menos um quarto antes de vincular um fornecedor.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Tipos de quarto cadastrados para o hotel</caption>
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                    <tr>
                      <th scope="col" className="w-28 px-3 py-2.5">Codigo</th>
                      <th scope="col" className="w-36 px-3 py-2.5">Acomodacao</th>
                      <th scope="col" className="min-w-56 px-3 py-2.5">Categoria</th>
                      <th scope="col" className="min-w-48 px-3 py-2.5">Camas</th>
                      <th scope="col" className="w-24 px-3 py-2.5 text-center">Hospedes</th>
                      <th scope="col" className="w-24 px-3 py-2.5 text-center">Adultos</th>
                      <th scope="col" className="w-24 px-3 py-2.5 text-center">Criancas</th>
                      <th scope="col" className="w-16 px-3 py-2.5 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-950/30">
                    {draft.roomTypes.map((room, index) => {
                      const errors = roomErrors[room.clientId] || []
                      const errorId = `${room.clientId}-errors`
                      const invalid = errors.length > 0
                      const inputClassName = `w-full rounded-md border bg-white px-2.5 py-2 text-sm outline-none focus:border-cyan-500 dark:bg-slate-950 ${invalid ? 'border-red-400 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'}`
                      return (
                        <Fragment key={room.clientId}>
                          <tr className={invalid ? 'bg-red-50/50 dark:bg-red-950/10' : undefined}>
                            <td className="px-3 py-2.5">
                              <input aria-label={`Codigo do quarto ${index + 1}`} value={room.code} onChange={(event) => updateRoomType(room.clientId, { code: event.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} placeholder="DBL-STD" className={inputClassName} />
                            </td>
                            <td className="px-3 py-2.5">
                              <select aria-label={`Acomodacao do quarto ${index + 1}`} value={room.occupancyType} onChange={(event) => changeOccupancy(room.clientId, event.target.value as OccupancyType)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className={inputClassName}>
                                {OCCUPANCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <select aria-label={`Categoria do quarto ${index + 1}`} value={room.name} onChange={(event) => updateRoomType(room.clientId, { name: event.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className={inputClassName}>
                                <option value="">Selecione</option>
                                {room.name && !isCanonicalHotelRoomCategory(room.name) && <option value={room.name}>{room.name} (legado)</option>}
                                {HOTEL_ROOM_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <input aria-label={`Configuracao de camas do quarto ${index + 1}`} value={room.bedConfiguration} onChange={(event) => updateRoomType(room.clientId, { bedConfiguration: event.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} placeholder="1 cama queen" className={inputClassName} />
                            </td>
                            {([
                              ['Hospedes', 'maxGuests', room.maxGuests, 1, 12],
                              ['Adultos', 'maxAdults', room.maxAdults, 1, 12],
                              ['Criancas', 'maxChildren', room.maxChildren, 0, 10],
                            ] as const).map(([label, field, value, min, max]) => (
                              <td key={field} className="px-3 py-2.5">
                                <input type="number" inputMode="numeric" min={min} max={max} step={1} aria-label={`${label} do quarto ${index + 1}`} value={value} onChange={(event) => updateRoomType(room.clientId, { [field]: event.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className={`${inputClassName} text-center`} />
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right">
                              <button type="button" onClick={() => removeRoomType(room.clientId)} disabled={saving} aria-label={`Remover tipo de quarto ${index + 1}`} title="Remover tipo de quarto" className="inline-flex rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                          {invalid && (
                            <tr className="bg-red-50/50 dark:bg-red-950/10">
                              <td colSpan={8} className="px-4 pb-3 pt-0">
                                <ul id={errorId} role="alert" className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-red-700 dark:text-red-300">
                                  {errors.map((error) => <li key={error}>• {error}</li>)}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fornecedores habilitados para esta propriedade</legend>
            {suppliers.length === 0 ? (
              <p className="text-sm text-amber-600">Cadastre primeiro um fornecedor comercial do tipo hotel.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {suppliers.map((supplier) => (
                  <label key={supplier.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <input type="checkbox" className="mt-0.5" checked={draft.supplierIds.includes(supplier.id)} onChange={(event) => setDraft((current) => ({ ...current, supplierIds: event.target.checked ? [...current.supplierIds, supplier.id] : current.supplierIds.filter((id) => id !== supplier.id) }))} />
                    <span><span className="block font-medium">{supplier.tradeName || supplier.legalName}</span><span className="text-xs text-slate-500">{supplier.internalCode}</span></span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><input type="checkbox" checked={draft.billingEnabled} onChange={(event) => setDraft((current) => ({ ...current, billingEnabled: event.target.checked }))} /> Aceita faturamento</label>
            <Field label="Condicao / instrucoes de faturamento" value={draft.billingInfo} onChange={(value) => setDraft((current) => ({ ...current, billingInfo: value }))} />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
            <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium dark:border-slate-700">Cancelar</button>
            <button type="button" onClick={() => void saveHotel()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#20265a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar hotel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function HotelCatalogMediaEditor({
  hotel,
  disabled,
  onChanged,
}: {
  hotel: HotelCatalogItem
  disabled: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <section aria-labelledby="hotel-media-title" className="space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div>
        <h3 id="hotel-media-title" className="text-sm font-semibold text-slate-900 dark:text-white">Fotos do hotel e dos quartos</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Arquivos PNG, JPEG ou WebP de ate 5 MB. As imagens sao validadas, normalizadas e armazenadas de forma privada no tenant da agencia.
        </p>
      </div>
      <MediaScopeEditor
        hotelId={hotel.id}
        title="Galeria do hotel"
        description="Fachada, recepcao e areas comuns. A primeira foto aparece como capa."
        media={hotel.media || []}
        roomTypeId={null}
        disabled={disabled}
        onChanged={onChanged}
      />
      {(hotel.roomTypes || []).map((room) => (
        <MediaScopeEditor
          key={room.id}
          hotelId={hotel.id}
          title={`Quarto: ${room.name}`}
          description={[room.code, room.bedConfiguration].filter(Boolean).join(' · ') || 'Tipo de quarto cadastrado'}
          media={room.media || []}
          roomTypeId={room.id}
          disabled={disabled}
          onChanged={onChanged}
        />
      ))}
      <p className="text-[11px] leading-4 text-slate-500">
        Fotos de quarto seguem o tipo salvo no catalogo. Salve alteracoes de categorias ou quartos antes de enviar novas imagens.
      </p>
    </section>
  )
}

function MediaScopeEditor({
  hotelId,
  title,
  description,
  media,
  roomTypeId,
  disabled,
  onChanged,
}: {
  hotelId: string
  title: string
  description: string
  media: HotelCatalogMedia[]
  roomTypeId: string | null
  disabled: boolean
  onChanged: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [altText, setAltText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = `hotel-media-${roomTypeId || 'hotel'}`
  const ordered = [...media].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))

  async function upload() {
    if (!file) return
    setBusy(true)
    try {
      await uploadHotelCatalogMedia(hotelId, file, { roomTypeId, altText })
      setFile(null)
      setAltText('')
      const input = document.getElementById(inputId) as HTMLInputElement | null
      if (input) input.value = ''
      toast.success('Foto adicionada ao catalogo.')
      await refreshAfterMutation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel enviar a foto.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(mediaId: string) {
    if (!window.confirm('Remover esta foto do catalogo? O arquivo deixara de ser exibido imediatamente.')) return
    setBusy(true)
    try {
      await deleteHotelCatalogMedia(hotelId, mediaId)
      toast.success('Foto removida do catalogo.')
      await refreshAfterMutation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel remover a foto.')
    } finally {
      setBusy(false)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const ids = ordered.map((item) => item.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setBusy(true)
    try {
      await reorderHotelCatalogMedia(hotelId, roomTypeId, ids)
      toast.success('Ordem das fotos atualizada.')
      await refreshAfterMutation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel reordenar as fotos.')
    } finally {
      setBusy(false)
    }
  }

  async function refreshAfterMutation() {
    try {
      await onChanged()
    } catch {
      toast.warning('A alteracao foi salva, mas a galeria nao pode ser atualizada agora. Reabra o cadastro.')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-950/30">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 shadow-sm dark:bg-slate-900">
          {ordered.length} foto{ordered.length === 1 ? '' : 's'}
        </span>
      </div>

      {ordered.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((item, index) => (
            <li key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.altText || `${title}, foto ${index + 1}`} className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center gap-1 p-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={item.altText || undefined}>
                  {item.altText || (index === 0 ? 'Capa sem descricao' : 'Sem descricao')}
                </span>
                <button type="button" onClick={() => void move(index, -1)} disabled={disabled || busy || index === 0} aria-label={`Mover foto ${index + 1} para cima`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void move(index, 1)} disabled={disabled || busy || index === ordered.length - 1} aria-label={`Mover foto ${index + 1} para baixo`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void remove(item.id)} disabled={disabled || busy} aria-label={`Remover foto ${index + 1}`} className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Arquivo</span>
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || busy}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-semibold dark:border-slate-700 dark:bg-slate-950 dark:file:bg-slate-800"
          />
        </label>
        <Field label="Descricao acessivel" value={altText} onChange={setAltText} placeholder="Ex.: Quarto duplo com cama queen" />
        <button type="button" onClick={() => void upload()} disabled={disabled || busy || !file} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#20265a] px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Enviar foto
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'email' }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950" /></label>
}
