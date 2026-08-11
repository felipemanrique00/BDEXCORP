import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

import type { PoolClient, QueryResultRow } from 'pg'
import sharp from 'sharp'
import { z } from 'zod'

import {
  corporateBrandingPatchSchema,
  corporateBrandingScopeIdSchema,
  corporateBrandingScopeTypeSchema,
  effectiveBrandingQuerySchema,
  emptyCorporateBrandingDeclared,
  mergeCorporateBrandingDeclared,
  resolveEffectiveCorporateBranding,
  type CorporateBrandingConfiguration,
  type CorporateBrandingDeclared,
  type CorporateBrandingPatch,
  type CorporateBrandingScopeType,
  type EffectiveCorporateBranding,
} from '@/lib/corporate-branding'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  CorporateAccessDeniedError,
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { CorporateBrandingServiceError } from '@/lib/server/corporate-branding-error'
import { withTenantTransaction } from '@/lib/server/database'
import { getServerEnvironment } from '@/lib/server/environment'
import { readStoredFile } from '@/lib/server/file-storage'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  BRANDING_IMAGE_MAX_BYTES,
  BRANDING_IMAGE_MAX_PIXELS,
  BrandingImageValidationError,
  validateBrandingImageEnvelope,
} from '@/lib/security/branding-image'
import type { Permissoes } from '@/types'

const BRANDING_LOGO_MAX_BYTES = BRANDING_IMAGE_MAX_BYTES
const BRANDING_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

interface BrandingSettingRow extends QueryResultRow {
  id: string
  scope_type: CorporateBrandingScopeType
  business_group_id: string | null
  company_id: string | null
  display_name: string | null
  logo_file_id: string | null
  active_logo_file_id: string | null
  logo_alt: string | null
  primary_color: string | null
  accent_color: string | null
  sidebar_color: string | null
  document_legal_name: string | null
  document_number: string | null
  version: string | number
  updated_at: string | Date
}

interface BrandingEntityRow extends QueryResultRow {
  id: string
  group_id: string | null
  display_name: string
  legal_name: string
  document_number: string | null
}

interface ScopeMutationResult {
  configuration: CorporateBrandingConfiguration
  beforeDeclared: CorporateBrandingDeclared
}

export async function getCorporateBrandingConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
): Promise<CorporateBrandingConfiguration> {
  const scopeType = corporateBrandingScopeTypeSchema.parse(rawScopeType)
  const scopeId = corporateBrandingScopeIdSchema.parse(rawScopeId)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const entity = await loadBrandingEntity(client, principal.tenantId, scopeType, scopeId)
    await authorizeManagementScope(client, principal, entity, 'alterar_configuracoes')
    return buildConfiguration(client, principal.tenantId, entity)
  })
}

