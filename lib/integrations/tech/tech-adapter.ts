import { techRequest } from '@/lib/integrations/tech/tech-client'
import { getTechConfig, techConfigured, techMissingConfig } from '@/lib/integrations/tech/tech-config'
import {
  assertTechMutationConfirmed,
  TechIntegrationError,
} from '@/lib/integrations/tech/tech-errors'
import { getIdempotencyKey, getIdempotentResult, requestId, setIdempotentResult } from '@/lib/integrations/tech/tech-idempotency'
import { logTechIntegration } from '@/lib/integrations/tech/tech-logger'
import {
  buildAirAvailabilityPayload,
  buildCityPayload,
  buildHotelAvailabilityPayload,
  normalizeAirOptions,
  normalizeCities,
  normalizeHotelOptions,
} from '@/lib/integrations/tech/tech-mappers'
import { accessTechCompany, getTechSession, listTechCompanies } from '@/lib/integrations/tech/tech-session'
import type {
  IntegrationHealth,
  ProviderCompany,
  TravelQuote,
  TravelQuoteRequest,
  TravelReservation,
  TravelReservationRequest,
  TravelService,
} from '@/lib/integrations/types'
import { createEntityId } from '@/lib/ids'

export async function techHealth(): Promise<IntegrationHealth> {
  const config = getTechConfig()
  const configured = techConfigured(config)
  if (!configured) {
    return {
      ok: false,
      provider: 'tech-ttravel',
      mode: config.mode,
      configured: false,
      connected: false,
      baseUrl: config.baseUrl,
      message: `Tech Travel aguardando configuração: ${techMissingConfig(config).join(', ')}.`,
      capabilities: techCapabilities(),
      checkedAt: new Date().toISOString(),
    }
  }

  try {
    const session = await getTechSession()
    return {
      ok: true,
      provider: 'tech-ttravel',
      mode: config.mode,
      configured: true,
      connected: true,
      baseUrl: config.baseUrl,
      message: 'Conexão Tech Travel ativa.',
      requiresCompanyAccess: session.requiresCompanyAccess,
      selectedCompanyId: session.selectedCompanyId || config.defaultCompanyId,
      capabilities: techCapabilities(),
      checkedAt: new Date().toISOString(),
    }
  } catch (error: unknown) {
    return {
      ok: false,
      provider: 'tech-ttravel',
      mode: config.mode,
      configured: true,
      connected: false,
      baseUrl: config.baseUrl,
      message: error instanceof Error ? error.message : 'Falha ao validar conexão Tech Travel.',
      capabilities: techCapabilities(),
      checkedAt: new Date().toISOString(),
    }
  }
}

export async function techCompanies(): Promise<ProviderCompany[]> {
  return listTechCompanies()
}

export async function techAccessCompany(companyId: string | number): Promise<boolean> {
  const session = await getTechSession({ force: true })
  return accessTechCompany(session.token, companyId)
}

export async function techSearchCities(args: { query: string; service: TravelService; providerCompanyId?: string | number | null }) {
  const config = getTechConfig()
  const session = await getTechSession({ companyId: args.providerCompanyId })
  const response = await techRequest<unknown>(
    '/BuscarCidades',
    {
      method: 'POST',
      body: buildCityPayload(args.query, args.service, session.token),
      requestId: requestId('tech_city'),
    },
    config,
  )
  await logTechIntegration({
    action: 'cities',
    status: 'success',
    message: `Busca de cidades Tech concluída para ${args.query}.`,
    endpoint: '/BuscarCidades',
    durationMs: response.durationMs,
    metadata: { service: args.service, total: normalizeCities(response.data).length },
  })
  return { cities: normalizeCities(response.data), raw: response.data }
}

export async function techCreateQuote(request: TravelQuoteRequest): Promise<TravelQuote> {
  if (!['aereo', 'hotelaria'].includes(request.service)) {
    throw new TechIntegrationError(
      `Cotação ${request.service} indisponível: o endpoint de disponibilidade não foi fornecido pela Tech Travel.`,
      { status: 501, code: 'TECH_QUOTE_CAPABILITY_UNAVAILABLE' },
    )
  }
  const config = getTechConfig()
  const session = await getTechSession({ companyId: request.providerCompanyId })
  const id = createEntityId('tech_quote', '_')

  if (request.service === 'aereo') {
    const response = await techRequest<unknown>(
      '/BuscarDisponibilidade',
      {
        method: 'POST',
        body: buildAirAvailabilityPayload(request, session.token),
        requestId: requestId('tech_air_quote'),
      },
      config,
    )
    const quote: TravelQuote = {
      id,
      provider: 'tech-ttravel',
      service: 'aereo',
      request,
      options: normalizeAirOptions(response.data),
      raw: response.data,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      warnings: [],
    }
    await logTechIntegration({
      action: 'quote',
      status: 'success',
      message: `Cotação aérea Tech criada com ${quote.options.length} opção(ões).`,
      endpoint: '/BuscarDisponibilidade',
      durationMs: response.durationMs,
      metadata: { quoteId: quote.id, service: quote.service },
    })
    return quote
  }

  if (request.service === 'hotelaria') {
    const effectiveRequest = await ensureHotelCityId(request)
    const response = await techRequest<unknown>(
      '/Hotel/BuscarDisponibilidade',
      {
        method: 'POST',
        body: buildHotelAvailabilityPayload(effectiveRequest, session.token),
        requestId: requestId('tech_hotel_quote'),
      },
      config,
    )
    const quote: TravelQuote = {
      id,
      provider: 'tech-ttravel',
      service: 'hotelaria',
      request: effectiveRequest,
      options: normalizeHotelOptions(response.data),
      raw: response.data,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      warnings: [],
    }
    await logTechIntegration({
      action: 'quote',
      status: 'success',
      message: `Cotação de hotel Tech criada com ${quote.options.length} opção(ões).`,
      endpoint: '/Hotel/BuscarDisponibilidade',
      durationMs: response.durationMs,
      metadata: { quoteId: quote.id, service: quote.service },
    })
    return quote
  }

  throw new TechIntegrationError('Serviço de cotação Tech não mapeado.', {
    status: 501,
    code: 'TECH_QUOTE_CAPABILITY_UNAVAILABLE',
  })
}

