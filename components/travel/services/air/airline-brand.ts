export interface AirlineBrandDefinition {
  /** Current two-character IATA designator used as the canonical registry key. */
  iataCode: string
  name: string
  logoPath: string
  /** Optional brand-safe surface used when the bundled wordmark is light. */
  logoSurfaceColor?: string
}

const AIRLINE_BRANDS = {
  AD: {
    iataCode: 'AD',
    name: 'Azul Linhas Aéreas Brasileiras',
    logoPath: '/airlines/AD.svg',
  },
  G3: {
    iataCode: 'G3',
    name: 'GOL Linhas Aéreas',
    logoPath: '/airlines/G3.svg',
  },
  LA: {
    iataCode: 'LA',
    name: 'LATAM Airlines',
    logoPath: '/airlines/LA.svg',
    // The official bundled wordmark is white and needs the LATAM navy surface.
    logoSurfaceColor: '#1b0088',
  },
} as const satisfies Record<string, AirlineBrandDefinition>

/**
 * Legacy designators remain explicit aliases. The UI never guesses a brand
 * from the carrier name because names entered by consultants are free text.
 */
const AIRLINE_BRAND_ALIASES: Record<string, keyof typeof AIRLINE_BRANDS> = {
  JJ: 'LA',
}

export function normalizeAirlineIataCode(value: string | null | undefined): string {
  return String(value || '').trim().toUpperCase()
}

export function resolveAirlineBrand(value: string | null | undefined): AirlineBrandDefinition | null {
  const normalizedCode = normalizeAirlineIataCode(value)
  const canonicalCode = AIRLINE_BRAND_ALIASES[normalizedCode] || normalizedCode
  return AIRLINE_BRANDS[canonicalCode as keyof typeof AIRLINE_BRANDS] || null
}

export function supportedAirlineBrandCodes(): string[] {
  return [...Object.keys(AIRLINE_BRANDS), ...Object.keys(AIRLINE_BRAND_ALIASES)].sort()
}
