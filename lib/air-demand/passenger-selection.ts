export const MAX_AIR_PASSENGERS = 100

export type AirPassengerProfileIssue = 'cpf' | 'birth_date' | 'first_name' | 'last_name'

export interface AirPassengerSelection {
  employee_id: string
  name?: string
}

export interface AirPassengerValidationIssue {
  employeeId: string
  name: string
  issues: AirPassengerProfileIssue[]
}

export interface AirPassengerLookupError {
  employeeId: string
  name: string
  message: string
}

export interface AirPassengerValidationState {
  passengerCount: number
  blockingIssues: AirPassengerValidationIssue[]
  pendingVerificationIds: string[]
  lookupErrors: AirPassengerLookupError[]
}

export function airPassengersFromDetails(
  details: unknown,
  legacyPrimary?: AirPassengerSelection | null,
): AirPassengerSelection[] {
  const value = objectValue(details)
  const passengers = normalizeAirPassengers(value.passengers)
  if (passengers.length) return passengers
  return normalizeAirPassengers(legacyPrimary ? [legacyPrimary] : [])
}

export function withAirPassengers<T extends Record<string, unknown>>(
  details: T,
  passengers: readonly AirPassengerSelection[],
): T & { passengers: AirPassengerSelection[] } {
  return {
    ...details,
    passengers: normalizeAirPassengers(passengers),
  }
}

export function normalizeAirPassengers(value: unknown): AirPassengerSelection[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: AirPassengerSelection[] = []
  for (const entry of value) {
    const row = objectValue(entry)
    const employeeId = text(row.employee_id || row.employeeId)
    if (!employeeId || seen.has(employeeId)) continue
    const name = text(row.name)
    seen.add(employeeId)
    result.push({ employee_id: employeeId, ...(name ? { name } : {}) })
    if (result.length >= MAX_AIR_PASSENGERS) break
  }
  return result
}

export function normalizeAirPassengerProfileIssues(
  value: unknown,
  passengerName: string,
): AirPassengerProfileIssue[] {
  const issues = new Set<AirPassengerProfileIssue>(airPassengerNameIssues(passengerName))
  if (Array.isArray(value)) {
    for (const entry of value) {
      const raw = typeof entry === 'string' ? entry : text(objectValue(entry).code)
      const normalized = normalizeProfileIssue(raw)
      if (normalized) issues.add(normalized)
    }
  }
  return [...issues]
}

export function airPassengerNameIssues(name: string): AirPassengerProfileIssue[] {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ['first_name', 'last_name']
  if (parts.length === 1) return ['last_name']
  return []
}

export function airPassengerProfileIssueLabel(issue: AirPassengerProfileIssue): string {
  if (issue === 'cpf') return 'CPF'
  if (issue === 'birth_date') return 'data de nascimento'
  if (issue === 'first_name') return 'primeiro nome'
  return 'último nome'
}

export function airPassengerProfileIssueMessage(issue: AirPassengerProfileIssue): string {
  return issue === 'cpf'
    ? 'CPF ausente ou inválido'
    : `Falta ${airPassengerProfileIssueLabel(issue)}`
}

function normalizeProfileIssue(value: string): AirPassengerProfileIssue | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['cpf', 'document', 'document_number', 'tax_document'].includes(normalized)) return 'cpf'
  if (['birth_date', 'birthdate', 'date_of_birth', 'data_nascimento'].includes(normalized)) return 'birth_date'
  if (['first_name', 'firstname', 'given_name'].includes(normalized)) return 'first_name'
  if (['last_name', 'lastname', 'surname', 'family_name'].includes(normalized)) return 'last_name'
  return null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
