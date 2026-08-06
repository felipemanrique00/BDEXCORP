import { z } from 'zod'

import type {
  VoucherPresentationSettings,
  VoucherPresentationSource,
} from '@/types'

export const voucherPresentationScopeTypeSchema = z.enum(['company', 'group'])
export const voucherPresentationScopeIdSchema = z.string().trim().min(1).max(160)

export const voucherPresentationDeclaredSchema = z.object({
  showConfirmedValues: z.boolean().nullable(),
  showCancellationTerms: z.boolean().nullable(),
  showAdministrativeData: z.boolean().nullable(),
}).strict()

export const voucherPresentationSourceSchema = z.enum(['company', 'group', 'system'])

export const voucherPresentationSettingsSchema = z.object({
  showConfirmedValues: z.boolean(),
  showCancellationTerms: z.boolean(),
  showAdministrativeData: z.boolean(),
  sources: z.object({
    showConfirmedValues: voucherPresentationSourceSchema,
    showCancellationTerms: voucherPresentationSourceSchema,
    showAdministrativeData: voucherPresentationSourceSchema,
  }).strict(),
  groupId: z.string().max(160).nullable(),
}).strict()

export const voucherPresentationPatchSchema = z.object({
  values: voucherPresentationDeclaredSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    'Informe ao menos uma configuracao de apresentacao.',
  ),
  expectedVersion: z.number().int().positive().nullable().optional(),
}).strict()

export const voucherPresentationConfigurationSchema = z.object({
  scopeType: voucherPresentationScopeTypeSchema,
  scopeId: voucherPresentationScopeIdSchema,
  declared: voucherPresentationDeclaredSchema,
  effective: voucherPresentationSettingsSchema,
  version: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
}).strict()

export type VoucherPresentationScopeType = z.infer<typeof voucherPresentationScopeTypeSchema>
export type VoucherPresentationDeclared = z.infer<typeof voucherPresentationDeclaredSchema>
export type VoucherPresentationPatch = z.infer<typeof voucherPresentationPatchSchema>
export type VoucherPresentationConfiguration = z.infer<typeof voucherPresentationConfigurationSchema>

export const VOUCHER_PRESENTATION_SYSTEM_DEFAULTS = Object.freeze({
  showConfirmedValues: true,
  showCancellationTerms: true,
  showAdministrativeData: true,
})

const keys = [
  'showConfirmedValues',
  'showCancellationTerms',
  'showAdministrativeData',
] as const

export function emptyVoucherPresentationDeclared(): VoucherPresentationDeclared {
  return {
    showConfirmedValues: null,
    showCancellationTerms: null,
    showAdministrativeData: null,
  }
}

export function resolveVoucherPresentationSettings(input: {
  company?: Partial<VoucherPresentationDeclared> | null
  group?: Partial<VoucherPresentationDeclared> | null
  groupId?: string | null
}): VoucherPresentationSettings {
  const values = {} as Record<(typeof keys)[number], boolean>
  const sources = {} as Record<(typeof keys)[number], VoucherPresentationSource>

  for (const key of keys) {
    if (typeof input.company?.[key] === 'boolean') {
      values[key] = input.company[key]
      sources[key] = 'company'
    } else if (typeof input.group?.[key] === 'boolean') {
      values[key] = input.group[key]
      sources[key] = 'group'
    } else {
      values[key] = VOUCHER_PRESENTATION_SYSTEM_DEFAULTS[key]
      sources[key] = 'system'
    }
  }

  return voucherPresentationSettingsSchema.parse({
    ...values,
    sources,
    groupId: input.groupId || null,
  })
}

export function mergeVoucherPresentationDeclared(
  current: VoucherPresentationDeclared,
  patch: Partial<VoucherPresentationDeclared>,
): VoucherPresentationDeclared {
  return voucherPresentationDeclaredSchema.parse({
    showConfirmedValues: Object.prototype.hasOwnProperty.call(patch, 'showConfirmedValues')
      ? patch.showConfirmedValues
      : current.showConfirmedValues,
    showCancellationTerms: Object.prototype.hasOwnProperty.call(patch, 'showCancellationTerms')
      ? patch.showCancellationTerms
      : current.showCancellationTerms,
    showAdministrativeData: Object.prototype.hasOwnProperty.call(patch, 'showAdministrativeData')
      ? patch.showAdministrativeData
      : current.showAdministrativeData,
  })
}

export function requiresSanitizedVoucherRendering(
  settings: Pick<
    VoucherPresentationSettings,
    'showConfirmedValues' | 'showCancellationTerms' | 'showAdministrativeData'
  >,
): boolean {
  return !settings.showConfirmedValues
    || !settings.showCancellationTerms
    || !settings.showAdministrativeData
}
