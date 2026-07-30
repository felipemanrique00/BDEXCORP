import { afterEach, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL
const originalDisposableConfirmation = process.env.TEST_DATABASE_CONFIRM_DISPOSABLE
const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(() => {
  restoreEnvironment('TEST_DATABASE_URL', originalTestDatabaseUrl)
  restoreEnvironment('TEST_DATABASE_CONFIRM_DISPOSABLE', originalDisposableConfirmation)
  restoreEnvironment('DATABASE_URL', originalDatabaseUrl)
})

describe('test database guard', () => {
  it('never falls back to DATABASE_URL', () => {
    delete process.env.TEST_DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://user:pass@database/production'

    expect(testDatabaseUrl()).toBeUndefined()
  })

  it('accepts an explicitly disposable database name', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/bdex_integration_test'

    expect(testDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL)
  })

  it('rejects production identifiers even with an explicit test variable', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:pass@database/bdex_production'

    expect(() => testDatabaseUrl()).toThrow(/identificador de producao/)
  })

  it('requires explicit confirmation for a nonstandard database name', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/bdex_validation'

    expect(() => testDatabaseUrl()).toThrow(/nao identifica um banco descartavel/)

    process.env.TEST_DATABASE_CONFIRM_DISPOSABLE = 'YES'
    expect(testDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL)
  })
})

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
