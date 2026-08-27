import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import {
  BRANDING_SVG_MAX_PIXELS,
  detectBrandingImageFormat,
  validateBrandingImageEnvelope,
} from '@/lib/security/branding-image'

const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8')
const service = readFileSync(
  resolve(process.cwd(), 'lib/server/corporate-branding-service.ts'),
  'utf8',
)

describe('corporate branding image runtime contract', () => {
  it('ships and exercises the matching Alpine Sharp/libvips runtime', () => {
    expect(dockerfile).toContain(
      '/app/node_modules/sharp ./node_modules/sharp',
    )
    expect(dockerfile).toContain(
      '/app/node_modules/@img/sharp-libvips-linuxmusl-x64 ./node_modules/@img/sharp-libvips-linuxmusl-x64',
    )
    expect(dockerfile).toContain(
      '/app/node_modules/@img/sharp-linuxmusl-x64 ./node_modules/@img/sharp-linuxmusl-x64',
    )
    expect(dockerfile).toContain("sharp runtime ok")
    expect(dockerfile).toContain(".webp().toBuffer()")
  })

  it('loads Sharp only when an upload needs image normalization', () => {
    expect(service).not.toMatch(/^import sharp from ['\"]sharp['\"]/m)
    expect(service).toContain("const { default: sharp } = await import('sharp')")
  })

  it('accepts SVG only before normalization and persists the canonical WebP output', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#20265A"/></svg>',
    )
    expect(validateBrandingImageEnvelope(svg, 'logo.svg', 'image/svg+xml', { allowSvg: true })).toBe('svg')

    const normalized = await sharp(svg, {
      failOn: 'warning',
      limitInputPixels: BRANDING_SVG_MAX_PIXELS,
      animated: false,
    }).webp().timeout({ seconds: 3 }).toBuffer()
    expect(detectBrandingImageFormat(normalized)).toBe('webp')
    expect(service).toContain("const BRANDING_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const")
    expect(service).toContain("$6, $7, 'image/webp', $8, $9, 'Logomarca corporativa normalizada'")
    expect(service).toContain("detectBrandingImageFormat(normalized) !== 'webp'")
    expect(service).toContain("const BRANDING_IMAGE_PROCESSING_TIMEOUT_SECONDS = 3")
    expect(service.match(/\.timeout\(\{ seconds: BRANDING_IMAGE_PROCESSING_TIMEOUT_SECONDS \}\)/g)).toHaveLength(2)
    expect(service).toContain("inputFormat === 'svg'")
    expect(service).toContain('BRANDING_SVG_MAX_PIXELS')
    expect(service).not.toMatch(/BRANDING_LOGO_MIME_TYPES\s*=\s*\[[^\]]*image\/svg\+xml/)
  })
})
