export type IntegrationProvider = 'tech-ttravel'

export type TravelService = 'aereo' | 'hotelaria' | 'locacao' | 'pacotes' | 'lazer' | 'transfer' | 'seguro' | 'rodoviario'

export type TravelAction =
  | 'cities'
  | 'quote'
  | 'fare'
  | 'reserve'
  | 'status'
  | 'issue'
  | 'cancel'
  | 'cancel-ticket'
  | 'voucher-data'
  | 'policies'
  | 'cost-centers'
  | 'motives'
  | 'additional-fields'
  | 'churning'
  | 'reusable-tickets'
  | 'emissions-report'

export type IntegrationMode = 'disabled' | 'sandbox' | 'production'

export interface IntegrationHealth {
  ok: boolean
  provider: IntegrationProvider
  mode: IntegrationMode
  configured: boolean
  connected: boolean
  baseUrl?: string
  message: string
  requiresCompanyAccess?: boolean
  selectedCompanyId?: string | null
  capabilities: string[]
  checkedAt: string
}

export interface ProviderCompany {
  id: string
  name: string
  raw?: unknown
}

export interface TravelerInput {
  nome: string
  sobrenome?: string
  genero?: 'MASCULINO' | 'FEMININO' | 'M' | 'F' | string
  dataNascimento?: string
  cpf?: string
  tipo?: 'ADT' | 'CHD' | 'INF'
  idViajante?: string | number | null
  idFuncionario?: string | number | null
  idPolitica?: string | number | null
  idCentroCusto?: string | number | null
  email?: string
  telefone?: string
}

export interface TravelQuoteRequest {
  service: TravelService
  empresaId?: string
  providerCompanyId?: string | number | null
  origem?: string
  destino?: string
  origemIata?: string
  destinoIata?: string
  idCidade?: string | number | null
  dataInicio?: string
  dataFim?: string | null
  adultos?: number
  criancas?: number
  bebes?: number
  idadesCriancas?: number[]
  sistemas?: string[]
  hotelSuppliers?: string[]
  idPolitica?: string | number | null
  idOs?: string | number | null
  buscarCasada?: boolean
  apenasVoosDiretos?: boolean
  apenasTarifasComBagagem?: boolean
  apenasTarifasMaisBaratas?: boolean
  raw?: Record<string, unknown>
}

export interface TravelQuoteOption {
  id: string
  provider: IntegrationProvider
  service: TravelService
  supplierName?: string
  title: string
  subtitle?: string
  price?: number
  currency?: string
  refundable?: boolean
  policyStatus?: 'respeitada' | 'nao_respeitada' | 'nao_aplicada'
  startsAt?: string
  endsAt?: string
  city?: string
  metadata?: Record<string, unknown>
  raw?: unknown
}

export interface TravelQuote {
  id: string
  provider: IntegrationProvider
  service: TravelService
  request: TravelQuoteRequest
  options: TravelQuoteOption[]
  raw?: unknown
  createdAt: string
  expiresAt?: string
  warnings?: string[]
}

export interface TravelReservationRequest {
  service: TravelService
  quoteId?: string
  optionId?: string
  idOs?: string | number | null
  localizador?: string
  sistema?: string
  tipoSistema?: 'Aereo' | 'Hotel' | 'Carro' | 'Rodoviario' | string
  chaveConsulta?: string
  travelers?: TravelerInput[]
  contatoReserva?: {
    ddi?: string
    ddd?: string
    telefone?: string
    tipoTelefone?: string
    email?: string
  }
  payment?: Record<string, unknown>
  payload?: Record<string, unknown>
  idempotencyKey?: string
  confirmed?: boolean
}

export interface TravelReservation {
  id: string
  provider: IntegrationProvider
  service: TravelService
  status: 'draft' | 'prepared' | 'reserved' | 'issued' | 'cancelled' | 'failed'
  idOs?: string
  localizador?: string
  sistema?: string
  request: TravelReservationRequest
  raw?: unknown
  createdAt: string
  updatedAt?: string
}

export interface IntegrationLogEntry {
  id: string
  provider: IntegrationProvider
  action: TravelAction | 'login' | 'access-company'
  status: 'success' | 'warning' | 'error'
  message: string
  requestId?: string
  durationMs?: number
  endpoint?: string
  metadata?: Record<string, unknown>
  createdAt: string
}
