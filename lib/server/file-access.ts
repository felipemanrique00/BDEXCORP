import 'server-only'

import { guardApiRequest, hasServerPermission } from '@/lib/security/api-guard'
import { getStorageEntries } from '@/lib/server-db'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import type { FileEntityType, FileLinkInput } from '@/lib/server/file-storage'
import type { RateLimitPolicy } from '@/lib/server/rate-limit'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Atendimento, Funcionario, Permissoes } from '@/types'

export class FileAccessDeniedError extends Error {
  constructor() {
    super('Acesso ao arquivo nao autorizado.')
  }
}

export function guardFileEntityRequest(request: Request, rateLimit: RateLimitPolicy) {
  return guardApiRequest(request, {
    requireAuth: true,
    authorization: {
      action: 'read',
      resource: 'session',
    },
    rateLimit,
  })
}

export async function assertFileEntityAccess(
  principal: RequestPrincipal,
  link: FileLinkInput,
): Promise<void> {
  if (link.entityType === 'import') {
    if (hasServerPermission(principal.user, 'importar_planilhas')) return
    throw new FileAccessDeniedError()
  }
  const entries = await getStorageEntries(principal.tenantId)
  const persisted = asRecord(entries['bbt-data-v4'])
  const state = asRecord(persisted.state || persisted)
  const companyId = resolveCompanyId(link.entityType, link.entityId, state, entries)
  const permission = fileReadPermission(link.entityType)
  if (companyId) {
    try {
      await requireCompanyAccess(principal, companyId, permission)
      return
    } catch {
      // The public error below intentionally does not reveal whether the entity exists.
    }
  }
  throw new FileAccessDeniedError()
}

export async function assertStoredFileAccess(
  principal: RequestPrincipal,
  links: FileLinkInput[],
): Promise<void> {
  for (const link of links) {
    try {
      await assertFileEntityAccess(principal, link)
      return
    } catch (error) {
      if (!(error instanceof FileAccessDeniedError)) throw error
    }
  }
  throw new FileAccessDeniedError()
}

export async function assertFileEntityMutationAccess(
  principal: RequestPrincipal,
  link: FileLinkInput,
): Promise<void> {
  await assertFileEntityAccess(principal, link)
  if (link.entityType === 'import') return
  const entries = await getStorageEntries(principal.tenantId)
  const persisted = asRecord(entries['bbt-data-v4'])
  const state = asRecord(persisted.state || persisted)
  const companyId = resolveCompanyId(link.entityType, link.entityId, state, entries)
  if (companyId) {
    try {
      await requireCompanyAccess(principal, companyId, fileMutationPermission(link.entityType))
      return
    } catch {
      // Use the same public error for missing entities and denied mutations.
    }
  }
  throw new FileAccessDeniedError()
}

function fileReadPermission(entityType: FileEntityType): keyof Permissoes {
  if (entityType === 'employee') return 'ver_funcionarios'
  if (entityType === 'demand') return 'ver_demandas'
  if (entityType === 'voucher') return 'ver_vouchers'
  return 'ver_empresas'
}

function fileMutationPermission(entityType: FileEntityType): keyof Permissoes {
  if (entityType === 'employee') return 'gerenciar_funcionarios'
  if (entityType === 'demand') return 'criar_demandas'
  if (entityType === 'voucher') return 'ver_vouchers'
  return 'alterar_configuracoes'
}

export async function assertStoredFileMutationAccess(
  principal: RequestPrincipal,
  links: FileLinkInput[],
): Promise<void> {
  for (const link of links) {
    try {
      await assertFileEntityMutationAccess(principal, link)
      return
    } catch (error) {
      if (!(error instanceof FileAccessDeniedError)) throw error
    }
  }
  throw new FileAccessDeniedError()
}

function resolveCompanyId(
  entityType: FileEntityType,
  entityId: string,
  state: Record<string, unknown>,
  entries: Record<string, unknown>,
): string | null {
  if (entityType === 'company') return entityId
  if (entityType === 'employee') {
    return arrayOf<Funcionario>(state.funcionarios).find((employee) => employee.id === entityId)?.company_id || null
  }
  if (entityType === 'demand') {
    return arrayOf<Atendimento>(entries['bbt-atendimentos']).find((demand) => demand.id === entityId)?.empresa_id || null
  }
  if (entityType === 'voucher') {
    const voucher = arrayOf<{ id: string; empresa_id?: string }>(entries['bbt-vouchers-emitidos'])
      .find((item) => item.id === entityId)
    return voucher?.empresa_id || null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}
