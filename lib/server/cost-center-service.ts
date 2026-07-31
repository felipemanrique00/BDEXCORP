import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  activateCostCenterPlanSchema,
  deactivateCostCenterSchema,
  costCenterPlanQuerySchema,
  costCenterQuerySchema,
  createCostCenterPlanSchema,
  createCostCenterSchema,
  updateCostCenterSchema,
  type ActivateCostCenterPlanInput,
  type CostCenterPlanQuery,
  type CostCenterQuery,
} from '@/lib/cost-centers/schema'
import type {
  CostCenter,
  CostCenterListResult,
  CostCenterPlan,
  CostCenterPlanCompany,
  CostCenterPlanListResult,
  CostCenterSummary,
  CostCenterUsage,
} from '@/lib/cost-centers/types'
import {
  getAccessibleCompanyIds,
  requireCompanyAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface PlanRow extends QueryResultRow {
  id: string
  business_group_id: string | null
  owner_company_id: string | null
  code: string
  name: string
  description: string | null
  plan_type: 'group_shared' | 'company_exclusive'
  is_group_default: boolean
  is_active: boolean
  version: string | number
  metadata: Record<string, unknown> | null
  company_ids: string[] | null
  created_at: string | Date
  updated_at: string | Date
  total_count?: string | number
}

interface DefinitionRow extends QueryResultRow {
  id: string
  projection_id: string | null
  projection_status: 'active' | 'inactive' | null
  plan_id: string
  parent_id: string | null
  code: string
  name: string
  description: string | null
  hierarchy_level: string | number
  scope_type: 'plan' | 'selected_companies'
  company_ids: string[] | null
  manager_user_id: string | null
  is_active: boolean
  version: string | number
  metadata: Record<string, unknown> | null
  created_at: string | Date
  updated_at: string | Date
  company_defaults: string | number | null
  employees: string | number | null
  requesters: string | number | null
  demands: string | number | null
  budgets: string | number | null
  approval_authorities: string | number | null
  total_count?: string | number
  active_count?: string | number
  inactive_count?: string | number
  with_usage_count?: string | number
  level_1_count?: string | number
  level_2_count?: string | number
  level_3_count?: string | number
}

interface CompanyRow extends QueryResultRow {
  id: string
  group_id: string | null
  legal_name: string
  trade_name: string
  status: string
  is_default: boolean | null
  assignment_active: boolean | null
}

interface DefinitionStateRow extends QueryResultRow {
  id: string
  plan_id: string
  parent_id: string | null
  code: string
  name: string
  description: string | null
  hierarchy_level: string | number
  scope_type: 'plan' | 'selected_companies'
  manager_user_id: string | null
  is_active: boolean
  version: string | number
  metadata: Record<string, unknown> | null
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
}

interface ProjectionDefinitionRow extends QueryResultRow {
  id: string
  parent_id: string | null
  code: string
  name: string
  hierarchy_level: string | number
  manager_user_id: string | null
  is_active: boolean
  metadata: Record<string, unknown> | null
}

interface CompanyDefaultCostCenterRow extends QueryResultRow {
  default_cost_center_id: string | null
  default_cost_center: string | null
  projection_code: string | null
}

const EMPTY_SUMMARY: CostCenterSummary = {
  total: 0,
  active: 0,
  inactive: 0,
  withUsage: 0,
  byLevel: { macro: 0, intermediate: 0, micro: 0 },
}

export class CostCenterServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CostCenterServiceError'
  }
}

export async function listCostCenterPlans(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<CostCenterPlanListResult> {
  const query = costCenterPlanQuerySchema.parse(rawQuery)
  await assertPlanQueryAccess(principal, query)
  const companyIds = readableCompanyIds(principal)
  const groupIds = readableGroupIds(principal)
  const manageCompanyIds = manageableCompanyIds(principal)
  const manageGroupIds = manageableGroupIds(principal, manageCompanyIds)
  if (!companyIds.length && !groupIds.length) return { items: [], companies: [], total: 0 }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const items = await loadVisiblePlans(
      client,
      principal.tenantId,
      companyIds,
      manageCompanyIds,
      manageGroupIds,
      query,
    )
    const companies = await loadCompaniesForResponse(
      client,
      principal.tenantId,
      companyIds,
      query.companyId,
      query.groupId,
    )
    return {
      items: items.map(mapPlan),
      companies,
      total: items[0] ? numberValue(items[0].total_count) : 0,
    }
  })
}

export async function listCostCenters(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<CostCenterListResult> {
  const query = costCenterQuerySchema.parse(rawQuery)
  const visibleCompanyIds = readableCompanyIds(principal)
  const visibleGroupIds = readableGroupIds(principal)

  if (!query.companyId) {
    const plansResult = await listCostCenterPlans(principal, {
      includeInactive: query.includeInactive,
      limit: 500,
      offset: 0,
    })
    return {
      plan: null,
      plans: plansResult.items,
      companies: plansResult.companies,
      items: [],
      options: [],
      summary: EMPTY_SUMMARY,
    }
  }

  await requireCompanyAccess(principal, query.companyId, 'ver_centros_custo')

  return withTenantTransaction(principal.tenantId, async (client) => {
    const company = await requireActiveCompany(client, principal.tenantId, query.companyId!)
    const plans = await loadPlansApplicableToCompany(
      client,
      principal.tenantId,
      query.companyId!,
      company.group_id,
      visibleCompanyIds,
      query.includeInactive,
      canManageCompanyCostCenters(principal, query.companyId!),
    )
    const defaultPlanId = await resolveDefaultPlanId(client, principal.tenantId, query.companyId!)
    const selected = query.planId
      ? plans.find((plan) => plan.id === query.planId)
      : plans.find((plan) => plan.id === defaultPlanId) || plans[0]

    if (query.planId && !selected) {
      throw new CostCenterServiceError(
        'COST_CENTER_PLAN_NOT_AVAILABLE',
        'O plano informado nao esta disponivel para esta empresa.',
        404,
      )
    }
    if (!selected) {
      return {
        plan: null,
        plans: plans.map(mapPlan),
        companies: [mapCompany(company)],
        items: [],
        options: [],
        summary: EMPTY_SUMMARY,
      }
    }

    const [definitionRows, planCompanies] = await Promise.all([
      loadDefinitionsForCompany(
        client,
        principal.tenantId,
        selected.id,
        query.companyId!,
        visibleCompanyIds,
        query,
      ),
      loadPlanCompanies(client, principal.tenantId, selected.id, visibleCompanyIds),
    ])
    const items = definitionRows.map(mapDefinition)
    const row = definitionRows[0]
    const summary = row ? summaryFromRow(row) : EMPTY_SUMMARY

    return {
      plan: mapPlan(selected),
      plans: plans.map(mapPlan),
      companies: planCompanies,
      items,
      options: items
        .filter((item, index) => (
          item.isActive
          && item.projectionId
          && definitionRows[index]?.projection_status === 'active'
        ))
        .map((item) => ({
          id: item.id,
          projectionId: item.projectionId,
          code: item.code,
          name: item.name,
          label: `${item.code} - ${item.name}`,
          hierarchyLevel: item.hierarchyLevel,
          parentId: item.parentId,
          isActive: item.isActive,
        })),
      summary,
    }
  })
}

export async function getCostCenter(
  principal: RequestPrincipal,
  id: string,
  companyId?: string,
): Promise<CostCenter> {
  if (companyId) await requireCompanyAccess(principal, companyId, 'ver_centros_custo')
  const visibleCompanyIds = readableCompanyIds(principal)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const state = await requireDefinition(client, principal.tenantId, id)
    const plan = await requirePlan(client, principal.tenantId, state.plan_id)
    if (companyId) {
      await assertDefinitionAvailableToCompany(
        client,
        principal.tenantId,
        state,
        companyId,
        canManageCompanyCostCenters(principal, companyId),
      )
    } else {
      const scopeCompanyIds = await configuredDefinitionCompanyIds(client, principal.tenantId, state)
      const readable = new Set(visibleCompanyIds)
      if (scopeCompanyIds.length && !scopeCompanyIds.some((candidate) => readable.has(candidate))) {
        throw notFound('Centro de custo')
      }
      if (!scopeCompanyIds.length) {
        await assertPlanActorScope(principal, plan, 'gerenciar_centros_custo')
      }
    }
    const row = await loadDefinitionDetail(client, principal.tenantId, id, companyId || null, visibleCompanyIds)
    if (!row) throw notFound('Centro de custo')
    return mapDefinition(row)
  })
}

