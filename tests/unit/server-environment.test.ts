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

    const { getServerEnvironment } = await import('@/lib/server/environment')
    const environment = getServerEnvironment()

    expect(environment.SMTP_FROM).toBeUndefined()
    expect(environment.WHATSAPP_API_BASE_URL).toBeUndefined()
    expect(environment.TECH_API_BASE_URL).toBeUndefined()
    expect(environment.TECH_REPORTS_BASE_URL).toBeUndefined()
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
})

function configureRequiredProductionEnvironment(): void {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('APP_URL', 'https://staging.bdextravel.com.br')
  vi.stubEnv('APP_VERSION', 'test-staging')
  vi.stubEnv('DATABASE_URL', 'postgresql://app:password@postgres:5432/bdex_test')
  vi.stubEnv('AUTH_SECRET', 'a'.repeat(48))
  vi.stubEnv('MFA_ADMIN_REQUIRED', 'true')
  vi.stubEnv('MFA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
}
