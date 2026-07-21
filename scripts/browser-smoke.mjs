import { chromium, devices } from '@playwright/test'

const targetUrl = process.argv[2]
if (!targetUrl) {
  console.error('Uso: node scripts/browser-smoke.mjs <url>')
  process.exit(2)
}

const channel = process.env.PLAYWRIGHT_CHANNEL || undefined
const screenshotPath = process.env.BROWSER_SMOKE_SCREENSHOT || undefined
const browser = await chromium.launch({ channel, headless: true })

try {
  const context = await browser.newContext({ ...devices['Desktop Chrome'] })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || 'Falha desconhecida',
    })
  })

  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(1_500)
  const bodyText = (await page.locator('body').innerText()).trim()
  const bodyHtmlLength = await page.locator('body').evaluate((element) => element.innerHTML.length)
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true })

  const result = {
    url: page.url(),
    status: response?.status() ?? null,
    title: await page.title(),
    bodyTextLength: bodyText.length,
    bodyHtmlLength,
    bodyPreview: bodyText.slice(0, 300),
    consoleErrors,
    pageErrors,
    failedRequests,
  }
  console.log(JSON.stringify(result, null, 2))

  if (!response?.ok() || bodyText.length === 0 || consoleErrors.length || pageErrors.length || failedRequests.length) {
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
