import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

const migration = source('deploy/postgres/migrations/0082_company_portal_multi_service_travel_orders.sql')
const groundMigration = source('deploy/postgres/migrations/0083_company_portal_ground_travel_order_items.sql')
const orderService = source('lib/server/company-portal-travel-order-service.ts')
const demandService = source('lib/server/demand-service.ts')
const orderContract = source('lib/company-portal-lab/travel-order.ts')
const auditQueryService = source('lib/server/audit-query-service.ts')

function between(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker, start + startMarker.length)
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThanOrEqual(0)
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start)
  return text.slice(start, end)
}

function expectMarkersInOrder(text: string, markers: readonly string[]): void {
  let cursor = -1
  for (const marker of markers) {
    const position = text.indexOf(marker, cursor + 1)
    expect(position, `marcador ausente ou fora de ordem: ${marker}`).toBeGreaterThan(cursor)
    cursor = position
  }
}

function expectSubmittedParentGate(text: string, label: string): void {
  expect(text, label).toMatch(
    /demand\.travel_order_id is null or exists \([\s\S]*?company_portal_travel_orders visible_order[\s\S]*?visible_order\.tenant_id = demand\.tenant_id[\s\S]*?visible_order\.id = demand\.travel_order_id[\s\S]*?visible_order\.status = 'submitted'[\s\S]*?\)/,
  )
}

