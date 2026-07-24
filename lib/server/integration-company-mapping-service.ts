import 'server-only'

import {
  normalizeExternalCompanyName,
  TECH_EMISSION_CLIENT_PROVIDER,
} from '@/lib/integrations/company-mapping'
import { getTechConfig, TECH_PROVIDER_ID } from '@/lib/integrations/tech/tech-config'
import {
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { writeAuditEvent } from '@/lib/server/audit-log'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes } from '@/types'

interface IntegrationMappingRow {
  id: string
  company_id: string
  provider_company_id: string
  original_name: string | null
}

export interface TechEmissionCompanyMapping {
  id: string
  companyId: string
  normalizedExternalName: string
  externalName: string
}

export interface TechProviderCompanyMapping {
  id: string
  companyId: string
  providerCompanyId: string
  status: 'active' | 'inactive'
  updatedAt: string
}

interface TechProviderMappingRow {
  id: string
  company_id: string
  provider_company_id: string
  status: 'active' | 'inactive'
  updated_at: string | Date
}

export class IntegrationCompanyMappingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'IntegrationCompanyMappingError'
  }
}

export async function listTechEmissionCompanyMappings(
  principal: RequestPrincipal,
): Promise<TechEmissionCompanyMapping[]> {
  const companyIds = companiesAllowedForEmissionImport(principal)
  if (!companyIds.length) return []

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<IntegrationMappingRow>(
      `select id, company_id, provider_company_id,
              nullif(metadata->>'originalName', '') as original_name
       from integration_company_mappings
       where tenant_id = $1
         and provider = $2
         and mapping_type = 'external_alias'
         and status = 'active'
         and company_id = any($3::text[])
       order by provider_company_id, id`,
      [principal.tenantId, TECH_EMISSION_CLIENT_PROVIDER, companyIds],
    )
    return result.rows.map(mapTechEmissionCompanyMapping)
  })
}

export async function upsertTechEmissionCompanyMapping(
  principal: RequestPrincipal,
  input: { externalName: string; companyId: string },
): Promise<TechEmissionCompanyMapping> {
  const normalizedExternalName = normalizedOrThrow(input.externalName)
  await requireImportAccess(principal, input.companyId)

  const mapping = await withTenantTransaction(principal.tenantId, async (client) => {
    const existing = await client.query<{ company_id: string }>(
      `select company_id
       from integration_company_mappings
       where tenant_id = $1 and provider = $2 and provider_company_id = $3
       for update`,
      [principal.tenantId, TECH_EMISSION_CLIENT_PROVIDER, normalizedExternalName],
    )
    const previousCompanyId = existing.rows[0]?.company_id
    if (previousCompanyId && previousCompanyId !== input.companyId) {
      await requireImportAccess(principal, previousCompanyId)
    }

    const result = await client.query<IntegrationMappingRow>(
      `insert into integration_company_mappings (
         tenant_id, company_id, provider, provider_company_id, mapping_type,
         status, metadata, created_by, updated_by
       ) values ($1, $2, $3, $4, 'external_alias', 'active', $5::jsonb, $6, $6)
       on conflict (tenant_id, provider, provider_company_id) do update set
         company_id = excluded.company_id,
         mapping_type = 'external_alias',
         status = 'active',
         metadata = excluded.metadata,
         updated_by = excluded.updated_by,
         updated_at = now()
       returning id, company_id, provider_company_id,
                 nullif(metadata->>'originalName', '') as original_name`,
      [
        principal.tenantId,
        input.companyId,
        TECH_EMISSION_CLIENT_PROVIDER,
        normalizedExternalName,
        JSON.stringify({
          originalName: input.externalName.trim().slice(0, 240),
          source: 'tech_emissions_import',
        }),
        principal.user.id,
      ],
    )
    return mapTechEmissionCompanyMapping(result.rows[0])
  })

  await writeAuditEvent({
    action: 'integration.company_mapping.upsert',
    result: 'success',
    entityType: 'integration_company_mapping',
    entityId: mapping.id,
    metadata: {
      provider: TECH_EMISSION_CLIENT_PROVIDER,
      companyId: mapping.companyId,
      normalizedExternalName: mapping.normalizedExternalName,
    },
  })
  return mapping
}

export async function deleteTechEmissionCompanyMapping(
  principal: RequestPrincipal,
  externalName: string,
): Promise<boolean> {
  const normalizedExternalName = normalizedOrThrow(externalName)
  const deleted = await withTenantTransaction(principal.tenantId, async (client) => {
    const existing = await client.query<{ id: string; company_id: string }>(
      `select id, company_id
       from integration_company_mappings
       where tenant_id = $1 and provider = $2 and provider_company_id = $3
       for update`,
      [principal.tenantId, TECH_EMISSION_CLIENT_PROVIDER, normalizedExternalName],
    )
    const mapping = existing.rows[0]
    if (!mapping) return null
    await requireImportAccess(principal, mapping.company_id)
    await client.query(
      'delete from integration_company_mappings where tenant_id = $1 and id = $2',
      [principal.tenantId, mapping.id],
    )
    return mapping
  })

  if (!deleted) return false
  await writeAuditEvent({
    action: 'integration.company_mapping.delete',
    result: 'success',
    entityType: 'integration_company_mapping',
    entityId: deleted.id,
    metadata: {
      provider: TECH_EMISSION_CLIENT_PROVIDER,
      companyId: deleted.company_id,
      normalizedExternalName,
    },
  })
  return true
}

