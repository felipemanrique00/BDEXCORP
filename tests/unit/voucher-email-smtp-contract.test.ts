import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
}

describe('voucher SMTP delivery contract', () => {
  it('sends through the server SMTP instead of opening the visitor mail client', () => {
    const page = source('app/dashboard/vouchers/[id]/page.tsx')
    const dialog = source('components/vouchers/send-voucher-email-dialog.tsx')
    const route = source('app/api/vouchers/[id]/email/route.ts')
    const service = source('lib/server/voucher-email-service.ts')

    expect(page).toContain('<SendVoucherEmailDialog voucher={voucher} />')
    expect(page).not.toContain('mailto:')
    expect(dialog).toContain('sendVoucherEmailFromServer')
    expect(route).toContain('sendVoucherEmail(')
    expect(service).toContain('sendTransactionalEmail({')
    expect(service).toContain('getCompanyDocumentBranding')
    expect(service).toContain('resolveVoucherEmailAssets')
    expect(service).toContain("toVoucherDocumentAssets(resolvedAssets, 'cid'")
    expect(service).toContain("toVoucherDocumentAssets(resolvedAssets, 'data-uri'")
    expect(service).toContain('content: standaloneHtml')
    expect(service).toContain('...resolvedAssets.inlineAttachments')
  })

  it('keeps linked recipients scoped and accepts explicitly separated custom recipients', () => {
    const service = source('lib/server/voucher-email-service.ts')
    const auditLog = source('lib/server/audit-log.ts')

    expect(service).toContain('voucherEmailRecipients(voucher)')
    expect(service).toContain("'VOUCHER_EMAIL_RECIPIENT_SCOPE_INVALID'")
    expect(service).toContain('customRecipients: z.array(voucherEmailAddressSchema)')
    expect(service).toContain('acknowledgeExternalDisclosure: z.boolean()')
    expect(service).toContain("'VOUCHER_EMAIL_EXTERNAL_DISCLOSURE_ACK_REQUIRED'")
    expect(service).toContain('VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS')
    expect(service).toContain('VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS')
    expect(service).toContain('customRecipientCount: customRecipients.length')
    expect(service).toContain("action: 'voucher.email.attempt'")
    expect(service).not.toContain('customRecipientEmailHashes')
    expect(auditLog).toContain('voucher\\.email\\.attempt$')
    expect(service).toContain("IDEMPOTENCY_OPERATION = 'voucher-email-send'")
    expect(service).toContain("where idempotency_keys.status = 'failed'")
  })

  it('delivers one private SMTP message per recipient and reports partial outcomes', () => {
    const service = source('lib/server/voucher-email-service.ts')

    expect(service).toContain('sendVoucherToRecipientsIndividually')
    expect(service).toContain('to: recipient')
    expect(service).not.toContain('to: recipients')
    expect(service).toContain('acceptedRecipients: delivery.acceptedRecipients')
    expect(service).toContain('rejectedRecipients: delivery.rejectedRecipients')
    expect(service).toContain("deliveryOutcome: delivery.rejectedRecipients.length > 0 ? 'partial' : 'complete'")
  })
})