describe('Pedido pai multi-servico - contratos criticos', () => {
  it('instala as quatro tabelas com isolamento RLS fail-closed por tenant', () => {
    const tables = [
      'company_portal_travel_order_counters',
      'company_portal_travel_orders',
      'company_portal_travel_order_items',
      'company_portal_travel_order_operations',
    ]
    for (const table of tables) {
      expect(migration).toContain(`create table if not exists ${table}`)
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain("execute format('alter table %I enable row level security', target_table)")
    expect(migration).toContain("execute format('alter table %I force row level security', target_table)")
    expect(migration).toContain('create policy tenant_isolation on %I using')
    expect(migration).toContain("current_setting(''app.tenant_id'', true)")
    expect(migration).toContain('with check (tenant_id =')
  })

  it('amarra tenant, empresa, pedido, item e demanda filha com FKs compostas', () => {
    expect(migration).toMatch(
      /foreign key \(tenant_id, requester_membership_id, requester_user_id\)[\s\S]*?references tenant_memberships\(tenant_id, id, user_id\)/,
    )
    expect(migration).toMatch(
      /foreign key \(tenant_id, requester_id, company_id, requester_user_id\)[\s\S]*?references requesters\(tenant_id, id, company_id, user_id\)/,
    )
    expect(migration).toMatch(
      /foreign key \(tenant_id, order_id, company_id\)[\s\S]*?references company_portal_travel_orders\(tenant_id, id, company_id\)/,
    )
    expect(migration).toMatch(
      /demands_travel_order_fk[\s\S]*?foreign key \(tenant_id, travel_order_id, company_id\)[\s\S]*?references company_portal_travel_orders\(tenant_id, id, company_id\)/,
    )
    expect(migration).toMatch(
      /demands_travel_order_item_fk[\s\S]*?foreign key \(tenant_id, travel_order_id, travel_order_item_id, company_id\)[\s\S]*?references company_portal_travel_order_items\(tenant_id, order_id, id, company_id\)/,
    )
    expect(migration).toMatch(
      /travel_order_items_child_demand_fk[\s\S]*?foreign key \(tenant_id, order_id, id, child_demand_id\)[\s\S]*?references demands\(tenant_id, travel_order_id, travel_order_item_id, id\)[\s\S]*?deferrable initially deferred/,
    )
    expect(migration).toContain('(travel_order_id is null and travel_order_item_id is null)')
    expect(migration).toContain('(travel_order_id is not null and travel_order_item_id is not null)')
  })

  it('vincula o solicitante ativo no pai e preserva solicitante_id na demanda filha', () => {
    const createOrder = between(
      orderService,
      'export async function createCompanyPortalTravelOrder(',
      'export async function updateCompanyPortalTravelOrder(',
    )
    const sanitizer = between(
      orderService,
      'function sanitizeDraftDemand(',
      'function completenessIssues(',
    )
    const demandCreation = between(
      demandService,
      'async function createDemandInTransaction(',
      'async function startDemandApproval(',
    )
    const requesterLoader = between(
      demandService,
      'async function loadRequesterForCreate(',
      'async function loadRequesterForUpdate(',
    )

    expect(createOrder).toContain("and status = 'active' and deleted_at is null")
    expect(createOrder).toContain('requester_id, requester_user_id')
    expect(createOrder).toContain('requester.rows[0].id')
    expect(sanitizer).toContain('requesterId: string')
    expect(sanitizer).toContain('return { ...sanitized, solicitante_id: requesterId }')
    expect(requesterLoader).toContain("and status = 'active' and deleted_at is null")
    expect(demandCreation).toContain('snapshot.requesterId')
    expect(demandCreation).toContain('requester?.id || null')
    expect(demandCreation).toContain('...(requester ? { solicitante_id: requester.id } : {})')
    expect(demandCreation).toMatch(
      /insert into demands \([\s\S]*?requester_id[\s\S]*?requester\?\.id \|\| null/,
    )
  })

  it('rejeita no banco uma demanda filha cujo servico diverge do item', () => {
    const triggerFunction = between(
      migration,
      'create or replace function validate_travel_order_child_service()',
      'drop trigger if exists demands_validate_travel_order_service',
    )
    expect(migration).toContain("service_type text not null check (service_type in ('air', 'hotel'))")
    expect(triggerFunction).toContain('item.tenant_id = new.tenant_id')
    expect(triggerFunction).toContain('item.order_id = new.travel_order_id')
    expect(triggerFunction).toContain('item.id = new.travel_order_item_id')
    expect(triggerFunction).toContain('item.company_id = new.company_id')
    expect(triggerFunction).toMatch(/in \('air', 'aereo', U&'a\\00E9reo'\) then 'air'/)
    expect(triggerFunction).toContain("in ('hotel', 'hotelaria', 'hospedagem') then 'hotel'")
    expect(triggerFunction).toContain('normalized_service <> expected_service')
    expect(triggerFunction).toContain("raise exception 'Servico da demanda nao corresponde ao item do pedido.'")
    expect(migration).toMatch(
      /create trigger demands_validate_travel_order_service[\s\S]*?before insert or update of tenant_id, company_id, service_type,[\s\S]*?travel_order_id, travel_order_item_id on demands/,
    )
  })

  it('amplia o dominio do item terrestre sem reescrever a migracao publicada', () => {
    expect(migration).toContain("service_type text not null check (service_type in ('air', 'hotel'))")
    expect(groundMigration).toContain('create or replace function validate_travel_order_child_service()')
    expect(groundMigration).toContain("check (service_type in ('air', 'hotel', 'car', 'bus'))")
    expect(groundMigration).toMatch(/in \([\s\S]*?'car', 'carro', 'locacao',[\s\S]*?\) then 'car'/)
    expect(groundMigration).toMatch(/in \([\s\S]*?'bus', 'rodoviario',[\s\S]*?\) then 'bus'/)
    expect(orderContract).toContain("'air' | 'hotel' | 'car' | 'bus'")
  })

  it('lista por padrao somente drafts recuperaveis e devolve resumo sem itens ou PII', () => {
    const list = between(
      orderService,
      'export async function listCompanyPortalTravelOrders(',
      'export async function getCompanyPortalTravelOrder(',
    )
    const summaryProjector = between(
      orderService,
      'function projectTravelOrderSummary(',
      'async function loadVisibleOrder(',
    )
    const returnedSummary = summaryProjector.slice(summaryProjector.indexOf('return {'))

    expect(list).toContain("travel_order.status in ('draft', 'submitting')")
    expect(list).toContain('projectTravelOrderSummary(principal, row)')
    expect(list).toContain('item_count')
    expect(list).toContain('services')
    expect(list).not.toContain('demand_payload')
    expect(orderContract).toContain("Omit<CompanyPortalTravelOrder, 'items'>")
    expect(returnedSummary).not.toMatch(/\bitems\s*:/)
    expect(returnedSummary).not.toMatch(/\bdemand\s*:/)
    expect(returnedSummary).not.toMatch(/\brequester(?:User)?Id\s*:/i)
    expect(returnedSummary).not.toMatch(/\bpassenger|\btraveler|\bhospede/i)
  })

  it('mantem os eventos de rascunho fora da auditoria interna ate a publicacao', () => {
    expect(orderService).not.toContain('await auditOrder(')
    expect(orderService).toContain('await auditOrderInTransaction(')
    expect(orderService).toContain('writeAuditEventInTransaction(client, {')
    expect(auditQueryService).toContain("log.entity_type is distinct from 'travel_order'")
    expect(auditQueryService).toMatch(
      /from company_portal_travel_orders visible_order[\s\S]*?visible_order\.tenant_id = log\.tenant_id[\s\S]*?visible_order\.id::text = log\.entity_id[\s\S]*?visible_order\.status = 'submitted'/,
    )
    const activation = between(
      demandService,
      'export async function activateDeferredTravelOrderDemands(',
      'async function createDemandInTransaction(',
    )
    expectMarkersInOrder(activation, [
      "action: 'travel.demand.create'",
      "action: 'travel.order.submit'",
      "set status = 'submitted'",
    ])
  })

  it('valida todos os itens antes de atravessar o estado privado submitting', () => {
    const submit = between(
      orderService,
      'export async function submitCompanyPortalTravelOrder(',
      'async function projectTravelOrder(',
    )
    const materialize = between(
      demandService,
      'export async function materializeDeferredTravelOrderDemands(',
      'export async function activateDeferredTravelOrderDemands(',
    )
    expect(submit).toMatch(
      /for \(const item of items\) \{\s*validateRelationalDemandCreationInput\(principal, \{[\s\S]*?demand: item\.demand_payload,[\s\S]*?submit: true/,
    )
    expectMarkersInOrder(submit, [
      'for (const item of items) {\n      validateRelationalDemandCreationInput',
      'materializeDeferredTravelOrderDemands(',
      'activateDeferredTravelOrderDemands(',
      "operation: 'submit'",
    ])
    expectMarkersInOrder(materialize, [
      'const preparedItems = input.items.map(',
      'withTenantTransaction(',
      'for (const item of preparedItems)',
      'createDemandInTransaction(',
      'set child_demand_id = $4',
      'reserveDeferredTravelOrderOperationUsageInTransaction(',
      "set status = 'submitting'",
    ])
    expect(materialize).toMatch(
      /createDemandInTransaction\([\s\S]*?\{ orderId: input\.orderId, itemId: item\.itemId \},\s*true,\s*\)/,
    )
  })

  it('mantem filhos inertes e publica ciclo, legado, outbox e pai numa unica fronteira', () => {
    const materialize = between(
      demandService,
      'export async function materializeDeferredTravelOrderDemands(',
      'export async function activateDeferredTravelOrderDemands(',
    )
    const creation = between(
      demandService,
      'async function createDemandInTransaction(',
      'async function startDemandApproval(',
    )
    const activation = between(
      demandService,
      'export async function activateDeferredTravelOrderDemands(',
      'async function createDemandInTransaction(',
    )

    expect(creation).toContain('if (submissionAllowed && lastEvaluationId && !deferActivation)')
    expect(creation).toContain('if (!deferActivation) {\n    await persistLegacyDemandCompatibility')
    expect(creation).toContain('if (!deferActivation) {\n    await registerCreatedOperationUsage')
    expect(creation).toContain('if (!deferActivation) {\n    await enqueueDemandCreationEvents')
    expect(materialize).not.toContain("action: 'travel.demand.create'")
    expect(activation).toContain("if (parent.rows[0].status === 'submitted') return")
    expectMarkersInOrder(activation, [
      'for (const row of children.rows)',
      'persistTravelTransitionInTransaction(',
      'for (const preparation of preparations)',
      'startDemandApproval(',
      'persistLegacyDemandCompatibility(client, principal, legacy)',
      'enqueueDemandCreationEvents(client, principal, row.id',
      'writeAuditEventInTransaction(client, {',
      "action: 'travel.demand.create'",
      "set status = 'submitted'",
    ])
  })

  it('oculta filhos privados em todos os loaders operacionais de cotacao e viagem', () => {
    const hotelQuote = source('lib/server/offline-quote-service.ts')
    const airQuote = source('lib/server/offline-air-quote-service.ts')
    const groundQuote = source('lib/server/offline-ground-quote-service.ts')
    const travel = source('lib/server/offline-travel-service.ts')

    expectSubmittedParentGate(between(
      hotelQuote,
      'export async function listOfflineHotelQuotes(',
      'async function loadOfflineHotelQuoteById(',
    ), 'listagem de cotacao hotel')
    expectSubmittedParentGate(between(
      hotelQuote,
      'async function loadOfflineHotelQuoteRows(',
      'export async function selectOfflineQuoteOption(',
    ), 'read model de cotacao hotel')
    expectSubmittedParentGate(between(
      hotelQuote,
      'async function loadQuoteDemand(',
      'async function loadSelectionContext(',
    ), 'loader mutavel de demanda hotel')

    expectSubmittedParentGate(between(
      airQuote,
      'export async function listOfflineAirQuotes(',
      'async function loadAirDemandPassengers(',
    ), 'listagem de cotacao aerea')
    expectSubmittedParentGate(between(
      airQuote,
      'async function loadAirQuoteRows(',
      'function mapAirQuoteRows(',
    ), 'read model de cotacao aerea')

    expectSubmittedParentGate(between(
      groundQuote,
      'async function loadGroundQuoteRows(',
      'async function loadBusSegmentRows(',
    ), 'read model terrestre')
    expectSubmittedParentGate(between(
      groundQuote,
      'async function loadGroundDemand(',
      'async function loadSuppliers(',
    ), 'loader de demanda terrestre')

    expectSubmittedParentGate(between(
      travel,
      'async function loadDemandForUpdate(',
      'async function loadOfflineReservationForUpdate(',
    ), 'loader central de reserva/emissao')

    expect(migration).toMatch(
      /create policy tenant_isolation on demands[\s\S]*?travel_order_id is null[\s\S]*?app\.allow_hidden_travel_order_child[\s\S]*?visible_order\.status = 'submitted'[\s\S]*?with check/,
    )
    expect(demandService).toContain("set_config('app.allow_hidden_travel_order_child', 'true', true)")
  })

  it('torna o retry de upsert estavel e recupera concorrencia pela operacao gravada', () => {
    const upsert = between(
      orderService,
      'export async function upsertCompanyPortalTravelOrderItem(',
      'export async function deleteCompanyPortalTravelOrderItem(',
    )
    const canonicalHash = between(orderService, 'function draftPayloadHash(', 'function sameIds(')

    expect(canonicalHash).toContain('created_at: _createdAt')
    expect(canonicalHash).toContain('updated_at: _updatedAt')
    expect(canonicalHash).toContain('return hash(canonical)')
    expectMarkersInOrder(upsert, [
      'const replay = await loadOperation(',
      'if (replay)',
      'attachCompanyPortalHotelTariffReference(',
      'recordOperation(',
    ])
    expect(upsert).toContain('catch (error)')
    expect(upsert).toContain('isUniqueViolation(error)')
    expect(upsert).toMatch(/catch \(error\)[\s\S]*?loadOperation\(/)
  })

  it('retoma submit perdido sem duplicar filhos e registra sucesso somente apos ativacao', () => {
    const submit = between(
      orderService,
      'export async function submitCompanyPortalTravelOrder(',
      'async function projectTravelOrder(',
    )
    expect(submit).toContain('const replay = await loadOperation(')
    expect(submit).toContain('assertOperationReplay(')
    expect(submit).toContain('travel-order:submit:${orderId}:${item.id}')
    expect(submit).toContain('catch (error)')
    expect(submit).toContain('isUniqueViolation(error)')
    expect(submit).toMatch(/catch \(error\)[\s\S]*?loadOperation\(/)
    expectMarkersInOrder(submit, [
      'activateDeferredTravelOrderDemands(',
      'const replay = await loadOperation(',
      "operation: 'submit'",
    ])
  })

  it('deriva uma chave de aprovacao exclusiva e recuperavel para cada demanda filha', () => {
    const activation = between(
      demandService,
      'export async function activateDeferredTravelOrderDemands(',
      'async function createDemandInTransaction(',
    )
    const approval = between(
      demandService,
      'async function startDemandApproval(',
      'async function loadDemandByIdempotency(',
    )
    expect(activation).toContain(
      '`${idempotencyKey}:travel-order:${orderId}:demand:${preparation.relational.id}`',
    )
    expect(approval).toContain('`${idempotencyKey}:approval:${workflowCode}`')
    expect(approval).toContain('`${idempotencyKey}:request-merit`')
  })
})
