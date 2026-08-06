import { describe, expect, it } from 'vitest'

import { renderVoucherHtml } from '@/lib/assistant/pdf'
import type { VoucherEmitido } from '@/types'

function completeHotelVoucher(): VoucherEmitido {
  return {
    id: 'H-PREVIEW-001',
    numero: 'PREVIEW-001',
    tipo: 'Hotel',
    status: 'confirmado',
    atendimento_id: 'internal-demand-id',
    empresa_id: 'company-preview',
    funcionario_id: 'employee-preview',
    passageiro_nome: 'Ana Principal',
    passageiros: ['Ana Principal', 'Bruno Acompanhante'],
    hospedes_detalhes: [
      {
        nome: 'Ana Principal',
        papel: 'Responsável',
        principal: true,
        codigo: 'VIA-101',
        documento: '12345678901',
        email: 'ana@example.com',
        telefone: '(62) 99999-1111',
        quarto: 1,
      },
      {
        nome: 'Bruno <Acompanhante>',
        papel: 'Acompanhante',
        codigo: 'VIA-102',
        documento: 'AB123456',
        quarto: 1,
      },
    ],
    empresa_nome: 'Cliente & Companhia S.A.',
    empresa_documento: '12.345.678/0001-90',
    unidade_negocio: 'Unidade Centro-Oeste',
    departamento: 'Controladoria',
    solicitante_nome: 'Solicitante Teste',
    solicitante_email: 'solicitante@example.com',
    autorizadores: ['Aprovadora Um', 'Diretor <Final>'],
    autorizado_em: '2026-08-04T18:15:00.000Z',
    data_solicitacao: '2026-08-01T13:00:00.000Z',
    reserva_id: 'RES-CLIENTE-4455',
    data_reserva: '2026-08-04T17:30:00.000Z',
    fornecedor_nome: 'Operadora & Reservas Ltda.',
    fornecedor_codigo: 'FORN-7788',
    fornecedor_endereco: 'Av. Operacional, 10',
    fornecedor_cidade: 'Goiânia/GO',
    fornecedor_telefone: '(62) 3000-1000',
    fornecedor_email: 'operacao@example.com',
    canal_reserva: 'E-mail',
    hotel_nome: 'Hotel & Spa <Centro>',
    hotel_endereco: 'Rua da Hospedagem, 200 - Centro',
    hotel_cidade: 'Ribeirão Preto/SP',
    hotel_telefone: '(16) 3333-4444',
    hotel_email: 'reservas@hotel.example',
    hotel_categoria: 'Superior',
    tipo_apartamento: 'Double Standard',
    quartos: [{
      numero: 1,
      acomodacao: 'Double',
      categoria: 'Standard',
      regime: 'Café da manhã',
      hospedes: ['Ana Principal', 'Bruno <Acompanhante>'],
    }],
    num_apartamentos: 1,
    num_hospedes: 2,
    data_checkin: '2026-09-03',
    data_checkout: '2026-09-05',
    checkin_em: '2026-09-03T17:00:00.000Z',
    checkout_em: '2026-09-05T15:00:00.000Z',
    noites: 2,
    regime: 'Café da manhã',
    forma_pagamento_voucher: 'Faturado',
    referencia_pagamento: 'FAT-30-DIAS',
    condicoes_pagamento: 'Faturar diárias e taxas',
    prazo_cancelamento: '2026-08-31T18:00:00.000Z',
    politica_cancelamento: 'Após o prazo, cobrança integral.',
    politica_no_show: 'No-show sujeito a 100% da hospedagem.',
    reembolsavel: false,
    localizador: 'LOC-13728',
    numero_confirmacao: 'CONF-HOTEL-9988',
    data_confirmacao: '2026-08-04T17:35:00.000Z',
    confirmado_por: 'Consultor Offline',
    valor_diaria: 330,
    taxas_diaria: 40.26,
    taxa_servico: 15,
    tarifa_total: 660,
    taxas: 80.52,
    total: 755.52,
    moeda: 'BRL',
    centro_custo: '1001 - Administração',
    numero_solicitacao: 'OS-20260804-0004',
    observacoes: 'Chegada prevista após 20h. <script>alert("x")</script>',
    emitido_por_user_id: 'operator-preview',
    emitido_por_user_name: 'Operador BBT',
    created_at: '2026-08-04T17:40:00.000Z',
  }
}

function voucherWithPresentation(input: {
  showConfirmedValues: boolean
  showCancellationTerms: boolean
  showAdministrativeData: boolean
}): VoucherEmitido {
  return {
    ...completeHotelVoucher(),
    presentation_settings: {
      ...input,
      sources: {
        showConfirmedValues: 'company',
        showCancellationTerms: 'company',
        showAdministrativeData: 'company',
      },
      groupId: 'group-preview',
    },
  }
}

