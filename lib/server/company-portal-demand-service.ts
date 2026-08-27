import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  projectCorporateDemandDetail,
  projectCorporateDemandList,
  sanitizeCorporateDemandServiceDetails,
  type CorporateDemandCapabilities,
  type CorporateDemandDetail,
  type CorporateDemandListItem,
} from '@/lib/company-portal-lab/demand-projection'
import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  resolveCompanyPortalScopeCompanyIds,
  type CompanyPortalScope,
} from '@/lib/server/company-portal-scope-service'
import { withTenantTransaction } from '@/lib/server/database'
import { attachCompanyPortalHotelTariffReference } from '@/lib/server/company-portal-hotel-tariff-service'
import {
  canonicalizePortalGroundDemandInTransaction,
  OfflineGroundDemandServiceError,
} from '@/lib/server/offline-ground-demand-service'
import {
  createRelationalDemand,
  getRelationalDemandById,
  listRelationalDemands,
  updateDemandDetails,
  DemandServiceError,
  type DemandListFilters,
  type RelationalDemandListItem,
} from '@/lib/server/demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { isRequesterReadPrincipal } from '@/lib/server/requester-read-scope'
import type { Permissoes } from '@/types'

export type CompanyPortalDemandScope = CompanyPortalScope

export type CompanyPortalDemandListFilters = Omit<DemandListFilters, 'companyId' | 'companyIds'>
  & CompanyPortalDemandScope

interface DemandActorFacts {
  requesterOwnedDemandIds: Set<string>
  assignedApprovalDemandIds: Set<string>
}

interface OwnedDemandRow extends QueryResultRow {
  demand_id: string
}

interface AssignedApprovalDemandRow extends QueryResultRow {
  demand_id: string
}

export async function listCompanyPortalDemands(
  principal: RequestPrincipal,
  filters: CompanyPortalDemandListFilters = {},
): Promise<{ items: CorporateDemandListItem[]; total: number }> {
  const { scopeType, scopeId, companyId, ...listFilters } = filters
  const companyIds = resolveCompanyPortalDemandScopeCompanyIds(principal, {
    scopeType,
    scopeId,
    companyId,
  })
  const result = await listRelationalDemands(principal, {
    ...listFilters,
    companyIds,
  })
  const facts = await loadDemandActorFacts(principal, result.items)
  return {
    items: result.items.map((item) => projectCorporateDemandList(
      item,
      capabilitiesForDemand(principal, item, facts),
    )),
    total: result.total,
  }
}

export async function getCompanyPortalDemand(
  principal: RequestPrincipal,
  demandId: string,
): Promise<CorporateDemandDetail> {
  try {
    const item = await getRelationalDemandById(principal, demandId)
    return projectDemandDetail(principal, item)
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) throw companyPortalDemandNotFound()
    throw error
  }
}

export async function getScopedCompanyPortalDemand(
  principal: RequestPrincipal,
  demandId: string,
  scope: CompanyPortalDemandScope,
): Promise<CorporateDemandDetail> {
  const companyIds = resolveCompanyPortalDemandScopeCompanyIds(principal, scope)
  const item = await getCompanyPortalDemand(principal, demandId)
  if (!companyIds.includes(item.companyId)) {
    throw companyPortalDemandNotFound()
  }
  return item
}

export function resolveCompanyPortalDemandScopeCompanyIds(
  principal: RequestPrincipal,
  scope: CompanyPortalDemandScope = {},
): string[] {
  try {
    return resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas')
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) {
      throw new DemandServiceError(error.code, error.message, error.code === 'COMPANY_PORTAL_SCOPE_INVALID' ? 400 : 403)
    }
    throw error
  }
}

export async function createCompanyPortalDemand(
  principal: RequestPrincipal,
  rawInput: unknown,
  idempotencyKey: string,
  scope: CompanyPortalDemandScope = {},
): Promise<{ item: CorporateDemandDetail; replayed: boolean }> {
  const sanitized = sanitizeCompanyPortalDemandCreateInput(principal, rawInput)
  const companyIds = resolveCompanyPortalDemandWriteScopeCompanyIds(principal, scope)
  const companyId = requiredText(sanitized.demand.empresa_id, 'DEMAND_COMPANY_REQUIRED')
  if (!companyIds.includes(companyId)) throw companyPortalDemandNotFound()
  const created = await createRelationalDemand(
    principal,
    sanitized,
    idempotencyKey,
    {
      enrichDemand: (client, demand) => attachServerOwnedCorporateReferences(
        client, principal, demand, scope,
      ),
    },
  )
  return {
    item: await getCompanyPortalDemand(principal, created.relational.id),
    replayed: created.replayed,
  }
}