export async function createCostCenterPlan(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<CostCenterPlan> {
  const input = createCostCenterPlanSchema.parse(rawInput)
  await assertNewPlanActorScope(principal, input)
  const companyIds = uniqueStrings(
    input.planType === 'company_exclusive' && input.isActive
      ? [...input.companyIds, input.ownerCompanyId!]
      : input.companyIds,
  )
  await assertCompaniesAccess(principal, companyIds, 'gerenciar_centros_custo')

  let plan: CostCenterPlan
  try {
    plan = await withTenantTransaction(principal.tenantId, async (client) => {
      if (input.businessGroupId) await lockBusinessGroup(client, principal.tenantId, input.businessGroupId)
      await validatePlanCompanies(
        client,
        principal.tenantId,
        input.planType,
        input.businessGroupId || null,
        input.ownerCompanyId || null,
        companyIds,
      )

      if (input.planType === 'group_shared' && input.isGroupDefault) {
        const affected = await groupCompaniesWithoutExplicitDefault(
          client,
          principal.tenantId,
          input.businessGroupId!,
        )
        await assertCompaniesAccess(principal, affected, 'gerenciar_centros_custo')
      }

      const saved = await client.query<PlanRow>(
        `insert into cost_center_plans (
           tenant_id, business_group_id, owner_company_id, code, name, description,
           plan_type, is_group_default, is_active, metadata, created_by, updated_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
         returning *, '{}'::text[] as company_ids`,
        [
          principal.tenantId,
          input.businessGroupId || null,
          input.ownerCompanyId || null,
          input.code,
          input.name,
          input.description || null,
          input.planType,
          input.isGroupDefault,
          input.isActive,
          JSON.stringify(input.metadata),
          principal.user.id,
        ],
      )
      const row = saved.rows[0]
      if (!row) throw new CostCenterServiceError('COST_CENTER_PLAN_CREATE_FAILED', 'Nao foi possivel criar o plano.', 500)

      if (companyIds.length) {
        await activatePlanCompanies(
          client,
          principal,
          row,
          companyIds,
          true,
        )
      }
      const hydrated = await loadPlanById(client, principal.tenantId, row.id, readableCompanyIds(principal))
      if (!hydrated) throw new CostCenterServiceError('COST_CENTER_PLAN_CREATE_FAILED', 'Nao foi possivel carregar o plano criado.', 500)
      return mapPlan(hydrated)
    })
  } catch (error) {
    throw translateDatabaseError(error, 'plano')
  }

  await writeAuditEvent({
    action: 'cost_center.plan.created',
    result: 'success',
    entityType: 'cost_center_plan',
    entityId: plan.id,
    metadata: {
      planType: plan.planType,
      businessGroupId: plan.businessGroupId,
      ownerCompanyId: plan.ownerCompanyId,
      companyIds: plan.companyIds,
      version: plan.version,
    },
  })
  return plan
}

export async function activateCostCenterPlan(
  principal: RequestPrincipal,
  id: string,
  rawInput: unknown,
): Promise<CostCenterPlan> {
  const input = activateCostCenterPlanSchema.parse(rawInput)
  let result: { plan: CostCenterPlan; activatedCompanyIds: string[] }

  try {
    result = await withTenantTransaction(principal.tenantId, async (client) => {
      const current = await requirePlan(client, principal.tenantId, id, true)
      assertVersion('plano', input.expectedVersion, current.version)
      await assertPlanActorScope(principal, current, 'gerenciar_centros_custo')

      const companyIds = uniqueStrings(
        current.plan_type === 'company_exclusive' && !input.companyIds.length
          ? [current.owner_company_id!]
          : input.companyIds,
      )
      if (!companyIds.length && current.plan_type === 'group_shared') {
        throw new CostCenterServiceError(
          'COST_CENTER_PLAN_COMPANIES_REQUIRED',
          'Informe ao menos uma empresa para ativar o plano compartilhado.',
          422,
        )
      }
      await assertCompaniesAccess(principal, companyIds, 'gerenciar_centros_custo')
      await validatePlanCompanies(
        client,
        principal.tenantId,
        current.plan_type,
        current.business_group_id,
        current.owner_company_id,
        companyIds,
      )

      const updated = await client.query<PlanRow>(
        `update cost_center_plans
         set is_active = true, updated_by = $4, version = version + 1
         where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null
         returning *, '{}'::text[] as company_ids`,
        [principal.tenantId, id, input.expectedVersion, principal.user.id],
      )
      if (!updated.rows[0]) throw staleVersion('plano', input.expectedVersion, numberValue(current.version))

      await activatePlanCompanies(
        client,
        principal,
        updated.rows[0],
        companyIds,
        input.setAsDefault,
      )
      const effectiveCompanyIds = await effectivePlanCompanyIds(client, principal.tenantId, id)
      await assertCompaniesAccess(principal, effectiveCompanyIds, 'gerenciar_centros_custo')
      const remainingCompanyIds = effectiveCompanyIds.filter((companyId) => !companyIds.includes(companyId))
      await materializePlanForCompanies(
        client,
        principal,
        id,
        remainingCompanyIds,
        input.setAsDefault,
      )
      const hydrated = await loadPlanById(client, principal.tenantId, id, readableCompanyIds(principal))
      if (!hydrated) throw notFound('Plano de centros de custo')
      return { plan: mapPlan(hydrated), activatedCompanyIds: companyIds }
    })
  } catch (error) {
    throw translateDatabaseError(error, 'plano')
  }

  await writeAuditEvent({
    action: 'cost_center.plan.activated',
    result: 'success',
    entityType: 'cost_center_plan',
    entityId: result.plan.id,
    metadata: {
      companyIds: result.activatedCompanyIds,
      setAsDefault: input.setAsDefault,
      reason: input.reason || null,
      version: result.plan.version,
    },
  })
  return result.plan
}

export async function createCostCenter(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<CostCenter> {
  const input = createCostCenterSchema.parse(rawInput)
  let item: CostCenter

  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const plan = await requirePlan(client, principal.tenantId, input.planId, true)
      await assertPlanActorScope(principal, plan, 'gerenciar_centros_custo')
      await lockPlan(client, principal.tenantId, plan.id)

      const companyIds = input.scopeType === 'plan'
        ? await effectivePlanCompanyIds(client, principal.tenantId, plan.id)
        : uniqueStrings(input.companyIds)
      await assertCompaniesAccess(principal, companyIds, 'gerenciar_centros_custo')
      if (input.scopeType === 'selected_companies') {
        await assertCompaniesUsePlan(client, principal.tenantId, plan.id, companyIds)
      }

      const parent = input.parentId
        ? await requireValidParent(client, principal.tenantId, plan.id, input.parentId, input.isActive)
        : null
      if (parent) {
        await assertScopeWithinParent(client, principal.tenantId, parent, companyIds)
      }
      if (input.managerUserId) await assertTenantUser(client, principal.tenantId, input.managerUserId)

      const saved = await client.query<DefinitionStateRow>(
        `insert into cost_center_definitions (
           tenant_id, plan_id, parent_id, code, name, description, hierarchy_level,
           scope_type, manager_user_id, is_active, metadata, created_by, updated_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)
         returning *`,
        [
          principal.tenantId,
          plan.id,
          input.parentId || null,
          input.code,
          input.name,
          input.description || null,
          parent ? numberValue(parent.hierarchy_level) + 1 : 1,
          input.scopeType,
          input.managerUserId || null,
          input.isActive,
          JSON.stringify(input.metadata),
          principal.user.id,
        ],
      )
      const definition = saved.rows[0]
      if (!definition) throw new CostCenterServiceError('COST_CENTER_CREATE_FAILED', 'Nao foi possivel criar o centro de custo.', 500)
      await replaceDefinitionCompanies(client, principal, definition.id, input.scopeType, companyIds)
      await materializePlanForCompanies(client, principal, plan.id, companyIds, true)

      const detail = await loadDefinitionDetail(
        client,
        principal.tenantId,
        definition.id,
        companyIds[0] || null,
        readableCompanyIds(principal),
      )
      if (!detail) throw new CostCenterServiceError('COST_CENTER_CREATE_FAILED', 'Nao foi possivel carregar o centro criado.', 500)
      return mapDefinition(detail)
    })
  } catch (error) {
    throw translateDatabaseError(error, 'centro')
  }

  await writeAuditEvent({
    action: 'cost_center.definition.created',
    result: 'success',
    entityType: 'cost_center_definition',
    entityId: item.id,
    metadata: {
      planId: item.planId,
      parentId: item.parentId,
      scopeType: item.scopeType,
      companyIds: item.companyIds,
      version: item.version,
    },
  })
  return item
}

