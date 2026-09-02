import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listImpersonationTargets,
  parseImpersonationSessionPayload,
  startImpersonation,
  stepUpImpersonationMfa,
} from '@/lib/impersonation-client'

const sourcePaths = [
  'lib/impersonation-client.ts',
  'components/impersonation/impersonation-provider.tsx',
  'components/impersonation/impersonation-dialog.tsx',
  'components/impersonation/impersonation-banner.tsx',
]
const mojibakeMarker = String.fromCodePoint(0x00c3)

describe('impersonation UI contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses the actor and represented subject from the authenticated session', () => {
    const state = parseImpersonationSessionPayload({
      canStartRepresentation: false,
      impersonationMfaRequired: true,
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
    expect(state.impersonationMfaRequired).toBe(true)
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
    expect(dialog).toContain('Empresa do atendimento *')
    expect(dialog).toContain('selectedCompanyScope.allowedActions')
    expect(dialog).toContain('companyId: selectedCompanyScope.companyId')
    expect(dialog).toContain('Confirme o MFA para continuar')
    expect(dialog).toContain('onSubmit={mfaRequired ? submitMfa : submit}')
    expect(dialog).toContain('if (mfaRequired) mfaCodeRef.current?.focus()')
    expect(dialog).toMatch(/IMPERSONATION_MFA_REQUIRED'[\s\S]*?setSubmitError\(''\)[\s\S]*?onMfaRequired\(\)/)
    expect(banner).toContain('Encerrar acesso')
    expect(provider).toMatch(/const stopRepresentation[\s\S]*?await stopImpersonation[\s\S]*?resetEffectiveSession/)
    expect(provider).toMatch(/const expireRepresentationLocally[\s\S]*?stopImpersonation[\s\S]*?resetEffectiveSession/)
    expect(provider.match(/await prepareIdentityTransition\(\)/g)).toHaveLength(1)
    expect(provider).toContain('await stepUpImpersonationMfa(code)')
    expect(provider).toContain("error.code === 'IMPERSONATION_MFA_REQUIRED'")
    expect(shell).toContain('persistContextSelection={!loadingRepresentation && !representation}')
    expect(context).toContain('if (!persistContextSelection)')
    expect(context).not.toContain('localStorage')
    expect(context).not.toContain('safeSet')
    expect(shellRefresh).toContain('decideSessionUserRefresh(sessionUserRef.current, session, representation)')
  })

  it('confirms recent MFA in the current session before loading representation targets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      mfaVerifiedAt: '2026-09-02T13:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await stepUpImpersonationMfa('123456')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/mfa/step-up', expect.objectContaining({
      cache: 'no-store',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    }))
  })

  it('keeps each target action list isolated by company and accepts textual legacy company ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      total: 1,
      items: [{
        userId: 'subject-user',
        membershipId: 'subject-membership',
        name: 'Solicitante',
        email: 'solicitante@example.com',
        roleKey: 'requester',
        companyId: 'company-a',
        companyIds: ['company-a', 'company-b'],
        groupIds: [],
        companyScopes: [
          { companyId: 'company-a', label: 'Empresa A', allowedActions: ['demand.create'] },
          { companyId: 'company-b', label: 'Empresa B', allowedActions: [] },
        ],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const result = await listImpersonationTargets('Solicitante')

    expect(result.items[0].companyScopes).toEqual([
      { companyId: 'company-a', label: 'Empresa A', allowedActions: ['demand.create'] },
      { companyId: 'company-b', label: 'Empresa B', allowedActions: [] },
    ])
  })

  it('sends the selected non-UUID company id when starting the one-company session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      representation: {
        id: 'representation-id',
        mode: 'test',
        actor: { id: 'actor-user' },
        subject: { id: 'subject-user', membershipId: 'subject-membership' },
        reason: 'Atendimento solicitado pelo cliente',
        reference: null,
        allowedActions: [],
        companyIds: ['company-a'],
        startedAt: '2026-08-12T12:00:00.000Z',
        expiresAt: '2026-08-12T12:15:00.000Z',
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await startImpersonation({
      targetMembershipId: 'subject-membership',
      companyId: 'company-a',
      mode: 'test',
      reason: 'Atendimento solicitado pelo cliente',
    })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({ companyId: 'company-a' })
  })

  it('uses the textual company schema at the route boundary and leaves tenant validation to the service', () => {
    const route = read('app/api/auth/impersonation/start/route.ts')
    expect(route).toContain('companyId: z.string().trim().min(1).max(200)')
    expect(route).not.toContain('companyId: z.string().uuid()')
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
