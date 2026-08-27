'use client'

import { useEffect, useMemo } from 'react'
import {
  BedDouble,
  Building2,
  CreditCard,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react'

import {
  HotelTravelerSlotPicker,
  useHotelTravelerManagementCapabilities,
} from '@/components/travel/hotel-traveler-slot-picker'

import {
  createEmptyHotelRoom,
  HOTEL_OCCUPANCIES,
  type HotelOccupancyCode,
} from '@/lib/hotel-demand/model'
import {
  hotelDetailsWithRooms,
  resizeHotelDemandRooms,
} from '@/lib/hotel-demand/form'
import {
  FORMAS_PAGAMENTO_LABEL,
  type DetalhesHotel,
  type Empresa,
  type FormaPagamento,
  type HotelDemandGuest,
  type HotelDemandRoom,
} from '@/types'

export interface HotelDemandRequesterOption {
  id: string
  name: string
  email?: string | null
}

export interface HotelDemandCostCenterOption {
  id: string
  code: string
  name: string
  hierarchyLevel?: number
}

export interface HotelDemandGuestsAdminProps {
  details: DetalhesHotel
  onDetailsChange: React.Dispatch<React.SetStateAction<DetalhesHotel>>
  companyId: string
  companies: Array<Pick<Empresa, 'id' | 'nome' | 'centro_custo_padrao' | 'centro_custo_padrao_id'>>
  onCompanyChange: (companyId: string) => void
  requesterId: string
  requesters: HotelDemandRequesterOption[]
  requesterFallbackLabel?: string
  onRequesterChange: (requester: HotelDemandRequesterOption | null) => void
  costCenterId: string | null
  costCenterCode: string
  costCenters: HotelDemandCostCenterOption[]
  onCostCenterChange: (id: string | null, code: string) => void
  paymentMethod: FormaPagamento | ''
  onPaymentMethodChange: (value: FormaPagamento | '') => void
  observations: string
  onObservationsChange: (value: string) => void
  costCentersLoading?: boolean
  costCentersUnavailable?: boolean
  companyLocked?: boolean
  requesterLocked?: boolean
  showRequesterField?: boolean
  disabled?: boolean
}

export function HotelDemandGuestsAdmin({
  details,
  onDetailsChange,
  companyId,
  companies,
  onCompanyChange,
  requesterId,
  requesters,
  requesterFallbackLabel,
  onRequesterChange,
  costCenterId,
  costCenterCode,
  costCenters,
  onCostCenterChange,
  paymentMethod,
  onPaymentMethodChange,
  observations,
  onObservationsChange,
  costCentersLoading = false,
  costCentersUnavailable = false,
  companyLocked = false,
  requesterLocked = false,
  showRequesterField = true,
  disabled = false,
}: HotelDemandGuestsAdminProps) {
  const rooms = useMemo(() => details.rooms?.length ? details.rooms : [], [details.rooms])
  const selectedEmployeeIds = useMemo(
    () => new Set(rooms.flatMap((room) => room.guests).flatMap((guest) => guest.employee_id ? [guest.employee_id] : [])),
    [rooms],
  )
  const travelerManagement = useHotelTravelerManagementCapabilities(companyId)
  const guestCount = rooms.reduce((total, room) => total + room.guests.length, 0)
  const selectedCostCenterUnavailable = Boolean(
    costCenterId && !costCenters.some((item) => item.id === costCenterId),
  )
  const selectedRequesterUnavailable = Boolean(
    requesterId && !requesters.some((item) => item.id === requesterId),
  )

  useEffect(() => {
    if (rooms.length) return
    onDetailsChange((current) => current.rooms?.length
      ? current
      : hotelDetailsWithRooms(current, [createEmptyHotelRoom()]))
    // O tamanho da lista e o gatilho; o setter React e estavel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms.length])

  function setRooms(nextRooms: HotelDemandRoom[]) {
    onDetailsChange((current) => hotelDetailsWithRooms(current, nextRooms))
  }

  function patchRoom(clientId: string, updater: (room: HotelDemandRoom) => HotelDemandRoom) {
    setRooms(rooms.map((room) => room.client_id === clientId ? updater(room) : room))
  }

  function changeCompany(nextCompanyId: string) {
    const company = companies.find((item) => item.id === nextCompanyId)
    onCompanyChange(nextCompanyId)
    onRequesterChange(null)
    onCostCenterChange(
      company?.centro_custo_padrao_id || null,
      company?.centro_custo_padrao || '',
    )
    onDetailsChange((current) => hotelDetailsWithRooms(
      current,
      (current.rooms || []).map((room) => ({ ...room, guests: [] })),
    ))
  }

  function changeRoomCount(count: number) {
    if (
      count < rooms.length
      && rooms.slice(count).some(roomHasFilledData)
      && !window.confirm('Reduzir a quantidade removerá hóspedes e observações dos últimos quartos. Continuar?')
    ) return
    onDetailsChange((current) => hotelDetailsWithRooms(
      current,
      resizeHotelDemandRooms(current.rooms || [], count),
    ))
  }

  return (
    <div className="space-y-5">
      <section
        className="rounded-xl border border-bbt-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/30"
        aria-labelledby="hotel-demand-guests"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="rounded-lg bg-bbt-accent/10 p-2 text-bbt-accent dark:bg-bbt-accent/15">
              <UsersRound className="h-4 w-4" />
            </div>
            <div>
              <h4 id="hotel-demand-guests" className="font-semibold text-bbt-primary dark:text-white">
                Hóspedes e quartos
              </h4>
              <p className="text-xs text-slate-500">
                Cada ocupação abre os responsáveis e acompanhantes compatíveis com a capacidade.
              </p>
            </div>
          </div>
          <div className="flex min-w-52 items-end gap-2">
            <Field label="Quantidade de quartos *" compact>
              <select
                value={Math.max(1, rooms.length)}
                disabled={disabled}
                onChange={(event) => changeRoomCount(Number(event.target.value))}
                className="bbt-input h-10 min-w-24 py-1"
                aria-label="Quantidade de quartos"
              >
                {Array.from({ length: 30 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </Field>
            <div className="pb-2 text-xs text-slate-500">
              {guestCount} hóspede{guestCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {rooms.map((room, roomIndex) => {
            const occupancy = HOTEL_OCCUPANCIES[room.occupancy_code]
            return (
              <article
                key={room.client_id}
                className="overflow-visible rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <BedDouble className="h-4 w-4 text-bbt-accent" />
                    <div>
                      <div className="text-sm font-semibold text-bbt-primary dark:text-white">Quarto {roomIndex + 1}</div>
                      <div className="text-[11px] text-slate-500">Até {occupancy.slots.length} hóspede{occupancy.slots.length === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Tipo de acomodação / ocupação *" compact>
                      <select
                        value={room.occupancy_code}
                        disabled={disabled}
                        onChange={(event) => patchRoom(room.client_id, (current) => {
                          const occupancyCode = event.target.value as HotelOccupancyCode
                          return {
                            ...current,
                            occupancy_code: occupancyCode,
                            guests: guestsCompatibleWithOccupancy(current.guests, occupancyCode),
                          }
                        })}
                        className="bbt-input h-10 min-w-48 py-1 text-sm"
                        aria-label={`Tipo de acomodação do quarto ${roomIndex + 1}`}
                      >
                        {Object.entries(HOTEL_OCCUPANCIES).map(([code, item]) => (
                          <option key={code} value={code}>{item.label}</option>
                        ))}
                      </select>
                    </Field>
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (
                            roomHasFilledData(room)
                            && !window.confirm(`Remover o quarto ${roomIndex + 1} e seus hóspedes?`)
                          ) return
                          setRooms(rooms.filter((item) => item.client_id !== room.client_id))
                        }}
                        className="mb-0.5 rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/30"
                        title={`Remover quarto ${roomIndex + 1}`}
                        aria-label={`Remover quarto ${roomIndex + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 p-4 lg:grid-cols-2">
                  {occupancy.slots.map((slot) => {
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
                        externalContactFields
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

                <div className="px-4 pb-4">
                  <Field label="Observações do quarto">
                    <input
                      value={room.notes || ''}
                      disabled={disabled}
                      onChange={(event) => patchRoom(room.client_id, (current) => ({
                        ...current,
                        notes: event.target.value,
                      }))}
                      className="bbt-input"
                      placeholder="Ex.: camas separadas, berço, andar baixo"
                    />
                  </Field>
                </div>
              </article>
            )
          })}
        </div>

        <button
          type="button"
          disabled={disabled || rooms.length >= 30}
          onClick={() => setRooms([...rooms, createEmptyHotelRoom()])}
          className="bbt-button-ghost mt-4 text-sm"
        >
          <Plus className="h-4 w-4" /> Adicionar quarto
        </button>
      </section>

      <section
        className="rounded-xl border-2 border-blue-100 bg-blue-50/30 p-4 dark:border-blue-900/40 dark:bg-blue-900/10"
        aria-labelledby="hotel-demand-administrative"
      >
        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h4 id="hotel-demand-administrative" className="font-semibold text-bbt-primary dark:text-white">
              Dados administrativos
            </h4>
            <p className="text-xs text-slate-500">Responsáveis e referências de cobrança da demanda.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Empresa a cobrar *">
            <select
              value={companyId}
              disabled={disabled || companyLocked}
              onChange={(event) => changeCompany(event.target.value)}
              className="bbt-input"
              required
            >
              <option value="">Selecione a empresa</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.nome}</option>
              ))}
            </select>
          </Field>

          {showRequesterField && <Field label="Solicitante *">
            <select
              value={requesterId}
              disabled={disabled || requesterLocked || !companyId}
              onChange={(event) => {
                const requester = requesters.find((item) => item.id === event.target.value) || null
                onRequesterChange(requester)
              }}
              className="bbt-input"
              required
            >
              {selectedRequesterUnavailable && (
                <option value={requesterId} disabled>Solicitante indisponível: {requesterId}</option>
              )}
              <option value="">{requesterFallbackLabel || 'Selecione o solicitante'}</option>
              {requesters.map((requester) => (
                <option key={requester.id} value={requester.id}>
                  {requester.name}{requester.email ? ` · ${requester.email}` : ''}
                </option>
              ))}
            </select>
          </Field>}

          <Field label="Centro de custo">
            {costCentersUnavailable ? (
              <input
                value={costCenterCode}
                disabled={disabled}
                onChange={(event) => onCostCenterChange(null, event.target.value)}
                className="bbt-input"
                placeholder="Código do centro de custo"
              />
            ) : (
              <select
                value={costCenterId || ''}
                disabled={disabled || !companyId || costCentersLoading}
                onChange={(event) => {
                  const selected = costCenters.find((item) => item.id === event.target.value)
                  onCostCenterChange(selected?.id || null, selected?.code || '')
                }}
                className="bbt-input"
              >
                {selectedCostCenterUnavailable && (
                  <option value={costCenterId || ''} disabled>
                    Indisponível: {costCenterCode || costCenterId}
                  </option>
                )}
                <option value="">{costCentersLoading ? 'Carregando...' : 'Sem centro de custo'}</option>
                {costCenters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {`${'— '.repeat(Math.max(0, (item.hierarchyLevel || 1) - 1))}${item.code} · ${item.name}`}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Forma de pagamento">
            <div className="relative">
              <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={paymentMethod}
                disabled={disabled}
                onChange={(event) => onPaymentMethodChange(event.target.value as FormaPagamento | '')}
                className="bbt-input pl-9"
              >
                <option value="">Selecione</option>
                {(Object.keys(FORMAS_PAGAMENTO_LABEL) as FormaPagamento[]).map((method) => (
                  <option key={method} value={method}>{FORMAS_PAGAMENTO_LABEL[method]}</option>
                ))}
              </select>
            </div>
          </Field>

          <div className="md:col-span-2">
            <Field label="Observações da demanda">
              <textarea
                value={observations}
                disabled={disabled}
                onChange={(event) => onObservationsChange(event.target.value)}
                rows={3}
                maxLength={20_000}
                className="bbt-input min-h-24 resize-y"
                placeholder="Preferências, orientações de cobrança ou informações úteis ao consultor"
              />
            </Field>
          </div>
        </div>
      </section>
    </div>
  )
}

function guestsCompatibleWithOccupancy(
  guests: HotelDemandGuest[],
  occupancyCode: HotelOccupancyCode,
): HotelDemandGuest[] {
  const slots = HOTEL_OCCUPANCIES[occupancyCode].slots
  return guests.filter((guest) => {
    const slot = slots.find((item) => item.index === guest.slot_index)
    return Boolean(slot)
      && slot?.role === guest.role
      && (!guest.is_external || slot.allowsExternal)
  })
}

function roomHasFilledData(room: HotelDemandRoom): boolean {
  return room.guests.length > 0 || Boolean(room.notes?.trim())
}

function Field({
  label,
  compact = false,
  children,
}: {
  label: string
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={compact ? '' : 'min-w-0'}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
      </label>
      {children}
    </div>
  )
}
