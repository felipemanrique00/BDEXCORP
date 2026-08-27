import { permissionOverridesFromEffective } from '@/lib/permission-overrides'
import type { PerfilBBT, Permissoes } from '@/types'

export const AGENCY_CONSULTANT_PRESET_ID = 'agency_consultant_full_service' as const
export const AGENCY_CONSULTANT_PRESET_LABEL = 'Consultor — atendimento completo'

export type InternalAgencyScopeMode = 'all' | 'selected'

const CONSULTANT_REQUIRED_PERMISSIONS = [
  'ver_produtividade_todos',
  'ver_empresas',
  'ver_centros_custo',
  'ver_funcionarios',
  'ver_solicitantes',
  'criar_demandas',
  'ver_demandas',
  'ver_reservas',
  'ver_emissoes',
  'ver_vouchers',
  'operar_cotacoes',
  'operar_reservas',
  'operar_emissoes',
  'operar_cancelamentos',
  'ver_politicas',
  'ver_aprovacoes',
  'decidir_aprovacoes',
  'gerenciar_personificacoes',
] as const satisfies readonly (keyof Permissoes)[]

export const AGENCY_CONSULTANT_DIRECT_CAPABILITIES = [
  'Abrir demandas com solicitante e viajante da empresa',
  'Preparar e ajustar cotações',
  'Reservar, emitir, cancelar e enviar vouchers',
  'Consultar a produtividade da equipe',
] as const

export const AGENCY_CONSULTANT_ASSISTED_CAPABILITIES = [
  'Escolher a cotação como o solicitante responsável',
  'Decidir como o autorizador corporativo atribuído',
] as const

export interface AgencyConsultantPreset {
  id: typeof AGENCY_CONSULTANT_PRESET_ID
  label: typeof AGENCY_CONSULTANT_PRESET_LABEL
  profile: Extract<PerfilBBT, 'agente'>
  customPermissions: true
  permissions: Permissoes
  permissionOverrides: Partial<Permissoes>
}

export function createAgencyConsultantPreset(base: Permissoes): AgencyConsultantPreset {
  const permissions = { ...base }
  for (const permission of CONSULTANT_REQUIRED_PERMISSIONS) permissions[permission] = true

  return {
    id: AGENCY_CONSULTANT_PRESET_ID,
    label: AGENCY_CONSULTANT_PRESET_LABEL,
    profile: 'agente',
    customPermissions: true,
    permissions,
    permissionOverrides: permissionOverridesFromEffective(base, permissions),
  }
}

export function isAgencyConsultantPreset(
  profile: PerfilBBT,
  permissions: Permissoes,
): boolean {
  return profile === 'agente'
    && CONSULTANT_REQUIRED_PERMISSIONS.every((permission) => permissions[permission] === true)
}

export function resolveInternalAgencyScopeMode(
  companyIds: readonly string[] | null | undefined,
  groupIds: readonly string[] | null | undefined,
): InternalAgencyScopeMode {
  return companyIds?.length || groupIds?.length ? 'selected' : 'all'
}

export function internalAgencyScopePayload(
  mode: InternalAgencyScopeMode,
  companyIds: readonly string[],
  groupIds: readonly string[],
): { companyIds: string[]; groupIds: string[] } {
  if (mode === 'all') return { companyIds: [], groupIds: [] }
  return {
    companyIds: uniqueIds(companyIds),
    groupIds: uniqueIds(groupIds),
  }
}

export function isInternalAgencyScopeReady(
  mode: InternalAgencyScopeMode,
  companyIds: readonly string[],
  groupIds: readonly string[],
): boolean {
  if (mode === 'all') return true
  const payload = internalAgencyScopePayload(mode, companyIds, groupIds)
  return payload.companyIds.length > 0 || payload.groupIds.length > 0
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
