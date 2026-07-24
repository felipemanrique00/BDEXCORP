import type { RequestPrincipal } from '@/lib/server/request-context'

export function requiresAdministrativeMfa(principal: RequestPrincipal): boolean {
  const permissions = principal.user.permissoes
  return principal.platformAdmin ||
    principal.roleKey === 'tenant_admin' ||
    Boolean(
      permissions?.gerenciar_usuarios ||
      permissions?.gerenciar_vinculos_acesso ||
      permissions?.alterar_configuracoes ||
      permissions?.publicar_politicas ||
      permissions?.gerenciar_workflows ||
      permissions?.gerenciar_integracoes ||
      permissions?.gerenciar_ia ||
      permissions?.gerenciar_automacoes,
    )
}
