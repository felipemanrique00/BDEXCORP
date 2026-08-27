import { describe, expect, it } from 'vitest'

import {
  BRANDING_SVG_MAX_BYTES,
  BrandingImageValidationError,
  detectBrandingImageFormat,
  validateBrandingImageEnvelope,
} from '@/lib/security/branding-image'

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00])
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
const WEBP = Buffer.from('RIFF0000WEBP', 'ascii')
const SVG = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48">
  <!-- Static corporate mark -->
  <defs>
    <linearGradient id="brand-gradient"><stop offset="0" stop-color="#20265A"/><stop offset="1" stop-color="#21BFC5"/></linearGradient>
  </defs>
  <style>.wordmark { fill: url(#brand-gradient); }</style>
  <path d="M4 4h40v40H4z" fill="url(#brand-gradient)"/>
  <text class="wordmark" x="52" y="31">BBT &amp; Cliente</text>
</svg>`)

function svgWith(content: string, rootAttributes = ''): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${rootAttributes}>${content}</svg>`)
}

function validateSvg(bytes: Buffer, mimeType = 'image/svg+xml') {
  return validateBrandingImageEnvelope(bytes, 'logo.svg', mimeType, { allowSvg: true })
}

describe('branding image envelope validation', () => {
  it('detects the accepted image formats by magic bytes', () => {
    expect(detectBrandingImageFormat(PNG)).toBe('png')
    expect(detectBrandingImageFormat(JPEG)).toBe('jpeg')
    expect(detectBrandingImageFormat(WEBP)).toBe('webp')
    expect(detectBrandingImageFormat(SVG)).toBeNull()
    expect(detectBrandingImageFormat(Buffer.from('%PDF-'))).toBeNull()
  })

  it('requires extension and declared MIME to match the content', () => {
    expect(validateBrandingImageEnvelope(PNG, 'logo.png', 'image/png')).toBe('png')
    expect(() => validateBrandingImageEnvelope(PNG, 'logo.jpg', 'image/jpeg'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(JPEG, 'logo.jpg', 'image/png'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(SVG, 'logo.png', 'image/png'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(PNG, 'logo.svg', 'image/svg+xml'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(SVG, 'logo.svg', 'image/svg+xml'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateSvg(SVG, 'image/png'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateSvg(SVG, 'image/svg+xml; charset=utf-8'))
      .toThrow(BrandingImageValidationError)
  })

  it('accepts a bounded static UTF-8 SVG with local fragment references', () => {
    expect(validateSvg(SVG)).toBe('svg')
  })

  it('rejects malformed encodings, roots, namespaces and XML declarations', () => {
    const invalidUtf8 = Buffer.concat([
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'),
      Buffer.from([0xC3, 0x28]),
      Buffer.from('</svg>'),
    ])
    expect(() => validateSvg(invalidUtf8))
      .toThrow(BrandingImageValidationError)
    expect(() => validateSvg(Buffer.from('<html/>')))
      .toThrow(BrandingImageValidationError)
    expect(() => validateSvg(Buffer.from('<svg/>')))
      .toThrow(BrandingImageValidationError)
    expect(() => validateSvg(
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    )).toThrow(BrandingImageValidationError)
  })

  it.each([
    ['DTD and entity', '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><text>&xxe;</text>'],
    ['processing instruction', '<?xml-stylesheet href="https://evil.example/a.css"?><rect/>'],
    ['script element', '<script>alert(1)</script>'],
    ['prefixed script element', '<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>'],
    ['foreignObject element', '<foreignObject><div>active</div></foreignObject>'],
    ['object element', '<object data="https://evil.example/x"/>'],
    ['embedded image', '<image href="data:image/png;base64,AAAA"/>'],
    ['filter pipeline', '<filter id="f"><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>'],
    ['filter image', '<filter id="f"><feImage href="https://evil.example/x"/></filter>'],
    ['filter attribute', '<rect filter="url(#f)"/>'],
    ['filter CSS', '<style>.x{filter:blur(2px)}</style><rect class="x"/>'],
    ['reusable symbol', '<symbol id="mark"><path d="M0 0h1v1z"/></symbol><use href="#mark"/>'],
    ['mask', '<mask id="m"><rect width="1" height="1"/></mask>'],
    ['pattern', '<pattern id="p" width="1" height="1"><rect width="1" height="1"/></pattern>'],
    ['marker', '<marker id="m"><path d="M0 0h1v1z"/></marker>'],
    ['custom font', '<font><glyph unicode="A" d="M0 0h1v1z"/></font>'],
    ['animation', '<animate attributeName="x" values="0;10"/>'],
    ['event attribute', '<rect ONLOAD="alert(1)"/>'],
    ['XML base', '<g xml:base="https://evil.example/"><path d="M0 0"/></g>'],
    ['external href', '<use href="https://evil.example/mark.svg#id"/>'],
    ['protocol-relative xlink', '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="//evil.example/x"/>'],
    ['source attribute', '<rect src="file:///etc/passwd"/>'],
    ['external CSS URL', '<rect fill="url(https://evil.example/pattern.svg#p)"/>'],
    ['embedded CSS URL', '<style>.x{fill:url(data:image/svg+xml;base64,AAAA)}</style><rect class="x"/>'],
    ['CSS import', '<style>@import "https://evil.example/a.css";</style>'],
    ['javascript CSS', '<rect style="fill:javascript:alert(1)"/>'],
    ['legacy CSS expression', '<rect style="width:expression(alert(1))"/>'],
    ['obfuscated CSS escape', '<rect style="fill:u\\72l(https://evil.example/x)"/>'],
    ['XML comment CSS splice', '<style>.x{fill:u<!-- hidden -->rl(https://evil.example/x)}</style><rect class="x"/>'],
    ['unknown entity', '<text>&payload;</text>'],
  ])('rejects active SVG content: %s', (_label, content) => {
    expect(() => validateSvg(svgWith(content)))
      .toThrow(BrandingImageValidationError)
  })

  it('rejects SVGs above the byte and nesting complexity limits', () => {
    const oversized = Buffer.concat([
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>'),
      Buffer.alloc(BRANDING_SVG_MAX_BYTES, 0x61),
      Buffer.from('</text></svg>'),
    ])
    expect(() => validateSvg(oversized))
      .toThrow(BrandingImageValidationError)

    const nested = svgWith(`${'<g>'.repeat(65)}<path d="M0 0h1v1z"/>${'</g>'.repeat(65)}`)
    expect(() => validateSvg(nested))
      .toThrow(BrandingImageValidationError)

    const tooManyElements = svgWith('<rect width="1" height="1"/>'.repeat(1_000))
    expect(() => validateSvg(tooManyElements))
      .toThrow(BrandingImageValidationError)
  })
})
