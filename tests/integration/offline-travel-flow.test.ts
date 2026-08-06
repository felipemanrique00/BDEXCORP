import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import {
  createOfflineReservation,
  issueOfflineReservation,
} from '@/lib/server/offline-travel-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL offline travel flow', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const employeeId = `employee-${randomUUID()}`
  const budgetId = randomUUID()
  const demandId = `demand-${randomUUID()}`
  const demandWithoutVoucherId = `demand-${randomUUID()}`
  const reservationKey = `offline-reserve-${randomUUID()}`
  const issueKey = `offline-issue-${randomUUID()}`
  const principal = principalFor(tenantId, userId, companyId)

  const reservationInput = {
    demandId,
    companyId,
    expectedLifecycleVersion: 1,
    serviceKey: 'outros' as const,
    supplierName: 'Fornecedor Integracao Offline',
    externalReference: `CONF-${randomUUID()}`,
    channel: 'email' as const,
    startsAt: '2026-08-20',
    endsAt: '2026-08-22',
    amounts: { gross: 500, taxes: 50, total: 550, currency: 'BRL' },
    details: {
      itemName: 'Servico Integracao Offline',
      destination: 'Sao Paulo',
      accommodation: 'Apartamento standard',
    },
    confirmed: true as const,
    idempotencyKey: reservationKey,
  }

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Offline Travel Tenant', $2)`,
      [tenantId, `offline-travel-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values ($1, $2, 'Agente Offline', 'active', now())`,
      [userId, `offline-agent-${userId}@test.invalid`],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (
           id, tenant_id, legal_name, trade_name, status
         ) values ($1, $2, 'Empresa Offline SA', 'Empresa Offline', 'active')`,
        [companyId, tenantId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, status
         ) values ($1, $2, $3, 'OFF-001', 'Viajante Offline', 'active')`,
        [employeeId, tenantId, companyId],
      )
      await client.query(
        `insert into budgets (
           id, tenant_id, company_id, name, period_start, period_end,
           currency, amount, status, created_by
         ) values (
           $1, $2, $3, 'Orcamento Offline', '2026-01-01', '2026-12-31',
           'BRL', 2000, 'active', $4
         )`,
        [budgetId, tenantId, companyId, userId],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number, service_type,
           passenger_name_snapshot, status, priority, travel_start_date,
           travel_end_date, destination, cost_center, estimated_amount,
           lifecycle_status, lifecycle_version
         ) values (
           $1, $2, $3, $4, 'OS-OFFLINE-001', 'Outros',
           'Viajante Offline', 'em_andamento', 'normal', '2026-08-20',
           '2026-08-22', 'Sao Paulo', 'CC-001', 550,
           'submitted', 1
         )`,
        [demandId, tenantId, companyId, employeeId],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number, service_type,
           passenger_name_snapshot, status, priority, travel_start_date,
           travel_end_date, destination, cost_center, estimated_amount,
           lifecycle_status, lifecycle_version
         ) values (
           $1, $2, $3, $4, 'OS-OFFLINE-002', 'Outros',
           'Viajante Offline', 'em_andamento', 'normal', '2026-09-10',
           '2026-09-12', 'Rio de Janeiro', 'CC-001', 440,
           'submitted', 1
         )`,
        [demandWithoutVoucherId, tenantId, companyId, employeeId],
      )
      // Simula um tenant migrado que ja possui vouchers, mas ainda nao tem a
      // linha de sequencia relacional. A primeira emissao deve continuar do
      // maior sufixo existente, sem reutilizar um numero legado.
      await client.query(
        `insert into vouchers (
           id, tenant_id, company_id, voucher_code, status, issued_at,
           metadata, fingerprint, created_by, updated_by
         ) values (
           'H-99999', $1, $2, 'H-99999', 'issued', now(),
           '{}'::jsonb, $3, $4, $4
         )`,
        [tenantId, companyId, `legacy-voucher-${tenantId}`, userId],
      )
      await seedAutomaticOfflineApprovals(client, tenantId, companyId, userId)
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = $1', [userId])
    await pool.end()
  })

  it('records reservation, issuance and voucher through the governed lifecycle', async () => {
    const reservation = await createOfflineReservation(principal, reservationInput)

    expect(reservation).toMatchObject({
      demandId,
      lifecycleStatus: 'reserved',
      replayed: false,
    })
    expect(reservation.lifecycleVersion).toBeGreaterThan(1)

    const heldBudget = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{
        status: string
        amount: string
        currency: string
        reservation_id: string | null
        committed_amount: string
        consumed_amount: string
        operation_commitment_id: string | null
        operation_status: string
      }>(
        `select commitment.status, commitment.amount, commitment.currency,
                commitment.reservation_id, budget.committed_amount, budget.consumed_amount,
                operation.budget_commitment_id as operation_commitment_id,
                operation.status as operation_status
         from budget_commitments commitment
         join budgets budget
           on budget.tenant_id = commitment.tenant_id and budget.id = commitment.budget_id
         join travel_provider_operations operation
           on operation.tenant_id = commitment.tenant_id
          and operation.budget_commitment_id = commitment.id
          and operation.operation_type = 'reserve'
         where commitment.tenant_id = $1 and commitment.reservation_id = $2`,
        [tenantId, reservation.reservationId],
      )
      return result.rows[0]
    })
    expect(heldBudget).toMatchObject({
      status: 'committed',
      amount: '550.00',
      currency: 'BRL',
      reservation_id: reservation.reservationId,
      committed_amount: '550.00',
      consumed_amount: '0.00',
      operation_status: 'succeeded',
    })
    expect(heldBudget.operation_commitment_id).toBeTruthy()

    const issueInput = {
      demandId,
      expectedLifecycleVersion: reservation.lifecycleVersion,
      supplierConfirmation: true as const,
      document: {
        kind: 'confirmacao' as const,
        reference: `DOC-${randomUUID()}`,
      },
      payment: {
        method: 'faturado' as const,
        reference: 'FAT-30-DIAS',
      },
      partial: false,
      generateVoucher: true,
      confirmed: true as const,
      idempotencyKey: issueKey,
    }
    const emission = await issueOfflineReservation(principal, reservation.reservationId, issueInput)

    expect(emission).toMatchObject({
      reservationId: reservation.reservationId,
      demandId,
      lifecycleStatus: 'issued',
      partial: false,
      replayed: false,
    })
    expect(emission.voucherId).toBe('O-100000')

    const rows = await tenantTransaction(pool, tenantId, async (client) => {
      const counts = await client.query<{
        reservations: string
        emissions: string
        vouchers: string
        operations: string
        events: string
      }>(
        `select
           (select count(*) from reservations where tenant_id = $1 and demand_id = $2) as reservations,
           (select count(*) from travel_emissions where tenant_id = $1 and demand_id = $2) as emissions,
           (select count(*) from vouchers where tenant_id = $1 and demand_id = $2) as vouchers,
           (select count(*) from travel_provider_operations where tenant_id = $1 and demand_id = $2) as operations,
           (select count(*) from domain_outbox where tenant_id = $1 and aggregate_id in ($3, $4)) as events`,
        [tenantId, demandId, reservation.reservationId, emission.emissionId],
      )
      const voucher = await client.query<{
        reservation_id: string
        emission_id: string
        status: string
      }>(
        `select reservation_id, emission_id, status
         from vouchers where tenant_id = $1 and id = $2`,
        [tenantId, emission.voucherId],
      )
      const emissionRecord = await client.query<{
        ticket_number: string | null
        provider_emission_id: string
      }>(
        `select ticket_number, provider_emission_id
         from travel_emissions where tenant_id = $1 and id = $2`,
        [tenantId, emission.emissionId],
      )
      const reservationRecord = await client.query<{ provider_reference: string }>(
        `select provider_reference
         from reservations where tenant_id = $1 and id = $2`,
        [tenantId, reservation.reservationId],
      )
      const approvalState = await client.query<{
        active_approval_instance_id: string | null
        approved_instances: string
      }>(
        `select demand.active_approval_instance_id,
                (select count(*)::text from approval_instances instance
                 where instance.tenant_id = demand.tenant_id and instance.demand_id = demand.id
                   and instance.status = 'approved') as approved_instances
         from demands demand where demand.tenant_id = $1 and demand.id = $2`,
        [tenantId, demandId],
      )
      const budgetRecord = await client.query<{
        status: string
        committed_amount: string
        consumed_amount: string
      }>(
        `select commitment.status, budget.committed_amount, budget.consumed_amount
         from budget_commitments commitment
         join budgets budget
           on budget.tenant_id = commitment.tenant_id and budget.id = commitment.budget_id
         where commitment.tenant_id = $1 and commitment.reservation_id = $2`,
        [tenantId, reservation.reservationId],
      )
      return {
        counts: counts.rows[0],
        voucher: voucher.rows[0],
        emission: emissionRecord.rows[0],
        reservation: reservationRecord.rows[0],
        approvalState: approvalState.rows[0],
        budget: budgetRecord.rows[0],
      }
    })

    expect(rows.counts).toEqual({
      reservations: '1',
      emissions: '1',
      vouchers: '1',
      operations: '2',
      events: '6',
    })
    expect(rows.voucher).toEqual({
      reservation_id: reservation.reservationId,
      emission_id: emission.emissionId,
      status: 'issued',
    })
    expect(rows.emission.ticket_number).toBeNull()
    expect(rows.emission.provider_emission_id).toMatch(/^offline-emission:[a-f0-9]{48}$/)
    expect(rows.reservation.provider_reference).toMatch(/^outros:[a-z0-9-]+:[a-f0-9]{40}$/)
    expect(rows.reservation.provider_reference).not.toContain(reservationInput.externalReference)
    expect(rows.approvalState).toEqual({
      active_approval_instance_id: null,
      approved_instances: '3',
    })
    expect(rows.budget).toEqual({
      status: 'consumed',
      committed_amount: '0.00',
      consumed_amount: '550.00',
    })

    const reservationReplay = await createOfflineReservation(principal, reservationInput)
    const emissionReplay = await issueOfflineReservation(principal, reservation.reservationId, issueInput)
    expect(reservationReplay).toMatchObject({ reservationId: reservation.reservationId, replayed: true })
    expect(emissionReplay).toMatchObject({ emissionId: emission.emissionId, voucherId: emission.voucherId, replayed: true })

    const replayBudget = await tenantTransaction(pool, tenantId, async (client) => client.query<{
      committed_amount: string
      consumed_amount: string
      commitments: string
    }>(
      `select budget.committed_amount, budget.consumed_amount,
              (select count(*) from budget_commitments commitment
               where commitment.tenant_id = $1 and commitment.reservation_id = $3) as commitments
       from budgets budget where budget.tenant_id = $1 and budget.id = $2`,
      [tenantId, budgetId, reservation.reservationId],
    ))
    expect(replayBudget.rows[0]).toEqual({
      committed_amount: '0.00',
      consumed_amount: '550.00',
      commitments: '1',
    })

    await expect(issueOfflineReservation(
      principalWithoutCompanyAccess(principal),
      reservation.reservationId,
      issueInput,
    )).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' })
    await expect(issueOfflineReservation(principal, reservation.reservationId, {
      ...issueInput,
      idempotencyKey: `offline-reissue-${randomUUID()}`,
    })).rejects.toMatchObject({
      code: 'OFFLINE_RESERVATION_ALREADY_ISSUED',
      status: 409,
    })
  })

  it('rejects reuse of an idempotency key with a different payload', async () => {
    await expect(createOfflineReservation(principal, {
      ...reservationInput,
      supplierName: 'Outro fornecedor',
    })).rejects.toMatchObject({
      code: 'OFFLINE_IDEMPOTENCY_CONFLICT',
      status: 409,
    })
  })

  it('enforces demand service scope and omits voucher events when no voucher is generated', async () => {
    const baseInput = {
      ...reservationInput,
      demandId: demandWithoutVoucherId,
      expectedLifecycleVersion: 1,
      externalReference: `CONF-${randomUUID()}`,
      idempotencyKey: 'r'.repeat(200),
      amounts: { gross: 400, taxes: 40, total: 440, currency: 'BRL' },
      startsAt: '2026-09-10',
      endsAt: '2026-09-12',
      details: {
        itemName: 'Servico Sem Voucher',
        destination: 'Rio de Janeiro',
      },
    }
    await expect(createOfflineReservation(principal, {
      ...baseInput,
      serviceKey: 'aereo',
      details: { origin: 'GYN', destination: 'GIG' },
    })).rejects.toMatchObject({
      code: 'OFFLINE_SERVICE_SCOPE_MISMATCH',
      status: 422,
    })

    const reservation = await createOfflineReservation(principal, baseInput)
    const emission = await issueOfflineReservation(principal, reservation.reservationId, {
      demandId: demandWithoutVoucherId,
      expectedLifecycleVersion: reservation.lifecycleVersion,
      supplierConfirmation: true,
      document: { kind: 'confirmacao', reference: `DOC-${randomUUID()}` },
      payment: { method: 'faturado', reference: 'FAT-30-DIAS' },
      generateVoucher: false,
      confirmed: true,
      idempotencyKey: 'i'.repeat(200),
    })

    expect(emission).toMatchObject({ voucherId: null, partial: false, lifecycleStatus: 'issued' })
    const events = await tenantTransaction(pool, tenantId, async (client) => client.query<{ event_type: string }>(
      `select event_type from domain_outbox
       where tenant_id = $1 and aggregate_id = $2
       order by event_type`,
      [tenantId, emission.emissionId],
    ))
    expect(events.rows.map((row) => row.event_type)).toEqual([
      'finance.issuance.record',
      'reports.travel.refresh',
      'risk.trip.monitor',
      'travel.issuance.notify',
    ])
  })

  it('does not reuse an approved offline approval for a different reservation intent', async () => {
    const isolatedDemandId = `demand-${randomUUID()}`
    const staleApprovalInstanceId = randomUUID()
    const staleIntentHash = '0'.repeat(64)

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number, service_type,
           passenger_name_snapshot, status, priority, travel_start_date,
           travel_end_date, destination, cost_center, estimated_amount,
           lifecycle_status, lifecycle_version
         ) values (
           $1, $2, $3, $4, $5, 'Outros',
           'Viajante com intencao alterada', 'em_andamento', 'normal', '2026-11-10',
           '2026-11-12', 'Brasilia', 'CC-001', 275,
           'submitted', 1
         )`,
        [isolatedDemandId, tenantId, companyId, employeeId, `OS-INTENT-${randomUUID()}`],
      )
      const workflow = await client.query<{
        workflow_definition_id: string
        workflow_version_id: string
        graph_snapshot: Record<string, unknown>
      }>(
        `select definition.id as workflow_definition_id,
                version.id as workflow_version_id, version.graph_snapshot
         from approval_workflow_definitions definition
         join approval_workflow_versions version
           on version.tenant_id = definition.tenant_id
          and version.workflow_definition_id = definition.id
         where definition.tenant_id = $1 and version.status = 'published'
         order by version.published_at desc
         limit 1`,
        [tenantId],
      )
      const published = workflow.rows[0]
      if (!published) throw new Error('Workflow publicado de fixture nao encontrado.')
      await client.query(
        `insert into approval_instances (
           id, tenant_id, workflow_definition_id, workflow_version_id, demand_id,
           company_id, employee_id, instance_type, status, subject_snapshot,
           workflow_snapshot, input_hash, source_idempotency_key, started_by,
           completed_at
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7, 'merit', 'approved', $8::jsonb,
           $9::jsonb, $10, $11, $12,
           now()
         )`,
        [
          staleApprovalInstanceId,
          tenantId,
          published.workflow_definition_id,
          published.workflow_version_id,
          isolatedDemandId,
          companyId,
          employeeId,
          JSON.stringify({
            tenantId,
            companyId,
            offlineOperation: true,
            offlineCheckpoint: 'merit',
            offlineIntentHash: staleIntentHash,
          }),
          JSON.stringify(published.graph_snapshot),
          'c'.repeat(64),
          `stale-offline-intent-${randomUUID()}`,
          userId,
        ],
      )
      await client.query(
        `update demands set active_approval_instance_id = $3
         where tenant_id = $1 and id = $2`,
        [tenantId, isolatedDemandId, staleApprovalInstanceId],
      )
    })

    const reservation = await createOfflineReservation(principal, {
      demandId: isolatedDemandId,
      companyId,
      expectedLifecycleVersion: 1,
      serviceKey: 'outros',
      supplierName: 'Fornecedor da nova intencao',
      externalReference: `NEW-INTENT-${randomUUID()}`,
      channel: 'email',
      startsAt: '2026-11-10',
      endsAt: '2026-11-12',
      amounts: { gross: 250, taxes: 25, total: 275, currency: 'BRL' },
      details: { itemName: 'Servico da nova intencao', destination: 'Brasilia' },
      confirmed: true,
      idempotencyKey: `new-intent-reserve-${randomUUID()}`,
    })

    expect(reservation).toMatchObject({
      demandId: isolatedDemandId,
      lifecycleStatus: 'reserved',
      replayed: false,
    })
    const meritApprovals = await tenantTransaction(pool, tenantId, async (client) => client.query<{
      id: string
      offline_intent_hash: string | null
    }>(
      `select id, subject_snapshot ->> 'offlineIntentHash' as offline_intent_hash
       from approval_instances
       where tenant_id = $1 and demand_id = $2 and instance_type = 'merit'
         and status = 'approved'
       order by created_at, id`,
      [tenantId, isolatedDemandId],
    ))
    const replacement = meritApprovals.rows.find((row) => row.id !== staleApprovalInstanceId)

    expect(meritApprovals.rows).toHaveLength(2)
    expect(meritApprovals.rows).toContainEqual({
      id: staleApprovalInstanceId,
      offline_intent_hash: staleIntentHash,
    })
    expect(replacement).toBeDefined()
    expect(replacement?.offline_intent_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(replacement?.offline_intent_hash).not.toBe(staleIntentHash)
  })

  it('does not bypass a pending merit approval when quotation has no approval policy', async () => {
    const isolatedCompanyId = `company-${randomUUID()}`
    const isolatedEmployeeId = `employee-${randomUUID()}`
    const isolatedDemandId = `demand-${randomUUID()}`
    const approvalInstanceId = randomUUID()

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name, trade_name, status)
         values ($1, $2, 'Empresa sem politica de cotacao SA', 'Empresa sem politica de cotacao', 'active')`,
        [isolatedCompanyId, tenantId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, status
         ) values ($1, $2, $3, 'PENDING-001', 'Viajante com aprovacao pendente', 'active')`,
        [isolatedEmployeeId, tenantId, isolatedCompanyId],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number, service_type,
           passenger_name_snapshot, status, priority, travel_start_date,
           travel_end_date, destination, lifecycle_status, lifecycle_version
         ) values (
           $1, $2, $3, $4, $5, 'Outros',
           'Viajante com aprovacao pendente', 'pendente', 'normal', '2026-10-10',
           '2026-10-12', 'Curitiba', 'pending_merit_approval', 3
         )`,
        [isolatedDemandId, tenantId, isolatedCompanyId, isolatedEmployeeId, `OS-PENDING-${randomUUID()}`],
      )
      const workflow = await client.query<{
        workflow_definition_id: string
        workflow_version_id: string
        graph_snapshot: Record<string, unknown>
      }>(
        `select definition.id as workflow_definition_id,
                version.id as workflow_version_id, version.graph_snapshot
         from approval_workflow_definitions definition
         join approval_workflow_versions version
           on version.tenant_id = definition.tenant_id
          and version.workflow_definition_id = definition.id
         where definition.tenant_id = $1 and version.status = 'published'
         order by version.published_at desc
         limit 1`,
        [tenantId],
      )
      const published = workflow.rows[0]
      if (!published) throw new Error('Workflow publicado de fixture nao encontrado.')
      await client.query(
        `insert into approval_instances (
           id, tenant_id, workflow_definition_id, workflow_version_id, demand_id,
           company_id, employee_id, instance_type, status, subject_snapshot,
           workflow_snapshot, input_hash, source_idempotency_key, started_by
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7, 'merit', 'in_progress', $8::jsonb,
           $9::jsonb, $10, $11, $12
         )`,
        [
          approvalInstanceId,
          tenantId,
          published.workflow_definition_id,
          published.workflow_version_id,
          isolatedDemandId,
          isolatedCompanyId,
          isolatedEmployeeId,
          JSON.stringify({ tenantId, companyId: isolatedCompanyId }),
          JSON.stringify(published.graph_snapshot),
          'b'.repeat(64),
          `pending-merit-${randomUUID()}`,
          userId,
        ],
      )
      await client.query(
        `update demands set active_approval_instance_id = $3
         where tenant_id = $1 and id = $2`,
        [tenantId, isolatedDemandId, approvalInstanceId],
      )
    })

    await expect(createOfflineReservation(
      principalFor(tenantId, userId, isolatedCompanyId),
      {
        demandId: isolatedDemandId,
        companyId: isolatedCompanyId,
        expectedLifecycleVersion: 3,
        serviceKey: 'outros',
        supplierName: 'Fornecedor bloqueado por aprovacao',
        externalReference: `PENDING-${randomUUID()}`,
        channel: 'email',
        startsAt: '2026-10-10',
        endsAt: '2026-10-12',
        amounts: { gross: 300, taxes: 30, total: 330, currency: 'BRL' },
        details: { itemName: 'Servico bloqueado por aprovacao', destination: 'Curitiba' },
        confirmed: true,
        idempotencyKey: `pending-reserve-${randomUUID()}`,
      },
    )).rejects.toMatchObject({
      code: 'OFFLINE_MERIT_APPROVAL_PENDING',
      status: 409,
    })

    const state = await tenantTransaction(pool, tenantId, async (client) => client.query<{
      lifecycle_status: string
      reservations: string
    }>(
      `select demand.lifecycle_status,
              (select count(*)::text from reservations
               where tenant_id = demand.tenant_id and demand_id = demand.id) as reservations
       from demands demand where demand.tenant_id = $1 and demand.id = $2`,
      [tenantId, isolatedDemandId],
    ))
    expect(state.rows[0]).toEqual({ lifecycle_status: 'pending_merit_approval', reservations: '0' })
  })
})

