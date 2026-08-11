import { formatDateBR } from '@/lib/date'
import { resolveVoucherPresentationSettings } from '@/lib/vouchers/presentation'
import type {
  VoucherEmitido,
  VoucherHospedeDetalhe,
  VoucherPresentationSettings,
  VoucherQuartoDetalhe,
} from '@/types'

export interface VoucherDocumentBranding {
  displayName: string
  primaryColor: string
  accentColor: string
  documentLegalName?: string | null
  documentNumber?: string | null
}

export interface VoucherDocumentField {
  label: string
  value: string
}

export interface VoucherDocumentTraveler {
  index: number
  name: string
  role?: string
  code?: string
  document?: string
  contact?: string
  room?: string
}

export interface VoucherDocumentRoom {
  number: number
  accommodation?: string
  category?: string
  mealPlan?: string
  guests?: string
}

export interface VoucherDocumentAirSegment {
  sequence: number
  departure: string
  arrival: string
  origin: string
  destination: string
  airlineCode: string
  airlineName: string
  flightNumber: string
  cabinClass?: string
  baggage?: string
}

export interface VoucherDocumentAirTicket {
  passenger: string
  passengerReference?: string
  ticketNumber: string
  airlineCode: string
  airlineName: string
}

export interface VoucherDocumentMoneyRow {
  label: string
  value: string
  total?: boolean
}

export interface VoucherDocumentModel {
  voucherId: string
  voucherType: string
  status: string
  cancelled: boolean
  issuedAt?: string
  agency: {
    name: string
    address: string
    cityPostalCode: string
    phone: string
    email: string
    documentNumber: string
    tourismRegistry: string
  }
  branding: VoucherDocumentBranding
  presentation: VoucherPresentationSettings
  summary: VoucherDocumentField[]
  travelerTitle: string
  travelers: VoucherDocumentTraveler[]
  hotel?: {
    name?: string
    fields: VoucherDocumentField[]
    rooms: VoucherDocumentRoom[]
  }
  air?: {
    primaryAirlineCode?: string
    primaryAirlineName?: string
    segments: VoucherDocumentAirSegment[]
    legacyFields: VoucherDocumentField[]
    reservationFields: VoucherDocumentField[]
    tickets: VoucherDocumentAirTicket[]
  }
  car?: { fields: VoucherDocumentField[] }
  otherService?: { fields: VoucherDocumentField[] }
  supplierFields: VoucherDocumentField[]
  confirmationFields: VoucherDocumentField[]
  moneyRows: VoucherDocumentMoneyRow[]
  paymentFields: VoucherDocumentField[]
  cancellationFields: VoucherDocumentField[]
  nonRefundable: boolean
  administrativeFields: VoucherDocumentField[]
  observations?: string
  issuedBy?: string
}

export interface BuildVoucherDocumentModelOptions {
  protectSensitiveData?: boolean
  branding?: Partial<VoucherDocumentBranding> | null
}

export const BBT_VOUCHER_AGENCY = Object.freeze({
  name: 'BBT AGENCIA DE VIAGENS E TURISMO GLOBAIS',
  address: 'Rua 22, Quadra 31 Lote 05 - Setor Barcelos',
  cityPostalCode: 'CEP 75383-321 - Trindade - GO',
  phone: '+55 (62) 3550-0851 / 98495-8417',
  email: 'financeiro@agenciabbt.com.br',
  documentNumber: '20.027.725/0001-80',
  tourismRegistry: '09.062567.10.0001-0',
})

