import { extname } from 'node:path'

export const BRANDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const BRANDING_IMAGE_MAX_PIXELS = 25_000_000

export type BrandingImageFormat = 'png' | 'jpeg' | 'webp'

export class BrandingImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrandingImageValidationError'
  }
}

export function validateBrandingImageEnvelope(
  bytes: Buffer,
  originalName: string,
  declaredMimeType?: string | null,
): BrandingImageFormat {
  if (!bytes.length) throw new BrandingImageValidationError('Arquivo de logomarca vazio.')
  if (bytes.length > BRANDING_IMAGE_MAX_BYTES) {
    throw new BrandingImageValidationError('A logomarca deve ter no maximo 5 MB.')
  }

  const extension = extname(originalName).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    throw new BrandingImageValidationError('Use uma imagem PNG, JPEG ou WebP.')
  }

  const format = detectBrandingImageFormat(bytes)
  if (!format) {
    throw new BrandingImageValidationError('O conteudo enviado nao e uma imagem PNG, JPEG ou WebP valida.')
  }
  const expectedExtensions: Record<BrandingImageFormat, string[]> = {
    png: ['.png'],
    jpeg: ['.jpg', '.jpeg'],
    webp: ['.webp'],
  }
  if (!expectedExtensions[format].includes(extension)) {
    throw new BrandingImageValidationError('A extensao do arquivo nao corresponde ao conteudo da imagem.')
  }

  const expectedMime: Record<BrandingImageFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  if (declaredMimeType && declaredMimeType !== expectedMime[format]) {
    throw new BrandingImageValidationError('O tipo informado nao corresponde ao conteudo da imagem.')
  }
  return format
}

export function detectBrandingImageFormat(bytes: Buffer): BrandingImageFormat | null {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
  ) return 'png'
  if (
    bytes.length >= 3
    && bytes[0] === 0xFF
    && bytes[1] === 0xD8
    && bytes[2] === 0xFF
  ) return 'jpeg'
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp'
  return null
}