export async function listTechProviderCompanyMappings(
  principal: RequestPrincipal,
): Promise<TechProviderCompanyMapping[]> {
  const companyIds = companiesAllowedForPermission(principal, 'gerenciar_integracoes')
  if (!companyIds.length) return []

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TechProviderMappingRow>(
      `select id, company_id, provider_company_id, status, updated_at
       from integration_company_mappings
       where tenant_id = $1
         and provider = $2
         and mapping_type = 'provider_company'
         and company_id = any($3::text[])
       order by company_id, updated_at desc`,
      [principal.tenantId, TECH_PROVIDER_ID, companyIds],
    )
    return result.rows.map(mapTechProviderCompanyMapping)
  })
}

export async function upsertTechProviderCompanyMapping(
  principal: RequestPrincipal,
  input: { companyId: string; providerCompanyId: string },
): Promise<TechProviderCompanyMapping> {
  const companyId = input.companyId.trim()
  const providerCompanyId = normalizeProviderCompanyId(input.providerCompanyId)
  await requireCompanyAccess(principal, companyId, 'gerenciar_integracoes')

  const mapping = await withTenantTransaction(principal.tenantId, async (client) => {
    const rows = await client.query<TechProviderMappingRow>(
      `select id, company_id, provider_company_id, status, updated_at
       from integration_company_mappings
       where tenant_id = $1
         and provider = $2
         and mapping_type = 'provider_company'
         and (company_id = $3 or provider_company_id = $4)
       for update`,
      [principal.tenantId, TECH_PROVIDER_ID, companyId, providerCompanyId],
    )
    const occupied = rows.rows.find((row) => (
      row.provider_company_id === providerCompanyId && row.company_id !== companyId
    ))
    if (occupied) {
      await requireCompanyAccess(principal, occupied.company_id, 'gerenciar_integracoes')
      throw new IntegrationCompanyMappingError(
        'TECH_PROVIDER_COMPANY_ALREADY_MAPPED',
        'Este identificador da Tech Travel ja esta vinculado a outra empresa.',
        409,
        { companyId: occupied.company_id },
      )
    }

    const existing = rows.rows.find((row) => row.company_id === companyId)
    const result = existing
      ? await client.query<TechProviderMappingRow>(
          `update integration_company_mappings set
             provider_company_id = $4,
             mapping_type = 'provider_company',
             status = 'active',
             metadata = jsonb_build_object('source', 'tech_company_mapping_admin'),
             updated_by = $5,
             updated_at = now()
           where tenant_id = $1 and provider = $2 and id = $3
           returning id, company_id, provider_company_id, status, updated_at`,
          [principal.tenantId, TECH_PROVIDER_ID, existing.id, providerCompanyId, principal.user.id],
        )
      : await client.query<TechProviderMappingRow>(
          `insert into integration_company_mappings (
             tenant_id, company_id, provider, provider_company_id, mapping_type,
             status, metadata, created_by, updated_by
           ) values ($1, $2, $3, $4, 'provider_company', 'active', $5::jsonb, $6, $6)
           returning id, company_id, provider_company_id, status, updated_at`,
          [
            principal.tenantId,
            companyId,
            TECH_PROVIDER_ID,
            providerCompanyId,
            JSON.stringify({ source: 'tech_company_mapping_admin' }),
            principal.user.id,
          ],
        )
    return mapTechProviderCompanyMapping(result.rows[0])
  })

  await writeAuditEvent({
    action: 'integration.tech_company_mapping.upsert',
    result: 'success',
    entityType: 'integration_company_mapping',
    entityId: mapping.id,
    metadata: {
      companyId: mapping.companyId,
      provider: TECH_PROVIDER_ID,
      providerCompanyId: mapping.providerCompanyId,
    },
  })
  return mapping
}

