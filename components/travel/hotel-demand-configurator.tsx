'use client'

import { useEffect, useMemo, useState } from 'react'
import { BedDouble, Loader2, MapPin, Plus, Trash2 } from 'lucide-react'

import { GeographyCombobox } from '@/components/geography/geography-combobox'
import {
  HotelTravelerSlotPicker,
  useHotelTravelerManagementCapabilities,
} from '@/components/travel/hotel-traveler-slot-picker'
import { DateInput } from '@/components/ui/date-input'
import {
  listGeographyCities,
  listGeographyCountries,
  listGeographySubdivisions,
} from '@/lib/geography/client'
import type { GeographyCity, GeographyCountry, GeographySubdivision } from '@/lib/geography/types'
import { listHotelCatalog } from '@/lib/hotel-catalog/client'
import type { HotelCatalogItem } from '@/lib/hotel-catalog/types'
import {
  createEmptyHotelRoom,
  HOTEL_OCCUPANCIES,
  nightsBetween,
  type HotelOccupancyCode,
} from '@/lib/hotel-demand/model'
import {
  hotelDemandPreferredHotelIds,
  MAX_PREFERRED_HOTELS,
  preferredHotelPatch,
} from '@/lib/hotel-demand/preferences'
import type { DetalhesHotel, HotelDemandRoom } from '@/types'

interface Props {
  companyId: string
  value: DetalhesHotel
  onChange: React.Dispatch<React.SetStateAction<DetalhesHotel>>
  disabled?: boolean
  showGuests?: boolean
  showPreferredHotelSelector?: boolean
  showAccessibility?: boolean
}

