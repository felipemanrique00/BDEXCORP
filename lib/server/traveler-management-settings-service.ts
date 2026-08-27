import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  emptyTravelerManagementDeclared,
  mergeTravelerManagementDeclared,
  resolveTravelerManagementSettings,
  travelerManagementPatchSchema,
  travelerManagementScopeIdSchema,
  travelerManagementScopeTypeSchema,
  type TravelerManagementConfiguration,
  type TravelerManagementDeclared,
  type TravelerManagementPatch,
  type TravelerManagementScopeType,
  type TravelerManagementSettings,
} from '@/lib/travelers/management-settings'
import type { Permissoes } from '@/types'

interface TravelerManagementRow extends QueryResultRow {
  id: string
  scope_type: TravelerManagementScopeType
  business_group_id: string | null
  company_id: string | null
  allow_requester_traveler_management: boolean | null
  version: string | number
  updated_at: Date | string
}

interface CompanyManagementRow extends QueryResultRow {
  company_id: string
  group_id: string | null
  company_allow_requester_traveler_management: boolean | null
  group_allow_requester_traveler_management: boolean | null
}

interface ScopeResult {
  configuration: TravelerManagementConfiguration
  beforeDeclared?: TravelerManagementDeclared
}

export class TravelerManagementSettingsServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'TravelerManagementSettingsServiceError'
  }
}

export async function getTravelerManagementConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
): Promise<TravelerManagementConfiguration> {
  const scopeType = travelerManagementScopeTypeSchema.parse(rawScopeType)
  const scopeId = travelerManagementScopeIdSchema.parse(rawScopeId)

  return withTenantTransaction(principal.tenantId, async (client) => {
    await authorizeManagementScope(client, principal, scopeType, scopeId, 'ver_funcionarios')
    return buildConfiguration(client, principal.tenantId, scopeType, scopeId)
  })
}

export async function patchTravelerManagementConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
  rawPatch: unknown,
): Promise<TravelerManagementConfiguration> {
  const scopeType = travelerManagementScopeTypeSchema.parse(rawScopeType)
  const scopeId = travelerManagementScopeIdSchema.parse(rawScopeId)
  const patch = travelerManagementPatchSchema.parse(rawPatch)

  let result: ScopeResult
  try {
    result = await withTenantTransaction(principal.tenantId, async (client) => {
      await authorizeManagementScope(
        client,
        principal,
        scopeType,
        scopeId,
        'alterar_configuracoes',
      )
      const current = await loadSetting(client, principal.tenantId, scopeType, scopeId, true)
      assertExpectedVersion(current, patch)
      const beforeDeclared = declaredFromRow(current)
      const nextDeclared = mergeTravelerManagementDeclared(beforeDeclared, patch.values)
      await persistSetting(client, principal, scopeType, scopeId, current, nextDeclared)
      return {
        configuration: await buildConfiguration(
          client,
          principal.tenantId,
          scopeType,
          scopeId,
        ),
        beforeDeclared,
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw versionConflict()
    throw error
  }

  await writeAuditEvent({
    action: 'traveler.management_settings.update',
    result: 'success',
    entityType: 'traveler_management_settings',
    entityId: `${scopeType}:${scopeId}`,
    metadata: {
      scopeType,
      scopeId,
      before: result.beforeDeclared,
      after: result.configuration.declared,
      effective: result.configuration.effective,
      version: result.configuration.version,
    },
  })
  return result.configuration
}

export async function resolveTravelerManagementSettingsForCompanies(
  client: PoolClient,
  tenantId: string,
  companyIds: readonly string[],
): Promise<Map<string, TravelerManagementSettings>> {
  const normalizedIds = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))]
  if (!normalizedIds.length) return new Map()

  const result = await client.query<CompanyManagementRow>(
    `select
       company.id as company_id,
       company.group_id,
       company_setting.allow_requester_traveler_management
         as company_allow_requester_traveler_management,
       group_setting.allow_requester_traveler_management
         as group_allow_requester_traveler_management
     from companies company
     left join traveler_management_settings company_setting
       on company_setting.tenant_id = company.tenant_id
      and company_setting.scope_type = 'company'
      and company_setting.company_id = company.id
     left join traveler_management_settings group_setting
       on group_setting.tenant_id = company.tenant_id
      and group_setting.scope_type = 'group'
      and group_setting.business_group_id = company.group_id
     where company.tenant_id = $1
       and company.id = any($2::text[])`,
    [tenantId, normalizedIds],
  )

  return new Map(result.rows.map((row) => [
    row.company_id,
    resolveTravelerManagementSettings({
      company: {
        allowRequesterTravelerManagement:
          row.company_allow_requester_traveler_management,
      },
      group: {
        allowRequesterTravelerManagement:
          row.group_allow_requester_traveler_management,
      },
      groupId: row.group_id,
    }),
  ]))
}

export function hasFullGroupTravelerManagementPermission(
  principal: RequestPrincipal,
  activeCompanyIds: readonly string[],
  permission: keyof Permissoes,
): boolean {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return true
  if (!activeCompanyIds.length) return false
  const accessByCompany = new Map(
    (principal.corporateAccess?.companies || []).map((company) => [company.companyId, company]),
  )
  return activeCompanyIds.every((companyId) => (
    accessByCompany.get(companyId)?.permissions[permission] === true
  ))
}

