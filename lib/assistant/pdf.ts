import { ASSISTANT_KEYS, appendAssistantList, createId } from '@/lib/assistant/storage'
import { formatDateBR } from '@/lib/date'
import type { GeneratedDocument } from '@/lib/assistant/types'
import { resolveVoucherPresentationSettings } from '@/lib/vouchers/presentation'
import type { VoucherEmitido, VoucherHospedeDetalhe, VoucherQuartoDetalhe } from '@/types'

export async function generateVoucherDocument(
  voucher: VoucherEmitido,
  options: { createdBy?: string; protectSensitiveData?: boolean } = {},
): Promise<GeneratedDocument> {
  const html = renderVoucherHtml(voucher, options.protectSensitiveData !== false)
  const document: GeneratedDocument = {
    id: createId('doc'),
    type: 'voucher',
    status: 'generated',
    title: `Voucher ${voucher.id}`,
    entityId: voucher.id,
    companyId: voucher.empresa_id,
    html,
    fileName: `voucher-${voucher.id}.html`,
    mimeType: 'text/html',
    createdBy: options.createdBy,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.generatedDocuments, document, 500)
  return document
}

export function renderVoucherHtml(voucher: VoucherEmitido, protectSensitiveData = true): string {
  const presentation = voucher.presentation_settings ?? resolveVoucherPresentationSettings({})
  const checkIn = voucher.checkin_em || voucher.data_checkin
  const checkOut = voucher.checkout_em || voucher.data_checkout
  const hotelSection = renderHotelSection(voucher, checkIn, checkOut)
  const serviceSection = renderServiceSection(voucher)
  const guestsSection = renderGuestsSection(voucher, protectSensitiveData)
  const corporateSection = renderCorporateSection(voucher, presentation.showAdministrativeData)
  const supplierSection = renderSupplierSection(voucher, presentation.showAdministrativeData)
  const confirmationSection = renderConfirmationSection(voucher, presentation.showAdministrativeData)
  const financialSection = renderFinancialSection(
    voucher,
    presentation.showConfirmedValues,
    presentation.showAdministrativeData,
  )
  const conditionsSection = presentation.showCancellationTerms
    ? renderConditionsSection(voucher)
    : ''
  const observationsSection = textSection('Observações ao viajante', voucher.observacoes)
  const issuedAt = presentation.showAdministrativeData
    ? formatDateTimeBR(voucher.created_at)
    : undefined

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Voucher ${escapeHtml(voucher.id)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #f8fafc; }
    .page { width: 100%; max-width: 820px; margin: 0 auto; background: #fff; padding: 30px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 3px solid #006fcf; padding-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 800; color: #001b44; }
    .eyebrow, .label { color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .voucher-id { margin-top: 4px; color: #001b44; font-size: 20px; font-weight: 800; text-align: right; }
    .badge { display: inline-block; padding: 5px 9px; border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 11px; font-weight: 800; }
    .section { margin-top: 20px; break-inside: avoid; }
    .section-title { margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #cbd5e1; color: #001b44; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
    .field { min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    .value { margin-top: 2px; font-size: 12px; font-weight: 600; overflow-wrap: anywhere; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f1f5f9; color: #334155; font-weight: 700; }
    .money td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .total-row { background: #f1f5f9; font-weight: 800; }
    .warning { margin-top: 8px; border-left: 4px solid #d97706; background: #fffbeb; padding: 9px 11px; color: #78350f; font-size: 11px; }
    .footer { margin-top: 24px; border-top: 1px solid #cbd5e1; padding-top: 10px; color: #64748b; font-size: 10px; }
    @media print {
      @page { size: A4; margin: 12mm; }
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
    }
    @media (max-width: 640px) {
      .page { padding: 18px; }
      .header { flex-direction: column; }
      .voucher-id { text-align: left; }
      .grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div>
        <div class="brand">BBT Corporativo</div>
        <div class="eyebrow">Voucher de ${escapeHtml(voucher.tipo)}</div>
      </div>
      <div>
        <div class="badge">${escapeHtml(voucher.status.toUpperCase())}</div>
        <div class="voucher-id">${escapeHtml(voucher.id)}</div>
        ${issuedAt ? `<div class="value">Emitido em ${escapeHtml(issuedAt)}</div>` : ''}
      </div>
    </header>
    ${corporateSection}
    ${guestsSection}
    ${hotelSection}
    ${serviceSection}
    ${supplierSection}
    ${confirmationSection}
    ${financialSection}
    ${conditionsSection}
    ${observationsSection}
    <footer class="footer">
      ${presentation.showAdministrativeData && voucher.emitido_por_user_name ? `Voucher emitido por <strong>${escapeHtml(voucher.emitido_por_user_name)}</strong>. ` : ''}
      Confira os dados da reserva antes da utilização. Em caso de divergência, acione a equipe BBT.
    </footer>
  </main>
</body>
</html>`
}

function renderCorporateSection(voucher: VoucherEmitido, showAdministrativeData: boolean): string {
  const fields = [
    field('Empresa faturada', voucher.empresa_nome),
    field('CNPJ / documento', voucher.empresa_documento),
    ...(showAdministrativeData ? [
      field('Unidade de negócio', voucher.unidade_negocio),
      field('Departamento', voucher.departamento),
      field('Solicitante', voucher.solicitante_nome),
      field('E-mail do solicitante', voucher.solicitante_email),
      field('Autorizador(es)', joinValues(voucher.autorizadores)),
      field('Autorizado em', formatDateTimeBR(voucher.autorizado_em)),
      field('Data da solicitação', formatDateTimeBR(voucher.data_solicitacao)),
      field('OS / pedido', voucher.numero_solicitacao),
      field('Centro de custo', voucher.centro_custo),
    ] : []),
  ].join('')
  return section(
    showAdministrativeData ? 'Cliente e aprovação' : 'Cliente',
    fields ? `<div class="grid">${fields}</div>` : '',
  )
}

function renderGuestsSection(voucher: VoucherEmitido, protectSensitiveData: boolean): string {
  const guests = normalizedGuests(voucher)
  if (!guests.length) return ''
  const hasDetails = guests.some((guest) => guest.papel || guest.codigo || guest.documento || guest.email || guest.telefone || guest.quarto)
  if (!hasDetails) {
    return section('Hóspedes', `<div class="grid">${field('Nome(s)', guests.map((guest) => guest.nome).join(', '), 'full')}</div>`)
  }
  const rows = guests.map((guest) => `<tr>
    <td>${escapeHtml(guest.nome)}</td>
    <td>${escapeHtml(guest.papel || (guest.principal ? 'Responsável' : ''))}</td>
    <td>${escapeHtml(guest.codigo || '')}</td>
    <td>${escapeHtml(protectSensitiveData && guest.documento ? maskDocument(guest.documento) : guest.documento || '')}</td>
    <td>${escapeHtml(joinValues([guest.email || '', guest.telefone || '']) || '')}</td>
    <td>${escapeHtml(guest.quarto ? String(guest.quarto) : '')}</td>
  </tr>`).join('')
  return section('Hóspedes', `<table>
    <thead><tr><th>Nome</th><th>Papel</th><th>Código</th><th>Documento</th><th>Contato</th><th>Quarto</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`)
}

function renderHotelSection(voucher: VoucherEmitido, checkIn?: string, checkOut?: string): string {
  const hotelFields = [
    field('Hotel', voucher.hotel_nome, 'full'),
    field('Endereço', voucher.hotel_endereco),
    field('Cidade', voucher.hotel_cidade),
    field('Telefone', voucher.hotel_telefone),
    field('E-mail', voucher.hotel_email),
    field('Check-in', formatDateTimeBR(checkIn)),
    field('Check-out', formatDateTimeBR(checkOut)),
    field('Noites', numberText(voucher.noites)),
    field('Apartamentos', numberText(voucher.num_apartamentos)),
    field('Hóspedes', numberText(voucher.num_hospedes)),
    field('Acomodação', voucher.tipo_apartamento),
    field('Categoria', voucher.hotel_categoria),
    field('Regime de alimentação', voucher.regime),
  ].join('')
  const rooms = renderRooms(voucher.quartos)
  return section('Hotel e hospedagem', `${hotelFields ? `<div class="grid">${hotelFields}</div>` : ''}${rooms}`)
}

function renderServiceSection(voucher: VoucherEmitido): string {
  if (voucher.tipo === 'Hotel') return ''

  if (voucher.tipo === 'Aéreo') {
    if (voucher.trechos_aereos?.length) {
      const segmentRows = voucher.trechos_aereos.map((segment) => `<tr>
        <td><strong>Sai:</strong> ${escapeHtml(formatDateTimeBR(segment.saida_em) || '')}<br /><strong>Chega:</strong> ${escapeHtml(formatDateTimeBR(segment.chegada_em) || '')}</td>
        <td>${escapeHtml(joinValues([segment.origem_codigo, segment.origem_nome || '']) || '')}<br />→ ${escapeHtml(joinValues([segment.destino_codigo, segment.destino_nome || '']) || '')}</td>
        <td>${escapeHtml(segment.companhia_nome)}<br />${escapeHtml(`${segment.companhia_codigo} ${segment.numero_voo}`)}</td>
        <td>${escapeHtml(joinValues([segment.cabine, segment.classe_reserva]) || '')}</td>
        <td>${escapeHtml(`${segment.bagagens} volume(s)`)}</td>
      </tr>`).join('')
      const ticketRows = voucher.bilhetes_aereos?.map((ticket) => `<tr>
        <td>${escapeHtml(ticket.passageiro_nome)}</td>
        <td>${escapeHtml(ticket.numero_bilhete)}</td>
        <td>${escapeHtml(`${ticket.companhia_nome} (${ticket.companhia_codigo})`)}</td>
      </tr>`).join('') || ''
      const reservationFields = [
        field('Sistema de reserva', voucher.sistema_reserva),
        field('Localizador', voucher.localizador),
        field('Prazo de emissão', formatDateTimeBR(voucher.prazo_emissao)),
      ].join('')
      return section('Itinerário aéreo', `
        <table>
          <thead><tr><th>Data e hora</th><th>Trecho</th><th>Companhia / voo</th><th>Classe</th><th>Bagagem</th></tr></thead>
          <tbody>${segmentRows}</tbody>
        </table>
        ${reservationFields ? `<div class="grid" style="margin-top: 10px">${reservationFields}</div>` : ''}
        ${ticketRows ? `<h3 class="section-title" style="margin-top: 12px">Bilhetes emitidos</h3><table><thead><tr><th>Passageiro</th><th>Número</th><th>Companhia emissora</th></tr></thead><tbody>${ticketRows}</tbody></table>` : ''}
      `)
    }
    const fields = [
      field('Companhia aérea', voucher.cia_aerea),
      field('Voo', voucher.numero_voo),
      field('Origem', voucher.origem),
      field('Destino', voucher.destino),
      field('Ida', formatDateTimeBR(voucher.data_ida)),
      field('Volta', formatDateTimeBR(voucher.data_volta)),
      field('Classe', voucher.classe),
    ].join('')
    return section('Dados do voo', fields ? `<div class="grid">${fields}</div>` : '')
  }

  if (voucher.tipo === 'Carro') {
    const fields = [
      field('Locadora', voucher.locadora),
      field('Categoria', voucher.categoria_carro),
      field('Retirada', voucher.retirada_local),
      field('Data da retirada', formatDateTimeBR(voucher.retirada_data)),
      field('Devolução', voucher.devolucao_local),
      field('Data da devolução', formatDateTimeBR(voucher.devolucao_data)),
    ].join('')
    return section('Dados da locação', fields ? `<div class="grid">${fields}</div>` : '')
  }

  const fields = [
    field('Origem', voucher.origem),
    field('Destino', voucher.destino),
    field('Início', formatDateTimeBR(voucher.data_ida)),
    field('Fim', formatDateTimeBR(voucher.data_volta)),
    field('Classe / categoria', voucher.classe),
  ].join('')
  return section('Dados do serviço', fields ? `<div class="grid">${fields}</div>` : '')
}

function renderRooms(rooms?: VoucherQuartoDetalhe[]): string {
  if (!rooms?.length) return ''
  const rows = rooms.map((room) => `<tr>
    <td>${escapeHtml(String(room.numero))}</td>
    <td>${escapeHtml(room.acomodacao || '')}</td>
    <td>${escapeHtml(room.categoria || '')}</td>
    <td>${escapeHtml(room.regime || '')}</td>
    <td>${escapeHtml(joinValues(room.hospedes) || '')}</td>
  </tr>`).join('')
  return `<table${rooms.length ? ' style="margin-top: 10px"' : ''}>
    <thead><tr><th>Quarto</th><th>Acomodação</th><th>Categoria</th><th>Regime</th><th>Hóspedes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function renderSupplierSection(voucher: VoucherEmitido, showAdministrativeData: boolean): string {
  const fields = [
    field('Fornecedor operacional', voucher.fornecedor_nome, 'full'),
    ...(showAdministrativeData ? [
      field('Código', voucher.fornecedor_codigo),
      field('Canal da reserva', voucher.canal_reserva),
    ] : []),
    field('Endereço', voucher.fornecedor_endereco),
    field('Cidade', voucher.fornecedor_cidade),
    field('Telefone', voucher.fornecedor_telefone),
    field('E-mail', voucher.fornecedor_email),
  ].join('')
  return section('Fornecedor da reserva', fields ? `<div class="grid">${fields}</div>` : '')
}

function renderConfirmationSection(voucher: VoucherEmitido, showAdministrativeData: boolean): string {
  const fields = [
    field('Localizador', voucher.localizador),
    field(
      'Número de confirmação',
      voucher.numero_confirmacao === voucher.localizador ? undefined : voucher.numero_confirmacao,
    ),
    ...(showAdministrativeData ? [
      field('Reserva', voucher.reserva_id),
      field('Data da reserva', formatDateTimeBR(voucher.data_reserva)),
      field('Data da confirmação', formatDateTimeBR(voucher.data_confirmacao)),
      field('Confirmado por', voucher.confirmado_por),
    ] : []),
  ].join('')
  return section('Confirmação da reserva', fields ? `<div class="grid">${fields}</div>` : '')
}

function renderFinancialSection(
  voucher: VoucherEmitido,
  showConfirmedValues: boolean,
  showAdministrativeData: boolean,
): string {
  const currency = normalizedCurrency(voucher.moeda)
  const roomCount = voucher.num_apartamentos || voucher.quartos?.length
  const dailyLabel = voucher.noites && roomCount
    ? `Diária × ${voucher.noites} noite${voucher.noites === 1 ? '' : 's'} × ${roomCount} quarto${roomCount === 1 ? '' : 's'}`
    : 'Valor da diária'
  const rows = showConfirmedValues ? [
    moneyRow(dailyLabel, voucher.valor_diaria, currency),
    moneyRow('Taxas por diária', voucher.taxas_diaria, currency),
    moneyRow('Tarifa total', voucher.tarifa_total, currency),
    moneyRow('Taxas', voucher.taxas, currency),
    moneyRow('RAV', voucher.rav, currency),
    moneyRow('RAC', voucher.rac, currency),
    moneyRow('Tarifa de referência', voucher.tarifa_referencia, currency),
    moneyRow('Taxa de serviço / RAC', voucher.taxa_servico, currency),
    moneyRow('Total', voucher.total, currency, 'total-row'),
  ].join('') : ''
  const paymentFields = showAdministrativeData ? [
    field('Forma de pagamento', voucher.forma_pagamento_voucher),
    field('Referência do pagamento', voucher.referencia_pagamento),
    field('Condições de pagamento', voucher.condicoes_pagamento, 'full'),
  ].join('') : ''
  const title = rows && paymentFields
    ? 'Valores e pagamento'
    : rows
      ? 'Valores confirmados'
      : 'Pagamento'
  return section(title, `${rows ? `<table class="money"><tbody>${rows}</tbody></table>` : ''}${paymentFields ? `<div class="grid" style="margin-top: 10px">${paymentFields}</div>` : ''}`)
}

function renderConditionsSection(voucher: VoucherEmitido): string {
  const refundability = voucher.reembolsavel === undefined
    ? undefined
    : voucher.reembolsavel ? 'Reembolsável' : 'Não reembolsável'
  const fields = [
    field('Condição', refundability),
    field('Prazo de cancelamento', formatDateTimeBR(voucher.prazo_cancelamento)),
    field('Política de cancelamento', voucher.politica_cancelamento, 'full'),
    field('Política de no-show', voucher.politica_no_show, 'full'),
  ].join('')
  if (!fields) return ''
  const warning = voucher.reembolsavel === false
    ? '<div class="warning">A reserva está marcada como não reembolsável. Consulte as condições antes de cancelar ou alterar.</div>'
    : ''
  return section('Cancelamento e condições', `<div class="grid">${fields}</div>${warning}`)
}

function textSection(title: string, value?: string): string {
  if (!hasText(value)) return ''
  return section(title, `<div class="value">${escapeHtml(value)}</div>`)
}

function section(title: string, content: string): string {
  if (!content.trim()) return ''
  return `<section class="section"><h2 class="section-title">${escapeHtml(title)}</h2>${content}</section>`
}

function field(label: string, value?: string, extraClass = ''): string {
  if (!hasText(value)) return ''
  return `<div class="field ${escapeHtml(extraClass)}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
}

function moneyRow(label: string, value: number | undefined, currency?: string, extraClass = ''): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return ''
  return `<tr class="${escapeHtml(extraClass)}"><td>${escapeHtml(label)}</td><td>${escapeHtml(formatMoney(value, currency))}</td></tr>`
}

function normalizedGuests(voucher: VoucherEmitido): VoucherHospedeDetalhe[] {
  if (voucher.hospedes_detalhes?.length) return voucher.hospedes_detalhes.filter((guest) => hasText(guest.nome))
  const names = voucher.passageiros?.filter(hasText) || []
  if (names.length) {
    return names.map((nome, index) => ({
      nome,
      principal: index === 0,
      documento: index === 0 ? voucher.cpf : undefined,
    }))
  }
  return hasText(voucher.passageiro_nome)
    ? [{ nome: voucher.passageiro_nome, principal: true, documento: voucher.cpf }]
    : []
}

function joinValues(values?: string[]): string | undefined {
  const normalized = values?.filter(hasText)
  return normalized?.length ? normalized.join(', ') : undefined
}

function numberText(value?: number): string | undefined {
  return value === undefined || value === null || !Number.isFinite(value) ? undefined : String(value)
}

function normalizedCurrency(value?: string): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

function formatMoney(value: number, currency?: string): string {
  if (currency) {
    try {
      return value.toLocaleString('pt-BR', { style: 'currency', currency })
    } catch {
      // Mantém o valor legível quando uma moeda legada não é reconhecida pelo runtime.
    }
  }
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTimeBR(value?: string): string | undefined {
  if (!hasText(value)) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateBR(value, value)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed)
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function maskDocument(value: string): string {
  const normalized = value.trim()
  if (normalized.includes('*')) return normalized
  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
  if (normalized.length <= 4) return '***'
  return `${normalized.slice(0, 2)}${'*'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-2)}`
}
