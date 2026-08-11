import 'server-only'

import { ASSISTANT_KEYS, appendAssistantList, createId } from '@/lib/assistant/storage'
import type { GeneratedDocument } from '@/lib/assistant/types'
import {
  VoucherDocument,
  type VoucherDocumentAssets as SharedVoucherDocumentAssets,
  type VoucherDocumentImageAsset as SharedVoucherDocumentImageAsset,
} from '@/components/vouchers/voucher-document'
import {
  buildVoucherDocumentModel,
  type VoucherDocumentBranding as ModelVoucherDocumentBranding,
} from '@/lib/vouchers/document-model'
import { VOUCHER_DOCUMENT_STYLES } from '@/lib/vouchers/document-styles'
import { renderDocumentStaticMarkup } from '@/lib/vouchers/document-static-markup'
import type { VoucherEmitido } from '@/types'

export interface VoucherDocumentBranding extends ModelVoucherDocumentBranding {
  /** Compatibilidade com os consumidores atuais do renderer. */
  logoDataUrl?: string | null
}

export type VoucherDocumentImageAsset = SharedVoucherDocumentImageAsset
export type VoucherDocumentAssets = SharedVoucherDocumentAssets

export async function generateVoucherDocument(
  voucher: VoucherEmitido,
  options: { createdBy?: string; protectSensitiveData?: boolean } = {},
): Promise<GeneratedDocument> {
  const html = renderVoucherHtml(voucher, options.protectSensitiveData !== false)
  const document: GeneratedDocument = {
    id: createId('doc'),
    type: 'voucher',
    status: 'generated',
    title: `Voucher ${voucher.id}`,
    entityId: voucher.id,
    companyId: voucher.empresa_id,
    html,
    fileName: `voucher-${voucher.id}.html`,
    mimeType: 'text/html',
    createdBy: options.createdBy,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.generatedDocuments, document, 500)
  return document
}

/**
 * Renderização canônica do voucher. A tela de impressão e os canais de envio
 * devem consumir o mesmo VoucherDocument/modelo para impedir divergências.
 * O quarto argumento é opcional para manter compatibilidade com a API antiga.
 */
export function renderVoucherHtml(
  voucher: VoucherEmitido,
  protectSensitiveData = true,
  documentBranding?: VoucherDocumentBranding | null,
  documentAssets?: VoucherDocumentAssets | null,
): string {
  const model = buildVoucherDocumentModel(voucher, {
    protectSensitiveData,
    branding: documentBranding,
  })
  const assets = normalizeVoucherDocumentAssets(documentBranding, documentAssets)
  const markup = renderDocumentStaticMarkup(VoucherDocument({ model, assets }))

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Voucher ${escapeHtml(voucher.id)}</title>
  <style>
    :root { color-scheme: light; --brand-primary: ${escapeHtml(model.branding.primaryColor)}; --brand-accent: ${escapeHtml(model.branding.accentColor)}; }
    ${VOUCHER_DOCUMENT_STYLES}
  </style>
</head>
<body>
${markup}
</body>
</html>`
}

function normalizeVoucherDocumentAssets(
  branding?: VoucherDocumentBranding | null,
  input?: VoucherDocumentAssets | null,
): VoucherDocumentAssets {
  const agencyLogo = normalizeImageAsset(input?.agencyLogo)
  const customerLogo = normalizeImageAsset(input?.customerLogo)
    || normalizeImageAsset(branding?.logoDataUrl ? {
      src: branding.logoDataUrl,
      alt: branding.displayName,
    } : null)
  const airlineLogos = Object.fromEntries(
    Object.entries(input?.airlineLogos || {})
      .map(([rawCode, asset]) => [normalizeAirlineCode(rawCode), normalizeImageAsset(asset)] as const)
      .filter((entry): entry is readonly [string, VoucherDocumentImageAsset] => Boolean(entry[0] && entry[1])),
  )
  return { agencyLogo, customerLogo, airlineLogos }
}

function normalizeImageAsset(
  value?: VoucherDocumentImageAsset | null,
): VoucherDocumentImageAsset | null {
  if (!value || !isSafeDocumentImageSource(value.src)) return null
  const backgroundColor = /^#[0-9A-Fa-f]{6}$/.test(String(value.backgroundColor || ''))
    ? String(value.backgroundColor).toUpperCase()
    : undefined
  return {
    src: value.src,
    alt: String(value.alt || '').trim().slice(0, 180) || undefined,
    backgroundColor,
  }
}

function isSafeDocumentImageSource(value: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(value)
    || /^cid:[A-Za-z0-9._@+-]{1,180}$/i.test(value)
}

function normalizeAirlineCode(value: string): string {
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9]{2,3}$/.test(code) ? code : ''
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