export async function updateCostCenter(
  principal: RequestPrincipal,
  id: string,
  rawInput: unknown,
): Promise<CostCenter> {
  const input = updateCostCenterSchema.parse(rawInput)
  let item: CostCenter

  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const initial = await requireDefinition(client, principal.tenantId, id)
      const plan = await requirePlan(client, principal.tenantId, initial.plan_id, true)
      await assertPlanActorScope(principal, plan, 'gerenciar_centros_custo')
      await lockPlan(client, principal.tenantId, plan.id)
      const current = await requireDefinition(client, principal.tenantId, id, true)
      assertVersion('centro de custo', input.expectedVersion, current.version)

      const currentCompanies = await effectiveDefinitionCompanyIds(client, principal.tenantId, current)
      const nextScope = input.scopeType ?? current.scope_type
      if (nextScope === 'plan' && input.companyIds?.length) {
        throw new CostCenterServiceError(
          'COST_CENTER_PLAN_SCOPE_COMPANIES_FORBIDDEN',
          'Centro global ao plano nao aceita empresas explicitas.',
          422,
        )
      }
      const nextCompanies = nextScope === 'plan'
        ? await effectivePlanCompanyIds(client, principal.tenantId, plan.id)
        : input.companyIds !== undefined
          ? uniqueStrings(input.companyIds)
          : currentCompanies
      if (nextScope === 'selected_companies' && !nextCompanies.length) {
        throw new CostCenterServiceError(
          'COST_CENTER_COMPANIES_REQUIRED',
          'Centro restrito exige ao menos uma empresa.',
          422,
        )
      }
      if (nextScope === 'selected_companies') {
        await assertCompaniesUsePlan(client, principal.tenantId, plan.id, nextCompanies)
      }
      const affectedCompanies = uniqueStrings([...currentCompanies, ...nextCompanies])
      await assertCompaniesAccess(principal, affectedCompanies, 'gerenciar_centros_custo')
      const nextCompanySet = new Set(nextCompanies)
      const removedCompanies = currentCompanies.filter((companyId) => !nextCompanySet.has(companyId))
      if (removedCompanies.length) {
        await assertNotCompanyDefault(client, principal.tenantId, id, removedCompanies)
      }

      const nextParentId = input.parentId !== undefined ? input.parentId : current.parent_id
      const nextActive = input.isActive ?? current.is_active
      if (nextActive && !plan.is_active) {
        throw new CostCenterServiceError(
          'COST_CENTER_PLAN_INACTIVE',
          'Nao e possivel ativar um centro de custo em um plano inativo.',
          422,
        )
      }
      const parent = nextParentId
        ? await requireValidParent(client, principal.tenantId, plan.id, nextParentId, nextActive, id)
        : null
      const nextLevel = parent ? numberValue(parent.hierarchy_level) + 1 : 1
      await assertDescendantDepth(client, principal.tenantId, plan.id, id, nextLevel)
      if (parent) await assertScopeWithinParent(client, principal.tenantId, parent, nextCompanies)
      await assertDescendantScopesWithin(client, principal.tenantId, plan.id, id, nextCompanies)
      if (!nextActive && current.is_active) {
        await assertNoActiveChildren(client, principal.tenantId, id)
        await assertNotCompanyDefault(client, principal.tenantId, id)
      }
      if (input.managerUserId) await assertTenantUser(client, principal.tenantId, input.managerUserId)

      const saved = await client.query<DefinitionStateRow>(
        `update cost_center_definitions set
           parent_id = $4,
           code = $5,
           name = $6,
           description = $7,
           hierarchy_level = $8,
           scope_type = $9,
           manager_user_id = $10,
           is_active = $11,
           metadata = $12::jsonb,
           updated_by = $13,
           version = version + 1
         where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null
         returning *`,
        [
          principal.tenantId,
          id,
          input.expectedVersion,
          nextParentId,
          input.code ?? current.code,
          input.name ?? current.name,
          input.description !== undefined ? input.description : current.description,
          nextLevel,
          nextScope,
          input.managerUserId !== undefined ? input.managerUserId : current.manager_user_id,
          nextActive,
          JSON.stringify(input.metadata ?? metadataRecord(current.metadata)),
          principal.user.id,
        ],
      )
      if (!saved.rows[0]) throw staleVersion('centro de custo', input.expectedVersion, numberValue(current.version))

      if (nextParentId !== current.parent_id) {
        await client.query(
          `with recursive descendants as (
             select id from cost_center_definitions
             where tenant_id = $1 and plan_id = $2 and parent_id = $3 and deleted_at is null
             union all
             select child.id from cost_center_definitions child
             join descendants on child.parent_id = descendants.id
             where child.tenant_id = $1 and child.plan_id = $2 and child.deleted_at is null
           )
           update cost_center_definitions definition
           set version = definition.version + 1, updated_by = $4
           where definition.tenant_id = $1 and definition.id in (select id from descendants)`,
          [principal.tenantId, plan.id, id, principal.user.id],
        )
      }

      await replaceDefinitionCompanies(client, principal, id, nextScope, nextCompanies)
      await materializePlanForCompanies(client, principal, plan.id, affectedCompanies, true)
      await syncCompanyDefaultCostCenterSnapshots(client, principal, id)
      const detail = await loadDefinitionDetail(
        client,
        principal.tenantId,
        id,
        nextCompanies[0] || affectedCompanies[0] || null,
        readableCompanyIds(principal),
      )
      if (!detail) throw new CostCenterServiceError('COST_CENTER_UPDATE_FAILED', 'Nao foi possivel carregar o centro alterado.', 500)
      return mapDefinition(detail)
    })
  } catch (error) {
    throw translateDatabaseError(error, 'centro')
  }

  await writeAuditEvent({
    action: 'cost_center.definition.updated',
    result: 'success',
    entityType: 'cost_center_definition',
    entityId: item.id,
    metadata: {
      planId: item.planId,
      parentId: item.parentId,
      scopeType: item.scopeType,
      companyIds: item.companyIds,
      version: item.version,
    },
  })
  return item
}

export async function deactivateCostCenter(
  principal: RequestPrincipal,
  id: string,
  rawInput: unknown,
): Promise<CostCenter> {
  const input = deactivateCostCenterSchema.parse(rawInput)
  let item: CostCenter

  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const initial = await requireDefinition(client, principal.tenantId, id)
      const plan = await requirePlan(client, principal.tenantId, initial.plan_id, true)
      await assertPlanActorScope(principal, plan, 'gerenciar_centros_custo')
      await lockPlan(client, principal.tenantId, plan.id)
      const current = await requireDefinition(client, principal.tenantId, id, true)
      assertVersion('centro de custo', input.expectedVersion, current.version)
      await assertNoActiveChildren(client, principal.tenantId, id)
      await assertNotCompanyDefault(client, principal.tenantId, id)
      const companyIds = await effectiveDefinitionCompanyIds(client, principal.tenantId, current)
      await assertCompaniesAccess(principal, companyIds, 'gerenciar_centros_custo')

      const before = await loadDefinitionDetail(
        client,
        principal.tenantId,
        id,
        companyIds[0] || null,
        readableCompanyIds(principal),
      )
      await client.query(
        `update cost_centers
         set status = 'inactive', updated_by = $3, version = version + 1
         where tenant_id = $1 and definition_id = $2 and deleted_at is null`,
        [principal.tenantId, id, principal.user.id],
      )
      const deactivated = await client.query<DefinitionStateRow>(
        `update cost_center_definitions
         set is_active = false, updated_by = $4, version = version + 1
         where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null
         returning *`,
        [principal.tenantId, id, input.expectedVersion, principal.user.id],
      )
      if (!deactivated.rows[0]) throw staleVersion('centro de custo', input.expectedVersion, numberValue(current.version))
      if (!before) throw new CostCenterServiceError('COST_CENTER_DEACTIVATE_FAILED', 'Nao foi possivel carregar o centro de custo inativado.', 500)
      const mapped = mapDefinition(before)
      return { ...mapped, isActive: false, version: numberValue(deactivated.rows[0].version) }
    })
  } catch (error) {
    throw translateDatabaseError(error, 'centro')
  }

  await writeAuditEvent({
    action: 'cost_center.definition.deactivated',
    result: 'success',
    entityType: 'cost_center_definition',
    entityId: item.id,
    metadata: { planId: item.planId, reason: input.reason || null, version: item.version },
  })
  return item
}

async function loadVisiblePlans(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
  manageCompanyIds: string[],
  manageGroupIds: string[],
  query: CostCenterPlanQuery,
): Promise<PlanRow[]> {
  const result = await client.query<PlanRow>(
    `select plan.*,
            coalesce(visible.company_ids, '{}'::text[]) as company_ids,
            count(*) over() as total_count
     from cost_center_plans plan
     left join lateral (
       select array_agg(company.id order by company.trade_name, company.id) as company_ids
       from companies company
       where company.tenant_id = plan.tenant_id
         and company.id = any($2::text[])
         and cost_center_plan_applies_to_company(plan.tenant_id, plan.id, company.id)
     ) visible on true
     where plan.tenant_id = $1
       and plan.deleted_at is null
       and ($3::boolean or plan.is_active)
       and (
         cardinality(coalesce(visible.company_ids, '{}'::text[])) > 0
         or plan.owner_company_id = any($9::text[])
         or plan.business_group_id = any($10::text[])
       )
       and ($4::text is null or plan.owner_company_id = $4
            or exists (
              select 1 from companies filtered_company
              where filtered_company.tenant_id = plan.tenant_id
                and filtered_company.id = $4
                and filtered_company.group_id = plan.business_group_id
            ))
       and ($5::text is null or plan.business_group_id = $5)
       and ($6 = '' or plan.code::text ilike '%' || $6 || '%' or plan.name ilike '%' || $6 || '%')
     order by plan.is_active desc, plan.is_group_default desc, plan.name, plan.id
     limit $7 offset $8`,
    [
      tenantId,
      companyIds,
      query.includeInactive,
      query.companyId || null,
      query.groupId || null,
      query.search,
      query.limit,
      query.offset,
      manageCompanyIds,
      manageGroupIds,
    ],
  )
  return result.rows
}

async function loadPlansApplicableToCompany(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  groupId: string | null,
  visibleCompanyIds: string[],
  includeInactive: boolean,
  includeUnassignedCandidates: boolean,
): Promise<PlanRow[]> {
  const result = await client.query<PlanRow>(
    `select plan.*,
            coalesce(visible.company_ids, '{}'::text[]) as company_ids
     from cost_center_plans plan
     left join lateral (
       select array_agg(company.id order by company.trade_name, company.id) as company_ids
       from companies company
       where company.tenant_id = plan.tenant_id
         and company.id = any($4::text[])
         and cost_center_plan_applies_to_company(plan.tenant_id, plan.id, company.id)
     ) visible on true
     where plan.tenant_id = $1 and plan.deleted_at is null
       and ($5::boolean or plan.is_active)
       and (
         cost_center_plan_applies_to_company(plan.tenant_id, plan.id, $2)
         or ($6::boolean and (
           plan.owner_company_id = $2
           or (plan.plan_type = 'group_shared' and plan.business_group_id is not distinct from $3)
         ))
       )
     order by
       (exists (
         select 1 from cost_center_plan_companies assignment
         where assignment.tenant_id = plan.tenant_id and assignment.plan_id = plan.id
           and assignment.company_id = $2 and assignment.is_default and assignment.is_active
           and assignment.ended_at is null
       )) desc,
       (cost_center_plan_applies_to_company(plan.tenant_id, plan.id, $2)) desc,
       plan.is_group_default desc, plan.name, plan.id`,
    [tenantId, companyId, groupId, visibleCompanyIds, includeInactive, includeUnassignedCandidates],
  )
  return result.rows
}

