import { z } from 'zod'

import { corporateAccessConfigurationSchema } from '@/lib/corporate-access-schema'

const permissionsSchema = z.record(z.boolean()).optional()

export const userMutationSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(1_024).optional(),
  role: z.enum(['master', 'company_admin', 'colaborador']),
  profile: z.enum(['agente', 'lider', 'gestor_financeiro', 'operacional', 'supervisor']).optional(),
  permissions: permissionsSchema,
  companyId: z.string().trim().max(160).nullable().optional(),
  companyIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  groupIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  avatar: z.string().max(2_000_000).nullable().optional(),
  active: z.boolean().optional(),
  corporateAccess: corporateAccessConfigurationSchema.optional(),
}).superRefine((input, context) => {
  if (input.role === 'master') {
    if (!input.profile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profile'],
        message: 'Usuarios internos exigem um perfil interno.',
      })
    }
    if (input.corporateAccess !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['corporateAccess'],
        message: 'Usuarios internos nao podem receber acesso corporativo.',
      })
    }
    return
  }

  if (input.profile !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profile'],
      message: 'Perfis internos exigem a role master.',
    })
  }
  if (input.corporateAccess === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['corporateAccess'],
      message: 'Roles corporativas exigem uma configuracao de acesso corporativo.',
    })
  }

  const internalOnlyFields = [
    ['permissions', input.permissions],
    ['companyId', input.companyId],
    ['companyIds', input.companyIds],
    ['groupIds', input.groupIds],
  ] as const
  for (const [field, value] of internalOnlyFields) {
    if (value === undefined) continue
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: 'Use corporateAccess para configurar perfis, permissoes e escopo corporativos.',
    })
  }
})

export type UserMutationSchemaInput = z.infer<typeof userMutationSchema>
