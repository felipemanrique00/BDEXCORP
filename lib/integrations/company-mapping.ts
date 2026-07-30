export const TECH_EMISSION_CLIENT_PROVIDER = 'tech_travel_emission_client'

export function normalizeExternalCompanyName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 240)
}
