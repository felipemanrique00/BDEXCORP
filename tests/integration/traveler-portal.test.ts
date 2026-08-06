import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { getTenantDataSummary } from '@/lib/server/system-data-summary-service'
import {
  getTravelerPortalOverview,
  getTravelerVoucherDownloadDescriptor,
  getTravelerVoucherFileId,
} from '@/lib/server/traveler-portal-service'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL traveler portal', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const ambiguousUserId = randomUUID()
  const companyAllowed = `company-${randomUUID()}`
  const companyDenied = `company-${randomUUID()}`
  const employeeLinked = `employee-${randomUUID()}`
  const employeeSameEmail = `employee-${randomUUID()}`
  const employeeDenied = `employee-${randomUUID()}`
  const demandLinked = `demand-${randomUUID()}`
  const demandDenied = `demand-${randomUUID()}`
  const reservationLinked = `reservation-${randomUUID()}`
  const voucherLinked = `voucher-${randomUUID()}`
  const voucherDenied = `voucher-${randomUUID()}`
  const fileLinked = randomUUID()
  const fileDenied = randomUUID()
  const verifiedEmail = `traveler-${userId}@test.invalid`
  const ambiguousEmail = `ambiguous-${ambiguousUserId}@test.invalid`
  const principal = principalFor(tenantId, userId, verifiedEmail, [companyAllowed])

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug, settings)
       values ($1, 'Traveler Portal Tenant', $2, $3::jsonb)`,
      [
        tenantId,
        `traveler-${tenantId}`,
        JSON.stringify({
          supportLabel: 'Central BBT',
          supportPhone: '+55 62 3000-0000',
          supportEmail: 'suporte@test.invalid',
        }),
      ],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values
         ($1, $2, 'Viajante Vinculado', 'active', now()),
         ($3, $4, 'Viajante Ambiguo', 'active', now())`,
      [userId, verifiedEmail, ambiguousUserId, ambiguousEmail],
    )

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (
           id, tenant_id, legal_name, trade_name, contact_email, contact_phone
         ) values
           ($1, $3, 'Empresa Permitida SA', 'Empresa Permitida', 'empresa@test.invalid', '+55 62 3000-1000'),
           ($2, $3, 'Empresa Negada SA', 'Empresa Negada', 'negada@test.invalid', '+55 62 3000-2000')`,
        [companyAllowed, companyDenied, tenantId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, email
         ) values
           ($1, $6, $4, '1001', 'Pessoa Vinculada', $7),
           ($2, $6, $4, '1002', 'Mesmo Email Sem Vinculo', $7),
           ($3, $6, $5, '1003', 'Pessoa Fora do Escopo', $7),
           ($8, $6, $4, '1004', 'Ambiguo Um', $9),
           ($10, $6, $4, '1005', 'Ambiguo Dois', $9)`,
        [
          employeeLinked,
          employeeSameEmail,
          employeeDenied,
          companyAllowed,
          companyDenied,
          tenantId,
          verifiedEmail,
          `employee-${randomUUID()}`,
          ambiguousEmail,
          `employee-${randomUUID()}`,
        ],
      )
      await client.query(
        `insert into requesters (
           id, tenant_id, company_id, employee_id, user_id, name, email
         ) values ($1, $2, $3, $4, $5, 'Pessoa Vinculada', $6)`,
        [`requester-${randomUUID()}`, tenantId, companyAllowed, employeeLinked, userId, verifiedEmail],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number, service_type,
           passenger_name_snapshot, status, lifecycle_status, travel_start_date,
           travel_end_date, destination, final_amount, internal_notes, metadata
         ) values
           ($1, $3, $4, $5, 'OS-TRAVEL-001', 'air', 'PESSOA VINCULADA',
            'emitido', 'issued', '2026-08-10', '2026-08-12', 'Sao Paulo', 2500,
            'nota interna secreta', $6::jsonb),
           ($2, $3, $7, $8, 'OS-TRAVEL-002', 'hotel', 'PESSOA NEGADA',
            'emitido', 'issued', '2026-08-15', '2026-08-16', 'Destino Sigiloso', 9000,
            'nao pode aparecer', '{}'::jsonb)`,
        [
          demandLinked,
          demandDenied,
          tenantId,
          companyAllowed,
          employeeLinked,
          JSON.stringify({ markup: 999, travelerVisible: true }),
          companyDenied,
          employeeDenied,
        ],
      )
      await client.query(
        `insert into reservations (
           id, tenant_id, demand_id, company_id, employee_id, provider,
           provider_reference, status, service_type, passenger_name_snapshot,
            start_at, end_at, gross_amount, final_amount, provider_payload, metadata
          ) values (
            $1, $2, $3, $4, $5, 'Companhia Teste', 'ABC123', 'confirmed',
            'air', 'PESSOA VINCULADA', '2026-08-10T12:00:00Z',
            '2026-08-10T14:00:00Z', 1800, 2500, $6::jsonb, $7::jsonb
          )`,
        [
          reservationLinked,
          tenantId,
          demandLinked,
          companyAllowed,
          employeeLinked,
          JSON.stringify({ secret: 'provider-secret' }),
          JSON.stringify({ origin: 'GYN', destination: 'GRU', flightNumber: 'BBT123' }),
        ],
      )
      await client.query(
        `insert into stored_files (
           id, tenant_id, uploaded_by, purpose, original_name, storage_key,
           mime_type, size_bytes, sha256
         ) values
           ($1, $3, $4, 'voucher_pdf', 'voucher-allowed.pdf', $5, 'application/pdf', 10, $6),
           ($2, $3, $4, 'voucher_pdf', 'voucher-denied.pdf', $7, 'application/pdf', 10, $8)`,
        [
          fileLinked,
          fileDenied,
          tenantId,
          userId,
          `${tenantId}/traveler/${fileLinked}.pdf`,
          'a'.repeat(64),
          `${tenantId}/traveler/${fileDenied}.pdf`,
          'b'.repeat(64),
        ],
      )
      await client.query(
        `insert into vouchers (
           id, tenant_id, reservation_id, demand_id, company_id, employee_id,
           voucher_code, status, file_id, issued_at
         ) values
           ($1, $3, $4, $5, $6, $7, 'V-ALLOWED', 'issued', $8, now()),
           ($2, $3, null, $9, $10, $11, 'V-DENIED', 'issued', $12, now())`,
        [
          voucherLinked,
          voucherDenied,
          tenantId,
          reservationLinked,
          demandLinked,
          companyAllowed,
          employeeLinked,
          fileLinked,
          demandDenied,
          companyDenied,
          employeeDenied,
          fileDenied,
        ],
      )
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = any($1::uuid[])', [[userId, ambiguousUserId]])
    await pool.end()
  })

  it('uses an explicit requester link before verified email matching', async () => {
    const overview = await getTravelerPortalOverview(principal)

    expect(overview.identitySource).toBe('requester')
    expect(overview.profiles).toEqual([
      expect.objectContaining({ id: employeeLinked, identificationCode: '1001' }),
    ])
    expect(overview.upcomingTrips).toEqual([
      expect.objectContaining({
        demandId: demandLinked,
        companyId: companyAllowed,
        destination: 'Sao Paulo',
      }),
    ])
    expect(JSON.stringify(overview)).not.toMatch(
      /Mesmo Email Sem Vinculo|Destino Sigiloso|nota interna|provider-secret|markup|2500|9000/i,
    )
  })

  it('rejects ambiguous email-only identity and protects voucher ownership', async () => {
    const ambiguous = await getTravelerPortalOverview(
      principalFor(tenantId, ambiguousUserId, ambiguousEmail, [companyAllowed]),
    )
    expect(ambiguous.identitySource).toBe('unlinked')
    expect(ambiguous.profiles).toEqual([])

    await expect(getTravelerVoucherFileId(principal, voucherLinked)).resolves.toBe(fileLinked)
    await expect(getTravelerVoucherFileId(principal, voucherDenied)).resolves.toBeNull()
  })

  it('resolves current presentation rules before exposing a persisted voucher artifact', async () => {
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `update vouchers
         set metadata = $3::jsonb
         where tenant_id = $1 and id = $2`,
        [
          tenantId,
          voucherLinked,
          JSON.stringify({
            numero: '1001',
            tipo: 'Hotel',
            passageiro_nome: 'Pessoa Vinculada',
            fornecedor_nome: 'Hotel Portal Teste',
            hotel_nome: 'Hotel Portal Teste',
            total: 999.99,
            moeda: 'BRL',
            emitido_por_user_id: userId,
            emitido_por_user_name: 'Operador Interno',
          }),
        ],
      )
      await client.query(
        `insert into voucher_presentation_settings (
           tenant_id, scope_type, company_id,
           show_confirmed_values, show_cancellation_terms, show_administrative_data,
           created_by, updated_by
         ) values ($1, 'company', $2, false, false, false, $3, $3)`,
        [tenantId, companyAllowed, userId],
      )
    })

    const descriptor = await getTravelerVoucherDownloadDescriptor(principal, voucherLinked)
    expect(descriptor).toEqual(expect.objectContaining({
      fileId: fileLinked,
      presentationSettings: expect.objectContaining({
        showConfirmedValues: false,
        showCancellationTerms: false,
        showAdministrativeData: false,
      }),
      voucher: expect.objectContaining({
        id: voucherLinked,
        hotel_nome: 'Hotel Portal Teste',
        presentation_settings: expect.objectContaining({ showConfirmedValues: false }),
      }),
    }))
  })

  it('summarizes reservations using the current relational schema', async () => {
    const summary = await getTenantDataSummary(principal)
    expect(summary.reservations).toBe(1)
  })
})

function principalFor(
  tenantId: string,
  userId: string,
  email: string,
  companyIds: string[],
): RequestPrincipal {
  const permissions: Permissoes = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    acessar_portal_viajante: true,
  }
  return {
    sessionId: randomUUID(),
    tenantId,
    tenantSlug: `traveler-${tenantId}`,
    tenantStatus: 'active',
    membershipId: randomUUID(),
    roleKey: 'requester',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds,
      groupIds: [],
      companies: companyIds.map((companyId) => ({
        companyId,
        companyName: companyId,
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['requester'],
        permissions,
      })),
      groups: [],
      contexts: companyIds.map((companyId) => ({
        type: 'company' as const,
        id: companyId,
        label: companyId,
        groupId: null,
        companyIds: [companyId],
        canViewConsolidated: false,
      })),
      defaultContext: { type: 'company', id: companyIds[0] },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: userId,
      email,
      name: 'Viajante',
      role: 'colaborador',
      tenant_id: tenantId,
      company_id: companyIds[0],
      empresa_ids: companyIds,
      corporate_profile: 'requester',
      permissoes: permissions,
      ativo: true,
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
