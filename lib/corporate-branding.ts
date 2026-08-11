import { z } from 'zod'

import { BRAND_LOGO_LIGHT, SYSTEM_NAME } from '@/lib/branding'

export const corporateBrandingScopeTypeSchema = z.enum(['company', 'group'])
export const corporateBrandingScopeIdSchema = z.string().trim().min(1).max(160)
export const corporateBrandingSourceSchema = z.enum(['company', 'group', 'system'])

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable()
const nullableColor = z.string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .transform((value) => value.toUpperCase())
  .nullable()

export const corporateBrandingDeclaredSchema = z.object({
  displayName: nullableText(200),
  logoFileId: z.string().uuid().nullable(),
  logoAlt: nullableText(240),
  primaryColor: nullableColor,
  accentColor: nullableColor,
  sidebarColor: nullableColor,
  documentLegalName: nullableText(240),
  documentNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9./-]+$/).nullable(),
}).strict()

export const corporateBrandingPatchSchema = z.object({
  values: corporateBrandingDeclaredSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    'Informe ao menos um campo de identidade visual.',
  ),
  expectedVersion: z.number().int().positive().nullable().optional(),
}).strict()

const sourceFieldsSchema = z.object({
  displayName: corporateBrandingSourceSchema,
  logoUrl: corporateBrandingSourceSchema,
  logoAlt: corporateBrandingSourceSchema,
  primaryColor: corporateBrandingSourceSchema,
  accentColor: corporateBrandingSourceSchema,
  sidebarColor: corporateBrandingSourceSchema,
  documentLegalName: corporateBrandingSourceSchema,
  documentNumber: corporateBrandingSourceSchema,
}).strict()

export const effectiveCorporateBrandingSchema = z.object({
  scopeType: corporateBrandingScopeTypeSchema,
  scopeId: corporateBrandingScopeIdSchema,
  groupId: z.string().max(160).nullable(),
  version: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
  displayName: z.string().min(1).max(200),
  logoUrl: z.string().min(1).max(2_048),
  logoAlt: z.string().min(1).max(240),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/),
  sidebarColor: z.string().regex(/^#[0-9A-F]{6}$/),
  documentLegalName: z.string().min(1).max(240),
  documentNumber: z.string().max(64).nullable(),
  source: corporateBrandingSourceSchema,
  sources: sourceFieldsSchema,
}).strict()

export const corporateBrandingConfigurationSchema = z.object({
  scopeType: corporateBrandingScopeTypeSchema,
  scopeId: corporateBrandingScopeIdSchema,
  declared: corporateBrandingDeclaredSchema,
  effective: effectiveCorporateBrandingSchema,
  version: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
}).strict()

export const effectiveBrandingQuerySchema = z.object({
  contextType: corporateBrandingScopeTypeSchema,
  contextId: corporateBrandingScopeIdSchema,
}).strict()

export type CorporateBrandingScopeType = z.infer<typeof corporateBrandingScopeTypeSchema>
export type CorporateBrandingSource = z.infer<typeof corporateBrandingSourceSchema>
export type CorporateBrandingDeclared = z.infer<typeof corporateBrandingDeclaredSchema>
export type CorporateBrandingPatch = z.infer<typeof corporateBrandingPatchSchema>
export type EffectiveCorporateBranding = z.infer<typeof effectiveCorporateBrandingSchema>
export type CorporateBrandingConfiguration = z.infer<typeof corporateBrandingConfigurationSchema>

export interface CorporateBrandingEntityDefaults {
  displayName: string
  legalName: string
  documentNumber: string | null
}

export const CORPORATE_BRANDING_SYSTEM_DEFAULTS = Object.freeze({
  logoUrl: BRAND_LOGO_LIGHT,
  logoAlt: SYSTEM_NAME,
  primaryColor: '#20265A',
  accentColor: '#21BFC5',
  sidebarColor: '#20265A',
})

const declaredKeys = [
  'displayName',
  'logoFileId',
  'logoAlt',
  'primaryColor',
  'accentColor',
  'sidebarColor',
  'documentLegalName',
  'documentNumber',
] as const

export function emptyCorporateBrandingDeclared(): CorporateBrandingDeclared {
  return {
    displayName: null,
    logoFileId: null,
    logoAlt: null,
    primaryColor: null,
    accentColor: null,
    sidebarColor: null,
    documentLegalName: null,
    documentNumber: null,
  }
}