export function buildVoucherDocumentModel(
  voucher: VoucherEmitido,
  options: BuildVoucherDocumentModelOptions = {},
): VoucherDocumentModel {
  const presentation = voucher.presentation_settings ?? resolveVoucherPresentationSettings({})
  const branding = normalizeVoucherDocumentBranding(options.branding)
  const protectSensitiveData = options.protectSensitiveData !== false
  const guests = normalizedGuests(voucher)
  const rooms = normalizedRooms(voucher, guests)
  const serviceKind = voucher.tipo === 'Hotel'
    ? 'hotel'
    : voucher.tipo === 'Aéreo'
      ? 'air'
      : voucher.tipo === 'Carro'
        ? 'car'
        : 'other'

  const summary = compactFields([
    documentField('Cliente / empresa', joinLines([voucher.empresa_nome, voucher.empresa_documento])),
    documentField(serviceKind === 'hotel' ? 'Hóspede responsável' : 'Viajante responsável', voucher.passageiro_nome),
    ...(presentation.showAdministrativeData ? [
      documentField('Pedido / OS', voucher.numero_solicitacao || voucher.atendimento_id),
      documentField('Solicitante', joinLines([voucher.solicitante_nome, voucher.solicitante_email])),
      documentField('Centro de custo', voucher.centro_custo),
      documentField('Unidade de negócio', voucher.unidade_negocio),
    ] : []),
  ])

  const travelers = guests.map((guest, index) => ({
    index: index + 1,
    name: guest.nome,
    role: guest.papel || (guest.principal || index === 0 ? 'Responsável' : 'Acompanhante'),
    code: textValue(guest.codigo),
    document: guest.documento
      ? (protectSensitiveData ? maskDocument(guest.documento) : guest.documento.trim())
      : undefined,
    contact: joinValues([guest.email, guest.telefone]),
    room: guest.quarto === undefined ? undefined : String(guest.quarto),
  }))

  const supplierFields = compactFields([
    documentField('Fornecedor operacional', voucher.fornecedor_nome),
    ...(presentation.showAdministrativeData ? [
      documentField('Código do fornecedor', voucher.fornecedor_codigo),
      documentField('Canal da reserva', voucher.canal_reserva),
    ] : []),
    documentField('Endereço', voucher.fornecedor_endereco),
    documentField('Cidade', voucher.fornecedor_cidade),
    documentField('Telefone', voucher.fornecedor_telefone),
    documentField('E-mail', voucher.fornecedor_email),
  ])

  const confirmationFields = compactFields([
    documentField('Localizador', voucher.localizador),
    documentField(
      'Número de confirmação',
      voucher.numero_confirmacao === voucher.localizador ? undefined : voucher.numero_confirmacao,
    ),
    ...(presentation.showAdministrativeData ? [
      documentField('Reserva', voucher.reserva_id),
      documentField('Data da reserva', formatDateTimeBR(voucher.data_reserva)),
      documentField('Data da confirmação', formatDateTimeBR(voucher.data_confirmacao)),
      documentField('Confirmado por', voucher.confirmado_por),
    ] : []),
  ])

  return {
    voucherId: voucher.id,
    voucherType: voucher.tipo,
    status: voucher.status,
    cancelled: voucher.status === 'cancelado',
    issuedAt: presentation.showAdministrativeData ? formatDateTimeBR(voucher.created_at) : undefined,
    agency: BBT_VOUCHER_AGENCY,
    branding,
    presentation,
    summary,
    travelerTitle: serviceKind === 'hotel' ? 'Hóspedes' : serviceKind === 'air' ? 'Passageiros' : 'Viajantes',
    travelers,
    hotel: serviceKind === 'hotel' ? buildHotelModel(voucher, rooms) : undefined,
    air: serviceKind === 'air' ? buildAirModel(voucher) : undefined,
    car: serviceKind === 'car' ? { fields: buildCarFields(voucher) } : undefined,
    otherService: serviceKind === 'other' ? { fields: buildOtherServiceFields(voucher) } : undefined,
    supplierFields,
    confirmationFields,
    moneyRows: presentation.showConfirmedValues ? buildMoneyRows(voucher, rooms.length) : [],
    paymentFields: presentation.showAdministrativeData ? compactFields([
      documentField('Forma de pagamento', voucher.forma_pagamento_voucher),
      documentField('Referência do pagamento', voucher.referencia_pagamento),
      documentField('Condições de pagamento', voucher.condicoes_pagamento),
    ]) : [],
    cancellationFields: presentation.showCancellationTerms ? buildCancellationFields(voucher) : [],
    nonRefundable: voucher.reembolsavel === false,
    administrativeFields: presentation.showAdministrativeData ? buildAdministrativeFields(voucher) : [],
    observations: textValue(voucher.observacoes),
    issuedBy: presentation.showAdministrativeData ? textValue(voucher.emitido_por_user_name) : undefined,
  }
}

