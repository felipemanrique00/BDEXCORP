import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  emptyVoucherPresentationDeclared,
  mergeVoucherPresentationDeclared,
  resolveVoucherPresentationSettings,
  voucherPresentationPatchSchema,
  voucherPresentationScopeIdSchema,
  voucherPresentationScopeTypeSchema,
  type VoucherPresentationConfiguration,
  type VoucherPresentationDeclared,
  type VoucherPresentationPatch,
  type VoucherPresentationScopeType,
} from '@/lib/vouchers/presentation'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes, VoucherEmitido, VoucherPresentationSettings } from '@/types'

interface VoucherPresentationRow extends QueryResultRow {
  id: string
  scope_type: VoucherPresentationScopeType
  business_group_id: string | null
  company_id: string | null
  show_confirmed_values: boolean | null
  show_cancellation_terms: boolean | null
  show_administrative_data: boolean | null
  version: string | number
  updated_at: Date | string
}

interface CompanyPresentationRow extends QueryResultRow {
  company_id: string
  group_id: string | null
  company_show_confirmed_values: boolean | null
  company_show_cancellation_terms: boolean | null
  company_show_administrative_data: boolean | null
  group_show_confirmed_values: boolean | null
  group_show_cancellation_terms: boolean | null
  group_show_administrative_data: boolean | null
}

interface ScopeResult {
  configuration: VoucherPresentationConfiguration
  beforeDeclared?: VoucherPresentationDeclared
}

export class VoucherPresentationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'VoucherPresentationServiceError'
  }
}

export async function getVoucherPresentationConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
): Promise<VoucherPresentationConfiguration> {
  const scopeType = voucherPresentationScopeTypeSchema.parse(rawScopeType)
  const scopeId = voucherPresentationScopeIdSchema.parse(rawScopeId)

  return withTenantTransaction(principal.tenantId, async (client) => {
    await authorizePresentationScope(client, principal, scopeType, scopeId, 'ver_vouchers')
    return buildConfiguration(client, principal.tenantId, scopeType, scopeId)
  })
}