export async function updateCompanyPortalDemand(
  principal: RequestPrincipal,
  demandId: string,
  rawInput: unknown,
  scope: CompanyPortalDemandScope = {},
): Promise<{ item: CorporateDemandDetail; replayed: boolean }> {
  const companyIds = resolveCompanyPortalDemandWriteScopeCompanyIds(principal, scope)
  const current = await getCompanyPortalDemand(principal, demandId)
  if (!companyIds.includes(current.companyId)) throw companyPortalDemandNotFound()
  const sanitized = sanitizeCompanyPortalDemandCorrectionInput(current, rawInput)
  const updated = await updateDemandDetails(principal, demandId, sanitized, {
    enrichDemand: (client, demand) => attachServerOwnedCorporateReferences(
      client, principal, demand, scope,
    ),
    idempotencyPayload: rawInput,
    requireOpenRequestAdjustment: true,
    allowedCompanyIds: companyIds,
  })
  return {
    item: await projectDemandDetail(principal, updated.item),
    replayed: updated.replayed,
  }
}

function resolveCompanyPortalDemandWriteScopeCompanyIds(
  principal: RequestPrincipal,
  scope: CompanyPortalDemandScope,
): string[] {
  const writable = resolveCompanyPortalScopeCompanyIds(principal, scope, 'criar_demandas')
  const readable = new Set(resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas'))
  const companyIds = writable.filter((companyId) => readable.has(companyId))
  if (!companyIds.length) {
    throw new DemandServiceError(
      'COMPANY_PORTAL_SCOPE_EMPTY',
      'O contexto selecionado nao permite criar e acompanhar pedidos.',
      403,
    )
  }
  return companyIds
}

async function attachServerOwnedCorporateReferences(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: Record<string, unknown>,
  scope: CompanyPortalDemandScope = {},
): Promise<Record<string, unknown>> {
  const companyId = requiredText(demand.empresa_id, 'DEMAND_COMPANY_REQUIRED')
  const service = corporateService(demand.tipo_servico).key
  if (service === 'hotel') {
    return attachServerOwnedHotelTariffReference(principal, demand, scope)
  }
  if (service !== 'car' && service !== 'bus') return demand
  try {
    return await canonicalizePortalGroundDemandInTransaction(client, {
      tenantId: principal.tenantId,
      companyId,
      service,
      demand,
    })
  } catch (error) {
    if (error instanceof OfflineGroundDemandServiceError) {
      throw new DemandServiceError(error.code, error.message, error.status, error.details)
    }
    throw error
  }
}

async function attachServerOwnedHotelTariffReference(
  principal: RequestPrincipal,
  demand: Record<string, unknown>,
  scope: CompanyPortalDemandScope,
): Promise<Record<string, unknown>> {
  return {
    ...demand,
    detalhes_hotel: await attachCompanyPortalHotelTariffReference(
      principal,
      requiredText(demand.empresa_id, 'DEMAND_COMPANY_REQUIRED'),
      demand.detalhes_hotel,
      scope,
    ),
  }
}

/**
 * The corporate browser never controls operational ownership, lifecycle or
 * monetary outcome. Core validation still verifies company/requester/traveler
 * scope and each normalized service schema after this allow-list.
 */
export function sanitizeCompanyPortalDemandCreateInput(
  principal: RequestPrincipal,
  rawInput: unknown,
): { demand: Record<string, unknown>; submit: true } {
  const envelope = requiredRecord(rawInput)
  const source = requiredRecord(envelope.demand)
  const service = corporateService(source.tipo_servico)
  const internalAgency = canCreateAgencyAssistedDemand(principal)
  const requesterId = internalAgency ? optionalText(source.solicitante_id) : null
  const demand = {
    ...corporateEditableFields(source),
    id: requiredText(source.id, 'DEMAND_INPUT_INVALID'),
    empresa_id: requiredText(source.empresa_id, 'DEMAND_COMPANY_REQUIRED'),
    ...(requesterId ? { solicitante_id: requesterId } : {}),
    ...(internalAgency && requesterId ? { agency_assisted: true } : {}),
    booking_mode: 'offline',
    passageiro_nome: requiredText(source.passageiro_nome, 'DEMAND_PASSENGER_REQUIRED'),
    tipo_servico: service.label,
    valor_cotacao: 0,
    status: 'pendente',
    origem: 'Portal Empresa',
    data_atendimento: isoDate(source.data_atendimento),
    created_at: new Date().toISOString(),
    ...sanitizeCorporateDemandServiceDetails(service.key, source),
  }
  return { demand, submit: true }
}

export function sanitizeCompanyPortalDemandCorrectionInput(
  current: CorporateDemandDetail,
  rawInput: unknown,
): {
  demand: Record<string, unknown>
  expectedVersion: number
  reason: string
  idempotencyKey: string
  confirmed: true
} {
  const envelope = requiredRecord(rawInput)
  const source = requiredRecord(envelope.demand)
  const expectedVersion = positiveInteger(envelope.expectedVersion, 'DEMAND_VERSION_INVALID')
  const reason = boundedText(envelope.reason, 3, 2_000, 'DEMAND_REASON_INVALID')
  const idempotencyKey = boundedText(envelope.idempotencyKey, 8, 200, 'DEMAND_IDEMPOTENCY_INVALID')
  const service = corporateService(current.serviceType)
  const demand = {
    ...corporateEditableFields(current.demand),
    ...corporateEditableFields(source),
    id: current.id,
    serial_os: current.demand.serial_os,
    empresa_id: current.companyId,
    solicitante_id: current.demand.solicitante_id,
    solicitante_nome: current.demand.solicitante_nome,
    agency_assisted: current.demand.agency_assisted,
    booking_mode: 'offline',
    tipo_servico: service.label,
    status: current.demand.status,
    origem: current.demand.origem || 'Portal Empresa',
    data_atendimento: current.demand.data_atendimento,
    created_at: current.demand.created_at,
    valor_cotacao: current.demand.valor_cotacao,
    ...(current.demand.valor_venda === undefined ? {} : { valor_venda: current.demand.valor_venda }),
    ...(current.demand.valor_final === undefined ? {} : { valor_final: current.demand.valor_final }),
    updated_at: new Date().toISOString(),
    ...sanitizeCorporateDemandServiceDetails(service.key, source),
  }
  return { demand, expectedVersion, reason, idempotencyKey, confirmed: true }
}

async function projectDemandDetail(
  principal: RequestPrincipal,
  item: RelationalDemandListItem,
): Promise<CorporateDemandDetail> {
  const facts = await loadDemandActorFacts(principal, [item])
  return projectCorporateDemandDetail(item, capabilitiesForDemand(principal, item, facts))
}

async function loadDemandActorFacts(
  principal: RequestPrincipal,
  items: RelationalDemandListItem[],
): Promise<DemandActorFacts> {
  const demandIds = Array.from(new Set(items.map((item) => item.id).filter(Boolean)))
  if (!demandIds.length) {
    return { requesterOwnedDemandIds: new Set(), assignedApprovalDemandIds: new Set() }
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const [owned, assigned] = await Promise.all([
      client.query<OwnedDemandRow>(
        `select demand.id as demand_id
         from demands demand
         join requesters requester
           on requester.tenant_id = demand.tenant_id
          and requester.id = demand.requester_id
          and requester.company_id = demand.company_id
          and requester.status = 'active'
          and requester.deleted_at is null
         where demand.tenant_id = $1
           and demand.id = any($2::text[])
           and demand.deleted_at is null
           and requester.user_id = $3::uuid`,
        [principal.tenantId, demandIds, principal.user.id],
      ),
      client.query<AssignedApprovalDemandRow>(
        `select distinct instance.demand_id
         from approval_instances instance
         join approval_steps step
           on step.tenant_id = instance.tenant_id
          and step.approval_instance_id = instance.id
          and step.status = 'pending'
         join approval_assignments assignment
           on assignment.tenant_id = step.tenant_id
          and assignment.approval_step_id = step.id
          and assignment.status = 'pending'
         where instance.tenant_id = $1
           and instance.demand_id = any($2::text[])
           and instance.status in ('pending', 'in_progress')
           and assignment.assignee_user_id = $3::uuid`,
        [principal.tenantId, demandIds, principal.user.id],
      ),
    ])
    return {
      requesterOwnedDemandIds: new Set(owned.rows.map((row) => row.demand_id)),
      assignedApprovalDemandIds: new Set(assigned.rows.map((row) => row.demand_id)),
    }
  })
}

