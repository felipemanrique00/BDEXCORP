import { z } from 'zod'

import {
  COMMERCIAL_RESERVATION_SYSTEMS,
  COMMERCIAL_SERVICE_TYPES,
} from '@/lib/commercial-suppliers/types'

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional())

const contactSchema = z.object({
  type: z.enum(['commercial', 'reservation', 'financial', 'emergency', 'general']),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().min(1).max(80).nullable().optional(),
  fax: z.string().trim().min(1).max(80).nullable().optional(),
  isPrimary: z.boolean().default(false),
}).strict().refine((value) => Boolean(value.email || value.phone), {
  message: 'Informe e-mail ou telefone para o contato.',
})

const addressSchema = z.object({
  countryId: z.string().uuid().nullable().optional(),
  subdivisionId: z.string().uuid().nullable().optional(),
  cityId: z.string().uuid().nullable().optional(),
  postalCode: z.string().trim().min(1).max(40).nullable().optional(),
  street: z.string().trim().min(1).max(500).nullable().optional(),
  streetNumber: z.string().trim().min(1).max(80).nullable().optional(),
  complement: z.string().trim().min(1).max(300).nullable().optional(),
  district: z.string().trim().min(1).max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  formattedAddress: z.string().trim().min(1).max(1_000).nullable().optional(),
}).strict().superRefine((address, context) => {
  if ((address.subdivisionId || address.cityId) && !address.countryId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['countryId'],
      message: 'Informe o pais quando estado ou cidade forem selecionados.',
    })
  }
  if (!Object.values(address).some((value) => value !== undefined && value !== null && value !== '')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Informe ao menos um campo do endereco.',
    })
  }
})

const contactsSchema = z.array(contactSchema).max(30).superRefine((contacts, context) => {
  const primaryTypes = new Set<string>()
  contacts.forEach((contact, index) => {
    if (!contact.isPrimary) return
    if (primaryTypes.has(contact.type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'isPrimary'],
        message: 'Informe somente um contato principal por tipo.',
      })
    }
    primaryTypes.add(contact.type)
  })
}).default([]).describe(
  'Snapshot completo dos contatos ativos. Em PATCH, omita o campo para preservar o conjunto atual.',
)

const supplierBaseSchema = z.object({
  internalCode: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(2).max(300),
  tradeName: z.string().trim().min(1).max(300).nullable().optional(),
  documentType: z.enum(['cnpj', 'cpf', 'foreign_tax_id', 'other']).default('cnpj'),
  documentNumber: z.string().trim().min(1).max(80).nullable().optional(),
  serviceTypes: z.array(z.enum(COMMERCIAL_SERVICE_TYPES))
    .min(1)
    .max(COMMERCIAL_SERVICE_TYPES.length)
    .refine((items) => new Set(items).size === items.length, {
      message: 'Os tipos de servico nao podem conter duplicidades.',
    }),
  reservationSystem: z.enum(COMMERCIAL_RESERVATION_SYSTEMS).default('manual'),
  address: addressSchema.nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  notes: z.string().trim().min(1).max(4_000).nullable().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).default('active'),
  paymentTerms: z.record(z.unknown()).default({}),
  contacts: contactsSchema,
})

export const createCommercialSupplierSchema = supplierBaseSchema.strict()

export const updateCommercialSupplierSchema = supplierBaseSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
}).strict()

export const commercialSupplierQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  serviceType: z.enum(COMMERCIAL_SERVICE_TYPES).optional(),
  cityId: z.string().uuid().optional(),
  reservationSystem: z.enum(COMMERCIAL_RESERVATION_SYSTEMS).optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export type CreateCommercialSupplierInput = z.infer<typeof createCommercialSupplierSchema>
export type UpdateCommercialSupplierInput = z.infer<typeof updateCommercialSupplierSchema>
