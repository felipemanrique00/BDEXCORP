'use client'

import {
  voucherPresentationConfigurationSchema,
  voucherPresentationPatchSchema,
  voucherPresentationScopeIdSchema,
  voucherPresentationScopeTypeSchema,
  type VoucherPresentationConfiguration,
  type VoucherPresentationPatch,
  type VoucherPresentationScopeType,
} from '@/lib/vouchers/presentation'

export async function getVoucherPresentationSettings(
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
  signal?: AbortSignal,
): Promise<VoucherPresentationConfiguration> {
  const endpoint = presentationEndpoint(scopeType, scopeId)
  const response = await fetch(endpoint, { cache: 'no-store', signal })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.configuration) {
    throw new Error(result?.error || 'Nao foi possivel carregar a configuracao do voucher.')
  }
  return voucherPresentationConfigurationSchema.parse(result.configuration)
}

export async function patchVoucherPresentationSettings(
  scopeType: VoucherPresentationScopeType,
  scopeId: string,
  patch: VoucherPresentationPatch,
): Promise<VoucherPresentationConfiguration> {
  const endpoint = presentationEndpoint(scopeType, scopeId)
  const payload = voucherPresentationPatchSchema.parse(patch)
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.configuration) {
    throw new Error(result?.error || 'Nao foi possivel salvar a configuracao do voucher.')
  }
  return voucherPresentationConfigurationSchema.parse(result.configuration)
}

function presentationEndpoint(
  rawScopeType: VoucherPresentationScopeType,
  rawScopeId: string,
): string {
  const scopeType = voucherPresentationScopeTypeSchema.parse(rawScopeType)
  const scopeId = voucherPresentationScopeIdSchema.parse(rawScopeId)
  return `/api/voucher-presentation-settings/${scopeType}/${encodeURIComponent(scopeId)}`
}
