import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderItem,
  CompanyPortalTravelOrderListFilters,
  CompanyPortalTravelOrderScope,
  CompanyPortalTravelOrderSummary,
  TravelOrderServiceType,
} from '@/lib/company-portal-lab/travel-order'
import { aggregateCompanyPortalTravelOrderStatus } from '@/lib/company-portal-lab/travel-order'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import { stableStringify } from '@/lib/policy/evaluator'
import { writeAuditEventInTransaction } from '@/lib/server/audit-log'
import {
  getScopedCompanyPortalDemand,
  sanitizeCompanyPortalDemandCreateInput,
} from '@/lib/server/company-portal-demand-service'
import { attachCompanyPortalHotelTariffReference } from '@/lib/server/company-portal-hotel-tariff-service'
import {
  canonicalizePortalGroundDemandInTransaction,
  OfflineGroundDemandServiceError,
} from '@/lib/server/offline-ground-demand-service'
import {
  DemandServiceError,
  validateRelationalDemandCreationInput,
  activateDeferredTravelOrderDemands,
  materializeDeferredTravelOrderDemands,
} from '@/lib/server/demand-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  resolveCompanyPortalScopeCompanyIds,
  type CompanyPortalScope,
} from '@/lib/server/company-portal-scope-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { isRequesterReadPrincipal } from '@/lib/server/requester-read-scope'
import type { Permissoes } from '@/types'
import { userAccessKind } from '@/lib/user-access-kind'

interface TravelOrderRow extends QueryResultRow {
  id: string
  company_id: string
  company_name: string
  requester_id: string
  requester_name: string
  requester_user_id: string
  requester_membership_id: string
  order_number: string
  status: 'draft' | 'submitting' | 'submitted'
  version: string | number
  submit_idempotency_key: string | null
  submit_input_hash: string | null
  submitted_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  item_count?: string | number
  services?: string[]
}

interface TravelOrderItemRow extends QueryResultRow {
  id: string
  order_id: string
  company_id: string
  service_type: TravelOrderServiceType
  position: string | number
  demand_payload: Record<string, unknown>
  payload_hash: string
  completeness_issues: unknown
  child_demand_id: string | null
  version: string | number
  created_at: Date | string
  updated_at: Date | string
}

interface TravelOrderOperationRow extends QueryResultRow {
  idempotency_key: string
  input_hash: string
  operation: 'create' | 'reorder' | 'item_upsert' | 'item_delete' | 'submit'
  order_id: string
  item_id: string | null
  actor_user_id: string
}

interface ParsedUpsertInput {
  itemId?: string
  serviceType: TravelOrderServiceType
  demand: Record<string, unknown>
  expectedVersion?: number
  idempotencyKey?: string
}

export class CompanyPortalTravelOrderError extends DemandServiceError {
  constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) {
    super(code, message, status, details)
    this.name = 'CompanyPortalTravelOrderError'
  }
}

