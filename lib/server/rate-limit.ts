import 'server-only'

import { createHash } from 'node:crypto'

import { queryDatabase } from '@/lib/server/database'

export interface RateLimitPolicy {
  key: string
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface RateLimitRow {
  count: number
  expires_at: Date
}

export async function consumeRateLimit(identity: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  if (!policy.key || policy.limit <= 0 || policy.windowMs < 1_000) throw new Error('Politica de rate limit invalida.')
  const identityHash = createHash('sha256').update(identity).digest('hex')
  const result = await queryDatabase<RateLimitRow>(
    `insert into rate_limit_buckets (bucket_key, identity_hash, count, window_started_at, expires_at)
     values ($1, $2, 1, now(), now() + ($3::bigint * interval '1 millisecond'))
     on conflict (bucket_key, identity_hash) do update set
       count = case when rate_limit_buckets.expires_at <= now() then 1 else rate_limit_buckets.count + 1 end,
       window_started_at = case when rate_limit_buckets.expires_at <= now() then now() else rate_limit_buckets.window_started_at end,
       expires_at = case
         when rate_limit_buckets.expires_at <= now() then now() + ($3::bigint * interval '1 millisecond')
         else rate_limit_buckets.expires_at
       end
     returning count, expires_at`,
    [policy.key, identityHash, policy.windowMs],
  )

  const row = result.rows[0]
  const retryAfterSeconds = Math.max(1, Math.ceil((row.expires_at.getTime() - Date.now()) / 1_000))
  return {
    allowed: row.count <= policy.limit,
    remaining: Math.max(0, policy.limit - row.count),
    retryAfterSeconds,
  }
}

export async function pruneExpiredRateLimits(): Promise<number> {
  const result = await queryDatabase('delete from rate_limit_buckets where expires_at < now() - interval \'1 hour\'')
  return result.rowCount || 0
}
