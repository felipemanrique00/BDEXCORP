import 'server-only'

import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { renderVoucherHtml } from '@/lib/assistant/pdf'
import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { getCompanyDocumentBranding } from '@/lib/server/corporate-branding-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  EmailUnavailableError,
  emailConfigured,
  sendTransactionalEmail,
  type TransactionalEmailAttachment,
} from '@/lib/server/email'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  resolveVoucherEmailAssets,
  toVoucherDocumentAssets,
} from '@/lib/server/voucher-email-assets'
import { getVoucher } from '@/lib/server/voucher-service'
import {
  canonicalizeVoucherEmailList,
  isSafeVoucherEmail,
  VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS,
  VOUCHER_EMAIL_MAX_LINKED_RECIPIENTS,
  VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS,
  voucherEmailRecipients,
  voucherEmailSubject,
  voucherEmailText,
} from '@/lib/vouchers/email'

const voucherEmailAddressSchema = z.string()
  .max(320)
  .refine(isSafeVoucherEmail, 'Informe um endere\u00e7o de e-mail v\u00e1lido e seguro.')

const voucherEmailInputSchema = z.object({
  recipients: z.array(voucherEmailAddressSchema)
    .max(VOUCHER_EMAIL_MAX_LINKED_RECIPIENTS)
    .default([]),
  customRecipients: z.array(voucherEmailAddressSchema)
    .max(VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS)
    .default([]),
  acknowledgeExternalDisclosure: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().min(12).max(200),
}).strict().superRefine((input, context) => {
  const recipients = canonicalizeVoucherEmailList([
    ...input.recipients,
    ...input.customRecipients,
  ])
  if (recipients.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Selecione ou informe ao menos um destinat\u00e1rio.',
      path: ['recipients'],
    })
  }
  if (recipients.length > VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      type: 'array',
      maximum: VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS,
      inclusive: true,
      message: `O envio aceita no m\u00e1ximo ${VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS} destinat\u00e1rios.`,
      path: ['recipients'],
    })
  }
})

const resultSchema = z.object({
  voucherId: z.string(),
  recipients: z.array(voucherEmailAddressSchema),
  acceptedRecipients: z.array(voucherEmailAddressSchema).optional(),
  rejectedRecipients: z.array(voucherEmailAddressSchema).optional(),
  sentAt: z.string(),
  duplicate: z.boolean(),
}).strict()

const IDEMPOTENCY_OPERATION = 'voucher-email-send'
const INDIVIDUAL_DELIVERY_CONCURRENCY = 4

interface IdempotencyRow extends QueryResultRow {
  request_hash: string
  status: 'processing' | 'completed' | 'failed'
  response_body: unknown
  claimed: boolean
}

export interface VoucherEmailSendResult {
  voucherId: string
  recipients: string[]
  acceptedRecipients: string[]
  rejectedRecipients: string[]
  sentAt: string
  duplicate: boolean
}

interface IndividualDeliveryResult {
  acceptedRecipients: string[]
  rejectedRecipients: string[]
  errors: unknown[]
}