async function loadDefinitionsForCompany(
  client: PoolClient,
  tenantId: string,
  planId: string,
  companyId: string,
  visibleCompanyIds: string[],
  query: CostCenterQuery,
): Promise<DefinitionRow[]> {
  const result = await client.query<DefinitionRow>(
    `${DEFINITION_SELECT}
     where definition.tenant_id = $1 and definition.plan_id = $2
       and definition.deleted_at is null
       and ($5::boolean or definition.is_active)
       and (
         definition.scope_type = 'plan'
         or exists (
           select 1 from cost_center_definition_companies selected
           where selected.tenant_id = definition.tenant_id
             and selected.cost_center_definition_id = definition.id
             and selected.company_id = $3 and selected.is_active and selected.ended_at is null
         )
       )
       and ($6 = '' or definition.code::text ilike '%' || $6 || '%' or definition.name ilike '%' || $6 || '%')
     order by definition.hierarchy_level, definition.code, definition.name, definition.id
     limit $7 offset $8`,
    [tenantId, planId, companyId, visibleCompanyIds, query.includeInactive, query.search, query.limit, query.offset],
  )
  return result.rows
}

async function loadDefinitionDetail(
  client: PoolClient,
  tenantId: string,
  id: string,
  companyId: string | null,
  visibleCompanyIds: string[],
): Promise<DefinitionRow | null> {
  const result = await client.query<DefinitionRow>(
    `${DEFINITION_SELECT}
     where definition.tenant_id = $1 and definition.id = $2 and definition.deleted_at is null`,
    [tenantId, id, companyId, visibleCompanyIds],
  )
  return result.rows[0] || null
}

const DEFINITION_SELECT = `
  select definition.id, projection.id as projection_id, projection.status as projection_status,
         definition.plan_id,
         definition.parent_id, definition.code::text as code, definition.name,
         definition.description, definition.hierarchy_level, definition.scope_type,
         definition.manager_user_id, definition.is_active, definition.version,
         definition.metadata, definition.created_at, definition.updated_at,
         coalesce(scope.company_ids, '{}'::text[]) as company_ids,
         coalesce(usage.company_defaults, 0) as company_defaults,
         coalesce(usage.employees, 0) as employees,
         coalesce(usage.requesters, 0) as requesters,
         coalesce(usage.demands, 0) as demands,
         coalesce(usage.budgets, 0) as budgets,
         coalesce(usage.approval_authorities, 0) as approval_authorities,
         count(*) over() as total_count,
         count(*) filter (where definition.is_active) over() as active_count,
         count(*) filter (where not definition.is_active) over() as inactive_count,
         count(*) filter (where coalesce(usage.total, 0) > 0) over() as with_usage_count,
         count(*) filter (where definition.hierarchy_level = 1) over() as level_1_count,
         count(*) filter (where definition.hierarchy_level = 2) over() as level_2_count,
         count(*) filter (where definition.hierarchy_level = 3) over() as level_3_count
  from cost_center_definitions definition
  left join cost_centers projection
    on projection.tenant_id = definition.tenant_id
   and projection.definition_id = definition.id
   and projection.company_id = $3
   and projection.deleted_at is null
  left join lateral (
    select array_agg(company.id order by company.id) as company_ids
    from companies company
    where company.tenant_id = definition.tenant_id
      and company.id = any($4::text[])
      and cost_center_plan_applies_to_company(definition.tenant_id, definition.plan_id, company.id)
      and (
        definition.scope_type = 'plan'
        or exists (
          select 1 from cost_center_definition_companies selected
          where selected.tenant_id = definition.tenant_id
            and selected.cost_center_definition_id = definition.id
            and selected.company_id = company.id
            and selected.is_active and selected.ended_at is null
        )
      )
  ) scope on true
  left join lateral (
    select
      (select count(*) from companies company where company.tenant_id = definition.tenant_id and company.default_cost_center_id = projection.id and company.deleted_at is null) as company_defaults,
      (select count(*) from employees employee where employee.tenant_id = definition.tenant_id and employee.cost_center_id = projection.id and employee.deleted_at is null) as employees,
      (select count(*) from requesters requester where requester.tenant_id = definition.tenant_id and requester.cost_center_id = projection.id and requester.deleted_at is null) as requesters,
      (select count(*) from demands demand where demand.tenant_id = definition.tenant_id and demand.cost_center_id = projection.id and demand.deleted_at is null) as demands,
      (select count(*) from budgets budget where budget.tenant_id = definition.tenant_id and budget.cost_center_id = projection.id) as budgets,
      (select count(*) from approval_authorities authority where authority.tenant_id = definition.tenant_id and authority.cost_center_id = projection.id) as approval_authorities,
      (select count(*) from companies company where company.tenant_id = definition.tenant_id and company.default_cost_center_id = projection.id and company.deleted_at is null)
      + (select count(*) from employees employee where employee.tenant_id = definition.tenant_id and employee.cost_center_id = projection.id and employee.deleted_at is null)
      + (select count(*) from requesters requester where requester.tenant_id = definition.tenant_id and requester.cost_center_id = projection.id and requester.deleted_at is null)
      + (select count(*) from demands demand where demand.tenant_id = definition.tenant_id and demand.cost_center_id = projection.id and demand.deleted_at is null)
      + (select count(*) from budgets budget where budget.tenant_id = definition.tenant_id and budget.cost_center_id = projection.id)
      + (select count(*) from approval_authorities authority where authority.tenant_id = definition.tenant_id and authority.cost_center_id = projection.id) as total
  ) usage on projection.id is not null`

async function loadPlanById(
  client: PoolClient,
  tenantId: string,
  id: string,
  visibleCompanyIds: string[],
): Promise<PlanRow | null> {
  const result = await client.query<PlanRow>(
    `select plan.*,
            coalesce((
              select array_agg(company.id order by company.id)
              from companies company
              where company.tenant_id = plan.tenant_id
                and company.id = any($3::text[])
                and cost_center_plan_applies_to_company(plan.tenant_id, plan.id, company.id)
            ), '{}'::text[]) as company_ids
     from cost_center_plans plan
     where plan.tenant_id = $1 and plan.id = $2 and plan.deleted_at is null`,
    [tenantId, id, visibleCompanyIds],
  )
  return result.rows[0] || null
}

async function requirePlan(
  client: PoolClient,
  tenantId: string,
  id: string,
  forUpdate = false,
): Promise<PlanRow> {
  const result = await client.query<PlanRow>(
    `select plan.*, '{}'::text[] as company_ids
     from cost_center_plans plan
     where plan.tenant_id = $1 and plan.id = $2 and plan.deleted_at is null
     ${forUpdate ? 'for update' : ''}`,
    [tenantId, id],
  )
  if (!result.rows[0]) throw notFound('Plano de centros de custo')
  return result.rows[0]
}

async function requireDefinition(
  client: PoolClient,
  tenantId: string,
  id: string,
  forUpdate = false,
): Promise<DefinitionStateRow> {
  const result = await client.query<DefinitionStateRow>(
    `select * from cost_center_definitions
     where tenant_id = $1 and id = $2 and deleted_at is null
     ${forUpdate ? 'for update' : ''}`,
    [tenantId, id],
  )
  if (!result.rows[0]) throw notFound('Centro de custo')
  return result.rows[0]
}

async function activatePlanCompanies(
  client: PoolClient,
  principal: RequestPrincipal,
  plan: PlanRow,
  companyIds: string[],
  setAsDefault: boolean,
): Promise<void> {
  if (!companyIds.length) return
  await lockCompanies(client, principal.tenantId, companyIds)

  for (const companyId of [...companyIds].sort()) {
    const previousCompanyDefault = setAsDefault
      ? await loadCompanyDefaultCostCenter(client, principal.tenantId, companyId)
      : null
    const previousDefault = setAsDefault
      ? await resolveDefaultPlanId(client, principal.tenantId, companyId)
      : null
    if (setAsDefault) {
      await client.query(
        `update cost_center_plan_companies
         set is_default = false, updated_by = $3
         where tenant_id = $1 and company_id = $2 and is_default and is_active
           and ended_at is null and plan_id <> $4`,
        [principal.tenantId, companyId, principal.user.id, plan.id],
      )
    }
    await client.query(
      `insert into cost_center_plan_companies (
         tenant_id, plan_id, company_id, is_default, is_active,
         created_by, updated_by, ended_at
       ) values ($1, $2, $3, $4, true, $5, $5, null)
       on conflict (tenant_id, plan_id, company_id) do update set
         is_default = cost_center_plan_companies.is_default or excluded.is_default,
         is_active = true,
         updated_by = excluded.updated_by,
         ended_at = null`,
      [principal.tenantId, plan.id, companyId, setAsDefault, principal.user.id],
    )

    if (setAsDefault && previousDefault && previousDefault !== plan.id) {
      await retireConflictingPreviousDefaultProjections(
        client,
        principal,
        companyId,
        previousDefault,
        plan.id,
      )
    }
    await materializePlanForCompanies(client, principal, plan.id, [companyId], setAsDefault)
    if (setAsDefault) {
      await reconcileCompanyDefaultCostCenter(
        client,
        principal,
        companyId,
        plan.id,
        previousCompanyDefault,
      )
    }
  }
}