export async function techFareAir(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>('/TarifarDisponibilidade', {
    method: 'POST',
    body: { DadosTarifas: payload, Token: session.token },
    requestId: requestId('tech_air_fare'),
  })
  await logTechIntegration({
    action: 'fare',
    status: 'success',
    message: 'Tarifação aérea Tech concluída.',
    endpoint: '/TarifarDisponibilidade',
    durationMs: response.durationMs,
  })
  return response.data
}

export async function techCreateReservation(request: TravelReservationRequest): Promise<TravelReservation> {
  if (!request.confirmed) {
    throw new TechIntegrationError(
      'Confirmação explícita obrigatória antes de enviar a reserva para a Tech Travel.',
      { status: 409, code: 'TECH_RESERVATION_CONFIRMATION_REQUIRED' },
    )
  }

  const key = getIdempotencyKey('tech_reservation', request, request.idempotencyKey)
  const cached = getIdempotentResult<TravelReservation>(key)
  if (cached) return cached

  const endpoint = request.service === 'hotelaria' ? '/Hotel/CriarReserva' : request.service === 'aereo' ? '/CriarReservaAereo' : null
  if (!endpoint) {
    throw new TechIntegrationError(
      `Reserva ${request.service} indisponível: o endpoint de criação não foi fornecido pela Tech Travel.`,
      { status: 501, code: 'TECH_RESERVATION_CAPABILITY_UNAVAILABLE' },
    )
  }
  const session = await getTechSession({
    companyId: scalarValue(request.payload?.providerCompanyId),
  })

  const body =
    request.service === 'hotelaria'
      ? { CriarReserva: request.payload?.CriarReserva || request.payload || {}, Token: session.token }
      : { DadosCriar: request.payload?.DadosCriar || request.payload || {}, Token: session.token }

  const response = await techRequest<unknown>(endpoint, {
    method: 'POST',
    body,
    requestId: requestId('tech_reservation'),
  })

  assertTechMutationConfirmed(response.data, 'reserve')
  const references = reservationReferences(response.data)
  const reservation: TravelReservation = {
    id: createEntityId('tech_res', '_'),
    provider: 'tech-ttravel',
    service: request.service,
    status: 'reserved',
    idOs: references.idOs || nullableText(request.idOs) || '',
    localizador: references.localizador,
    sistema: references.sistema,
    request,
    raw: response.data,
    createdAt: new Date().toISOString(),
  }
  await logTechIntegration({
    action: 'reserve',
    status: 'success',
    message: `Reserva enviada para Tech Travel${reservation.idOs ? ` na OS ${reservation.idOs}` : ''}.`,
    endpoint,
    durationMs: response.durationMs,
    metadata: { reservationId: reservation.id, idOs: reservation.idOs },
  })
  return setIdempotentResult(key, reservation)
}

export async function techConsultOS(idOs: string | number, providerCompanyId?: string | number | null) {
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>('/ConsultarOS', {
    method: 'GET',
    query: { token: session.token, idOs },
    requestId: requestId('tech_os'),
  })
  await logTechIntegration({
    action: 'status',
    status: 'success',
    message: `OS ${idOs} consultada na Tech.`,
    endpoint: '/ConsultarOS',
    durationMs: response.durationMs,
    metadata: { idOs },
  })
  return response.data
}

export async function techConsultReservation(lookup: {
  idOs: string | number
  localizador: string
  sistema: string
  tipoSistema: string
  chaveConsulta: string
  providerCompanyId?: string | number | null
}) {
  const session = await getTechSession({ companyId: lookup.providerCompanyId })
  const response = await techRequest<unknown>('/ConsultarReserva', {
    method: 'POST',
    body: {
      DadosConsulta: {
        IdOs: lookup.idOs,
        Localizador: lookup.localizador,
        Sistema: lookup.sistema,
        TipoSistema: lookup.tipoSistema,
        ChaveConsulta: lookup.chaveConsulta,
      },
      Token: session.token,
    },
    requestId: requestId('tech_res_lookup'),
  })
  await logTechIntegration({
    action: 'voucher-data',
    status: 'success',
    message: `Reserva ${lookup.localizador} consultada na Tech.`,
    endpoint: '/ConsultarReserva',
    durationMs: response.durationMs,
    metadata: { idOs: lookup.idOs, localizador: lookup.localizador, sistema: lookup.sistema },
  })
  return response.data
}

