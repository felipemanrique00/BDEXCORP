const baseUrl = String(
  process.env.SECURITY_SMOKE_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.APP_URL ||
  '',
).replace(/\/$/, '')

if (!baseUrl) {
  console.error('Defina SECURITY_SMOKE_BASE_URL, SMOKE_BASE_URL ou APP_URL.')
  process.exit(1)
}

const origin = new URL(baseUrl).origin

async function request(path, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'bbt-security-smoke',
        ...init.headers,
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertStatus(response, expected, name) {
  assert(
    expected.includes(response.status),
    `${name}: HTTP ${response.status}; esperado ${expected.join(' ou ')}`,
  )
}

const loginPage = await request('/login')
assertStatus(loginPage, [200], 'pagina de login')
const contentSecurityPolicy = loginPage.headers.get('content-security-policy') || ''
assert(contentSecurityPolicy.includes("default-src 'self'"), 'CSP sem default-src seguro')
assert(contentSecurityPolicy.includes("object-src 'none'"), 'CSP permite objetos')
assert(loginPage.headers.get('x-content-type-options') === 'nosniff', 'nosniff ausente')
assert(loginPage.headers.get('x-frame-options') === 'SAMEORIGIN', 'anti-clickjacking ausente')
assert(Boolean(loginPage.headers.get('permissions-policy')), 'Permissions-Policy ausente')
assert(!loginPage.headers.has('x-powered-by'), 'cabecalho X-Powered-By exposto')
console.log('OK cabecalhos de seguranca')

const anonymousSession = await request('/api/auth/session')
assertStatus(anonymousSession, [200], 'consulta de sessao anonima')
const anonymousSessionBody = await anonymousSession.json()
assert(anonymousSessionBody?.ok === false, 'consulta anonima informou sessao ativa')
assert(anonymousSessionBody?.user === null, 'consulta anonima expos usuario')
assert(anonymousSessionBody?.tenant === null, 'consulta anonima expos tenant')
console.log('OK consulta anonima sem identidade')

for (const path of [
  '/api/users',
  '/api/finance/corporate',
  '/api/users/00000000-0000-4000-8000-000000000000/access',
]) {
  const response = await request(path)
  assertStatus(response, [401], `acesso anonimo ${path}`)
}
console.log('OK negacao anonima em APIs protegidas')

const storageMutation = await request('/api/storage', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    Referer: `${origin}/login`,
  },
  body: JSON.stringify({
    entries: {
      'bbt-usuarios': [{ id: 'security-smoke-must-not-persist' }],
    },
  }),
})
assertStatus(storageMutation, [401], 'mutacao anonima no storage legado')
console.log('OK storage legado nega mutacao anonima')

const invalidLogin = await request('/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    Referer: `${origin}/login`,
  },
  body: JSON.stringify({
    email: 'security-smoke-invalid@invalid.test',
    password: 'Security-Smoke-Invalid-Password!2026',
  }),
})
assertStatus(invalidLogin, [401], 'login invalido')
assert(!invalidLogin.headers.has('set-cookie'), 'login invalido criou cookie de sessao')
console.log('OK credencial invalida sem sessao')

const readiness = await request('/api/ready')
assertStatus(readiness, [200], 'readiness')
const readinessBody = await readiness.json()
assert(readinessBody?.ok === true, 'readiness sem ok=true')
assert(
  typeof readinessBody?.schemaVersion === 'string' && readinessBody.schemaVersion.length > 0,
  'readiness sem versao de schema',
)
console.log(`OK readiness no schema ${readinessBody.schemaVersion}`)