export async function patchCorporateBrandingConfiguration(
  principal: RequestPrincipal,
  rawScopeType: unknown,
  rawScopeId: unknown,
  rawPatch: unknown,
): Promise<CorporateBrandingConfiguration> {
  const scopeType = corporateBrandingScopeTypeSchema.parse(rawScopeType)
  const scopeId = corporateBrandingScopeIdSchema.parse(rawScopeId)
  const patch = corporateBrandingPatchSchema.parse(rawPatch)

  let result: ScopeMutationResult
  try {
    result = await withTenantTransaction(principal.tenantId, async (client) => {
      const entity = await loadBrandingEntity(client, principal.tenantId, scopeType, scopeId)
      await authorizeManagementScope(client, principal, entity, 'alterar_configuracoes')
      const current = await loadSetting(client, principal.tenantId, scopeType, scopeId, true)
      assertExpectedVersion(current, patch)
      const beforeDeclared = declaredFromRow(current)
      const nextDeclared = mergeCorporateBrandingDeclared(beforeDeclared, patch.values)
      if (nextDeclared.logoFileId) {
        await assertValidBrandingLogo(
          client,
          principal.tenantId,
          scopeType,
          scopeId,
          nextDeclared.logoFileId,
        )
      }
      await persistSetting(client, principal, scopeType, scopeId, current, nextDeclared)
      return {
        configuration: await buildConfiguration(client, principal.tenantId, entity),
        beforeDeclared,
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw versionConflict()
    throw error
  }

  await writeAuditEvent({
    action: 'corporate_branding.settings.update',
    result: 'success',
    entityType: 'corporate_branding_settings',
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

export async function uploadCorporateBrandingLogo(args: {
  principal: RequestPrincipal
  rawScopeType: unknown
  rawScopeId: unknown
  bytes: Buffer
  originalName: string
  declaredMimeType?: string | null
  expectedVersion?: number | null
}): Promise<CorporateBrandingConfiguration> {
  const scopeType = corporateBrandingScopeTypeSchema.parse(args.rawScopeType)
  const scopeId = corporateBrandingScopeIdSchema.parse(args.rawScopeId)
  const expectedVersion = z.number().int().positive().nullable().optional().parse(args.expectedVersion)

  await withTenantTransaction(args.principal.tenantId, async (client) => {
    const entity = await loadBrandingEntity(client, args.principal.tenantId, scopeType, scopeId)
    await authorizeManagementScope(client, args.principal, entity, 'alterar_configuracoes')
  })

  const normalized = await normalizeBrandingLogo(
    args.bytes,
    args.originalName,
    args.declaredMimeType,
  )
  const fileId = randomUUID()
  const now = new Date()
  const storageKey = [
    args.principal.tenantId,
    'branding',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${fileId}.webp`,
  ].join('/')
  const outputPath = privateObjectPath(storageKey)
  let persisted = false
  let committed = false

  try {
    const configuration = await withTenantTransaction(args.principal.tenantId, async (client) => {
      const entity = await loadBrandingEntity(client, args.principal.tenantId, scopeType, scopeId)
      await authorizeManagementScope(client, args.principal, entity, 'alterar_configuracoes')
      const current = await loadSetting(client, args.principal.tenantId, scopeType, scopeId, true)
      assertExpectedVersion(current, { values: { logoFileId: fileId }, expectedVersion })

      await client.query(
        "select pg_advisory_xact_lock(hashtext('tenant-file-quota'), hashtext($1))",
        [args.principal.tenantId],
      )
      if (args.principal.limits.storageBytes) {
        const usage = await client.query<{ bytes: string }>(
          `select (
             coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0) +
             coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0)
           )::bigint as bytes`,
          [args.principal.tenantId],
        )
        if (Number(usage.rows[0]?.bytes || 0) + normalized.length > args.principal.limits.storageBytes) {
          throw new CorporateBrandingServiceError(
            'CORPORATE_BRANDING_STORAGE_QUOTA_EXCEEDED',
            'Limite de armazenamento do plano atingido.',
            409,
          )
        }
      }

      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
      await writeFile(outputPath, normalized, { flag: 'wx', mode: 0o600 })
      persisted = true
      await client.query(
        `insert into stored_files (
           id, tenant_id, uploaded_by, purpose, entity_type, entity_id,
           original_name, storage_key, mime_type, size_bytes, sha256, description
         ) values (
           $1, $2, $3, 'corporate_branding_logo', $4, $5,
           $6, $7, 'image/webp', $8, $9, 'Logomarca corporativa normalizada'
         )`,
        [
          fileId,
          args.principal.tenantId,
          args.principal.user.id,
          scopeType === 'group' ? 'business_group' : 'company',
          scopeId,
          safeBrandingOriginalName(args.originalName),
          storageKey,
          normalized.length,
          createHash('sha256').update(normalized).digest('hex'),
        ],
      )
      await client.query(
        `insert into corporate_branding_assets (
           tenant_id, file_id, scope_type, business_group_id, company_id, created_by
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          args.principal.tenantId,
          fileId,
          scopeType,
          scopeType === 'group' ? scopeId : null,
          scopeType === 'company' ? scopeId : null,
          args.principal.user.id,
        ],
      )
      const before = declaredFromRow(current)
      const next = mergeCorporateBrandingDeclared(before, { logoFileId: fileId })
      await persistSetting(client, args.principal, scopeType, scopeId, current, next)
      return buildConfiguration(client, args.principal.tenantId, entity)
    })
    committed = true

    await writeAuditEvent({
      action: 'corporate_branding.logo.upload',
      result: 'success',
      entityType: 'stored_file',
      entityId: fileId,
      metadata: {
        scopeType,
        scopeId,
        mimeType: 'image/webp',
        sizeBytes: normalized.length,
        version: configuration.version,
      },
    })
    return configuration
  } catch (error) {
    if (persisted && !committed) await rm(outputPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function getEffectiveCorporateBranding(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<EffectiveCorporateBranding> {
  const query = effectiveBrandingQuerySchema.parse(rawQuery)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const entity = await loadBrandingEntity(
      client,
      principal.tenantId,
      query.contextType,
      query.contextId,
    )
    assertReadableContext(principal, entity)
    return buildEffectiveBranding(client, principal.tenantId, entity)
  })
}

export async function readEffectiveCorporateBrandingLogo(
  principal: RequestPrincipal,
  rawFileId: unknown,
  rawQuery: unknown,
) {
  const fileId = z.string().uuid().parse(rawFileId)
  const query = effectiveBrandingQuerySchema.parse(rawQuery)
  const branding = await getEffectiveCorporateBranding(principal, query)
  const expectedPrefix = `/api/me/branding-logo/${fileId}?`
  if (!branding.logoUrl.startsWith(expectedPrefix)) {
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_LOGO_NOT_FOUND',
      'Logomarca nao encontrada.',
      404,
    )
  }
  const file = await readStoredFile(principal, fileId)
  if (
    !BRANDING_LOGO_MIME_TYPES.includes(file.record.mimeType as (typeof BRANDING_LOGO_MIME_TYPES)[number])
    || file.record.sizeBytes > BRANDING_LOGO_MAX_BYTES
  ) {
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_LOGO_INVALID',
      'O arquivo de logomarca nao e valido.',
      422,
    )
  }
  return file
}

export async function getCompanyDocumentBranding(
  principal: RequestPrincipal,
  rawCompanyId: unknown,
): Promise<{ branding: EffectiveCorporateBranding; logoDataUrl: string }> {
  const companyId = corporateBrandingScopeIdSchema.parse(rawCompanyId)
  const branding = await getEffectiveCorporateBranding(principal, {
    contextType: 'company',
    contextId: companyId,
  })
  const privateLogoId = branding.logoUrl.match(/^\/api\/me\/branding-logo\/([0-9a-f-]{36})\?/i)?.[1]
  if (privateLogoId) {
    const file = await readStoredFile(principal, privateLogoId)
    if (!BRANDING_LOGO_MIME_TYPES.includes(file.record.mimeType as (typeof BRANDING_LOGO_MIME_TYPES)[number])) {
      throw new CorporateBrandingServiceError(
        'CORPORATE_BRANDING_LOGO_INVALID',
        'O arquivo de logomarca nao e valido.',
        422,
      )
    }
    return {
      branding,
      logoDataUrl: `data:${file.record.mimeType};base64,${file.bytes.toString('base64')}`,
    }
  }

  const publicLogo = await readPublicBrandingAsset(branding.logoUrl)
  return {
    branding,
    logoDataUrl: `data:${publicLogo.mimeType};base64,${publicLogo.bytes.toString('base64')}`,
  }
}

async function buildConfiguration(
  client: PoolClient,
  tenantId: string,
  entity: BrandingEntityRow & { scopeType: CorporateBrandingScopeType },
): Promise<CorporateBrandingConfiguration> {
  const current = await loadSetting(client, tenantId, entity.scopeType, entity.id, false)
  return {
    scopeType: entity.scopeType,
    scopeId: entity.id,
    declared: declaredFromRow(current),
    effective: await buildEffectiveBranding(client, tenantId, entity, current),
    version: current ? Number(current.version) : null,
    updatedAt: current ? toIso(current.updated_at) : null,
  }
}

async function buildEffectiveBranding(
  client: PoolClient,
  tenantId: string,
  entity: BrandingEntityRow & { scopeType: CorporateBrandingScopeType },
  loadedCurrent?: BrandingSettingRow | null,
): Promise<EffectiveCorporateBranding> {
  const current = loadedCurrent === undefined
    ? await loadSetting(client, tenantId, entity.scopeType, entity.id, false)
    : loadedCurrent
  const group = entity.scopeType === 'group'
    ? current
    : entity.group_id
      ? await loadSetting(client, tenantId, 'group', entity.group_id, false)
      : null
  const provenance = current || group

  return resolveEffectiveCorporateBranding({
    scopeType: entity.scopeType,
    scopeId: entity.id,
    company: entity.scopeType === 'company' ? effectiveDeclaredFromRow(current) : null,
    group: effectiveDeclaredFromRow(group),
    groupId: entity.scopeType === 'group' ? entity.id : entity.group_id,
    version: provenance ? Number(provenance.version) : null,
    updatedAt: provenance ? toIso(provenance.updated_at) : null,
    entity: {
      displayName: entity.display_name,
      legalName: entity.legal_name,
      documentNumber: entity.document_number,
    },
  })
}

async function loadBrandingEntity(
  client: PoolClient,
  tenantId: string,
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
): Promise<BrandingEntityRow & { scopeType: CorporateBrandingScopeType }> {
  const result = scopeType === 'company'
    ? await client.query<BrandingEntityRow>(
      `select company.id, company.group_id,
              coalesce(nullif(btrim(company.trade_name), ''), company.legal_name) as display_name,
              company.legal_name as legal_name,
              company.document_number
       from companies company
       where company.tenant_id = $1 and company.id = $2 and company.deleted_at is null`,
      [tenantId, scopeId],
    )
    : await client.query<BrandingEntityRow>(
      `select business_group.id, null::text as group_id,
              business_group.name as display_name,
              business_group.name as legal_name,
              business_group.document_number
       from business_groups business_group
       where business_group.tenant_id = $1
         and business_group.id = $2
         and business_group.deleted_at is null`,
      [tenantId, scopeId],
    )

  const row = result.rows[0]
  if (!row) {
    throw new CorporateBrandingServiceError(
      scopeType === 'company'
        ? 'CORPORATE_BRANDING_COMPANY_NOT_FOUND'
        : 'CORPORATE_BRANDING_GROUP_NOT_FOUND',
      scopeType === 'company' ? 'Empresa nao encontrada.' : 'Grupo empresarial nao encontrado.',
      404,
    )
  }
  return { ...row, scopeType }
}

async function loadSetting(
  client: PoolClient,
  tenantId: string,
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  forUpdate: boolean,
): Promise<BrandingSettingRow | null> {
  const targetColumn = scopeType === 'company' ? 'company_id' : 'business_group_id'
  const result = await client.query<BrandingSettingRow>(
    `select setting.*,
            case
              when logo.status = 'active'
               and logo.mime_type in ('image/png', 'image/jpeg', 'image/webp')
               and logo.size_bytes <= ${BRANDING_LOGO_MAX_BYTES}
              then logo.id
              else null
            end as active_logo_file_id
     from corporate_branding_settings setting
     left join stored_files logo
       on logo.tenant_id = setting.tenant_id and logo.id = setting.logo_file_id
     where setting.tenant_id = $1
       and setting.scope_type = $2
       and setting.${targetColumn} = $3
     ${forUpdate ? 'for update of setting' : ''}`,
    [tenantId, scopeType, scopeId],
  )
  return result.rows[0] || null
}

async function persistSetting(
  client: PoolClient,
  principal: RequestPrincipal,
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  current: BrandingSettingRow | null,
  declared: CorporateBrandingDeclared,
): Promise<void> {
  const values = [
    declared.displayName,
    declared.logoFileId,
    declared.logoAlt,
    declared.primaryColor,
    declared.accentColor,
    declared.sidebarColor,
    declared.documentLegalName,
    declared.documentNumber,
  ]

  if (current) {
    const result = await client.query(
      `update corporate_branding_settings
       set display_name = $3, logo_file_id = $4, logo_alt = $5,
           primary_color = $6, accent_color = $7, sidebar_color = $8,
           document_legal_name = $9, document_number = $10,
           updated_by = $11, version = version + 1
       where tenant_id = $1 and id = $2 and version = $12`,
      [
        principal.tenantId,
        current.id,
        ...values,
        principal.user.id,
        Number(current.version),
      ],
    )
    if (result.rowCount !== 1) throw versionConflict()
    return
  }

  await client.query(
    `insert into corporate_branding_settings (
       tenant_id, scope_type, business_group_id, company_id,
       display_name, logo_file_id, logo_alt, primary_color, accent_color,
       sidebar_color, document_legal_name, document_number,
       created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13
     )`,
    [
      principal.tenantId,
      scopeType,
      scopeType === 'group' ? scopeId : null,
      scopeType === 'company' ? scopeId : null,
      ...values,
      principal.user.id,
    ],
  )
}

async function assertValidBrandingLogo(
  client: PoolClient,
  tenantId: string,
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  fileId: string,
): Promise<void> {
  const result = await client.query(
    `select 1
     from corporate_branding_assets asset
     join stored_files file
       on file.tenant_id = asset.tenant_id and file.id = asset.file_id
     where asset.tenant_id = $1 and asset.file_id = $2
       and asset.scope_type = $3
       and asset.business_group_id is not distinct from $4
       and asset.company_id is not distinct from $5
       and file.status = 'active'
       and file.mime_type in ('image/png', 'image/jpeg', 'image/webp')
       and file.size_bytes <= $6`,
    [
      tenantId,
      fileId,
      scopeType,
      scopeType === 'group' ? scopeId : null,
      scopeType === 'company' ? scopeId : null,
      BRANDING_LOGO_MAX_BYTES,
    ],
  )
  if (!result.rowCount) {
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_LOGO_INVALID',
      'Use uma imagem PNG, JPEG ou WebP valida com no maximo 5 MB.',
      422,
    )
  }
}

