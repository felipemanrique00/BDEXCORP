import { describe, expect, it } from 'vitest'

import { airportCatalogSyncSchema, airportSearchSchema } from '@/lib/geography/schema'
import { buildAirportLabel, parseOurAirportsCsv } from '@/lib/geography/ourairports'

const CSV = `id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code,home_link,wikipedia_link,keywords
1,SBGR,large_airport,Sao Paulo Guarulhos,-23.435556,-46.473057,2459,SA,BR,BR-SP,Sao Paulo,yes,SBGR,GRU,SP0001,,,Guarulhos International
2,SBGO,medium_airport,Santa Genoveva,-16.631999,-49.220699,2450,SA,BR,BR-GO,Goiania,yes,SBGO,GYN,GO0001,,,Goiania Airport
`

describe('airport catalog contracts', () => {
  it('parses and normalizes an OurAirports CSV without external access', () => {
    const records = parseOurAirportsCsv(CSV)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      providerId: '1',
      canonicalKey: 'iata:GRU',
      iataCode: 'GRU',
      icaoCode: 'SBGR',
      countryCode: 'BR',
      subdivisionCode: 'SP',
      scheduledService: true,
    })
    expect(buildAirportLabel(records[1])).toBe('GYN — Santa Genoveva · Goiania/GO')
  })

  it('validates safe search filters and sync provider', () => {
    expect(airportSearchSchema.parse({ q: 'gyn', countryCode: 'br', scheduledService: 'true' }))
      .toMatchObject({ countryCode: 'BR', scheduledService: true, includeInactive: false })
    expect(airportCatalogSyncSchema.parse({})).toEqual({
      provider: 'ourairports',
      datasetKey: 'airports',
      deactivateMissing: true,
    })
    expect(() => airportSearchSchema.parse({ limit: 101 })).toThrow()
  })
})