async function retireConflictingPreviousDefaultProjections(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  previousPlanId: string,
  nextPlanId: string,
): Promise<void> {
  const previousStillApplies = await planAppliesToCompany(
    client,
    principal.tenantId,
    previousPlanId,
    companyId,
  )
  await client.query(
    `update cost_centers previous
     set status = 'inactive',
         deleted_at = case when exists (
           select 1 from cost_center_definitions next_definition
           where next_definition.tenant_id = previous.tenant_id
             and next_definition.plan_id = $4 and next_definition.deleted_at is null
             and lower(btrim(next_definition.code::text)) = lower(btrim(previous.code))
             and (
               next_definition.scope_type = 'plan'
               or exists (
                 select 1 from cost_center_definition_companies selected
                 where selected.tenant_id = next_definition.tenant_id
                   and selected.cost_center_definition_id = next_definition.id
                   and selected.company_id = previous.company_id
                   and selected.is_active and selected.ended_at is null
               )
             )
         )
           then coalesce(previous.deleted_at, now()) else previous.deleted_at end,
         updated_by = $5, version = previous.version + 1
     where previous.tenant_id = $1 and previous.company_id = $2
       and previous.plan_id = $3 and previous.deleted_at is null
       and ($6::boolean = false or exists (
         select 1 from cost_center_definitions next_definition
         where next_definition.tenant_id = previous.tenant_id
           and next_definition.plan_id = $4 and next_definition.deleted_at is null
           and lower(btrim(next_definition.code::text)) = lower(btrim(previous.code))
           and (
             next_definition.scope_type = 'plan'
             or exists (
               select 1 from cost_center_definition_companies selected
               where selected.tenant_id = next_definition.tenant_id
                 and selected.cost_center_definition_id = next_definition.id
                 and selected.company_id = previous.company_id
                 and selected.is_active and selected.ended_at is null
             )
           )
       ))`,
    [
      principal.tenantId,
      companyId,
      previousPlanId,
      nextPlanId,
      principal.user.id,
      previousStillApplies,
    ],
  )
}

async function materializePlanForCompanies(
  client: PoolClient,
  principal: RequestPrincipal,
  planId: string,
  companyIds: string[],
  replaceConflicts: boolean,
): Promise<void> {
  const resolvedCompanyIds = uniqueStrings(companyIds).sort()
  await lockCompanies(client, principal.tenantId, resolvedCompanyIds)
  for (const companyId of resolvedCompanyIds) {
    if (!await planAppliesToCompany(client, principal.tenantId, planId, companyId)) continue
    const definitions = await client.query<ProjectionDefinitionRow>(
      `select definition.id, definition.parent_id, definition.code::text as code,
              definition.name, definition.hierarchy_level, definition.manager_user_id,
              definition.is_active, definition.metadata
       from cost_center_definitions definition
       where definition.tenant_id = $1 and definition.plan_id = $2
         and definition.deleted_at is null
         and (
           definition.scope_type = 'plan'
           or exists (
             select 1 from cost_center_definition_companies selected
             where selected.tenant_id = definition.tenant_id
               and selected.cost_center_definition_id = definition.id
               and selected.company_id = $3 and selected.is_active and selected.ended_at is null
           )
         )
       order by definition.hierarchy_level, definition.code, definition.id`,
      [principal.tenantId, planId, companyId],
    )
    const codes = definitions.rows.map((definition) => definition.code.trim().toLowerCase())
    if (codes.length) {
      const targetIsDefault = await resolveDefaultPlanId(client, principal.tenantId, companyId) === planId
      const canReplaceConflicts = replaceConflicts && targetIsDefault
      const conflicts = await client.query<{ id: string }>(
        `select projection.id
         from cost_centers projection
         where projection.tenant_id = $1 and projection.company_id = $2
           and projection.plan_id is distinct from $3 and projection.deleted_at is null
           and lower(btrim(projection.code)) = any($4::text[])
         for update`,
        [principal.tenantId, companyId, planId, codes],
      )
      if (conflicts.rowCount && !canReplaceConflicts) {
        throw new CostCenterServiceError(
          'COST_CENTER_PROJECTION_CODE_CONFLICT',
          'Outro plano da empresa ja utiliza um dos codigos informados.',
          409,
        )
      }
      if (conflicts.rowCount) {
        await client.query(
          `update cost_centers
           set status = 'inactive', deleted_at = coalesce(deleted_at, now()),
               updated_by = $3, version = version + 1
           where tenant_id = $1 and id = any($2::uuid[])`,
          [principal.tenantId, conflicts.rows.map((row) => row.id), principal.user.id],
        )
      }
    }

    const projectionByDefinition = new Map<string, string>()
    for (const definition of definitions.rows) {
      const parentProjectionId = definition.parent_id
        ? projectionByDefinition.get(definition.parent_id) || await findProjectionId(
          client,
          principal.tenantId,
          companyId,
          definition.parent_id,
        )
        : null
      if (definition.parent_id && !parentProjectionId) {
        throw new CostCenterServiceError(
          'COST_CENTER_PARENT_PROJECTION_MISSING',
          'Nao foi possivel materializar o pai do centro de custo para a empresa.',
          409,
          { definitionId: definition.id, parentId: definition.parent_id, companyId },
        )
      }
      const metadata = {
        ...metadataRecord(definition.metadata),
        canonicalDefinitionId: definition.id,
        projectionSource: 'cost_center_catalog',
      }
      const saved = await client.query<{ id: string }>(
        `insert into cost_centers (
           tenant_id, company_id, parent_id, code, name, manager_user_id, status,
           metadata, plan_id, definition_id, hierarchy_level, version, updated_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, 1, $12)
         on conflict (tenant_id, company_id, definition_id)
           where definition_id is not null and deleted_at is null
         do update set
           parent_id = excluded.parent_id,
           code = excluded.code,
           name = excluded.name,
           manager_user_id = excluded.manager_user_id,
           status = excluded.status,
           metadata = excluded.metadata,
           plan_id = excluded.plan_id,
           hierarchy_level = excluded.hierarchy_level,
           updated_by = excluded.updated_by,
           version = cost_centers.version + 1,
           updated_at = now()
         returning id`,
        [
          principal.tenantId,
          companyId,
          parentProjectionId,
          definition.code,
          definition.name,
          definition.manager_user_id,
          definition.is_active ? 'active' : 'inactive',
          JSON.stringify(metadata),
          planId,
          definition.id,
          numberValue(definition.hierarchy_level),
          principal.user.id,
        ],
      )
      projectionByDefinition.set(definition.id, saved.rows[0].id)
    }

    await client.query(
      `update cost_centers projection
       set status = 'inactive', updated_by = $4, version = projection.version + 1
       where projection.tenant_id = $1 and projection.company_id = $2
         and projection.plan_id = $3 and projection.deleted_at is null
         and not (projection.definition_id = any($5::uuid[]))
         and projection.status <> 'inactive'`,
      [
        principal.tenantId,
        companyId,
        planId,
        principal.user.id,
        definitions.rows.map((definition) => definition.id),
      ],
    )
  }
}

async function replaceDefinitionCompanies(
  client: PoolClient,
  principal: RequestPrincipal,
  definitionId: string,
  scopeType: 'plan' | 'selected_companies',
  companyIds: string[],
): Promise<void> {
  await client.query(
    `update cost_center_definition_companies
     set is_active = false, ended_at = coalesce(ended_at, now()), updated_by = $3
     where tenant_id = $1 and cost_center_definition_id = $2 and is_active`,
    [principal.tenantId, definitionId, principal.user.id],
  )
  if (scopeType !== 'selected_companies') return
  for (const companyId of companyIds) {
    await client.query(
      `insert into cost_center_definition_companies (
         tenant_id, cost_center_definition_id, company_id, is_active,
         created_by, updated_by, ended_at
       ) values ($1, $2, $3, true, $4, $4, null)
       on conflict (tenant_id, cost_center_definition_id, company_id) do update set
         is_active = true, ended_at = null, updated_by = excluded.updated_by`,
      [principal.tenantId, definitionId, companyId, principal.user.id],
    )
  }
}

async function loadPlanCompanies(
  client: PoolClient,
  tenantId: string,
  planId: string,
  visibleCompanyIds: string[],
): Promise<CostCenterPlanCompany[]> {
  if (!visibleCompanyIds.length) return []
  const result = await client.query<CompanyRow>(
    `select company.id, company.group_id, company.legal_name, company.trade_name, company.status,
            coalesce(assignment.is_default, false) as is_default,
            coalesce(assignment.is_active and assignment.ended_at is null, false) as assignment_active
     from companies company
     left join cost_center_plan_companies assignment
       on assignment.tenant_id = company.tenant_id and assignment.company_id = company.id
      and assignment.plan_id = $2
     where company.tenant_id = $1 and company.id = any($3::text[])
       and company.deleted_at is null
       and cost_center_plan_applies_to_company(company.tenant_id, $2, company.id)
     order by company.trade_name, company.legal_name, company.id`,
    [tenantId, planId, visibleCompanyIds],
  )
  return result.rows.map(mapCompany)
}

