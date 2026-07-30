import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'
import { Pool, type PoolClient } from 'pg'

import { hashPassword } from '../../lib/security/password'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const applicationUrl = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

test.describe('portal do viajante', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!databaseUrl, 'PostgreSQL de teste nao configurado.')

  const fixture = createFixture()
  let pool: Pool

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 })
    await seedTraveler(pool, fixture)
  })

  test.afterAll(async () => {
    if (!pool) return
    await cleanupTraveler(pool, fixture)
    await pool.end()
  })

  test('exibe somente as viagens autorizadas e salva uma copia offline', async ({ page }, testInfo) => {
    const login = await page.request.post('/api/auth/login', {
      data: { email: fixture.email, password: fixture.password },
      headers: {
        origin: applicationUrl,
        referer: `${applicationUrl}/login`,
      },
    })
    const loginBody = await login.json()
    expect({
      status: login.status(),
      code: loginBody.code || null,
      error: loginBody.error || null,
    }).toEqual({ status: 200, code: null, error: null })
    await page.goto('/dashboard/minha-viagem')
    await expect(page.getByRole('heading', { name: 'Minha viagem' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(fixture.destination, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(fixture.deniedDestination, { exact: true })).toHaveCount(0)
    await expect(page.getByText(`Voucher ${fixture.voucherCode}`, { exact: true })).toBeVisible()
    await testInfo.attach('portal-do-viajante', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })

    const scopedResponse = await page.evaluate(async (companyId) => {
      const response = await fetch(`/api/traveler/overview?companyId=${encodeURIComponent(companyId)}`, {
        cache: 'no-store',
      })
      return { status: response.status, body: await response.json() }
    }, fixture.companyDenied)
    expect(scopedResponse.status).toBe(200)
    expect(JSON.stringify(scopedResponse.body)).not.toContain(fixture.deniedDestination)

    const foreignVoucher = await page.evaluate(async (voucherId) => {
      const response = await fetch(`/api/traveler/vouchers/${encodeURIComponent(voucherId)}/download`)
      return response.status
    }, fixture.voucherDenied)
    expect(foreignVoucher).toBe(404)

    await page.getByRole('button', { name: 'Disponibilizar offline' }).click()
    await expect(page.getByText(/Copia offline atualizada em/)).toBeVisible()

    await page.getByRole('tab', { name: 'Meu cadastro' }).click()
    await expect(page.getByText(fixture.identificationCode, { exact: true })).toBeVisible()
    await expect(page.getByText('Documento', { exact: true })).toBeVisible()

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))
    expect(overflow.document).toBeLessThanOrEqual(1)
    expect(overflow.body).toBeLessThanOrEqual(1)
  })
})

interface TravelerFixture {
  tenantId: string
  planId: string
  planKey: string
  userId: string
  roleId: string
  membershipId: string
  companyAllowed: string
  companyDenied: string
  employeeAllowed: string
  employeeDenied: string
  demandAllowed: string
  demandDenied: string
  reservationAllowed: string
  voucherAllowed: string
  voucherDenied: string
  email: string
  password: string
  destination: string
  deniedDestination: string
  identificationCode: string
  voucherCode: string
}

function createFixture(): TravelerFixture {
  const userId = randomUUID()
  return {
    tenantId: randomUUID(),
    planId: randomUUID(),
    planKey: `traveler-e2e-${randomUUID()}`,
    userId,
    roleId: randomUUID(),
    membershipId: randomUUID(),
    companyAllowed: `company-${randomUUID()}`,
    companyDenied: `company-${randomUUID()}`,
    employeeAllowed: `employee-${randomUUID()}`,
    employeeDenied: `employee-${randomUUID()}`,
    demandAllowed: `demand-${randomUUID()}`,
    demandDenied: `demand-${randomUUID()}`,
    reservationAllowed: `reservation-${randomUUID()}`,
    voucherAllowed: `voucher-${randomUUID()}`,
    voucherDenied: `voucher-${randomUUID()}`,
    email: `traveler-e2e-${userId}@test.invalid`,
    password: `Traveler#${randomUUID()}Aa1`,
    destination: 'Destino E2E Autorizado',
    deniedDestination: 'Destino E2E Restrito',
    identificationCode: `TV-${Date.now()}`,
    voucherCode: `V-E2E-${Date.now()}`,
  }
}

