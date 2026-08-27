import { z } from 'zod'

export const travelerManagementScopeTypeSchema = z.enum(['company', 'group'])
export const travelerManagementScopeIdSchema = z.string().trim().min(1).max(160)

export const travelerManagementDeclaredSchema = z.object({
  allowRequesterTravelerManagement: z.boolean().nullable(),
}).strict()

export const travelerManagementSourceSchema = z.enum(['company', 'group', 'system'])

export const travelerManagementSettingsSchema = z.object({
  allowRequesterTravelerManagement: z.boolean(),
  sources: z.object({
    allowRequesterTravelerManagement: travelerManagementSourceSchema,
  }).strict(),
  groupId: z.string().max(160).nullable(),
}).strict()

export const travelerManagementPatchSchema = z.object({
  values: travelerManagementDeclaredSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    'Informe ao menos uma configuracao de cadastro de viajantes.',
  ),
  expectedVersion: z.number().int().positive().nullable(),
}).strict()

export const travelerManagementConfigurationSchema = z.object({
  scopeType: travelerManagementScopeTypeSchema,
  scopeId: travelerManagementScopeIdSchema,
  declared: travelerManagementDeclaredSchema,
  effective: travelerManagementSettingsSchema,
  version: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
}).strict()

export type TravelerManagementScopeType = z.infer<typeof travelerManagementScopeTypeSchema>
export type TravelerManagementDeclared = z.infer<typeof travelerManagementDeclaredSchema>
export type TravelerManagementSource = z.infer<typeof travelerManagementSourceSchema>
export type TravelerManagementSettings = z.infer<typeof travelerManagementSettingsSchema>
export type TravelerManagementPatch = z.infer<typeof travelerManagementPatchSchema>
export type TravelerManagementConfiguration = z.infer<typeof travelerManagementConfigurationSchema>

export const TRAVELER_MANAGEMENT_SYSTEM_DEFAULTS = Object.freeze({
  allowRequesterTravelerManagement: false,
})

export function emptyTravelerManagementDeclared(): TravelerManagementDeclared {
  return { allowRequesterTravelerManagement: null }
}

export function resolveTravelerManagementSettings(input: {
  company?: Partial<TravelerManagementDeclared> | null
  group?: Partial<TravelerManagementDeclared> | null
  groupId?: string | null
}): TravelerManagementSettings {
  const companyValue = input.company?.allowRequesterTravelerManagement
  const groupValue = input.group?.allowRequesterTravelerManagement

  if (typeof companyValue === 'boolean') {
    return travelerManagementSettingsSchema.parse({
      allowRequesterTravelerManagement: companyValue,
      sources: { allowRequesterTravelerManagement: 'company' },
      groupId: input.groupId || null,
    })
  }
  if (typeof groupValue === 'boolean') {
    return travelerManagementSettingsSchema.parse({
      allowRequesterTravelerManagement: groupValue,
      sources: { allowRequesterTravelerManagement: 'group' },
      groupId: input.groupId || null,
    })
  }
  return travelerManagementSettingsSchema.parse({
    ...TRAVELER_MANAGEMENT_SYSTEM_DEFAULTS,
    sources: { allowRequesterTravelerManagement: 'system' },
    groupId: input.groupId || null,
  })
}

export function mergeTravelerManagementDeclared(
  current: TravelerManagementDeclared,
  patch: Partial<TravelerManagementDeclared>,
): TravelerManagementDeclared {
  return travelerManagementDeclaredSchema.parse({
    allowRequesterTravelerManagement: Object.prototype.hasOwnProperty.call(
      patch,
      'allowRequesterTravelerManagement',
    )
      ? patch.allowRequesterTravelerManagement
      : current.allowRequesterTravelerManagement,
  })
}