export async function listCompanyPortalTravelOrders(
  principal: RequestPrincipal,
  filters: CompanyPortalTravelOrderListFilters = {},
): Promise<{ items: CompanyPortalTravelOrderSummary[]; total: number }> {
  const { scopeType, scopeId, companyId, status, search, limit, offset } = filters
  const companyIds = resolveReadCompanyIds(principal, { scopeType, scopeId, companyId })
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, companyIds, principal.user.id]
    const clauses = [
      'travel_order.tenant_id = $1',
      'travel_order.company_id = any($2::text[])',
      ownerVisibilitySql(principal, 'travel_order', '$3'),
    ]
    if (status) {
      values.push(status)
      clauses.push(`travel_order.status = $${values.length}`)
    } else {
      // Submitted orders are represented by their linked demand rows on the
      // Kanban. This endpoint lists only private/recoverable drafts by default.
      clauses.push(`travel_order.status in ('draft', 'submitting')`)
    }
    if (search?.trim()) {
      values.push(`%${search.trim()}%`)
      clauses.push(`(
        travel_order.order_number ilike $${values.length}
        or coalesce(company.trade_name, company.legal_name) ilike $${values.length}
      )`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from company_portal_travel_orders travel_order
       join companies company
         on company.tenant_id = travel_order.tenant_id
        and company.id = travel_order.company_id
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, limit || 50)), Math.max(0, offset || 0))
    const rows = await client.query<TravelOrderRow>(
      `select travel_order.*,
              coalesce(company.trade_name, company.legal_name) as company_name,
              coalesce(item_summary.item_count, 0) as item_count,
              coalesce(item_summary.services, '{}'::text[]) as services
       from company_portal_travel_orders travel_order
       join companies company
         on company.tenant_id = travel_order.tenant_id
        and company.id = travel_order.company_id
       left join lateral (
         select count(*)::integer as item_count,
                array_agg(item.service_type order by item.position) as services
         from company_portal_travel_order_items item
         where item.tenant_id = travel_order.tenant_id and item.order_id = travel_order.id
       ) item_summary on true
       where ${clauses.join(' and ')}
       order by travel_order.updated_at desc, travel_order.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { rows: rows.rows, total: Number(count.rows[0]?.total || 0) }
  })
  return {
    items: result.rows.map((row) => projectTravelOrderSummary(principal, row)),
    total: result.total,
  }
}

export async function getCompanyPortalTravelOrder(
  principal: RequestPrincipal,
  rawOrderId: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrder> {
  const orderId = uuid(rawOrderId, 'TRAVEL_ORDER_ID_INVALID')
  const companyIds = resolveReadCompanyIds(principal, scope)
  const row = await withTenantTransaction(principal.tenantId, (client) => (
    loadVisibleOrder(client, principal, orderId, companyIds, false)
  ))
  return projectTravelOrder(principal, row, scope)
}

export async function createCompanyPortalTravelOrder(
  principal: RequestPrincipal,
  rawInput: unknown,
  rawIdempotencyKey: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<{ order: CompanyPortalTravelOrder; replayed: boolean }> {
  const source = record(rawInput)
  requireCorporateOrderOwner(principal)
  const companyId = requiredText(source.companyId, 'TRAVEL_ORDER_COMPANY_REQUIRED')
  const idempotencyKey = operationKey(rawIdempotencyKey, source.idempotencyKey)
  const companyIds = resolveWriteCompanyIds(principal, scope)
  if (!companyIds.includes(companyId)) throw orderNotFound()
  const inputHash = hash({ operation: 'create', companyId })

  const mutation = async () => withTenantTransaction(principal.tenantId, async (client) => {
    const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
    if (replay) {
      assertOperationReplay(replay, principal, 'create', inputHash)
      return { orderId: replay.order_id, replayed: true }
    }
    const requester = await client.query<{ id: string }>(
      `select id
       from requesters
       where tenant_id = $1 and company_id = $2 and user_id = $3::uuid
         and status = 'active' and deleted_at is null
         and exists (
           select 1
           from users portal_user
           where portal_user.id = requesters.user_id
             and portal_user.status = 'active'
             and portal_user.deleted_at is null
         )
         and exists (
           select 1
           from tenant_memberships membership
           join roles requester_role
             on requester_role.id = membership.role_id
            and (requester_role.tenant_id = membership.tenant_id or requester_role.tenant_id is null)
            and requester_role.role_key = any(array['company_admin', 'requester', 'readonly']::text[])
           where membership.tenant_id = requesters.tenant_id
             and membership.id = $4::uuid
             and membership.user_id = requesters.user_id
             and membership.status = 'active'
         )
       order by updated_at desc, id
       limit 1
       for key share`,
      [principal.tenantId, companyId, principal.user.id, principal.membershipId],
    )
    if (!requester.rows[0]) {
      throw new CompanyPortalTravelOrderError(
        'TRAVEL_ORDER_REQUESTER_REQUIRED',
        'Seu usuario precisa estar vinculado como solicitante ativo desta empresa.',
        422,
      )
    }
    const counter = await client.query<{ order_year: number; next_value: string }>(
      `insert into company_portal_travel_order_counters (tenant_id, order_year, last_value)
       values ($1, extract(year from current_date)::integer, 1)
       on conflict (tenant_id, order_year) do update
         set last_value = company_portal_travel_order_counters.last_value + 1
       returning order_year, last_value::text as next_value`,
      [principal.tenantId],
    )
    const orderNumber = `PED-${counter.rows[0]!.order_year}-${String(counter.rows[0]!.next_value).padStart(6, '0')}`
    const orderId = randomUUID()
    await client.query(
      `insert into company_portal_travel_orders (
         id, tenant_id, company_id, requester_id, requester_user_id,
         requester_membership_id, order_number, status, version
       ) values ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7, 'draft', 1)`,
      [
        orderId, principal.tenantId, companyId, requester.rows[0].id,
        principal.user.id, principal.membershipId, orderNumber,
      ],
    )
    await recordOperation(client, principal, {
      idempotencyKey, inputHash, operation: 'create', orderId, itemId: null,
    })
    await auditOrderInTransaction(client, principal, 'travel.order.create', orderId)
    return { orderId, replayed: false }
  })

  let result: { orderId: string; replayed: boolean }
  try {
    result = await mutation()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    result = await withTenantTransaction(principal.tenantId, async (client) => {
      const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
      if (!replay) throw idempotencyConflict()
      assertOperationReplay(replay, principal, 'create', inputHash)
      return { orderId: replay.order_id, replayed: true }
    })
  }
  const order = await getCompanyPortalTravelOrder(principal, result.orderId, scope)
  return { order, replayed: result.replayed }
}

export async function updateCompanyPortalTravelOrder(
  principal: RequestPrincipal,
  rawOrderId: string,
  rawInput: unknown,
  rawIdempotencyKey: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<{ order: CompanyPortalTravelOrder; replayed: boolean }> {
  const orderId = uuid(rawOrderId, 'TRAVEL_ORDER_ID_INVALID')
  const source = record(rawInput)
  const expectedVersion = positiveInteger(source.expectedVersion, 'TRAVEL_ORDER_VERSION_INVALID')
  const itemOrder = stringArray(source.itemOrder).map((id) => uuid(id, 'TRAVEL_ORDER_ITEM_ID_INVALID'))
  const idempotencyKey = operationKey(rawIdempotencyKey, source.idempotencyKey)
  const companyIds = resolveWriteCompanyIds(principal, scope)
  const inputHash = hash({ operation: 'reorder', orderId, expectedVersion, itemOrder })
  const replayed = await withTenantTransaction(principal.tenantId, async (client) => {
    const row = await loadVisibleOrder(client, principal, orderId, companyIds, true, true)
    const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
    if (replay) {
      assertOperationReplay(replay, principal, 'reorder', inputHash, orderId)
      return true
    }
    requireEditable(row)
    assertVersion(row.version, expectedVersion)
    const items = await loadOrderItems(client, principal.tenantId, orderId)
    if (!sameIds(items.map((item) => item.id), itemOrder)) {
      throw new CompanyPortalTravelOrderError(
        'TRAVEL_ORDER_ITEM_ORDER_INVALID',
        'A ordenacao precisa conter exatamente todos os servicos do pedido.',
        422,
      )
    }
    if (items.length) {
      await client.query(
        `update company_portal_travel_order_items
         set position = position + 16
         where tenant_id = $1 and order_id = $2`,
        [principal.tenantId, orderId],
      )
      for (let index = 0; index < itemOrder.length; index += 1) {
        await client.query(
          `update company_portal_travel_order_items
           set position = $4, version = version + 1
           where tenant_id = $1 and order_id = $2 and id = $3::uuid`,
          [principal.tenantId, orderId, itemOrder[index], index + 1],
        )
      }
    }
    await client.query(
      `update company_portal_travel_orders set version = version + 1
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, orderId],
    )
    await recordOperation(client, principal, {
      idempotencyKey, inputHash, operation: 'reorder', orderId, itemId: null,
    })
    await auditOrderInTransaction(client, principal, 'travel.order.reorder', orderId)
    return false
  })
  const order = await getCompanyPortalTravelOrder(principal, orderId, scope)
  return { order, replayed }
}

