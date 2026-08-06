import { assessTravelReapproval } from '@/lib/travel-lifecycle'
export {
  lifecycleAllowsMaterialDemandEdit,
  lifecycleAllowsNormalHotelDemandEdit,
} from '@/lib/demands/edit-eligibility'

export interface DemandUpdateSnapshot {
  companyId: string
  employeeId: string | null
  serviceType: string
  amount: number
  route: string | null
  startDate: string | null
  endDate: string | null
  costCenterId: string | null
  costCenter: string | null
  project: string | null
  paymentMethod: string | null
  passengerName: string
}

export interface DemandUpdateAssessment {
  material: boolean
  changedFields: string[]
  previousHash: string
  currentHash: string
}

export function assessDemandUpdate(
  previous: DemandUpdateSnapshot,
  current: DemandUpdateSnapshot,
): DemandUpdateAssessment {
  const result = assessTravelReapproval(
    {
      companyId: previous.companyId,
      travelerId: previous.employeeId,
      category: previous.serviceType,
      amount: previous.amount,
      route: previous.route,
      startDate: previous.startDate,
      endDate: previous.endDate,
      costCenterId: previous.costCenterId || previous.costCenter,
      projectId: previous.project,
      paymentMethodId: previous.paymentMethod,
      passengerName: previous.passengerName,
    },
    {
      companyId: current.companyId,
      travelerId: current.employeeId,
      category: current.serviceType,
      amount: current.amount,
      route: current.route,
      startDate: current.startDate,
      endDate: current.endDate,
      costCenterId: current.costCenterId || current.costCenter,
      projectId: current.project,
      paymentMethodId: current.paymentMethod,
      passengerName: current.passengerName,
    },
    {
      extraCriticalFields: ['companyId', 'passengerName'],
    },
  )

  return {
    material: result.required,
    changedFields: result.changedFields,
    previousHash: result.previousHash,
    currentHash: result.currentHash,
  }
}
