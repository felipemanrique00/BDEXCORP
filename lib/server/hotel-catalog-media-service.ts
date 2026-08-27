import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

import type { PoolClient, QueryResultRow } from 'pg'
import { z } from 'zod'

import type { HotelCatalogMedia } from '@/lib/hotel-catalog/types'
import {
  BRANDING_IMAGE_MAX_BYTES,
  BRANDING_IMAGE_MAX_PIXELS,
  BrandingImageValidationError,
  validateBrandingImageEnvelope,
} from '@/lib/security/branding-image'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccessWithAnyPermission } from '@/lib/server/corporate-access-service'
import {
  resolveCompanyPortalScopeCompanyIdsWithAnyPermission,
  type CompanyPortalScope,
} from '@/lib/server/company-portal-scope-service'
import { withTenantTransaction } from '@/lib/server/database'
import { getServerEnvironment } from '@/lib/server/environment'
import { FileQuotaExceededError } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'

export const HOTEL_CATALOG_MEDIA_MAX_BYTES = BRANDING_IMAGE_MAX_BYTES
export const HOTEL_CATALOG_MEDIA_MAX_HOTEL_IMAGES = 12
export const HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES = 8

const hotelIdSchema = z.string().trim().min(1).max(200)
const mediaIdSchema = z.string().uuid()
const roomTypeIdSchema = z.string().uuid().nullable()
const altTextSchema = z.string().trim().min(1).max(240).nullable()

export const hotelCatalogMediaOrderSchema = z.object({
  roomTypeId: roomTypeIdSchema,
  orderedMediaIds: z.array(mediaIdSchema).max(HOTEL_CATALOG_MEDIA_MAX_HOTEL_IMAGES),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderedMediaIds).size !== value.orderedMediaIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['orderedMediaIds'],
      message: 'A ordem das fotos nao pode conter duplicidades.',
    })
  }
  if (value.roomTypeId && value.orderedMediaIds.length > HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES,
      type: 'array',
      inclusive: true,
      exact: false,
      path: ['orderedMediaIds'],
      message: `Cada quarto aceita no maximo ${HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES} fotos.`,
    })
  }
})

interface MediaRow extends QueryResultRow {
  id: string
  hotel_id: string
  room_type_id: string | null
  file_id: string
  alt_text: string | null
  sort_order: string | number
  original_name: string
  storage_key: string
  mime_type: string
  size_bytes: string | number
}

export class HotelCatalogMediaServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'HotelCatalogMediaServiceError'
  }
}