async function loadCompaniesForResponse(
  client: PoolClient,
  tenantId: string,
  visibleCompanyIds: string[],
  companyId?: string,
  groupId?: string,
): Promise<CostCenterPlanCompany[]> {
  if (!visibleCompanyIds.length) return []
  const result = await client.query<CompanyRow>(
    `select company.id, company.group_id, company.legal_name, company.trade_name,
            company.status, false as is_default, false as assignment_active
     from companies company
     where company.tenant_id = $1 and company.id = any($2::text[])
       and company.deleted_at is null
       and ($3::text is null or company.id = $3)
       and ($4::text is null or company.group_id = $4)
     order by company.trade_name, company.legal_name, company.id`,
    [tenantId, visibleCompanyIds, companyId || null, groupId || null],
  )
  return result.rows.map(mapCompany)
}

async function requireActiveCompany(client: PoolClient, tenantId: string, companyId: string): Promise<CompanyRow> {
  const result = await client.query<CompanyRow>(
    `select company.id, company.group_id, company.legal_name, company.trade_name,
            company.status, false as is_default, false as assignment_active
     from companies company
     where company.tenant_id = $1 and company.id = $2
       and company.status = 'active' and company.deleted_at is null`,
    [tenantId, companyId],
  )
  if (!result.rows[0]) throw new CostCenterServiceError('COST_CENTER_COMPANY_NOT_FOUND', 'Empresa ativa nao encontrada.', 404)
  return result.rows[0]
}

async function validatePlanCompanies(
  client: PoolClient,
  tenantId: string,
  planType: 'group_shared' | 'company_exclusive',
  businessGroupId: string | null,
  ownerCompanyId: string | null,
  companyIds: string[],
): Promise<void> {
  if (!companyIds.length) return
  await lockCompanies(client, tenantId, companyIds)
  const result = await client.query<{ id: string; group_id: string | null }>(
    `select id, group_id from companies
     where tenant_id = $1 and id = any($2::text[])
       and status = 'active' and deleted_at is null`,
    [tenantId, companyIds],
  )
  if (result.rowCount !== companyIds.length) {
    throw new CostCenterServiceError('COST_CENTER_COMPANY_INVALID', 'Uma ou mais empresas sao invalidas ou inativas.', 422)
  }
  if (planType === 'company_exclusive' && result.rows.some((row) => row.id !== ownerCompanyId)) {
    throw new CostCenterServiceError('COST_CENTER_PLAN_COMPANY_MISMATCH', 'Plano exclusivo somente aceita a empresa proprietaria.', 422)
  }
  if (planType === 'group_shared' && result.rows.some((row) => row.group_id !== businessGroupId)) {
    throw new CostCenterServiceError('COST_CENTER_PLAN_GROUP_MISMATCH', 'Todas as empresas devem pertencer ao grupo do plano.', 422)
  }
}

async function assertCompaniesUsePlan(
  client: PoolClient,
  tenantId: string,
  planId: string,
  companyIds: string[],
): Promise<void> {
  if (!companyIds.length) return
  const result = await client.query<{ id: string }>(
    `select company.id
     from companies company
     where company.tenant_id = $1 and company.id = any($3::text[])
       and cost_center_plan_applies_to_company($1, $2, company.id)`,
    [tenantId, planId, companyIds],
  )
  if (result.rowCount !== companyIds.length) {
    throw new CostCenterServiceError(
      'COST_CENTER_SCOPE_COMPANY_INVALID',
      'Uma ou mais empresas nao utilizam o plano do centro de custo.',
      422,
    )
  }
}

async function effectivePlanCompanyIds(client: PoolClient, tenantId: string, planId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `select company.id
     from companies company
     where company.tenant_id = $1 and company.status = 'active' and company.deleted_at is null
       and cost_center_plan_applies_to_company($1, $2, company.id)
     order by company.id`,
    [tenantId, planId],
  )
  return result.rows.map((row) => row.id)
}

async function effectiveDefinitionCompanyIds(
  client: PoolClient,
  tenantId: string,
  definition: Pick<DefinitionStateRow, 'id' | 'plan_id' | 'scope_type'>,
): Promise<string[]> {
  if (definition.scope_type === 'plan') return effectivePlanCompanyIds(client, tenantId, definition.plan_id)
  const result = await client.query<{ id: string }>(
    `select selected.company_id as id
     from cost_center_definition_companies selected
     where selected.tenant_id = $1 and selected.cost_center_definition_id = $2
       and selected.is_active and selected.ended_at is null
       and cost_center_plan_applies_to_company($1, $3, selected.company_id)
     order by selected.company_id`,
    [tenantId, definition.id, definition.plan_id],
  )
  return result.rows.map((row) => row.id)
}

async function configuredDefinitionCompanyIds(
  client: PoolClient,
  tenantId: string,
  definition: Pick<DefinitionStateRow, 'id' | 'plan_id' | 'scope_type'>,
): Promise<string[]> {
  if (definition.scope_type === 'plan') {
    return effectivePlanCompanyIds(client, tenantId, definition.plan_id)
  }
  const result = await client.query<{ id: string }>(
    `select company_id as id
     from cost_center_definition_companies
     where tenant_id = $1 and cost_center_definition_id = $2
       and is_active and ended_at is null
     order by company_id`,
    [tenantId, definition.id],
  )
  return result.rows.map((row) => row.id)
}

async function requireValidParent(
  client: PoolClient,
  tenantId: string,
  planId: string,
  parentId: string,
  childActive: boolean,
  childId?: string,
): Promise<DefinitionStateRow> {
  if (childId && parentId === childId) {
    throw new CostCenterServiceError('COST_CENTER_HIERARCHY_CYCLE', 'Um centro nao pode ser pai de si mesmo.', 422)
  }
  const parent = await requireDefinition(client, tenantId, parentId)
  if (parent.plan_id !== planId) {
    throw new CostCenterServiceError('COST_CENTER_PARENT_PLAN_MISMATCH', 'O centro pai pertence a outro plano.', 422)
  }
  if (numberValue(parent.hierarchy_level) >= 3) {
    throw new CostCenterServiceError('COST_CENTER_MAX_DEPTH', 'A hierarquia aceita no maximo tres niveis.', 422)
  }
  if (childActive && !parent.is_active) {
    throw new CostCenterServiceError('COST_CENTER_PARENT_INACTIVE', 'Centro ativo exige pai ativo.', 422)
  }
  if (childId) {
    const cycle = await client.query<{ cycle: boolean }>(
      `with recursive descendants as (
         select id from cost_center_definitions
         where tenant_id = $1 and parent_id = $2 and deleted_at is null
         union all
         select child.id from cost_center_definitions child
         join descendants on child.parent_id = descendants.id
         where child.tenant_id = $1 and child.deleted_at is null
       )
       select exists(select 1 from descendants where id = $3) as cycle`,
      [tenantId, childId, parentId],
    )
    if (cycle.rows[0]?.cycle) {
      throw new CostCenterServiceError('COST_CENTER_HIERARCHY_CYCLE', 'A hierarquia nao pode conter ciclos.', 422)
    }
  }
  return parent
}

async function assertDescendantDepth(
  client: PoolClient,
  tenantId: string,
  planId: string,
  definitionId: string,
  nextLevel: number,
): Promise<void> {
  const result = await client.query<{ maximum_depth: string | number }>(
    `with recursive descendants as (
       select id, 1 as depth from cost_center_definitions
       where tenant_id = $1 and plan_id = $2 and parent_id = $3 and deleted_at is null
       union all
       select child.id, descendants.depth + 1
       from cost_center_definitions child
       join descendants on child.parent_id = descendants.id
       where child.tenant_id = $1 and child.plan_id = $2 and child.deleted_at is null
     )
     select coalesce(max(depth), 0) as maximum_depth from descendants`,
    [tenantId, planId, definitionId],
  )
  if (nextLevel + numberValue(result.rows[0]?.maximum_depth) > 3) {
    throw new CostCenterServiceError('COST_CENTER_MAX_DEPTH', 'A alteracao criaria mais de tres niveis.', 422)
  }
}

async function assertScopeWithinParent(
  client: PoolClient,
  tenantId: string,
  parent: DefinitionStateRow,
  childCompanyIds: string[],
): Promise<void> {
  const parentCompanyIds = await effectiveDefinitionCompanyIds(client, tenantId, parent)
  const parentScope = new Set(parentCompanyIds)
  if (childCompanyIds.some((companyId) => !parentScope.has(companyId))) {
    throw new CostCenterServiceError(
      'COST_CENTER_PARENT_SCOPE_MISMATCH',
      'A abrangencia do centro filho deve estar contida na abrangencia do centro pai.',
      422,
    )
  }
}

