const raw = String(process.env.TEST_DATABASE_URL || '').trim()
if (!raw) fail('TEST_DATABASE_URL e obrigatoria para testes com PostgreSQL.')

let parsed
try {
  parsed = new URL(raw)
} catch {
  fail('TEST_DATABASE_URL deve ser uma URL PostgreSQL valida.')
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  fail('TEST_DATABASE_URL deve usar o protocolo PostgreSQL.')
}

const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
if (!databaseName) fail('TEST_DATABASE_URL deve informar um banco descartavel.')
if (/(?:^|[_-])(prod|production)(?:$|[_-])/i.test(databaseName)) {
  fail('TEST_DATABASE_URL aponta para um banco com identificador de producao.')
}
if (
  !/(?:^|[_-])(test|testing|e2e|ci|sandbox|gap|closure|tmp)(?:$|[_-])/i.test(databaseName) &&
  process.env.TEST_DATABASE_CONFIRM_DISPOSABLE !== 'YES'
) {
  fail(
    'O nome em TEST_DATABASE_URL nao identifica um banco descartavel. ' +
    'Use test/e2e/ci/sandbox ou confirme com TEST_DATABASE_CONFIRM_DISPOSABLE=YES.',
  )
}

console.log(`Banco de teste descartavel confirmado: ${parsed.hostname}/${databaseName}`)

function fail(message) {
  console.error(message)
  process.exit(1)
}
