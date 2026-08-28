import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const provider = readFileSync(
  resolve(process.cwd(), 'components/corporate-context-provider.tsx'),
  'utf8',
)
const dashboardShell = readFileSync(
  resolve(process.cwd(), 'components/dashboard-shell.tsx'),
  'utf8',
)

describe('corporate arbitrary selection route gate', () => {
  it('keeps arbitrary selection opt-in and restricted to internal identities', () => {
    expect(provider).toContain(
      'allowArbitrarySelection: allowArbitrarySelectionRequested = false',
    )
    expect(provider).toContain('const allowArbitrarySelection = allowArbitrarySelectionRequested')
    expect(provider).toContain("&& userAccessKind(user) === 'internal'")
  })

  it('enables global selection only on the exact main portal route and resets across routes', () => {
    expect(dashboardShell).toContain(
      "const portalGlobalSelectionEnabled = pathname === '/dashboard/portal-empresa'",
    )
    expect(dashboardShell).toContain("&& userAccessKind(sessionUser) === 'internal'")
    expect(dashboardShell).toContain('&& !representation')
    expect(dashboardShell).toContain('&& !loadingRepresentation')
    expect(dashboardShell).toContain(
      "key={portalGlobalSelectionEnabled ? 'portal-global' : 'standard'}",
    )
    expect(dashboardShell).toContain(
      'allowArbitrarySelection={portalGlobalSelectionEnabled}',
    )
    expect(dashboardShell).not.toContain("pathname.startsWith('/dashboard/portal-empresa/')")
    expect(dashboardShell).not.toContain('allowArbitrarySelection={true}')
  })
})