export async function uploadHotelCatalogMedia(args: {
  principal: RequestPrincipal
  rawHotelId: unknown
  rawRoomTypeId?: unknown
  rawAltText?: unknown
  bytes: Buffer
  originalName: string
  declaredMimeType?: string | null
}): Promise<HotelCatalogMedia> {
  const hotelId = hotelIdSchema.parse(args.rawHotelId)
  const roomTypeId = args.rawRoomTypeId === undefined || args.rawRoomTypeId === ''
    ? null
    : roomTypeIdSchema.parse(args.rawRoomTypeId)
  const altText = args.rawAltText === undefined || args.rawAltText === ''
    ? null
    : altTextSchema.parse(args.rawAltText)
  const normalized = await normalizeHotelMedia(args.bytes, args.originalName, args.declaredMimeType)
  const sha256 = createHash('sha256').update(normalized).digest('hex')
  const fileId = randomUUID()
  const mediaId = randomUUID()
  const now = new Date()
  const storageKey = [
    args.principal.tenantId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${fileId}.webp`,
  ].join('/')
  let persisted = false

  try {
    const media = await withTenantTransaction(args.principal.tenantId, async (client) => {
      await requireHotelScope(client, args.principal.tenantId, hotelId, roomTypeId)
      // Serializa uploads do tenant antes de limite, deduplicacao, ordem e quota.
      // Alem de proteger a quota, impede dois uploads concorrentes de ocuparem
      // simultaneamente a ultima posicao disponivel da mesma galeria.
      await client.query(
        "select pg_advisory_xact_lock(hashtext('tenant-file-quota'), hashtext($1))",
        [args.principal.tenantId],
      )
      const duplicate = await client.query<MediaRow>(
        `select media.id, media.hotel_id, media.room_type_id, media.file_id,
                media.alt_text, media.sort_order, file.original_name,
                file.storage_key, file.mime_type, file.size_bytes
           from hotel_catalog_media media
           join stored_files file
             on file.tenant_id = media.tenant_id and file.id = media.file_id
          where media.tenant_id = $1 and media.hotel_id = $2
            and media.room_type_id is not distinct from $3::uuid
            and media.deleted_at is null and file.status = 'active'
            and file.sha256 = $4
          order by media.created_at
          limit 1`,
        [args.principal.tenantId, hotelId, roomTypeId, sha256],
      )
      if (duplicate.rows[0]) return mapMedia(duplicate.rows[0])

      const limit = roomTypeId ? HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES : HOTEL_CATALOG_MEDIA_MAX_HOTEL_IMAGES
      const count = await client.query<{ total: string | number }>(
        `select count(*)::integer as total
           from hotel_catalog_media
          where tenant_id = $1 and hotel_id = $2
            and room_type_id is not distinct from $3::uuid
            and deleted_at is null`,
        [args.principal.tenantId, hotelId, roomTypeId],
      )
      if (Number(count.rows[0]?.total || 0) >= limit) {
        throw new HotelCatalogMediaServiceError(
          'HOTEL_MEDIA_LIMIT_REACHED',
          `Este ${roomTypeId ? 'quarto' : 'hotel'} aceita no maximo ${limit} fotos.`,
          422,
        )
      }
      if (args.principal.limits.storageBytes) {
        const usage = await client.query<{ bytes: string }>(
          `select (
             coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0) +
             coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0)
           )::bigint as bytes`,
          [args.principal.tenantId],
        )
        if (Number(usage.rows[0]?.bytes || 0) + normalized.length > args.principal.limits.storageBytes) {
          throw new FileQuotaExceededError('Limite de armazenamento do plano atingido.')
        }
      }

      const order = await client.query<{ next_order: string | number }>(
        `select coalesce(max(sort_order), -1) + 1 as next_order
           from hotel_catalog_media
          where tenant_id = $1 and hotel_id = $2
            and room_type_id is not distinct from $3::uuid
            and deleted_at is null`,
        [args.principal.tenantId, hotelId, roomTypeId],
      )
      await writePrivateObject(storageKey, normalized)
      persisted = true
      await client.query(
        `insert into stored_files (
           id, tenant_id, uploaded_by, purpose, entity_type, entity_id,
           original_name, storage_key, mime_type, size_bytes, sha256, description
         ) values (
           $1, $2, $3, 'hotel_catalog_media', 'hotel', $4,
           $5, $6, 'image/webp', $7, $8, $9
         )`,
        [
          fileId,
          args.principal.tenantId,
          args.principal.user.id,
          hotelId,
          safeImageName(args.originalName),
          storageKey,
          normalized.length,
          sha256,
          altText || (roomTypeId ? 'Foto de quarto do catalogo' : 'Foto de hotel do catalogo'),
        ],
      )
      const inserted = await client.query<MediaRow>(
        `insert into hotel_catalog_media (
           id, tenant_id, hotel_id, room_type_id, file_id, alt_text,
           sort_order, created_by, updated_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         returning id, hotel_id, room_type_id, file_id, alt_text, sort_order,
                   ''::text as original_name, ''::text as storage_key,
                   'image/webp'::text as mime_type, $9::bigint as size_bytes`,
        [
          mediaId,
          args.principal.tenantId,
          hotelId,
          roomTypeId,
          fileId,
          altText,
          Number(order.rows[0]?.next_order || 0),
          args.principal.user.id,
          normalized.length,
        ],
      )
      return mapMedia(inserted.rows[0])
    })
    await writeAuditEvent({
      action: 'hotel.catalog.media.uploaded',
      result: 'success',
      entityType: 'hotel_catalog_media',
      entityId: media.id,
      metadata: { hotelId, roomTypeId, sizeBytes: normalized.length, mimeType: 'image/webp' },
    })
    return media
  } catch (error) {
    if (persisted) await removePrivateObject(storageKey).catch((cleanupError) => {
      logError('hotel_catalog_media_cleanup_failed', cleanupError, {
        errorCode: 'HOTEL_CATALOG_MEDIA_CLEANUP_FAILED',
        tenantId: args.principal.tenantId,
        storageKey,
      })
    })
    throw error
  }
}

export async function reorderHotelCatalogMedia(
  principal: RequestPrincipal,
  rawHotelId: unknown,
  rawInput: unknown,
): Promise<HotelCatalogMedia[]> {
  const hotelId = hotelIdSchema.parse(rawHotelId)
  const input = hotelCatalogMediaOrderSchema.parse(rawInput)
  const items = await withTenantTransaction(principal.tenantId, async (client) => {
    await requireHotelScope(client, principal.tenantId, hotelId, input.roomTypeId)
    const current = await loadMediaScope(client, principal.tenantId, hotelId, input.roomTypeId, true)
    if (
      current.length !== input.orderedMediaIds.length
      || current.some((item) => !input.orderedMediaIds.includes(item.id))
    ) {
      throw new HotelCatalogMediaServiceError(
        'HOTEL_MEDIA_ORDER_STALE',
        'A galeria mudou. Atualize o cadastro antes de reordenar as fotos.',
        409,
      )
    }
    for (let index = 0; index < input.orderedMediaIds.length; index += 1) {
      await client.query(
        `update hotel_catalog_media
            set sort_order = $4, version = version + 1, updated_by = $5
          where tenant_id = $1 and hotel_id = $2 and id = $3 and deleted_at is null`,
        [principal.tenantId, hotelId, input.orderedMediaIds[index], index, principal.user.id],
      )
    }
    return loadMediaScope(client, principal.tenantId, hotelId, input.roomTypeId)
  })
  await writeAuditEvent({
    action: 'hotel.catalog.media.reordered',
    result: 'success',
    entityType: 'hotel',
    entityId: hotelId,
    metadata: { roomTypeId: input.roomTypeId, mediaIds: input.orderedMediaIds },
  })
  return items.map(mapMedia)
}

export async function deleteHotelCatalogMedia(
  principal: RequestPrincipal,
  rawHotelId: unknown,
  rawMediaId: unknown,
): Promise<void> {
  const hotelId = hotelIdSchema.parse(rawHotelId)
  const mediaId = mediaIdSchema.parse(rawMediaId)
  const storageKey = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<MediaRow>(
      `select media.id, media.hotel_id, media.room_type_id, media.file_id,
              media.alt_text, media.sort_order, file.original_name,
              file.storage_key, file.mime_type, file.size_bytes
         from hotel_catalog_media media
         join stored_files file
           on file.tenant_id = media.tenant_id and file.id = media.file_id
        where media.tenant_id = $1 and media.hotel_id = $2 and media.id = $3
          and media.deleted_at is null and file.status = 'active'
        for update of media, file`,
      [principal.tenantId, hotelId, mediaId],
    )
    const media = result.rows[0]
    if (!media) {
      const replay = await client.query<{ storage_key: string }>(
        `select file.storage_key
           from hotel_catalog_media media
           join stored_files file
             on file.tenant_id = media.tenant_id and file.id = media.file_id
          where media.tenant_id = $1 and media.hotel_id = $2 and media.id = $3
            and media.deleted_at is not null and file.status = 'deleted'
          limit 1`,
        [principal.tenantId, hotelId, mediaId],
      )
      if (replay.rows[0]?.storage_key) return replay.rows[0].storage_key
      throw notFound()
    }
    await client.query(
      `update hotel_catalog_media
          set deleted_at = now(), version = version + 1, updated_by = $4
        where tenant_id = $1 and hotel_id = $2 and id = $3 and deleted_at is null`,
      [principal.tenantId, hotelId, mediaId, principal.user.id],
    )
    await client.query(
      `update stored_files set status = 'deleted', deleted_at = now()
        where tenant_id = $1 and id = $2 and status = 'active'`,
      [principal.tenantId, media.file_id],
    )
    return media.storage_key
  })
  if (storageKey) await removePrivateObject(storageKey).catch((error) => {
    logError('hotel_catalog_media_remove_failed', error, {
      errorCode: 'HOTEL_CATALOG_MEDIA_REMOVE_FAILED',
      tenantId: principal.tenantId,
      mediaId,
    })
  })
  await writeAuditEvent({
    action: 'hotel.catalog.media.deleted',
    result: 'success',
    entityType: 'hotel_catalog_media',
    entityId: mediaId,
    metadata: { hotelId },
  })
}

export async function readHotelCatalogMedia(
  principal: RequestPrincipal,
  rawMediaId: unknown,
): Promise<{ bytes: Buffer; mimeType: string; sizeBytes: number; originalName: string }> {
  const mediaId = mediaIdSchema.parse(rawMediaId)
  const media = await withTenantTransaction(principal.tenantId, (client) => (
    loadReadableMedia(client, principal.tenantId, mediaId)
  ))
  return readMediaObject(media)
}

export async function readCompanyPortalHotelMedia(
  principal: RequestPrincipal,
  rawCompanyId: unknown,
  rawMediaId: unknown,
  scope: CompanyPortalScope = {},
): Promise<{ bytes: Buffer; mimeType: string; sizeBytes: number; originalName: string }> {
  const companyId = hotelIdSchema.parse(rawCompanyId)
  const mediaId = mediaIdSchema.parse(rawMediaId)
  resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
    principal,
    { ...scope, companyId },
    ['ver_demandas', 'criar_demandas'],
  )
  await requireCompanyAccessWithAnyPermission(principal, companyId, ['ver_demandas', 'criar_demandas'])
  const media = await withTenantTransaction(principal.tenantId, async (client) => {
    const row = await loadReadableMedia(client, principal.tenantId, mediaId)
    const quotable = await client.query(
      `select 1
         from hotels hotel
        where hotel.tenant_id = $1 and hotel.id = $2
          and hotel.status = 'active' and hotel.deleted_at is null
          and exists (
            select 1
              from hotel_suppliers link
              join commercial_suppliers supplier
                on supplier.tenant_id = link.tenant_id and supplier.id = link.supplier_id
             where link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
               and link.is_active and link.ended_at is null
               and supplier.status = 'active' and supplier.deleted_at is null
               and supplier.service_types @> array['hotel']::text[]
          )`,
      [principal.tenantId, row.hotel_id],
    )
    if (!quotable.rowCount) throw notFound()
    return row
  })
  return readMediaObject(media)
}

async function normalizeHotelMedia(
  bytes: Buffer,
  originalName: string,
  declaredMimeType?: string | null,
): Promise<Buffer> {
  try {
    validateBrandingImageEnvelope(bytes, originalName, declaredMimeType)
    const { default: sharp } = await import('sharp')
    const input = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BRANDING_IMAGE_MAX_PIXELS,
      animated: false,
    })
    const metadata = await input.metadata()
    if (
      !metadata.width
      || !metadata.height
      || metadata.width * metadata.height > BRANDING_IMAGE_MAX_PIXELS
      || (metadata.pages || 1) > 1
    ) throw new BrandingImageValidationError('Dimensoes da imagem invalidas.')
    const normalized = await sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BRANDING_IMAGE_MAX_PIXELS,
      animated: false,
    })
      .rotate()
      .resize({ width: 1_600, height: 1_200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 92, effort: 5 })
      .toBuffer()
    if (!normalized.length || normalized.length > HOTEL_CATALOG_MEDIA_MAX_BYTES) {
      throw new BrandingImageValidationError('Nao foi possivel normalizar a imagem dentro do limite de 5 MB.')
    }
    return normalized
  } catch (error) {
    throw new HotelCatalogMediaServiceError(
      'HOTEL_MEDIA_INVALID',
      error instanceof BrandingImageValidationError
        ? error.message.replace(/logomarca/gi, 'imagem')
        : 'Nao foi possivel validar a foto. Use PNG, JPEG ou WebP com no maximo 5 MB.',
      422,
    )
  }
}

async function requireHotelScope(
  client: PoolClient,
  tenantId: string,
  hotelId: string,
  roomTypeId: string | null,
): Promise<void> {
  const result = await client.query(
    `select 1
       from hotels hotel
      where hotel.tenant_id = $1 and hotel.id = $2 and hotel.deleted_at is null
        and (
          $3::uuid is null
          or exists (
            select 1 from hotel_room_types room
             where room.tenant_id = hotel.tenant_id and room.hotel_id = hotel.id
               and room.id = $3::uuid and room.is_active and room.deleted_at is null
          )
        )`,
    [tenantId, hotelId, roomTypeId],
  )
  if (!result.rowCount) {
    throw new HotelCatalogMediaServiceError(
      'HOTEL_MEDIA_SCOPE_INVALID',
      'Hotel ou tipo de quarto nao encontrado para cadastrar a foto.',
      404,
    )
  }
}

async function loadMediaScope(
  client: PoolClient,
  tenantId: string,
  hotelId: string,
  roomTypeId: string | null,
  forUpdate = false,
): Promise<MediaRow[]> {
  const result = await client.query<MediaRow>(
    `select media.id, media.hotel_id, media.room_type_id, media.file_id,
            media.alt_text, media.sort_order, file.original_name,
            file.storage_key, file.mime_type, file.size_bytes
       from hotel_catalog_media media
       join stored_files file
         on file.tenant_id = media.tenant_id and file.id = media.file_id
      where media.tenant_id = $1 and media.hotel_id = $2
        and media.room_type_id is not distinct from $3::uuid
        and media.deleted_at is null and file.status = 'active'
      order by media.sort_order, media.created_at, media.id
      ${forUpdate ? 'for update of media' : ''}`,
    [tenantId, hotelId, roomTypeId],
  )
  return result.rows
}

async function loadReadableMedia(
  client: PoolClient,
  tenantId: string,
  mediaId: string,
): Promise<MediaRow> {
  const result = await client.query<MediaRow>(
    `select media.id, media.hotel_id, media.room_type_id, media.file_id,
            media.alt_text, media.sort_order, file.original_name,
            file.storage_key, file.mime_type, file.size_bytes
       from hotel_catalog_media media
       join stored_files file
         on file.tenant_id = media.tenant_id and file.id = media.file_id
       join hotels hotel
         on hotel.tenant_id = media.tenant_id and hotel.id = media.hotel_id
      where media.tenant_id = $1 and media.id = $2
        and media.deleted_at is null and file.status = 'active'
        and file.mime_type = 'image/webp' and file.size_bytes <= $3
        and hotel.deleted_at is null
      limit 1`,
    [tenantId, mediaId, HOTEL_CATALOG_MEDIA_MAX_BYTES],
  )
  if (!result.rows[0]) throw notFound()
  return result.rows[0]
}

async function readMediaObject(media: MediaRow) {
  return {
    bytes: await readFile(privateObjectPath(media.storage_key)),
    mimeType: media.mime_type,
    sizeBytes: Number(media.size_bytes),
    originalName: media.original_name,
  }
}

function mapMedia(row: MediaRow): HotelCatalogMedia {
  return {
    id: row.id,
    imageUrl: `/api/hotel-catalog/media/${encodeURIComponent(row.id)}`,
    altText: row.alt_text,
    sortOrder: Number(row.sort_order),
    roomTypeId: row.room_type_id,
  }
}

function safeImageName(value: string): string {
  const clean = basename(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240)
  const stem = clean.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 220)
  return `${stem || 'foto-hotel'}.webp`
}

async function writePrivateObject(storageKey: string, bytes: Buffer): Promise<void> {
  const target = privateObjectPath(storageKey)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
}

async function removePrivateObject(storageKey: string): Promise<void> {
  await rm(privateObjectPath(storageKey), { force: true })
}

function privateObjectPath(storageKey: string): string {
  const root = resolve(getServerEnvironment().STORAGE_ROOT)
  const target = resolve(root, ...storageKey.split('/'))
  const relation = relative(root, target)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Chave de armazenamento invalida.')
  }
  return target
}

function notFound(): HotelCatalogMediaServiceError {
  return new HotelCatalogMediaServiceError('HOTEL_MEDIA_NOT_FOUND', 'Foto do hotel nao encontrada.', 404)
}
