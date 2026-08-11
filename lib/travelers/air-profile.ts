import { normalizarCPF } from '@/lib/normalizers'

export const AIR_TRAVELER_PROFILE_ISSUES = [
  'cpf',
  'birth_date',
  'first_name',
  'last_name',
] as const

export type AirTravelerProfileIssue = typeof AIR_TRAVELER_PROFILE_ISSUES[number]

export interface AirTravelerProfileSource {
  name: unknown
  documentNumber: unknown
  birthDate: unknown
}

export interface AirTravelerProfileAssessment {
  name: string
  firstName: string | null
  lastName: string | null
  cpf: string | null
  birthDate: string | null
  /** Formato neutro SOBRENOME/PRIMEIRONOME para integrações de PNR. */
  pnrName: string | null
  profileIssues: AirTravelerProfileIssue[]
}

/**
 * Produz os campos canônicos exigidos para identificar um passageiro aéreo.
 * O nome completo continua sendo a fonte corporativa; primeiro nome e sobrenome
 * são snapshots derivados para PNR, emissão e auditoria.
 */
export function assessAirTravelerProfile(
  source: AirTravelerProfileSource,
): AirTravelerProfileAssessment {
  const name = normalizePersonName(source.name)
  const nameParts = name ? name.split(' ') : []
  const firstName = validNamePart(nameParts[0]) ? nameParts[0] : null
  const lastNameCandidate = nameParts.length >= 2 ? nameParts.at(-1) : undefined
  const lastName = validNamePart(lastNameCandidate) ? lastNameCandidate : null
  const cpf = typeof source.documentNumber === 'string'
    ? normalizarCPF(source.documentNumber) || null
    : null
  const birthDate = isoBirthDate(source.birthDate)
  const profileIssues: AirTravelerProfileIssue[] = []
  if (!cpf) profileIssues.push('cpf')
  if (!birthDate) profileIssues.push('birth_date')
  if (!firstName) profileIssues.push('first_name')
  if (!lastName) profileIssues.push('last_name')
  const pnrFirstName = firstName ? pnrPart(firstName) : ''
  const pnrLastName = lastName ? pnrPart(lastName) : ''
  if (firstName && !pnrFirstName) profileIssues.push('first_name')
  if (lastName && !pnrLastName) profileIssues.push('last_name')
  const pnrName = pnrFirstName && pnrLastName
    ? `${pnrLastName}/${pnrFirstName}`
    : null
  return { name, firstName, lastName, cpf, birthDate, pnrName, profileIssues }
}

export function airTravelerBirthDateFromMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = metadata as Record<string, unknown>
  return record.birthDate ?? record.birth_date ?? record.data_nascimento ?? null
}

function normalizePersonName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function validNamePart(value: string | undefined): value is string {
  return Boolean(value && /\p{L}/u.test(value))
}

function pnrPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isoBirthDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null
  const today = new Date()
  const todayIso = [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, '0'),
    String(today.getUTCDate()).padStart(2, '0'),
  ].join('-')
  return normalized <= todayIso ? normalized : null
}
