import type { AirTravelerProfileIssue } from '@/lib/travelers/air-profile'

export interface TravelerDirectoryItem {
  id: string
  companyId: string
  identificationCode: string
  name: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  department: string | null
  costCenterId: string | null
  costCenter: string | null
  registrationCode: string | null
  /** Pendencias que impedem o uso deste cadastro como passageiro aereo. */
  profileIssues: AirTravelerProfileIssue[]
}