async function assertDescendantScopesWithin(
  client: PoolClient,
  tenantId: string,
  planId: string,
  definitionId: string,
  parentCompanyIds: string[],
): Promise<void> {
  const descendants = await client.query<{ id: string; scope_type: 'plan' | 'selected_companies' }>(
    `with recursive tree as (
       select id, scope_type from cost_center_definitions
       where tenant_id = $1 and plan_id = $2 and parent_id = $3 and deleted_at is null
       union all
       select child.id, child.scope_type from cost_center_definitions child
       join tree on child.parent_id = tree.id
       where child.tenant_id = $1 and child.plan_id = $2 and child.deleted_at is null
     ) select * from tree`,
    [tenantId, planId, definitionId],
  )
  const allowed = new Set(parentCompanyIds)
  for (const descendant of descendants.rows) {
    const companies = await effectiveDefinitionCompanyIds(client, tenantId, {
      id: descendant.id,
      plan_id: planId,
      scope_type: descendant.scope_type,
    })
    if (companies.some((companyId) => !allowed.has(companyId))) {
      throw new CostCenterServiceError(
        'COST_CENTER_DESCENDANT_SCOPE_MISMATCH',
        'A nova abrangencia excluiria empresas ainda usadas por centros descendentes.',
        422,
      )
    }
  }
}

async function assertDefinitionAvailableToCompany(
  client: PoolClient,
  tenantId: string,
  definition: DefinitionStateRow,
  companyId: string,
  allowPreview: boolean,
): Promise<void> {
  const plan = await requirePlan(client, tenantId, definition.plan_id)
  const potential = plan.owner_company_id === companyId || (
    plan.plan_type === 'group_shared'
    && Boolean(await companyBelongsToGroup(client, tenantId, companyId, plan.business_group_id))
  )
  if (!potential) throw notFound('Centro de custo')
  if (!allowPreview && !await planAppliesToCompany(client, tenantId, plan.id, companyId)) throw notFound('Centro de custo')
  if (definition.scope_type === 'selected_companies') {
    const selected = await client.query(
      `select 1 from cost_center_definition_companies
       where tenant_id = $1 and cost_center_definition_id = $2 and company_id = $3
         and is_active and ended_at is null`,
      [tenantId, definition.id, companyId],
    )
    if (!selected.rowCount) throw notFound('Centro de custo')
  }
}

async function assertNoActiveChildren(client: PoolClient, tenantId: string, id: string): Promise<void> {
  const result = await client.query(
    `with recursive descendants as (
       select child.id, child.is_active, array[child.id] as path
       from cost_center_definitions child
       where child.tenant_id = $1 and child.parent_id = $2 and child.deleted_at is null
       union all
       select child.id, child.is_active, descendants.path || child.id
       from cost_center_definitions child
       join descendants on child.parent_id = descendants.id
       where child.tenant_id = $1 and child.deleted_at is null
         and not child.id = any(descendants.path)
     )
     select 1 from descendants where is_active limit 1`,
    [tenantId, id],
  )
  if (result.rowCount) {
    throw new CostCenterServiceError('COST_CENTER_ACTIVE_CHILDREN', 'Inative primeiro os centros descendentes ativos.', 409)
  }
}

async function assertNotCompanyDefault(
  client: PoolClient,
  tenantId: string,
  definitionId: string,
  companyIds?: string[],
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `select company.id
     from companies company
     join cost_centers projection
       on projection.tenant_id = company.tenant_id
      and projection.company_id = company.id
      and projection.id = company.default_cost_center_id
     where company.tenant_id = $1 and projection.definition_id = $2
       and company.status = 'active' and company.deleted_at is null
       and ($3::text[] is null or company.id = any($3::text[]))
     order by company.id`,
    [tenantId, definitionId, companyIds?.length ? companyIds : null],
  )
  if (result.rowCount) {
    throw new CostCenterServiceError(
      'COST_CENTER_IS_COMPANY_DEFAULT',
      'Troque o centro de custo padrao das empresas antes de inativa-lo.',
      409,
      { companyIds: result.rows.map((row) => row.id) },
    )
  }
}

async function assertTenantUser(client: PoolClient, tenantId: string, userId: string): Promise<void> {
  const result = await client.query(
    `select 1 from tenant_memberships membership
     where membership.tenant_id = $1 and membership.user_id = $2 and membership.status = 'active'
     limit 1`,
    [tenantId, userId],
  )
  if (!result.rowCount) {
    throw new CostCenterServiceError('COST_CENTER_MANAGER_INVALID', 'Gestor ativo nao encontrado no tenant.', 422)
  }
}

async function lockPlan(client: PoolClient, tenantId: string, planId: string): Promise<void> {
  await client.query(
    `select id from cost_center_plans where tenant_id = $1 and id = $2 for update`,
    [tenantId, planId],
  )
}

async function lockCompanies(client: PoolClient, tenantId: string, companyIds: string[]): Promise<void> {
  if (!companyIds.length) return
  await client.query(
    `select id from companies where tenant_id = $1 and id = any($2::text[]) order by id for update`,
    [tenantId, [...companyIds].sort()],
  )
}

async function lockBusinessGroup(client: PoolClient, tenantId: string, groupId: string): Promise<void> {
  const result = await client.query(
    `select id from business_groups
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null
     for update`,
    [tenantId, groupId],
  )
  if (!result.rowCount) throw new CostCenterServiceError('COST_CENTER_GROUP_NOT_FOUND', 'Grupo economico ativo nao encontrado.', 404)
}

async function groupCompaniesWithoutExplicitDefault(
  client: PoolClient,
  tenantId: string,
  groupId: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `select company.id from companies company
     where company.tenant_id = $1 and company.group_id = $2
       and company.status = 'active' and company.deleted_at is null
       and not exists (
         select 1 from cost_center_plan_companies assignment
         where assignment.tenant_id = company.tenant_id and assignment.company_id = company.id
           and assignment.is_default and assignment.is_active and assignment.ended_at is null
       )
     order by company.id`,
    [tenantId, groupId],
  )
  return result.rows.map((row) => row.id)
}

async function resolveDefaultPlanId(client: PoolClient, tenantId: string, companyId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `select plan.id
     from cost_center_plans plan
     join companies company on company.tenant_id = plan.tenant_id and company.id = $2
     where plan.tenant_id = $1 and plan.is_active and plan.deleted_at is null
       and cost_center_plan_applies_to_company($1, plan.id, $2)
       and (
         exists (
           select 1 from cost_center_plan_companies assignment
           where assignment.tenant_id = plan.tenant_id and assignment.plan_id = plan.id
             and assignment.company_id = $2 and assignment.is_default
             and assignment.is_active and assignment.ended_at is null
         )
         or (
           plan.plan_type = 'group_shared' and plan.is_group_default
           and company.group_id = plan.business_group_id
           and not exists (
             select 1 from cost_center_plan_companies explicit_default
             where explicit_default.tenant_id = plan.tenant_id
               and explicit_default.company_id = $2 and explicit_default.is_default
               and explicit_default.is_active and explicit_default.ended_at is null
           )
         )
       )
     order by plan.is_group_default desc, plan.id
     limit 1`,
    [tenantId, companyId],
  )
  return result.rows[0]?.id || null
}

async function loadCompanyDefaultCostCenter(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<CompanyDefaultCostCenterRow | null> {
  const result = await client.query<CompanyDefaultCostCenterRow>(
    `select company.default_cost_center_id, company.default_cost_center,
            projection.code as projection_code
     from companies company
     left join cost_centers projection
       on projection.tenant_id = company.tenant_id
      and projection.company_id = company.id
      and projection.id = company.default_cost_center_id
     where company.tenant_id = $1 and company.id = $2 and company.deleted_at is null`,
    [tenantId, companyId],
  )
  return result.rows[0] || null
}

async function reconcileCompanyDefaultCostCenter(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  planId: string,
  previous: CompanyDefaultCostCenterRow | null,
): Promise<void> {
  if (!previous) return
  const previousCode = String(previous.projection_code || previous.default_cost_center || '').trim()
  if (!previous.default_cost_center_id && !previousCode) return

  const replacement = previousCode
    ? await client.query<{ id: string; code: string }>(
      `select projection.id, projection.code
       from cost_centers projection
       where projection.tenant_id = $1 and projection.company_id = $2
         and projection.plan_id = $3 and projection.status = 'active'
         and projection.deleted_at is null
         and lower(btrim(projection.code)) = lower(btrim($4))
       order by projection.id
       limit 1`,
      [principal.tenantId, companyId, planId, previousCode],
    )
    : null
  const row = replacement?.rows[0] || null
  await client.query(
    `update companies
     set default_cost_center_id = $3, default_cost_center = $4, updated_by = $5
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [
      principal.tenantId,
      companyId,
      row?.id || null,
      row?.code || null,
      principal.user.id,
    ],
  )
}

async function syncCompanyDefaultCostCenterSnapshots(
  client: PoolClient,
  principal: RequestPrincipal,
  definitionId: string,
): Promise<void> {
  await client.query(
    `update companies company
     set default_cost_center = projection.code, updated_by = $3
     from cost_centers projection
     where company.tenant_id = $1
       and projection.tenant_id = company.tenant_id
       and projection.company_id = company.id
       and projection.id = company.default_cost_center_id
       and projection.definition_id = $2
       and projection.status = 'active'
       and projection.deleted_at is null`,
    [principal.tenantId, definitionId, principal.user.id],
  )
}

async function planAppliesToCompany(
  client: PoolClient,
  tenantId: string,
  planId: string,
  companyId: string,
): Promise<boolean> {
  const result = await client.query<{ applies: boolean }>(
    `select cost_center_plan_applies_to_company($1, $2, $3) as applies`,
    [tenantId, planId, companyId],
  )
  return Boolean(result.rows[0]?.applies)
}

async function companyBelongsToGroup(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  groupId: string | null,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from companies
     where tenant_id = $1 and id = $2 and group_id is not distinct from $3
       and deleted_at is null`,
    [tenantId, companyId, groupId],
  )
  return Boolean(result.rowCount)
}

async function findProjectionId(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  definitionId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `select id from cost_centers
     where tenant_id = $1 and company_id = $2 and definition_id = $3 and deleted_at is null
     limit 1`,
    [tenantId, companyId, definitionId],
  )
  return result.rows[0]?.id || null
}