export async function techIssueReservation(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  const key = getIdempotencyKey('tech_issue', payload, String(payload.idempotencyKey || ''))
  const cached = getIdempotentResult<unknown>(key)
  if (cached) return cached
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>('/Emitir', {
    method: 'POST',
    body: { DadosParaEmissao: payload, Token: session.token },
    requestId: requestId('tech_issue'),
  })
  assertTechMutationConfirmed(response.data, 'issue')
  await logTechIntegration({
    action: 'issue',
    status: 'success',
    message: 'Emissão enviada para Tech Travel.',
    endpoint: '/Emitir',
    durationMs: response.durationMs,
  })
  return setIdempotentResult(key, response.data)
}

export async function techCancelReservation(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  return techPostSensitive('/CancelarReserva', 'cancel', { DadosConsulta: payload }, providerCompanyId)
}

export async function techCancelTicket(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  return techPostSensitive('/CancelarBilhete', 'cancel-ticket', { DadosCancelaBilhete: payload }, providerCompanyId)
}

export async function techSimpleGet(endpoint: string, action: 'policies' | 'cost-centers' | 'motives' | 'additional-fields' | 'reusable-tickets', providerCompanyId?: string | number | null) {
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>(endpoint, {
    method: 'GET',
    query: { token: session.token },
    requestId: requestId(`tech_${action}`),
  })
  await logTechIntegration({
    action,
    status: 'success',
    message: `Consulta Tech ${action} concluída.`,
    endpoint,
    durationMs: response.durationMs,
  })
  return response.data
}

export async function techCheckChurning(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>('/VerificaChurning', {
    method: 'POST',
    body: { Churning: payload, Token: session.token },
    requestId: requestId('tech_churning'),
  })
  const churning = asRecord(response.data).ExisteChurning === true
  await logTechIntegration({
    action: 'churning',
    status: churning ? 'warning' : 'success',
    message: churning ? 'Tech indicou possível reserva duplicada.' : 'Churning Tech sem duplicidade.',
    endpoint: '/VerificaChurning',
    durationMs: response.durationMs,
  })
  return response.data
}

export function techCapabilities(): string[] {
  return [
    'login',
    'seleção de empresa',
    'busca de cidades para aéreo e hotelaria',
    'cotação aérea',
    'tarifação aérea',
    'reserva aérea',
    'consulta de OS',
    'consulta de reserva',
    'emissão aérea',
    'cancelamento de reserva/bilhete',
    'políticas, centro de custo, motivos e campos adicionais',
    'disponibilidade e reserva de hotel',
    'relatório de emissões',
  ]
}

async function ensureHotelCityId(request: TravelQuoteRequest): Promise<TravelQuoteRequest> {
  if (request.idCidade) return request
  if (!request.destino) return request
  const cities = await techSearchCities({ query: request.destino, service: 'hotelaria', providerCompanyId: request.providerCompanyId })
  const first = cities.cities[0]
  return first ? { ...request, idCidade: first.id } : request
}

async function techPostSensitive(endpoint: string, action: 'cancel' | 'cancel-ticket', payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  const key = getIdempotencyKey(
    `tech_${action}`,
    payload,
    nullableText(payload.idempotencyKey) || '',
  )
  const cached = getIdempotentResult<unknown>(key)
  if (cached) return cached
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<unknown>(endpoint, {
    method: 'POST',
    body: { ...payload, Token: session.token },
    requestId: requestId(`tech_${action}`),
  })
  assertTechMutationConfirmed(response.data, action)
  await logTechIntegration({
    action,
    status: 'success',
    message: action === 'cancel' ? 'Cancelamento de reserva enviado para Tech.' : 'Cancelamento de bilhete enviado para Tech.',
    endpoint,
    durationMs: response.durationMs,
  })
  return setIdempotentResult(key, response.data)
}

function reservationReferences(payload: unknown): {
  idOs?: string
  localizador?: string
  sistema?: string
} {
  return {
    idOs: findNestedText(payload, new Set(['idos'])),
    localizador: findNestedText(payload, new Set(['localizador', 'locator'])),
    sistema: findNestedText(payload, new Set(['sistema', 'system'])),
  }
}

function findNestedText(
  value: unknown,
  expectedKeys: Set<string>,
  depth = 0,
): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) {
      const found = findNestedText(item, expectedKeys, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const [key, item] of Object.entries(record)) {
    if (expectedKeys.has(normalizeLookupKey(key))) {
      const found = nullableText(item)
      if (found) return found
    }
  }
  for (const item of Object.values(record)) {
    const found = findNestedText(item, expectedKeys, depth + 1)
    if (found) return found
  }
  return undefined
}

function scalarValue(value: unknown): string | number | null | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  return value === null ? null : undefined
}

function nullableText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
