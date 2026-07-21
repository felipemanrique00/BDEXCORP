import 'server-only'

import { empresasPermitidasParaUsuario } from '@/lib/grupos'
import { hasServerPermission } from '@/lib/security/api-guard'
import { getStorageEntries } from '@/lib/server-db'
import type { FileEntityType, FileLinkInput } from '@/lib/server/file-storage'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Atendimento, Empresa, Funcionario, GrupoEmpresarial } from '@/types'

export class FileAccessDeniedError extends Error {
  constructor() {
    super('Acesso ao arquivo nao autorizado.')
  }
}

export async function assertFileEntityAccess(
  principal: RequestPrincipal,
  link: FileLinkInput,
): Promise<void> {
  const entries = await getStorageEntries(principal.tenantId)
  const persisted = asRecord(entries['bbt-data-v4'])
  const state = asRecord(persisted.state || persisted)
  const companies = arrayOf<Empresa>(state.empresas)
  const groups = arrayOf<GrupoEmpresarial>(state.gruposEmpresariais)
  const allowedCompanyIds = new Set(
    empresasPermitidasParaUsuario(principal.user, companies, groups).map((company) => company.id),
  )
  if (link.entityType === 'import') {
    if (hasServerPermission(principal.user, 'importar_planilhas')) return
    throw new FileAccessDeniedError()
  }
  const companyId = resolveCompanyId(link.entityType, link.entityId, state, entries)
  if (companyId && allowedCompanyIds.has(companyId)) return
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
  if (principal.user.role === 'master' || principal.user.role === 'company_admin') return
  if (link.entityType === 'company' && hasServerPermission(principal.user, 'cadastrar_empresas')) return
  if (link.entityType === 'employee' && hasServerPermission(principal.user, 'cadastrar_funcionarios')) return
  throw new FileAccessDeniedError()
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
