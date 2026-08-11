import { describe, expect, it } from 'vitest'

import {
  corporateBrandingPatchSchema,
  effectiveBrandingQuerySchema,
  emptyCorporateBrandingDeclared,
  mergeCorporateBrandingDeclared,
  resolveEffectiveCorporateBranding,
} from '@/lib/corporate-branding'

describe('corporate branding inheritance', () => {
  it('resolves every company field through company, group and system sources', () => {
    const group = mergeCorporateBrandingDeclared(emptyCorporateBrandingDeclared(), {
      displayName: 'Marca do Grupo',
      logoFileId: '11111111-1111-4111-8111-111111111111',
      primaryColor: '#112233',
      accentColor: '#445566',
      documentLegalName: 'Grupo Exemplo S.A.',
    })
    const company = mergeCorporateBrandingDeclared(emptyCorporateBrandingDeclared(), {
      accentColor: '#AABBCC',
      sidebarColor: '#010203',
    })

    const effective = resolveEffectiveCorporateBranding({
      scopeType: 'company',
      scopeId: 'company-a',
      groupId: 'group-a',
      company,
      group,
      entity: {
        displayName: 'Empresa Exemplo',
        legalName: 'Empresa Exemplo Ltda.',
        documentNumber: '12.345.678/0001-90',
      },
      version: 7,
      updatedAt: '2026-08-10T12:00:00.000Z',
    })

    expect(effective).toMatchObject({
      scopeType: 'company',
      scopeId: 'company-a',
      groupId: 'group-a',
      displayName: 'Marca do Grupo',
      primaryColor: '#112233',
      accentColor: '#AABBCC',
      sidebarColor: '#010203',
      documentLegalName: 'Grupo Exemplo S.A.',
      documentNumber: '12.345.678/0001-90',
      source: 'company',
      version: 7,
    })
    expect(effective.logoUrl).toContain('/api/me/branding-logo/11111111-1111-4111-8111-111111111111?')
    expect(effective.sources).toMatchObject({
      displayName: 'group',
      logoUrl: 'group',
      primaryColor: 'group',
      accentColor: 'company',
      sidebarColor: 'company',
      documentNumber: 'company',
    })
  })

  it('uses entity identification and BBT visual defaults when no setting exists', () => {
    const effective = resolveEffectiveCorporateBranding({
      scopeType: 'group',
      scopeId: 'group-empty',
      groupId: 'group-empty',
      group: emptyCorporateBrandingDeclared(),
      entity: {
        displayName: 'Grupo Sem Marca',
        legalName: 'Grupo Sem Marca',
        documentNumber: null,
      },
    })
    expect(effective.displayName).toBe('Grupo Sem Marca')
    expect(effective.logoUrl).toContain('/brand/')
    expect(effective.primaryColor).toBe('#20265A')
    expect(effective.sources.displayName).toBe('group')
    expect(effective.sources.logoUrl).toBe('system')
  })

  it('treats null as inheritance and validates safe patch/query payloads', () => {
    const current = mergeCorporateBrandingDeclared(emptyCorporateBrandingDeclared(), {
      primaryColor: '#abcdef',
    })
    expect(current.primaryColor).toBe('#ABCDEF')
    expect(mergeCorporateBrandingDeclared(current, { primaryColor: null }).primaryColor).toBeNull()
    expect(corporateBrandingPatchSchema.parse({ values: { displayName: '  Cliente  ' } }))
      .toMatchObject({ values: { displayName: 'Cliente' } })
    expect(effectiveBrandingQuerySchema.parse({ contextType: 'company', contextId: 'company-a' }))
      .toEqual({ contextType: 'company', contextId: 'company-a' })
    expect(() => corporateBrandingPatchSchema.parse({ values: {} })).toThrow()
  })
})
