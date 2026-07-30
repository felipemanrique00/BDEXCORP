import { writeFile } from 'node:fs/promises'

const baseUrl = String(process.env.LOAD_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '')
const totalRequests = positiveInteger(process.env.LOAD_REQUESTS, 40, 1, 1_000)
const concurrency = positiveInteger(process.env.LOAD_CONCURRENCY, 5, 1, 50)
const maxP95Ms = positiveInteger(process.env.LOAD_MAX_P95_MS, 2_500, 100, 120_000)
const email = String(process.env.LOAD_EMAIL || process.env.E2E_ADMIN_EMAIL || '').trim()
const password = String(process.env.LOAD_PASSWORD || process.env.E2E_ADMIN_PASSWORD || '')
const tenant = String(process.env.LOAD_TENANT || '').trim()
const targetPath = normalizeTargetPath(process.env.LOAD_TARGET_PATH || '/api/auth/session')

if (!baseUrl) fail('Defina LOAD_BASE_URL ou APP_URL.')
if (!email || !password) fail('Defina LOAD_EMAIL/LOAD_PASSWORD ou E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD.')

const origin = new URL(baseUrl).origin
const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    'User-Agent': 'bbt-load-baseline',
  },
  body: JSON.stringify({ email, password, ...(tenant ? { tenant } : {}) }),
})
if (!loginResponse.ok) fail(`Login do teste de carga falhou com HTTP ${loginResponse.status}.`)
const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0]
if (!cookie) fail('Login nao retornou cookie de sessao.')

const durations = []
const statuses = new Map()
let cursor = 0
const startedAt = performance.now()

await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, async () => {
  while (cursor < totalRequests) {
    cursor += 1
    const requestStartedAt = performance.now()
    let status = 0
    try {
      const response = await fetch(`${baseUrl}${targetPath}`, {
        headers: { Cookie: cookie, 'User-Agent': 'bbt-load-baseline' },
        cache: 'no-store',
      })
      status = response.status
      await response.arrayBuffer()
    } catch {
      status = 0
    }
    durations.push(performance.now() - requestStartedAt)
    statuses.set(status, (statuses.get(status) || 0) + 1)
  }
}))

const elapsedMs = performance.now() - startedAt
const ordered = durations.toSorted((left, right) => left - right)
const errors = Array.from(statuses.entries()).reduce(
  (sum, [status, count]) => sum + (status >= 200 && status < 400 ? 0 : count),
  0,
)
const report = {
  generatedAt: new Date().toISOString(),
  target: targetPath,
  requests: totalRequests,
  concurrency,
  elapsedMs: round(elapsedMs),
  throughputPerSecond: round(totalRequests / (elapsedMs / 1_000)),
  averageMs: round(ordered.reduce((sum, value) => sum + value, 0) / ordered.length),
  p95Ms: round(percentile(ordered, 0.95)),
  errorRate: round(errors / totalRequests),
  statuses: Object.fromEntries(Array.from(statuses.entries()).sort(([left], [right]) => left - right)),
}

console.log(JSON.stringify(report, null, 2))
if (process.env.LOAD_REPORT_PATH) {
  await writeFile(process.env.LOAD_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}
if (errors > 0) fail(`Teste de carga registrou ${errors} erro(s).`)
if (report.p95Ms > maxP95Ms) fail(`p95 de ${report.p95Ms}ms excedeu o limite de ${maxP95Ms}ms.`)

function percentile(values, ratio) {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)]
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value || fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`Valor inteiro fora do intervalo ${minimum}-${maximum}.`)
  }
  return parsed
}

function normalizeTargetPath(value) {
  const path = String(value || '').trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    fail('LOAD_TARGET_PATH deve ser um caminho local iniciado por /.')
  }
  return path
}

function round(value) {
  return Math.round(value * 100) / 100
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
