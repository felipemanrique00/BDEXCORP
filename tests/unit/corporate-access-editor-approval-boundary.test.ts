import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const editor = readFileSync(
  resolve(process.cwd(), 'components/users/corporate-access-editor.tsx'),
  'utf8',
)

describe('generic corporate access editor approval boundary', () => {
  it('does not offer the employee-managed authorizer profile or decision permission', () => {
    expect(editor).toContain("CORPORATE_PROFILES.filter((profile) => profile !== 'approver')")
    expect(editor).toContain("(permission) => permission !== 'decidir_aprovacoes'")
    expect(editor).toContain('GENERIC_CORPORATE_PROFILES.map')
    expect(editor).toContain('GENERIC_CORPORATE_PERMISSION_KEYS.map')
    expect(editor).not.toContain('{CORPORATE_PROFILES.map((profile)')
    expect(editor).not.toContain('{CORPORATE_PERMISSION_KEYS.map((permission)')
  })

  it('writes an explicit deny when a generic profile or scope is newly selected', () => {
    expect(editor).toContain('decidir_aprovacoes: false')
    expect(editor).toContain("return profile === 'approver' ? 'viewer' : profile")
    expect(editor).toContain('permissionOverrides: currentPermissionOverrides(value, profile)')
    expect(editor).toContain("if (profile === 'approver' || profile === value.profile) return")
    expect(editor).toContain('commit(setCorporateDraftCustomization(value, event.target.checked))')
    expect(editor).toContain('commit(next)')
  })

  it('preserves existing employee-managed authorizer grants on unrelated edits', () => {
    expect(editor.match(/grant\.profile === 'approver'\s*\? grant/g)).toHaveLength(2)
    expect(editor).toContain('enforceGenericApprovalBoundary(next)')
    expect(editor).toContain('Um vínculo de autorizador já ativo é preservado')
  })

  it('directs approval lifecycle changes to the company employee screen', () => {
    expect(editor).toContain('Empresa &gt; Pessoas e acessos &gt; Autorizadores')
    expect(editor).toContain('Para conceder ou remover a função de autorizador')
  })
})
