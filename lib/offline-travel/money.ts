const MAX_MONEY_MINOR_UNITS = 99_999_999_999_999

/**
 * Converte um valor monetario decimal em centavos sem usar aritmetica de ponto
 * flutuante. Entradas com mais de duas casas decimais sao rejeitadas.
 */
export function moneyToMinorUnits(value: unknown): number {
  const text = normalizeMoneyInput(value)
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text)
  if (!match) throw new Error('Informe um valor monetario com no maximo duas casas decimais.')

  const whole = Number(match[1])
  const fraction = Number((match[2] || '').padEnd(2, '0') || '0')
  const minor = whole * 100 + fraction
  if (!Number.isSafeInteger(minor) || minor > MAX_MONEY_MINOR_UNITS) {
    throw new Error('O valor monetario informado excede o limite permitido.')
  }
  return minor
}

export function minorUnitsToMoney(minorUnits: number): number {
  assertMinorUnits(minorUnits)
  return minorUnits / 100
}

export function formatMinorUnits(minorUnits: number): string {
  assertMinorUnits(minorUnits)
  const whole = Math.floor(minorUnits / 100)
  const fraction = String(minorUnits % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}

export function sumMoneyInputs(gross: unknown, taxes: unknown): string {
  const grossText = String(gross ?? '').trim()
  if (!grossText) return ''
  const taxText = String(taxes ?? '').trim() || '0'
  try {
    return formatMinorUnits(moneyToMinorUnits(grossText) + moneyToMinorUnits(taxText))
  } catch {
    return ''
  }
}

function normalizeMoneyInput(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return ''
    return String(value)
  }
  if (typeof value !== 'string') return ''
  return value.trim()
}

function assertMinorUnits(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_MINOR_UNITS) {
    throw new Error('Valor em centavos invalido.')
  }
}
