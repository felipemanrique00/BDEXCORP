import type { PoolClient, QueryResultRow } from 'pg'

import type {
  VoucherEmitido,
  VoucherHospedeDetalhe,
  VoucherQuartoDetalhe,
} from '@/types'

type JsonRecord = Record<string, unknown>

export interface VoucherReservationProjection {
  id?: string | null
  createdAt?: string | Date | null
  startAt?: string | Date | null
  endAt?: string | Date | null
  grossAmount?: string | number | null
  taxAmount?: string | number | null
  finalAmount?: string | number | null
  currency?: string | null
  metadata?: JsonRecord | null
}

export interface VoucherDemandProjection {
  number?: string | null
  createdAt?: string | Date | null
  costCenter?: string | null
}

export interface VoucherCompanyProjection {
  name?: string | null
  documentNumber?: string | null
}

export interface VoucherEmployeeProjection {
  department?: string | null
  businessUnit?: string | null
}

export interface VoucherRequesterProjection {
  name?: string | null
  email?: string | null
}

export interface VoucherEmissionProjection {
  issuedAt?: string | Date | null
  metadata?: JsonRecord | null
}

export interface VoucherGuestProjection {
  name: string
  role?: string | null
  primary?: boolean | null
  code?: string | null
  document?: string | null
  email?: string | null
  phone?: string | null
  roomNumber?: string | number | null
}

export interface VoucherRoomProjection {
  number: string | number
  occupancyCode?: string | null
  guests?: string[] | null
}

export interface VoucherApprovalProjection {
  name?: string | null
  decidedAt?: string | Date | null
}

export interface VoucherEnrichmentProjection {
  reservation?: VoucherReservationProjection | null
  demand?: VoucherDemandProjection | null
  company?: VoucherCompanyProjection | null
  employee?: VoucherEmployeeProjection | null
  requester?: VoucherRequesterProjection | null
  emission?: VoucherEmissionProjection | null
  selectionSnapshot?: JsonRecord | null
  guests?: VoucherGuestProjection[] | null
  rooms?: VoucherRoomProjection[] | null
  approvals?: VoucherApprovalProjection[] | null
  authorizedAt?: string | Date | null
}

interface VoucherEnrichmentRow extends QueryResultRow {
  voucher_id: string
  reservation_id: string | null
  reservation_created_at: string | Date | null
  reservation_start_at: string | Date | null
  reservation_end_at: string | Date | null
  reservation_gross_amount: string | number | null
  reservation_tax_amount: string | number | null
  reservation_final_amount: string | number | null
  reservation_currency: string | null
  reservation_metadata: JsonRecord | null
  demand_number: string | null
  demand_created_at: string | Date | null
  demand_cost_center: string | null
  company_name: string | null
  company_document_number: string | null
  employee_department: string | null
  employee_business_unit: string | null
  requester_name: string | null
  requester_email: string | null
  emission_issued_at: string | Date | null
  emission_metadata: JsonRecord | null
  selection_snapshot: JsonRecord | null
  guests: unknown
  rooms: unknown
  approvals: unknown
  authorized_at: string | Date | null
}

/**
 * Enriquece um voucher sem consultar estado externo. Campos relacionais somente
 * substituem o legado quando a fonte possui um valor concreto; valores ausentes
 * nunca sao fabricados nem apagam informacao valida do voucher base.
 */
