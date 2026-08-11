import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  VoucherDocument,
  type VoucherDocumentAssets,
} from '@/components/vouchers/voucher-document'
import { renderVoucherHtml } from '@/lib/assistant/pdf'
import { buildVoucherDocumentModel } from '@/lib/vouchers/document-model'
import {
  AD_LOGO_DATA_URL,
  AGENCY_LOGO_DATA_URL,
  completeAirVoucher,
  completeHotelVoucher,
  CUSTOMER_LOGO_DATA_URL,
  CUSTOM_DOCUMENT_BRANDING,
  G3_LOGO_DATA_URL,
  SELF_CONTAINED_DOCUMENT_ASSETS,
} from '../support/voucher-document-fixtures'

const assets: VoucherDocumentAssets = SELF_CONTAINED_DOCUMENT_ASSETS

describe('canonical voucher document parity', () => {
  it('renders the complete hotel voucher identically in the shared component and standalone e-mail HTML', () => {
    const voucher = completeHotelVoucher()
    const { markup, html } = renderBoth(voucher)

    expect(html).toContain(markup)
    expect(markup).toContain('data-voucher-document="true"')
    expect(markup).toContain('data-voucher-id="H-PARITY-001"')
    expectDocumentSections(markup, [
      'header',
      'summary',
      'travelers',
      'hotel',
      'rooms',
      'supplier',
      'confirmation',
      'financial',
      'payment',
      'cancellation',
      'administrative',
      'observations',
      'footer',
    ])
    expectEveryOutput([markup, html], [
      'BBT AGENCIA DE VIAGENS E TURISMO GLOBAIS',
      'Rua 22, Quadra 31 Lote 05 - Setor Barcelos',
      'financeiro@agenciabbt.com.br',
      '20.027.725/0001-80',
      '09.062567.10.0001-0',
      'Grupo Exemplo',
      'Grupo Exemplo Participacoes S.A.',
      '12.345.678/0001-90',
      'Cliente &amp; Companhia S.A.',
      '98.765.432/0001-10',
      'Ana Principal',
      'Bruno Acompanhante',
      '123.***.***-01',
      'AB****56',
      'Hotel Alpha Park',
      'Avenida Alphaville Flamboyant, 3609',
      '(62) 3257-7900',
      'reservas@alphapark.example',
      '03/09/2026, 14:00',
      '05/09/2026, 12:00',
      'Double Standard',
      'Standard',
      'Cafe da manha',
      'Operadora &amp; Reservas Ltda.',
      'LOC-13728',
      'CONF-HOTEL-9988',
      '330,00',
      '660,00',
      '80,52',
      '755,52',
      'Faturado',
      'FAT-30-DIAS',
      'Apos o prazo, cobranca integral.',
      'No-show sujeito a 100% da hospedagem.',
      'OS-20260804-0004',
      '1001 - Administracao',
      'Bia Solicitante',
      'Aprovadora Um, Diretor Final',
      'Operador BBT',
      'Chegada prevista apos 20h. Apresentar documento no check-in.',
    ])

    // O fixture nao possui `quartos`; nomes repetidos no quadro de hospedes e
    // na acomodacao comprovam que o fallback legado tambem chegou ao documento.
    expect(countOccurrences(markup, 'Ana Principal')).toBeGreaterThanOrEqual(2)
    expect(countOccurrences(markup, 'Bruno Acompanhante')).toBeGreaterThanOrEqual(2)
    expect(markup).not.toContain('12345678901')
    expect(markup).not.toContain('AB123456')
    expect(markup).toContain(AGENCY_LOGO_DATA_URL)
    expect(markup).toContain(CUSTOMER_LOGO_DATA_URL)
    expect(markup).toContain('data-voucher-logo="agency"')
    expect(markup).toContain('data-voucher-logo="customer"')
    expect(markup).not.toContain(AD_LOGO_DATA_URL)
    expectStandaloneImages(html, 2)
  })

  it('renders the complete air voucher with passengers, itinerary, tickets and every airline logo', () => {
    const voucher = completeAirVoucher()
    const { markup, html } = renderBoth(voucher)

    expect(html).toContain(markup)
    expect(markup).toContain('data-voucher-document="true"')
    expect(markup).toContain('data-voucher-id="A-PARITY-001"')
    expectDocumentSections(markup, [
      'header',
      'summary',
      'travelers',
      'air-itinerary',
      'air-reservation',
      'air-tickets',
      'supplier',
      'confirmation',
      'financial',
      'cancellation',
      'administrative',
      'observations',
      'footer',
    ])
    expectEveryOutput([markup, html], [
      'BBT AGENCIA DE VIAGENS E TURISMO GLOBAIS',
      'Grupo Exemplo',
      'Cliente &amp; Companhia S.A.',
      'Ana Viajante',
      'Bruno Viajante',
      '123.***.***-01',
      '987.***.***-00',
      'Azul Linhas Aereas Brasileiras',
      'GOL Linhas Aereas',
      'Voo AD, 1327',
      'Voo G3, 3399',
      'GYN',
      'CGH',
      'Santa Genoveva International Airport - Goiania/GO',
      'Congonhas Airport - Sao Paulo/SP',
      '01/09/2026, 10:00',
      '05/09/2026, 17:00',
      'Economica',
      '1 volume(s)',
      'SABRE',
      'ABC123',
      '10/08/2026, 23:59',
      '5771234567890',
      '1270987654321',
      'PAX-001',
      'PAX-002',
      '3.678,74',
      '110,96',
      '25,00',
      '15,00',
      '9.856,52',
      '3.864,70',
      'Tarifa nao reembolsavel apos a emissao.',
      'No-show sujeito as regras de cada companhia.',
      'OS-20260810-0001',
      '2002 - Comercial',
      'Bia Solicitante',
      'Aprovadora Um, Diretor Final',
      'Operador Aereo BBT',
      'Apresentar-se no aeroporto com antecedencia minima de duas horas.',
    ])

    expect(markup).not.toContain('12345678901')
    expect(markup).not.toContain('98765432100')
    expect(markup).toContain(AGENCY_LOGO_DATA_URL)
    expect(markup).toContain(CUSTOMER_LOGO_DATA_URL)
    expect(markup).toContain(AD_LOGO_DATA_URL)
    expect(markup).toContain(G3_LOGO_DATA_URL)
    expect(markup).toContain('data-voucher-logo="airline"')
    expect(markup).toContain('data-airline-code="AD"')
    expect(markup).toContain('data-airline-code="G3"')
    expectStandaloneImages(html, 4)
  })

  it('keeps presentation gates identical in component and e-mail output', () => {
    const voucher = completeHotelVoucher({
      presentation_settings: {
        showConfirmedValues: false,
        showCancellationTerms: false,
        showAdministrativeData: false,
        sources: {
          showConfirmedValues: 'company',
          showCancellationTerms: 'company',
          showAdministrativeData: 'company',
        },
        groupId: 'group-parity',
      },
    })
    const { markup, html } = renderBoth(voucher)

    expect(html).toContain(markup)
    for (const output of [markup, html]) {
      expect(output).toContain('Hotel Alpha Park')
      expect(output).toContain('Ana Principal')
      expect(output).toContain('Double Standard')
      expect(output).not.toContain('755,52')
      expect(output).not.toContain('No-show sujeito a 100%')
      expect(output).not.toContain('OS-20260804-0004')
      expect(output).not.toContain('Aprovadora Um')
      expect(output).not.toContain('Operador BBT')
    }
  })
})

