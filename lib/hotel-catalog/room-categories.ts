/**
 * Categorias comerciais padronizadas para tipos de quarto.
 *
 * A ocupacao (single, double, twin etc.) continua sendo representada por
 * `occupancyType`. Esta lista descreve a categoria comercial da acomodacao.
 */
export const HOTEL_ROOM_CATEGORIES = [
  'Qualquer',
  'Standard',
  'Executivo',
  'Superior',
  'Luxo',
  'Super Luxo',
  'Standard com Café da Manhã',
  'Executivo com Café da Manhã',
  'Luxo com Café da Manhã',
] as const

export type HotelRoomCategory = typeof HOTEL_ROOM_CATEGORIES[number]

const HOTEL_ROOM_CATEGORY_BY_NORMALIZED_NAME = new Map<string, HotelRoomCategory>(
  HOTEL_ROOM_CATEGORIES.map((category) => [comparisonKey(category), category]),
)

/**
 * Retorna a categoria canonica quando o texto representa exatamente uma das
 * opcoes conhecidas, desconsiderando caixa, acentos e espacos repetidos.
 * Valores historicos mais especificos nao sao inferidos ou reclassificados.
 */
export function resolveCanonicalHotelRoomCategory(value: string): HotelRoomCategory | null {
  return HOTEL_ROOM_CATEGORY_BY_NORMALIZED_NAME.get(comparisonKey(value)) ?? null
}

/**
 * Normaliza opcoes conhecidas e preserva, sem reclassificacao, categorias
 * legadas. Isso permite evoluir o catalogo sem invalidar dados existentes.
 */
export function normalizeHotelRoomCategoryName(value: string): string {
  const trimmed = value.trim()
  return resolveCanonicalHotelRoomCategory(trimmed) ?? trimmed
}

export function isCanonicalHotelRoomCategory(value: string): value is HotelRoomCategory {
  return (HOTEL_ROOM_CATEGORIES as readonly string[]).includes(value)
}

function comparisonKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}