async function seedTraveler(pool: Pool, fixture: TravelerFixture): Promise<void> {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + 10)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 2)
  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)

  await pool.query(
    `insert into plans (id, plan_key, name, entitlements)
     values ($1, $2, 'Traveler E2E Plan', '{}'::jsonb)`,
    [fixture.planId, fixture.planKey],
  )
  await pool.query(
    `insert into tenants (id, name, slug, status, settings)
     values ($1, 'Traveler E2E Tenant', $2, 'active', $3::jsonb)`,
    [
      fixture.tenantId,
      `traveler-e2e-${fixture.tenantId}`,
      JSON.stringify({
        supportLabel: 'Central de suporte E2E',
        supportEmail: 'suporte-e2e@test.invalid',
      }),
    ],
  )
  await pool.query(
    `insert into users (id, email, name, status, email_verified_at)
     values ($1, $2, 'Viajante E2E', 'active', now())`,
    [fixture.userId, fixture.email],
  )
  await pool.query(
    `insert into user_credentials (user_id, password_hash)
     values ($1, $2)`,
    [fixture.userId, await hashPassword(fixture.password)],
  )

  await tenantTransaction(pool, fixture.tenantId, async (client) => {
    await client.query(
      `insert into tenant_subscriptions (tenant_id, plan_id, status, billing_mode)
       values ($1, $2, 'active', 'manual')`,
      [fixture.tenantId, fixture.planId],
    )
    await client.query(
      `insert into roles (id, tenant_id, role_key, name, system_role)
       values ($1, $2, 'requester', 'Viajante', true)`,
      [fixture.roleId, fixture.tenantId],
    )
    await client.query(
      `insert into role_permissions (role_id, permission_key, allowed)
       values ($1, 'acessar_portal_viajante', true)`,
      [fixture.roleId],
    )
    await client.query(
      `insert into companies (id, tenant_id, legal_name, trade_name, status)
       values
         ($1, $3, 'Empresa E2E Permitida SA', 'Empresa E2E Permitida', 'active'),
         ($2, $3, 'Empresa E2E Restrita SA', 'Empresa E2E Restrita', 'active')`,
      [fixture.companyAllowed, fixture.companyDenied, fixture.tenantId],
    )
    await client.query(
      `insert into tenant_memberships (
         id, tenant_id, user_id, role_id, status, profile_key, company_id, allowed_company_ids
       ) values ($1, $2, $3, $4, 'active', 'operacional', $5, array[$5]::text[])`,
      [
        fixture.membershipId,
        fixture.tenantId,
        fixture.userId,
        fixture.roleId,
        fixture.companyAllowed,
      ],
    )
    await client.query(
      `insert into corporate_company_access_grants (
         tenant_id, membership_id, company_id, corporate_profile, status
       ) values ($1, $2, $3, 'requester', 'active')`,
      [fixture.tenantId, fixture.membershipId, fixture.companyAllowed],
    )
    await client.query(
      `insert into employees (
         id, tenant_id, company_id, identification_code, full_name,
         document_number, email, phone, department, cost_center
       ) values
         ($1, $3, $4, $6, 'Viajante E2E', '12345678901', $7, '+55 62 99999-0000', 'Produto', 'CC-100'),
         ($2, $3, $5, 'TV-RESTRICTED', 'Viajante Restrito', null, 'restricted@test.invalid', null, null, null)`,
      [
        fixture.employeeAllowed,
        fixture.employeeDenied,
        fixture.tenantId,
        fixture.companyAllowed,
        fixture.companyDenied,
        fixture.identificationCode,
        fixture.email,
      ],
    )
    await client.query(
      `insert into requesters (
         id, tenant_id, company_id, employee_id, user_id, name, email
       ) values ($1, $2, $3, $4, $5, 'Viajante E2E', $6)`,
      [
        `requester-${randomUUID()}`,
        fixture.tenantId,
        fixture.companyAllowed,
        fixture.employeeAllowed,
        fixture.userId,
        fixture.email,
      ],
    )
    await client.query(
      `insert into demands (
         id, tenant_id, company_id, employee_id, demand_number, service_type,
         passenger_name_snapshot, status, lifecycle_status, travel_start_date,
         travel_end_date, destination
       ) values
         ($1, $3, $4, $5, 'OS-E2E-ALLOWED', 'air', 'VIAJANTE E2E', 'emitido', 'issued', $6, $7, $8),
         ($2, $3, $9, $10, 'OS-E2E-DENIED', 'hotel', 'VIAJANTE RESTRITO', 'emitido', 'issued', $6, $7, $11)`,
      [
        fixture.demandAllowed,
        fixture.demandDenied,
        fixture.tenantId,
        fixture.companyAllowed,
        fixture.employeeAllowed,
        startDate,
        endDate,
        fixture.destination,
        fixture.companyDenied,
        fixture.employeeDenied,
        fixture.deniedDestination,
      ],
    )
    await client.query(
      `insert into reservations (
         id, tenant_id, demand_id, company_id, employee_id, provider,
         provider_reference, status, service_type, passenger_name_snapshot,
         start_at, end_at, metadata
       ) values (
         $1, $2, $3, $4, $5, 'Companhia E2E', 'E2E123', 'confirmed',
         'air', 'VIAJANTE E2E', $6::date + time '10:00',
         $6::date + time '12:00', $7::jsonb
       )`,
      [
        fixture.reservationAllowed,
        fixture.tenantId,
        fixture.demandAllowed,
        fixture.companyAllowed,
        fixture.employeeAllowed,
        startDate,
        JSON.stringify({ origin: 'GYN', destination: 'GRU', flightNumber: 'BBT100' }),
      ],
    )
    await client.query(
      `insert into vouchers (
         id, tenant_id, reservation_id, demand_id, company_id, employee_id,
         voucher_code, status, issued_at
       ) values
         ($1, $3, $4, $5, $6, $7, $8, 'issued', now()),
         ($2, $3, null, $9, $10, $11, 'V-E2E-DENIED', 'issued', now())`,
      [
        fixture.voucherAllowed,
        fixture.voucherDenied,
        fixture.tenantId,
        fixture.reservationAllowed,
        fixture.demandAllowed,
        fixture.companyAllowed,
        fixture.employeeAllowed,
        fixture.voucherCode,
        fixture.demandDenied,
        fixture.companyDenied,
        fixture.employeeDenied,
      ],
    )
  })
}

async function cleanupTraveler(pool: Pool, fixture: TravelerFixture): Promise<void> {
  await tenantTransaction(pool, fixture.tenantId, async (client) => {
    await client.query(`select set_config('app.tenant_reset', 'on', true)`)
    await client.query('delete from audit_logs where tenant_id = $1', [fixture.tenantId])
    await client.query('delete from tenant_subscriptions where tenant_id = $1', [fixture.tenantId])
    await client.query('delete from tenants where id = $1', [fixture.tenantId])
  })
  await pool.query('delete from users where id = $1', [fixture.userId])
  await pool.query('delete from plans where id = $1', [fixture.planId])
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
