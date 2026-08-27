import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const panel = readFileSync(
  resolve(process.cwd(), 'components/branding/corporate-branding-settings-panel.tsx'),
  'utf8',
)

describe('corporate branding SVG upload UI', () => {
  it('offers SVG alongside the existing raster logo formats', () => {
    expect(panel).toContain(
      "new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])",
    )
    expect(panel).toContain(
      'accept="image/png,image/jpeg,image/webp,image/svg+xml"',
    )
    expect(panel).toContain('Selecione uma imagem PNG, JPEG, WebP ou SVG.')
    expect(panel).toContain('PNG, JPEG ou WebP com até 5 MB; SVG com até 1 MB.')
  })

  it('keeps the existing bounded multipart upload flow', () => {
    expect(panel).toContain('const MAX_LOGO_BYTES = 5 * 1024 * 1024')
    expect(panel).toContain('const MAX_SVG_LOGO_BYTES = 1 * 1024 * 1024')
    expect(panel).toContain("file.type === 'image/svg+xml' && file.size > MAX_SVG_LOGO_BYTES")
    expect(panel).toContain('A logomarca SVG deve ter no máximo 1 MB.')
    expect(panel).toContain('if (file.size > MAX_LOGO_BYTES)')
    expect(panel).toContain("form.append('file', file)")
    expect(panel).toContain("method: 'POST'")
  })
})