describe('assistant voucher HTML', () => {
  it('renders the complete hotel voucher with hotel and operational supplier kept separate', () => {
    const html = renderVoucherHtml(completeHotelVoucher())

    for (const expected of [
      'Cliente e aprovação',
      'Cliente &amp; Companhia S.A.',
      'Solicitante Teste',
      'Aprovadora Um, Diretor &lt;Final&gt;',
      'OS-20260804-0004',
      '1001 - Administração',
      'Hóspedes',
      'Ana Principal',
      'Bruno &lt;Acompanhante&gt;',
      '123.***.***-01',
      'ana@example.com, (62) 99999-1111',
      'Hotel e hospedagem',
      'Hotel &amp; Spa &lt;Centro&gt;',
      'Ribeirão Preto/SP',
      '03/09/2026, 14:00',
      '05/09/2026, 12:00',
      'Double Standard',
      'Café da manhã',
      'Fornecedor operacional',
      'Operadora &amp; Reservas Ltda.',
      'FORN-7788',
      'LOC-13728',
      'CONF-HOTEL-9988',
      'RES-CLIENTE-4455',
      'Diária × 2 noites × 1 quarto',
      'R$\u00a0330,00',
      'R$\u00a0755,52',
      'Faturado',
      'FAT-30-DIAS',
      'Não reembolsável',
      'Após o prazo, cobrança integral.',
      'No-show sujeito a 100% da hospedagem.',
      'Operador BBT',
    ]) {
      expect(html).toContain(expected)
    }
    expect(html).not.toContain('<script>alert("x")</script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).not.toContain('AB123456')
    expect(html).toContain('AB****56')
  })

  it('omits absent optional sections and fields instead of inventing placeholder values', () => {
    const voucher: VoucherEmitido = {
      id: 'H-PREVIEW-MIN',
      numero: 'PREVIEW-MIN',
      tipo: 'Hotel',
      status: 'emitido',
      empresa_id: 'company-preview',
      passageiro_nome: 'Hóspede Mínimo',
      cpf: '98765432100',
      fornecedor_nome: 'Fornecedor Operacional',
      total: 99.9,
      emitido_por_user_id: 'operator-preview',
      emitido_por_user_name: '',
      created_at: '',
    }

    const protectedHtml = renderVoucherHtml(voucher)
    const unprotectedHtml = renderVoucherHtml(voucher, false)

    expect(protectedHtml).toContain('Hóspede Mínimo')
    expect(protectedHtml).toContain('987.***.***-00')
    expect(protectedHtml).not.toContain('98765432100')
    expect(unprotectedHtml).toContain('98765432100')
    expect(protectedHtml).not.toContain('Cliente e aprovação')
    expect(protectedHtml).not.toContain('Hotel e hospedagem')
    expect(protectedHtml).not.toContain('Confirmação da reserva')
    expect(protectedHtml).not.toContain('Cancelamento e condições')
    expect(protectedHtml).not.toContain('Observações ao viajante')
    expect(protectedHtml).not.toContain('Não informado')
    expect(protectedHtml).not.toContain('Conforme política')
    expect(protectedHtml).not.toContain('Sem observações')
  })

  it('hides every gated value and administrative duplicate while retaining reservation essentials', () => {
    const html = renderVoucherHtml(voucherWithPresentation({
      showConfirmedValues: false,
      showCancellationTerms: false,
      showAdministrativeData: false,
    }))

    for (const retained of [
      'Cliente &amp; Companhia S.A.',
      'Ana Principal',
      'Bruno &lt;Acompanhante&gt;',
      'Hotel &amp; Spa &lt;Centro&gt;',
      'Double Standard',
      'Café da manhã',
      'Operadora &amp; Reservas Ltda.',
      'LOC-13728',
      'CONF-HOTEL-9988',
    ]) {
      expect(html).toContain(retained)
    }

    for (const hidden of [
      'Valores e pagamento',
      'Valores confirmados',
      'R$\u00a0330,00',
      'R$\u00a0755,52',
      'Cancelamento e condições',
      'No-show sujeito a 100%',
      'Cliente e aprovação',
      'Unidade Centro-Oeste',
      'Solicitante Teste',
      'Aprovadora Um',
      'OS-20260804-0004',
      '1001 - Administração',
      'RES-CLIENTE-4455',
      'Consultor Offline',
      'FORN-7788',
      'FAT-30-DIAS',
      'Faturar diárias e taxas',
      'Operador BBT',
      'Voucher emitido por',
      'Emitido em',
    ]) {
      expect(html).not.toContain(hidden)
    }
  })

  it('applies the three presentation gates independently', () => {
    const withoutValues = renderVoucherHtml(voucherWithPresentation({
      showConfirmedValues: false,
      showCancellationTerms: true,
      showAdministrativeData: true,
    }))
    expect(withoutValues).not.toContain('R$\u00a0755,52')
    expect(withoutValues).toContain('FAT-30-DIAS')
    expect(withoutValues).toContain('No-show sujeito a 100%')
    expect(withoutValues).toContain('OS-20260804-0004')

    const withoutCancellation = renderVoucherHtml(voucherWithPresentation({
      showConfirmedValues: true,
      showCancellationTerms: false,
      showAdministrativeData: true,
    }))
    expect(withoutCancellation).toContain('R$\u00a0755,52')
    expect(withoutCancellation).not.toContain('No-show sujeito a 100%')
    expect(withoutCancellation).toContain('FAT-30-DIAS')
    expect(withoutCancellation).toContain('OS-20260804-0004')

    const withoutAdministrativeData = renderVoucherHtml(voucherWithPresentation({
      showConfirmedValues: true,
      showCancellationTerms: true,
      showAdministrativeData: false,
    }))
    expect(withoutAdministrativeData).toContain('R$\u00a0755,52')
    expect(withoutAdministrativeData).toContain('No-show sujeito a 100%')
    expect(withoutAdministrativeData).not.toContain('FAT-30-DIAS')
    expect(withoutAdministrativeData).not.toContain('OS-20260804-0004')
    expect(withoutAdministrativeData).not.toContain('Consultor Offline')
    expect(withoutAdministrativeData).not.toContain('Operador BBT')
  })
})