async function normalizeBrandingLogo(
  bytes: Buffer,
  originalName: string,
  declaredMimeType?: string | null,
): Promise<Buffer> {
  try {
    validateBrandingImageEnvelope(bytes, originalName, declaredMimeType)
    const input = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BRANDING_IMAGE_MAX_PIXELS,
      animated: false,
    })
    const metadata = await input.metadata()
    if (
      !metadata.width
      || !metadata.height
      || metadata.width * metadata.height > BRANDING_IMAGE_MAX_PIXELS
      || (metadata.pages || 1) > 1
    ) {
      throw new BrandingImageValidationError('Dimensoes da logomarca invalidas.')
    }
    const normalized = await sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BRANDING_IMAGE_MAX_PIXELS,
      animated: false,
    })
      .rotate()
      .resize({
        width: 2_000,
        height: 1_000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90, alphaQuality: 95, effort: 5 })
      .toBuffer()
    if (!normalized.length || normalized.length > BRANDING_IMAGE_MAX_BYTES) {
      throw new BrandingImageValidationError('Nao foi possivel normalizar a logomarca dentro do limite de 5 MB.')
    }
    return normalized
  } catch (error) {
    if (error instanceof CorporateBrandingServiceError) throw error
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_LOGO_INVALID',
      error instanceof BrandingImageValidationError
        ? error.message
        : 'Nao foi possivel validar a imagem da logomarca.',
      422,
    )
  }
}