export async function upsertCompanyPortalTravelOrderItem(
  principal: RequestPrincipal,
  rawOrderId: string,
  rawInput: unknown,
  rawIdempotencyKey: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<{ order: CompanyPortalTravelOrder; replayed: boolean }> {
  const orderId = uuid(rawOrderId, 'TRAVEL_ORDER_ID_INVALID')
  const input = parseUpsertInput(rawInput)
  const idempotencyKey = operationKey(rawIdempotencyKey, input.idempotencyKey)
  const companyIds = resolveWriteCompanyIds(principal, scope)

  const performUpsert = () => withTenantTransaction(principal.tenantId, async (client) => {
      const order = await loadVisibleOrder(client, principal, orderId, companyIds, true, true)
      const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
      const currentByService = await loadOrderItemByService(
        client, principal.tenantId, orderId, input.serviceType,
      )
      const effectiveItemId = input.itemId || replay?.item_id || currentByService?.id || randomUUID()
      if (input.itemId && currentByService && currentByService.id !== input.itemId) {
        throw new CompanyPortalTravelOrderError(
          'TRAVEL_ORDER_SERVICE_ALREADY_EXISTS',
          'Este servico ja foi adicionado ao pedido.',
          409,
        )
      }
      const baseSanitized = sanitizeDraftDemand(
        principal, input.demand, order.company_id, order.requester_id,
        input.serviceType, effectiveItemId,
      )
      // Hash only the allow-listed client contribution. Server timestamps and the
      // tariff reference are deliberately outside replay comparison.
      const clientPayloadHash = draftPayloadHash(baseSanitized)
      const inputHash = hash({
        operation: 'item_upsert', orderId, itemId: effectiveItemId,
        serviceType: input.serviceType, expectedVersion: input.expectedVersion || null,
        payloadHash: clientPayloadHash,
      })
      if (replay) {
        assertOperationReplay(replay, principal, 'item_upsert', inputHash, orderId, effectiveItemId)
        return true
      }
      requireEditable(order)
      let sanitized = baseSanitized
      if (input.serviceType === 'hotel') {
        sanitized = {
          ...baseSanitized,
          detalhes_hotel: await attachCompanyPortalHotelTariffReference(
            principal,
            order.company_id,
            baseSanitized.detalhes_hotel,
            scope,
          ),
        }
      } else if (input.serviceType === 'car' || input.serviceType === 'bus') {
        try {
          sanitized = await canonicalizePortalGroundDemandInTransaction(client, {
            tenantId: principal.tenantId,
            companyId: order.company_id,
            service: input.serviceType,
            demand: baseSanitized,
          })
        } catch (error) {
          if (error instanceof OfflineGroundDemandServiceError) {
            throw new CompanyPortalTravelOrderError(
              error.code,
              error.message,
              error.status,
              error.details,
            )
          }
          throw error
        }
      }
      const issues = completenessIssues(input.serviceType, sanitized)
      const payloadHash = hash(sanitized)
      const current = input.itemId
        ? await loadOrderItem(client, principal.tenantId, orderId, input.itemId, true)
        : currentByService
      if (current) {
        if (!input.expectedVersion) {
          throw new CompanyPortalTravelOrderError(
            'TRAVEL_ORDER_ITEM_VERSION_REQUIRED',
            'Atualize a pagina antes de alterar este servico.',
            409,
          )
        }
        assertVersion(current.version, input.expectedVersion)
        await client.query(
          `update company_portal_travel_order_items
           set demand_payload = $4::jsonb, payload_hash = $5,
               completeness_issues = $6::jsonb, version = version + 1
           where tenant_id = $1 and order_id = $2 and id = $3::uuid`,
          [
            principal.tenantId, orderId, current.id, JSON.stringify(sanitized), payloadHash,
            JSON.stringify(issues),
          ],
        )
      } else {
        const position = Number((await client.query<{ position: number }>(
          `select coalesce(max(position), 0)::integer + 1 as position
           from company_portal_travel_order_items where tenant_id = $1 and order_id = $2`,
          [principal.tenantId, orderId],
        )).rows[0]?.position || 1)
        await client.query(
          `insert into company_portal_travel_order_items (
             id, tenant_id, order_id, company_id, service_type, position,
             demand_payload, payload_hash, completeness_issues
           ) values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
          [
            effectiveItemId, principal.tenantId, orderId, order.company_id,
            input.serviceType, position, JSON.stringify(sanitized), payloadHash, JSON.stringify(issues),
          ],
        )
      }
      await client.query(
        `update company_portal_travel_orders set version = version + 1
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, orderId],
      )
      await recordOperation(client, principal, {
        idempotencyKey, inputHash, operation: 'item_upsert', orderId, itemId: effectiveItemId,
      })
      await auditOrderInTransaction(client, principal, 'travel.order.item.upsert', orderId)
      return false
    })
  let replayed: boolean
  try {
    replayed = await performUpsert()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    replayed = await withTenantTransaction(principal.tenantId, async (client) => {
      const order = await loadVisibleOrder(client, principal, orderId, companyIds, true, true)
      const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
      if (!replay?.item_id) throw error
      const baseSanitized = sanitizeDraftDemand(
        principal, input.demand, order.company_id, order.requester_id,
        input.serviceType, replay.item_id,
      )
      const inputHash = hash({
        operation: 'item_upsert', orderId, itemId: replay.item_id,
        serviceType: input.serviceType, expectedVersion: input.expectedVersion || null,
        payloadHash: draftPayloadHash(baseSanitized),
      })
      assertOperationReplay(replay, principal, 'item_upsert', inputHash, orderId, replay.item_id)
      return true
    })
  }
  const order = await getCompanyPortalTravelOrder(principal, orderId, scope)
  return { order, replayed }
}

export async function deleteCompanyPortalTravelOrderItem(
  principal: RequestPrincipal,
  rawOrderId: string,
  rawItemId: string,
  rawInput: unknown,
  rawIdempotencyKey: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<{ order: CompanyPortalTravelOrder; replayed: boolean }> {
  const orderId = uuid(rawOrderId, 'TRAVEL_ORDER_ID_INVALID')
  const itemId = uuid(rawItemId, 'TRAVEL_ORDER_ITEM_ID_INVALID')
  const source = record(rawInput)
  const expectedVersion = positiveInteger(source.expectedVersion, 'TRAVEL_ORDER_ITEM_VERSION_INVALID')
  const idempotencyKey = operationKey(rawIdempotencyKey, source.idempotencyKey)
  const companyIds = resolveWriteCompanyIds(principal, scope)
  const inputHash = hash({ operation: 'item_delete', orderId, itemId, expectedVersion })
  const replayed = await withTenantTransaction(principal.tenantId, async (client) => {
    const order = await loadVisibleOrder(client, principal, orderId, companyIds, true, true)
    const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
    if (replay) {
      assertOperationReplay(replay, principal, 'item_delete', inputHash, orderId, itemId)
      return true
    }
    requireEditable(order)
    const item = await loadOrderItem(client, principal.tenantId, orderId, itemId, true)
    if (!item) throw orderItemNotFound()
    assertVersion(item.version, expectedVersion)
    await client.query(
      `delete from company_portal_travel_order_items
       where tenant_id = $1 and order_id = $2 and id = $3::uuid`,
      [principal.tenantId, orderId, itemId],
    )
    await client.query(
      `update company_portal_travel_orders set version = version + 1
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, orderId],
    )
    await recordOperation(client, principal, {
      idempotencyKey, inputHash, operation: 'item_delete', orderId, itemId,
    })
    await auditOrderInTransaction(client, principal, 'travel.order.item.delete', orderId)
    return false
  })
  const order = await getCompanyPortalTravelOrder(principal, orderId, scope)
  return { order, replayed }
}

export async function submitCompanyPortalTravelOrder(
  principal: RequestPrincipal,
  rawOrderId: string,
  rawInput: unknown,
  rawIdempotencyKey: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<{ order: CompanyPortalTravelOrder; replayed: boolean }> {
  const orderId = uuid(rawOrderId, 'TRAVEL_ORDER_ID_INVALID')
  const source = record(rawInput)
  const expectedVersion = positiveInteger(source.expectedVersion, 'TRAVEL_ORDER_VERSION_INVALID')
  const idempotencyKey = operationKey(rawIdempotencyKey, source.idempotencyKey)
  const companyIds = resolveWriteCompanyIds(principal, scope)

  const preparation = await withTenantTransaction(principal.tenantId, async (client) => {
    const order = await loadVisibleOrder(client, principal, orderId, companyIds, true, true)
    const items = await loadOrderItems(client, principal.tenantId, orderId, true)
    const submitHash = hash({
      operation: 'submit', orderId,
      items: items.map((item) => ({ id: item.id, payloadHash: item.payload_hash })),
    })
    const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
    if (replay) {
      assertOperationReplay(replay, principal, 'submit', submitHash, orderId)
      return { items, submitHash, alreadySubmitted: true }
    }
    // Do not cross the private-draft boundary until every child passes the
    // exact core creation parser. A malformed item therefore remains editable.
    for (const item of items) {
      validateRelationalDemandCreationInput(principal, {
        demand: item.demand_payload,
        submit: true,
      })
    }
    if (order.status === 'submitted') {
      if (order.submit_input_hash !== submitHash) throw idempotencyConflict()
      await recordOperation(client, principal, {
        idempotencyKey, inputHash: submitHash, operation: 'submit', orderId, itemId: null,
      })
      return { items, submitHash, alreadySubmitted: true }
    }
    if (order.status === 'draft') {
      assertVersion(order.version, expectedVersion)
      if (!items.length) {
        throw new CompanyPortalTravelOrderError(
          'TRAVEL_ORDER_EMPTY', 'Adicione ao menos um servico antes de enviar o pedido.', 422,
        )
      }
      const issues = items.flatMap((item) => parseIssues(item.completeness_issues).map((issue) => ({
        itemId: item.id, serviceType: item.service_type, issue,
      })))
      if (issues.length) {
        throw new CompanyPortalTravelOrderError(
          'TRAVEL_ORDER_INCOMPLETE',
          'Revise os dados obrigatorios dos servicos antes de enviar.',
          422,
          { issues },
        )
      }
    } else if (order.submit_input_hash !== submitHash) {
      throw new CompanyPortalTravelOrderError(
        'TRAVEL_ORDER_SUBMIT_CONFLICT',
        'O conteudo do pedido mudou durante o envio.',
        409,
      )
    }
    return { items, submitHash, alreadySubmitted: false }
  })

  if (!preparation.alreadySubmitted) {
    await materializeDeferredTravelOrderDemands(principal, {
      orderId,
      expectedVersion,
      submitIdempotencyKey: idempotencyKey,
      submitInputHash: preparation.submitHash,
      items: preparation.items.map((item) => ({
        itemId: item.id,
        payloadHash: item.payload_hash,
        demand: item.demand_payload,
        idempotencyKey: `travel-order:submit:${orderId}:${item.id}`,
      })),
    })
  }

  await activateDeferredTravelOrderDemands(
    principal,
    orderId,
    `travel-order:${orderId}:activate`,
  )
  let operationReplayed = false
  try {
    operationReplayed = await withTenantTransaction(principal.tenantId, async (client) => {
      const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
      if (!replay) {
        await recordOperation(client, principal, {
          idempotencyKey, inputHash: preparation.submitHash, operation: 'submit', orderId, itemId: null,
        })
        return false
      }
      assertOperationReplay(replay, principal, 'submit', preparation.submitHash, orderId)
      return true
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    operationReplayed = await withTenantTransaction(principal.tenantId, async (client) => {
      const replay = await loadOperation(client, principal.tenantId, idempotencyKey)
      if (!replay) throw error
      assertOperationReplay(replay, principal, 'submit', preparation.submitHash, orderId)
      return true
    })
  }

  const order = await getCompanyPortalTravelOrder(principal, orderId, scope)
  const replayed = preparation.alreadySubmitted || operationReplayed
  return { order, replayed }
}

async function projectTravelOrder(
  principal: RequestPrincipal,
  row: TravelOrderRow,
  scope: CompanyPortalTravelOrderScope,
): Promise<CompanyPortalTravelOrder> {
  const itemRows = await withTenantTransaction(principal.tenantId, (client) => (
    loadOrderItems(client, principal.tenantId, row.id)
  ))
  const items: CompanyPortalTravelOrderItem[] = await Promise.all(itemRows.map(async (item) => ({
    id: item.id,
    serviceType: item.service_type,
    position: Number(item.position),
    version: Number(item.version),
    demand: item.demand_payload as unknown as CorporateDemandSnapshot,
    completeness: {
      complete: parseIssues(item.completeness_issues).length === 0,
      issues: parseIssues(item.completeness_issues),
    },
    childDemandId: item.child_demand_id,
    childDemand: row.status === 'submitted' && item.child_demand_id
      ? await getScopedCompanyPortalDemand(principal, item.child_demand_id, scope)
      : null,
    createdAt: iso(item.created_at),
    updatedAt: iso(item.updated_at),
  })))
  const owner = row.requester_user_id === principal.user.id
  const writeAllowed = companyAllows(principal, row.company_id, 'criar_demandas')
    && companyAllows(principal, row.company_id, 'ver_demandas')
  return {
    id: row.id,
    orderNumber: row.order_number,
    companyId: row.company_id,
    companyName: row.company_name,
    requester: {
      id: row.requester_id,
      name: row.requester_name,
    },
    status: row.status,
    aggregateStatus: aggregateCompanyPortalTravelOrderStatus(
      row.status,
      items.flatMap((item) => item.childDemand?.lifecycleStatus || []),
    ),
    version: Number(row.version),
    services: items.map((item) => item.serviceType),
    itemCount: items.length,
    items,
    capabilities: {
      canEdit: owner && writeAllowed && row.status === 'draft',
      canSubmit: owner && writeAllowed && (row.status === 'draft' || row.status === 'submitting'),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
  }
}

function projectTravelOrderSummary(
  principal: RequestPrincipal,
  row: TravelOrderRow,
): CompanyPortalTravelOrderSummary {
  const owner = row.requester_user_id === principal.user.id
  const writeAllowed = companyAllows(principal, row.company_id, 'criar_demandas')
    && companyAllows(principal, row.company_id, 'ver_demandas')
  const services = (row.services || []).filter(
    (service): service is TravelOrderServiceType => (
      service === 'air' || service === 'hotel' || service === 'car' || service === 'bus'
    ),
  )
  return {
    id: row.id,
    orderNumber: row.order_number,
    companyId: row.company_id,
    companyName: row.company_name,
    status: row.status,
    aggregateStatus: row.status === 'draft' ? 'draft'
      : row.status === 'submitting' ? 'submitting' : 'awaiting_agency',
    version: Number(row.version),
    services,
    itemCount: Number(row.item_count || 0),
    capabilities: {
      canEdit: owner && writeAllowed && row.status === 'draft',
      canSubmit: owner && writeAllowed && (row.status === 'draft' || row.status === 'submitting'),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
  }
}

async function loadVisibleOrder(
  client: PoolClient,
  principal: RequestPrincipal,
  orderId: string,
  companyIds: readonly string[],
  lock: boolean,
  mutation = false,
): Promise<TravelOrderRow> {
  const result = await client.query<TravelOrderRow>(
    `${orderSelectSql()}
     where travel_order.tenant_id = $1
       and travel_order.id = $2::uuid
       and travel_order.company_id = any($3::text[])
     ${lock ? 'for update of travel_order' : ''}`,
    [principal.tenantId, orderId, companyIds],
  )
  const row = result.rows[0]
  if (!row || (mutation && row.requester_user_id !== principal.user.id)
    || (!mutation && !ownerCanRead(principal, row))) {
    throw orderNotFound()
  }
  return row
}

function ownerCanRead(principal: RequestPrincipal, row: TravelOrderRow): boolean {
  if (row.status !== 'submitted') return row.requester_user_id === principal.user.id
  return !isRequesterReadPrincipal(principal) || row.requester_user_id === principal.user.id
}

function ownerVisibilitySql(principal: RequestPrincipal, alias: string, actorBind: string): string {
  return isRequesterReadPrincipal(principal)
    ? `${alias}.requester_user_id = ${actorBind}::uuid`
    : `(${alias}.status = 'submitted' or ${alias}.requester_user_id = ${actorBind}::uuid)`
}

function orderSelectSql(): string {
  return `select travel_order.*,
                 coalesce(company.trade_name, company.legal_name) as company_name,
                 requester.name as requester_name
          from company_portal_travel_orders travel_order
          join companies company
            on company.tenant_id = travel_order.tenant_id
           and company.id = travel_order.company_id
          join requesters requester
            on requester.tenant_id = travel_order.tenant_id
           and requester.id = travel_order.requester_id
           and requester.company_id = travel_order.company_id
           and requester.user_id = travel_order.requester_user_id
           and requester.status = 'active'
           and requester.deleted_at is null`
}

async function loadOrderItems(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  lock = false,
): Promise<TravelOrderItemRow[]> {
  const result = await client.query<TravelOrderItemRow>(
    `select * from company_portal_travel_order_items
     where tenant_id = $1 and order_id = $2::uuid
     order by position, id
     ${lock ? 'for update' : ''}`,
    [tenantId, orderId],
  )
  return result.rows
}

async function loadOrderItem(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  itemId: string,
  lock = false,
): Promise<TravelOrderItemRow | null> {
  const result = await client.query<TravelOrderItemRow>(
    `select * from company_portal_travel_order_items
     where tenant_id = $1 and order_id = $2::uuid and id = $3::uuid
     ${lock ? 'for update' : ''}`,
    [tenantId, orderId, itemId],
  )
  return result.rows[0] || null
}

async function loadOrderItemByService(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  serviceType: TravelOrderServiceType,
): Promise<TravelOrderItemRow | null> {
  const result = await client.query<TravelOrderItemRow>(
    `select * from company_portal_travel_order_items
     where tenant_id = $1 and order_id = $2::uuid and service_type = $3
     for update`,
    [tenantId, orderId, serviceType],
  )
  return result.rows[0] || null
}

async function loadOperation(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<TravelOrderOperationRow | null> {
  const result = await client.query<TravelOrderOperationRow>(
    `select * from company_portal_travel_order_operations
     where tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  )
  return result.rows[0] || null
}

async function recordOperation(
  client: PoolClient,
  principal: RequestPrincipal,
  input: {
    idempotencyKey: string
    inputHash: string
    operation: TravelOrderOperationRow['operation']
    orderId: string
    itemId: string | null
  },
): Promise<void> {
  await client.query(
    `insert into company_portal_travel_order_operations (
       tenant_id, idempotency_key, input_hash, operation,
       order_id, item_id, actor_user_id
     ) values ($1, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid)`,
    [
      principal.tenantId, input.idempotencyKey, input.inputHash, input.operation,
      input.orderId, input.itemId, principal.user.id,
    ],
  )
}

function assertOperationReplay(
  row: TravelOrderOperationRow,
  principal: RequestPrincipal,
  operation: TravelOrderOperationRow['operation'],
  inputHash: string,
  orderId?: string,
  itemId?: string,
): void {
  if (row.actor_user_id !== principal.user.id || row.operation !== operation
    || row.input_hash !== inputHash || (orderId && row.order_id !== orderId)
    || (itemId && row.item_id !== itemId)) {
    throw idempotencyConflict()
  }
}

function sanitizeDraftDemand(
  principal: RequestPrincipal,
  rawDemand: Record<string, unknown>,
  companyId: string,
  requesterId: string,
  serviceType: TravelOrderServiceType,
  itemId: string,
): Record<string, unknown> {
  if (requiredText(rawDemand.empresa_id, 'TRAVEL_ORDER_COMPANY_REQUIRED') !== companyId) {
    throw orderNotFound()
  }
  const normalized = normalizeService(rawDemand.tipo_servico)
  if (normalized !== serviceType) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_ITEM_SERVICE_MISMATCH',
      'O formulario nao corresponde ao tipo de servico selecionado.',
      422,
    )
  }
  const sanitized = sanitizeCompanyPortalDemandCreateInput(principal, {
    demand: {
      ...rawDemand,
      id: `travel-order-item-${itemId}`,
      empresa_id: companyId,
    },
  }).demand
  // The browser sanitizer intentionally removes requester identity for a
  // corporate actor. The parent has already bound this server-owned requester
  // through a composite FK, so reattach only that trusted identifier here.
  return { ...sanitized, solicitante_id: requesterId }
}

function completenessIssues(
  serviceType: TravelOrderServiceType,
  demand: Record<string, unknown>,
): string[] {
  const issues: string[] = []
  if (!requiredOrEmpty(demand.passageiro_nome)) issues.push('Informe o viajante principal.')
  if (serviceType === 'air') {
    const details = optionalRecord(demand.detalhes_aereo)
    const legs = Array.isArray(details?.trechos) ? details!.trechos : []
    const passengers = Array.isArray(details?.passengers) ? details!.passengers : []
    if (!legs.length) issues.push('Adicione ao menos um trecho aereo.')
    if (!passengers.length) issues.push('Adicione ao menos um passageiro.')
  } else if (serviceType === 'hotel') {
    const details = optionalRecord(demand.detalhes_hotel)
    const rooms = Array.isArray(details?.rooms) ? details!.rooms : []
    if (!requiredOrEmpty(details?.city_id) && !requiredOrEmpty(details?.cidade)) {
      issues.push('Informe o destino da hospedagem.')
    }
    if (!requiredOrEmpty(details?.data_checkin) || !requiredOrEmpty(details?.data_checkout)) {
      issues.push('Informe o periodo da hospedagem.')
    }
    if (!rooms.length) issues.push('Adicione ao menos um quarto.')
  } else if (serviceType === 'car') {
    const details = optionalRecord(demand.detalhes_carro)
    const ground = optionalRecord(details?.ground)
    const driver = optionalRecord(details?.primary_driver)
    if (!requiredOrEmpty(ground?.pickupLocationId) && !requiredOrEmpty(ground?.pickupLocationText)) {
      issues.push('Informe a loja ou o local de retirada.')
    }
    if (!requiredOrEmpty(ground?.returnLocationId) && !requiredOrEmpty(ground?.returnLocationText)) {
      issues.push('Informe a loja ou o local de devolucao.')
    }
    if (!requiredOrEmpty(ground?.pickupAt) || !requiredOrEmpty(ground?.returnAt)) {
      issues.push('Informe o periodo da locacao.')
    }
    if (!requiredOrEmpty(driver?.employee_id) || !requiredOrEmpty(driver?.name)) {
      issues.push('Selecione o motorista principal.')
    }
  } else {
    const details = optionalRecord(demand.detalhes_rodoviario)
    const ground = optionalRecord(details?.ground)
    const legs = Array.isArray(ground?.legs) ? ground.legs : []
    const travelers = Array.isArray(details?.travelers) ? details.travelers : []
    const snapshots = Array.isArray(details?.leg_snapshots) ? details.leg_snapshots : []
    if (!legs.length) issues.push('Adicione ao menos um trecho rodoviario.')
    if (!travelers.length) issues.push('Adicione ao menos um viajante.')
    if (snapshots.length !== legs.length) issues.push('Revise as origens e destinos dos trechos.')
  }
  return issues
}

function normalizeService(value: unknown): TravelOrderServiceType | null {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (normalized === 'air' || normalized === 'aereo') return 'air'
  if (['hotel', 'hotelaria', 'hospedagem'].includes(normalized)) return 'hotel'
  if (['car', 'carro', 'locacao', 'locacao de veiculo'].includes(normalized)) return 'car'
  if (['bus', 'rodoviario', 'onibus', 'passagem rodoviaria'].includes(normalized)) return 'bus'
  return null
}

function parseUpsertInput(rawInput: unknown): ParsedUpsertInput {
  const source = record(rawInput)
  const serviceType = source.serviceType
  if (!['air', 'hotel', 'car', 'bus'].includes(String(serviceType))) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_SERVICE_INVALID',
      'O pedido aceita aereo, hotel, locacao ou rodoviario.',
      422,
    )
  }
  return {
    itemId: source.itemId === undefined ? undefined : uuid(source.itemId, 'TRAVEL_ORDER_ITEM_ID_INVALID'),
    serviceType: serviceType as TravelOrderServiceType,
    demand: record(source.demand),
    expectedVersion: source.expectedVersion === undefined
      ? undefined
      : positiveInteger(source.expectedVersion, 'TRAVEL_ORDER_ITEM_VERSION_INVALID'),
    idempotencyKey: optionalText(source.idempotencyKey) || undefined,
  }
}

