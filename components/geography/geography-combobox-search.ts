export interface GeographyComboboxOption {
  value: string
  label: string
  keywords?: string[]
}

export function filterGeographyOptions(
  options: GeographyComboboxOption[],
  query: string,
): GeographyComboboxOption[] {
  const tokens = normalizeGeographySearch(query).split(' ').filter(Boolean)
  if (!tokens.length) return options
  return options.filter((option) => {
    const searchable = normalizeGeographySearch([option.label, ...(option.keywords || [])].join(' '))
    const words = searchable.split(' ').filter(Boolean)
    return tokens.every((token) => token.length <= 2
      ? words.some((word) => word.startsWith(token))
      : searchable.includes(token))
  })
}

export function normalizeGeographySearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ')
}
