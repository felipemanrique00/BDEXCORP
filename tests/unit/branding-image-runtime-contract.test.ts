import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

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
})