function capabilitiesForDemand(
  principal: RequestPrincipal,
  item: RelationalDemandListItem,
  facts: DemandActorFacts,
): CorporateDemandCapabilities {
  const requesterOwnedByCurrentUser = facts.requesterOwnedDemandIds.has(item.id)
  const requestAdjustment = record(item.governance.requestAdjustment)
  const adjustmentAllowsEdit = item.governance.requestAdjustmentAllowed === true
    && requestAdjustment?.status === 'open'
    && Array.isArray(requestAdjustment.allowedActions)
    && requestAdjustment.allowedActions.includes('edit_request')
  const canCreate = companyAllows(principal, item.companyId, 'criar_demandas')
  const canViewReservations = companyAllows(principal, item.companyId, 'ver_reservas')
  const canDecideApproval = companyAllows(principal, item.companyId, 'ver_aprovacoes')
    && companyAllows(principal, item.companyId, 'decidir_aprovacoes')
    && facts.assignedApprovalDemandIds.has(item.id)
  const correctionActor = isRequesterReadPrincipal(principal)
    ? requesterOwnedByCurrentUser
    : isInternalPrincipal(principal)
  return {
    requesterOwnedByCurrentUser,
    canChooseQuote: requesterOwnedByCurrentUser
      && canCreate
      && canViewReservations
      && item.lifecycleStatus === 'pending_choice',
    canDecideAssignedApproval: canDecideApproval,
    canCorrectRequest: Boolean(adjustmentAllowsEdit && canCreate && correctionActor),
  }
}

