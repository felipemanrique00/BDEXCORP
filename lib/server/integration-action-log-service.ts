import 'server-only'

import { z } from 'zod'

import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const integrationActionLogInputSchema = z.object({
  companyId: z.string().trim().min(1).max(200).nullable().optional(),
  providerKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
  providerName: z.string().trim().min(2).max(200),
  action: z.string().trim().min(2).max(80),
  service: z.string().trim().min(2).max(80).nullable().optional(),
  status: z.enum(['success', 'pending', 'failure']),
  message: z.string().trim().min(1).max(2000),
  endpoint: z.string().trim().max(1000).nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  payloadRedacted: z.record(z.unknown()).optional(),
}).strict()

export type IntegrationActionLogInput = z.infer<typeof integrationActionLogInputSchema>

export async function appendIntegrationActionLog(
  principal: RequestPrincipal,
  rawInput: IntegrationActionLogInput,
): Promise<string> {
  const input = integrationActionLogInputSchema.parse(rawInput)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into integration_action_logs (
         tenant_id, company_id, provider_id, provider_key, provider_name,
         action, service, status, message, endpoint, duration_ms,
         payload_redacted, actor_user_id
       ) values (
         $1, $2,
         (
           select id
           from integration_providers
           where tenant_id = $1
             and provider_key = $3
             and deleted_at is null
           limit 1
         ),
         $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12
       )
       returning id`,
      [
        principal.tenantId,
        input.companyId || null,
        input.providerKey,
        input.providerName,
        input.action,
        input.service || null,
        input.status,
        input.message,
        input.endpoint || null,
        input.durationMs ?? null,
        JSON.stringify(input.payloadRedacted || {}),
        principal.user.id,
      ],
    )
    return result.rows[0].id
  })
}