export function enrichVoucherWithProjection(
  base: VoucherEmitido,
  projection: VoucherEnrichmentProjection,
): VoucherEmitido {
  const reservation = projection.reservation || {}
  const demand = projection.demand || {}
  const company = projection.company || {}
  const employee = projection.employee || {}
  const requester = projection.requester || {}
  const emission = projection.emission || {}

  const reservationMetadata = objectValue(reservation.metadata)
  const reservationDetails = objectValue(reservationMetadata.details)
  const approvedTerms = objectValue(reservationMetadata.approvedCommercialTerms)
  const selectionSnapshot = objectValue(
    projection.selectionSnapshot && Object.keys(projection.selectionSnapshot).length
      ? projection.selectionSnapshot
      : approvedTerms.snapshot,
  )
  const snapshotDemand = objectValue(selectionSnapshot.demand)
  const snapshotOption = objectValue(selectionSnapshot.option)
  const snapshotHotel = objectValue(snapshotOption.hotel)
  const approvedHotel = objectValue(approvedTerms.hotel)
  const breakdown = objectValue(
    Object.keys(objectValue(snapshotOption.breakdown)).length
      ? snapshotOption.breakdown
      : approvedTerms.breakdown,
  )
  const emissionMetadata = objectValue(emission.metadata)
  const payment = objectValue(emissionMetadata.payment)

  const result: VoucherEmitido = {
    ...base,
    ...(base.cpf ? { cpf: maskGuestDocument(base.cpf) } : {}),
  }

  assignText(result, 'empresa_nome', company.name)
  assignText(result, 'empresa_documento', company.documentNumber)
  assignText(result, 'departamento', employee.department)
  assignText(result, 'unidade_negocio', employee.businessUnit)
  assignText(result, 'solicitante_nome', requester.name)
  assignEmail(result, 'solicitante_email', requester.email)
  assignText(result, 'numero_solicitacao', demand.number)
  assignText(result, 'centro_custo', demand.costCenter)
  assignText(result, 'reserva_id', reservation.id)
  assignIso(result, 'data_solicitacao', demand.createdAt)
  assignIso(result, 'data_reserva', reservation.createdAt)

  assignText(result, 'fornecedor_nome', reservationMetadata.supplierName)
  assignText(result, 'fornecedor_codigo', reservationMetadata.supplierCode)
  assignText(result, 'canal_reserva', reservationMetadata.channel)
  assignText(result, 'localizador', reservationMetadata.externalReference)
  assignText(result, 'numero_confirmacao', reservationMetadata.externalReference)

  const approvedNames = uniqueTexts((projection.approvals || []).map((approval) => approval.name)).slice(0, 50)
  if (approvedNames.length) result.autorizadores = approvedNames
  const authorizedAt = isoValue(projection.authorizedAt)
    || latestIso((projection.approvals || []).map((approval) => approval.decidedAt))
  if (authorizedAt) result.autorizado_em = authorizedAt

  const guestDetails = mapGuests(projection.guests || [])
  if (guestDetails.length) {
    result.hospedes_detalhes = guestDetails
    result.passageiros = uniqueTexts(guestDetails.map((guest) => guest.nome))
    result.num_hospedes = guestDetails.length
    const primary = guestDetails.find((guest) => guest.principal) || guestDetails[0]
    if (primary) {
      result.passageiro_nome = primary.nome
      if (primary.documento) result.cpf = primary.documento
    }
  }

  const reservationGross = numberValue(reservation.grossAmount)
  const reservationTaxes = numberValue(reservation.taxAmount)
  const reservationTotal = numberValue(reservation.finalAmount)
  const roomSubtotal = numberValue(breakdown.roomSubtotal)
  const nightlyRate = numberValue(breakdown.nightlyRate)
  const nightlyTaxes = numberValue(breakdown.nightlyTaxes)
  const serviceFee = numberValue(breakdown.serviceFee)
  const nights = positiveInteger(breakdown.nights)
  const quotedRoomCount = positiveInteger(breakdown.roomCount)

  const confirmedRoomSubtotal = roomSubtotal ?? reservationGross
  if (confirmedRoomSubtotal !== undefined) result.tarifa_total = confirmedRoomSubtotal
  if (reservationTaxes !== undefined) result.taxas = reservationTaxes
  if (reservationTotal !== undefined) result.total = reservationTotal
  assignText(result, 'moeda', reservation.currency)

  if (base.tipo === 'Hotel') {
    assignText(result, 'hotel_nome', firstText(snapshotHotel.name, approvedHotel.name, reservationDetails.itemName))
    assignText(result, 'hotel_endereco', snapshotHotel.address)
    assignText(result, 'hotel_cidade', firstText(snapshotHotel.city, snapshotDemand.cityName, approvedHotel.destination, reservationDetails.destination))
    assignText(result, 'hotel_telefone', snapshotHotel.phone)
    assignEmail(result, 'hotel_email', snapshotHotel.email)
    assignText(result, 'hotel_categoria', firstText(snapshotHotel.category, approvedHotel.category, reservationDetails.category))
    assignText(result, 'tipo_apartamento', firstText(snapshotHotel.roomCategory, approvedHotel.accommodation, reservationDetails.accommodation))
    assignText(result, 'regime', firstText(snapshotHotel.mealPlan, approvedHotel.mealPlan, reservationDetails.mealPlan))

    const checkIn = isoValue(reservation.startAt)
    const checkOut = isoValue(reservation.endAt)
    if (checkIn) {
      result.checkin_em = checkIn
      result.data_checkin = checkIn.slice(0, 10)
    }
    if (checkOut) {
      result.checkout_em = checkOut
      result.data_checkout = checkOut.slice(0, 10)
    }

    if (nightlyRate !== undefined) result.valor_diaria = nightlyRate
    if (nightlyTaxes !== undefined) result.taxas_diaria = nightlyTaxes
    if (serviceFee !== undefined) result.taxa_servico = serviceFee
    if (nights !== undefined) result.noites = nights

    const roomDetails = mapRooms(
      projection.rooms || [],
      firstText(snapshotHotel.roomCategory, approvedHotel.accommodation, reservationDetails.accommodation),
      firstText(snapshotHotel.category, approvedHotel.category, reservationDetails.category),
      firstText(snapshotHotel.mealPlan, approvedHotel.mealPlan, reservationDetails.mealPlan),
    )
    if (roomDetails.length) {
      result.quartos = roomDetails
      result.num_apartamentos = roomDetails.length
    } else if (quotedRoomCount !== undefined) {
      result.num_apartamentos = quotedRoomCount
    }

    assignText(result, 'condicoes_pagamento', firstText(snapshotHotel.paymentTerms, approvedTerms.paymentTerms))
    assignText(result, 'prazo_cancelamento', firstText(snapshotHotel.cancellationDeadline, breakdown.cancellationDeadline))
    assignText(result, 'politica_cancelamento', firstText(snapshotHotel.cancellationPolicy, approvedTerms.cancellationPolicy))
    assignText(result, 'politica_no_show', snapshotHotel.noShowPolicy)
    if (typeof snapshotOption.refundable === 'boolean') result.reembolsavel = snapshotOption.refundable
    else if (typeof approvedTerms.refundable === 'boolean') result.reembolsavel = approvedTerms.refundable
  }

  const paymentMethod = paymentMethodLabel(payment.method)
  if (paymentMethod) result.forma_pagamento_voucher = paymentMethod
  assignText(result, 'referencia_pagamento', payment.reference)
  assignIso(result, 'data_confirmacao', emission.issuedAt)

  return result
}

