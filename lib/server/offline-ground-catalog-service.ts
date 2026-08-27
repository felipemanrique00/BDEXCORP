import 'server-only'

import type { QueryResultRow } from 'pg'

import { resolveAnyEnabledCompanyPortalContextCompanyIds } from '@/lib/server/company-portal-scope-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface RentalLocationRow extends QueryResultRow {
  id: string
  supplier_id: string
  supplier_name: string
  name: string
  city_id: string | null
  city_name: string | null
  address_text: string | null
  airport_iata: string | null
  timezone: string | null
}

interface BusTerminalRow extends QueryResultRow {
  id: string
  name: string
  city_id: string
  city_name: string
  address_text: string | null
  timezone: string | null
}

interface BusRouteRow extends QueryResultRow {
  id: string
  supplier_id: string
  supplier_name: string
  route_code: string
  origin_city_name: string
  destination_city_name: string
}

export async function listVerifiedGroundCatalog(
  principal: RequestPrincipal,
  input: { service: 'car' | 'bus'; q?: string; cityId?: string; limit: number },
) {
  resolveAnyEnabledCompanyPortalContextCompanyIds(principal, 'ver_demandas')
  return withTenantTransaction(principal.tenantId, async (client) => {
    if (input.service === 'car') {
      const values: unknown[] = [principal.tenantId]
      const clauses = [
        'location.tenant_id = $1',
        "location.status = 'active'",
        'location.deleted_at is null',
        "location.review_status = 'verified'",
        "supplier.status = 'active'",
        'supplier.deleted_at is null',
        "supplier.service_types @> array['car']::text[]",
      ]
      addCatalogFilters(values, clauses, input, 'location', 'supplier')
      values.push(input.limit)
      const result = await client.query<RentalLocationRow>(
        `select location.id, location.supplier_id,
                coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
                location.name, location.city_id, city.name as city_name,
                location.address_text, location.airport_iata, location.timezone
         from rental_locations location
         join commercial_suppliers supplier
           on supplier.tenant_id = location.tenant_id and supplier.id = location.supplier_id
         left join geo_cities city on city.id = location.city_id
         where ${clauses.join(' and ')}
         order by supplier_name, city_name nulls last, location.name
         limit $${values.length}`,
        values,
      )
      const suppliers = Array.from(new Map(result.rows.map((row) => [row.supplier_id, {
        id: row.supplier_id,
        name: row.supplier_name,
        service: 'car' as const,
      }])).values())
      return {
        service: 'car' as const,
        suppliers,
        rentalLocations: result.rows.map((row) => ({
          id: row.id,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          name: row.name,
          cityId: row.city_id,
          cityName: row.city_name,
          addressText: row.address_text,
          airportIata: row.airport_iata,
          timezone: row.timezone || 'UTC',
          reviewStatus: 'verified' as const,
        })),
      }
    }

    const values: unknown[] = [principal.tenantId]
    const clauses = [
      'terminal.tenant_id = $1',
      "terminal.status = 'active'",
      'terminal.deleted_at is null',
      "terminal.review_status = 'verified'",
    ]
    addCatalogFilters(values, clauses, input, 'terminal')
    values.push(input.limit)
    const result = await client.query<BusTerminalRow>(
      `select terminal.id, terminal.name, terminal.city_id, city.name as city_name,
              terminal.address_text, terminal.timezone
       from bus_terminals terminal
       join geo_cities city on city.id = terminal.city_id
       where ${clauses.join(' and ')}
       order by city.name, terminal.name
       limit $${values.length}`,
      values,
    )
    const routeResult = await client.query<BusRouteRow>(
      `select route.id, route.supplier_id,
              coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
              route.route_code::text,
              origin_city.name as origin_city_name,
              destination_city.name as destination_city_name
       from bus_routes route
       join commercial_suppliers supplier
         on supplier.tenant_id = route.tenant_id and supplier.id = route.supplier_id
       join geo_cities origin_city on origin_city.id = route.origin_city_id
       join geo_cities destination_city on destination_city.id = route.destination_city_id
       where route.tenant_id = $1 and route.status = 'active' and route.deleted_at is null
         and route.review_status = 'verified'
         and supplier.status = 'active' and supplier.deleted_at is null
         and supplier.service_types @> array['bus']::text[]
       order by supplier_name, origin_city.name, destination_city.name
       limit $2`,
      [principal.tenantId, input.limit],
    )
    const suppliers = Array.from(new Map(routeResult.rows.map((row) => [row.supplier_id, {
      id: row.supplier_id,
      name: row.supplier_name,
      service: 'bus' as const,
    }])).values())
    return {
      service: 'bus' as const,
      suppliers,
      busTerminals: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        cityId: row.city_id,
        cityName: row.city_name,
        addressText: row.address_text,
        timezone: row.timezone || 'UTC',
        reviewStatus: 'verified' as const,
      })),
      busRoutes: routeResult.rows.map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        routeCode: row.route_code,
        label: `${row.origin_city_name} - ${row.destination_city_name}`,
      })),
    }
  })
}

function addCatalogFilters(
  values: unknown[],
  clauses: string[],
  input: { q?: string; cityId?: string },
  itemAlias: string,
  supplierAlias?: string,
) {
  if (input.cityId) {
    values.push(input.cityId)
    clauses.push(`${itemAlias}.city_id = $${values.length}::uuid`)
  }
  if (input.q) {
    values.push(`%${input.q}%`)
    clauses.push(`(${itemAlias}.name ilike $${values.length}
      or coalesce(${itemAlias}.address_text, '') ilike $${values.length}
      ${supplierAlias ? `or coalesce(${supplierAlias}.trade_name, ${supplierAlias}.legal_name) ilike $${values.length}` : ''})`)
  }
}
