import 'server-only'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  normalizeAirlineIataCode,
  resolveAirlineBrand,
} from '@/components/travel/services/air/airline-brand'
import { BRAND_LOGO_MARK_COLOR } from '@/lib/branding'
import {
  BRANDING_IMAGE_MAX_BYTES,
  detectBrandingImageFormat,
  type BrandingImageFormat,
} from '@/lib/security/branding-image'
import type { TransactionalEmailAttachment } from '@/lib/server/email'

const EMAIL_ASSET_CID_DOMAIN = 'voucher.bdextravel.local'
const BBT_MARK_ASSET = '/brand/bbt-corporativo-mark-color.webp'

/**
 * Deliberately finite list. No path supplied by a voucher, catalog row or
 * request is ever opened from disk by this module.
 */
const BUNDLED_ASSET_ALLOWLIST = new Map<string, { path: string; mimeType: VoucherEmailImageMimeType }>([
  [BBT_MARK_ASSET, { path: 'brand/bbt-corporativo-mark-color.webp', mimeType: 'image/webp' }],
  ['/airlines/AD.svg', { path: 'airlines/AD.svg', mimeType: 'image/svg+xml' }],
  ['/airlines/G3.svg', { path: 'airlines/G3.svg', mimeType: 'image/svg+xml' }],
  ['/airlines/LA.svg', { path: 'airlines/LA.svg', mimeType: 'image/svg+xml' }],
])

if (BRAND_LOGO_MARK_COLOR !== BBT_MARK_ASSET) {
  throw new Error('A logomarca BBT usada no voucher nao esta na allowlist de e-mail.')
}

export type VoucherEmailImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/svg+xml'

export interface VoucherEmailImageAsset {
  /** Stable semantic key, suitable for renderer maps and diagnostics. */
  key: string
  filename: string
  mimeType: VoucherEmailImageMimeType
  /** Canonical standalone source; structurally compatible with document assets. */
  src: string
  /** Self-contained source for downloaded/printed standalone HTML. */
  dataUri: string
  /** Content-ID and source for broad e-mail-client compatibility. */
  cid: string
  cidUrl: string
  /** Optional surface required by light/white airline wordmarks. */
  surfaceColor?: string
  /** Alias used by the canonical voucher document renderer. */
  backgroundColor?: string
}

export interface ResolvedVoucherEmailAssets {
  bbtLogo: VoucherEmailImageAsset
  corporateLogo: VoucherEmailImageAsset | null
  /** Includes the requested designator and its canonical alias when applicable. */
  airlineLogos: Readonly<Record<string, VoucherEmailImageAsset>>
  /** Attach these to Nodemailer when the renderer uses `cidUrl`. */
  inlineAttachments: TransactionalEmailAttachment[]
}

export interface ResolveVoucherEmailAssetsInput {
  /** Data URI produced by `getCompanyDocumentBranding`; it is revalidated here. */
  corporateLogoDataUrl?: string | null
  airlineIataCodes?: Iterable<string | null | undefined>
}

export interface VoucherDocumentAssetLabels {
  agencyLogoAlt?: string
  customerLogoAlt?: string
  airlineLogoAlts?: Readonly<Record<string, string>>
}

export interface VoucherDocumentImageSource {
  src: string
  alt?: string
  backgroundColor?: string
}

export interface VoucherDocumentAssetSources {
  agencyLogo: VoucherDocumentImageSource
  customerLogo: VoucherDocumentImageSource | null
  airlineLogos: Readonly<Record<string, VoucherDocumentImageSource>>
}

interface MaterializedImageAsset {
  publicAsset: VoucherEmailImageAsset
  attachment: TransactionalEmailAttachment
}

const bundledAssetCache = new Map<string, Promise<Buffer>>()
const rasterizedAirlineCache = new Map<string, Promise<Buffer>>()

/**
 * Resolves every image needed by a voucher without network access. The same
 * result supports standalone HTML (`dataUri`) and HTML e-mail (`cidUrl`).
 */