export class VoucherEmailServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export async function sendVoucherEmail(
  principal: RequestPrincipal,
  rawVoucherId: string,
  rawInput: unknown,
): Promise<VoucherEmailSendResult> {
  const input = voucherEmailInputSchema.parse(rawInput)
  if (input.customRecipients.length > 0 && input.acknowledgeExternalDisclosure !== true) {
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_EXTERNAL_DISCLOSURE_ACK_REQUIRED',
      'Confirme o envio de dados do voucher para destinat\u00e1rios externos.',
      422,
    )
  }
  if (!emailConfigured()) {
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_SMTP_UNAVAILABLE',
      'O SMTP do sistema não está configurado para envio de vouchers.',
      503,
    )
  }

  const voucher = await getVoucher(principal, rawVoucherId)
  await requireCompanyAccess(principal, voucher.empresa_id, 'operar_reservas')
  if (!['emitido', 'confirmado'].includes(voucher.status)) {
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_STATUS_INVALID',
      'Somente vouchers emitidos ou confirmados podem ser enviados.',
      409,
    )
  }

  const allowed = new Map(voucherEmailRecipients(voucher).map((recipient) => [recipient.email, recipient]))
  const requestedLinkedRecipients = canonicalizeVoucherEmailList(input.recipients)
  if (requestedLinkedRecipients.some((email) => !allowed.has(email))) {
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_RECIPIENT_SCOPE_INVALID',
      'Os destinat\u00e1rios selecionados devem ser o solicitante ou viajantes vinculados ao voucher. Use destinat\u00e1rios personalizados para outros endere\u00e7os.',
      403,
    )
  }

  const requestedCustomRecipients = canonicalizeVoucherEmailList(input.customRecipients)
  const linkedRecipients = canonicalizeVoucherEmailList([
    ...requestedLinkedRecipients,
    ...requestedCustomRecipients.filter((email) => allowed.has(email)),
  ])
  const customRecipients = requestedCustomRecipients.filter((email) => !allowed.has(email))
  const recipients = canonicalizeVoucherEmailList([...linkedRecipients, ...customRecipients])

  const requestHash = sha256({ voucherId: voucher.id, recipients: [...recipients].sort() })
  const previous = await claimEmailDelivery(principal, input.idempotencyKey, requestHash)
  if (previous) return previous

  try {
    await writeAuditEvent({
      action: 'voucher.email.attempt',
      result: 'success',
      entityType: 'voucher',
      entityId: voucher.id,
      metadata: {
        companyId: voucher.empresa_id,
        recipientCount: recipients.length,
        linkedRecipientCount: linkedRecipients.length,
        customRecipientCount: customRecipients.length,
        customRecipientDomains: [...new Set(customRecipients.map((email) => email.split('@')[1]))],
        externalDisclosureAcknowledged: input.acknowledgeExternalDisclosure,
        idempotencyKeyHash: sha256(input.idempotencyKey),
      },
    })
  } catch {
    await failEmailDelivery(principal, input.idempotencyKey).catch(() => undefined)
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_AUDIT_UNAVAILABLE',
      'Não foi possível registrar a tentativa de envio com segurança. Tente novamente.',
      503,
    )
  }

  let delivery: IndividualDeliveryResult = {
    acceptedRecipients: [],
    rejectedRecipients: [],
    errors: [],
  }

  try {
    const { branding, logoDataUrl } = await getCompanyDocumentBranding(principal, voucher.empresa_id)
    const documentBranding = {
      displayName: branding.displayName,
      logoDataUrl: branding.sources.logoUrl === 'system' ? null : logoDataUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      documentLegalName: branding.documentLegalName,
      documentNumber: branding.documentNumber,
    }
    const airlineLabels = voucherAirlineLabels(voucher)
    const resolvedAssets = await resolveVoucherEmailAssets({
      corporateLogoDataUrl: documentBranding.logoDataUrl,
      airlineIataCodes: Object.keys(airlineLabels),
    })
    const assetLabels = {
      agencyLogoAlt: 'BBT Corporativo',
      customerLogoAlt: branding.displayName,
      airlineLogoAlts: airlineLabels,
    }
    const html = renderVoucherHtml(
      voucher,
      true,
      documentBranding,
      toVoucherDocumentAssets(resolvedAssets, 'cid', assetLabels),
    )
    const standaloneHtml = renderVoucherHtml(
      voucher,
      true,
      documentBranding,
      toVoucherDocumentAssets(resolvedAssets, 'data-uri', assetLabels),
    )
    delivery = await sendVoucherToRecipientsIndividually({
      recipients,
      subject: voucherEmailSubject(voucher),
      text: voucherEmailText(voucher),
      html,
      attachments: [
        {
          filename: `voucher-${safeFileName(voucher.id)}.html`,
          content: standaloneHtml,
          contentType: 'text/html; charset=utf-8',
        },
        ...resolvedAssets.inlineAttachments,
      ],
    })
    if (delivery.acceptedRecipients.length === 0) {
      const smtpUnavailable = delivery.errors.length > 0
        && delivery.errors.every((error) => error instanceof EmailUnavailableError)
      if (smtpUnavailable) throw delivery.errors[0]
      throw new Error('Nenhum destinatario foi aceito pelo SMTP.')
    }

    const sentAt = new Date().toISOString()
    const result: VoucherEmailSendResult = {
      voucherId: voucher.id,
      recipients: delivery.acceptedRecipients,
      acceptedRecipients: delivery.acceptedRecipients,
      rejectedRecipients: delivery.rejectedRecipients,
      sentAt,
      duplicate: false,
    }
    await completeEmailDelivery(principal, input.idempotencyKey, result)
    await writeAuditEvent({
      action: 'voucher.email.send',
      result: 'success',
      entityType: 'voucher',
      entityId: voucher.id,
      metadata: {
        companyId: voucher.empresa_id,
        recipientCount: recipients.length,
        acceptedRecipientCount: delivery.acceptedRecipients.length,
        rejectedRecipientCount: delivery.rejectedRecipients.length,
        deliveryOutcome: delivery.rejectedRecipients.length > 0 ? 'partial' : 'complete',
        linkedRecipientCount: linkedRecipients.length,
        customRecipientCount: customRecipients.length,
        externalDisclosureAcknowledged: input.acknowledgeExternalDisclosure,
        acceptedCustomRecipientCount: countIntersection(customRecipients, delivery.acceptedRecipients),
        rejectedCustomRecipientCount: countIntersection(customRecipients, delivery.rejectedRecipients),
        recipientDomains: [...new Set(recipients.map((email) => email.split('@')[1]))],
        customRecipientDomains: [...new Set(customRecipients.map((email) => email.split('@')[1]))],
        idempotencyKeyHash: sha256(input.idempotencyKey),
      },
    })
    return result
  } catch (error) {
    await failEmailDelivery(principal, input.idempotencyKey).catch(() => undefined)
    await writeAuditEvent({
      action: 'voucher.email.send',
      result: 'failure',
      entityType: 'voucher',
      entityId: voucher.id,
      metadata: {
        companyId: voucher.empresa_id,
        recipientCount: recipients.length,
        acceptedRecipientCount: delivery.acceptedRecipients.length,
        rejectedRecipientCount: delivery.rejectedRecipients.length,
        deliveryOutcome: 'failed',
        linkedRecipientCount: linkedRecipients.length,
        customRecipientCount: customRecipients.length,
        externalDisclosureAcknowledged: input.acknowledgeExternalDisclosure,
        acceptedCustomRecipientCount: countIntersection(customRecipients, delivery.acceptedRecipients),
        rejectedCustomRecipientCount: countIntersection(customRecipients, delivery.rejectedRecipients),
        customRecipientDomains: [...new Set(customRecipients.map((email) => email.split('@')[1]))],
        idempotencyKeyHash: sha256(input.idempotencyKey),
        reason: error instanceof Error ? error.name : 'unknown',
      },
    }).catch(() => undefined)
    if (error instanceof EmailUnavailableError) {
      throw new VoucherEmailServiceError('VOUCHER_EMAIL_SMTP_UNAVAILABLE', error.message, 503)
    }
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_DELIVERY_FAILED',
      'O SMTP não confirmou a entrega do voucher. Verifique a configuração e tente novamente.',
      502,
    )
  }
}

