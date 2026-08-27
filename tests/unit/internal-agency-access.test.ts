import { describe, expect, it } from 'vitest'

import {
  AGENCY_CONSULTANT_PRESET_LABEL,
  createAgencyConsultantPreset,
  internalAgencyScopePayload,
  isAgencyConsultantPreset,
  isInternalAgencyScopeReady,
  resolveInternalAgencyScopeMode,
} from '@/lib/internal-agency-access'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

describe('agency consultant full-service preset', () => {
  it('keeps the Agent base and persists only the capabilities added by the preset', () => {
    const preset = createAgencyConsultantPreset(PERMISSOES_PADRAO_POR_PERFIL.agente)

    expect(preset.label).toBe(AGENCY_CONSULTANT_PRESET_LABEL)
    expect(preset.profile).toBe('agente')
    expect(preset.customPermissions).toBe(true)
    expect(preset.permissionOverrides).toEqual({
      gerenciar_personificacoes: true,
      ver_produtividade_todos: true,
      decidir_aprovacoes: true,
    })
    expect(preset.permissions).toMatchObject({
      criar_demandas: true,
      operar_cotacoes: true,
      operar_reservas: true,
      operar_emissoes: true,
      operar_cancelamentos: true,
      gerenciar_personificacoes: true,
      decidir_aprovacoes: true,
      ver_produtividade_todos: true,
    })
    expect(isAgencyConsultantPreset(preset.profile, preset.permissions)).toBe(true)
  })

  it('uses the authoritative tenant base and adds a sparse override when an operational capability is missing', () => {
    const base = {
      ...PERMISSOES_PADRAO_POR_PERFIL.agente,
      operar_emissoes: false,
    }
    const preset = createAgencyConsultantPreset(base)

    expect(preset.permissions.operar_emissoes).toBe(true)
    expect(preset.permissionOverrides.operar_emissoes).toBe(true)
    expect(base.operar_emissoes).toBe(false)
  })
})

describe('internal agency company scope', () => {
  it('serializes all current and future companies as an intentionally empty explicit scope', () => {
    expect(internalAgencyScopePayload('all', ['company-a'], ['group-a'])).toEqual({
      companyIds: [],
      groupIds: [],
    })
    expect(resolveInternalAgencyScopeMode([], [])).toBe('all')
    expect(isInternalAgencyScopeReady('all', [], [])).toBe(true)
  })

  it('requires and normalizes an explicit selection in restricted mode', () => {
    expect(isInternalAgencyScopeReady('selected', [], [])).toBe(false)
    expect(internalAgencyScopePayload(
      'selected',
      [' company-a ', 'company-a', ''],
      ['group-a', 'group-a'],
    )).toEqual({
      companyIds: ['company-a'],
      groupIds: ['group-a'],
    })
    expect(resolveInternalAgencyScopeMode(['company-a'], [])).toBe('selected')
  })
})