export async function resolveVoucherEmailAssets(
  input: ResolveVoucherEmailAssetsInput = {},
): Promise<ResolvedVoucherEmailAssets> {
  const bbtLogo = materializeAsset({
    key: 'bbt-logo',
    filename: 'bbt-corporativo.webp',
    mimeType: 'image/webp',
    bytes: await readBundledAsset(BBT_MARK_ASSET),
  })

  const corporateLogo = input.corporateLogoDataUrl
    ? materializeCorporateLogo(input.corporateLogoDataUrl)
    : null

  const airlineLogos: Record<string, VoucherEmailImageAsset> = {}
  const airlineAttachments = new Map<string, TransactionalEmailAttachment>()

  for (const rawCode of input.airlineIataCodes || []) {
    const requestedCode = normalizeAirlineIataCode(rawCode)
    const brand = resolveAirlineBrand(requestedCode)
    if (!requestedCode || !brand) continue

    const materialized = await materializeAirlineLogo(brand.iataCode, brand.logoPath, brand.logoSurfaceColor)
    airlineLogos[requestedCode] = materialized.publicAsset
    airlineLogos[brand.iataCode] = materialized.publicAsset
    airlineAttachments.set(materialized.attachment.cid || materialized.publicAsset.cid, materialized.attachment)
  }

  return {
    bbtLogo: bbtLogo.publicAsset,
    corporateLogo: corporateLogo?.publicAsset || null,
    airlineLogos,
    inlineAttachments: [
      bbtLogo.attachment,
      ...(corporateLogo ? [corporateLogo.attachment] : []),
      ...airlineAttachments.values(),
    ],
  }
}

export function voucherEmailImageSource(
  asset: VoucherEmailImageAsset | null | undefined,
  mode: 'data-uri' | 'cid',
): string | null {
  if (!asset) return null
  return mode === 'cid' ? asset.cidUrl : asset.dataUri
}

/** Maps an e-mail asset to the intentionally small shape used by the document renderer. */
export function voucherDocumentImageAsset(
  asset: VoucherEmailImageAsset | null | undefined,
  mode: 'data-uri' | 'cid',
  alt?: string,
): VoucherDocumentImageSource | null {
  if (!asset) return null
  return {
    src: mode === 'cid' ? asset.cidUrl : asset.dataUri,
    alt,
    backgroundColor: asset.backgroundColor,
  }
}

/** Converts all resolved images directly to the canonical voucher renderer shape. */
export function toVoucherDocumentAssets(
  assets: ResolvedVoucherEmailAssets,
  mode: 'data-uri' | 'cid',
  labels: VoucherDocumentAssetLabels = {},
): VoucherDocumentAssetSources {
  const airlineLogos = Object.fromEntries(Object.entries(assets.airlineLogos).map(([code, asset]) => [
    code,
    voucherDocumentImageAsset(
      asset,
      mode,
      labels.airlineLogoAlts?.[code] || `Logomarca da companhia aerea ${code}`,
    )!,
  ]))
  return {
    agencyLogo: voucherDocumentImageAsset(
      assets.bbtLogo,
      mode,
      labels.agencyLogoAlt || 'BBT Corporativo',
    )!,
    customerLogo: voucherDocumentImageAsset(
      assets.corporateLogo,
      mode,
      labels.customerLogoAlt || 'Identidade visual do cliente',
    ),
    airlineLogos,
  }
}

async function materializeAirlineLogo(
  canonicalCode: string,
  logoPath: string,
  surfaceColor?: string,
): Promise<MaterializedImageAsset> {
  const allowlisted = BUNDLED_ASSET_ALLOWLIST.get(logoPath)
  if (!allowlisted || allowlisted.mimeType !== 'image/svg+xml') {
    throw new Error(`Logomarca aerea ${canonicalCode} nao esta na allowlist de e-mail.`)
  }

  let rasterized = rasterizedAirlineCache.get(canonicalCode)
  if (!rasterized) {
    rasterized = rasterizeBundledAirlineLogo(logoPath)
    rasterizedAirlineCache.set(canonicalCode, rasterized)
  }

  return materializeAsset({
    key: `airline-${canonicalCode.toLowerCase()}`,
    filename: `companhia-${canonicalCode.toLowerCase()}.png`,
    mimeType: 'image/png',
    bytes: await rasterized,
    surfaceColor,
  })
}

