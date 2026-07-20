import { getTechConfig } from '@/lib/integrations/tech/tech-config'
import type { TravelQuoteOption, TravelQuoteRequest, TravelService } from '@/lib/integrations/types'

export function techDate(value?: string | null): string | null {
  if (!value) return null
  const clean = value.slice(0, 10)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean
  const [year, month, day] = clean.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function techDateTime(value?: string | null): string | null {
  const date = techDate(value)
  return date ? `${date} 00:00` : null
}

export function serviceToCityType(service: TravelService): 'AEREO' | 'HOTEL' | 'CARRO' | 'RODOVIARIO' {
  if (service === 'aereo') return 'AEREO'
  if (service === 'hotelaria') return 'HOTEL'
  if (service === 'rodoviario') return 'RODOVIARIO'
  return 'CARRO'
}

export function buildAirAvailabilityPayload(request: TravelQuoteRequest, token: string) {
  const config = getTechConfig()
  return {
    BuscarDisponibilidade: {
      OrigemIata: request.origemIata || request.origem || '',
      DestinoIata: request.destinoIata || request.destino || '',
      DataIda: techDate(request.dataInicio),
      DataVolta: request.dataFim ? techDate(request.dataFim) : null,
      RemoverVoosRoundTrip: false,
      ApenasvoosDiretos: Boolean(request.apenasVoosDiretos),
      ApenasTarifasComBagagem: Boolean(request.apenasTarifasComBagagem),
      ApenasTarifasMaisBaratas: Boolean(request.apenasTarifasMaisBaratas),
      QuantidadePassageirosAdultos: request.adultos || 1,
      QuantidadePassageirosCriancas: request.criancas || 0,
      QuantidadePassageirosBebes: request.bebes || 0,
      Sistemas: request.sistemas?.length ? request.sistemas : config.defaultSystems,
      IdPolitica: request.idPolitica ?? null,
      BuscarCasada: Boolean(request.buscarCasada),
    },
    Token: token,
  }
}

export function buildHotelAvailabilityPayload(request: TravelQuoteRequest, token: string) {
  const config = getTechConfig()
  return {
    BuscarDisponibilidade: {
      IdCidade: request.idCidade || request.destino || '',
      CheckIn: techDateTime(request.dataInicio),
      CheckOut: techDateTime(request.dataFim),
      QuantidadePassageirosAdultos: request.adultos || 1,
      QuantidadePassageirosCriancas: request.criancas || 0,
      IdadesPassageirosCriancas: request.idadesCriancas || [],
      BuscarForncedores: request.hotelSuppliers?.length ? request.hotelSuppliers : config.hotelSuppliers,
      IdPolitica: request.idPolitica ?? null,
      IdOs: request.idOs ?? null,
    },
    Token: token,
  }
}

export function buildCityPayload(description: string, service: TravelService, token: string) {
  return {
    BuscaDadosCidades: {
      Descricao: description,
      Tipo: serviceToCityType(service),
    },
    Token: token,
  }
}

export function normalizeAirOptions(payload: any): TravelQuoteOption[] {
  const options: TravelQuoteOption[] = []
  const ida = toArray(payload?.VoosIda || payload?.Disponibilidade?.VoosIda || payload?.Aereos?.VoosIda)
  const volta = toArray(payload?.VoosVolta || payload?.Disponibilidade?.VoosVolta || payload?.Aereos?.VoosVolta)

  ida.forEach((flight: any, index) => {
    const seat = firstSeat(flight)
    options.push({
      id: String(flight?.Viagens?.ViagensId || flight?.ViagensId || flight?.Id || `air-${index}`),
      provider: 'tech-ttravel',
      service: 'aereo',
      supplierName: flight?.Sistema || flight?.Fornecedor || flight?.Cia || seat?.Sistema,
      title: airTitle(flight, index),
      subtitle: airSubtitle(flight, seat, volta.length),
      price: numberValue(seat?.Total || seat?.total || flight?.Total || flight?.Valor),
      currency: 'BRL',
      policyStatus: policyStatus(flight),
      startsAt: flight?.DataPartida || flight?.Partida || undefined,
      endsAt: flight?.DataChegada || flight?.Chegada || undefined,
      metadata: {
        idaViagensId: flight?.Viagens?.ViagensId || flight?.ViagensId,
        idaTotalEscolhido: seat?.Total || seat?.total,
        idaQuantidadeBagagens: seat?.QtdBagagens || seat?.QuantidadeBagagens || 0,
      },
      raw: flight,
    })
  })

  return options
}

export function normalizeHotelOptions(payload: any): TravelQuoteOption[] {
  const hotels = toArray(payload?.Hoteis?.Hoteis || payload?.Hoteis || payload?.Dados?.Hoteis)
  const options: TravelQuoteOption[] = []
  hotels.forEach((hotel: any, hotelIndex) => {
    const rooms = toArray(hotel?.Quartos)
    const selectedRooms = rooms.length ? rooms : [null]
    selectedRooms.slice(0, 4).forEach((room: any, roomIndex) => {
      const details = hotel?.Detalhes || {}
      options.push({
        id: String(room?.TokenQuarto || room?.Id || `${hotel?.Id || hotelIndex}-${roomIndex}`),
        provider: 'tech-ttravel',
        service: 'hotelaria',
        supplierName: hotel?.DescricaoFornecedor || hotel?.Fornecedor || hotel?.FornecedorTarifa,
        title: String(hotel?.Nome || hotel?.NomeHotel || hotel?.Hotel || 'Hotel Tech Travel'),
        subtitle: [room?.TipoAcomodacao || room?.Descricao, room?.Alimentacao, details?.Bairro].filter(Boolean).join(' · '),
        price: numberValue(room?.Total || room?.Preco?.Total || room?.TotalPorNoite),
        currency: room?.MoedaOriginal || room?.Preco?.MoedaOriginal || 'BRL',
        refundable: room?.NaoReembolsavel == null ? undefined : !room.NaoReembolsavel,
        policyStatus: policyStatus(room),
        startsAt: undefined,
        endsAt: undefined,
        city: details?.Cidade || hotel?.Cidade || hotel?.CidadeHotel,
        metadata: {
          idHotel: hotel?.Id,
          idQuarto: room?.Id,
          tokenQuarto: room?.TokenQuarto,
          descricaoFornecedor: hotel?.DescricaoFornecedor || hotel?.Fornecedor,
          endereco: [details?.Logradouro, details?.Numero, details?.Bairro].filter(Boolean).join(', '),
          telefone: details?.Telefone,
          ultimaDataCancelamento: room?.UltimoDiaParaCancelmaneto || room?.UltimoDiaParaCancelamento,
          taxa: numberValue(room?.Taxa),
          fee: numberValue(room?.Fee),
        },
        raw: { hotel, room },
      })
    })
  })
  return options
}

export function normalizeCities(payload: any) {
  return toArray(payload?.DadosCidades || payload?.Cidades || payload?.Dados)
    .map((city: any) => ({
      id: String(city?.Id || city?.id || city?.Iata || ''),
      description: String(city?.Descricao || city?.description || ''),
      type: city?.Tipo,
      iata: city?.Iata || null,
      raw: city,
    }))
    .filter((city) => city.id && city.description)
}

function firstSeat(flight: any): any {
  const direct = flight?.assento || flight?.Assento
  if (direct) return direct
  const seats = toArray(flight?.assentos || flight?.Assentos || flight?.Viagens?.assentos)
  return seats[0] || {}
}

function airTitle(flight: any, index: number): string {
  const system = flight?.Sistema || flight?.Fornecedor || flight?.Cia || 'Aéreo'
  const number = flight?.NumeroVoo || flight?.Voo || flight?.Trechos?.[0]?.NumeroVoo
  return [system, number ? `voo ${number}` : `opção ${index + 1}`].join(' · ')
}

function airSubtitle(flight: any, seat: any, hasReturn: number): string {
  return [
    flight?.Origem || flight?.OrigemIata,
    flight?.Destino || flight?.DestinoIata,
    seat?.Familia || seat?.BaseTarifaria || seat?.Classe,
    hasReturn ? 'ida e volta' : 'ida',
  ].filter(Boolean).join(' · ')
}

function policyStatus(item: any): TravelQuoteOption['policyStatus'] {
  const value = String(item?.Politica || item?.politica || '').toLowerCase()
  if (value.includes('não') || value.includes('nao')) return 'nao_respeitada'
  if (value.includes('respeitada')) return 'respeitada'
  return 'nao_aplicada'
}

function toArray<T = any>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function numberValue(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const parsed = Number(String(value).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}
