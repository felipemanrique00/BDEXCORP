const baseUrl = String(process.env.SMOKE_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '')
if (!baseUrl) {
  console.error('Defina SMOKE_BASE_URL ou APP_URL.')
  process.exit(1)
}

const checks = [
  { path: '/api/health', name: 'liveness', json: true },
  { path: '/api/ready', name: 'readiness', json: true },
  { path: '/login', name: 'login', json: false },
]

for (const check of checks) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'bbt-smoke-test' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (check.json) {
      const payload = await response.json()
      if (payload?.ok !== true) throw new Error('resposta sem ok=true')
    }
    console.log(`OK ${check.name}`)
  } catch (error) {
    console.error(`FALHA ${check.name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}
