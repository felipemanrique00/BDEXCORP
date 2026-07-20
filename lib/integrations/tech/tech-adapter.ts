import { techRequest } from '@/lib/integrations/tech/tech-client'
import { getTechConfig, techConfigured, techMissingConfig } from '@/lib/integrations/tech/tech-config'
import { TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
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

export async function techHealth(): Promise<IntegrationHealth> {
  const config = getTechConfig()
  const configured = techConfigured(config)
  if (!configured) {
    return {
      ok: true,
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
  } catch (error: any) {
    return {
      ok: false,
      provider: 'tech-ttravel',
      mode: config.mode,
      configured: true,
      connected: false,
      baseUrl: config.baseUrl,
      message: error?.message || 'Falha ao validar conexão Tech Travel.',
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
  const response = await techRequest<any>(
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
  const config = getTechConfig()
  const session = await getTechSession({ companyId: request.providerCompanyId })
  const id = `tech_quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  if (request.service === 'aereo') {
    const response = await techRequest<any>(
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
    const response = await techRequest<any>(
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

  const cities = request.destino
    ? await techSearchCities({ query: request.destino, service: request.service, providerCompanyId: request.providerCompanyId })
    : { cities: [], raw: null }

  const quote: TravelQuote = {
    id,
    provider: 'tech-ttravel',
    service: request.service,
    request,
    options: cities.cities.slice(0, 8).map((city: any, index: number) => ({
      id: `${id}_city_${city.id}`,
      provider: 'tech-ttravel',
      service: request.service,
      title: city.description,
      subtitle: 'Base Tech Travel localizada. A disponibilidade específica depende do endpoint contratado para o serviço.',
      metadata: { city, index },
      raw: city.raw,
    })),
    raw: cities.raw,
    createdAt: new Date().toISOString(),
    warnings: ['A documentação enviada mapeia reserva/status para carro e rodoviário via OS, mas não traz endpoints completos de disponibilidade para esses serviços.'],
  }
  await logTechIntegration({
    action: 'quote',
    status: 'warning',
    message: `Serviço ${request.service} preparado pela Tech com busca de cidade/base, aguardando endpoint de disponibilidade específico.`,
    endpoint: '/BuscarCidades',
    metadata: { quoteId: quote.id, service: quote.service },
  })
  return quote
}

export async function techFareAir(payload: Record<string, unknown>, providerCompanyId?: string | number | null) {
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<any>('/TarifarDisponibilidade', {
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
    return preparedReservation(request, 'prepared', 'A reserva foi preparada. Confirme a execução para enviar para a Tech Travel.')
  }

  const key = getIdempotencyKey('tech_reservation', request, request.idempotencyKey)
  const cached = getIdempotentResult<TravelReservation>(key)
  if (cached) return cached

  const session = await getTechSession({ companyId: request.payload?.providerCompanyId as any })
  const endpoint = request.service === 'hotelaria' ? '/Hotel/CriarReserva' : request.service === 'aereo' ? '/CriarReservaAereo' : null
  if (!endpoint) {
    return preparedReservation(request, 'prepared', 'A documentação Tech enviada não traz endpoint de criação direta para este serviço; use OS/status ou complemente o contrato Tech.')
  }

  const body =
    request.service === 'hotelaria'
      ? { CriarReserva: request.payload?.CriarReserva || request.payload || {}, Token: session.token }
      : { DadosCriar: request.payload?.DadosCriar || request.payload || {}, Token: session.token }

  const response = await techRequest<any>(endpoint, {
    method: 'POST',
    body,
    requestId: requestId('tech_reservation'),
  })

  const reservation: TravelReservation = {
    id: `tech_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'tech-ttravel',
    service: request.service,
    status: 'reserved',
    idOs: String(response.data?.IdOs || response.data?.DadosOs?.OS?.[0]?.IdOs || request.idOs || ''),
    localizador: response.data?.Localizador || response.data?.Localizadores?.Localizador?.[0]?.Localizador,
    sistema: response.data?.Sistema || response.data?.Localizadores?.Localizador?.[0]?.Sistema,
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
  const response = await techRequest<any>('/ConsultarOS', {
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
  const response = await techRequest<any>('/ConsultarReserva', {
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
  const cached = getIdempotentResult<any>(key)
  if (cached) return cached
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<any>('/Emitir', {
    method: 'POST',
    body: { DadosParaEmissao: payload, Token: session.token },
    requestId: requestId('tech_issue'),
  })
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
  const response = await techRequest<any>(endpoint, {
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
  const response = await techRequest<any>('/VerificaChurning', {
    method: 'POST',
    body: { Churning: payload, Token: session.token },
    requestId: requestId('tech_churning'),
  })
  await logTechIntegration({
    action: 'churning',
    status: response.data?.ExisteChurning ? 'warning' : 'success',
    message: response.data?.ExisteChurning ? 'Tech indicou possível reserva duplicada.' : 'Churning Tech sem duplicidade.',
    endpoint: '/VerificaChurning',
    durationMs: response.durationMs,
  })
  return response.data
}

export function techCapabilities(): string[] {
  return [
    'login',
    'seleção de empresa',
    'cidades/base por aéreo, hotel, carro e rodoviário',
    'cotação aérea',
    'tarifação aérea',
    'reserva aérea',
    'consulta de OS',
    'consulta de reserva',
    'emissão aérea',
    'cancelamento de reserva/bilhete',
    'políticas, centro de custo, motivos e campos adicionais',
    'hotel: disponibilidade, detalhes, pagamento, pedido/reserva/emissão e cancelamento',
    'carro/rodoviário/pedidos via OS e consulta de reserva conforme documentação',
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
  const key = getIdempotencyKey(`tech_${action}`, payload, String((payload as any).idempotencyKey || ''))
  const cached = getIdempotentResult<any>(key)
  if (cached) return cached
  const session = await getTechSession({ companyId: providerCompanyId })
  const response = await techRequest<any>(endpoint, {
    method: 'POST',
    body: { ...payload, Token: session.token },
    requestId: requestId(`tech_${action}`),
  })
  await logTechIntegration({
    action,
    status: 'success',
    message: action === 'cancel' ? 'Cancelamento de reserva enviado para Tech.' : 'Cancelamento de bilhete enviado para Tech.',
    endpoint,
    durationMs: response.durationMs,
  })
  return setIdempotentResult(key, response.data)
}

function preparedReservation(request: TravelReservationRequest, status: TravelReservation['status'], message: string): TravelReservation {
  return {
    id: `tech_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'tech-ttravel',
    service: request.service,
    status,
    idOs: request.idOs ? String(request.idOs) : undefined,
    localizador: request.localizador,
    sistema: request.sistema,
    request,
    raw: { message },
    createdAt: new Date().toISOString(),
  }
}
