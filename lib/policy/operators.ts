import type { PolicyCondition, PolicyOperator } from '@/lib/policy/types'

export interface OperatorResult {
  matched: boolean
  observed: unknown
  expected: unknown
  error?: string
}

interface MoneyValue {
  amount: number
  currency: string
}

const COMPARISON_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])

export function evaluateCondition(
  condition: PolicyCondition,
  facts: Record<string, unknown>,
): OperatorResult {
  const observed = getFactValue(facts, condition.fact)
  const expected = condition.valueFrom ? getFactValue(facts, condition.valueFrom) : condition.value

  try {
    return {
      matched: applyOperator(condition.operator, observed, expected, condition.options || {}, facts),
      observed,
      expected,
    }
  } catch (error) {
    return {
      matched: false,
      observed,
      expected,
      error: error instanceof Error ? error.message : 'Falha ao avaliar operador.',
    }
  }
}

export function getFactValue(facts: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(facts, path)) return facts[path]
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[segment]
  }, facts)
}

export function applyOperator(
  operator: PolicyOperator,
  observed: unknown,
  expected: unknown,
  options: Record<string, unknown> = {},
  facts: Record<string, unknown> = {},
): boolean {
  switch (operator) {
    case 'eq': return equalValues(observed, expected)
    case 'neq': return !equalValues(observed, expected)
    case 'in': return asArray(expected).some((item) => equalValues(observed, item))
    case 'not_in': return !asArray(expected).some((item) => equalValues(observed, item))
    case 'gt': return compare(observed, expected) > 0
    case 'gte': return compare(observed, expected) >= 0
    case 'lt': return compare(observed, expected) < 0
    case 'lte': return compare(observed, expected) <= 0
    case 'between': return between(observed, expected)
    case 'contains': return contains(observed, expected)
    case 'not_contains': return !contains(observed, expected)
    case 'starts_with': return String(observed ?? '').startsWith(String(expected ?? ''))
    case 'ends_with': return String(observed ?? '').endsWith(String(expected ?? ''))
    case 'exists': return observed !== undefined && observed !== null && observed !== ''
    case 'not_exists': return observed === undefined || observed === null || observed === ''
    case 'before': return dateNumber(observed) < dateNumber(expected)
    case 'after': return dateNumber(observed) > dateNumber(expected)
    case 'date_between': return dateBetween(observed, expected)
    case 'time_between': return timeBetween(observed, expected)
    case 'day_of_week': return dayOfWeek(observed, expected, options)
    case 'matches_safe_pattern': return safePattern(observed, expected, options)
    case 'within_percentage': return percentageDistance(observed, expected, options) <= percentageTolerance(expected, options)
    case 'outside_percentage': return percentageDistance(observed, expected, options) > percentageTolerance(expected, options)
    case 'distance_greater_than': return finiteNumber(observed, 'distancia observada') > finiteNumber(expected, 'distancia limite')
    case 'duration_greater_than': return finiteNumber(observed, 'duracao observada') > finiteNumber(expected, 'duracao limite')
    case 'currency_compare': return currencyCompare(observed, expected, options, facts)
  }
}

function equalValues(left: unknown, right: unknown): boolean {
  const leftNumber = numericValue(left)
  const rightNumber = numericValue(right)
  if (leftNumber !== null && rightNumber !== null && (typeof left === 'number' || typeof right === 'number')) {
    return leftNumber === rightNumber
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return stableStringify(left) === stableStringify(right)
  }
  return left === right
}

function compare(left: unknown, right: unknown): number {
  const leftNumber = numericValue(left)
  const rightNumber = numericValue(right)
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
  if (isDateLike(left) && isDateLike(right)) return dateNumber(left) - dateNumber(right)
  return String(left ?? '').localeCompare(String(right ?? ''), 'pt-BR')
}

function between(observed: unknown, expected: unknown): boolean {
  const range = asArray(expected)
  if (range.length !== 2) throw new Error('between exige exatamente dois limites.')
  return compare(observed, range[0]) >= 0 && compare(observed, range[1]) <= 0
}

function contains(observed: unknown, expected: unknown): boolean {
  if (Array.isArray(observed)) return observed.some((item) => equalValues(item, expected))
  return String(observed ?? '').includes(String(expected ?? ''))
}

function dateBetween(observed: unknown, expected: unknown): boolean {
  const range = asArray(expected)
  if (range.length !== 2) throw new Error('date_between exige inicio e fim.')
  const value = dateNumber(observed)
  return value >= dateNumber(range[0]) && value <= dateNumber(range[1])
}

function timeBetween(observed: unknown, expected: unknown): boolean {
  const range = asArray(expected)
  if (range.length !== 2) throw new Error('time_between exige inicio e fim.')
  const value = minutesOfDay(observed)
  const start = minutesOfDay(range[0])
  const end = minutesOfDay(range[1])
  return start <= end ? value >= start && value <= end : value >= start || value <= end
}

