// ============================================================
// PARSER DE VOUCHER BBT — adaptador (V13)
//
// Esse módulo era um parser independente (V7). Foi convertido em
// ADAPTER fino sobre `lib/voucher-parser.ts` (versão canônica V4)
// para evitar dois motores de parsing divergentes.
//
// Mantém a mesma assinatura pública (`parseVoucherBBT` + interface
// `VoucherParsed`) usada pelo `app/dashboard/importar/page.tsx`.
//
// Para novos códigos: importe de `@/lib/voucher-parser` direto.
// ============================================================

import {
  parseVoucher as parseVoucherCanonical,
  parseVoucherFileName,
  parseVoucherContent,
  extractTextFromPDF,
  type VoucherParsed as VoucherCanonical,
} from './voucher-parser'

export interface VoucherParsed {
  voucher_numero: string
  data_emissao: string
  hotel_nome: string
  hotel_endereco: string
  hotel_cidade: string
  hotel_telefone: string
  cliente_nome: string
  num_apartamentos: number
  categoria: string
  tipo_apartamento: string
  data_checkin: string
  data_checkout: string
  noites: number
  num_hospedes: number
  tipo_pagamento: string
  regime_alimentacao: string
  numero_confirmacao: string
  data_confirmacao: string
  confirmado_por: string
  cadastrado_por: string
  observacoes: string
  warnings: string[]
}

function adapt(canonical: VoucherCanonical): VoucherParsed {
  const warnings: string[] = []
  if (!canonical.voucher_numero) warnings.push('Número do voucher não encontrado')
  if (!canonical.passageiro) warnings.push('Nome do hóspede não encontrado')
  if (!canonical.data_checkin) warnings.push('Data de check-in não encontrada')
  if (!canonical.data_checkout) warnings.push('Data de check-out não encontrada')

  return {
    voucher_numero: canonical.voucher_numero || '',
    data_emissao: canonical.data_emissao || '',
    hotel_nome: canonical.hotel || '',
    hotel_endereco: canonical.endereco || '',
    hotel_cidade: canonical.cidade || '',
    hotel_telefone: canonical.telefone_hotel || '',
    cliente_nome: canonical.passageiro || '',
    num_apartamentos: canonical.num_apts || 1,
    categoria: canonical.categoria || '',
    tipo_apartamento: canonical.tipo_apto_texto || canonical.tipo_apto || '',
    data_checkin: canonical.data_checkin || '',
    data_checkout: canonical.data_checkout || '',
    noites: canonical.noites || 0,
    num_hospedes: canonical.num_hospedes || 0,
    tipo_pagamento: canonical.tipo_pagamento || '',
    regime_alimentacao: canonical.regime_alimentacao || '',
    numero_confirmacao: canonical.confirmacao_numero || '',
    data_confirmacao: '',
    confirmado_por: canonical.confirmado_por || '',
    cadastrado_por: '',
    observacoes: '',
    warnings,
  }
}

export async function parseVoucherBBT(file: File): Promise<VoucherParsed> {
  const canonical = await parseVoucherCanonical(file)
  return adapt(canonical)
}

export { parseVoucherFileName, parseVoucherContent, extractTextFromPDF }
