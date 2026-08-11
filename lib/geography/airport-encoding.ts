const WINDOWS_1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
])

const WINDOWS_1252_APPROXIMATIONS: Record<string, string> = {
  '\u02bb': "'",
  '\u02bc': "'",
  '\u02b9': "'",
  '\u2032': "'",
  '\u2033': '"',
  '\u2212': '-',
  '\u2044': '/',
  '\u00d7': 'x',
  '\u0141': 'L',
  '\u0142': 'l',
  '\u0110': 'D',
  '\u0111': 'd',
  '\u0126': 'H',
  '\u0127': 'h',
  '\u0131': 'i',
}

/**
 * Sanitiza apenas valores que serao enviados ao staging do catalogo quando o
 * PostgreSQL legado usa WIN1252. Para UTF8 o objeto original e devolvido sem
 * copia. A transformacao e deterministica e preserva todos os caracteres que
 * o Windows-1252 representa, inclusive acentos usados em portugues.
 */
export function sanitizeAirportStagePayload<T>(value: T, serverEncoding: string): T {
  if (normalizeServerEncoding(serverEncoding) !== 'WIN1252') return value
  return sanitizeValue(value) as T
}

export function toWindows1252SafeText(value: string): string {
  let output = ''
  for (const character of value) {
    if (isWindows1252Character(character)) {
      output += character
      continue
    }
    const approximation = WINDOWS_1252_APPROXIMATIONS[character]
    if (approximation !== undefined) {
      output += approximation
      continue
    }
    const decomposed = character.normalize('NFKD')
    const representable = [...decomposed]
      .filter((item) => !isCombiningMark(item))
      .map((item) => isWindows1252Character(item) ? item : WINDOWS_1252_APPROXIMATIONS[item] || '')
      .join('')
    output += representable || '?'
  }
  return output
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return toWindows1252SafeText(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]))
  }
  return value
}

function normalizeServerEncoding(value: string): string {
  return value.trim().toUpperCase().replace(/[-_]/g, '')
}

function isWindows1252Character(character: string): boolean {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return true
  if (codePoint <= 0x7f) return true
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true
  return WINDOWS_1252_EXTRA.has(codePoint)
}

function isCombiningMark(character: string): boolean {
  return /\p{Mark}/u.test(character)
}
