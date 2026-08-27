import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { projectCompanyPortalHotelTariffItem } from '@/lib/server/company-portal-hotel-tariff-service'
import { hotelCatalogMediaOrderSchema } from '@/lib/server/hotel-catalog-media-service'
import type { HotelRateSelectionCandidate } from '@/lib/server/hotel-rate-suggestion-service'

const migration = read('deploy/postgres/migrations/0081_hotel_catalog_media.sql')
const mediaService = read('lib/server/hotel-catalog-media-service.ts')
const catalogService = read('lib/server/hotel-catalog-service.ts')
const tariffService = read('lib/server/company-portal-hotel-tariff-service.ts')
const uploadRoute = read('app/api/hotel-catalog/[id]/media/route.ts')
const deleteRoute = read('app/api/hotel-catalog/[id]/media/[mediaId]/route.ts')
const adminReadRoute = read('app/api/hotel-catalog/media/[mediaId]/route.ts')
const portalReadRoute = read('app/api/company-portal/hotel-media/[mediaId]/route.ts')
const catalogPage = read('app/dashboard/hoteis/catalogo/page.tsx')
const tariffPanel = read('components/company-portal-lab/hotel-tariff-search-panel.tsx')

describe('midia segura do catalogo hoteleiro', () => {
  it('adiciona uma tabela multitenant vinculada a hotel, quarto e arquivo privado', () => {
    expect(migration).toContain('create table if not exists hotel_catalog_media')
    expect(migration).toContain('references hotels(tenant_id, id) on delete restrict')
    expect(migration).toContain('references hotel_room_types(tenant_id, hotel_id, id) on delete restrict')
    expect(migration).toContain('references stored_files(tenant_id, id) on delete restrict')
    expect(migration).toContain("file.purpose = 'hotel_catalog_media'")
    expect(migration).toContain("file.mime_type = 'image/webp'")
    expect(migration).toContain('alter table hotel_catalog_media force row level security')
    expect(migration).toContain('create policy tenant_isolation on hotel_catalog_media')
    expect(migration).not.toMatch(/drop\s+(?:table|column)|truncate\s+table/i)
  })

  it('valida, normaliza, limita, serializa e deduplica uploads antes da persistencia', () => {
    expect(mediaService).toContain('validateBrandingImageEnvelope')
    expect(mediaService).toContain('limitInputPixels: BRANDING_IMAGE_MAX_PIXELS')
    expect(mediaService).toContain(".webp({ quality: 86")
    expect(mediaService).toContain("pg_advisory_xact_lock(hashtext('tenant-file-quota')")
    expect(mediaService.indexOf("pg_advisory_xact_lock(hashtext('tenant-file-quota')"))
      .toBeLessThan(mediaService.indexOf('select count(*)::integer as total'))
    expect(mediaService).toContain('and file.sha256 = $4')
    expect(mediaService).toContain('HOTEL_CATALOG_MEDIA_MAX_HOTEL_IMAGES = 12')
    expect(mediaService).toContain('HOTEL_CATALOG_MEDIA_MAX_ROOM_IMAGES = 8')
    expect(mediaService).not.toMatch(/https?:\/\//)
  })

  it('exige upload autenticado com permissao interna, tamanho conhecido e tipos de imagem', () => {
    expect(uploadRoute).toContain("permission: 'cadastrar_hoteis'")
    expect(uploadRoute).toContain("roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator']")
    expect(uploadRoute).toContain('CONTENT_LENGTH_REQUIRED')
    expect(uploadRoute).toContain('HOTEL_CATALOG_MEDIA_MAX_BYTES')
    expect(uploadRoute).toContain('runInApiGuardContext(guard')
    expect(catalogPage).toContain('accept="image/png,image/jpeg,image/webp"')
    expect(catalogPage).toContain('window.confirm(')
    expect(catalogPage).toContain('reorderHotelCatalogMedia(')
    expect(deleteRoute).toContain("permission: 'cadastrar_hoteis'")
    expect(deleteRoute).toContain('runInApiGuardContext(guard')
  })

  it('serve imagens autenticadas sem cache compartilhavel e preserva o escopo corporativo', () => {
    for (const route of [adminReadRoute, portalReadRoute]) {
      expect(route).toContain("'Cache-Control': 'private, no-store'")
      expect(route).toContain("'X-Content-Type-Options': 'nosniff'")
      expect(route).toContain("'Cross-Origin-Resource-Policy': 'same-origin'")
      expect(route).toContain("'Content-Security-Policy': \"default-src 'none'; sandbox\"")
    }
    expect(portalReadRoute).toContain("permissionsAny: ['ver_demandas', 'criar_demandas']")
    expect(portalReadRoute).toContain('scope: rawCompanyId ? { companyId: rawCompanyId } : {}')
    expect(portalReadRoute).toContain("scopeType: z.enum(['company', 'group']).optional()")
    expect(portalReadRoute).toContain('{ scopeType: query.scopeType, scopeId: query.scopeId }')
    expect(mediaService).toContain('requireCompanyAccessWithAnyPermission(principal, companyId')
    expect(mediaService).toContain("supplier.service_types @> array['hotel']::text[]")
  })

  it('mantem a ordenacao como substituicao exata da galeria e rejeita duplicidades', () => {
    const first = '00000000-0000-4000-8000-000000000001'
    expect(hotelCatalogMediaOrderSchema.safeParse({
      roomTypeId: null,
      orderedMediaIds: [first, first],
    }).success).toBe(false)
    expect(hotelCatalogMediaOrderSchema.safeParse({
      roomTypeId: '00000000-0000-4000-8000-000000000002',
      orderedMediaIds: Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    }).success).toBe(false)
    expect(mediaService).toContain('HOTEL_MEDIA_ORDER_STALE')
    expect(mediaService).toContain('current.length !== input.orderedMediaIds.length')
    expect(mediaService).toContain('select file.storage_key')
    expect(mediaService).toContain('if (replay.rows[0]?.storage_key) return replay.rows[0].storage_key')
    expect(mediaService).toContain("await rm(privateObjectPath(storageKey), { force: true })")
  })

  it('projeta somente midia publica allow-listed e URL BFF vinculada a empresa', () => {
    const item = projectCompanyPortalHotelTariffItem({
      hotelId: 'hotel-public-1',
      name: 'Hotel Publico',
      category: 'Executivo',
      starRating: 4,
      address: 'Rua Exemplo',
      city: 'Sao Paulo',
      companyId: 'company-allowed',
      amenities: ['Wi-Fi'],
      media: [{
        id: '00000000-0000-4000-8000-000000000001',
        altText: 'Fachada do hotel',
        roomTypeId: null,
        roomCategory: null,
      }, {
        id: '00000000-0000-4000-8000-000000000002',
        altText: 'Quarto executivo',
        roomTypeId: 'room-selected',
        roomCategory: 'Executivo',
      }, {
        id: '00000000-0000-4000-8000-000000000003',
        altText: 'Outro quarto',
        roomTypeId: 'room-other',
        roomCategory: 'Luxo',
      }],
    }, [mediaCandidate()], 2, 1, true)

    expect(item.images).toEqual([
      {
        imageUrl: '/api/company-portal/hotel-media/00000000-0000-4000-8000-000000000002?companyId=company-allowed',
        altText: 'Quarto executivo',
        scope: 'room',
        roomCategory: 'Executivo',
      },
      {
        imageUrl: '/api/company-portal/hotel-media/00000000-0000-4000-8000-000000000001?companyId=company-allowed',
        altText: 'Fachada do hotel',
        scope: 'hotel',
        roomCategory: null,
      },
    ])
    expect(item.amenities).toEqual(['Wi-Fi'])
    expect(JSON.stringify(item)).not.toMatch(/storage_key|file_id|room-other|Outro quarto|Luxo/)
    expect(tariffService).toContain('const PUBLIC_AMENITIES')
    expect(tariffService).toContain('item.roomTypeId === selectedRoomTypeId')
    expect(tariffService).not.toContain('limit 20')
    expect(tariffService).not.toContain("imageUrl: 'http")
  })

  it('renderiza cards horizontais responsivos, galeria e fallback sem inventar avaliacao', () => {
    expect(tariffPanel).toContain('md:flex')
    expect(tariffPanel).toContain('function HotelTariffGallery')
    expect(tariffPanel).toContain('Sem foto cadastrada')
    expect(tariffPanel).toContain('Não é reserva nem confirmação de disponibilidade.')
    expect(tariffPanel).toContain('item.amenities.map')
    expect(tariffPanel).not.toMatch(/avalia(?:cao|ção|coes|ções)|hospedes adoram/i)
    expect(catalogService).toContain("'media', coalesce((")
  })
})

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function mediaCandidate(): HotelRateSelectionCandidate {
  return {
    hotelId: 'hotel-public-1',
    hotelSupplierId: 'hotel-supplier-1',
    supplierId: 'supplier-1',
    supplierName: 'Fornecedor',
    supplierCode: 'SUP-1',
    roomTypeId: 'room-selected',
    roomCategory: 'Executivo',
    source: 'catalog',
    rateId: 'rate-1',
    rateVersion: 1,
    emissionObservationId: null,
    emissionId: null,
    observedAt: null,
    nightlyRate: 200,
    nightlyTaxes: 20,
    serviceFee: 10,
    currency: 'BRL',
    refundable: true,
    mealPlan: 'Cafe da manha',
    cancellationPolicy: null,
    paymentTerms: null,
    scope: 'company',
    scopeLabel: 'Acordo da empresa',
    outsideValidity: false,
    outOfPeriodPolicy: 'block',
    isNet: false,
    supplierPriority: 1,
  }
}
