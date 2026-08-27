import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { aggregateCompanyPortalTravelOrderStatus } from '@/lib/company-portal-lab/travel-order'
import { sanitizeCorporateDemandServiceDetails } from '@/lib/company-portal-lab/demand-projection'

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

const migration = read('deploy/postgres/migrations/0082_company_portal_multi_service_travel_orders.sql')
const groundMigration = read('deploy/postgres/migrations/0083_company_portal_ground_travel_order_items.sql')
const orderService = read('lib/server/company-portal-travel-order-service.ts')
const requesterSelfProfileService = read('lib/server/requester-self-profile-service.ts')
const groundDemandService = read('lib/server/offline-ground-demand-service.ts')
const demandService = read('lib/server/demand-service.ts')
const demandProjection = read('lib/company-portal-lab/demand-projection.ts')
const orderTypes = read('lib/company-portal-lab/travel-order.ts')

describe('Portal Empresa multi-service travel-order backend', () => {
  it('creates tenant-isolated parent, item, operation and counter tables with company invariants', () => {
    for (const table of [
      'company_portal_travel_order_counters',
      'company_portal_travel_orders',
      'company_portal_travel_order_items',
      'company_portal_travel_order_operations',
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`)
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('unique (tenant_id, id, company_id)')
    expect(migration).toContain('foreign key (tenant_id, order_id, company_id)')
    expect(migration).toContain('requesters_tenant_id_id_company_user_uidx')
    expect(migration).toContain('foreign key (tenant_id, requester_id, company_id, requester_user_id)')
    expect(migration).toContain('foreign key (tenant_id, travel_order_id, travel_order_item_id, company_id)')
    expect(migration).toContain('demands_validate_travel_order_service')
    expect(migration).toContain("then 'air'")
    expect(migration).toContain("then 'hotel'")
    expect(migration).toContain('force row level security')
    expect(migration).toContain("current_setting('app.allow_hidden_travel_order_child', true) = 'true'")
    expect(migration).toContain("visible_order.status = 'submitted'")
  })

  it('keeps legacy demands nullable and uses a non-partial unique key for the child back-reference', () => {
    expect(migration).toContain('add column if not exists travel_order_id uuid')
    expect(migration).toContain('add column if not exists travel_order_item_id uuid')
    expect(migration).toContain('(travel_order_id is null and travel_order_item_id is null)')
    const referencedKey = migration.slice(
      migration.indexOf('create unique index if not exists demands_travel_order_item_demand_uidx'),
      migration.indexOf('create index if not exists demands_travel_order_idx'),
    )
    expect(referencedKey).not.toContain('where travel_order_id')
    expect(migration).toContain('travel_order_items_child_demand_fk')
  })

  it('extends the published air/hotel item domain additively for car and bus', () => {
    expect(migration).toContain("service_type text not null check (service_type in ('air', 'hotel'))")
    expect(groundMigration).toContain('drop constraint if exists company_portal_travel_order_items_service_type_check')
    expect(groundMigration).toContain("check (service_type in ('air', 'hotel', 'car', 'bus'))")
    expect(groundMigration).toContain("then 'car'")
    expect(groundMigration).toContain("then 'bus'")
    expect(orderTypes).toContain("'air' | 'hotel' | 'car' | 'bus'")
  })

  it('uses exact scope and owner-only draft visibility/mutation', () => {
    expect(orderService).toContain("resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas')")
    expect(orderService).toContain("resolveCompanyPortalScopeCompanyIds(principal, scope, 'criar_demandas')")
    expect(orderService).toContain('row.requester_user_id !== principal.user.id')
    expect(orderService).toContain("row.status !== 'submitted'")
    expect(orderService).toContain('requireCorporateOrderOwner(principal)')
  })

  it('binds the parent and every child to the active requester identity', () => {
    expect(orderService).toContain("from requesters\n       where tenant_id = $1 and company_id = $2 and user_id = $3::uuid")
    expect(orderService).toContain('TRAVEL_ORDER_REQUESTER_REQUIRED')
    expect(orderService).toContain('requester.rows[0].id')
    expect(orderService).toContain('return { ...sanitized, solicitante_id: requesterId }')
    expect(orderService).toContain("portal_user.status = 'active'")
    expect(orderService).toContain('membership.id = $4::uuid')
    expect(orderService).toContain('membership.user_id = requesters.user_id')
    expect(orderService).toContain("requester_role.role_key = any(array['company_admin', 'requester', 'readonly']::text[])")
    expect(orderService).toContain('[principal.tenantId, companyId, principal.user.id, principal.membershipId]')
  })

  it('uses the global users identity without inventing a tenant column', () => {
    for (const service of [orderService, requesterSelfProfileService]) {
      expect(service).not.toContain('portal_user.tenant_id')
      expect(service).toContain('portal_user.id = requester')
      expect(service).toContain("portal_user.status = 'active'")
      expect(service).toContain('portal_user.deleted_at is null')
    }
    expect(orderService).toContain('membership.tenant_id = requesters.tenant_id')
    expect(orderService).toContain('membership.id = $4::uuid')
    expect(requesterSelfProfileService).toContain('membership.tenant_id = requester.tenant_id')
    expect(requesterSelfProfileService).toContain('membership.user_id = requester.user_id')
  })

  it('projects the canonical requester only in the private order detail', () => {
    expect(orderTypes).toContain('requester: CompanyPortalTravelOrderRequester')
    expect(orderService).toContain('requester.name as requester_name')
    expect(orderService).toContain('requester.user_id = travel_order.requester_user_id')
    expect(orderService).toContain("requester.status = 'active'")
    expect(orderService).toContain('id: row.requester_id')
    expect(orderService).toContain('name: row.requester_name')
    expect(orderTypes).toContain("Omit<CompanyPortalTravelOrder, 'items'>")
    expect(orderTypes).toContain("'requester'")
  })

  it('stores only a corporate allow-listed snapshot and lists summaries without item payloads', () => {
    expect(orderTypes).toContain("import type { CorporateDemandDetail, CorporateDemandSnapshot }")
    expect(orderTypes).toContain("Omit<CompanyPortalTravelOrder, 'items'>")
    expect(orderService).toContain('sanitizeCompanyPortalDemandCreateInput')
    expect(orderService).toContain("travel_order.status in ('draft', 'submitting')")
    expect(orderService).toContain('projectTravelOrderSummary')
    expect(demandProjection).toContain('travelOrder: item.travelOrder || null')
  })

  it('makes upsert replay stable across server timestamps and captures hotel tariff server-side', () => {
    expect(orderService).toContain('const clientPayloadHash = draftPayloadHash(baseSanitized)')
    expect(orderService).toContain('if (replay)')
    expect(orderService.indexOf('if (replay)', orderService.indexOf('const clientPayloadHash')))
      .toBeLessThan(orderService.indexOf('attachCompanyPortalHotelTariffReference', orderService.indexOf('const clientPayloadHash')))
    expect(orderService).toContain('const { created_at: _createdAt, updated_at: _updatedAt, ...canonical } = value')
    expect(orderService).toContain('attachCompanyPortalHotelTariffReference')
  })

  it('drops arbitrary hotel preference bags and never trusts a client tariff snapshot', () => {
    const sanitized = sanitizeCorporateDemandServiceDetails('hotel', {
      detalhes_hotel: {
        preferences: {
          internalFoo: 'secret',
          token: 'credential',
          contact: { document: '123', nested: { private: true } },
          hotelTariffReference: { catalogHotelId: 'client-controlled' },
        },
      },
    })
    expect(sanitized.detalhes_hotel?.preferences).toEqual({})
  })

  it('drops ground extension bags and canonicalizes identities and catalog facts server-side', () => {
    const car = sanitizeCorporateDemandServiceDetails('car', {
      detalhes_carro: {
        ground: {
          pickupLocationId: 'pickup',
          returnLocationId: 'return',
          preferences: { token: 'credential', internalFoo: true },
        },
        primary_driver: { employee_id: 'employee', name: 'forged', token: 'credential' },
      },
    })
    const bus = sanitizeCorporateDemandServiceDetails('bus', {
      detalhes_rodoviario: {
        ground: { legs: [], preferences: { token: 'credential' } },
        travelers: [{ employee_id: 'employee', name: 'forged', document: 'secret' }],
        leg_snapshots: [{ origin_city_name: 'forged', internalFoo: true }],
      },
    })
    expect(car.detalhes_carro?.ground?.preferences).toEqual({})
    expect(car.detalhes_carro?.primary_driver).not.toHaveProperty('token')
    expect(bus.detalhes_rodoviario?.ground?.preferences).toEqual({})
    expect(bus.detalhes_rodoviario?.travelers?.[0]).not.toHaveProperty('document')
    expect(bus.detalhes_rodoviario?.leg_snapshots?.[0]).not.toHaveProperty('internalFoo')
    expect(orderService).toContain('canonicalizePortalGroundDemandInTransaction(client, {')
    expect(groundDemandService).toContain('GROUND_BUS_TERMINAL_CITY_MISMATCH')
    expect(groundDemandService).toContain('supplier.service_types @> array[\'car\']::text[]')
  })

  it('materializes inert children and activates all of them at the parent visibility boundary', () => {
    expect(orderService).toContain('materializeDeferredTravelOrderDemands')
    expect(demandService).toContain('createDemandInTransaction(')
    expect(demandService).toContain('{ orderId: input.orderId, itemId: item.itemId },\n            true,')
    expect(orderService).toContain('activateDeferredTravelOrderDemands')
    expect(demandService).toContain('if (!deferActivation) {\n    await persistLegacyDemandCompatibility')
    expect(demandService).toContain('if (!deferActivation) {\n    await enqueueDemandCreationEvents')
    expect(demandService).toContain("set status = 'submitted', submitted_at = coalesce(submitted_at, now())")
    expect(demandService).toContain('persistLegacyDemandCompatibility(client, principal, legacy)')
    expect(demandService).toContain('enqueueDemandCreationEvents(client, principal, row.id')
    expect(demandService).toContain(':demand:${preparation.relational.id}')
  })

  it('gates hidden children from demand, quote, reservation and automation entry points', () => {
    for (const file of [
      'lib/server/demand-service.ts',
      'lib/server/offline-air-quote-service.ts',
      'lib/server/offline-quote-service.ts',
      'lib/server/offline-ground-quote-service.ts',
      'lib/server/offline-travel-service.ts',
    ]) {
      expect(read(file)).toContain("visible_order.status = 'submitted'")
    }
    for (const file of ['lib/server/automation-worker.ts', 'lib/server/automation-service.ts']) {
      expect(read(file)).toContain("guarded_order.status <> 'submitted'")
    }
  })

  it('aggregates every real lifecycle family and surfaces failures as attention', () => {
    expect(aggregateCompanyPortalTravelOrderStatus('draft', [])).toBe('draft')
    expect(aggregateCompanyPortalTravelOrderStatus('submitting', [])).toBe('submitting')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['pending_merit_approval'])).toBe('awaiting_approval')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['pending_cost_approval'])).toBe('awaiting_approval')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['pending_choice'])).toBe('awaiting_requester')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['reserved', 'issuing'])).toBe('in_progress')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['issued', 'quoting'])).toBe('partially_completed')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['failed', 'quoting'])).toBe('attention')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['canceled', 'refunded'])).toBe('cancelled')
    expect(aggregateCompanyPortalTravelOrderStatus('submitted', ['issued', 'closed'])).toBe('issued')
  })
})
