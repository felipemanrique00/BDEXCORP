import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('explicit local MFA bypass contract', () => {
  it('short-circuits MFA challenges and preserves password sessions only through the guarded policy', () => {
    const mfaService = read('lib/server/mfa-service.ts')
    const authService = read('lib/server/auth-service.ts')

    expect(mfaService).toContain("bypassed: 'explicit_local'")
    expect(mfaService).toContain('if (isLocalMfaBypassEnabled())')
    expect(authService).toContain('!isLocalMfaBypassEnabled()')
  })

  it('records the bypass in the login audit without weakening MFA verification', () => {
    const loginRoute = read('app/api/auth/login/route.ts')
    const verifyRoute = read('app/api/auth/mfa/verify/route.ts')

    expect(loginRoute).toContain('mfaBypass: mfa.required === false')
    expect(loginRoute).toContain("'explicit_local_loopback'")
    expect(verifyRoute).toContain('verifyMfaChallenge(body.challengeToken, body.code, metadata)')
    expect(verifyRoute).not.toContain('MFA_LOCAL_BYPASS')
    expect(verifyRoute).not.toContain('isLocalMfaBypassEnabled')
  })

  it('activates the flag only through the local Windows runner', () => {
    const localRunner = read('deploy/windows/local/run-local.ps1')
    const stagingCompose = read('docker-compose.staging.yml')
    const productionCompose = read('docker-compose.production.yml')

    expect(localRunner).toContain("$env:MFA_LOCAL_BYPASS = 'true'")
    expect(stagingCompose).not.toContain('MFA_LOCAL_BYPASS')
    expect(productionCompose).not.toContain('MFA_LOCAL_BYPASS')
    expect(stagingCompose).toContain('MFA_ADMIN_REQUIRED: "true"')
    expect(productionCompose).toContain('MFA_ADMIN_REQUIRED: ${MFA_ADMIN_REQUIRED:-true}')
  })
})

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}
