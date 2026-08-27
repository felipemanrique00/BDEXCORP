import { z } from 'zod'

import {
  busDemandDetailsSchema,
  carDemandDetailsSchema,
  type BusDemandDetailsInput,
  type CarDemandDetailsInput,
} from './schema'

const travelerSnapshotSchema = z.object({
  employee_id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(2).max(300),
  email: z.string().trim().email().max(320).optional(),
}).strict()

export type GroundDemandTravelerSnapshot = z.infer<typeof travelerSnapshotSchema>

export const portalCarRequestDetailsSchema = z.object({
  ground: carDemandDetailsSchema,
  primary_driver: travelerSnapshotSchema,
  pickup_location_name: z.string().trim().min(2).max(300),
  return_location_name: z.string().trim().min(2).max(300),
  supplier_name: z.string().trim().min(2).max(300).optional(),
}).passthrough()

export const groundBusLegSnapshotSchema = z.object({
  origin_city_name: z.string().trim().min(2).max(300),
  destination_city_name: z.string().trim().min(2).max(300),
  origin_terminal_name: z.string().trim().min(2).max(300).optional(),
  destination_terminal_name: z.string().trim().min(2).max(300).optional(),
}).strict()

export const portalBusRequestDetailsSchema = z.object({
  ground: busDemandDetailsSchema,
  travelers: z.array(travelerSnapshotSchema).min(1).max(32),
  leg_snapshots: z.array(groundBusLegSnapshotSchema).min(1).max(32),
}).strict().superRefine((value, context) => {
  if (value.leg_snapshots.length !== value.ground.legs.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['leg_snapshots'],
      message: 'Cada trecho precisa manter seu snapshot de origem e destino.',
    })
  }
  const employeeIds = new Set<string>()
  value.travelers.forEach((traveler, index) => {
    if (employeeIds.has(traveler.employee_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travelers', index, 'employee_id'],
        message: 'O mesmo viajante nao pode ser informado duas vezes.',
      })
    }
    employeeIds.add(traveler.employee_id)
  })
})

export type PortalCarRequestDetails = z.infer<typeof portalCarRequestDetailsSchema>
export type PortalBusRequestDetails = z.infer<typeof portalBusRequestDetailsSchema>

export function parsePortalCarRequestDetails(value: unknown): PortalCarRequestDetails | null {
  const parsed = portalCarRequestDetailsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parsePortalBusRequestDetails(value: unknown): PortalBusRequestDetails | null {
  const parsed = portalBusRequestDetailsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function groundRequestTravelers(
  details: PortalCarRequestDetails | PortalBusRequestDetails,
): GroundDemandTravelerSnapshot[] {
  return 'primary_driver' in details ? [details.primary_driver] : details.travelers
}

export function groundRequestDates(
  details: PortalCarRequestDetails | PortalBusRequestDetails,
): { startDate: string; endDate: string } {
  if ('primary_driver' in details) {
    return {
      startDate: details.ground.pickupAt.slice(0, 10),
      endDate: details.ground.returnAt.slice(0, 10),
    }
  }
  return {
    startDate: details.ground.legs[0]!.departureDate,
    endDate: details.ground.legs.at(-1)!.departureDate,
  }
}

export function groundRequestDestination(
  details: PortalCarRequestDetails | PortalBusRequestDetails,
): string {
  if ('primary_driver' in details) return details.return_location_name
  return details.leg_snapshots.at(-1)!.destination_city_name
}

export type GroundDemandDetailsInput = CarDemandDetailsInput | BusDemandDetailsInput
