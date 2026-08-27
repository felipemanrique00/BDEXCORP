'use client'

import {
  travelerManagementConfigurationSchema,
  travelerManagementPatchSchema,
  travelerManagementScopeIdSchema,
  travelerManagementScopeTypeSchema,
  type TravelerManagementConfiguration,
  type TravelerManagementPatch,
  type TravelerManagementScopeType,
} from '@/lib/travelers/management-settings'

export async function getTravelerManagementSettings(
  scopeType: TravelerManagementScopeType,
  scopeId: string,
  signal?: AbortSignal,
): Promise<TravelerManagementConfiguration> {
  const response = await fetch(managementSettingsEndpoint(scopeType, scopeId), {
    cache: 'no-store',
    signal,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.configuration) {
    throw new Error(result?.error || 'Nao foi possivel carregar a configuracao de viajantes.')
  }
  return travelerManagementConfigurationSchema.parse(result.configuration)
}

export async function patchTravelerManagementSettings(
  scopeType: TravelerManagementScopeType,
  scopeId: string,
  patch: TravelerManagementPatch,
): Promise<TravelerManagementConfiguration> {
  const payload = travelerManagementPatchSchema.parse(patch)
  const response = await fetch(managementSettingsEndpoint(scopeType, scopeId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.configuration) {
    throw new Error(result?.error || 'Nao foi possivel salvar a configuracao de viajantes.')
  }
  return travelerManagementConfigurationSchema.parse(result.configuration)
}

function managementSettingsEndpoint(
  rawScopeType: TravelerManagementScopeType,
  rawScopeId: string,
): string {
  const scopeType = travelerManagementScopeTypeSchema.parse(rawScopeType)
  const scopeId = travelerManagementScopeIdSchema.parse(rawScopeId)
  return `/api/traveler-management-settings/${scopeType}/${encodeURIComponent(scopeId)}`
}
