import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

import { PdfUploadValidationError, validatePdfUpload } from '@/lib/security/pdf-upload'
import { getServerEnvironment } from '@/lib/server/environment'
import { withTenantTransaction } from '@/lib/server/database'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'

export const FILE_ENTITY_TYPES = ['demand', 'employee', 'company', 'voucher', 'import'] as const
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number]

export interface FileLinkInput {
  entityType: FileEntityType
  entityId: string
}

export interface StoredFileRecord {
  id: string
  purpose: string
  originalName: string
  mimeType: string
  sizeBytes: number
  description: string | null
  createdAt: string
  downloadUrl: string
}

interface StoredFileRow {
  id: string
  purpose: string
  original_name: string
  storage_key: string
  mime_type: string
  size_bytes: string | number
  description: string | null
  created_at: Date
}

export class FileValidationError extends PdfUploadValidationError {}
export class FileQuotaExceededError extends Error {}
export class StoredFileNotFoundError extends Error {}

export interface StagedTenantStorage {
  cleanupPending: boolean
  restore: () => Promise<void>
  purge: () => Promise<boolean>
}

export async function stageTenantStorageForReset(tenantId: string): Promise<StagedTenantStorage> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('Tenant invalido para limpeza de arquivos.')
  const root = resolve(getServerEnvironment().STORAGE_ROOT)
  const tenantPath = resolve(root, tenantId)
  const trashRoot = resolve(root, '.trash')
  const stagedPath = resolve(trashRoot, `${tenantId}-${randomUUID()}`)
  try {
    await stat(tenantPath)
  } catch {
    return { cleanupPending: false, restore: async () => undefined, purge: async () => true }
  }
  await mkdir(trashRoot, { recursive: true, mode: 0o700 })
  await rename(tenantPath, stagedPath)
  return {
    cleanupPending: true,
    restore: async () => {
      await mkdir(dirname(tenantPath), { recursive: true, mode: 0o700 })
      await rename(stagedPath, tenantPath)
    },
    purge: async () => {
      try {
        await rm(stagedPath, { recursive: true, force: true })
        return true
      } catch {
        return false
      }
    },
  }
}

