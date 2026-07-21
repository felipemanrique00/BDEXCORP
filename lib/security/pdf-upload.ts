import { extname } from 'node:path'

export class PdfUploadValidationError extends Error {}

export function validatePdfUpload(bytes: Buffer, name: string, maxBytes: number): void {
  if (!bytes.length) throw new PdfUploadValidationError('Arquivo vazio.')
  if (bytes.length > maxBytes) {
    throw new PdfUploadValidationError(`Arquivo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`)
  }
  if (extname(name).toLowerCase() !== '.pdf') {
    throw new PdfUploadValidationError('Apenas arquivos PDF sao aceitos.')
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new PdfUploadValidationError('O conteudo enviado nao e um PDF valido.')
  }
}