/**
 * Carrega toda a projecao necessaria em uma unica consulta e preserva a ordem
 * recebida. Vouchers sem linha relacional correspondente permanecem intactos.
 */
export async function enrichVouchersFromDatabase(
  client: PoolClient,
  tenantId: string,
  vouchers: readonly VoucherEmitido[],
): Promise<VoucherEmitido[]> {
  if (!vouchers.length) return []

  const ids = [...new Set(vouchers.map((voucher) => voucher.id))]
  const result = await client.query<VoucherEnrichmentRow>(
    `select
       voucher.id as voucher_id,
       reservation.id as reservation_id,
       reservation.created_at as reservation_created_at,
       reservation.start_at as reservation_start_at,
       reservation.end_at as reservation_end_at,
       reservation.gross_amount as reservation_gross_amount,
       reservation.tax_amount as reservation_tax_amount,
       reservation.final_amount as reservation_final_amount,
       reservation.currency as reservation_currency,
       reservation.metadata as reservation_metadata,
       demand.demand_number,
       demand.created_at as demand_created_at,
       demand.cost_center as demand_cost_center,
       coalesce(company.trade_name, company.legal_name) as company_name,
       company.document_number as company_document_number,
       employee.department as employee_department,
       coalesce(
         nullif(employee.metadata ->> 'businessUnit', ''),
         nullif(employee.metadata ->> 'unidadeNegocio', ''),
         nullif(employee.metadata ->> 'unidade_negocio', '')
       ) as employee_business_unit,
       requester.name as requester_name,
       requester.email::text as requester_email,
       emission.issued_at as emission_issued_at,
       emission.metadata as emission_metadata,
       selection.snapshot as selection_snapshot,
       coalesce(guest_projection.items, '[]'::jsonb) as guests,
       coalesce(room_projection.items, '[]'::jsonb) as rooms,
       coalesce(approval_projection.items, '[]'::jsonb) as approvals,
       approval_projection.authorized_at
     from vouchers voucher
     left join reservations reservation
       on reservation.tenant_id = voucher.tenant_id
      and reservation.id = voucher.reservation_id
     left join demands demand
       on demand.tenant_id = voucher.tenant_id
      and demand.id = coalesce(voucher.demand_id, reservation.demand_id)
     left join companies company
       on company.tenant_id = voucher.tenant_id
      and company.id = coalesce(voucher.company_id, reservation.company_id, demand.company_id)
     left join employees employee
       on employee.tenant_id = voucher.tenant_id
      and employee.id = coalesce(voucher.employee_id, reservation.employee_id, demand.employee_id)
     left join requesters requester
       on requester.tenant_id = voucher.tenant_id
      and requester.id = demand.requester_id
     left join travel_emissions emission
       on emission.tenant_id = voucher.tenant_id
      and emission.id = voucher.emission_id
     left join travel_quote_selections selection
       on selection.tenant_id = voucher.tenant_id
      and selection.id = reservation.quote_selection_id
     left join lateral (
       select jsonb_agg(
         jsonb_build_object(
           'name', traveler.name_snapshot,
           'role', traveler.traveler_role,
           'primary', traveler.is_primary,
           'code', coalesce(
             nullif(traveler_employee.identification_code, ''),
             nullif(traveler.metadata ->> 'code', ''),
             nullif(traveler.metadata ->> 'codigo', '')
           ),
           'document', coalesce(
             nullif(traveler.document_number_snapshot, ''),
             nullif(traveler_employee.document_number, ''),
             nullif(traveler.metadata ->> 'documentNumber', ''),
             nullif(traveler.metadata ->> 'documento', ''),
             nullif(traveler.metadata ->> 'cpf', '')
           ),
           'email', coalesce(traveler.email_snapshot::text, traveler_employee.email::text),
           'phone', coalesce(traveler.phone_snapshot, traveler_employee.phone),
           'roomNumber', room.room_sequence
         ) order by traveler.is_primary desc,
                    traveler.traveler_sequence nulls last,
                    room.room_sequence nulls last,
                    room_guest.slot_index nulls last,
                    traveler.name_snapshot
       ) as items
       from demand_travelers traveler
       left join employees traveler_employee
         on traveler_employee.tenant_id = traveler.tenant_id
        and traveler_employee.company_id = traveler.company_id
        and traveler_employee.id = traveler.employee_id
       left join hotel_demand_room_guests room_guest
         on room_guest.tenant_id = traveler.tenant_id
        and room_guest.demand_id = traveler.demand_id
        and room_guest.traveler_id = traveler.id
       left join hotel_demand_rooms room
         on room.tenant_id = room_guest.tenant_id
        and room.id = room_guest.room_id
       where traveler.tenant_id = voucher.tenant_id
         and traveler.demand_id = demand.id
         and traveler.deleted_at is null
     ) guest_projection on true
     left join lateral (
       select jsonb_agg(
         jsonb_build_object(
           'number', room.room_sequence,
           'occupancyCode', room.occupancy_code,
           'guests', coalesce(room_guests.names, '[]'::jsonb)
         ) order by room.room_sequence
       ) as items
       from hotel_demand_rooms room
       left join lateral (
         select jsonb_agg(traveler.name_snapshot order by room_guest.slot_index) as names
         from hotel_demand_room_guests room_guest
         join demand_travelers traveler
           on traveler.tenant_id = room_guest.tenant_id
          and traveler.demand_id = room_guest.demand_id
          and traveler.id = room_guest.traveler_id
          and traveler.deleted_at is null
         where room_guest.tenant_id = room.tenant_id
           and room_guest.room_id = room.id
       ) room_guests on true
       where room.tenant_id = voucher.tenant_id
         and room.demand_id = demand.id
         and room.deleted_at is null
     ) room_projection on true
     left join lateral (
       select
         jsonb_agg(
           jsonb_build_object('name', approver.name, 'decidedAt', decision.decided_at)
           order by decision.decided_at, decision.id
         ) filter (where approver.name is not null) as items,
         max(decision.decided_at) as authorized_at
       from approval_decisions decision
       left join users approver on approver.id = decision.decided_by_user_id
       where decision.tenant_id = voucher.tenant_id
         and decision.approval_instance_id = selection.approval_instance_id
         and decision.decision = 'approved'
     ) approval_projection on true
     where voucher.tenant_id = $1
       and voucher.id = any($2::text[])
       and voucher.deleted_at is null`,
    [tenantId, ids],
  )

  const projections = new Map(
    result.rows.map((row) => [row.voucher_id, projectionFromRow(row)]),
  )
  return vouchers.map((voucher) => {
    const projection = projections.get(voucher.id)
    return projection ? enrichVoucherWithProjection(voucher, projection) : { ...voucher }
  })
}