export function HotelDemandConfigurator({
  companyId,
  value,
  onChange,
  disabled = false,
  showGuests = true,
  showPreferredHotelSelector = true,
  showAccessibility = true,
}: Props) {
  const [countries, setCountries] = useState<GeographyCountry[]>([])
  const [subdivisions, setSubdivisions] = useState<GeographySubdivision[]>([])
  const [cities, setCities] = useState<GeographyCity[]>([])
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([])
  const [cityQuery, setCityQuery] = useState('')
  const [loading, setLoading] = useState({ countries: true, subdivisions: false, cities: false, hotels: false })
  const [error, setError] = useState('')
  const [hotelError, setHotelError] = useState('')

  const rooms = useMemo(() => value.rooms?.length ? value.rooms : [], [value.rooms])
  const preferredHotelIds = useMemo(
    () => hotelDemandPreferredHotelIds({
      preferred_hotel_id: value.preferred_hotel_id,
      preferred_hotel_ids: value.preferred_hotel_ids,
    }),
    [value.preferred_hotel_id, value.preferred_hotel_ids],
  )
  const preferredHotelIdSet = useMemo(() => new Set(preferredHotelIds), [preferredHotelIds])
  const hotelById = useMemo(() => new Map(hotels.map((hotel) => [hotel.id, hotel])), [hotels])
  const selectedEmployeeIds = useMemo(
    () => new Set(rooms.flatMap((room) => room.guests).flatMap((guest) => guest.employee_id ? [guest.employee_id] : [])),
    [rooms],
  )
  const travelerManagement = useHotelTravelerManagementCapabilities(companyId, showGuests)
  const nights = nightsBetween(value.data_checkin || '', value.data_checkout || '')
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
    if (value.city_id && !options.some((option) => option.value === value.city_id) && value.cidade) {
      options.unshift({ value: value.city_id, label: value.cidade })
    }
    return options
  }, [cities, value.cidade, value.city_id])
  const hotelOptions = useMemo(() => (
    hotels.filter((hotel) => !preferredHotelIdSet.has(hotel.id)).map((hotel) => ({
      value: hotel.id,
      label: `${hotel.name}${hotel.category ? ` - ${hotel.category}` : ''}`,
      keywords: [
        hotel.name,
        hotel.category || '',
        hotel.address || '',
        hotel.cityName || '',
        ...hotel.suppliers.map((supplier) => supplier.supplierName),
      ],
    }))
  ), [hotels, preferredHotelIdSet])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setLoading((current) => ({ ...current, countries: true }))
    void listGeographyCountries('', controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setCountries(items)
        const brazil = items.find((item) => item.isoAlpha2 === 'BR')
        if (brazil) {
          onChange((current) => current.country_id ? current : {
            ...current,
            country_id: brazil.id,
            subdivision_id: undefined,
            city_id: undefined,
            cidade: '',
            ...preferredHotelPatch([]),
          })
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao carregar países.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading((current) => ({ ...current, countries: false }))
      })
    return () => controller.abort()
    // A carga inicial nao deve reiniciar quando o formulario muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!value.country_id) {
      setSubdivisions([])
      setLoading((current) => ({ ...current, subdivisions: false }))
      return
    }
    const controller = new AbortController()
    setError('')
    setLoading((current) => ({ ...current, subdivisions: true }))
    void listGeographySubdivisions(value.country_id, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setSubdivisions(items)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao carregar estados.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading((current) => ({ ...current, subdivisions: false }))
      })
    return () => controller.abort()
  }, [value.country_id])

  useEffect(() => {
    if (!value.country_id || !value.subdivision_id) {
      setCities([])
      setLoading((current) => ({ ...current, cities: false }))
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setError('')
      setLoading((current) => ({ ...current, cities: true }))
      void listGeographyCities({
        countryId: value.country_id!,
        subdivisionId: value.subdivision_id,
        q: cityQuery.trim() || undefined,
        limit: 100,
      }, controller.signal)
        .then(setCities)
        .catch((reason) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao carregar cidades.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading((current) => ({ ...current, cities: false }))
        })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [cityQuery, value.country_id, value.subdivision_id])

  useEffect(() => {
    if (!showPreferredHotelSelector) {
      setHotels([])
      setHotelError('')
      setLoading((current) => ({ ...current, hotels: false }))
      return
    }
    if (!value.country_id || !value.subdivision_id || !value.city_id) {
      setHotels([])
      setHotelError('')
      setLoading((current) => ({ ...current, hotels: false }))
      return
    }
    const controller = new AbortController()
    setLoading((current) => ({ ...current, hotels: true }))
    setHotelError('')
    setHotels([])
    void listHotelCatalog({
      countryId: value.country_id,
      subdivisionId: value.subdivision_id,
      cityId: value.city_id,
      status: 'active',
      quotable: 'true',
      limit: '100',
    }, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const eligibleHotels = items
          .filter((hotel) => (
            hotel.status === 'active'
            && hotel.cityId === value.city_id
            && hotel.suppliers.some((supplier) => supplier.isActive)
          ))
          .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
        setHotels(eligibleHotels)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setHotelError(reason instanceof Error ? reason.message : 'Falha ao carregar hotéis.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading((current) => ({ ...current, hotels: false }))
      })
    return () => controller.abort()
  }, [showPreferredHotelSelector, value.city_id, value.country_id, value.subdivision_id])

  useEffect(() => {
    if (!showGuests || !companyId || rooms.length) return
    onChange((current) => current.rooms?.length
      ? current
      : { ...current, rooms: [createEmptyHotelRoom()] })
    // onChange/value mudam a cada render; rooms.length e o gatilho de inicializacao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, rooms.length, showGuests])

  function patch(patchValue: Partial<DetalhesHotel>) {
    onChange((current) => ({ ...current, ...patchValue }))
  }

  function setRooms(nextRooms: HotelDemandRoom[]) {
    const guests = nextRooms.flatMap((room) => room.guests)
    const first = guests.find((guest) => guest.role === 'responsible') || guests[0]
    const legacyType = occupancyToLegacy(nextRooms[0]?.occupancy_code)
    patch({
      rooms: nextRooms,
      num_hospedes: guests.length,
      tipo_apto: legacyType,
      needs_review: nextRooms.some((room) => requiredSlots(room).some((slot) => !room.guests.some((guest) => guest.slot_index === slot.index))),
      ...(first ? {} : { needs_review: true }),
    })
  }

  function patchRoom(clientId: string, updater: (room: HotelDemandRoom) => HotelDemandRoom) {
    setRooms(rooms.map((room) => room.client_id === clientId ? updater(room) : room))
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-bbt-accent/30 bg-bbt-accent/5 p-3 text-sm text-bbt-primary dark:border-bbt-accent/40 dark:bg-bbt-accent/10 dark:text-white">
        Nesta etapa, informe a necessidade da hospedagem. Os hotéis preferenciais são opcionais; fornecedor, diária, taxas e localizador serão definidos pelo consultor na cotação.
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
          {error}
        </div>
      )}

      <section className="space-y-3" aria-labelledby="hotel-demand-destination">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-bbt-accent" />
          <h4 id="hotel-demand-destination" className="font-semibold text-bbt-primary dark:text-white">Destino e período</h4>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <GeographyCombobox
            id="hotel-demand-country"
            label="País *"
            value={value.country_id || ''}
            options={countryOptions}
            disabled={disabled || loading.countries}
            loading={loading.countries}
            required
            placeholder="Digite para buscar o país"
            onChange={(countryId) => {
              setError('')
              setHotelError('')
              setCityQuery('')
              setSubdivisions([])
              setCities([])
              patch({
                country_id: countryId || undefined,
                subdivision_id: undefined,
                city_id: undefined,
                cidade: '',
                ...preferredHotelPatch([]),
              })
            }}
          />
          <GeographyCombobox
            id="hotel-demand-subdivision"
            label="Estado / região *"
            value={value.subdivision_id || ''}
            options={subdivisionOptions}
            disabled={disabled || !value.country_id || loading.subdivisions}
            loading={loading.subdivisions}
            required
            placeholder="Digite para buscar o estado"
            emptyMessage="Nenhum estado carregado. Solicite a sincronização das localidades a um administrador."
            onChange={(subdivisionId) => {
              setError('')
              setHotelError('')
              setCityQuery('')
              setCities([])
              patch({
                subdivision_id: subdivisionId || undefined,
                city_id: undefined,
                cidade: '',
                ...preferredHotelPatch([]),
              })
            }}
          />
          <GeographyCombobox
            id="hotel-demand-city"
            label="Cidade *"
            value={value.city_id || ''}
            options={cityOptions}
            disabled={disabled || !value.subdivision_id}
            loading={loading.cities}
            required
            placeholder="Digite para buscar a cidade"
            emptyMessage="Nenhuma cidade encontrada. Se a base estiver vazia, solicite a sincronização das localidades a um administrador."
            onSearchChange={setCityQuery}
            onChange={(cityId, option) => {
              setError('')
              setHotelError('')
              patch({
                city_id: cityId || undefined,
                cidade: option?.label || '',
                ...preferredHotelPatch([]),
              })
            }}
          />
          <Field label="Check-in *" htmlFor="hotel-demand-checkin">
            <DateInput
              id="hotel-demand-checkin"
              value={value.data_checkin || ''}
              disabled={disabled}
              onChange={(event) => patch({ data_checkin: event.target.value })}
              required
            />
          </Field>
          <Field
            label="Check-out *"
            htmlFor="hotel-demand-checkout"
            hint={nights > 0 ? `${nights} noite${nights === 1 ? '' : 's'}` : undefined}
          >
            <DateInput
              id="hotel-demand-checkout"
              value={value.data_checkout || ''}
              min={value.data_checkin || undefined}
              disabled={disabled}
              onChange={(event) => patch({ data_checkout: event.target.value })}
              required
            />
          </Field>
          {showPreferredHotelSelector && <div className="space-y-2 md:col-span-3">
            <GeographyCombobox
              id="hotel-demand-preferred-hotel"
              label={`Hotéis preferenciais (opcional, até ${MAX_PREFERRED_HOTELS})`}
              value=""
              options={hotelOptions}
              disabled={disabled || !value.city_id || preferredHotelIds.length >= MAX_PREFERRED_HOTELS}
              loading={loading.hotels}
              placeholder={!value.city_id
                ? 'Selecione a cidade primeiro'
                : preferredHotelIds.length >= MAX_PREFERRED_HOTELS
                  ? 'Limite de hotéis preferenciais atingido'
                  : 'Digite e adicione um hotel'}
              emptyMessage={hotelError || `Nenhum hotel ativo e cotável cadastrado em ${value.cidade || 'esta cidade'}.`}
              onChange={(hotelId) => {
                if (!hotelId || preferredHotelIdSet.has(hotelId)) return
                patch(preferredHotelPatch([...preferredHotelIds, hotelId]))
              }}
            />
            {preferredHotelIds.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Hotéis preferenciais selecionados">
                {preferredHotelIds.map((hotelId, index) => {
                  const hotel = hotelById.get(hotelId)
                  return (
                    <span
                      key={hotelId}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-bbt-accent/30 bg-bbt-accent/10 px-3 py-1.5 text-xs font-semibold text-bbt-primary dark:border-bbt-accent/40 dark:text-white"
                    >
                      <span className="truncate">
                        {index + 1}. {hotel?.name || 'Hotel anteriormente selecionado'}
                      </span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => patch(preferredHotelPatch(preferredHotelIds.filter((id) => id !== hotelId)))}
                        className="rounded-full p-0.5 text-bbt-accent hover:bg-bbt-accent/15 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remover ${hotel?.name || `hotel preferencial ${index + 1}`}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            {value.city_id && !loading.hotels && !hotelError && (
              <p className="text-xs text-slate-500" aria-live="polite">
                {hotels.length > 0
                  ? `${preferredHotelIds.length} de ${MAX_PREFERRED_HOTELS} preferência(s) selecionada(s). ${hotels.length} hotel${hotels.length === 1 ? '' : 'is'} elegível${hotels.length === 1 ? '' : 'is'} em ${value.cidade}.`
                  : `Nenhum hotel ativo e cotável cadastrado em ${value.cidade}. O consultor poderá sugerir outro hotel.`}
              </p>
            )}
            {hotelError && <p className="text-xs text-red-600 dark:text-red-400">{hotelError}</p>}
          </div>}
        </div>
      </section>

      {showGuests && <section className="space-y-3" aria-labelledby="hotel-demand-rooms">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-bbt-accent" />
            <div>
              <h4 id="hotel-demand-rooms" className="font-semibold text-bbt-primary dark:text-white">Quartos e hóspedes</h4>
              <p className="text-xs text-slate-500">Cada ocupação abre exatamente os hóspedes necessários.</p>
            </div>
          </div>
          <button
            type="button"
            disabled={disabled || rooms.length >= 30}
            onClick={() => setRooms([...rooms, createEmptyHotelRoom()])}
            className="bbt-button-ghost text-sm"
          >
            <Plus className="h-4 w-4" /> Adicionar quarto
          </button>
        </div>

        <div className="space-y-3">
          {rooms.map((room, roomIndex) => (
            <div key={room.client_id} className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-semibold text-bbt-primary dark:text-white">Quarto {roomIndex + 1}</div>
                <div className="flex items-center gap-2">
                  <select
                    value={room.occupancy_code}
                    disabled={disabled}
                    onChange={(event) => patchRoom(room.client_id, (current) => ({
                      ...current,
                      occupancy_code: event.target.value as HotelOccupancyCode,
                      guests: [],
                    }))}
                    className="bbt-input h-9 min-w-40 py-1 text-sm"
                    aria-label={`Ocupacao do quarto ${roomIndex + 1}`}
                  >
                    {Object.entries(HOTEL_OCCUPANCIES).map(([code, occupancy]) => (
                      <option key={code} value={code}>{occupancy.label}</option>
                    ))}
                  </select>
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setRooms(rooms.filter((item) => item.client_id !== room.client_id))}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      title="Remover quarto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {HOTEL_OCCUPANCIES[room.occupancy_code].slots.map((slot) => {
                  const guest = room.guests.find((item) => item.slot_index === slot.index)
                  return (
                    <HotelTravelerSlotPicker
                      key={slot.index}
                      companyId={companyId}
                      label={`${slot.label}${slot.required ? ' *' : ' (opcional)'}`}
                      allowsExternal={slot.allowsExternal}
                      required={slot.required}
                      role={slot.role}
                      slotIndex={slot.index}
                      value={guest}
                      disabled={disabled || !companyId}
                      excludedEmployeeIds={selectedEmployeeIds}
                      capabilities={travelerManagement}
                      surface="subtle"
                      onChange={(nextGuest) => patchRoom(room.client_id, (current) => ({
                        ...current,
                        guests: [
                          ...current.guests.filter((item) => item.slot_index !== slot.index),
                          ...(nextGuest ? [nextGuest] : []),
                        ].sort((a, b) => a.slot_index - b.slot_index),
                      }))}
                    />
                  )
                })}
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Observacoes do quarto</label>
                <input
                  value={room.notes || ''}
                  disabled={disabled}
                  onChange={(event) => patchRoom(room.client_id, (current) => ({ ...current, notes: event.target.value }))}
                  className="bbt-input"
                  placeholder="Ex.: camas separadas, berco, andar baixo"
                />
              </div>
            </div>
          ))}
        </div>
      </section>}

      {showAccessibility && <Field label="Acessibilidade e preferências gerais">
        <textarea
          value={value.accessibility_notes || ''}
          disabled={disabled}
          onChange={(event) => patch({ accessibility_notes: event.target.value })}
          className="bbt-input min-h-20 resize-y"
          placeholder="Mobilidade, alergias, necessidades especiais ou observações relevantes"
        />
      </Field>}
    </div>
  )
}

function requiredSlots(room: HotelDemandRoom) {
  return HOTEL_OCCUPANCIES[room.occupancy_code].slots.filter((slot) => slot.required)
}

function occupancyToLegacy(code: HotelDemandRoom['occupancy_code'] | undefined): DetalhesHotel['tipo_apto'] {
  if (code === 'triple') return 'TPL'
  if (code === 'single') return 'SGL'
  return 'DBL'
}

function Field({
  label,
  htmlFor,
  hint,
  loading,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</label>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-bbt-accent" /> : hint ? <span className="text-xs text-bbt-accent">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}