function dayOfWeek(observed: unknown, expected: unknown, options: Record<string, unknown>): boolean {
  const timezone = typeof options.timezone === 'string' ? options.timezone : 'UTC'
  const date = parsedDate(observed)
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
    .format(date)
    .toLowerCase()
  const aliases: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  return asArray(expected).some((candidate) => (
    typeof candidate === 'number' ? candidate === aliases[day] : String(candidate).slice(0, 3).toLowerCase() === day
  ))
}

function safePattern(observed: unknown, expected: unknown, options: Record<string, unknown>): boolean {
  const pattern = String(expected ?? '')
  if (!pattern || pattern.length > 128) throw new Error('Padrao vazio ou acima de 128 caracteres.')
  if (/\\[1-9]|\(\?<?[=!]|\(\?>/.test(pattern)) throw new Error('Padrao contem recurso nao permitido.')
  if (/\([^)]*[+*][^)]*\)[+*{]|(?:\.\*|\.\+){2,}/.test(pattern)) throw new Error('Padrao potencialmente inseguro.')
  const flags = options.caseInsensitive === true ? 'iu' : 'u'
  return new RegExp(pattern, flags).test(String(observed ?? ''))
}

function percentageDistance(observed: unknown, expected: unknown, options: Record<string, unknown>): number {
  const observedNumber = finiteNumber(observed, 'valor observado')
  const reference = percentageReference(expected, options)
  if (reference === 0) return observedNumber === 0 ? 0 : Number.POSITIVE_INFINITY
  return Math.abs((observedNumber - reference) / reference) * 100
}

function percentageReference(expected: unknown, options: Record<string, unknown>): number {
  if (isRecord(expected) && expected.reference !== undefined) return finiteNumber(expected.reference, 'referencia percentual')
  if (options.reference !== undefined) return finiteNumber(options.reference, 'referencia percentual')
  return finiteNumber(expected, 'referencia percentual')
}

function percentageTolerance(expected: unknown, options: Record<string, unknown>): number {
  const value = isRecord(expected) && expected.tolerancePct !== undefined
    ? expected.tolerancePct
    : options.tolerancePct
  const tolerance = finiteNumber(value, 'tolerancia percentual')
  if (tolerance < 0) throw new Error('Tolerancia percentual nao pode ser negativa.')
  return tolerance
}

function currencyCompare(
  observed: unknown,
  expected: unknown,
  options: Record<string, unknown>,
  facts: Record<string, unknown>,
): boolean {
  const left = moneyValue(observed, options.observedCurrency)
  const right = moneyValue(expected, options.expectedCurrency)
  const targetCurrency = String(options.targetCurrency || right.currency).toUpperCase()
  const rates = options.ratesFact && typeof options.ratesFact === 'string'
    ? getFactValue(facts, options.ratesFact)
    : getFactValue(facts, 'finance.exchangeRates')
  const leftAmount = convertCurrency(left, targetCurrency, rates)
  const rightAmount = convertCurrency(right, targetCurrency, rates)
  const comparison = String(options.comparison || 'lte')
  if (!COMPARISON_OPERATORS.has(comparison)) throw new Error('Comparacao monetaria invalida.')
  return applyOperator(comparison as PolicyOperator, leftAmount, rightAmount)
}

function convertCurrency(value: MoneyValue, target: string, rates: unknown): number {
  if (value.currency === target) return value.amount
  if (!isRecord(rates)) throw new Error(`Taxa ${value.currency}/${target} nao disponivel.`)
  const direct = Number(rates[`${value.currency}/${target}`])
  if (Number.isFinite(direct) && direct > 0) return value.amount * direct
  const inverse = Number(rates[`${target}/${value.currency}`])
  if (Number.isFinite(inverse) && inverse > 0) return value.amount / inverse
  throw new Error(`Taxa ${value.currency}/${target} nao disponivel.`)
}

function moneyValue(value: unknown, currencyHint: unknown): MoneyValue {
  if (isRecord(value)) {
    const amount = finiteNumber(value.amount, 'valor monetario')
    const currency = String(value.currency || currencyHint || '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Moeda monetaria invalida.')
    return { amount, currency }
  }
  const currency = String(currencyHint || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Moeda monetaria ausente.')
  return { amount: finiteNumber(value, 'valor monetario'), currency }
}

function dateNumber(value: unknown): number {
  return parsedDate(value).getTime()
}

function parsedDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) throw new Error('Data invalida.')
  return date
}

function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
}

function minutesOfDay(value: unknown): number {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) throw new Error('Horario invalido.')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error('Horario invalido.')
  return hour * 60 + minute
}

function finiteNumber(value: unknown, label: string): number {
  const result = numericValue(value)
  if (result === null) throw new Error(`${label} deve ser numerico.`)
  return result
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Operador exige uma lista.')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}