function resolveReadCompanyIds(principal: RequestPrincipal, scope: CompanyPortalScope): string[] {
  try {
    return resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas')
  } catch (error) {
    throw normalizeScopeError(error)
  }
}

function resolveWriteCompanyIds(principal: RequestPrincipal, scope: CompanyPortalScope): string[] {
  try {
    const write = resolveCompanyPortalScopeCompanyIds(principal, scope, 'criar_demandas')
    const read = new Set(resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas'))
    const result = write.filter((companyId) => read.has(companyId))
    if (!result.length) throw orderNotFound()
    return result
  } catch (error) {
    throw normalizeScopeError(error)
  }
}

function normalizeScopeError(error: unknown): unknown {
  return error instanceof DemandServiceError
    ? error
    : new CompanyPortalTravelOrderError(
        'TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404,
      )
}

function companyAllows(principal: RequestPrincipal, companyId: string, permission: keyof Permissoes): boolean {
  return principal.corporateAccess?.companies.some((company) => (
    company.companyId === companyId && company.permissions[permission] === true
  )) === true
}

function requireCorporateOrderOwner(principal: RequestPrincipal): void {
  if (userAccessKind(principal.user) !== 'corporate') {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_CORPORATE_OWNER_REQUIRED',
      'O pedido conjunto deve ser iniciado pelo solicitante do Portal Empresa.',
      403,
    )
  }
}

