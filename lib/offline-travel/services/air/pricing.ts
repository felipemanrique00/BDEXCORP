import { minorUnitsToMoney, moneyToMinorUnits } from '../../money'

export interface AirQuotePricingInput {
  fare: unknown
  taxes?: unknown
  rav?: unknown
  rac?: unknown
}
export interface AirQuotePricing {
  fareMinor: number
  taxesMinor: number
  ravMinor: number
  racMinor: number
  totalMinor: number
  fare: number
  taxes: number
  rav: number
  rac: number
  total: number
}

/**
 * Calcula a composicao auditavel da tarifa aerea. Todos os calculos sao feitos
 * em centavos; valores com mais de duas casas decimais sao rejeitados.
 */
export function calculateAirQuotePricing(input: AirQuotePricingInput): AirQuotePricing {
  const fareMinor = moneyToMinorUnits(input.fare)
  const taxesMinor = moneyToMinorUnits(input.taxes ?? 0)
  const ravMinor = moneyToMinorUnits(input.rav ?? 0)
  const racMinor = moneyToMinorUnits(input.rac ?? 0)
  const totalMinor = fareMinor + taxesMinor + ravMinor + racMinor

  if (!Number.isSafeInteger(totalMinor)) {
    throw new Error('O total da cotacao aerea excede o limite permitido.')
  }

  return {
    fareMinor,
    taxesMinor,
    ravMinor,
    racMinor,
    totalMinor,
    fare: minorUnitsToMoney(fareMinor),
    taxes: minorUnitsToMoney(taxesMinor),
    rav: minorUnitsToMoney(ravMinor),
    rac: minorUnitsToMoney(racMinor),
    total: minorUnitsToMoney(totalMinor),
  }
}
