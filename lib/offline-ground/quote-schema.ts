import { z } from 'zod'

import {
  busQuoteOptionDetailsSchema,
  carQuoteOptionDetailsSchema,
  type BusQuoteOptionDetailsInput,
  type CarQuoteOptionDetailsInput,
} from './schema'

const identifier = z.string().trim().min(1).max(200)
const optionalIsoDateTime = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().datetime({ offset: true }).optional(),
)
const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().max(max).optional(),
)

const groundQuoteBaseShape = {
  demandId: identifier,
  expectedLifecycleVersion: z.coerce.number().int().positive().optional(),
  expiresAt: optionalIsoDateTime,
  policyJustification: optionalText(2_000),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}

export const offlineCarQuoteOptionSchema = z.object({
  clientId: identifier,
  details: carQuoteOptionDetailsSchema,
}).strict()

export const offlineBusQuoteOptionSchema = z.object({
  clientId: identifier,
  details: busQuoteOptionDetailsSchema,
}).strict()

export const offlineCarQuoteCreateSchema = z.object({
  ...groundQuoteBaseShape,
  service: z.literal('locacao'),
  options: z.array(offlineCarQuoteOptionSchema).min(1).max(10),
}).strict().superRefine(validateUniqueClientIds)

export const offlineBusQuoteCreateSchema = z.object({
  ...groundQuoteBaseShape,
  service: z.literal('rodoviario'),
  options: z.array(offlineBusQuoteOptionSchema).min(1).max(10),
}).strict().superRefine(validateUniqueClientIds)

export const offlineGroundQuoteCreateSchema = z.union([
  offlineCarQuoteCreateSchema,
  offlineBusQuoteCreateSchema,
])

export const offlineGroundQuoteListQuerySchema = z.object({
  demandId: identifier,
  service: z.enum(['locacao', 'rodoviario']).optional(),
}).strict()

export const offlineGroundQuoteCatalogQuerySchema = z.object({
  demandId: identifier,
  service: z.enum(['locacao', 'rodoviario']),
}).strict()

export type OfflineCarQuoteOptionInput = z.infer<typeof offlineCarQuoteOptionSchema>
export type OfflineBusQuoteOptionInput = z.infer<typeof offlineBusQuoteOptionSchema>
export type OfflineCarQuoteCreateInput = z.infer<typeof offlineCarQuoteCreateSchema>
export type OfflineBusQuoteCreateInput = z.infer<typeof offlineBusQuoteCreateSchema>
export type OfflineGroundQuoteCreateInput = z.infer<typeof offlineGroundQuoteCreateSchema>
export type OfflineGroundQuoteService = OfflineGroundQuoteCreateInput['service']

export type OfflineGroundSelectionStatus =
  | 'selected'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'

interface OfflineGroundQuoteOptionBaseReadModel {
  id: string
  clientId: string
  supplierId: string
  supplierName: string
  supplierCode: string | null
  title: string
  subtitle: string | null
  startsAt: string | null
  endsAt: string | null
  totalAmountMinor: number
  currency: string
  refundable: boolean | null
  selected: boolean
  selectionId: string | null
  selectionStatus: OfflineGroundSelectionStatus | null
  approvalInstanceId: string | null
  approvalStatus: string | null
}

export interface OfflineCarQuoteOptionReadModel extends OfflineGroundQuoteOptionBaseReadModel {
  service: 'locacao'
  details: CarQuoteOptionDetailsInput & {
    pickupLocationName: string
    returnLocationName: string
  }
}

export interface OfflineBusQuoteOptionReadModel extends OfflineGroundQuoteOptionBaseReadModel {
  service: 'rodoviario'
  details: Omit<BusQuoteOptionDetailsInput, 'segments'> & {
    routeCode: string | null
    segments: Array<BusQuoteOptionDetailsInput['segments'][number] & {
      id: string
      sequence: number
      routeCode: string
      originCityName: string
      destinationCityName: string
      originTerminalName: string | null
      destinationTerminalName: string | null
    }>
  }
}

export type OfflineGroundQuoteOptionReadModel =
  | OfflineCarQuoteOptionReadModel
  | OfflineBusQuoteOptionReadModel

export interface OfflineGroundQuoteReadModel {
  id: string
  demandId: string
  demandNumber: string
  service: OfflineGroundQuoteService
  status: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  lifecycleStatus: string
  lifecycleVersion: number
  expiresAt: string | null
  selectedOptionId: string | null
  options: OfflineGroundQuoteOptionReadModel[]
  createdAt: string
  updatedAt: string
}

export interface OfflineGroundQuoteListReadModel {
  demandId: string
  service: OfflineGroundQuoteService
  lifecycleStatus: string
  lifecycleVersion: number
  quotes: OfflineGroundQuoteReadModel[]
}

export interface OfflineGroundQuoteCatalogReadModel {
  demandId: string
  service: OfflineGroundQuoteService
  suppliers: Array<{
    id: string
    name: string
    code: string | null
    service: OfflineGroundQuoteService
  }>
  rentalLocations: Array<{
    id: string
    supplierId: string
    name: string
    cityName: string | null
    addressText: string | null
  }>
  busRoutes: Array<{
    id: string
    supplierId: string
    routeCode: string
    originCityId: string
    destinationCityId: string
    originTerminalId: string | null
    destinationTerminalId: string | null
    originTimezone: string
    destinationTimezone: string
    label: string
  }>
}

function validateUniqueClientIds(
  value: { options: Array<{ clientId: string }> },
  context: z.RefinementCtx,
): void {
  const clientIds = new Set<string>()
  value.options.forEach((option, index) => {
    if (clientIds.has(option.clientId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'clientId'],
        message: 'Cada opcao deve possuir um identificador de cliente unico.',
      })
    }
    clientIds.add(option.clientId)
  })
}