function requireEditable(row: TravelOrderRow): void {
  if (row.status !== 'draft') {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_LOCKED',
      'Os dados ficam bloqueados depois do inicio do envio para a agencia.',
      409,
    )
  }
}

function assertVersion(actual: string | number, expected: number): void {
  if (Number(actual) !== expected) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_VERSION_CONFLICT',
      'O pedido foi alterado em outra sessao. Atualize a pagina e tente novamente.',
      409,
      { expectedVersion: expected, currentVersion: Number(actual) },
    )
  }
}

function operationKey(header: string, body: unknown): string {
  const key = String(header || '').trim()
  if (key.length < 8 || key.length > 200) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_IDEMPOTENCY_INVALID', 'Informe uma chave de idempotencia valida.', 400,
    )
  }
  const bodyKey = optionalText(body)
  if (bodyKey && bodyKey !== key) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_IDEMPOTENCY_MISMATCH',
      'A chave de idempotencia do corpo nao corresponde ao cabecalho.',
      400,
    )
  }
  return key
}

function parseIssues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((issue): issue is string => typeof issue === 'string' && Boolean(issue.trim()))
    : []
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function draftPayloadHash(value: Record<string, unknown>): string {
  const { created_at: _createdAt, updated_at: _updatedAt, ...canonical } = value
  return hash(canonical)
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every((value) => right.includes(value))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_ITEM_ORDER_INVALID', 'A ordenacao dos servicos e invalida.', 400,
    )
  }
  return value
}

