export interface AirlineCatalogItem {
  id: string
  iataCode: string
  icaoCode: string | null
  name: string
  legalName: string | null
  countryCode: string | null
  logoPath: string | null
  logoBackgroundColor: string | null
  aliases: string[]
  isActive: boolean
}

export interface AirlineCatalogSearchResult {
  items: AirlineCatalogItem[]
  total: number
}
