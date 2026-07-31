import { z } from 'zod'

const companyIdSchema = z.string().trim().min(1).max(200)

export const companyIdsQuerySchema = z.preprocess(
  (value) => typeof value === 'string'
    ? value.split(',').map((companyId) => companyId.trim()).filter(Boolean)
    : value,
  z.array(companyIdSchema).min(1).max(100).transform((companyIds) => [...new Set(companyIds)]),
)

export function appendCompanyIdsQuery(
  query: URLSearchParams,
  companyIds: readonly string[] | null | undefined,
): void {
  if (companyIds?.length) query.set('companyIds', [...new Set(companyIds)].join(','))
}
