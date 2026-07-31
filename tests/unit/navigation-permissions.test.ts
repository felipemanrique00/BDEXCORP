import { describe, expect, it } from 'vitest'

import { buildSidebarMenu } from '@/lib/navigation'
import {
  PERMISSOES_PADRAO_POR_PERFIL,
  type PerfilBBT,
  type Permissoes,
  type User,
} from '@/types'

function corporateUser(permissions: Partial<Permissoes>): User {
  const denied = Object.fromEntries(
    Object.keys(PERMISSOES_PADRAO_POR_PERFIL.agente).map((permission) => [permission, false]),
  ) as unknown as Permissoes
  return {
    id: 'user-1',
    email: 'pessoa@empresa.test',
    name: 'Pessoa Autorizada',
    role: 'company_admin',
    company_id: 'company-1',
    corporate_profile: 'viewer',
    ativo: true,
    permissoes: {
      ...denied,
      ...permissions,
    },
  }
}

function internalUser(profile: PerfilBBT, overrides: Partial<Permissoes> = {}): User {
  const roleKeys: Record<PerfilBBT, string> = {
    lider: 'tenant_admin',
    supervisor: 'supervisor',
    agente: 'agent',
    gestor_financeiro: 'financial_manager',
    operacional: 'operator',
  }
  return {
    id: `internal-${profile}`,
    email: `${profile}@test.invalid`,
    name: profile,
    role: 'master',
    role_key: roleKeys[profile],
    company_id: null,
    perfil_bbt: profile,
    ativo: true,
    permissoes: {
      ...PERMISSOES_PADRAO_POR_PERFIL[profile],
      ...overrides,
    },
  }
}

function visibleRoutes(user: User): string[] {
  return buildSidebarMenu({ user, naoLidas: 0, novasDemandas: 0, alertasHoje: 0 })
    .flatMap((group) => group.itens)
    .filter((item) => !item.hidden)
    .map((item) => item.href)
}

describe('menu por permissao efetiva', () => {
  it('nao esconde relatorios e portal apenas porque o usuario nao e master', () => {
    const routes = visibleRoutes(corporateUser({
      ver_empresas: true,
      ver_relatorios: true,
      gerar_relatorios: true,
    }))

    expect(routes).toContain('/dashboard/portal-empresa')
    expect(routes).toContain('/dashboard/relatorios')
    expect(routes).not.toContain('/dashboard/usuarios')
    expect(routes).not.toContain('/dashboard/financeiro')
  })

  it('exibe aprovacoes para o aprovador corporativo sem elevar o papel para master', () => {
    const user = corporateUser({ ver_empresas: true, ver_aprovacoes: true, decidir_aprovacoes: true })
    const routes = visibleRoutes(user)

    expect(user.role).toBe('company_admin')
    expect(routes).toContain('/dashboard/aprovacoes')
    expect(routes).not.toContain('/dashboard/plataforma')
  })

  it('nao concede modulos pelo nome do perfil corporativo', () => {
    const user = corporateUser({})
    user.corporate_profile = 'owner'
    const routes = visibleRoutes(user)

    expect(routes).not.toContain('/dashboard/financeiro')
    expect(routes).not.toContain('/dashboard/usuarios')
    expect(routes).not.toContain('/dashboard/grupos')
  })

  it('exibe o portal pessoal somente com a permissao especifica', () => {
    expect(visibleRoutes(corporateUser({ acessar_portal_viajante: true })))
      .toContain('/dashboard/minha-viagem')
    expect(visibleRoutes(corporateUser({ acessar_portal_viajante: false })))
      .not.toContain('/dashboard/minha-viagem')
  })

  it.each([
    'lider',
    'supervisor',
    'agente',
    'gestor_financeiro',
    'operacional',
  ] as PerfilBBT[])('mantem a consulta de empresas visivel para o perfil interno %s', (profile) => {
    expect(visibleRoutes(internalUser(profile))).toContain('/dashboard/empresas')
  })

  it('restringe administracao de usuarios e grupos aos perfis com a permissao correspondente', () => {
    expect(visibleRoutes(internalUser('lider'))).toEqual(expect.arrayContaining([
      '/dashboard/usuarios',
      '/dashboard/grupos',
    ]))

    for (const profile of ['supervisor', 'agente', 'gestor_financeiro', 'operacional'] as PerfilBBT[]) {
      expect(visibleRoutes(internalUser(profile))).not.toContain('/dashboard/usuarios')
      expect(visibleRoutes(internalUser(profile))).not.toContain('/dashboard/grupos')
    }
  })

  it('nao transforma uma permissao interna isolada em administracao integral do tenant', () => {
    expect(visibleRoutes(internalUser('supervisor', { gerenciar_usuarios: true })))
      .not.toContain('/dashboard/usuarios')
    expect(visibleRoutes(internalUser('operacional', { gerenciar_vinculos_acesso: true })))
      .not.toContain('/dashboard/usuarios')
    expect(visibleRoutes(internalUser('supervisor', {
      gerenciar_usuarios: true,
      gerenciar_vinculos_acesso: true,
    }))).toContain('/dashboard/usuarios')
  })

  it.each([
    'lider',
    'supervisor',
    'gestor_financeiro',
  ] as PerfilBBT[])('exibe auditoria para o perfil interno autorizado %s', (profile) => {
    expect(visibleRoutes(internalUser(profile))).toContain('/dashboard/auditoria')
  })

  it.each([
    'agente',
    'operacional',
  ] as PerfilBBT[])('oculta auditoria do perfil interno sem permissao %s', (profile) => {
    expect(visibleRoutes(internalUser(profile))).not.toContain('/dashboard/auditoria')
  })

  it('respeita concessao e revogacao personalizadas de auditoria somente na equipe interna', () => {
    expect(visibleRoutes(internalUser('supervisor', { ver_auditoria: false })))
      .not.toContain('/dashboard/auditoria')
    expect(visibleRoutes(internalUser('operacional', { ver_auditoria: true })))
      .toContain('/dashboard/auditoria')
    expect(visibleRoutes(corporateUser({ ver_auditoria: true })))
      .not.toContain('/dashboard/auditoria')
  })

  it('nao usa gerenciar_usuarios para reabrir financeiro ou importacoes revogados', () => {
    const routes = visibleRoutes(internalUser('lider', {
      ver_financeiro: false,
      importar_planilhas: false,
    }))

    expect(routes.filter((route) => route.startsWith('/dashboard/financeiro'))).toEqual([])
    expect(routes).not.toContain('/dashboard/wintour')
    expect(routes).not.toContain('/dashboard/importar')
  })
})
