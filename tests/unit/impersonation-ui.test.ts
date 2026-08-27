import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseImpersonationSessionPayload } from '@/lib/impersonation-client'

const sourcePaths = [
  'lib/impersonation-client.ts',
  'components/impersonation/impersonation-provider.tsx',
  'components/impersonation/impersonation-dialog.tsx',
  'components/impersonation/impersonation-banner.tsx',
]
const mojibakeMarker = String.fromCodePoint(0x00c3)

describe('impersonation UI contract', () => {
  it('parses the actor and represented subject from the authenticated session', () => {
    const state = parseImpersonationSessionPayload({
      canStartRepresentation: false,
      actor: {
        membershipId: 'actor-membership',
        roleKey: 'agent',
        platformAdmin: false,
        user: { id: 'actor-user', name: 'Agente', email: 'agente@example.com' },
      },
      representation: {
        id: 'representation-id',
        mode: 'test',
        actor: { id: 'actor-user', name: 'Agente', email: 'agente@example.com', roleKey: 'agent' },
        subject: {
          id: 'subject-user',
          membershipId: 'subject-membership',
          name: 'Solicitante',
          email: 'solicitante@example.com',
          roleKey: 'requester',
        },
        reason: 'Atendimento solicitado pelo cliente',
        reference: null,
        allowedActions: [],
        companyIds: ['company-id'],
        startedAt: '2026-08-12T12:00:00.000Z',
        expiresAt: '2026-08-12T12:15:00.000Z',
      },
    })

    expect(state.actor?.user.id).toBe('actor-user')
    expect(state.representation?.subject.id).toBe('subject-user')
    expect(state.representation?.mode).toBe('test')
  })

  it('keeps access temporary, explicit and accessible in source wiring', () => {
    const dialog = read('components/impersonation/impersonation-dialog.tsx')
    const banner = read('components/impersonation/impersonation-banner.tsx')
    const provider = read('components/impersonation/impersonation-provider.tsx')
    const shell = read('components/dashboard-shell.tsx')
    const context = read('components/corporate-context-provider.tsx')
    const shellRefresh = read('components/dashboard-shell.tsx')

    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain('role="combobox"')
    expect(dialog).toContain('Duração fixa: 15 minutos')
    expect(dialog).toContain("mode === 'operate'")
    expect(dialog).toContain('disabled={!operateAvailable}')
    expect(dialog).toContain('selectedTarget.allowedActions')
    expect(banner).toContain('Encerrar acesso')
    expect(provider).toMatch(/const stopRepresentation[\s\S]*?await stopImpersonation[\s\S]*?resetEffectiveSession/)
    expect(provider).toMatch(/const expireRepresentationLocally[\s\S]*?stopImpersonation[\s\S]*?resetEffectiveSession/)
    expect(provider.match(/await prepareIdentityTransition\(\)/g)).toHaveLength(1)
    expect(shell).toContain('persistContextSelection={!loadingRepresentation && !representation}')
    expect(context).toContain('if (!persistContextSelection)')
    expect(context).not.toContain('localStorage')
    expect(context).not.toContain('safeSet')
    expect(shellRefresh).toContain('decideSessionUserRefresh(sessionUserRef.current, session, representation)')
  })

  it('does not introduce UTF-8 mojibake in the new files', () => {
    for (const path of sourcePaths) {
      expect(read(path), path).not.toContain(mojibakeMarker)
    }
  })
})

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
