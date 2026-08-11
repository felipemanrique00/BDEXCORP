import { describe, expect, it } from 'vitest'

import {
  resolveVoucherEmailAssets,
  toVoucherDocumentAssets,
  voucherEmailImageSource,
} from '@/lib/server/voucher-email-assets'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

describe('voucher email assets', () => {
  it('resolve BBT, corporate and allowlisted airline logos as data URIs and CIDs', async () => {
    const assets = await resolveVoucherEmailAssets({
      corporateLogoDataUrl: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      airlineIataCodes: ['AD', 'JJ', 'XX', 'ad'],
    })

    expect(assets.bbtLogo.dataUri).toMatch(/^data:image\/webp;base64,/)
    expect(voucherEmailImageSource(assets.bbtLogo, 'cid')).toBe(assets.bbtLogo.cidUrl)
    expect(assets.corporateLogo?.dataUri).toBe(`data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`)
    expect(assets.airlineLogos.AD.dataUri).toMatch(/^data:image\/png;base64,/)
    expect(assets.airlineLogos.JJ).toBe(assets.airlineLogos.LA)
    expect(assets.airlineLogos.XX).toBeUndefined()
    expect(assets.airlineLogos.LA.backgroundColor).toBe('#1b0088')
    expect(assets.inlineAttachments).toHaveLength(4)
    expect(new Set(assets.inlineAttachments.map((attachment) => attachment.cid)).size).toBe(4)
    expect(assets.inlineAttachments.every((attachment) => Buffer.isBuffer(attachment.content))).toBe(true)
    expect(assets.inlineAttachments.every((attachment) => attachment.contentDisposition === 'inline')).toBe(true)

    const documentAssets = toVoucherDocumentAssets(assets, 'cid')
    expect(documentAssets.agencyLogo.src).toBe(assets.bbtLogo.cidUrl)
    expect(documentAssets.customerLogo?.src).toBe(assets.corporateLogo?.cidUrl)
    expect(documentAssets.airlineLogos.LA.backgroundColor).toBe('#1b0088')
  })

  it('rejects forged or non-canonical corporate logo data URIs', async () => {
    await expect(resolveVoucherEmailAssets({
      corporateLogoDataUrl: `data:image/jpeg;base64,${ONE_PIXEL_PNG.toString('base64')}`,
    })).rejects.toThrow(/nao corresponde/i)

    await expect(resolveVoucherEmailAssets({
      corporateLogoDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    })).rejects.toThrow(/data URI valido/i)
  })
})
