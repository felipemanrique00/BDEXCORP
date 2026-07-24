import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

export type SupplierService =
  | 'aereo'
  | 'hotelaria'
  | 'locacao'
  | 'pacotes'
  | 'lazer'
  | 'transfer'
  | 'seguro'
  | 'outros'

export type SupplierCapability =
  | 'pesquisa'
  | 'cotacao'
  | 'reserva'
  | 'emissao'
  | 'cancelamento'
  | 'remarcacao'
  | 'voucher'
  | 'importacao'
  | 'status'
  | 'faturamento'

export type SupplierMode = 'api' | 'portal_assistido' | 'email' | 'manual'
export type SupplierAuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'portal'
export type SupplierStatus = 'ativo' | 'pendente_configuracao' | 'inativo' | 'falha'

export interface SupplierIntegration {
  id: string
  nome: string
  tipo: 'consolidadora' | 'operadora' | 'fornecedor_direto' | 'ota' | 'gds' | 'outro'
  servicos: SupplierService[]
  capacidades: SupplierCapability[]
  modo: SupplierMode
  status: SupplierStatus
  prioridade: number
  portal_url?: string
  api_base_url?: string
  auth_type: SupplierAuthType
  env_base_url?: string
  env_token?: string
  contato_suporte?: string
  observacoes?: string
  mapeamento?: Record<string, string>
  created_at: string
  updated_at?: string
}

export interface SupplierActionLog {
  id: string
  supplier_id: string
  supplier_name: string
  action: SupplierCapability | 'teste'
  service?: SupplierService
  status: 'sucesso' | 'pendente' | 'falha'
  message: string
  payload?: Record<string, any>
  created_at: string
}

export interface SupplierActionRequest {
  service: SupplierService
  action: SupplierCapability
  supplier_ids?: string[]
  origem?: string
  destino?: string
  data_inicio?: string
  data_fim?: string
  viajante?: string
  empresa_nome?: string
  payload?: Record<string, any>
}

export type SupplierReservationStatus =
  | 'rascunho'
  | 'cotacao_preparada'
  | 'reserva_preparada'
  | 'enviado_fornecedor'
  | 'confirmado'
  | 'falhou'
  | 'cancelado'

export interface SupplierReservation {
  id: string
  status: SupplierReservationStatus
  service: SupplierService
  action: SupplierCapability
  supplier_ids: string[]
  empresa_id?: string
  empresa_nome?: string
  funcionario_id?: string | null
  viajante_nome: string
  solicitante_nome?: string
  origem?: string
  destino?: string
  data_inicio?: string
  data_fim?: string
  centro_custo?: string
  valor_estimado?: number
  atendimento_id?: string
  voucher_id?: string
  observacoes?: string
  payload?: Record<string, any>
  created_by?: string
  created_at: string
  updated_at?: string
}

const STORAGE_SUPPLIERS = 'bbt-supplier-integrations-v1'
const STORAGE_LOGS = 'bbt-supplier-action-logs-v1'
const STORAGE_RESERVATIONS = 'bbt-supplier-reservations-v1'
const TECH_SUPPLIER_ID = 'tech-ttravel'
const LEGACY_PROVIDER_IDS = new Set([
  'brt',
  'flytour',
  'ancoradouro',
  'ehtl',
  'hoteis-com',
  'diversa',
  'orinter',
  'gds-ndc-universal',
])
const LEGACY_PROVIDER_TERMS = new Set([
  ...LEGACY_PROVIDER_IDS,
  'e-htl',
  'e htl',
  'hotels-com',
  'hotels.com',
  'hoteis.com',
  'for-brt',
  'for-ancora',
  'ancora',
  'techtravel-brt',
])

const DEFAULT_SUPPLIERS: SupplierIntegration[] = [
  supplier({
    id: 'tech-ttravel',
    nome: 'Tech Travel / TTravel Connect',
    tipo: 'consolidadora',
    servicos: ['aereo', 'hotelaria', 'locacao', 'pacotes', 'lazer', 'transfer', 'seguro', 'outros'],
    capacidades: ['importacao', 'status'],
    modo: 'api',
    status: 'pendente_configuracao',
    auth_type: 'api_key',
    portal_url: 'https://www.ttravel.com.br/connect/',
    api_base_url: 'https://www.ttravel.com.br/ttravelapi/reservas',
    prioridade: 100,
    env_base_url: 'TECH_API_BASE_URL',
    env_token: 'TECH_API_KEY',
    observacoes:
      'Importação de emissões e consulta de status disponíveis após configuração. Cotação, reserva, emissão e cancelamento permanecem bloqueados até homologação das credenciais transacionais pela Tech Travel.',
  }),
]