export function collectVoucherDocumentAirlineCodes(voucher: VoucherEmitido): string[] {
  return [...new Set([
    ...(voucher.trechos_aereos || []).map((segment) => segment.companhia_codigo),
    ...(voucher.bilhetes_aereos || []).map((ticket) => ticket.companhia_codigo),
  ].map(normalizeAirlineCode).filter(Boolean))]
}

function buildHotelModel(voucher: VoucherEmitido, rooms: VoucherDocumentRoom[]) {
  const model = {
    name: textValue(voucher.hotel_nome),
    fields: compactFields([
      documentField('Endereço', voucher.hotel_endereco),
      documentField('Cidade', voucher.hotel_cidade),
      documentField('Telefone', voucher.hotel_telefone),
      documentField('E-mail', voucher.hotel_email),
      documentField('Check-in', formatDateTimeBR(voucher.checkin_em || voucher.data_checkin)),
      documentField('Check-out', formatDateTimeBR(voucher.checkout_em || voucher.data_checkout)),
      documentField('Noites', numberText(voucher.noites)),
      documentField('Apartamentos', numberText(voucher.num_apartamentos || rooms.length || undefined)),
      documentField('Hóspedes', numberText(voucher.num_hospedes)),
      documentField('Acomodação', voucher.tipo_apartamento),
      documentField('Categoria', voucher.hotel_categoria),
      documentField('Regime de alimentação', voucher.regime),
    ]),
    rooms,
  }
  return model.name || model.fields.length || model.rooms.length ? model : undefined
}

function buildAirModel(voucher: VoucherEmitido) {
  const segments = (voucher.trechos_aereos || []).map((segment) => ({
    sequence: segment.sequencia,
    departure: formatDateTimeBR(segment.saida_em) || segment.saida_em,
    arrival: formatDateTimeBR(segment.chegada_em) || segment.chegada_em,
    origin: joinDash([segment.origem_codigo, segment.origem_nome]) || '',
    destination: joinDash([segment.destino_codigo, segment.destino_nome]) || '',
    airlineCode: normalizeAirlineCode(segment.companhia_codigo),
    airlineName: segment.companhia_nome,
    flightNumber: joinValues([segment.companhia_codigo, segment.numero_voo]) || segment.numero_voo,
    cabinClass: joinValues([segment.cabine, segment.classe_reserva], ' · '),
    baggage: Number.isFinite(segment.bagagens) ? `${segment.bagagens} volume(s)` : undefined,
  }))
  const tickets = (voucher.bilhetes_aereos || []).map((ticket, index) => ({
    passenger: ticket.passageiro_nome,
    passengerReference: joinValues([
      `Passageiro ${ticket.passageiro_ordem || index + 1}`,
      ticket.passageiro_codigo,
    ]),
    ticketNumber: ticket.numero_bilhete,
    airlineCode: normalizeAirlineCode(ticket.companhia_codigo),
    airlineName: ticket.companhia_nome,
  }))
  const firstSegment = segments[0]
  const firstTicket = tickets[0]
  return {
    primaryAirlineCode: firstSegment?.airlineCode || firstTicket?.airlineCode || undefined,
    primaryAirlineName: firstSegment?.airlineName || firstTicket?.airlineName || textValue(voucher.cia_aerea),
    segments,
    legacyFields: segments.length ? [] : compactFields([
      documentField('Companhia aérea', voucher.cia_aerea),
      documentField('Voo', voucher.numero_voo),
      documentField('Origem', voucher.origem),
      documentField('Destino', voucher.destino),
      documentField('Ida', formatDateTimeBR(voucher.data_ida)),
      documentField('Volta', formatDateTimeBR(voucher.data_volta)),
      documentField('Classe', voucher.classe),
    ]),
    reservationFields: compactFields([
      documentField('Sistema de reserva', voucher.sistema_reserva),
      documentField('Localizador', voucher.localizador || voucher.numero_confirmacao),
      documentField('Prazo de emissão', formatDateTimeBR(voucher.prazo_emissao)),
      documentField('Câmbio', numberText(voucher.cambio, 4)),
      documentField('Milhagem do itinerário', numberText(voucher.milhagem)),
    ]),
    tickets,
  }
}

