import { describe, expect, it } from 'vitest'

import {
  BrandingImageValidationError,
  detectBrandingImageFormat,
  validateBrandingImageEnvelope,
} from '@/lib/security/branding-image'

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00])
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
const WEBP = Buffer.from('RIFF0000WEBP', 'ascii')

describe('branding image envelope validation', () => {
  it('detects the accepted image formats by magic bytes', () => {
    expect(detectBrandingImageFormat(PNG)).toBe('png')
    expect(detectBrandingImageFormat(JPEG)).toBe('jpeg')
    expect(detectBrandingImageFormat(WEBP)).toBe('webp')
    expect(detectBrandingImageFormat(Buffer.from('%PDF-'))).toBeNull()
  })

  it('requires extension and declared MIME to match the content', () => {
    expect(validateBrandingImageEnvelope(PNG, 'logo.png', 'image/png')).toBe('png')
    expect(() => validateBrandingImageEnvelope(PNG, 'logo.jpg', 'image/jpeg'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(JPEG, 'logo.jpg', 'image/png'))
      .toThrow(BrandingImageValidationError)
    expect(() => validateBrandingImageEnvelope(Buffer.from('<svg/>'), 'logo.svg', 'image/svg+xml'))
      .toThrow(BrandingImageValidationError)
  })
})