async function authorizeManagementScope(
  client: PoolClient,
  principal: RequestPrincipal,
  scopeType: TravelerManagementScopeType,
  scopeId: string,
  permission: 'ver_funcionarios' | 'alterar_configuracoes',
): Promise<void> {
  if (scopeType === 'company') {
    const target = await client.query(
      `select 1
       from companies
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [principal.tenantId, scopeId],
    )
    if (!target.rowCount) {
      throw new TravelerManagementSettingsServiceError(
        'TRAVELER_MANAGEMENT_COMPANY_NOT_FOUND',
        'Empresa nao encontrada.',
        404,
      )
    }
    await requireCompanyAccess(principal, scopeId, permission)
    return
  }

  const group = await client.query(
    `select 1
     from business_groups
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [principal.tenantId, scopeId],
  )
  if (!group.rowCount) {
    throw new TravelerManagementSettingsServiceError(
      'TRAVELER_MANAGEMENT_GROUP_NOT_FOUND',
      'Grupo empresarial nao encontrado.',
      404,
    )
  }
  const companies = await client.query<{ id: string }>(
    `select id
     from companies
     where tenant_id = $1
       and group_id = $2
       and status = 'active'
       and deleted_at is null
     order by id`,
    [principal.tenantId, scopeId],
  )
  const activeCompanyIds = companies.rows.map((company) => company.id)
  if (!hasFullGroupTravelerManagementPermission(principal, activeCompanyIds, permission)) {
    throw new TravelerManagementSettingsServiceError(
      'TRAVELER_MANAGEMENT_GROUP_ACCESS_DENIED',
      'A configuracao do grupo exige permissao em todas as empresas ativas vinculadas.',
      403,
      { groupId: scopeId, requiredCompanyIds: activeCompanyIds },
    )
  }
}

async function buildConfiguration(
  client: PoolClient,
  tenantId: string,
  scopeType: TravelerManagementScopeType,
  scopeId: string,
): Promise<TravelerManagementConfiguration> {
  const row = await loadSetting(client, tenantId, scopeType, scopeId, false)
  const declared = declaredFromRow(row)
  let effective: TravelerManagementSettings

  if (scopeType === 'company') {
    const resolved = await resolveTravelerManagementSettingsForCompanies(client, tenantId, [scopeId])
    effective = resolved.get(scopeId) || resolveTravelerManagementSettings({})
  } else {
    effective = resolveTravelerManagementSettings({ group: declared, groupId: scopeId })
  }

  return {
    scopeType,
    scopeId,
    declared,
    effective,
    version: row ? Number(row.version) : null,
    updatedAt: row ? toIso(row.updated_at) : null,
  }
}

async function loadSetting(
  client: PoolClient,
  tenantId: string,
  scopeType: TravelerManagementScopeType,
  scopeId: string,
  forUpdate: boolean,
): Promise<TravelerManagementRow | null> {
  const targetColumn = scopeType === 'company' ? 'company_id' : 'business_group_id'
  const result = await client.query<TravelerManagementRow>(
    `select *
     from traveler_management_settings
     where tenant_id = $1 and scope_type = $2 and ${targetColumn} = $3
     ${forUpdate ? 'for update' : ''}`,
    [tenantId, scopeType, scopeId],
  )
  return result.rows[0] || null
}

async function persistSetting(
  client: PoolClient,
  principal: RequestPrincipal,
  scopeType: TravelerManagementScopeType,
  scopeId: string,
  current: TravelerManagementRow | null,
  declared: TravelerManagementDeclared,
): Promise<void> {
  if (current) {
    const result = await client.query(
      `update traveler_management_settings
       set allow_requester_traveler_management = $3,
           updated_by = $4,
           version = version + 1
       where tenant_id = $1 and id = $2 and version = $5`,
      [
        principal.tenantId,
        current.id,
        declared.allowRequesterTravelerManagement,
        principal.user.id,
        Number(current.version),
      ],
    )
    if (result.rowCount !== 1) throw versionConflict()
    return
  }

  await client.query(
    `insert into traveler_management_settings (
       tenant_id, scope_type, business_group_id, company_id,
       allow_requester_traveler_management, created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $6)`,
    [
      principal.tenantId,
      scopeType,
      scopeType === 'group' ? scopeId : null,
      scopeType === 'company' ? scopeId : null,
      declared.allowRequesterTravelerManagement,
      principal.user.id,
    ],
  )
}

function assertExpectedVersion(
  current: TravelerManagementRow | null,
  patch: TravelerManagementPatch,
): void {
  if (patch.expectedVersion === null) {
    if (current) throw versionConflict()
    return
  }
  if (!current || Number(current.version) !== patch.expectedVersion) throw versionConflict()
}

function declaredFromRow(row: TravelerManagementRow | null): TravelerManagementDeclared {
  if (!row) return emptyTravelerManagementDeclared()
  return {
    allowRequesterTravelerManagement: row.allow_requester_traveler_management,
  }
}

function versionConflict(): TravelerManagementSettingsServiceError {
  return new TravelerManagementSettingsServiceError(
    'TRAVELER_MANAGEMENT_VERSION_CONFLICT',
    'A configuracao foi alterada por outra pessoa. Recarregue antes de salvar.',
    409,
  )
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