function buildCarFields(voucher: VoucherEmitido): VoucherDocumentField[] {
  return compactFields([
    documentField('Locadora', voucher.locadora),
    documentField('Categoria', voucher.categoria_carro),
    documentField('Retirada', voucher.retirada_local),
    documentField('Data da retirada', formatDateTimeBR(voucher.retirada_data)),
    documentField('Devolução', voucher.devolucao_local),
    documentField('Data da devolução', formatDateTimeBR(voucher.devolucao_data)),
  ])
}

function buildOtherServiceFields(voucher: VoucherEmitido): VoucherDocumentField[] {
  return compactFields([
    documentField('Serviço', voucher.tipo),
    documentField('Referência', voucher.numero_confirmacao || voucher.localizador),
    documentField('Origem', voucher.origem),
    documentField('Destino', voucher.destino || voucher.fornecedor_cidade),
    documentField('Início', formatDateTimeBR(voucher.data_ida)),
    documentField('Fim', formatDateTimeBR(voucher.data_volta)),
    documentField('Classe / categoria', voucher.classe),
  ])
}

function buildMoneyRows(voucher: VoucherEmitido, normalizedRoomCount: number): VoucherDocumentMoneyRow[] {
  const currency = normalizedCurrency(voucher.moeda) || 'BRL'
  const roomCount = voucher.num_apartamentos || normalizedRoomCount
  const dailyLabel = voucher.noites && roomCount
    ? `Diária por quarto · ${voucher.noites} noite(s) × ${roomCount} quarto(s)`
    : 'Valor da diária'
  return compactMoneyRows([
    moneyRow(dailyLabel, voucher.valor_diaria, currency),
    moneyRow('Taxas por diária', voucher.taxas_diaria, currency),
    moneyRow(voucher.tipo === 'Hotel' ? 'Subtotal das diárias' : 'Tarifa total', voucher.tarifa_total, currency),
    moneyRow('Taxas totais', voucher.taxas, currency),
    moneyRow('RAV', voucher.rav, currency),
    moneyRow('RAC', voucher.rac, currency),
    moneyRow('Tarifa de referência', voucher.tarifa_referencia, currency),
    moneyRow('Taxa de serviço', voucher.taxa_servico, currency),
    moneyRow(`TOTAL (${currency})`, voucher.total, currency, true),
  ])
}

function buildCancellationFields(voucher: VoucherEmitido): VoucherDocumentField[] {
  const refundability = voucher.reembolsavel === undefined
    ? undefined
    : voucher.reembolsavel ? 'Reembolsável' : 'Não reembolsável'
  return compactFields([
    documentField('Condição da tarifa', refundability),
    documentField('Prazo de cancelamento', formatDateTimeBR(voucher.prazo_cancelamento)),
    documentField('Política de cancelamento', voucher.politica_cancelamento),
    documentField('Política de no-show', voucher.politica_no_show),
  ])
}

function buildAdministrativeFields(voucher: VoucherEmitido): VoucherDocumentField[] {
  return compactFields([
    documentField('Pedido / OS', voucher.numero_solicitacao || voucher.atendimento_id),
    documentField('Solicitante', joinLines([voucher.solicitante_nome, voucher.solicitante_email])),
    documentField('Autorizador(es)', joinValues(voucher.autorizadores)),
    documentField('Solicitado em', formatDateTimeBR(voucher.data_solicitacao)),
    documentField('Reserva registrada em', formatDateTimeBR(voucher.data_reserva)),
    documentField('Confirmado em', formatDateTimeBR(voucher.data_confirmacao)),
    documentField('Aprovado em', formatDateTimeBR(voucher.autorizado_em)),
    documentField('Emitido em', formatDateTimeBR(voucher.created_at)),
    documentField('Centro de custo', voucher.centro_custo),
    documentField('Unidade de negócio', voucher.unidade_negocio),
    documentField('Departamento', voucher.departamento),
    documentField('Referência do pagamento', voucher.referencia_pagamento),
  ])
}

function normalizedGuests(voucher: VoucherEmitido): VoucherHospedeDetalhe[] {
  if (voucher.hospedes_detalhes?.length) {
    return voucher.hospedes_detalhes.filter((guest) => Boolean(textValue(guest.nome)))
  }
  const names = (voucher.passageiros || []).map(textValue).filter((value): value is string => Boolean(value))
  if (names.length) {
    return names.map((name, index) => ({
      nome: name,
      principal: index === 0,
      documento: index === 0 ? voucher.cpf : undefined,
    }))
  }
  const principalName = textValue(voucher.passageiro_nome)
  return principalName ? [{ nome: principalName, principal: true, documento: voucher.cpf }] : []
}