async function assertPlanQueryAccess(principal: RequestPrincipal, query: CostCenterPlanQuery): Promise<void> {
  if (query.companyId) await requireCompanyAccess(principal, query.companyId, 'ver_centros_custo')
  if (query.groupId) await requireGroupAccess(principal, query.groupId, 'ver_centros_custo')
}

async function assertNewPlanActorScope(
  principal: RequestPrincipal,
  input: {
    planType: 'group_shared' | 'company_exclusive'
    businessGroupId?: string | null
    ownerCompanyId?: string | null
  },
): Promise<void> {
  if (input.planType === 'group_shared') {
    await requireGroupAccess(principal, input.businessGroupId!, 'gerenciar_centros_custo')
  } else {
    await requireCompanyAccess(principal, input.ownerCompanyId!, 'gerenciar_centros_custo')
  }
}

async function assertPlanActorScope(
  principal: RequestPrincipal,
  plan: Pick<PlanRow, 'plan_type' | 'business_group_id' | 'owner_company_id'>,
  permission: 'ver_centros_custo' | 'gerenciar_centros_custo',
): Promise<void> {
  if (plan.plan_type === 'group_shared') {
    await requireGroupAccess(principal, plan.business_group_id!, permission)
  } else {
    await requireCompanyAccess(principal, plan.owner_company_id!, permission)
  }
}

async function assertCompaniesAccess(
  principal: RequestPrincipal,
  companyIds: string[],
  permission: 'ver_centros_custo' | 'gerenciar_centros_custo',
): Promise<void> {
  for (const companyId of uniqueStrings(companyIds)) {
    await requireCompanyAccess(principal, companyId, permission)
  }
}

function readableCompanyIds(principal: RequestPrincipal): string[] {
  if (principal.corporateAccess) {
    return uniqueStrings(principal.corporateAccess.companies
      .filter((company) => company.permissions.ver_centros_custo)
      .map((company) => company.companyId))
  }
  return uniqueStrings(getAccessibleCompanyIds(principal))
}

function manageableCompanyIds(principal: RequestPrincipal): string[] {
  if (principal.corporateAccess) {
    return uniqueStrings(principal.corporateAccess.companies
      .filter((company) => company.permissions.gerenciar_centros_custo)
      .map((company) => company.companyId))
  }
  return principal.user.permissoes?.gerenciar_centros_custo
    ? uniqueStrings(getAccessibleCompanyIds(principal))
    : []
}

function manageableGroupIds(principal: RequestPrincipal, companyIds: string[]): string[] {
  const manageable = new Set(companyIds)
  return uniqueStrings((principal.corporateAccess?.groups || [])
    .filter((group) => group.companyIds.some((companyId) => manageable.has(companyId)))
    .map((group) => group.groupId))
}

function canManageCompanyCostCenters(principal: RequestPrincipal, companyId: string): boolean {
  if (principal.corporateAccess) {
    return Boolean(principal.corporateAccess.companies.find(
      (company) => company.companyId === companyId,
    )?.permissions.gerenciar_centros_custo)
  }
  return Boolean(principal.user.permissoes?.gerenciar_centros_custo)
}

function readableGroupIds(principal: RequestPrincipal): string[] {
  const companyIds = new Set(readableCompanyIds(principal))
  return uniqueStrings((principal.corporateAccess?.groups || [])
    .filter((group) => group.companyIds.some((companyId) => companyIds.has(companyId)))
    .map((group) => group.groupId))
}

function mapPlan(row: PlanRow): CostCenterPlan {
  return {
    id: row.id,
    businessGroupId: row.business_group_id,
    ownerCompanyId: row.owner_company_id,
    code: String(row.code),
    name: row.name,
    description: row.description,
    planType: row.plan_type,
    isGroupDefault: Boolean(row.is_group_default),
    isActive: Boolean(row.is_active),
    version: numberValue(row.version),
    metadata: metadataRecord(row.metadata),
    companyIds: uniqueStrings(row.company_ids || []),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

function mapDefinition(row: DefinitionRow): CostCenter {
  const usage: CostCenterUsage = {
    companyDefaults: numberValue(row.company_defaults),
    employees: numberValue(row.employees),
    requesters: numberValue(row.requesters),
    demands: numberValue(row.demands),
    budgets: numberValue(row.budgets),
    approvalAuthorities: numberValue(row.approval_authorities),
    total: 0,
  }
  usage.total = usage.companyDefaults + usage.employees + usage.requesters
    + usage.demands + usage.budgets + usage.approvalAuthorities
  return {
    id: row.id,
    projectionId: row.projection_id,
    planId: row.plan_id,
    parentId: row.parent_id,
    code: String(row.code),
    name: row.name,
    description: row.description,
    hierarchyLevel: hierarchyLevel(row.hierarchy_level),
    scopeType: row.scope_type,
    companyIds: uniqueStrings(row.company_ids || []),
    managerUserId: row.manager_user_id,
    isActive: Boolean(row.is_active),
    version: numberValue(row.version),
    metadata: metadataRecord(row.metadata),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    usage,
  }
}

function mapCompany(row: CompanyRow): CostCenterPlanCompany {
  return {
    id: row.id,
    name: row.trade_name || row.legal_name,
    groupId: row.group_id,
    status: row.status,
    isDefault: Boolean(row.is_default),
    assignmentActive: Boolean(row.assignment_active),
  }
}

function summaryFromRow(row: DefinitionRow): CostCenterSummary {
  return {
    total: numberValue(row.total_count),
    active: numberValue(row.active_count),
    inactive: numberValue(row.inactive_count),
    withUsage: numberValue(row.with_usage_count),
    byLevel: {
      macro: numberValue(row.level_1_count),
      intermediate: numberValue(row.level_2_count),
      micro: numberValue(row.level_3_count),
    },
  }
}

function assertVersion(entity: string, expected: number, current: string | number): void {
  const normalized = numberValue(current)
  if (expected !== normalized) throw staleVersion(entity, expected, normalized)
}

function staleVersion(entity: string, expected: number, current: number): CostCenterServiceError {
  return new CostCenterServiceError(
    'COST_CENTER_STALE_VERSION',
    `O ${entity} foi alterado por outro usuario. Atualize antes de salvar.`,
    409,
    { expectedVersion: expected, currentVersion: current },
  )
}

function notFound(entity: string): CostCenterServiceError {
  return new CostCenterServiceError('COST_CENTER_NOT_FOUND', `${entity} nao encontrado.`, 404)
}

function translateDatabaseError(error: unknown, entity: 'plano' | 'centro'): Error {
  if (error instanceof CostCenterServiceError) return error
  if (!error || typeof error !== 'object') return error instanceof Error ? error : new Error(String(error))
  const databaseError = error as { code?: string; message?: string; constraint?: string }
  if (databaseError.code === '23505') {
    const plan = entity === 'plano'
    return new CostCenterServiceError(
      plan ? 'COST_CENTER_PLAN_DUPLICATE' : 'COST_CENTER_CODE_DUPLICATE',
      plan
        ? 'Ja existe um plano com este codigo no mesmo escopo.'
        : 'Ja existe um centro com este codigo no plano.',
      409,
    )
  }
  if (databaseError.code === '23503') {
    return new CostCenterServiceError(
      'COST_CENTER_REFERENCE_CONFLICT',
      'A operacao conflita com um vinculo existente.',
      409,
    )
  }
  if (databaseError.code === '23514' || databaseError.code === 'P0001') {
    return new CostCenterServiceError(
      'COST_CENTER_CONSTRAINT_VIOLATION',
      databaseConstraintMessage(databaseError.message),
      422,
    )
  }
  return error as Error
}

function databaseConstraintMessage(message?: string): string {
  if (!message) return 'Os dados violam uma regra do cadastro de centros de custo.'
  const known = [
    'A hierarquia de centros de custo aceita no maximo tres niveis.',
    'A hierarquia de centros de custo nao pode conter ciclos.',
    'Centro restrito exige ao menos uma empresa selecionada.',
    'Centro global nao pode manter empresas selecionadas.',
    'Centro global nao aceita empresas explicitas.',
    'Empresa e plano compartilhado pertencem a grupos diferentes.',
    'Plano exclusivo somente pode ser atribuido a empresa proprietaria.',
    'Definicao ativa exige plano ativo.',
    'Centro de custo ativo exige pai ativo.',
  ]
  return known.find((candidate) => message.includes(candidate))
    || 'Os dados violam uma regra do cadastro de centros de custo.'
}

function hierarchyLevel(value: string | number): 1 | 2 | 3 {
  const level = numberValue(value)
  if (level === 2 || level === 3) return level
  return 1
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function numberValue(value: string | number | null | undefined): number {
  const normalized = Number(value || 0)
  return Number.isFinite(normalized) ? normalized : 0
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