function principalFor(tenantId: string, userId: string, companyId: string): RequestPrincipal {
  const permissions: Permissoes = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    operar_reservas: true,
    operar_emissoes: true,
    ver_reservas: true,
    ver_emissoes: true,
    ver_vouchers: true,
    criar_demandas: true,
    ver_aprovacoes: true,
  }
  return {
    sessionId: randomUUID(),
    tenantId,
    tenantSlug: `offline-travel-${tenantId}`,
    tenantStatus: 'active',
    membershipId: randomUUID(),
    roleKey: 'agent',
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
        companyName: 'Empresa Offline',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['company_admin'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: companyId,
        label: 'Empresa Offline',
        groupId: null,
        companyIds: [companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: userId,
      email: `offline-agent-${userId}@test.invalid`,
      name: 'Agente Offline',
      role: 'company_admin',
      tenant_id: tenantId,
      company_id: companyId,
      empresa_ids: [companyId],
      corporate_profile: 'company_admin',
      permissoes: permissions,
      ativo: true,
    },
  }
}

async function seedAutomaticOfflineApprovals(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  userId: string,
): Promise<void> {
  const workflowId = randomUUID()
  const workflowVersionId = randomUUID()
  const startNodeId = randomUUID()
  const endNodeId = randomUUID()
  const edgeId = randomUUID()
  const workflowCode = `offline-auto-${workflowId}`
  const contentHash = 'a'.repeat(64)
  const snapshot = {
    workflowId,
    workflowVersionId,
    version: 1,
    code: workflowCode,
    name: 'Aprovacao automatica offline',
    nodes: [
      { id: startNodeId, key: 'start', name: 'Inicio', type: 'start' },
      { id: endNodeId, key: 'end', name: 'Fim', type: 'end' },
    ],
    edges: [{ id: edgeId, sourceNodeId: startNodeId, targetNodeId: endNodeId, sequence: 0 }],
    validFrom: null,
    validUntil: null,
    contentHash,
  }
  await client.query(
    `insert into approval_workflow_definitions (
       id, tenant_id, workflow_code, name, description, workflow_type, status, created_by
     ) values ($1, $2, $3, $4, 'Workflow automatico para teste offline.', 'generic', 'draft', $5)`,
    [workflowId, tenantId, workflowCode, snapshot.name, userId],
  )
  await client.query(
    `insert into approval_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status,
       graph_snapshot, content_hash, change_summary, created_by
     ) values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, 'Fixture de integracao', $6)`,
    [workflowVersionId, tenantId, workflowId, JSON.stringify(snapshot), contentHash, userId],
  )
  await client.query(
    `insert into approval_nodes (
       id, tenant_id, workflow_version_id, node_key, name, node_type
     ) values
       ($1, $2, $3, 'start', 'Inicio', 'start'),
       ($4, $2, $3, 'end', 'Fim', 'end')`,
    [startNodeId, tenantId, workflowVersionId, endNodeId],
  )
  await client.query(
    `insert into approval_edges (
       id, tenant_id, workflow_version_id, source_node_id, target_node_id, sequence
     ) values ($1, $2, $3, $4, $5, 0)`,
    [edgeId, tenantId, workflowVersionId, startNodeId, endNodeId],
  )
  await client.query(
    `insert into approval_workflow_scopes (
       tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, 'company', $3, 'include', 100)`,
    [tenantId, workflowVersionId, companyId],
  )
  await client.query(
    `update approval_workflow_versions set
       status = 'published', approved_by = $3, approved_at = now(),
       published_by = $3, published_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, workflowVersionId, userId],
  )
  await client.query(
    `update approval_workflow_definitions set status = 'published', current_version = 1
     where tenant_id = $1 and id = $2`,
    [tenantId, workflowId],
  )

  for (const checkpoint of ['quotation', 'reservation', 'issuance']) {
    const policyId = randomUUID()
    const policyVersionId = randomUUID()
    const policyCode = `offline-auto-${checkpoint}-${policyId}`
    const actions = [{
      type: 'request_approval',
      message: `Aprovacao automatica de ${checkpoint}.`,
      configuration: { workflow: workflowCode },
    }]
    await client.query(
      `insert into policy_definitions (
         id, tenant_id, policy_code, name, description, category, status,
         priority, severity, inheritance_mode, overridable,
         business_justification, current_version, created_by
       ) values (
         $1, $2, $3, $4, 'Politica automatica para integracao offline.', 'approval', 'draft',
         100, 'warning', 'merge', true, 'Validar o fluxo governado offline.', null, $5
       )`,
      [policyId, tenantId, policyCode, `Aprovacao offline ${checkpoint}`, userId],
    )
    await client.query(
      `insert into policy_versions (
         id, tenant_id, policy_definition_id, version_number, status,
         name, description, category, priority, severity, inheritance_mode,
         overridable, condition_ast, actions_ast, exception_ast, checkpoints,
         business_justification, content_hash, change_summary, created_by
       ) values (
         $1, $2, $3, 1, 'draft', $4,
         'Politica automatica para integracao offline.', 'approval', 100, 'warning', 'merge',
         true, $5::jsonb, $6::jsonb, '[]'::jsonb, $7::text[],
         'Validar o fluxo governado offline.', $8, 'Fixture de integracao', $9
       )`,
      [
        policyVersionId,
        tenantId,
        policyId,
        `Aprovacao offline ${checkpoint}`,
        JSON.stringify({ fact: 'operation.channel', operator: 'eq', value: 'offline' }),
        JSON.stringify(actions),
        [checkpoint],
        contentHash,
        userId,
      ],
    )
    await client.query(
      `insert into policy_scopes (
         tenant_id, policy_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, 'company', $3, 'include', 100)`,
      [tenantId, policyVersionId, companyId],
    )
    await client.query(
      `update policy_versions set
         status = 'published', approved_by = $3, approved_at = now(),
         published_by = $3, published_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, policyVersionId, userId],
    )
    await client.query(
      `update policy_definitions set status = 'published', current_version = 1
       where tenant_id = $1 and id = $2`,
      [tenantId, policyId],
    )
    await client.query(
      `insert into policy_publications (
         tenant_id, policy_definition_id, policy_version_id, status,
         effective_from, published_by, approved_by, publication_reason
       ) values ($1, $2, $3, 'active', now() - interval '1 minute', $4, $4, 'Fixture de integracao')`,
      [tenantId, policyId, policyVersionId, userId],
    )
  }
}

function principalWithoutCompanyAccess(principal: RequestPrincipal): RequestPrincipal {
  return {
    ...principal,
    corporateAccess: {
      ...principal.corporateAccess!,
      tenantWide: false,
      companyIds: [],
      groupIds: [],
      companies: [],
      groups: [],
      contexts: [],
      defaultContext: null,
    },
    user: {
      ...principal.user,
      company_id: null,
      empresa_ids: [],
    },
  }
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