async function claimEmailDelivery(
  principal: RequestPrincipal,
  idempotencyKey: string,
  requestHash: string,
): Promise<VoucherEmailSendResult | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<IdempotencyRow>(
      `with inserted as (
         insert into idempotency_keys (
           tenant_id, operation, idempotency_key, request_hash, status,
           locked_until, expires_at
         ) values ($1, $2, $3, $4, 'processing', now() + interval '2 minutes', now() + interval '24 hours')
         on conflict (tenant_id, operation, idempotency_key) do update
         set status = 'processing', response_status = null, response_body = null,
             locked_until = excluded.locked_until, expires_at = excluded.expires_at
         where idempotency_keys.status = 'failed'
           and idempotency_keys.request_hash = excluded.request_hash
         returning request_hash, status, response_body, true as claimed
       )
       select request_hash, status, response_body, claimed
       from inserted
       union all
       select request_hash, status, response_body, false as claimed
       from idempotency_keys
       where tenant_id = $1 and operation = $2 and idempotency_key = $3
         and not exists (select 1 from inserted)
       limit 1`,
      [principal.tenantId, IDEMPOTENCY_OPERATION, idempotencyKey, requestHash],
    )
    const row = result.rows[0]
    if (!row) {
      throw new VoucherEmailServiceError('VOUCHER_EMAIL_IDEMPOTENCY_FAILED', 'Falha ao proteger o envio duplicado.', 500)
    }
    if (row.request_hash !== requestHash) {
      throw new VoucherEmailServiceError(
        'VOUCHER_EMAIL_IDEMPOTENCY_CONFLICT',
        'Esta tentativa de envio já foi usada com outros destinatários.',
        409,
      )
    }
    if (row.claimed) return null
    if (row.status === 'completed') {
      const previous = resultSchema.safeParse(row.response_body)
      if (!previous.success) {
        throw new VoucherEmailServiceError('VOUCHER_EMAIL_IDEMPOTENCY_RESULT_INVALID', 'Resultado anterior inválido.', 500)
      }
      const acceptedRecipients = previous.data.acceptedRecipients || previous.data.recipients
      return {
        ...previous.data,
        recipients: acceptedRecipients,
        acceptedRecipients,
        rejectedRecipients: previous.data.rejectedRecipients || [],
        duplicate: true,
      }
    }
    throw new VoucherEmailServiceError(
      'VOUCHER_EMAIL_ALREADY_PROCESSING',
      'Este envio já está em processamento. Feche e abra novamente para uma nova tentativa.',
      409,
    )
  })
}

