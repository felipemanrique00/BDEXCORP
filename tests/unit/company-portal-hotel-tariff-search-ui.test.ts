import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { companyPortalHotelTariffSearchQuerySchema } from '@/lib/company-portal-lab/hotel-tariff-search'

const root = process.cwd()
const panelSource = read('components/company-portal-lab/hotel-tariff-search-panel.tsx')
const formSource = read('components/company-portal-lab/hotel-offline-request-form.tsx')
const configuratorSource = read('components/travel/hotel-demand-configurator.tsx')
const readonlySource = read('components/company-portal-lab/hotel-request-readonly.tsx')
const demandServiceSource = read('lib/server/company-portal-demand-service.ts')

describe('busca corporativa no tarifario offline de Hotel', () => {
  it('exige empresa/cidade e recebe datas e ocupacao como um contexto indivisivel', () => {
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: '00000000-0000-4000-8000-000000000001',
      checkIn: '2026-09-10',
    }).success).toBe(false)

    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: '00000000-0000-4000-8000-000000000001',
      checkIn: '2026-09-10',
      checkOut: '2026-09-12',
      occupancyType: 'double',
      roomCount: 2,
      q: 'Paulista',
      limit: 30,
    }).success).toBe(true)
  })

  it('oferece uma acao explicita e explica que a tarifa nao garante reserva', () => {
    expect(panelSource).toContain('Buscar no nosso tarifário')
    expect(panelSource).toContain('Buscar no tarifário')
    expect(panelSource).toContain('A consulta não realiza reserva e não garante disponibilidade.')
    expect(panelSource).toContain('disponibilidade, as condições e o preço final serão confirmados pela agência')
    expect(panelSource).toContain('searchCompanyPortalHotelTariffs({')
    expect(panelSource).toContain('Digite hotel, categoria ou endereço')
    expect(panelSource).not.toContain('Digite hotel, rede ou localização')
  })

  it('distingue valor publicavel de tarifa interna sob consulta', () => {
    expect(panelSource).toContain("item.priceStatus === 'available'")
    expect(panelSource).toContain("item.priceStatus === 'under_review'")
    expect(panelSource).toContain('Tarifa sob consulta')
    expect(panelSource).toContain('Diária de referência')
    expect(panelSource).toContain('Total estimado')
    expect(panelSource).toContain('const roomCount = value.rooms?.length')
    expect(panelSource).toContain('tariff.roomCount')
    expect(panelSource).not.toMatch(/supplierId|supplierCode|rateId|emissionId|billingInfo/)
  })

  it('persiste a escolha apenas como preferencia e respeita o limite governado', () => {
    expect(panelSource).toContain("currentIds.filter((id) => id !== hotelId)")
    expect(panelSource).toContain('...preferredHotelPatch(nextIds)')
    expect(panelSource).toContain('MAX_PREFERRED_HOTELS')
    expect(panelSource).toContain('Adicionar como preferência')
    expect(panelSource).toContain('Remover preferência')
    expect(panelSource).toContain('Hotéis adicionados como preferência')
    expect(panelSource).toContain('setLoading(false)')
    expect(panelSource).not.toContain('Reservar')
  })

  it('substitui o seletor bruto do formulario corporativo pelo painel tarifario', () => {
    expect(formSource).toContain('<HotelTariffSearchPanel')
    expect(formSource).toContain('showPreferredHotelSelector={false}')
    expect(configuratorSource).toContain('showPreferredHotelSelector = true')
    expect(configuratorSource).toContain('if (!showPreferredHotelSelector)')
  })

  it('preserva no pedido um snapshot server-owned do valor apresentado', () => {
    expect(demandServiceSource).toContain('attachServerOwnedHotelTariffReference')
    expect(demandServiceSource).toContain('attachCompanyPortalHotelTariffReference')
    expect(readonlySource).toContain('data-company-portal-hotel-tariff-reference')
    expect(readonlySource).toContain('Referência do tarifário no envio')
    expect(readonlySource).toContain("if (key === 'hotelTariffReference') return []")
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
