const DISPOSABLE_DATABASE_PATTERN = /(?:^|[_-])(test|testing|e2e|ci|sandbox|gap|closure|tmp)(?:$|[_-])/i
const PRODUCTION_DATABASE_PATTERN = /(?:^|[_-])(prod|production)(?:$|[_-])/i

export function testDatabaseUrl(): string | undefined {
  const raw = String(process.env.TEST_DATABASE_URL || '').trim()
  if (!raw) return undefined

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('TEST_DATABASE_URL deve ser uma URL PostgreSQL valida.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL deve usar o protocolo PostgreSQL.')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!databaseName) {
    throw new Error('TEST_DATABASE_URL deve informar um banco descartavel.')
  }
  if (PRODUCTION_DATABASE_PATTERN.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL aponta para um banco com identificador de producao.')
  }
  if (
    !DISPOSABLE_DATABASE_PATTERN.test(databaseName) &&
    process.env.TEST_DATABASE_CONFIRM_DISPOSABLE !== 'YES'
  ) {
    throw new Error(
      'O nome em TEST_DATABASE_URL nao identifica um banco descartavel. ' +
      'Use um nome com test/e2e/ci/sandbox ou confirme com TEST_DATABASE_CONFIRM_DISPOSABLE=YES.',
    )
  }

  return raw
}