export async function deactivateTechProviderCompanyMapping(
  principal: RequestPrincipal,
  companyIdInput: string,
): Promise<boolean> {
  const companyId = companyIdInput.trim()
  await requireCompanyAccess(principal, companyId, 'gerenciar_integracoes')

  const mapping = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TechProviderMappingRow>(
      `update integration_company_mappings set
         status = 'inactive',
         updated_by = $4,
         updated_at = now()
       where tenant_id = $1
         and provider = $2
         and company_id = $3
         and mapping_type = 'provider_company'
         and status = 'active'
       returning id, company_id, provider_company_id, status, updated_at`,
      [principal.tenantId, TECH_PROVIDER_ID, companyId, principal.user.id],
    )
    return result.rows[0] ? mapTechProviderCompanyMapping(result.rows[0]) : null
  })

  if (!mapping) return false
  await writeAuditEvent({
    action: 'integration.tech_company_mapping.deactivate',
    result: 'success',
    entityType: 'integration_company_mapping',
    entityId: mapping.id,
    metadata: {
      companyId: mapping.companyId,
      provider: TECH_PROVIDER_ID,
      providerCompanyId: mapping.providerCompanyId,
    },
  })
  return true
}

export async function resolveAuthorizedTechProviderCompany(
  principal: RequestPrincipal,
  requestedCompanyId: string | null | undefined,
  permission: keyof Permissoes,
): Promise<{ companyId: string; providerCompanyId: string | null }> {
  const companyId = selectAuthorizedCompanyForIntegration(
    principal,
    requestedCompanyId,
    permission,
  )
  await requireCompanyAccess(principal, companyId, permission)

  const providerCompanyId = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ provider_company_id: string }>(
      `select provider_company_id
       from integration_company_mappings
       where tenant_id = $1
         and company_id = $2
         and provider = $3
         and mapping_type = 'provider_company'
         and status = 'active'
       order by updated_at desc
       limit 1`,
      [principal.tenantId, companyId, TECH_PROVIDER_ID],
    )
    return result.rows[0]?.provider_company_id || getTechConfig().defaultCompanyId
  })

  return { companyId, providerCompanyId }
}

export function selectAuthorizedCompanyForIntegration(
  principal: RequestPrincipal,
  requestedCompanyId: string | null | undefined,
  permission: keyof Permissoes,
): string {
  const allowed = companiesAllowedForPermission(principal, permission)
  const requested = requestedCompanyId?.trim()
  if (requested) {
    if (!allowed.includes(requested)) {
      throw new IntegrationCompanyMappingError(
        'TECH_COMPANY_ACCESS_DENIED',
        'Empresa fora do escopo autorizado para esta operacao.',
        403,
      )
    }
    return requested
  }
  if (allowed.length === 1) return allowed[0]
  if (!allowed.length) {
    throw new IntegrationCompanyMappingError(
      'TECH_COMPANY_ACCESS_DENIED',
      'Nenhuma empresa autorizada para esta operacao.',
      403,
    )
  }
  throw new IntegrationCompanyMappingError(
    'TECH_COMPANY_REQUIRED',
    'Selecione a empresa antes de consultar a integracao.',
    400,
  )
}

function companiesAllowedForEmissionImport(principal: RequestPrincipal): string[] {
  if (principal.corporateAccess) {
    return principal.corporateAccess.companies
      .filter((company) => (
        company.permissions.importar_planilhas
        && company.permissions.criar_demandas
      ))
      .map((company) => company.companyId)
  }
  if (!principal.user.permissoes?.importar_planilhas || !principal.user.permissoes?.criar_demandas) {
    return []
  }
  return [...new Set(principal.user.empresa_ids || [])]
}

function companiesAllowedForPermission(
  principal: RequestPrincipal,
  permission: keyof Permissoes,
): string[] {
  if (principal.corporateAccess) {
    return principal.corporateAccess.companies
      .filter((company) => company.permissions[permission])
      .map((company) => company.companyId)
  }
  if (!principal.user.permissoes?.[permission]) return []
  return [...new Set(principal.user.empresa_ids || [])]
}

async function requireImportAccess(
  principal: RequestPrincipal,
  companyId: string,
): Promise<void> {
  await requireCompanyAccess(principal, companyId, 'importar_planilhas')
  await requireCompanyAccess(principal, companyId, 'criar_demandas')
}

function normalizedOrThrow(value: string): string {
  const normalized = normalizeExternalCompanyName(value)
  if (!normalized) {
    throw new IntegrationCompanyMappingError(
      'INVALID_EXTERNAL_COMPANY_NAME',
      'Nome externo da empresa invalido.',
      400,
    )
  }
  return normalized
}

function mapTechEmissionCompanyMapping(row: IntegrationMappingRow): TechEmissionCompanyMapping {
  return {
    id: row.id,
    companyId: row.company_id,
    normalizedExternalName: row.provider_company_id,
    externalName: row.original_name || row.provider_company_id,
  }
}

function mapTechProviderCompanyMapping(row: TechProviderMappingRow): TechProviderCompanyMapping {
  return {
    id: row.id,
    companyId: row.company_id,
    providerCompanyId: row.provider_company_id,
    status: row.status,
    updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
  }
}

function normalizeProviderCompanyId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new IntegrationCompanyMappingError(
      'INVALID_TECH_PROVIDER_COMPANY_ID',
      'Identificador da empresa na Tech Travel invalido.',
      400,
    )
  }
  return normalized
}
