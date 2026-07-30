export const UNIVERSAL_SEARCH_KINDS = [
  'group',
  'company',
  'employee',
  'hotel',
  'demand',
  'reservation',
  'emission',
  'voucher',
  'policy',
  'workflow',
] as const

export type UniversalSearchKind = (typeof UNIVERSAL_SEARCH_KINDS)[number]

export interface UniversalSearchItem {
  kind: UniversalSearchKind
  id: string
  title: string
  subtitle: string
  detail: string | null
  href: string
  companyId: string | null
  companyName: string | null
  groupId: string | null
  groupName: string | null
}

export interface UniversalSearchResult {
  query: string
  items: UniversalSearchItem[]
  total: number
}
