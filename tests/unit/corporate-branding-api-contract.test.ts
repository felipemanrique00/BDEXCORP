import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/corporate-branding-service.ts'),
  'utf8',
)
const settingsRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/brand-identity-settings/[scopeType]/[scopeId]/route.ts'),
  'utf8',
)
const uploadRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/brand-identity-settings/[scopeType]/[scopeId]/logo/route.ts'),
  'utf8',
)
const effectiveRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/me/effective-branding/route.ts'),
  'utf8',
)

describe('corporate branding API contracts', () => {
  it('offers audited optimistic GET/PATCH settings scoped by company or group', () => {
    expect(settingsRoute).toContain('export async function GET')
    expect(settingsRoute).toContain('export async function PATCH')
    expect(settingsRoute).toContain("permission: 'alterar_configuracoes'")
    expect(service).toContain('version = version + 1')
    expect(service).toContain("action: 'corporate_branding.settings.update'")
    expect(service).toContain('requireCompanyAccess(principal, entity.id, permission)')
  })

  it('uploads only bounded images through the dedicated multipart route', () => {
    expect(uploadRoute).toContain('request.formData()')
    expect(uploadRoute).toContain("form.get('file')")
    expect(uploadRoute).toContain('BRANDING_IMAGE_MAX_BYTES + 256 * 1024')
    expect(uploadRoute).toContain('{ ok: true, configuration }')
    expect(service).toContain('validateBrandingImageEnvelope')
    expect(service).toContain('limitInputPixels: BRANDING_IMAGE_MAX_PIXELS')
    expect(service).toContain(".webp({ quality: 90, alphaQuality: 95, effort: 5 })")
    expect(service).toContain("select pg_advisory_xact_lock(hashtext('tenant-file-quota')")
    expect(service).toContain('insert into corporate_branding_assets')
  })

  it('exposes effective branding without embedding private data URLs', () => {
    expect(effectiveRoute).toContain('export async function GET')
    expect(effectiveRoute).toContain('{ ok: true, branding }')
    expect(effectiveRoute).not.toContain('logoDataUrl')
    expect(service).toContain('export async function getCompanyDocumentBranding')
    expect(service).toContain('logoDataUrl: `data:${file.record.mimeType};base64,')
  })
})