async function rasterizeBundledAirlineLogo(logoPath: string): Promise<Buffer> {
  const svg = await readBundledAsset(logoPath)
  const { default: sharp } = await import('sharp')
  return sharp(svg, { failOn: 'warning' })
    .resize({ width: 320, height: 128, fit: 'inside', withoutEnlargement: false })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

function materializeCorporateLogo(dataUri: string): MaterializedImageAsset {
  const parsed = parseTrustedCorporateLogoDataUri(dataUri)
  const extension = parsed.format === 'jpeg' ? 'jpg' : parsed.format
  return materializeAsset({
    key: 'corporate-logo',
    filename: `identidade-cliente.${extension}`,
    mimeType: brandingFormatMimeType(parsed.format),
    bytes: parsed.bytes,
  })
}

function parseTrustedCorporateLogoDataUri(dataUri: string): {
  bytes: Buffer
  format: BrandingImageFormat
} {
  if (dataUri.length > Math.ceil(BRANDING_IMAGE_MAX_BYTES * 4 / 3) + 128) {
    throw new Error('A logomarca corporativa excede o limite permitido para e-mail.')
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri)
  if (!match || match[2].length % 4 !== 0) {
    throw new Error('A logomarca corporativa nao possui um data URI valido.')
  }

  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > BRANDING_IMAGE_MAX_BYTES) {
    throw new Error('A logomarca corporativa excede o limite permitido para e-mail.')
  }

  const format = detectBrandingImageFormat(bytes)
  if (!format || brandingFormatMimeType(format) !== match[1]) {
    throw new Error('O tipo da logomarca corporativa nao corresponde ao conteudo informado.')
  }

  // Buffer's decoder is permissive; require the canonical bytes to round-trip.
  if (bytes.toString('base64') !== match[2]) {
    throw new Error('A codificacao da logomarca corporativa nao e valida.')
  }
  return { bytes, format }
}

function materializeAsset(input: {
  key: string
  filename: string
  mimeType: VoucherEmailImageMimeType
  bytes: Buffer
  surfaceColor?: string
}): MaterializedImageAsset {
  const digest = createHash('sha256').update(input.bytes).digest('hex').slice(0, 16)
  const cid = `${input.key}-${digest}@${EMAIL_ASSET_CID_DOMAIN}`
  const dataUri = `data:${input.mimeType};base64,${input.bytes.toString('base64')}`
  return {
    publicAsset: {
      key: input.key,
      filename: input.filename,
      mimeType: input.mimeType,
      src: dataUri,
      dataUri,
      cid,
      cidUrl: `cid:${cid}`,
      surfaceColor: input.surfaceColor,
      backgroundColor: input.surfaceColor,
    },
    attachment: {
      filename: input.filename,
      content: input.bytes,
      contentType: input.mimeType,
      cid,
      contentDisposition: 'inline',
    },
  }
}

function brandingFormatMimeType(format: BrandingImageFormat): VoucherEmailImageMimeType {
  if (format === 'png') return 'image/png'
  if (format === 'jpeg') return 'image/jpeg'
  return 'image/webp'
}

async function readBundledAsset(publicPath: string): Promise<Buffer> {
  const allowlisted = BUNDLED_ASSET_ALLOWLIST.get(publicPath)
  if (!allowlisted) throw new Error('Asset do voucher nao esta na allowlist de e-mail.')

  let pending = bundledAssetCache.get(publicPath)
  if (!pending) {
    // `allowlisted.path` is a constant controlled by this module, never input.
    pending = readFile(resolve(process.cwd(), 'public', allowlisted.path))
    bundledAssetCache.set(publicPath, pending)
  }
  return pending
}
