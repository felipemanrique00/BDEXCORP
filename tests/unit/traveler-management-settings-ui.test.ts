import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(
  resolve(process.cwd(), 'components/travelers/traveler-management-settings-panel.tsx'),
  'utf8',
)
const companyPageSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/empresas/[id]/page.tsx'),
  'utf8',
)
const groupPageSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/grupos/page.tsx'),
  'utf8',
)

describe('traveler management settings UI', () => {
  it('loads and saves the inherited configuration with optimistic concurrency', () => {
    expect(panelSource).toContain("getTravelerManagementSettings(scopeType, scopeId, controller.signal)")
    expect(panelSource).toContain('patchTravelerManagementSettings(scopeType, scopeId, {')
    expect(panelSource).toContain('expectedVersion: currentConfiguration.version')
    expect(panelSource).toContain('allowRequesterTravelerManagement: nextValue')
    expect(panelSource).toContain('activeScopeRef.current !== scopeKey')
  })

  it('explains the requester rule, agency bypass and effective inheritance', () => {
    expect(panelSource).toContain('Cadastro pelo solicitante')
    expect(panelSource).toContain('A equipe interna da agência permanece habilitada independentemente desta regra.')
    expect(panelSource).toContain('Permitir cadastro e conclusão de dados')
    expect(panelSource).toContain('Bloquear cadastro no portal')
    expect(panelSource).toContain('Herdar do grupo')
    expect(panelSource).toContain('Usar padrão do sistema')
    expect(panelSource).toContain('Resultado efetivo:')
    expect(panelSource).toContain('Restaurar herança')
  })

  it('keeps read-only users informed without exposing mutation controls', () => {
    expect(panelSource).toContain('disabled={!canManage || saving}')
    expect(panelSource).toContain('Configuração somente para consulta.')
    expect(panelSource).toContain('É necessária a permissão de alterar configurações.')
  })

  it('wires the company override into the employees tab', () => {
    expect(companyPageSource).toContain(
      "import { TravelerManagementSettingsPanel } from '@/components/travelers/traveler-management-settings-panel'",
    )
    expect(companyPageSource).toContain("const canManageTravelerSettings = includesCompany(id, 'alterar_configuracoes')")
    expect(companyPageSource).toContain("scopeType=\"company\"")
    expect(companyPageSource).toContain('canManage={canManageTravelerSettings}')
    expect(companyPageSource.indexOf('<TravelerManagementSettingsPanel')).toBeLessThan(
      companyPageSource.indexOf('<FuncionariosTab'),
    )
  })

  it('wires the group default with full-scope read and management permissions', () => {
    expect(groupPageSource).toContain(
      "import { TravelerManagementSettingsPanel } from '@/components/travelers/traveler-management-settings-panel'",
    )
    expect(groupPageSource).toContain("'ver_funcionarios'")
    expect(groupPageSource).toContain("'alterar_configuracoes'")
    expect(groupPageSource).toContain('grupoSelecionado && podeVerViajantesGrupo')
    expect(groupPageSource).toContain("scopeType=\"group\"")
    expect(groupPageSource).toContain('canManage={podeAlterarViajantesGrupo}')
    expect(groupPageSource).toContain('compact')
  })
})
