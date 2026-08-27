import type { VoucherEmitido } from '@/types'

export type VoucherEmailSource = Pick<
  VoucherEmitido,
  'id' | 'solicitante_email' | 'solicitante_nome' | 'hospedes_detalhes'
>

export type VoucherEmailRecipientKind = 'requester' | 'traveler'

export const VOUCHER_EMAIL_MAX_LINKED_RECIPIENTS = 50
export const VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS = 10
export const VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS = 50

export interface VoucherEmailRecipient {
  email: string
  name: string
  kind: VoucherEmailRecipientKind
}

export function voucherEmailRecipients(voucher: VoucherEmailSource): VoucherEmailRecipient[] {
  const recipients: VoucherEmailRecipient[] = []
  const seen = new Set<string>()

  appendRecipient(
    recipients,
    seen,
    voucher.solicitante_email,
    voucher.solicitante_nome || 'Solicitante',
    'requester',
  )

  for (const traveler of voucher.hospedes_detalhes || []) {
    appendRecipient(recipients, seen, traveler.email, traveler.nome || 'Viajante', 'traveler')
  }

  return recipients
}

export function voucherEmailSubject(voucher: VoucherEmitido): string {
  return sanitizeVoucherEmailHeader(`Voucher ${voucher.id} - ${voucher.passageiro_nome}`)
}

export function voucherEmailText(voucher: VoucherEmitido): string {
  const service = voucher.tipo === 'Hotel'
    ? voucher.hotel_nome || voucher.fornecedor_nome
    : voucher.tipo === 'Aéreo'
      ? voucher.cia_aerea || voucher.fornecedor_nome
      : voucher.fornecedor_nome
  const locator = voucher.localizador || voucher.numero_confirmacao || 'Não informado'
  return [
    `Voucher ${voucher.id}`,
    `Empresa: ${voucher.empresa_nome || 'Não informada'}`,
    `Viajante: ${voucher.passageiro_nome}`,
    `Serviço: ${voucher.tipo}${service ? ` - ${service}` : ''}`,
    `Localizador: ${locator}`,
    '',
    'Os dados completos da reserva estão no corpo e no arquivo HTML anexado a esta mensagem.',
    'Em caso de divergência, entre em contato com a equipe BBT.',
  ].join('\n')
}

export function normalizeVoucherEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function canonicalizeVoucherEmailList(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeVoucherEmail))]
}

export function isSafeVoucherEmail(value: string): boolean {
  if (!value || value.length > 320 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) return false

  const email = normalizeVoucherEmail(value)
  if (email.length < 3 || email.length > 320 || !/^[\x21-\x7e]+$/.test(email)) return false

  const atIndex = email.lastIndexOf('@')
  if (atIndex <= 0 || atIndex !== email.indexOf('@')) return false
  const localPart = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  if (
    localPart.length > 64
    || domain.length > 253
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
    || !isValidEmailDomain(domain)
  ) return false

  return true
}

function appendRecipient(
  recipients: VoucherEmailRecipient[],
  seen: Set<string>,
  rawEmail: string | undefined,
  rawName: string,
  kind: VoucherEmailRecipientKind,
): void {
  const email = normalizeVoucherEmail(rawEmail || '')
  if (!isSafeVoucherEmail(email) || seen.has(email)) return
  seen.add(email)
  recipients.push({
    email,
    name: rawName.trim() || (kind === 'requester' ? 'Solicitante' : 'Viajante'),
    kind,
  })
}

function sanitizeVoucherEmailHeader(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function isValidEmailDomain(domain: string): boolean {
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false
  return domain.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))
}
