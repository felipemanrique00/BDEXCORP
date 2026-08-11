import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const dashboardShell = readFileSync(
  resolve(process.cwd(), 'components/dashboard-shell.tsx'),
  'utf8',
)

describe('dashboard hydration shell', () => {
  it('nao libera o conteudo da rota quando a hidratacao falha', () => {
    expect(dashboardShell).toContain('if (applicationHydrated) {')
    expect(dashboardShell).toContain('setHydratedPath(pathname)')
    expect(dashboardShell).toContain('setHydrationFailedPath(pathname)')
    expect(dashboardShell).toMatch(
      /\{hydratedPath === pathname\s+\? children\s+: hydrationFailedPath === pathname\s+\? <RouteHydrationError/,
    )
  })

  it('oferece nova tentativa sem confundir falha com ausencia de empresas', () => {
    expect(dashboardShell).toContain('onRetry={() => setHydrationAttempt((value) => value + 1)}')
    expect(dashboardShell).toContain('Seus acessos não foram alterados.')
    expect(dashboardShell).toContain('Tentar novamente')
  })
})
