import { expect, test } from '@playwright/test'

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
  await page.getByLabel('Senha').fill('SenhaIncorreta!2026')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('E-mail, senha ou ambiente incorretos.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('administrador autenticado acessa a administracao SaaS', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL
  const password = process.env.E2E_ADMIN_PASSWORD
  test.skip(!email || !password, 'Credenciais E2E nao configuradas.')

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/dashboard/plataforma')
  await expect(page.getByRole('heading', { name: 'Administração SaaS' })).toBeVisible()
})

test('administrador persiste dados e armazena arquivo privado no tenant', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL
  const password = process.env.E2E_ADMIN_PASSWORD
  test.skip(!email || !password, 'Credenciais E2E nao configuradas.')

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  const storageKey = 'bbt-resumos-executivos-v12'
  const storageId = `e2e-${Date.now()}`
  const storageWrite = await page.evaluate(async ({ key, id }) => {
    const response = await fetch('/api/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: { [key]: [{ id, created_at: new Date().toISOString() }] } }),
    })
    return { status: response.status, body: await response.json() }
  }, { key: storageKey, id: storageId })
  expect(storageWrite.status).toBe(200)
  expect(storageWrite.body.ok).toBe(true)

  const stored = await page.evaluate(async (key) => {
    const response = await fetch(`/api/storage?keys=${encodeURIComponent(key)}`, { cache: 'no-store' })
    return { status: response.status, body: await response.json() }
  }, storageKey)
  expect(stored.status).toBe(200)
  expect(stored.body.entries[storageKey]).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: storageId })]),
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

  const storageDelete = await page.evaluate(async (key) => {
    const response = await fetch('/api/storage', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [key] }),
    })
    return response.status
  }, storageKey)
  expect(storageDelete).toBe(200)
})
