import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sha256 } from '@/lib/policy'
import { decideApprovalAssignment } from '@/lib/server/approval-service'
import { closeDatabasePool } from '@/lib/server/database'
import {
  createOfflineHotelQuote,
  listOfflineHotelQuotes,
  selectOfflineQuoteOption,
} from '@/lib/server/offline-quote-service'
import {
  createOfflineReservation,
  issueOfflineReservation,
} from '@/lib/server/offline-travel-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { getVoucher } from '@/lib/server/voucher-service'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL offline hotel quote and requester choice flow', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const agentUserId = randomUUID()
  const requesterUserId = randomUUID()
  const approverUserId = randomUUID()
  const approverMembershipId = randomUUID()
  const approverRoleId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const employeeId = `employee-${randomUUID()}`
  const requesterId = `requester-${randomUUID()}`
  const demandId = `demand-${randomUUID()}`
  const demandNumber = `OS-HOTEL-QUOTE-${randomUUID()}`
  const costCenter = 'CC-HOTEL-001'
  const roomId = randomUUID()
  const travelerId = randomUUID()
  const hotelIds = [`hotel-${randomUUID()}`, `hotel-${randomUUID()}`]
  const supplierIds = [randomUUID(), randomUUID()]
  const hotelSupplierLinkIds = [randomUUID(), randomUUID()]
  const countryId = randomUUID()
  const subdivisionId = randomUUID()
  const cityId = randomUUID()
  const workflowCode = `offline-selection-${randomUUID()}`
  const agentPrincipal = principalFor('agent', tenantId, agentUserId, companyId)
  const requesterPrincipal = principalFor('requester', tenantId, requesterUserId, companyId)
  const checkIn = futureDateOnly(180)
  const checkOut = futureDateOnly(183)
  const expiresAt = futureIsoDateTime(7)
  const cancellationDeadline = futureIsoDateTime(150)
  let countryCode = ''

  beforeAll(async () => {
    countryCode = await seedIsolatedGeography(pool, {
      countryId,
      subdivisionId,
      cityId,
    })
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Offline Hotel Quote Tenant', $2)`,
      [tenantId, `offline-hotel-quote-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values
         ($1, $4, 'Agente de cotacao', 'active', now()),
         ($2, $5, 'Solicitante da demanda', 'active', now()),
         ($3, $6, 'Aprovador de custo', 'active', now())`,
      [
        agentUserId,
        requesterUserId,
        approverUserId,
        `offline-agent-${agentUserId}@test.invalid`,
        `offline-requester-${requesterUserId}@test.invalid`,
        `offline-approver-${approverUserId}@test.invalid`,
      ],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (
           id, tenant_id, legal_name, trade_name, document_number, status
         ) values ($1, $2, 'Empresa Cotacao Offline SA', 'Empresa Cotacao Offline',
                   '12.345.678/0001-90', 'active')`,
        [companyId, tenantId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name,
           document_number, email, phone, department, metadata, status
         ) values (
           $1, $2, $3, 'HOTEL-QUOTE-001', 'Viajante da cotacao',
           '123.456.789-01', 'viajante.cotacao@test.invalid', '(11) 99999-0001',
           'Financeiro', '{"businessUnit":"Matriz"}'::jsonb, 'active'
         )`,
        [employeeId, tenantId, companyId],
      )
      await client.query(
        `insert into requesters (
           id, tenant_id, company_id, employee_id, user_id, name, email, status
         ) values ($1, $2, $3, $4, $5, 'Solicitante da demanda', $6, 'active')`,
        [
          requesterId,
          tenantId,
          companyId,
          employeeId,
          requesterUserId,
          `offline-requester-${requesterUserId}@test.invalid`,
        ],
      )
      await seedApproverMembership(client, {
        tenantId,
        companyId,
        roleId: approverRoleId,
        membershipId: approverMembershipId,
        userId: approverUserId,
      })
      await seedHotelsAndSuppliers(client, {
        tenantId,
        userId: agentUserId,
        countryId,
        subdivisionId,
        cityId,
        countryCode,
        hotelIds,
        supplierIds,
        hotelSupplierLinkIds,
      })
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, requester_id, employee_id,
           demand_number, service_type, passenger_name_snapshot, status,
           priority, travel_start_date, travel_end_date, destination,
           cost_center, estimated_amount, lifecycle_status, lifecycle_version, created_by
         ) values (
           $1, $2, $3, $4, $5,
           $6, 'Hotel', 'Viajante da cotacao', 'em_andamento',
           'normal', $7, $8, 'Cidade de Teste',
           $9, 0, 'submitted', 1, $10
         )`,
        [
          demandId,
          tenantId,
          companyId,
          requesterId,
          employeeId,
          demandNumber,
          checkIn,
          checkOut,
          costCenter,
          requesterUserId,
        ],
      )
      await client.query(
        `insert into hotel_demand_details (
           tenant_id, demand_id, country_id, subdivision_id, city_id,
           check_in, check_out, created_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, demandId, countryId, subdivisionId, cityId, checkIn, checkOut, requesterUserId],
      )
      await client.query(
        `insert into hotel_demand_rooms (
           id, tenant_id, demand_id, room_sequence, occupancy_code, created_by
         ) values ($1, $2, $3, 1, 'single', $4)`,
        [roomId, tenantId, demandId, requesterUserId],
      )
      await client.query(
        `insert into demand_travelers (
           id, tenant_id, demand_id, company_id, employee_id, traveler_role,
           is_primary, is_external, name_snapshot, email_snapshot, phone_snapshot, created_by
         ) values (
           $1, $2, $3, $4, $5, 'responsible',
           true, false, 'Viajante da cotacao', 'viajante.cotacao@test.invalid',
           '(11) 99999-0001', $6
         )`,
        [travelerId, tenantId, demandId, companyId, employeeId, requesterUserId],
      )
      await client.query(
        `insert into hotel_demand_room_guests (
           tenant_id, demand_id, room_id, traveler_id, slot_index, created_by
         ) values ($1, $2, $3, $4, 1, $5)`,
        [tenantId, demandId, roomId, travelerId, requesterUserId],
      )
      await seedSelectionApprovalPolicy(client, {
        tenantId,
        companyId,
        createdBy: agentUserId,
        approverUserId,
        workflowCode,
      })
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = any($1::uuid[])', [[agentUserId, requesterUserId, approverUserId]])
    await pool.query('delete from geo_cities where id = $1', [cityId])
    await pool.query('delete from geo_subdivisions where id = $1', [subdivisionId])
    await pool.query('delete from geo_countries where id = $1', [countryId])
    await pool.end()
  })

  it('persists the chosen hotel through approval, reservation, issuance and a complete voucher', async () => {
    await expect(createOfflineReservation(agentPrincipal, {
      demandId,
      companyId,
      expectedLifecycleVersion: 1,
      serviceKey: 'hotelaria',
      supplierName: 'Fornecedor sem escolha formal',
      externalReference: `HOTEL-BYPASS-${randomUUID()}`,
      channel: 'email',
      startsAt: checkIn,
      endsAt: checkOut,
      amounts: { gross: 900, taxes: 90, total: 990, currency: 'BRL' },
      details: {
        itemName: 'Hotel sem escolha formal',
        destination: 'Cidade de Teste',
        accommodation: 'Standard Single',
      },
      confirmed: true,
      idempotencyKey: `offline-hotel-bypass-${randomUUID()}`,
    })).rejects.toMatchObject({
      code: 'OFFLINE_APPROVED_SELECTION_REQUIRED',
      status: 409,
    })

    const supersededQuote = await createOfflineHotelQuote(agentPrincipal, {
      demandId,
      expectedLifecycleVersion: 1,
      expiresAt,
      confirmed: true,
      idempotencyKey: `offline-hotel-quote-${randomUUID()}`,
      options: [{
        clientId: 'hotel-option-superseded',
        hotelId: hotelIds[0],
        hotelSupplierId: hotelSupplierLinkIds[0],
        roomCategory: 'Standard Single',
        mealPlan: 'Cafe da manha',
        nightlyRate: 350,
        nightlyTaxes: 35,
        serviceFee: 50,
        refundable: true,
        cancellationDeadline,
        cancellationPolicy: 'Primeira rodada, substituida antes da escolha.',
        paymentTerms: 'Faturado em 30 dias.',
      }],
    })

    const quote = await createOfflineHotelQuote(agentPrincipal, {
      demandId,
      expectedLifecycleVersion: supersededQuote.item.lifecycleVersion,
      expiresAt,
      confirmed: true,
      idempotencyKey: `offline-hotel-quote-${randomUUID()}`,
      options: [
        {
          clientId: 'hotel-option-a',
          hotelId: hotelIds[0],
          hotelSupplierId: hotelSupplierLinkIds[0],
          roomCategory: 'Standard Single',
          mealPlan: 'Cafe da manha',
          nightlyRate: 310,
          nightlyTaxes: 31,
          serviceFee: 45,
          refundable: true,
          cancellationDeadline,
          cancellationPolicy: 'Cancelamento sem multa ate o prazo informado.',
          paymentTerms: 'Faturado em 30 dias.',
          notes: 'Primeira opcao da rodada de homologacao.',
        },
        {
          clientId: 'hotel-option-b',
          hotelId: hotelIds[1],
          hotelSupplierId: hotelSupplierLinkIds[1],
          roomCategory: 'Executivo Single',
          mealPlan: 'Cafe da manha',
          nightlyRate: 270,
          nightlyTaxes: 27,
          serviceFee: 40,
          refundable: false,
          cancellationDeadline,
          cancellationPolicy: 'Tarifa nao reembolsavel apos o prazo.',
          paymentTerms: 'Pagamento faturado.',
          notes: 'Segunda opcao da rodada de homologacao.',
        },
      ],
    })

    expect(quote).toMatchObject({ replayed: false })
    expect(quote.item).toMatchObject({
      demandId,
      status: 'completed',
      lifecycleStatus: 'pending_choice',
    })
    expect(quote.item.options).toHaveLength(2)
    expect(new Set(quote.item.options.map((option) => option.hotelId))).toEqual(new Set(hotelIds))
    expect(quote.item.options.map((option) => option.breakdown.total).sort((left, right) => left - right))
      .toEqual([931, 1068])

    const quoteRounds = await listOfflineHotelQuotes(requesterPrincipal, demandId)
    expect(quoteRounds.quotes.map((item) => item.id)).toEqual([quote.item.id, supersededQuote.item.id])
    expect(quoteRounds.quotes.map((item) => item.status)).toEqual(['completed', 'expired'])
    await expect(selectOfflineQuoteOption(requesterPrincipal, {
      demandId,
      quoteId: supersededQuote.item.id,
      optionId: supersededQuote.item.options[0].id,
      expectedLifecycleVersion: quote.item.lifecycleVersion,
      confirmed: true,
      idempotencyKey: `offline-hotel-old-round-${randomUUID()}`,
    })).rejects.toMatchObject({
      code: 'OFFLINE_SELECTION_QUOTE_EXPIRED',
      status: 409,
    })

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `update travel_quotes set status = 'completed'
         where tenant_id = $1 and id = $2`,
        [tenantId, supersededQuote.item.id],
      )
    })
    await expect(selectOfflineQuoteOption(requesterPrincipal, {
      demandId,
      quoteId: supersededQuote.item.id,
      optionId: supersededQuote.item.options[0].id,
      expectedLifecycleVersion: quote.item.lifecycleVersion,
      confirmed: true,
      idempotencyKey: `offline-hotel-non-current-round-${randomUUID()}`,
    })).rejects.toMatchObject({
      code: 'OFFLINE_SELECTION_QUOTE_NOT_CURRENT',
      status: 409,
    })
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `update travel_quotes set status = 'expired'
         where tenant_id = $1 and id = $2`,
        [tenantId, supersededQuote.item.id],
      )
    })

    const supersessionAudit = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{ action: string; entity_id: string; metadata: Record<string, unknown> }>(
        `select action, entity_id, metadata
         from audit_logs
         where tenant_id = $1 and action = 'travel.quote.superseded' and entity_id = $2`,
        [tenantId, supersededQuote.item.id],
      )
      return result.rows[0]
    })
    expect(supersessionAudit).toMatchObject({
      action: 'travel.quote.superseded',
      entity_id: supersededQuote.item.id,
      metadata: {
        demandId,
        previousQuoteId: supersededQuote.item.id,
        currentQuoteId: quote.item.id,
        reason: 'new_offline_hotel_quote_round',
      },
    })

    const published = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        lifecycle_status: string
        lifecycle_version: string
        quote_status: string
        quote_options: string
        hotel_details: string
        room_rates: string
        charge_lines: string
      }>(
        `select demand.lifecycle_status, demand.lifecycle_version::text,
                quote.status as quote_status,
                count(distinct option_row.id)::text as quote_options,
                count(distinct detail.quote_option_id)::text as hotel_details,
                count(distinct rate.id)::text as room_rates,
                count(distinct charge.id)::text as charge_lines
         from demands demand
         join travel_quotes quote
           on quote.tenant_id = demand.tenant_id and quote.demand_id = demand.id
         join travel_quote_options option_row
           on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
         left join hotel_quote_option_details detail
           on detail.tenant_id = option_row.tenant_id and detail.quote_option_id = option_row.id
         left join hotel_quote_room_rates rate
           on rate.tenant_id = option_row.tenant_id and rate.quote_option_id = option_row.id
         left join quote_option_charge_lines charge
           on charge.tenant_id = option_row.tenant_id and charge.quote_option_id = option_row.id
         where demand.tenant_id = $1 and demand.id = $2 and quote.id = $3
         group by demand.lifecycle_status, demand.lifecycle_version, quote.status`,
        [tenantId, demandId, quote.item.id],
      )
      return result.rows[0]
    })
    expect(published).toEqual({
      lifecycle_status: 'pending_choice',
      lifecycle_version: String(quote.item.lifecycleVersion),
      quote_status: 'completed',
      quote_options: '2',
      hotel_details: '2',
      room_rates: '2',
      charge_lines: '4',
    })

    const selectedOption = quote.item.options.find((option) => option.hotelId === hotelIds[1])!
    const selection = await selectOfflineQuoteOption(requesterPrincipal, {
      demandId,
      quoteId: quote.item.id,
      optionId: selectedOption.id,
      expectedLifecycleVersion: quote.item.lifecycleVersion,
      confirmed: true,
      idempotencyKey: `offline-hotel-choice-${randomUUID()}`,
    })

    expect(selection).toMatchObject({
      demandId,
      quoteId: quote.item.id,
      optionId: selectedOption.id,
      status: 'pending_approval',
      lifecycleStatus: 'pending_cost_approval',
      replayed: false,
    })
    expect(selection.approvalInstanceId).toMatch(/^[0-9a-f-]{36}$/)

    const persisted = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        id: string
        status: string
        snapshot: Record<string, unknown>
        snapshot_hash: string
        chosen_by: string
        approval_instance_id: string
        lifecycle_status: string
        lifecycle_version: string
        quote_status: string
        selected_by: string
        approval_status: string
        instance_type: string
        assignment_status: string
        assignee_user_id: string
      }>(
        `select selection.id, selection.status, selection.snapshot,
                selection.snapshot_hash, selection.chosen_by,
                selection.approval_instance_id,
                demand.lifecycle_status, demand.lifecycle_version::text,
                quote.status as quote_status, option_row.selected_by,
                instance.status as approval_status, instance.instance_type,
                assignment.status as assignment_status,
                assignment.assignee_user_id
         from travel_quote_selections selection
         join demands demand
           on demand.tenant_id = selection.tenant_id and demand.id = selection.demand_id
         join travel_quotes quote
           on quote.tenant_id = selection.tenant_id and quote.id = selection.quote_id
         join travel_quote_options option_row
           on option_row.tenant_id = selection.tenant_id and option_row.id = selection.option_id
         join approval_instances instance
           on instance.tenant_id = selection.tenant_id and instance.id = selection.approval_instance_id
         join approval_steps step
           on step.tenant_id = instance.tenant_id and step.approval_instance_id = instance.id
         join approval_assignments assignment
           on assignment.tenant_id = step.tenant_id and assignment.approval_step_id = step.id
         where selection.tenant_id = $1 and selection.id = $2`,
        [tenantId, selection.id],
      )
      return result.rows[0]
    })
    expect(persisted).toMatchObject({
      id: selection.id,
      status: 'pending_approval',
      chosen_by: requesterUserId,
      approval_instance_id: selection.approvalInstanceId,
      lifecycle_status: 'pending_cost_approval',
      lifecycle_version: String(selection.lifecycleVersion),
      quote_status: 'selected',
      selected_by: requesterUserId,
      approval_status: 'in_progress',
      instance_type: 'cost',
      assignment_status: 'pending',
      assignee_user_id: approverUserId,
    })
    expect(persisted.snapshot_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(persisted.snapshot_hash).toBe(sha256(persisted.snapshot))
    expect(persisted.snapshot).toMatchObject({
      demand: { id: demandId, requesterId },
      quote: { id: quote.item.id, optionCount: 2 },
      option: {
        id: selectedOption.id,
        hotel: { id: hotelIds[1], name: 'Hotel Homologacao B' },
      },
    })

    const pendingAssignment = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        assignment_id: string
        step_version: string
      }>(
        `select assignment.id as assignment_id, step.version::text as step_version
         from approval_instances instance
         join approval_steps step
           on step.tenant_id = instance.tenant_id and step.approval_instance_id = instance.id
         join approval_assignments assignment
           on assignment.tenant_id = step.tenant_id and assignment.approval_step_id = step.id
         where instance.tenant_id = $1 and instance.id = $2
           and assignment.assignee_user_id = $3 and assignment.status = 'pending'`,
        [tenantId, selection.approvalInstanceId, approverUserId],
      )
      return result.rows[0]
    })
    const approverPrincipal = principalFor('agent', tenantId, approverUserId, companyId)
    const decided = await decideApprovalAssignment(approverPrincipal, pendingAssignment.assignment_id, {
      decision: 'approved',
      reason: 'Opcao e valores conferidos para o teste integrado.',
      expectedStepVersion: Number(pendingAssignment.step_version),
      confirmation: true,
      idempotencyKey: `offline-hotel-approval-${randomUUID()}`,
    })
    expect(decided.status).toBe('approved')

    const approvedProjection = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        lifecycle_status: string
        lifecycle_version: string
        active_approval_instance_id: string | null
        selection_status: string
        selection_version: string
      }>(
        `select demand.lifecycle_status, demand.lifecycle_version::text,
                demand.active_approval_instance_id,
                selection.status as selection_status,
                selection.version::text as selection_version
         from demands demand
         join travel_quote_selections selection
           on selection.tenant_id = demand.tenant_id and selection.demand_id = demand.id
         where demand.tenant_id = $1 and demand.id = $2 and selection.id = $3`,
        [tenantId, demandId, selection.id],
      )
      return result.rows[0]
    })
    expect(approvedProjection).toMatchObject({
      lifecycle_status: 'approved',
      active_approval_instance_id: null,
      selection_status: 'approved',
      selection_version: '2',
    })

    // Reproduz a projecao deixada por versoes anteriores: a instancia ja foi
    // aprovada, mas demanda e escolha ainda aguardam reconciliacao. A reserva
    // deve reparar esse estado de forma transacional antes do fulfillment.
    const legacyProjectionVersion = await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `select set_config('app.lifecycle_command', 'request_cost_approval', true),
                set_config('app.idempotency_key', $1, true)`,
        [`integration:legacy-selection:${selection.id}`],
      )
      const demandResult = await client.query<{ lifecycle_version: string }>(
        `update demands set
           lifecycle_status = 'pending_cost_approval',
           lifecycle_version = lifecycle_version + 1,
           last_transition_at = now(),
           active_approval_instance_id = $3
         where tenant_id = $1 and id = $2
         returning lifecycle_version::text`,
        [tenantId, demandId, selection.approvalInstanceId],
      )
      await client.query(
        `update travel_quote_selections
         set status = 'pending_approval', version = version + 1
         where tenant_id = $1 and id = $2`,
        [tenantId, selection.id],
      )
      return Number(demandResult.rows[0].lifecycle_version)
    })

    const operationalSupplierName = 'Operadora Hoteleira de Fulfillment'
    const externalReference = `HOTEL-CONF-${randomUUID()}`
    const reservation = await createOfflineReservation(agentPrincipal, {
      demandId,
      companyId,
      expectedLifecycleVersion: legacyProjectionVersion,
      serviceKey: 'hotelaria',
      supplierName: operationalSupplierName,
      supplierCode: 'OPER-FULFILLMENT-01',
      externalReference,
      channel: 'email',
      startsAt: futureDateOnly(220),
      endsAt: futureDateOnly(221),
      amounts: { gross: 1, taxes: 0, total: 1, currency: 'BRL' },
      details: {
        itemName: 'Hotel divergente informado pelo operador',
        destination: 'Destino divergente',
        category: 'Categoria divergente',
        accommodation: 'Quarto divergente',
        mealPlan: 'Sem refeicao',
      },
      confirmed: true,
      idempotencyKey: `offline-hotel-reservation-${randomUUID()}`,
    })
    expect(reservation).toMatchObject({
      demandId,
      lifecycleStatus: 'reserved',
      replayed: false,
    })

    const fulfillment = await tenantTransaction(pool, tenantId, async (client) => {
      const reservationResult = await client.query<{
        selected_quote_id: string
        selected_quote_option_id: string
        quote_selection_id: string
        gross_amount: string
        tax_amount: string
        final_amount: string
        currency: string
        start_at: string | Date
        end_at: string | Date
        metadata: Record<string, unknown>
        provider_payload: Record<string, unknown>
        demand_status: string
        selection_status: string
        option_selected_by: string
      }>(
        `select reservation.selected_quote_id, reservation.selected_quote_option_id,
                reservation.quote_selection_id, reservation.gross_amount::text,
                reservation.tax_amount::text, reservation.final_amount::text,
                reservation.currency, reservation.start_at, reservation.end_at,
                reservation.metadata, reservation.provider_payload,
                demand.lifecycle_status as demand_status,
                selection.status as selection_status,
                option_row.selected_by as option_selected_by
         from reservations reservation
         join demands demand
           on demand.tenant_id = reservation.tenant_id and demand.id = reservation.demand_id
         join travel_quote_selections selection
           on selection.tenant_id = reservation.tenant_id
          and selection.id = reservation.quote_selection_id
         join travel_quote_options option_row
           on option_row.tenant_id = reservation.tenant_id
          and option_row.id = reservation.selected_quote_option_id
         where reservation.tenant_id = $1 and reservation.id = $2`,
        [tenantId, reservation.reservationId],
      )
      const auditResult = await client.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit_logs
         where tenant_id = $1 and action = 'reservation.offline.create'
           and entity_id = $2 and result = 'success'
         order by created_at desc limit 1`,
        [tenantId, reservation.reservationId],
      )
      return { reservation: reservationResult.rows[0], audit: auditResult.rows[0]?.metadata }
    })
    expect(fulfillment.reservation).toMatchObject({
      selected_quote_id: quote.item.id,
      selected_quote_option_id: selectedOption.id,
      quote_selection_id: selection.id,
      gross_amount: '850.00',
      tax_amount: '81.00',
      final_amount: '931.00',
      currency: 'BRL',
      demand_status: 'reserved',
      selection_status: 'approved',
      option_selected_by: requesterUserId,
    })
    expect(new Date(fulfillment.reservation.start_at).toISOString())
      .toBe(new Date(selectedOption.startsAt!).toISOString())
    expect(new Date(fulfillment.reservation.end_at).toISOString())
      .toBe(new Date(selectedOption.endsAt!).toISOString())
    expect(fulfillment.reservation.metadata).toMatchObject({
      supplierName: operationalSupplierName,
      details: {
        itemName: 'Hotel Homologacao B',
        destination: 'Cidade de Teste',
        category: 'Homologacao',
        accommodation: 'Executivo Single',
        mealPlan: 'Cafe da manha',
      },
      approvedCommercialTerms: {
        selectionId: selection.id,
        snapshotHash: persisted.snapshot_hash,
        quotedSupplierName: 'Fornecedor Hotel Homologacao B',
        operationalSupplier: {
          name: operationalSupplierName,
          code: 'OPER-FULFILLMENT-01',
          divergedFromQuote: true,
        },
        amounts: { gross: 850, taxes: 81, total: 931, currency: 'BRL' },
      },
    })
    expect(fulfillment.reservation.provider_payload).toMatchObject({
      approvedQuoteSelectionId: selection.id,
      approvedQuoteSnapshotHash: persisted.snapshot_hash,
    })
    expect(fulfillment.audit).toMatchObject({
      quoteSelectionId: selection.id,
      quoteId: quote.item.id,
      quoteOptionId: selectedOption.id,
      approvedSnapshotHash: persisted.snapshot_hash,
      quotedSupplierName: 'Fornecedor Hotel Homologacao B',
      operationalSupplierName,
      operationalSupplierDiverged: true,
    })

    const issuance = await issueOfflineReservation(agentPrincipal, reservation.reservationId, {
      demandId,
      expectedLifecycleVersion: reservation.lifecycleVersion,
      supplierConfirmation: true,
      document: { kind: 'confirmacao', reference: `DOC-${randomUUID()}` },
      payment: { method: 'faturado', reference: 'FAT-30-DIAS' },
      partial: false,
      generateVoucher: true,
      confirmed: true,
      idempotencyKey: `offline-hotel-issuance-${randomUUID()}`,
    })
    expect(issuance).toMatchObject({
      reservationId: reservation.reservationId,
      demandId,
      lifecycleStatus: 'issued',
      partial: false,
      replayed: false,
    })
    expect(issuance.voucherId).toMatch(/^H-/)

    const emittedRateObservation = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        hotel_id: string
        hotel_supplier_id: string
        supplier_id: string
        room_category: string
        nightly_amount: string
        nightly_tax_amount: string
        option_service_fee_amount: string
        currency: string
        quote_snapshot_hash: string
        operational_supplier_name: string
        supplier_matches_quote: boolean
      }>(
        `select hotel_id, hotel_supplier_id::text, supplier_id::text,
                room_category, nightly_amount::text, nightly_tax_amount::text,
                option_service_fee_amount::text, currency, quote_snapshot_hash,
                operational_supplier_name, supplier_matches_quote
         from hotel_emission_rate_observations
         where tenant_id = $1 and emission_id = $2`,
        [tenantId, issuance.emissionId],
      )
      return result.rows[0]
    })
    expect(emittedRateObservation).toMatchObject({
      hotel_id: hotelIds[1],
      hotel_supplier_id: hotelSupplierLinkIds[1],
      supplier_id: supplierIds[1],
      room_category: 'Executivo Single',
      nightly_amount: '270.00',
      nightly_tax_amount: '27.00',
      option_service_fee_amount: '40.00',
      currency: 'BRL',
      quote_snapshot_hash: persisted.snapshot_hash,
      operational_supplier_name: operationalSupplierName,
      supplier_matches_quote: false,
    })

    const voucher = await getVoucher(agentPrincipal, issuance.voucherId!)
    expect(voucher).toMatchObject({
      id: issuance.voucherId,
      tipo: 'Hotel',
      status: 'emitido',
      atendimento_id: demandId,
      empresa_id: companyId,
      empresa_nome: 'Empresa Cotacao Offline',
      empresa_documento: '12.345.678/0001-90',
      unidade_negocio: 'Matriz',
      departamento: 'Financeiro',
      solicitante_nome: 'Solicitante da demanda',
      solicitante_email: `offline-requester-${requesterUserId}@test.invalid`,
      autorizadores: ['Aprovador de custo'],
      numero_solicitacao: demandNumber,
      centro_custo: costCenter,
      reserva_id: reservation.reservationId,
      fornecedor_nome: operationalSupplierName,
      fornecedor_codigo: 'OPER-FULFILLMENT-01',
      canal_reserva: 'email',
      localizador: externalReference,
      numero_confirmacao: externalReference,
      hotel_nome: 'Hotel Homologacao B',
      hotel_endereco: 'Avenida Hotel Homologacao B, 200',
      hotel_cidade: 'Cidade de Teste',
      hotel_telefone: '(11) 4000-0002',
      hotel_categoria: 'Homologacao',
      tipo_apartamento: 'Executivo Single',
      regime: 'Cafe da manha',
      data_checkin: checkIn,
      data_checkout: checkOut,
      noites: 3,
      num_apartamentos: 1,
      num_hospedes: 1,
      valor_diaria: 270,
      taxas_diaria: 27,
      taxa_servico: 40,
      tarifa_total: 810,
      taxas: 81,
      total: 931,
      moeda: 'BRL',
      forma_pagamento_voucher: 'Faturado',
      referencia_pagamento: 'FAT-30-DIAS',
      condicoes_pagamento: 'Pagamento faturado.',
      politica_cancelamento: 'Tarifa nao reembolsavel apos o prazo.',
      reembolsavel: false,
      passageiro_nome: 'Viajante da cotacao',
      passageiros: ['Viajante da cotacao'],
      cpf: '***.***.***-01',
    })
    expect(voucher.autorizado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(voucher.data_solicitacao).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(voucher.data_reserva).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(voucher.checkin_em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(voucher.checkout_em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(voucher.prazo_cancelamento).toBe(new Date(cancellationDeadline).toISOString())
    expect(voucher.hospedes_detalhes).toEqual([{
      nome: 'Viajante da cotacao',
      papel: 'Responsável',
      principal: true,
      codigo: 'HOTEL-QUOTE-001',
      documento: '***.***.***-01',
      email: 'viajante.cotacao@test.invalid',
      telefone: '(11) 99999-0001',
      quarto: 1,
    }])
    expect(voucher.quartos).toEqual([{
      numero: 1,
      acomodacao: 'Executivo Single',
      categoria: 'Homologacao',
      regime: 'Cafe da manha',
      hospedes: ['Viajante da cotacao'],
    }])
    expect(voucher.fornecedor_nome).not.toBe('Fornecedor Hotel Homologacao B')

    const persistedVoucher = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{ metadata: Record<string, unknown> }>(
        `select metadata from vouchers
         where tenant_id = $1 and id = $2 and deleted_at is null`,
        [tenantId, issuance.voucherId],
      )
      return result.rows[0]?.metadata
    })
    expect(persistedVoucher).toMatchObject({
      hotel_nome: 'Hotel Homologacao B',
      fornecedor_nome: operationalSupplierName,
      localizador: externalReference,
      numero_confirmacao: externalReference,
      numero_solicitacao: demandNumber,
      centro_custo: costCenter,
      solicitante_nome: 'Solicitante da demanda',
      autorizadores: ['Aprovador de custo'],
      valor_diaria: 270,
      taxas_diaria: 27,
      taxa_servico: 40,
      tarifa_total: 810,
      taxas: 81,
      total: 931,
    })
  })
})

async function seedIsolatedGeography(
  pool: Pool,
  ids: { countryId: string; subdivisionId: string; cityId: string },
): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('lock table geo_countries in share row exclusive mode')
    const existing = await client.query<{ code: string }>('select upper(iso_alpha2::text) as code from geo_countries')
    const occupied = new Set(existing.rows.map((row) => row.code))
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let code = ''
    for (const first of alphabet) {
      for (const second of alphabet) {
        const candidate = `${first}${second}`
        if (!occupied.has(candidate)) {
          code = candidate
          break
        }
      }
      if (code) break
    }
    if (!code) throw new Error('Nao ha codigo geografico livre para a fixture de integracao.')
    await client.query(
      `insert into geo_countries (
         id, iso_alpha2, iso_alpha3, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Pais de Teste', 'pais de teste', 'integration-test', $4)`,
      [ids.countryId, code, `${code}X`, `offline-hotel-country-${ids.countryId}`],
    )
    await client.query(
      `insert into geo_subdivisions (
         id, country_id, code, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Estado de Teste', 'estado de teste', 'integration-test', $4)`,
      [ids.subdivisionId, ids.countryId, `${code}-T`, `offline-hotel-subdivision-${ids.subdivisionId}`],
    )
    await client.query(
      `insert into geo_cities (
         id, country_id, subdivision_id, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Cidade de Teste', 'cidade de teste', 'integration-test', $4)`,
      [ids.cityId, ids.countryId, ids.subdivisionId, `offline-hotel-city-${ids.cityId}`],
    )
    await client.query('commit')
    return code
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function seedApproverMembership(
  client: PoolClient,
  input: { tenantId: string; companyId: string; roleId: string; membershipId: string; userId: string },
): Promise<void> {
  await client.query(
    `insert into roles (id, tenant_id, role_key, name, system_role)
     values ($1, $2, 'company_admin', 'Aprovador corporativo da fixture', false)`,
    [input.roleId, input.tenantId],
  )
  await client.query(
    `insert into role_permissions (role_id, permission_key, allowed)
     select $1, permission_key, true
     from unnest($2::text[]) as permission_key`,
    [input.roleId, ['ver_empresas', 'ver_aprovacoes', 'decidir_aprovacoes']],
  )
  await client.query(
    `insert into tenant_memberships (
       id, tenant_id, user_id, role_id, status, profile_key
     ) values ($1, $2, $3, $4, 'active', null)`,
    [input.membershipId, input.tenantId, input.userId, input.roleId],
  )
  await client.query(
    `insert into corporate_company_access_grants (
       tenant_id, membership_id, company_id, corporate_profile
     ) values ($1, $2, $3, 'approver')`,
    [input.tenantId, input.membershipId, input.companyId],
  )
}

async function seedHotelsAndSuppliers(
  client: PoolClient,
  input: {
    tenantId: string
    userId: string
    countryId: string
    subdivisionId: string
    cityId: string
    countryCode: string
    hotelIds: string[]
    supplierIds: string[]
    hotelSupplierLinkIds: string[]
  },
): Promise<void> {
  for (let index = 0; index < input.hotelIds.length; index += 1) {
    const suffix = index === 0 ? 'A' : 'B'
    await client.query(
      `insert into commercial_suppliers (
         id, tenant_id, internal_code, legal_name, trade_name,
         service_types, status, created_by
       ) values ($1, $2, $3, $4, $4, array['hotel']::text[], 'active', $5)`,
      [
        input.supplierIds[index],
        input.tenantId,
        `SUP-HOTEL-${suffix}-${input.supplierIds[index]}`,
        `Fornecedor Hotel Homologacao ${suffix}`,
        input.userId,
      ],
    )
    await client.query(
      `insert into hotels (
         id, tenant_id, name, normalized_name, city, state, country,
         country_id, subdivision_id, city_id, address, phone, email,
         category, status, created_by
       ) values (
         $1, $2, $3, $4, 'Cidade de Teste', 'Estado de Teste', $5,
         $6, $7, $8, $9, $10, $11, 'Homologacao', 'active', $12
       )`,
      [
        input.hotelIds[index],
        input.tenantId,
        `Hotel Homologacao ${suffix}`,
        `hotel homologacao ${suffix.toLowerCase()}`,
        input.countryCode,
        input.countryId,
        input.subdivisionId,
        input.cityId,
        `Avenida Hotel Homologacao ${suffix}, ${(index + 1) * 100}`,
        `(11) 4000-000${index + 1}`,
        `reservas-hotel-${suffix.toLowerCase()}@test.invalid`,
        input.userId,
      ],
    )
    await client.query(
      `insert into hotel_suppliers (
         id, tenant_id, hotel_id, supplier_id, priority, is_active, created_by
       ) values ($1, $2, $3, $4, 1, true, $5)`,
      [
        input.hotelSupplierLinkIds[index],
        input.tenantId,
        input.hotelIds[index],
        input.supplierIds[index],
        input.userId,
      ],
    )
  }
}

async function seedSelectionApprovalPolicy(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    createdBy: string
    approverUserId: string
    workflowCode: string
  },
): Promise<void> {
  const workflowId = randomUUID()
  const workflowVersionId = randomUUID()
  const startNodeId = randomUUID()
  const approvalNodeId = randomUUID()
  const endNodeId = randomUUID()
  const startEdgeId = randomUUID()
  const endEdgeId = randomUUID()
  const contentHash = 'c'.repeat(64)
  const approverResolution = {
    selectors: [{ type: 'person', value: input.approverUserId }],
    combination: 'first_non_empty',
    minimumApprovers: 1,
    maximumApprovers: 1,
    allowSelfApproval: false,
  }
  const snapshot = {
    workflowId,
    workflowVersionId,
    version: 1,
    code: input.workflowCode,
    name: 'Aprovacao da escolha de hotel offline',
    nodes: [
      { id: startNodeId, key: 'start', name: 'Inicio', type: 'start' },
      {
        id: approvalNodeId,
        key: 'cost-approval',
        name: 'Aprovacao de custo',
        type: 'approval',
        approvalKind: 'cost',
        completionMode: 'any',
        approverResolution,
      },
      { id: endNodeId, key: 'end', name: 'Fim', type: 'end' },
    ],
    edges: [
      { id: startEdgeId, sourceNodeId: startNodeId, targetNodeId: approvalNodeId, sequence: 0 },
      { id: endEdgeId, sourceNodeId: approvalNodeId, targetNodeId: endNodeId, sequence: 1 },
    ],
    validFrom: null,
    validUntil: null,
    contentHash,
  }

  await client.query(
    `insert into approval_workflow_definitions (
       id, tenant_id, workflow_code, name, description,
       workflow_type, status, created_by
     ) values ($1, $2, $3, $4, 'Workflow da fixture de escolha offline.', 'cost', 'draft', $5)`,
    [workflowId, input.tenantId, input.workflowCode, snapshot.name, input.createdBy],
  )
  await client.query(
    `insert into approval_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status,
       graph_snapshot, content_hash, change_summary, created_by
     ) values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, 'Fixture de integracao', $6)`,
    [workflowVersionId, input.tenantId, workflowId, JSON.stringify(snapshot), contentHash, input.createdBy],
  )
  await client.query(
    `insert into approval_nodes (
       id, tenant_id, workflow_version_id, node_key, name, node_type,
       approval_kind, completion_mode, approver_resolution
     ) values
       ($1, $2, $3, 'start', 'Inicio', 'start', null, null, '{}'::jsonb),
       ($4, $2, $3, 'cost-approval', 'Aprovacao de custo', 'approval', 'cost', 'any', $5::jsonb),
       ($6, $2, $3, 'end', 'Fim', 'end', null, null, '{}'::jsonb)`,
    [startNodeId, input.tenantId, workflowVersionId, approvalNodeId, JSON.stringify(approverResolution), endNodeId],
  )
  await client.query(
    `insert into approval_edges (
       id, tenant_id, workflow_version_id, source_node_id, target_node_id, sequence
     ) values
       ($1, $2, $3, $4, $5, 0),
       ($6, $2, $3, $5, $7, 1)`,
    [startEdgeId, input.tenantId, workflowVersionId, startNodeId, approvalNodeId, endEdgeId, endNodeId],
  )
  await client.query(
    `insert into approval_workflow_scopes (
       tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, 'company', $3, 'include', 100)`,
    [input.tenantId, workflowVersionId, input.companyId],
  )
  await client.query(
    `update approval_workflow_versions set
       status = 'published', approved_by = $3, approved_at = now(),
       published_by = $3, published_at = now()
     where tenant_id = $1 and id = $2`,
    [input.tenantId, workflowVersionId, input.createdBy],
  )
  await client.query(
    `update approval_workflow_definitions set status = 'published', current_version = 1
     where tenant_id = $1 and id = $2`,
    [input.tenantId, workflowId],
  )

  const policyId = randomUUID()
  const policyVersionId = randomUUID()
  const policyCode = `offline-selection-policy-${randomUUID()}`
  const actions = [{
    type: 'request_approval',
    message: 'A escolha do hotel offline exige aprovacao de custo.',
    configuration: { workflow: input.workflowCode },
  }]
  await client.query(
    `insert into policy_definitions (
       id, tenant_id, policy_code, name, description, category, status,
       priority, severity, inheritance_mode, overridable,
       business_justification, current_version, created_by
     ) values (
       $1, $2, $3, 'Aprovacao da escolha offline',
       'Politica da fixture de integracao.', 'approval', 'draft',
       100, 'warning', 'merge', true,
       'Validar o roteamento da escolha para o aprovador.', null, $4
     )`,
    [policyId, input.tenantId, policyCode, input.createdBy],
  )
  await client.query(
    `insert into policy_versions (
       id, tenant_id, policy_definition_id, version_number, status,
       name, description, category, priority, severity, inheritance_mode,
       overridable, condition_ast, actions_ast, exception_ast, checkpoints,
       business_justification, content_hash, change_summary, created_by
     ) values (
       $1, $2, $3, 1, 'draft', 'Aprovacao da escolha offline',
       'Politica da fixture de integracao.', 'approval', 100, 'warning', 'merge',
       true, $4::jsonb, $5::jsonb, '[]'::jsonb, array['selection']::text[],
       'Validar o roteamento da escolha para o aprovador.', $6,
       'Fixture de integracao', $7
     )`,
    [
      policyVersionId,
      input.tenantId,
      policyId,
      JSON.stringify({ fact: 'operation.channel', operator: 'eq', value: 'offline' }),
      JSON.stringify(actions),
      'd'.repeat(64),
      input.createdBy,
    ],
  )
  await client.query(
    `insert into policy_scopes (
       tenant_id, policy_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, 'company', $3, 'include', 100)`,
    [input.tenantId, policyVersionId, input.companyId],
  )
  await client.query(
    `update policy_versions set
       status = 'published', approved_by = $3, approved_at = now(),
       published_by = $3, published_at = now()
     where tenant_id = $1 and id = $2`,
    [input.tenantId, policyVersionId, input.createdBy],
  )
  await client.query(
    `update policy_definitions set status = 'published', current_version = 1
     where tenant_id = $1 and id = $2`,
    [input.tenantId, policyId],
  )
  await client.query(
    `insert into policy_publications (
       tenant_id, policy_definition_id, policy_version_id, status,
       effective_from, published_by, approved_by, publication_reason
     ) values ($1, $2, $3, 'active', now() - interval '1 minute', $4, $4, 'Fixture de integracao')`,
    [input.tenantId, policyId, policyVersionId, input.createdBy],
  )
}

function principalFor(
  roleKey: 'agent' | 'requester',
  tenantId: string,
  userId: string,
  companyId: string,
): RequestPrincipal {
  const permissions: Permissoes = {
    ...PERMISSOES_PADRAO_POR_PERFIL.agente,
    criar_demandas: true,
    ver_demandas: true,
    ver_reservas: true,
    ver_aprovacoes: true,
    operar_cotacoes: roleKey === 'agent',
    operar_reservas: roleKey === 'agent',
    operar_emissoes: roleKey === 'agent',
  }
  const profile = roleKey === 'requester' ? 'requester' as const : 'company_admin' as const
  return {
    sessionId: randomUUID(),
    tenantId,
    tenantSlug: `offline-hotel-quote-${tenantId}`,
    tenantStatus: 'active',
    membershipId: randomUUID(),
    roleKey,
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: [companyId],
      groupIds: [],
      companies: [{
        companyId,
        companyName: 'Empresa Cotacao Offline',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: [profile],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: companyId,
        label: 'Empresa Cotacao Offline',
        groupId: null,
        companyIds: [companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: userId,
      email: `offline-${roleKey}-${userId}@test.invalid`,
      name: roleKey === 'requester' ? 'Solicitante da demanda' : 'Agente de cotacao',
      role: 'company_admin',
      tenant_id: tenantId,
      company_id: companyId,
      empresa_ids: [companyId],
      corporate_profile: profile,
      permissoes: permissions,
      ativo: true,
    },
  }
}

function futureDateOnly(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function futureIsoDateTime(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
