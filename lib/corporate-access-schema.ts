import { z } from 'zod'

import {
  CORPORATE_PERMISSION_KEYS,
  CORPORATE_PROFILES,
  permissionsForCorporateProfile,
} from '@/lib/corporate-access'

const identifier = z.string().trim().min(1).max(160)
const profile = z.enum(CORPORATE_PROFILES as [typeof CORPORATE_PROFILES[number], ...typeof CORPORATE_PROFILES])
const status = z.enum(['active', 'suspended']).default('active')
const optionalDateTime = z.string().datetime({ offset: true }).nullable().optional()
const permissionKey = z.enum(CORPORATE_PERMISSION_KEYS as [keyof import('@/types').Permissoes, ...(keyof import('@/types').Permissoes)[]])
const permissionOverrides = z.record(permissionKey, z.boolean()).default({})

const groupGrantSchema = z.object({
  groupId: identifier,
  profile,
  accessMode: z.enum(['all_companies', 'selected_companies']),
  companyIds: z.array(identifier).max(1_000).default([]),
  canViewConsolidated: z.boolean().default(false),
  permissionOverrides,
  status,
  validFrom: optionalDateTime,
  validUntil: optionalDateTime,
}).superRefine((grant, context) => {
  if (grant.accessMode === 'selected_companies' && grant.companyIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Selecione ao menos uma empresa.' })
  }
  if (grant.accessMode === 'all_companies' && grant.companyIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Nao envie empresas no modo all_companies.' })
  }
  if (
    grant.canViewConsolidated
    && !permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_consolidado_grupo
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['canViewConsolidated'],
      message: 'A visao consolidada exige a permissao ver_consolidado_grupo.',
    })
  }
  validatePeriod(grant.validFrom, grant.validUntil, context)
})

const companyGrantSchema = z.object({
  companyId: identifier,
  profile,
  permissionOverrides,
  status,
  validFrom: optionalDateTime,
  validUntil: optionalDateTime,
}).superRefine((grant, context) => validatePeriod(grant.validFrom, grant.validUntil, context))

const contextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('company'), id: identifier }),
  z.object({ type: z.literal('group'), id: identifier }),
])

export const corporateAccessConfigurationSchema = z.object({
  groupGrants: z.array(groupGrantSchema).max(250).default([]),
  companyGrants: z.array(companyGrantSchema).max(1_000).default([]),
  defaultContext: contextSchema.nullable().default(null),
}).superRefine((configuration, context) => {
  findDuplicates(configuration.groupGrants.map((grant) => grant.groupId)).forEach((groupId) => {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['groupGrants'], message: `Grupo duplicado: ${groupId}.` })
  })
  findDuplicates(configuration.companyGrants.map((grant) => grant.companyId)).forEach((companyId) => {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyGrants'], message: `Empresa duplicada: ${companyId}.` })
  })
})

export const corporateContextPreferenceSchema = z.object({
  context: contextSchema.nullable(),
})

export type CorporateAccessConfigurationInput = z.infer<typeof corporateAccessConfigurationSchema>
export type CorporateContextPreferenceInput = z.infer<typeof corporateContextPreferenceSchema>

function validatePeriod(
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
  context: z.RefinementCtx,
): void {
  if (validFrom && validUntil && new Date(validUntil).getTime() <= new Date(validFrom).getTime()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'A expiracao deve ser posterior ao inicio.' })
  }
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  values.forEach((value) => seen.has(value) ? duplicates.add(value) : seen.add(value))
  return [...duplicates]
}