async function completeEmailDelivery(
  principal: RequestPrincipal,
  idempotencyKey: string,
  result: VoucherEmailSendResult,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, (client) => client.query(
    `update idempotency_keys
     set status = 'completed', response_status = 200, response_body = $4::jsonb,
         locked_until = null, expires_at = now() + interval '24 hours'
     where tenant_id = $1 and operation = $2 and idempotency_key = $3`,
    [principal.tenantId, IDEMPOTENCY_OPERATION, idempotencyKey, JSON.stringify(result)],
  ))
}

async function failEmailDelivery(principal: RequestPrincipal, idempotencyKey: string): Promise<void> {
  await withTenantTransaction(principal.tenantId, (client) => client.query(
    `update idempotency_keys
     set status = 'failed', response_status = 502, locked_until = null,
         expires_at = now() + interval '10 minutes'
     where tenant_id = $1 and operation = $2 and idempotency_key = $3`,
    [principal.tenantId, IDEMPOTENCY_OPERATION, idempotencyKey],
  ))
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'voucher'
}

async function sendVoucherToRecipientsIndividually(input: {
  recipients: string[]
  subject: string
  text: string
  html: string
  attachments: TransactionalEmailAttachment[]
}): Promise<IndividualDeliveryResult> {
  const acceptedRecipients: string[] = []
  const rejectedRecipients: string[] = []
  const errors: unknown[] = []

  for (let offset = 0; offset < input.recipients.length; offset += INDIVIDUAL_DELIVERY_CONCURRENCY) {
    const chunk = input.recipients.slice(offset, offset + INDIVIDUAL_DELIVERY_CONCURRENCY)
    const results = await Promise.all(chunk.map(async (recipient) => {
      try {
        await sendTransactionalEmail({
          to: recipient,
          subject: input.subject,
          text: input.text,
          html: input.html,
          attachments: input.attachments,
        })
        return { recipient, accepted: true as const }
      } catch (error) {
        return { recipient, accepted: false as const, error }
      }
    }))

    for (const result of results) {
      if (result.accepted) {
        acceptedRecipients.push(result.recipient)
      } else {
        rejectedRecipients.push(result.recipient)
        errors.push(result.error)
      }
    }
  }

  return { acceptedRecipients, rejectedRecipients, errors }
}

function voucherAirlineLabels(voucher: {
  trechos_aereos?: Array<{ companhia_codigo: string; companhia_nome: string }>
  bilhetes_aereos?: Array<{ companhia_codigo: string; companhia_nome: string }>
}): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const item of [...(voucher.trechos_aereos || []), ...(voucher.bilhetes_aereos || [])]) {
    const code = String(item.companhia_codigo || '').trim().toUpperCase()
    if (code && !labels[code]) labels[code] = String(item.companhia_nome || '').trim() || `Companhia ${code}`
  }
  return labels
}

function countIntersection(left: string[], right: string[]): number {
  const rightSet = new Set(right)
  return left.filter((value) => rightSet.has(value)).length
}