function companyAllows(
  principal: RequestPrincipal,
  companyId: string,
  permission: keyof Permissoes,
): boolean {
  return principal.corporateAccess?.companies.some((company) => (
    company.companyId === companyId && company.permissions[permission] === true
  )) === true
}

function isInternalPrincipal(principal: RequestPrincipal): boolean {
  return principal.platformAdmin
    || ['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'].includes(principal.roleKey)
}

function corporateEditableFields(source: Record<string, unknown>): Record<string, unknown> {
  return pickDefined(source, [
    'funcionario_id',
    'passageiro_nome',
    'prioridade',
    'observacoes',
    'forma_pagamento',
    'cost_center_id',
    'centro_custo',
    'projeto_obra',
    'numero_solicitacao',
    'autorizador_nome',
    'contato_passageiro',
  ])
}

function corporateService(value: unknown): { key: 'air' | 'hotel' | 'car' | 'bus'; label: string } {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  if (['air', 'aereo'].includes(normalized)) return { key: 'air', label: 'Aéreo' }
  if (['hotel', 'hotelaria', 'hospedagem'].includes(normalized)) return { key: 'hotel', label: 'Hotel' }
  if (['car', 'carro', 'locacao', 'locacao de veiculo'].includes(normalized)) return { key: 'car', label: 'Carro' }
  if (['bus', 'rodoviario', 'onibus', 'passagem rodoviaria'].includes(normalized)) {
    return { key: 'bus', label: 'Rodoviário' }
  }
  throw new DemandServiceError(
    'COMPANY_PORTAL_SERVICE_NOT_ALLOWED',
    'O Portal Empresa aceita somente aéreo, hotel, carro ou rodoviário offline.',
    422,
  )
}

function requiredRecord(value: unknown): Record<string, unknown> {
  const parsed = record(value)
  if (parsed) return parsed
  throw new DemandServiceError('DEMAND_INPUT_INVALID', 'Os dados da demanda são inválidos.', 400)
}

function requiredText(value: unknown, code: string): string {
  const parsed = optionalText(value)
  if (parsed) return parsed
  throw new DemandServiceError(code, 'Preencha os dados obrigatórios da demanda.', 400)
}

function boundedText(value: unknown, min: number, max: number, code: string): string {
  const parsed = optionalText(value)
  if (parsed && parsed.length >= min && parsed.length <= max) return parsed
  throw new DemandServiceError(code, 'Os dados de governança da correção são inválidos.', 400)
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new DemandServiceError(code, 'A versão informada para a correção é inválida.', 400)
}

function isoDate(value: unknown): string {
  const parsed = optionalText(value)
  return parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed)
    ? parsed
    : new Date().toISOString().slice(0, 10)
}

function pickDefined(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (
    source[field] === undefined ? [] : [[field, source[field]]]
  )))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function companyPortalDemandNotFound(): DemandServiceError {
  return new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
}