function safeBrandingOriginalName(value: string): string {
  const clean = basename(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240)
  const stem = clean.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 220)
  return `${stem || 'logomarca'}.webp`
}

function privateObjectPath(storageKey: string): string {
  const root = resolve(getServerEnvironment().STORAGE_ROOT)
  const target = resolve(root, ...storageKey.split('/'))
  const relation = relative(root, target)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Chave de armazenamento invalida.')
  }
  return target
}

async function readPublicBrandingAsset(
  logoUrl: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!/^\/brand\/[A-Za-z0-9._/-]+\.(?:png|webp)$/i.test(logoUrl) || logoUrl.includes('..')) {
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_SYSTEM_LOGO_INVALID',
      'Logomarca padrao indisponivel.',
      503,
    )
  }
  const publicRoot = resolve(process.cwd(), 'public')
  const target = resolve(publicRoot, `.${logoUrl}`)
  const relation = relative(publicRoot, target)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new CorporateBrandingServiceError(
      'CORPORATE_BRANDING_SYSTEM_LOGO_INVALID',
      'Logomarca padrao indisponivel.',
      503,
    )
  }
  return {
    bytes: await readFile(target),
    mimeType: logoUrl.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png',
  }
}

async function authorizeManagementScope(
  client: PoolClient,
  principal: RequestPrincipal,
  entity: BrandingEntityRow & { scopeType: CorporateBrandingScopeType },
  permission: keyof Permissoes,
): Promise<void> {
  if (entity.scopeType === 'company') {
    await requireCompanyAccess(principal, entity.id, permission)
    return
  }
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return

  const companies = await client.query<{ id: string }>(
    `select id from companies
     where tenant_id = $1 and group_id = $2
       and status = 'active' and deleted_at is null
     order by id`,
    [principal.tenantId, entity.id],
  )
  const accessByCompany = new Map(
    (principal.corporateAccess?.companies || []).map((company) => [company.companyId, company]),
  )
  const allowed = companies.rows.length > 0
    ? companies.rows.every((company) => accessByCompany.get(company.id)?.permissions[permission] === true)
    : Boolean(
      principal.corporateAccess?.groupIds.includes(entity.id)
      && principal.user.permissoes?.[permission] === true,
    )
  if (!allowed) {
    throw new CorporateAccessDeniedError(
      'CORPORATE_BRANDING_GROUP_ACCESS_DENIED',
      'A configuracao do grupo exige permissao em todas as empresas ativas vinculadas.',
    )
  }
}