/** Mascara CPF e outros documentos sem reter mais do que os quatro ultimos digitos. */
export function maskGuestDocument(value: unknown): string | undefined {
  const original = textValue(value)
  if (!original) return undefined
  if (original.includes('*')) return original
  const digits = original.replace(/\D/g, '')
  if (!digits) return undefined
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${'*'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`
}

function projectionFromRow(row: VoucherEnrichmentRow): VoucherEnrichmentProjection {
  return {
    reservation: {
      id: row.reservation_id,
      createdAt: row.reservation_created_at,
      startAt: row.reservation_start_at,
      endAt: row.reservation_end_at,
      grossAmount: row.reservation_gross_amount,
      taxAmount: row.reservation_tax_amount,
      finalAmount: row.reservation_final_amount,
      currency: row.reservation_currency,
      metadata: row.reservation_metadata,
    },
    demand: {
      number: row.demand_number,
      createdAt: row.demand_created_at,
      costCenter: row.demand_cost_center,
    },
    company: {
      name: row.company_name,
      documentNumber: row.company_document_number,
    },
    employee: {
      department: row.employee_department,
      businessUnit: row.employee_business_unit,
    },
    requester: {
      name: row.requester_name,
      email: row.requester_email,
    },
    emission: {
      issuedAt: row.emission_issued_at,
      metadata: row.emission_metadata,
    },
    selectionSnapshot: row.selection_snapshot,
    guests: arrayValue<VoucherGuestProjection>(row.guests),
    rooms: arrayValue<VoucherRoomProjection>(row.rooms),
    approvals: arrayValue<VoucherApprovalProjection>(row.approvals),
    authorizedAt: row.authorized_at,
  }
}

function mapGuests(guests: VoucherGuestProjection[]): VoucherHospedeDetalhe[] {
  return guests.slice(0, 100).flatMap((guest) => {
    const name = textValue(guest.name)
    if (!name) return []
    const room = positiveInteger(guest.roomNumber)
    const document = maskGuestDocument(guest.document)
    const email = emailValue(guest.email)
    return [{
      nome: name,
      ...(textValue(guest.role) ? { papel: guestRoleLabel(String(guest.role)) } : {}),
      ...(typeof guest.primary === 'boolean' ? { principal: guest.primary } : {}),
      ...(textValue(guest.code) ? { codigo: textValue(guest.code) } : {}),
      ...(document ? { documento: document } : {}),
      ...(email ? { email } : {}),
      ...(textValue(guest.phone) ? { telefone: textValue(guest.phone) } : {}),
      ...(room !== undefined ? { quarto: room } : {}),
    } satisfies VoucherHospedeDetalhe]
  })
}

function mapRooms(
  rooms: VoucherRoomProjection[],
  accommodation?: string,
  category?: string,
  mealPlan?: string,
): VoucherQuartoDetalhe[] {
  return rooms.slice(0, 99).flatMap((room) => {
    const number = positiveInteger(room.number)
    if (number === undefined) return []
    const guests = uniqueTexts(Array.isArray(room.guests) ? room.guests : []).slice(0, 12)
    return [{
      numero: number,
      ...(firstText(accommodation, occupancyLabel(room.occupancyCode)) ? {
        acomodacao: firstText(accommodation, occupancyLabel(room.occupancyCode)),
      } : {}),
      ...(category ? { categoria: category } : {}),
      ...(mealPlan ? { regime: mealPlan } : {}),
      ...(guests.length ? { hospedes: guests } : {}),
    } satisfies VoucherQuartoDetalhe]
  })
}

function guestRoleLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'responsible') return 'Responsável'
  if (normalized === 'companion') return 'Acompanhante'
  if (normalized === 'guest') return 'Hóspede'
  return value.trim()
}

function occupancyLabel(value: unknown): string | undefined {
  const normalized = textValue(value)?.toLowerCase()
  if (!normalized) return undefined
  const labels: Record<string, string> = {
    single: 'Single',
    double: 'Duplo',
    twin: 'Twin',
    triple: 'Triplo',
    quadruple: 'Quadruplo',
    family: 'Familiar',
  }
  return labels[normalized] || textValue(value)
}

function paymentMethodLabel(value: unknown): string | undefined {
  const normalized = textValue(value)?.toLowerCase()
  if (!normalized) return undefined
  const labels: Record<string, string> = {
    faturado: 'Faturado',
    pix: 'PIX',
    cartao_corporativo: 'Cartao corporativo',
    cartao_agencia: 'Cartao da agencia',
    transferencia: 'Transferencia bancaria',
    dinheiro: 'Dinheiro',
    outro: 'Outro',
  }
  return labels[normalized] || textValue(value)
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function textValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function emailValue(value: unknown): string | undefined {
  const email = textValue(value)?.toLowerCase()
  return email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : undefined
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textValue(value)
    if (text) return text
  }
  return undefined
}

function uniqueTexts(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = textValue(value)
    if (!text) continue
    const key = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  return result
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const number = numberValue(value)
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined
}

function isoValue(value: unknown): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function latestIso(values: readonly unknown[]): string | undefined {
  return values
    .map(isoValue)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
}

function assignText<K extends keyof VoucherEmitido>(
  target: VoucherEmitido,
  key: K,
  value: unknown,
): void {
  const text = textValue(value)
  if (text) (target as Record<keyof VoucherEmitido, unknown>)[key] = text
}

function assignIso<K extends keyof VoucherEmitido>(
  target: VoucherEmitido,
  key: K,
  value: unknown,
): void {
  const iso = isoValue(value)
  if (iso) (target as Record<keyof VoucherEmitido, unknown>)[key] = iso
}

function assignEmail<K extends keyof VoucherEmitido>(
  target: VoucherEmitido,
  key: K,
  value: unknown,
): void {
  const email = emailValue(value)
  if (email) (target as Record<keyof VoucherEmitido, unknown>)[key] = email
}
