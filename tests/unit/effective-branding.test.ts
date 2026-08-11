import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EFFECTIVE_BRANDING,
  buildEffectiveBrandingUrl,
  effectiveBrandingCssVariables,
  normalizeBrandColor,
  normalizeBrandLogoUrl,
  parseEffectiveBrandingResponse,
  resolveEffectiveBrandingScope,
} from '@/lib/branding/effective-branding'

describe('effective corporate branding presentation', () => {
  it('resolves one company, an exact group and neutral arbitrary consolidation deterministically', () => {
    expect(resolveEffectiveBrandingScope({ context: null, selectedCompanyIds: ['company-a'] }))
      .toEqual({ type: 'company', id: 'company-a' })
    expect(resolveEffectiveBrandingScope({
      context: { type: 'group', id: 'group-a', companyIds: ['company-a', 'company-b'] },
      selectedCompanyIds: ['company-b', 'company-a'],
    })).toEqual({ type: 'group', id: 'group-a' })
    expect(resolveEffectiveBrandingScope({
      context: null,
      selectedCompanyIds: ['company-a', 'company-c'],
    })).toBeNull()
  })

  it('builds the approved context-aware endpoint URL', () => {
    expect(buildEffectiveBrandingUrl({ type: 'company', id: 'company a/1' }))
      .toBe('/api/me/effective-branding?contextType=company&contextId=company+a%2F1')
  })

  it('parses effective inherited fields and identifies a system logo separately from custom colors', () => {
    const branding = parseEffectiveBrandingResponse({ branding: {
      scopeType: 'company',
      scopeId: 'company-a',
      groupId: 'group-a',
      displayName: 'Empresa Exemplo',
      logoUrl: '/brand/bbt-corporativo-lockup-color.webp',
      logoAlt: 'Empresa Exemplo',
      primaryColor: '#123456',
      accentColor: '#ABCDEF',
      sidebarColor: '#102030',
      documentLegalName: 'Empresa Exemplo S.A.',
      documentNumber: '12.345.678/0001-90',
      source: 'company',
      sources: {
        displayName: 'company',
        logoUrl: 'system',
        logoAlt: 'company',
        primaryColor: 'company',
        accentColor: 'company',
        sidebarColor: 'company',
        documentLegalName: 'company',
        documentNumber: 'company',
      },
      version: 3,
      updatedAt: '2026-08-10T12:00:00.000Z',
    } }, { type: 'company', id: 'company-a' })

    expect(branding).toMatchObject({
      displayName: 'Empresa Exemplo',
      version: 3,
      documentLegalName: 'Empresa Exemplo S.A.',
      isLogoFallback: true,
      isFallback: false,
    })
  })

  it('treats a completely inherited system profile as the hydration-safe BBT fallback', () => {
    const branding = parseEffectiveBrandingResponse({ branding: {
      scopeType: 'group',
      scopeId: 'group-a',
      displayName: 'Grupo A',
      logoUrl: '/brand/bbt-corporativo-lockup-color.webp',
      primaryColor: '#20265A',
      accentColor: '#21BFC5',
      sidebarColor: '#20265A',
      source: 'system',
      sources: {
        logoUrl: 'system',
        primaryColor: 'system',
        accentColor: 'system',
        sidebarColor: 'system',
      },
    } }, { type: 'group', id: 'group-a' })
    expect(branding?.isFallback).toBe(true)
    expect(branding?.isLogoFallback).toBe(true)
  })

  it('sanitizes colors and logo URLs before they reach CSS or image markup', () => {
    expect(normalizeBrandColor('#1a2b3c')).toBe('#1A2B3C')
    expect(normalizeBrandColor('#abc')).toBe('#AABBCC')
    expect(normalizeBrandColor('red; background:url(javascript:1)')).toBe('')
    expect(normalizeBrandLogoUrl('/api/me/branding-logo/id?scopeType=company&scopeId=a')).toContain('/api/me/branding-logo/')
    expect(normalizeBrandLogoUrl('javascript:alert(1)')).toBe('')
    expect(normalizeBrandLogoUrl('//evil.example/logo.svg')).toBe('')
  })

  it('derives all theme variables from a validated profile', () => {
    const variables = effectiveBrandingCssVariables({
      ...DEFAULT_EFFECTIVE_BRANDING,
      primaryColor: '#123456',
      accentColor: '#ABCDEF',
      sidebarColor: '#112233',
    })
    expect(variables['--bbt-primary']).toBe('#123456')
    expect(variables['--bbt-primary-rgb']).toBe('18 52 86')
    expect(variables['--bbt-accent-rgb']).toBe('171 205 239')
    expect(variables['--bbt-sidebar']).toBe('#112233')
  })

  it('keeps app, voucher and reports on the same provider without localStorage hydration state', () => {
    const provider = source('components/branding/effective-branding-provider.tsx')
    const sidebar = source('components/sidebar.tsx')
    const voucher = source('app/dashboard/vouchers/[id]/page.tsx')
    const report = source('app/relatorios/_components/corporate-report.tsx')

    expect(provider).toContain("fetch(buildEffectiveBrandingUrl(requestedScope)")
    expect(provider).not.toContain('localStorage')
    expect(provider).toContain("root.style.setProperty(name, value)")
    expect(sidebar).toContain('<EffectiveBrandLogo')
    expect(voucher).toContain('const brandingScope = voucher?.empresa_id')
    expect(voucher).toContain("{ type: 'company' as const, id: voucher.empresa_id }")
    expect(voucher).toContain('useScopedEffectiveBranding(brandingScope)')
    expect(voucher).toContain('buildVoucherDocumentModel(voucher, {')
    expect(voucher).toContain('<VoucherDocument model={documentModel} assets={documentAssets} />')
    expect(report).toContain('<CoBrandedDocumentLogo')
    expect(report).toContain('agencyLogoDataUrl')
  })
})

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}
