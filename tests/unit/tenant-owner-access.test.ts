import { describe, expect, it } from 'vitest'

import {
  canDelegateTenantOwner,
  changesTenantOwnerMembership,
} from '@/lib/tenant-owner-access'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

describe('tenant owner delegation', () => {
  it('permite que um Dono ativo delegue outra membership de Dono', () => {
    expect(canDelegateTenantOwner({
      platformAdmin: false,
      roleKey: 'tenant_admin',
      permissions: PERMISSOES_PADRAO_POR_PERFIL.lider,
    })).toBe(true)
  })

  it('preserva a administracao global da plataforma sem transforma-la em requisito do tenant', () => {
    expect(canDelegateTenantOwner({
      platformAdmin: true,
      roleKey: 'operator',
      permissions: PERMISSOES_PADRAO_POR_PERFIL.operacional,
    })).toBe(true)
  })

  it.each(['supervisor', 'agent', 'operator', 'financial_manager', 'company_admin'])(
    'nao permite que %s promova outro usuario apenas por copiar permissoes de Dono',
    (roleKey) => {
      expect(canDelegateTenantOwner({
        platformAdmin: false,
        roleKey,
        permissions: PERMISSOES_PADRAO_POR_PERFIL.lider,
      })).toBe(false)
    },
  )

  it('exige as duas permissoes administrativas tambem do proprio Dono', () => {
    expect(canDelegateTenantOwner({
      platformAdmin: false,
      roleKey: 'tenant_admin',
      permissions: {
        gerenciar_usuarios: true,
        gerenciar_vinculos_acesso: false,
      },
    })).toBe(false)
  })

  it('protege tanto a promocao quanto a remocao do papel de Dono', () => {
    expect(changesTenantOwnerMembership('supervisor', 'tenant_admin')).toBe(true)
    expect(changesTenantOwnerMembership('tenant_admin', 'supervisor')).toBe(true)
    expect(changesTenantOwnerMembership('tenant_admin', 'tenant_admin')).toBe(true)
    expect(changesTenantOwnerMembership('supervisor', 'agent')).toBe(false)
  })
})
