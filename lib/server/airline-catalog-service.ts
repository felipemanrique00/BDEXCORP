import 'server-only'

import type { QueryResultRow } from 'pg'

import { normalizeAirlineSearch } from '@/lib/airlines/normalization'
import { airlineSearchSchema } from '@/lib/airlines/schema'
import type { AirlineCatalogItem, AirlineCatalogSearchResult } from '@/lib/airlines/types'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface AirlineRow extends QueryResultRow {
  id: string
  iata_code: string
  icao_code: string | null
  name: string
  legal_name: string | null
  country_code: string | null
  logo_path: string | null
  logo_background_color: string | null
  aliases: unknown
  is_active: boolean
  total_count: string | number
}

export async function listAirlines(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<AirlineCatalogSearchResult> {
  const query = airlineSearchSchema.parse(rawQuery)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = []
    const clauses = [query.includeInactive ? 'true' : 'airline.is_active']

    if (query.countryCode) {
      values.push(query.countryCode)
      clauses.push(`upper(airline.country_code::text) = $${values.length}::text`)
    }

    let exactCodePlaceholder = 'null'
    let normalizedPlaceholder = 'null'
    let startsWithCodePlaceholder = 'null'
    let containsPlaceholder = 'null'

    if (query.q) {
      const exactCode = query.q.trim().toUpperCase()
      const normalized = normalizeAirlineSearch(query.q)

      values.push(exactCode)
      exactCodePlaceholder = `$${values.length}::text`
      values.push(normalized)
      normalizedPlaceholder = `$${values.length}::text`
      values.push(`${escapeLike(exactCode)}%`)
      startsWithCodePlaceholder = `$${values.length}::text`
      values.push(`%${escapeLike(normalized)}%`)
      containsPlaceholder = `$${values.length}::text`

      clauses.push(`(
        upper(airline.iata_code::text) = ${exactCodePlaceholder}
        or upper(airline.icao_code::text) = ${exactCodePlaceholder}
        or upper(airline.iata_code::text) like ${startsWithCodePlaceholder} escape '\\'
        or upper(airline.icao_code::text) like ${startsWithCodePlaceholder} escape '\\'
        or airline.normalized_name like ${containsPlaceholder} escape '\\'
        or airline.normalized_legal_name like ${containsPlaceholder} escape '\\'
        or exists (
          select 1 from geo_airline_aliases alias
          where alias.airline_id = airline.id
            and (
              upper(alias.alias) = ${exactCodePlaceholder}
              or alias.normalized_alias like ${containsPlaceholder} escape '\\'
            )
        )
      )`)
    }

    values.push(query.limit, query.offset)
    const result = await client.query<AirlineRow>(
      `select airline.id, airline.iata_code, airline.icao_code, airline.name,
              airline.legal_name, airline.country_code, airline.logo_path,
              airline.logo_background_color, airline.is_active,
              coalesce(alias_list.aliases, '[]'::jsonb) as aliases,
              count(*) over() as total_count
       from geo_airlines airline
       left join lateral (
         select jsonb_agg(alias.alias order by alias.alias_type, alias.alias) as aliases
         from geo_airline_aliases alias
         where alias.airline_id = airline.id
       ) alias_list on true
       where ${clauses.join(' and ')}
       order by
         case
           when ${exactCodePlaceholder} is not null
             and upper(airline.iata_code::text) = ${exactCodePlaceholder} then 0
           when ${exactCodePlaceholder} is not null
             and upper(airline.icao_code::text) = ${exactCodePlaceholder} then 1
           when ${exactCodePlaceholder} is not null and exists (
             select 1 from geo_airline_aliases exact_alias
             where exact_alias.airline_id = airline.id
               and upper(exact_alias.alias) = ${exactCodePlaceholder}
           ) then 2
           when ${normalizedPlaceholder} is not null
             and airline.normalized_name = ${normalizedPlaceholder} then 3
           when ${normalizedPlaceholder} is not null
             and airline.normalized_legal_name = ${normalizedPlaceholder} then 4
           else 10
         end,
         airline.normalized_name,
         airline.iata_code,
         airline.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )

    return {
      items: result.rows.map(mapAirline),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

function mapAirline(row: AirlineRow): AirlineCatalogItem {
  return {
    id: row.id,
    iataCode: row.iata_code.toUpperCase(),
    icaoCode: row.icao_code?.toUpperCase() || null,
    name: row.name,
    legalName: row.legal_name,
    countryCode: row.country_code?.toUpperCase() || null,
    logoPath: row.logo_path,
    logoBackgroundColor: row.logo_background_color,
    aliases: Array.isArray(row.aliases)
      ? row.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    isActive: row.is_active,
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
