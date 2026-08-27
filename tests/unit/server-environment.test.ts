import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('server environment', () => {
  beforeEach(() => {
    vi.resetModules()
    configureRequiredProductionEnvironment()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('aceita campos vazios de integracoes desabilitadas', async () => {
    vi.stubEnv('SMTP_ENABLED', 'false')
    vi.stubEnv('SMTP_FROM', '')
    vi.stubEnv('WHATSAPP_ENABLED', 'false')
    vi.stubEnv('WHATSAPP_API_BASE_URL', '')
    vi.stubEnv('WHATSAPP_INSTANCE_ID', '')
    vi.stubEnv('TECH_API_ENABLED', 'false')
    vi.stubEnv('TECH_API_BASE_URL', '')
    vi.stubEnv('TECH_REPORTS_ENABLED', 'false')
    vi.stubEnv('TECH_REPORTS_BASE_URL', '')
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'false')
    vi.stubEnv('WINTOUR_TENANT_ID', '')
    vi.stubEnv('WINTOUR_AUTO_SEND', 'false')
    vi.stubEnv('WINTOUR_PROTOCOL_POLL_ENABLED', 'false')
    vi.stubEnv('WINTOUR_PIN', '')

    const { getServerEnvironment } = await import('@/lib/server/environment')
    const environment = getServerEnvironment()

    expect(environment.SMTP_FROM).toBeUndefined()
    expect(environment.WHATSAPP_API_BASE_URL).toBeUndefined()
    expect(environment.TECH_API_BASE_URL).toBeUndefined()
    expect(environment.TECH_REPORTS_BASE_URL).toBeUndefined()
    expect(environment.WINTOUR_PIN).toBeUndefined()
    expect(environment.WINTOUR_TENANT_ID).toBeUndefined()
    expect(environment.WINTOUR_SYNC_ENABLED).toBe(false)
  })

  it('bloqueia Wintour habilitado sem PIN', async () => {
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'true')
    vi.stubEnv('WINTOUR_TENANT_ID', '11111111-1111-4111-8111-111111111111')
    vi.stubEnv('WINTOUR_PIN', '')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /WINTOUR_PIN e obrigatorio quando WINTOUR_SYNC_ENABLED=true/,
    )
  })

  it('bloqueia Wintour habilitado sem vincular o PIN a um tenant', async () => {
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'true')
    vi.stubEnv('WINTOUR_TENANT_ID', '')
    vi.stubEnv('WINTOUR_PIN', 'pin-de-homologacao')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /WINTOUR_TENANT_ID e obrigatorio quando WINTOUR_SYNC_ENABLED=true/,
    )
  })

  it('bloqueia envio ou consulta automatica sem habilitar o conector', async () => {
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'false')
    vi.stubEnv('WINTOUR_AUTO_SEND', 'true')
    vi.stubEnv('WINTOUR_PROTOCOL_POLL_ENABLED', 'true')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /WINTOUR_SYNC_ENABLED deve estar habilitado/,
    )
  })

  it('aceita Wintour explicitamente habilitado com PIN server-side', async () => {
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'true')
    vi.stubEnv('WINTOUR_TENANT_ID', '11111111-1111-4111-8111-111111111111')
    vi.stubEnv('WINTOUR_AUTO_SEND', 'false')
    vi.stubEnv('WINTOUR_PROTOCOL_POLL_ENABLED', 'false')
    vi.stubEnv('WINTOUR_PIN', 'pin-de-homologacao')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    const environment = getServerEnvironment()
    expect(environment.WINTOUR_SYNC_ENABLED).toBe(true)
    expect(environment.WINTOUR_TENANT_ID).toBe('11111111-1111-4111-8111-111111111111')
    expect(environment.WINTOUR_PIN).toBe('pin-de-homologacao')
  })

  it('alinha o PIN Wintour ao envelope SOAP e rejeita formato incompativel', async () => {
    vi.stubEnv('WINTOUR_SYNC_ENABLED', 'true')
    vi.stubEnv('WINTOUR_TENANT_ID', '11111111-1111-4111-8111-111111111111')
    vi.stubEnv('WINTOUR_PIN', `pin-${'x'.repeat(125)}`)

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(/WINTOUR_PIN/)
  })

  it('continua bloqueando SMTP habilitado sem configuracao completa', async () => {
    vi.stubEnv('SMTP_ENABLED', 'true')
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASSWORD', '')
    vi.stubEnv('SMTP_FROM', '')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /SMTP_HOST e obrigatorio quando SMTP_ENABLED=true/,
    )
  })

  it('mantem o bypass de MFA desabilitado por padrao', async () => {
    vi.stubEnv('MFA_LOCAL_BYPASS', 'false')

    const { getServerEnvironment, isLocalMfaBypassEnabled } = await import('@/lib/server/environment')

    expect(getServerEnvironment().MFA_LOCAL_BYPASS).toBe(false)
    expect(isLocalMfaBypassEnabled()).toBe(false)
  })

  it('permite o bypass explicito somente no runtime HTTP de loopback', async () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3010')
    vi.stubEnv('ALLOW_INSECURE_LOCALHOST', 'true')
    vi.stubEnv('MFA_LOCAL_BYPASS', 'true')

    const { isLocalMfaBypassEnabled } = await import('@/lib/server/environment')

    expect(isLocalMfaBypassEnabled()).toBe(true)
  })

  it('bloqueia o bypass em URL publica mesmo fora de NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_URL', 'https://staging.bdextravel.com.br')
    vi.stubEnv('ALLOW_INSECURE_LOCALHOST', 'true')
    vi.stubEnv('MFA_LOCAL_BYPASS', 'true')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /MFA_LOCAL_BYPASS bloqueado: .*APP_URL deve usar HTTP e apontar estritamente para localhost ou loopback/,
    )
  })

  it('bloqueia o bypass local sem a segunda confirmacao de ambiente inseguro', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_URL', 'http://localhost:3010')
    vi.stubEnv('ALLOW_INSECURE_LOCALHOST', 'false')
    vi.stubEnv('MFA_LOCAL_BYPASS', 'true')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /ALLOW_INSECURE_LOCALHOST deve estar explicitamente habilitado/,
    )
  })

  it('nao aceita desabilitar a politica administrativa junto com o bypass local', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3010')
    vi.stubEnv('ALLOW_INSECURE_LOCALHOST', 'true')
    vi.stubEnv('MFA_ADMIN_REQUIRED', 'false')
    vi.stubEnv('MFA_LOCAL_BYPASS', 'true')

    const { getServerEnvironment } = await import('@/lib/server/environment')

    expect(() => getServerEnvironment()).toThrow(
      /MFA_ADMIN_REQUIRED deve permanecer habilitado/,
    )
  })
})

function configureRequiredProductionEnvironment(): void {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('APP_URL', 'https://staging.bdextravel.com.br')
  vi.stubEnv('APP_VERSION', 'test-staging')
  vi.stubEnv('DATABASE_URL', 'postgresql://app:password@postgres:5432/bdex_test')
  vi.stubEnv('AUTH_SECRET', 'a'.repeat(48))
  vi.stubEnv('MFA_ADMIN_REQUIRED', 'true')
  vi.stubEnv('MFA_LOCAL_BYPASS', 'false')
  vi.stubEnv('MFA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
}