function assertReadableContext(
  principal: RequestPrincipal,
  entity: BrandingEntityRow & { scopeType: CorporateBrandingScopeType },
): void {
  if (
    principal.platformAdmin
    || principal.roleKey === 'tenant_admin'
    || principal.corporateAccess?.tenantWide
  ) return

  const allowed = entity.scopeType === 'company'
    ? principal.corporateAccess?.companyIds.includes(entity.id)
    : principal.corporateAccess?.groupIds.includes(entity.id)
      || principal.corporateAccess?.companies.some((company) => company.groupId === entity.id)

  if (!allowed) {
    throw new CorporateAccessDeniedError(
      'CORPORATE_BRANDING_CONTEXT_ACCESS_DENIED',
      'Contexto corporativo nao autorizado.',
    )
  }
}

function declaredFromRow(row: BrandingSettingRow | null): CorporateBrandingDeclared {
  if (!row) return emptyCorporateBrandingDeclared()
  return {
    displayName: row.display_name,
    logoFileId: row.logo_file_id,
    logoAlt: row.logo_alt,
    primaryColor: row.primary_color?.toUpperCase() || null,
    accentColor: row.accent_color?.toUpperCase() || null,
    sidebarColor: row.sidebar_color?.toUpperCase() || null,
    documentLegalName: row.document_legal_name,
    documentNumber: row.document_number,
  }
}

function effectiveDeclaredFromRow(row: BrandingSettingRow | null): CorporateBrandingDeclared {
  return {
    ...declaredFromRow(row),
    logoFileId: row?.active_logo_file_id || null,
  }
}

function assertExpectedVersion(
  current: BrandingSettingRow | null,
  patch: CorporateBrandingPatch,
): void {
  if (patch.expectedVersion === undefined) return
  if (patch.expectedVersion === null) {
    if (current) throw versionConflict()
    return
  }
  if (!current || Number(current.version) !== patch.expectedVersion) throw versionConflict()
}

function versionConflict(): CorporateBrandingServiceError {
  return new CorporateBrandingServiceError(
    'CORPORATE_BRANDING_VERSION_CONFLICT',
    'A identidade visual foi alterada por outra pessoa. Recarregue antes de salvar.',
    409,
  )
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
