import type { TechEmissionRecord } from '@/lib/integrations/tech/tech-emissions-types'
import {
  VOUCHER_PREFIX,
  type Atendimento,
  type VoucherEmitido,
  type VoucherTipo,
} from '@/types'

export interface ImportedEmissionVoucherLine {
  venda_numero: string
  data_venda: string
  passageiro: string
  tipo_servico: Atendimento['tipo_servico']
  total: number
  status: string
  cod_emissor?: string
  descricao?: string
  produto?: string
  tech?: TechEmissionRecord
}

export function voucherFromImportedEmission(
  line: ImportedEmissionVoucherLine,
  demand: Atendimento,
  employeeId: string | null,
  source: 'xlsx' | 'pdf' | 'tech',
  actor: { id: string; name: string },
  now = new Date(),
): VoucherEmitido {
  const type = emissionVoucherType(line.tipo_servico)
  const firstSegment = line.tech?.segments[0]
  const lastSegment = line.tech?.segments.at(-1)
  const provider = line.tech?.supplier || line.produto || line.descricao || line.tipo_servico
  const stableIdentity = [
    source,
    demand.empresa_id,
    line.tech?.externalId || '',
    line.venda_numero,
    line.passageiro,
    line.tipo_servico,
    provider,
  ].join('|')
  const stableHash = stableUnsignedHash(stableIdentity)
  const number = `${source === 'tech' ? 'T' : 'E'}${stableHash}`
  const cancelled = line.status === 'CA' || line.tech?.cancelled === true
  const confirmed = Boolean(line.tech?.locator || line.tech?.ticket || line.status === 'CF')
  const createdAt = now.toISOString()

  return {
    id: `${VOUCHER_PREFIX[type]}-${number}`,
    numero: number,
    tipo: type,
    status: cancelled ? 'cancelado' : confirmed ? 'confirmado' : 'emitido',
    atendimento_id: demand.id,
    empresa_id: demand.empresa_id,
    funcionario_id: employeeId,
    passageiro_nome: line.passageiro,
    passageiros: [line.passageiro],
    fornecedor_nome: provider,
    fornecedor_cidade: line.tech?.route || firstSegment?.destination,
    data_checkin: type === 'Hotel' ? dateOnly(firstSegment?.departureAt) : undefined,
    data_checkout: type === 'Hotel' ? dateOnly(lastSegment?.arrivalAt) : undefined,
    valor_diaria: type === 'Hotel' ? line.tech?.hotelDailyRate : undefined,
    cia_aerea: type === 'Aéreo' ? line.tech?.supplier || line.produto : undefined,
    numero_voo: type === 'Aéreo' ? firstSegment?.flightNumber : undefined,
    origem: type === 'Aéreo' ? firstSegment?.origin : undefined,
    destino: type === 'Aéreo' || type === 'Pacote'
      ? lastSegment?.destination || firstSegment?.destination || line.tech?.route
      : undefined,
    data_ida: type === 'Aéreo' || type === 'Pacote'
      ? dateOnly(firstSegment?.departureAt) || line.data_venda
      : undefined,
    data_volta: type === 'Aéreo' || type === 'Pacote'
      ? dateOnly(lastSegment?.departureAt)
      : undefined,
    localizador: type === 'Aéreo' ? line.tech?.locator : undefined,
    numero_confirmacao: line.tech?.locator || line.tech?.ticket || line.venda_numero,
    data_confirmacao: dateOnly(line.tech?.issuedAt) || line.data_venda,
    confirmado_por: line.tech?.issuer || line.cod_emissor || actor.name,
    tarifa_total: Math.max(0, line.total),
    taxas: line.tech ? Math.max(0, line.tech.customerTaxes) : undefined,
    total: Math.max(0, line.total),
    centro_custo: line.tech?.costCenter,
    numero_solicitacao: line.tech?.osNumber,
    observacoes: [
      `Importado de emissao ${source === 'tech' ? 'Tech Travel' : source.toUpperCase()}`,
      line.descricao,
    ].filter(Boolean).join(' | '),
    observacoes_internas: [
      `demand_id=${demand.id}`,
      `sale_number=${line.venda_numero}`,
      line.tech?.externalId ? `tech_external_id=${line.tech.externalId}` : '',
    ].filter(Boolean).join(' | '),
    origem_voucher: 'importado',
    importado_em: createdAt,
    fingerprint: `emission_voucher|${stableHash}|${normalizeFingerprint(stableIdentity)}`,
    emitido_por_user_id: actor.id,
    emitido_por_user_name: actor.name,
    created_at: createdAt,
  }
}

function emissionVoucherType(service: Atendimento['tipo_servico']): VoucherTipo {
  if (service === 'Hotel') return 'Hotel'
  if (service === 'Aéreo') return 'Aéreo'
  if (service === 'Carro') return 'Carro'
  return 'Pacote'
}

function stableUnsignedHash(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return String(hash >>> 0)
}

function normalizeFingerprint(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function dateOnly(value?: string): string | undefined {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0]
}