function supplier(data: Omit<SupplierIntegration, 'status' | 'auth_type' | 'created_at'> & Partial<Pick<SupplierIntegration, 'status' | 'auth_type' | 'created_at'>>): SupplierIntegration {
  return {
    auth_type: data.modo === 'api' ? 'bearer' : 'portal',
    status: data.modo === 'api' ? 'pendente_configuracao' : 'ativo',
    created_at: new Date('2026-05-05T00:00:00.000Z').toISOString(),
    ...data,
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function novoId(prefix: string): string {
  return createEntityId(prefix, '_')
}

function normalizedRef(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isLegacyProviderRef(value?: string | null): boolean {
  const raw = String(value || '').toLowerCase()
  const normalized = normalizedRef(value)
  return (
    LEGACY_PROVIDER_TERMS.has(normalized) ||
    raw.includes('e-htl') ||
    raw.includes('ehtl') ||
    raw.includes('hoteis.com') ||
    raw.includes('hotels.com') ||
    raw.includes('flytour') ||
    raw.includes('ancoradouro') ||
    raw.includes('orinter') ||
    raw.includes('diversa') ||
    raw.includes('gds/ndc')
  )
}

function isLegacySupplierLog(log: SupplierActionLog): boolean {
  return isLegacyProviderRef(log.supplier_id) || isLegacyProviderRef(log.supplier_name)
}

function normalizeSupplierReservation(item: SupplierReservation): SupplierReservation {
  const hasLegacy = Array.isArray(item.supplier_ids) && item.supplier_ids.some((id) => isLegacyProviderRef(id))
  if (!hasLegacy) return item
  const supplierIds = Array.from(new Set([
    TECH_SUPPLIER_ID,
    ...item.supplier_ids.filter((id) => !isLegacyProviderRef(id)),
  ]))
  return {
    ...item,
    supplier_ids: supplierIds,
    payload: {
      ...(item.payload || {}),
      tech_provider: TECH_SUPPLIER_ID,
      migrated_from_legacy_suppliers: item.supplier_ids,
    },
  }
}

function loadSuppliersRaw(): SupplierIntegration[] {
  if (typeof window === 'undefined') return DEFAULT_SUPPLIERS
  const stored = loadJSON<SupplierIntegration[]>(STORAGE_SUPPLIERS, [])
  if (!Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_SUPPLIERS
  }
  return mergeDefaults(stored)
}

function saveSuppliers(list: SupplierIntegration[]): boolean {
  return safeSetJSON(STORAGE_SUPPLIERS, list)
}

function mergeDefaults(stored: SupplierIntegration[]): SupplierIntegration[] {
  const filteredStored = stored.filter((s) => !LEGACY_PROVIDER_IDS.has(s.id))
  const byId = new Map(filteredStored.map((s) => [s.id, s]))
  let changed = false
  for (const item of DEFAULT_SUPPLIERS) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
      changed = true
    } else if (item.id === TECH_SUPPLIER_ID) {
      const current = byId.get(item.id)!
      const allowedCapabilities = new Set(item.capacidades)
      const capabilities = current.capacidades.filter((capability) => allowedCapabilities.has(capability))
      const normalizedCapabilities = capabilities.length > 0 ? capabilities : item.capacidades
      if (
        current.status !== 'pendente_configuracao' ||
        normalizedCapabilities.length !== current.capacidades.length ||
        normalizedCapabilities.some((capability, index) => capability !== current.capacidades[index])
      ) {
        byId.set(item.id, {
          ...current,
          capacidades: normalizedCapabilities,
          status: 'pendente_configuracao',
          observacoes: item.observacoes,
          updated_at: nowIso(),
        })
        changed = true
      }
    }
  }
  const list = Array.from(byId.values()).sort((a, b) => b.prioridade - a.prioridade || a.nome.localeCompare(b.nome))
  if ((changed || filteredStored.length !== stored.length) && typeof window !== 'undefined') saveSuppliers(list)
  return list
}

export function getSupplierIntegrations(): SupplierIntegration[] {
  return loadSuppliersRaw().sort((a, b) => b.prioridade - a.prioridade || a.nome.localeCompare(b.nome))
}

export function getSupplierById(id: string): SupplierIntegration | undefined {
  return getSupplierIntegrations().find((s) => s.id === id)
}

export function filterSuppliersByService(
  suppliers: readonly SupplierIntegration[],
  service: SupplierService,
): SupplierIntegration[] {
  return [...suppliers]
    .filter((supplier) => supplier.servicos.includes(service) && supplier.status !== 'inativo')
    .sort(
      (left, right) =>
        statusWeight(right.status) - statusWeight(left.status)
        || right.prioridade - left.prioridade
        || left.nome.localeCompare(right.nome),
    )
}

export function getSuppliersByService(service: SupplierService): SupplierIntegration[] {
  return filterSuppliersByService(getSupplierIntegrations(), service)
}

export function selectSuppliersFromCatalog(
  suppliers: readonly SupplierIntegration[],
  service: SupplierService,
  limit = 4,
): SupplierIntegration[] {
  return filterSuppliersByService(suppliers, service)
    .filter((supplier) => supplier.capacidades.includes('cotacao') || supplier.capacidades.includes('pesquisa'))
    .slice(0, Math.max(0, limit))
}

export function selectSuppliersForService(service: SupplierService, limit = 4): SupplierIntegration[] {
  return selectSuppliersFromCatalog(getSupplierIntegrations(), service, limit)
}

export function upsertSupplierIntegration(data: Partial<SupplierIntegration> & Pick<SupplierIntegration, 'nome' | 'servicos'>): SupplierIntegration | null {
  const list = getSupplierIntegrations()
  const id = data.id || slugId(data.nome)
  const idx = list.findIndex((s) => s.id === id)
  const next: SupplierIntegration = {
    id,
    nome: data.nome,
    tipo: data.tipo || 'outro',
    servicos: data.servicos,
    capacidades: data.capacidades || ['pesquisa', 'cotacao', 'reserva', 'voucher', 'status'],
    modo: data.modo || 'portal_assistido',
    status: data.status || (data.modo === 'api' ? 'pendente_configuracao' : 'ativo'),
    prioridade: Number(data.prioridade ?? 50),
    portal_url: data.portal_url,
    api_base_url: data.api_base_url,
    auth_type: data.auth_type || (data.modo === 'api' ? 'bearer' : 'portal'),
    env_base_url: data.env_base_url,
    env_token: data.env_token,
    contato_suporte: data.contato_suporte,
    observacoes: data.observacoes,
    mapeamento: data.mapeamento,
    created_at: idx >= 0 ? list[idx].created_at : nowIso(),
    updated_at: idx >= 0 ? nowIso() : undefined,
  }
  if (idx >= 0) list[idx] = { ...list[idx], ...next }
  else list.push(next)
  if (!saveSuppliers(list)) return null
  return next
}

export function updateSupplierIntegration(id: string, patch: Partial<SupplierIntegration>): SupplierIntegration | null {
  const list = getSupplierIntegrations()
  const idx = list.findIndex((s) => s.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updated_at: nowIso() }
  if (!saveSuppliers(list)) return null
  return list[idx]
}

export function deleteSupplierIntegration(id: string): boolean {
  return saveSuppliers(getSupplierIntegrations().filter((s) => s.id !== id))
}

export function getSupplierLogs(limit = 200): SupplierActionLog[] {
  if (typeof window === 'undefined') return []
  const stored = loadJSON<SupplierActionLog[]>(STORAGE_LOGS, [])
  const filtered = stored.filter((log) => !isLegacySupplierLog(log))
  if (filtered.length !== stored.length) {
    safeSetJSON(STORAGE_LOGS, filtered.slice(-1000))
  }
  return filtered
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export function logSupplierAction(data: Omit<SupplierActionLog, 'id' | 'created_at'>): SupplierActionLog {
  const log: SupplierActionLog = {
    ...data,
    id: novoId('sup_log'),
    created_at: nowIso(),
  }
  if (typeof window !== 'undefined') {
    const logs = loadJSON<SupplierActionLog[]>(STORAGE_LOGS, [])
    logs.push(log)
    safeSetJSON(STORAGE_LOGS, logs.slice(-1000))
  }
  return log
}

export function testarSupplierConnector(supplier: SupplierIntegration): SupplierActionLog {
  const hasApi = Boolean(supplier.api_base_url || supplier.env_base_url)
  const hasPortal = Boolean(supplier.portal_url)
  const configured = supplier.modo !== 'api' ? hasPortal : hasApi
  const status = configured ? 'pendente' : 'falha'
  const message = configured
    ? supplier.modo === 'api'
      ? 'Configuracao presente. A conexao deve ser validada pelo adaptador oficial do fornecedor.'
      : 'URL do portal registrada. Nenhuma autenticacao externa foi executada.'
    : 'Falta endpoint ou URL do portal para validar a configuracao.'
  return logSupplierAction({
    supplier_id: supplier.id,
    supplier_name: supplier.nome,
    action: 'teste',
    status,
    message,
    service: supplier.servicos[0],
  })
}

export function prepararAcaoFornecedor(
  request: SupplierActionRequest,
  catalog?: readonly SupplierIntegration[],
): SupplierActionLog[] {
  const availableSuppliers = catalog ? [...catalog] : getSupplierIntegrations()
  const suppliers = request.supplier_ids?.length
    ? availableSuppliers.filter((supplier) => request.supplier_ids?.includes(supplier.id))
    : selectSuppliersFromCatalog(availableSuppliers, request.service, 6)
  if (!suppliers.length) {
    return [
      logSupplierAction({
        supplier_id: 'none',
        supplier_name: 'Sem fornecedor',
        action: request.action,
        service: request.service,
        status: 'falha',
        message: `Nenhum fornecedor configurado para ${serviceLabel(request.service)}.`,
        payload: request.payload,
      }),
    ]
  }

  return suppliers.map((supplier) => {
    const canAction = supplier.capacidades.includes(request.action)
    const configured = supplier.status === 'ativo' || supplier.modo === 'portal_assistido'
    const status = canAction && configured ? 'pendente' : 'falha'
    const message = canAction
      ? supplier.modo === 'api'
        ? `Acao ${capabilityLabel(request.action)} preparada para API ${supplier.nome}.`
        : `Acao ${capabilityLabel(request.action)} preparada para portal assistido ${supplier.nome}.`
      : `${supplier.nome} nao tem capacidade ${capabilityLabel(request.action)} configurada.`
    return logSupplierAction({
      supplier_id: supplier.id,
      supplier_name: supplier.nome,
      action: request.action,
      service: request.service,
      status,
      message,
      payload: {
        origem: request.origem,
        destino: request.destino,
        data_inicio: request.data_inicio,
        data_fim: request.data_fim,
        viajante: request.viajante,
        empresa_nome: request.empresa_nome,
        ...request.payload,
      },
    })
  })
}

export function getSupplierReservations(limit = 500): SupplierReservation[] {
  if (typeof window === 'undefined') return []
  const stored = loadJSON<SupplierReservation[]>(STORAGE_RESERVATIONS, [])
  const normalized = stored.map(normalizeSupplierReservation)
  const changed = normalized.some((item, index) => item !== stored[index])
  if (changed) {
    safeSetJSON(STORAGE_RESERVATIONS, normalized.slice(-3000))
  }
  return normalized
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export function addSupplierReservation(
  data: Omit<SupplierReservation, 'id' | 'created_at' | 'updated_at'>,
): SupplierReservation | null {
  const reservation: SupplierReservation = {
    ...data,
    id: novoId('reserva'),
    created_at: nowIso(),
  }
  if (typeof window === 'undefined') return null
  const list = loadJSON<SupplierReservation[]>(STORAGE_RESERVATIONS, [])
  list.push(reservation)
  if (!safeSetJSON(STORAGE_RESERVATIONS, list.slice(-3000))) return null
  return reservation
}

export function updateSupplierReservation(id: string, patch: Partial<SupplierReservation>): SupplierReservation | null {
  if (typeof window === 'undefined') return null
  const list = loadJSON<SupplierReservation[]>(STORAGE_RESERVATIONS, [])
  const idx = list.findIndex((item) => item.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updated_at: nowIso() }
  if (!safeSetJSON(STORAGE_RESERVATIONS, list.slice(-3000))) return null
  return list[idx]
}

export function supplierSummaryForAI() {
  return getSupplierIntegrations()
}

export function serviceLabel(service: SupplierService): string {
  const labels: Record<SupplierService, string> = {
    aereo: 'Aereo',
    hotelaria: 'Hotelaria',
    locacao: 'Locação de veículo',
    pacotes: 'Pacotes',
    lazer: 'Lazer',
    transfer: 'Transfer',
    seguro: 'Seguro',
    outros: 'Outros',
  }
  return labels[service]
}

export function capabilityLabel(capability: SupplierCapability): string {
  const labels: Record<SupplierCapability, string> = {
    pesquisa: 'pesquisa',
    cotacao: 'cotação',
    reserva: 'reserva',
    emissao: 'emissão',
    cancelamento: 'cancelamento',
    remarcacao: 'remarcação',
    voucher: 'voucher',
    importacao: 'importacao',
    status: 'status',
    faturamento: 'faturamento',
  }
  return labels[capability]
}

function statusWeight(status: SupplierStatus): number {
  if (status === 'ativo') return 4
  if (status === 'pendente_configuracao') return 3
  if (status === 'falha') return 2
  return 1
}

function slugId(value: string): string {
  return String(value || 'fornecedor')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || novoId('supplier')
}
