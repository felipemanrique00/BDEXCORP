import { expect, test } from '@playwright/test'

import { authenticateAdministrativeTestUser } from '../support/authenticate-admin'

const applicationUrl = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

test.describe.configure({ mode: 'serial' })

test('rota protegida redireciona para login', async ({ page }) => {
  const cspViolations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      cspViolations.push(message.text())
    }
  })

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Acesso ao sistema' })).toBeVisible()
  expect(cspViolations).toEqual([])
})

test('credencial invalida nao cria sessao', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(process.env.E2E_ADMIN_EMAIL || 'admin-e2e@invalid.test')
  await page.getByLabel('Senha', { exact: true }).fill('SenhaIncorreta!2026')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('E-mail, senha ou ambiente incorretos.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('administrador configura MFA antes de receber a sessao', async ({ page }) => {
  const challengeToken = '00000000-0000-4000-8000-000000000001.challenge-for-e2e'
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: null, requireSession: true }),
    })
  })
  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'MFA_ENROLLMENT_REQUIRED',
        challengeToken,
        challengeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    })
  })
  await page.route('**/api/auth/mfa/enroll', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        provisioningUri: 'otpauth://totp/BBT%20Corporativo:admin@test.invalid?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    })
  })
  await page.route('**/api/auth/mfa/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: 'user-e2e',
          email: 'admin@test.invalid',
          name: 'Admin Teste',
          role: 'master',
          company_id: null,
          permissoes: {},
          ativo: true,
        },
        recoveryCodes: [
          'ABCD-EFGH-JKLM-NPQR',
          'BCDE-FGHJ-KLMN-PQRS',
          'CDEF-GHJK-LMNP-QRST',
          'DEFG-HJKL-MNPQ-RSTU',
          'EFGH-JKLM-NPQR-STUV',
          'FGHJ-KLMN-PQRS-TUVW',
        ],
      }),
    })
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill('admin@test.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('Password#Test2026')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Proteja sua conta')).toBeVisible()
  await expect(page.locator('svg').filter({ has: page.locator('title') })).toBeVisible()
  await page.getByLabel('Código de 6 dígitos').fill('123456')
  await page.getByRole('button', { name: 'Ativar e entrar' }).click()
  await expect(page.getByText('Autenticador ativado')).toBeVisible()
  await expect(page.getByText('ABCD-EFGH-JKLM-NPQR')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmo que guardei os códigos' })).toBeVisible()
})

test('administrador autenticado acessa a administracao SaaS', async ({ page }, testInfo) => {
  const email = process.env.E2E_ADMIN_EMAIL
  const password = process.env.E2E_ADMIN_PASSWORD
  test.skip(!email || !password, 'Credenciais E2E nao configuradas.')
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Fluxo administrativo validado no projeto desktop.')

  await authenticateAdministrativeTestUser(page.request, {
    email: email!,
    password: password!,
    baseUrl: applicationUrl,
  })
  await page.goto('/dashboard/plataforma')
  await expect(page.getByRole('heading', { name: 'Administração SaaS' })).toBeVisible()
})

test('administrador persiste relatorio e armazena arquivo privado no tenant', async ({ page }, testInfo) => {
  const email = process.env.E2E_ADMIN_EMAIL
  const password = process.env.E2E_ADMIN_PASSWORD
  test.skip(!email || !password, 'Credenciais E2E nao configuradas.')
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Fluxo administrativo validado no projeto desktop.')

  await authenticateAdministrativeTestUser(page.request, {
    email: email!,
    password: password!,
    baseUrl: applicationUrl,
  })
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  const periodLabel = `E2E ${Date.now()}`
  const snapshotWrite = await page.evaluate(async (periodo) => {
    const response = await fetch('/api/report-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodo,
        totalSpend: 1250.50,
        total_demandas: 3,
        por_tipo: { aereo: 900, hotelaria: 350.50 },
        policyRate: 100,
        co2: 42,
      }),
    })
    return { status: response.status, body: await response.json() }
  }, periodLabel)
  expect(snapshotWrite.status).toBe(201)
  expect(snapshotWrite.body.ok).toBe(true)
  const snapshotId = snapshotWrite.body.snapshot.id as string

  const stored = await page.evaluate(async () => {
    const response = await fetch('/api/report-snapshots', { cache: 'no-store' })
    return { status: response.status, body: await response.json() }
  })
  expect(stored.status).toBe(200)
  expect(stored.body.snapshots).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: snapshotId, periodo: periodLabel })]),
  )

  const entityId = `e2e-import-${Date.now()}`
  const upload = await page.evaluate(async (id) => {
    const form = new FormData()
    form.set('entityType', 'import')
    form.set('entityId', id)
    form.set('description', 'Evidencia automatizada de armazenamento')
    form.set('file', new File(['%PDF-1.4\n%%EOF\n'], 'evidencia-e2e.pdf', { type: 'application/pdf' }))
    const response = await fetch('/api/files', { method: 'POST', body: form })
    return { status: response.status, body: await response.json() }
  }, entityId)
  expect(upload.status).toBe(201)
  expect(upload.body.ok).toBe(true)

  const download = await page.evaluate(async (url) => {
    const response = await fetch(url, { cache: 'no-store' })
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      content: new TextDecoder().decode(await response.arrayBuffer()),
    }
  }, upload.body.file.downloadUrl as string)
  expect(download.status).toBe(200)
  expect(download.type).toContain('application/pdf')
  expect(download.content).toContain('%PDF-1.4')

  const fileDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/files/${id}`, { method: 'DELETE' })
    return { status: response.status, body: await response.json() }
  }, upload.body.file.id as string)
  expect(fileDelete).toEqual({ status: 200, body: { ok: true } })

  const snapshotDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/report-snapshots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return response.status
  }, snapshotId)
  expect(snapshotDelete).toBe(200)
})