function renderBoth(voucher: ReturnType<typeof completeHotelVoucher>) {
  const model = buildVoucherDocumentModel(voucher, {
    protectSensitiveData: true,
    branding: CUSTOM_DOCUMENT_BRANDING,
  })
  const markup = renderToStaticMarkup(createElement(VoucherDocument, { model, assets }))
  const html = renderVoucherHtml(
    voucher,
    true,
    CUSTOM_DOCUMENT_BRANDING,
    assets,
  )
  return { markup, html }
}

function expectEveryOutput(outputs: string[], expectedValues: string[]): void {
  for (const output of outputs) {
    for (const expected of expectedValues) expect(output).toContain(expected)
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function expectDocumentSections(markup: string, sections: string[]): void {
  for (const section of sections) {
    expect(markup).toContain(`data-voucher-section="${section}"`)
  }
}

function expectStandaloneImages(html: string, minimumImages: number): void {
  const imageSources = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => match[1])

  expect(imageSources.length).toBeGreaterThanOrEqual(minimumImages)
  for (const source of imageSources) {
    expect(source).toMatch(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/)
  }
  expect(html).not.toMatch(/\b(?:src|href)=["'](?:https?:|\/\/|\/)/i)
  expect(html).not.toMatch(/url\(\s*["']?(?:https?:|\/\/|\/)/i)
  expect(html).not.toContain('cid:')
}
