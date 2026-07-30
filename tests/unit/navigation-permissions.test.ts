import { describe, expect, it } from 'vitest'

import { buildSidebarMenu } from '@/lib/navigation'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes, type User } from '@/types'

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
})