export async function createStoredPdf(args: {
  principal: RequestPrincipal
  bytes: Buffer
  originalName: string
  description?: string | null
  links: FileLinkInput[]
}): Promise<StoredFileRecord> {
  const environment = getServerEnvironment()
  try {
    validatePdfUpload(args.bytes, args.originalName, environment.MAX_UPLOAD_BYTES)
  } catch (error) {
    if (error instanceof PdfUploadValidationError) throw new FileValidationError(error.message)
    throw error
  }
  const links = normalizeLinks(args.links)
  if (!links.length) throw new FileValidationError('O arquivo precisa estar vinculado a um registro.')
  const purpose = `${links[0].entityType}_pdf`

  const fileId = randomUUID()
  const now = new Date()
  const storageKey = [
    args.principal.tenantId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${fileId}.pdf`,
  ].join('/')
  const originalName = safeOriginalName(args.originalName)
  const sha256 = createHash('sha256').update(args.bytes).digest('hex')
  const description = args.description?.trim().slice(0, 500) || null
  let persisted = false

  try {
    const row = await withTenantTransaction(args.principal.tenantId, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('tenant-file-quota'), hashtext($1))", [args.principal.tenantId])
      if (args.principal.limits.storageBytes) {
        const usage = await client.query<{ bytes: string }>(
          `select (
             coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0) +
             coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0)
           )::bigint as bytes`,
          [args.principal.tenantId],
        )
        const projected = Number(usage.rows[0]?.bytes || 0) + args.bytes.length
        if (projected > args.principal.limits.storageBytes) {
          throw new FileQuotaExceededError('Limite de armazenamento do plano atingido.')
        }
      }

      await writePrivateObject(storageKey, args.bytes)
      persisted = true
      const inserted = await client.query<StoredFileRow>(
        `insert into stored_files (
           id, tenant_id, uploaded_by, purpose, entity_type, entity_id, original_name,
           storage_key, mime_type, size_bytes, sha256, description
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'application/pdf', $9, $10, $11)
         returning id, purpose, original_name, storage_key, mime_type, size_bytes, description, created_at`,
        [
          fileId,
          args.principal.tenantId,
          args.principal.user.id,
          purpose,
          links[0].entityType,
          links[0].entityId,
          originalName,
          storageKey,
          args.bytes.length,
          sha256,
          description,
        ],
      )
      for (const link of links) {
        await client.query(
          `insert into stored_file_links (tenant_id, file_id, entity_type, entity_id)
           values ($1, $2, $3, $4) on conflict do nothing`,
          [args.principal.tenantId, fileId, link.entityType, link.entityId],
        )
      }
      return inserted.rows[0]
    })
    return mapStoredFile(row)
  } catch (error) {
    if (persisted) {
      try {
        await removePrivateObject(storageKey)
      } catch (cleanupError) {
        logError('stored_file_cleanup_failed', cleanupError, {
          errorCode: 'STORED_FILE_CLEANUP_FAILED',
          tenantId: args.principal.tenantId,
          storageKey,
        })
      }
    }
    throw error
  }
}

export async function listStoredFiles(
  principal: RequestPrincipal,
  link: FileLinkInput,
): Promise<StoredFileRecord[]> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<StoredFileRow>(
      `select f.id, f.purpose, f.original_name, f.storage_key, f.mime_type,
         f.size_bytes, f.description, f.created_at
       from stored_file_links l
       join stored_files f on f.tenant_id = l.tenant_id and f.id = l.file_id
       where l.tenant_id = $1 and l.entity_type = $2 and l.entity_id = $3 and f.status = 'active'
       order by f.created_at desc`,
      [principal.tenantId, link.entityType, link.entityId],
    )
    return result.rows.map(mapStoredFile)
  })
}

export async function readStoredFile(
  principal: RequestPrincipal,
  fileId: string,
): Promise<{ record: StoredFileRecord; bytes: Buffer; links: FileLinkInput[] }> {
  const metadata = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<StoredFileRow>(
      `select id, purpose, original_name, storage_key, mime_type, size_bytes, description, created_at
       from stored_files where tenant_id = $1 and id = $2 and status = 'active' limit 1`,
      [principal.tenantId, fileId],
    )
    const row = result.rows[0]
    if (!row) throw new StoredFileNotFoundError('Arquivo nao encontrado.')
    const linksResult = await client.query<{ entity_type: FileEntityType; entity_id: string }>(
      'select entity_type, entity_id from stored_file_links where tenant_id = $1 and file_id = $2',
      [principal.tenantId, fileId],
    )
    return {
      row,
      links: linksResult.rows.map((link) => ({ entityType: link.entity_type, entityId: link.entity_id })),
    }
  })
  return {
    record: mapStoredFile(metadata.row),
    bytes: await readPrivateObject(metadata.row.storage_key),
    links: metadata.links,
  }
}

export async function deleteStoredFile(principal: RequestPrincipal, fileId: string): Promise<void> {
  const storageKey = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ storage_key: string }>(
      `update stored_files set status = 'deleted', deleted_at = now()
       where tenant_id = $1 and id = $2 and status = 'active'
       returning storage_key`,
      [principal.tenantId, fileId],
    )
    if (!result.rows[0]) throw new StoredFileNotFoundError('Arquivo nao encontrado.')
    return result.rows[0].storage_key
  })
  await removePrivateObject(storageKey)
}

function mapStoredFile(row: StoredFileRow): StoredFileRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    description: row.description,
    createdAt: row.created_at.toISOString(),
    downloadUrl: `/api/files/${row.id}/download`,
  }
}

function normalizeLinks(links: FileLinkInput[]): FileLinkInput[] {
  const unique = new Map<string, FileLinkInput>()
  for (const link of links) {
    const entityId = link.entityId.trim().slice(0, 200)
    if (!FILE_ENTITY_TYPES.includes(link.entityType) || !entityId) continue
    unique.set(`${link.entityType}:${entityId}`, { entityType: link.entityType, entityId })
  }
  return Array.from(unique.values()).slice(0, 5)
}

function safeOriginalName(value: string): string {
  const clean = basename(value).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  return clean || 'documento.pdf'
}

async function writePrivateObject(storageKey: string, bytes: Buffer): Promise<void> {
  const path = privateObjectPath(storageKey)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
}

async function readPrivateObject(storageKey: string): Promise<Buffer> {
  return readFile(privateObjectPath(storageKey))
}

async function removePrivateObject(storageKey: string): Promise<void> {
  await rm(privateObjectPath(storageKey), { force: true })
}

function privateObjectPath(storageKey: string): string {
  const root = resolve(getServerEnvironment().STORAGE_ROOT)
  const target = resolve(root, ...storageKey.split('/'))
  const relation = relative(root, target)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error('Chave de armazenamento invalida.')
  return target
}