function positiveInteger(value: unknown, code: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new CompanyPortalTravelOrderError(code, 'A versao informada e invalida.', 400)
  }
  return number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompanyPortalTravelOrderError(
      'TRAVEL_ORDER_INPUT_INVALID', 'Os dados do pedido sao invalidos.', 400,
    )
  }
  return value as Record<string, unknown>
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredText(value: unknown, code: string): string {
  const text = optionalText(value)
  if (!text) throw new CompanyPortalTravelOrderError(code, 'Preencha os dados obrigatorios.', 400)
  return text
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredOrEmpty(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined
}

function uuid(value: unknown, code: string): string {
  const parsed = optionalText(value)
  if (!parsed || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    throw new CompanyPortalTravelOrderError(code, 'O identificador do pedido e invalido.', 400)
  }
  return parsed.toLowerCase()
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function orderNotFound(): CompanyPortalTravelOrderError {
  return new CompanyPortalTravelOrderError('TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404)
}

function orderItemNotFound(): CompanyPortalTravelOrderError {
  return new CompanyPortalTravelOrderError('TRAVEL_ORDER_ITEM_NOT_FOUND', 'Servico nao encontrado.', 404)
}

function idempotencyConflict(): CompanyPortalTravelOrderError {
  return new CompanyPortalTravelOrderError(
    'TRAVEL_ORDER_IDEMPOTENCY_CONFLICT',
    'A chave de idempotencia ja foi utilizada com outro conteudo.',
    409,
  )
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505')
}

async function auditOrderInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  action: string,
  orderId: string,
): Promise<void> {
  const result = await client.query<{
    company_id: string
    order_number: string
    status: string
    item_count: string | number
  }>(
    `select travel_order.company_id, travel_order.order_number, travel_order.status,
            count(item.id)::integer as item_count
     from company_portal_travel_orders travel_order
     left join company_portal_travel_order_items item
       on item.tenant_id = travel_order.tenant_id and item.order_id = travel_order.id
     where travel_order.tenant_id = $1 and travel_order.id = $2::uuid
     group by travel_order.company_id, travel_order.order_number, travel_order.status`,
    [principal.tenantId, orderId],
  )
  const order = result.rows[0]
  if (!order) throw orderNotFound()
  await writeAuditEventInTransaction(client, {
    action,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.actor?.user.id || principal.user.id,
    entityType: 'travel_order',
    entityId: orderId,
    metadata: {
      companyId: order.company_id,
      orderNumber: order.order_number,
      status: order.status,
      itemCount: Number(order.item_count),
      replayed: false,
    },
  })
}
