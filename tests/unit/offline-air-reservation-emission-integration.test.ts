import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('offline air reservation and emission integration', () => {
  it('copies the approved quote into immutable structured reservation rows', () => {
    const service = read('lib/server/offline-travel-service.ts')
    expect(service).toContain('persistApprovedAirReservation')
    expect(service).toContain('insert into air_reservation_details')
    expect(service).toContain('insert into air_reservation_segments')
    expect(service).toContain('source_quote_option_id')
    expect(service).toContain("quote_segment.metadata || $4::jsonb")
    expect(service).toContain('OFFLINE_APPROVED_AIR_QUOTE_SEGMENTS_MISSING')
  })

  it('records one ticket per passenger and marks every reserved segment as issued', () => {
    const service = read('lib/server/offline-travel-service.ts')
    expect(service).toContain('persistAirEmissionTickets')
    expect(service).toContain('insert into air_emission_tickets')
    expect(service).toContain('airTicketsFromIssue')
    expect(service).toContain("set status = 'issued'")
    expect(service).toContain('distributedMinorAmount')
  })

  it('keeps approved itinerary and prices locked while exposing operational fields', () => {
    const form = read('components/travel/offline-travel-operation-form.tsx')
    expect(form).toContain('OfflineAirOperationFields')
    expect(form).toContain('loadSelectedAirQuote')
    expect(form).toContain('applySelectedAirQuote')
    expect(form).toContain('airTickets: serviceKey')
    expect(form).toContain('Gerar voucher aéreo completo automaticamente')
    expect(form).toContain('A escolha aérea ainda não possui uma aprovação concluída')
  })

  it('renders all air segments and passenger tickets on the voucher', () => {
    const service = read('lib/server/offline-travel-service.ts')
    const page = read('app/dashboard/vouchers/[id]/page.tsx')
    const assistantPdf = read('lib/assistant/pdf.ts')
    const types = read('types/index.ts')
    expect(service).toContain('loadAirVoucherData')
    expect(service).toContain('trechos_aereos')
    expect(service).toContain('bilhetes_aereos')
    expect(page).toContain('Itinerário aéreo')
    expect(page).toContain('Bilhetes emitidos')
    expect(assistantPdf).toContain("section('Itinerário aéreo'")
    expect(assistantPdf).toContain('voucher.bilhetes_aereos')
    expect(types).toContain('interface VoucherTrechoAereo')
    expect(types).toContain('interface VoucherBilheteAereo')
  })
})