function normalizedRooms(
  voucher: VoucherEmitido,
  guests: VoucherHospedeDetalhe[],
): VoucherDocumentRoom[] {
  const explicit = voucher.quartos?.length ? voucher.quartos : undefined
  const fallbackCount = voucher.num_apartamentos
    || ([voucher.tipo_apartamento, voucher.hotel_categoria, voucher.regime].some(textValue) ? 1 : 0)
  const rooms: VoucherQuartoDetalhe[] = explicit || Array.from({ length: fallbackCount }, (_, index) => ({
    numero: index + 1,
    acomodacao: voucher.tipo_apartamento,
    categoria: voucher.hotel_categoria,
    regime: voucher.regime,
    ...(fallbackCount === 1 ? { hospedes: guests.map((guest) => guest.nome) } : {}),
  }))
  return rooms.map((room) => ({
    number: room.numero,
    accommodation: textValue(room.acomodacao || voucher.tipo_apartamento),
    category: textValue(room.categoria || voucher.hotel_categoria),
    mealPlan: textValue(room.regime || voucher.regime),
    guests: joinValues(room.hospedes),
  }))
}

export function normalizeVoucherDocumentBranding(
  value?: Partial<VoucherDocumentBranding> | null,
): VoucherDocumentBranding {
  return {
    displayName: textValue(value?.displayName) || 'BBT Corporativo',
    primaryColor: normalizedColor(value?.primaryColor, '#20265A'),
    accentColor: normalizedColor(value?.accentColor, '#21BFC5'),
    documentLegalName: textValue(value?.documentLegalName) || null,
    documentNumber: textValue(value?.documentNumber) || null,
  }
}

function normalizedColor(value: unknown, fallback: string): string {
  const color = String(value || '').trim()
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback
}

function documentField(label: string, value: unknown): VoucherDocumentField | null {
  const normalized = textValue(value)
  return normalized ? { label, value: normalized } : null
}

function compactFields(values: Array<VoucherDocumentField | null>): VoucherDocumentField[] {
  return values.filter((value): value is VoucherDocumentField => Boolean(value))
}

function moneyRow(
  label: string,
  value: number | undefined,
  currency: string,
  total = false,
): VoucherDocumentMoneyRow | null {
  return value === undefined || value === null || !Number.isFinite(value)
    ? null
    : { label, value: formatMoney(value, currency), total }
}

function compactMoneyRows(values: Array<VoucherDocumentMoneyRow | null>): VoucherDocumentMoneyRow[] {
  return values.filter((value): value is VoucherDocumentMoneyRow => Boolean(value))
}

function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function joinValues(values?: Array<string | null | undefined>, separator = ', '): string | undefined {
  const normalized = (values || []).map(textValue).filter((value): value is string => Boolean(value))
  return normalized.length ? normalized.join(separator) : undefined
}

function joinLines(values?: Array<string | null | undefined>): string | undefined {
  return joinValues(values, '\n')
}

function joinDash(values?: Array<string | null | undefined>): string | undefined {
  return joinValues(values, ' - ')
}

function numberText(value?: number, fractionDigits?: number): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined
  return fractionDigits === undefined
    ? String(value)
    : value.toLocaleString('pt-BR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
}

function normalizedCurrency(value?: string): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

function formatMoney(value: number, currency: string): string {
  try {
    return value.toLocaleString('pt-BR', { style: 'currency', currency })
  } catch {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

function formatDateTimeBR(value?: string): string | undefined {
  if (!textValue(value)) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value!)) return formatDateBR(value!, value!)
  const parsed = new Date(value!)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed)
}

function normalizeAirlineCode(value: unknown): string {
  const code = String(value || '').trim().toUpperCase()
  return /^[A-Z0-9]{2,3}$/.test(code) ? code : ''
}

function maskDocument(value: string): string {
  const normalized = value.trim()
  if (normalized.includes('*')) return normalized
  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
  if (normalized.length <= 4) return '***'
  return `${normalized.slice(0, 2)}${'*'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-2)}`
}