export async function patchVoucherPresentationConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
  rawPatch: unknown,
): Promise<VoucherPresentationConfiguration> {
  const scopeType = voucherPresentationScopeTypeSchema.parse(rawScopeType)
  const scopeId = voucherPresentationScopeIdSchema.parse(rawScopeId)
  const patch = voucherPresentationPatchSchema.parse(rawPatch)

  let result: ScopeResult
  try {
    result = await withTenantTransaction(principal.tenantId, async (client) => {
      await authorizePresentationScope(
        client,
        principal,
        scopeType,
        scopeId,
        'alterar_configuracoes',
      )
      const current = await loadSetting(client, principal.tenantId, scopeType, scopeId, true)
      assertExpectedVersion(current, patch)
      const beforeDeclared = declaredFromRow(current)
      const nextDeclared = mergeVoucherPresentationDeclared(beforeDeclared, patch.values)
      await persistSetting(
        client,
        principal,
        scopeType,
        scopeId,
        current,
        nextDeclared,
      )
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
    if (isUniqueViolation(error)) {
      throw new VoucherPresentationServiceError(
        'VOUCHER_PRESENTATION_VERSION_CONFLICT',
        'A configuracao foi alterada por outra pessoa. Recarregue antes de salvar.',
        409,
      )
    }
    throw error
  }

  await writeAuditEvent({
    action: 'voucher.presentation_settings.update',
    result: 'success',
    entityType: 'voucher_presentation_settings',
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

export async function resolveVoucherPresentationSettingsForCompanies(
  client: PoolClient,
  tenantId: string,
  companyIds: readonly string[],
): Promise<Map<string, VoucherPresentationSettings>> {
  const normalizedIds = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))]
  if (!normalizedIds.length) return new Map()

  const result = await client.query<CompanyPresentationRow>(
    `select
       company.id as company_id,
       company.group_id,
       company_setting.show_confirmed_values as company_show_confirmed_values,
       company_setting.show_cancellation_terms as company_show_cancellation_terms,
       company_setting.show_administrative_data as company_show_administrative_data,
       group_setting.show_confirmed_values as group_show_confirmed_values,
       group_setting.show_cancellation_terms as group_show_cancellation_terms,
       group_setting.show_administrative_data as group_show_administrative_data
     from companies company
     left join voucher_presentation_settings company_setting
       on company_setting.tenant_id = company.tenant_id
      and company_setting.scope_type = 'company'
      and company_setting.company_id = company.id
     left join voucher_presentation_settings group_setting
       on group_setting.tenant_id = company.tenant_id
      and group_setting.scope_type = 'group'
      and group_setting.business_group_id = company.group_id
     where company.tenant_id = $1
       and company.id = any($2::text[])`,
    [tenantId, normalizedIds],
  )

  return new Map(result.rows.map((row) => [
    row.company_id,
    resolveVoucherPresentationSettings({
      company: {
        showConfirmedValues: row.company_show_confirmed_values,
        showCancellationTerms: row.company_show_cancellation_terms,
        showAdministrativeData: row.company_show_administrative_data,
      },
      group: {
        showConfirmedValues: row.group_show_confirmed_values,
        showCancellationTerms: row.group_show_cancellation_terms,
        showAdministrativeData: row.group_show_administrative_data,
      },
      groupId: row.group_id,
    }),
  ]))
}

export async function attachVoucherPresentationSettings(
  client: PoolClient,
  tenantId: string,
  vouchers: readonly VoucherEmitido[],
): Promise<VoucherEmitido[]> {
  if (!vouchers.length) return []
  const byCompany = await resolveVoucherPresentationSettingsForCompanies(
    client,
    tenantId,
    vouchers.map((voucher) => voucher.empresa_id),
  )
  const systemDefault = resolveVoucherPresentationSettings({})
  return vouchers.map((voucher) => ({
    ...voucher,
    presentation_settings: byCompany.get(voucher.empresa_id) || systemDefault,
  }))
}

export function hasFullGroupCompanyPermission(
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

async function authorizePresentationScope(
  client: PoolClient,
  principal: RequestPrincipal,
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
  permission: 'ver_vouchers' | 'alterar_configuracoes',
): Promise<void> {
  if (scopeType === 'company') {
    const target = await client.query(
      `select 1
       from companies
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [principal.tenantId, scopeId],
    )
    if (!target.rowCount) {
      throw new VoucherPresentationServiceError(
        'VOUCHER_PRESENTATION_COMPANY_NOT_FOUND',
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
    throw new VoucherPresentationServiceError(
      'VOUCHER_PRESENTATION_GROUP_NOT_FOUND',
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
  if (!hasFullGroupCompanyPermission(principal, activeCompanyIds, permission)) {
    throw new VoucherPresentationServiceError(
      'VOUCHER_PRESENTATION_GROUP_ACCESS_DENIED',
      'A configuracao do grupo exige permissao em todas as empresas ativas vinculadas.',
      403,
      { groupId: scopeId, requiredCompanyIds: activeCompanyIds },
    )
  }
}

async function buildConfiguration(
  client: PoolClient,
  tenantId: string,
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
): Promise<VoucherPresentationConfiguration> {
  const row = await loadSetting(client, tenantId, scopeType, scopeId, false)
  const declared = declaredFromRow(row)
  let effective: VoucherPresentationSettings

  if (scopeType === 'company') {
    const resolved = await resolveVoucherPresentationSettingsForCompanies(client, tenantId, [scopeId])
    effective = resolved.get(scopeId) || resolveVoucherPresentationSettings({})
  } else {
    effective = resolveVoucherPresentationSettings({ group: declared, groupId: scopeId })
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
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
  forUpdate: boolean,
): Promise<VoucherPresentationRow | null> {
  const targetColumn = scopeType === 'company' ? 'company_id' : 'business_group_id'
  const result = await client.query<VoucherPresentationRow>(
    `select *
     from voucher_presentation_settings
     where tenant_id = $1 and scope_type = $2 and ${targetColumn} = $3
     ${forUpdate ? 'for update' : ''}`,
    [tenantId, scopeType, scopeId],
  )
  return result.rows[0] || null
}

async function persistSetting(
  client: PoolClient,
  principal: RequestPrincipal,
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
  current: VoucherPresentationRow | null,
  declared: VoucherPresentationDeclared,
): Promise<void> {
  if (current) {
    const result = await client.query(
      `update voucher_presentation_settings
       set show_confirmed_values = $3,
           show_cancellation_terms = $4,
           show_administrative_data = $5,
           updated_by = $6,
           version = version + 1
       where tenant_id = $1 and id = $2 and version = $7`,
      [
        principal.tenantId,
        current.id,
        declared.showConfirmedValues,
        declared.showCancellationTerms,
        declared.showAdministrativeData,
        principal.user.id,
        Number(current.version),
      ],
    )
    if (result.rowCount !== 1) throw versionConflict()
    return
  }

  await client.query(
    `insert into voucher_presentation_settings (
       tenant_id, scope_type, business_group_id, company_id,
       show_confirmed_values, show_cancellation_terms, show_administrative_data,
       created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      principal.tenantId,
      scopeType,
      scopeType === 'group' ? scopeId : null,
      scopeType === 'company' ? scopeId : null,
      declared.showConfirmedValues,
      declared.showCancellationTerms,
      declared.showAdministrativeData,
      principal.user.id,
    ],
  )
}

function assertExpectedVersion(
  current: VoucherPresentationRow | null,
  patch: VoucherPresentationPatch,
): void {
  if (patch.expectedVersion === undefined) return
  if (patch.expectedVersion === null) {
    if (current) throw versionConflict()
    return
  }
  if (!current || Number(current.version) !== patch.expectedVersion) throw versionConflict()
}

function declaredFromRow(row: VoucherPresentationRow | null): VoucherPresentationDeclared {
  if (!row) return emptyVoucherPresentationDeclared()
  return {
    showConfirmedValues: row.show_confirmed_values,
    showCancellationTerms: row.show_cancellation_terms,
    showAdministrativeData: row.show_administrative_data,
  }
}

function versionConflict(): VoucherPresentationServiceError {
  return new VoucherPresentationServiceError(
    'VOUCHER_PRESENTATION_VERSION_CONFLICT',
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
