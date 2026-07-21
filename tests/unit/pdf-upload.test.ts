import { describe, expect, it } from 'vitest'

import { PdfUploadValidationError, validatePdfUpload } from '@/lib/security/pdf-upload'

describe('validatePdfUpload', () => {
  const validPdf = Buffer.from('%PDF-1.7\n%%EOF')

  it('aceita PDF dentro do limite pela extensao e assinatura', () => {
    expect(() => validatePdfUpload(validPdf, 'voucher.PDF', 1_024)).not.toThrow()
  })

  it('rejeita arquivo vazio, extensao divergente, conteudo falso e excesso de tamanho', () => {
    expect(() => validatePdfUpload(Buffer.alloc(0), 'vazio.pdf', 1_024)).toThrow(PdfUploadValidationError)
    expect(() => validatePdfUpload(validPdf, 'voucher.html', 1_024)).toThrow('Apenas arquivos PDF')
    expect(() => validatePdfUpload(Buffer.from('<script>alert(1)</script>'), 'falso.pdf', 1_024)).toThrow('nao e um PDF valido')
    expect(() => validatePdfUpload(validPdf, 'grande.pdf', 4)).toThrow('excede o limite')
  })
})
