const MAX_DECIMAL_SCALE = 8

export function sanitizeDecimalInput(value: unknown, scale = 2): string {
  const normalizedScale = decimalScale(scale)
  const raw = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/[^0-9.,]/g, '')

  if (!raw) return ''

  const commaIndex = raw.lastIndexOf(',')
  const dotIndex = raw.lastIndexOf('.')
  const separatorIndex = Math.max(commaIndex, dotIndex)
  if (separatorIndex < 0 || normalizedScale === 0) return digits(raw)

  const whole = digits(raw.slice(0, separatorIndex)) || '0'
  const fraction = digits(raw.slice(separatorIndex + 1)).slice(0, normalizedScale)
  return `${whole},${fraction}`
}

export function formatDecimalInput(value: unknown, scale = 2): string {
  const normalizedScale = decimalScale(scale)
  const sanitized = sanitizeDecimalInput(value, normalizedScale)
  if (!sanitized) return ''

  const [rawWhole, rawFraction = ''] = sanitized.split(',')
  const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0'
  if (normalizedScale === 0) return whole
  return `${whole},${rawFraction.padEnd(normalizedScale, '0').slice(0, normalizedScale)}`
}

export function decimalInputToCanonical(value: unknown, scale = 2): string {
  return formatDecimalInput(value, scale).replace(',', '.')
}

export function decimalInputToNumber(value: unknown, scale = 2): number | null {
  const canonical = decimalInputToCanonical(value, scale)
  if (!canonical) return null

  const parsed = Number(canonical)
  return Number.isFinite(parsed) ? parsed : null
}

export function numberToDecimalInput(value: number | null | undefined, scale = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''

  return value.toFixed(decimalScale(scale)).replace('.', ',')
}

export function clampDecimalInputNumber(
  value: number | null,
  minValue?: number,
  maxValue?: number,
): number | null {
  if (value === null) return null

  const minimum = minValue !== undefined && Number.isFinite(minValue) ? minValue : -Infinity
  const maximum = maxValue !== undefined && Number.isFinite(maxValue) ? maxValue : Infinity
  return Math.min(Math.max(value, minimum), maximum)
}

function decimalScale(value: number): number {
  if (!Number.isFinite(value)) return 2
  return Math.min(MAX_DECIMAL_SCALE, Math.max(0, Math.trunc(value)))
}

function digits(value: string): string {
  return value.replace(/\D/g, '')
}