export function mergeCorporateBrandingDeclared(
  current: CorporateBrandingDeclared,
  patch: Partial<CorporateBrandingDeclared>,
): CorporateBrandingDeclared {
  const merged = { ...current }
  for (const key of declaredKeys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      Object.assign(merged, { [key]: patch[key] })
    }
  }
  return corporateBrandingDeclaredSchema.parse(merged)
}

export function resolveEffectiveCorporateBranding(input: {
  scopeType: CorporateBrandingScopeType
  scopeId: string
  company?: CorporateBrandingDeclared | null
  group?: CorporateBrandingDeclared | null
  entity: CorporateBrandingEntityDefaults
  groupId?: string | null
  version?: number | null
  updatedAt?: string | null
}): EffectiveCorporateBranding {
  const candidates = <T>(
    companyValue: T | null | undefined,
    groupValue: T | null | undefined,
    entityValue: T | null | undefined,
    systemValue: T,
  ): { value: T; source: CorporateBrandingSource } => {
    if (input.scopeType === 'company' && companyValue !== null && companyValue !== undefined) {
      return { value: companyValue, source: 'company' }
    }
    if (groupValue !== null && groupValue !== undefined) {
      return { value: groupValue, source: 'group' }
    }
    if (entityValue !== null && entityValue !== undefined) {
      return { value: entityValue, source: input.scopeType }
    }
    return { value: systemValue, source: 'system' }
  }

  const displayName = candidates(
    input.company?.displayName,
    input.group?.displayName,
    input.entity.displayName,
    SYSTEM_NAME,
  )
  const logoFile = candidates(
    input.company?.logoFileId,
    input.group?.logoFileId,
    undefined,
    null as string | null,
  )
  const logoUrl = logoFile.value
    ? brandingLogoUrl(logoFile.value, input.scopeType, input.scopeId)
    : CORPORATE_BRANDING_SYSTEM_DEFAULTS.logoUrl
  const logoUrlSource = logoFile.value ? logoFile.source : 'system'
  const explicitLogoAlt = candidates(
    input.company?.logoAlt,
    input.group?.logoAlt,
    undefined,
    null as string | null,
  )
  const logoAlt = explicitLogoAlt.value
    ? { value: explicitLogoAlt.value, source: explicitLogoAlt.source }
    : { value: displayName.value, source: displayName.source }
  const primaryColor = candidates(
    input.company?.primaryColor,
    input.group?.primaryColor,
    undefined,
    CORPORATE_BRANDING_SYSTEM_DEFAULTS.primaryColor,
  )
  const accentColor = candidates(
    input.company?.accentColor,
    input.group?.accentColor,
    undefined,
    CORPORATE_BRANDING_SYSTEM_DEFAULTS.accentColor,
  )
  const sidebarColor = candidates(
    input.company?.sidebarColor,
    input.group?.sidebarColor,
    undefined,
    CORPORATE_BRANDING_SYSTEM_DEFAULTS.sidebarColor,
  )
  const documentLegalName = candidates(
    input.company?.documentLegalName,
    input.group?.documentLegalName,
    input.entity.legalName,
    displayName.value,
  )
  const documentNumber = candidates(
    input.company?.documentNumber,
    input.group?.documentNumber,
    input.entity.documentNumber,
    null as string | null,
  )

  const sources = {
    displayName: displayName.source,
    logoUrl: logoUrlSource,
    logoAlt: logoAlt.source,
    primaryColor: primaryColor.source,
    accentColor: accentColor.source,
    sidebarColor: sidebarColor.source,
    documentLegalName: documentLegalName.source,
    documentNumber: documentNumber.source,
  }
  const coreSources = [
    sources.displayName,
    sources.logoUrl,
    sources.primaryColor,
    sources.accentColor,
    sources.sidebarColor,
  ]
  const source: CorporateBrandingSource = coreSources.includes('company')
    ? 'company'
    : coreSources.includes('group')
      ? 'group'
      : 'system'

  return effectiveCorporateBrandingSchema.parse({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    groupId: input.groupId || null,
    version: input.version ?? null,
    updatedAt: input.updatedAt ?? null,
    displayName: displayName.value,
    logoUrl,
    logoAlt: logoAlt.value,
    primaryColor: primaryColor.value,
    accentColor: accentColor.value,
    sidebarColor: sidebarColor.value,
    documentLegalName: documentLegalName.value,
    documentNumber: documentNumber.value,
    source,
    sources,
  })
}

function brandingLogoUrl(
  fileId: string,
  contextType: CorporateBrandingScopeType,
  contextId: string,
): string {
  return `/api/me/branding-logo/${fileId}?contextType=${contextType}&contextId=${encodeURIComponent(contextId)}`
}
