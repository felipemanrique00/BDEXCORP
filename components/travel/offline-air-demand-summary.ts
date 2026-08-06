import type { OfflineAirDemandSummary } from '@/components/travel/services/air'
import type { Atendimento } from '@/types'

export function atendimentoToOfflineAirDemandSummary(
  demand: Atendimento,
  companyName: string,
): OfflineAirDemandSummary {
  const details = demand.detalhes_aereo || {}
  const requestedSegments = [...(details.trechos || [])]
    .sort((left, right) => left.sequence - right.sequence)
    .map((segment, index) => {
      const origin = parseAirport(segment.origin)
      const destination = parseAirport(segment.destination)
      return {
        id: `${demand.id}:segment:${segment.sequence || index + 1}`,
        originCode: origin.code,
        originName: origin.name,
        destinationCode: destination.code,
        destinationName: destination.name,
        departureDate: String(segment.departure_date || '').slice(0, 10),
        preferredPeriod: requestedPeriod(segment.earliest_time, segment.latest_time),
      }
    })

  if (!requestedSegments.length && (details.origem || details.destino || details.data_ida)) {
    const origin = parseAirport(details.origem)
    const destination = parseAirport(details.destino)
    requestedSegments.push({
      id: `${demand.id}:segment:1`,
      originCode: origin.code,
      originName: origin.name,
      destinationCode: destination.code,
      destinationName: destination.name,
      departureDate: String(details.data_ida || '').slice(0, 10),
      preferredPeriod: undefined,
    })
    if (details.data_volta) {
      requestedSegments.push({
        id: `${demand.id}:segment:2`,
        originCode: destination.code,
        originName: destination.name,
        destinationCode: origin.code,
        destinationName: origin.name,
        departureDate: String(details.data_volta).slice(0, 10),
        preferredPeriod: undefined,
      })
    }
  }

  return {
    id: demand.id,
    number: demand.serial_os || demand.id,
    companyName,
    requesterName: demand.solicitante_nome,
    requestedCabin: details.classe,
    preferredAirlines: details.preferred_airlines || [],
    passengers: demand.passageiro_nome
      ? [{ id: demand.funcionario_id || undefined, name: demand.passageiro_nome, type: 'adulto' }]
      : [],
    requestedSegments,
  }
}

function parseAirport(value: string | undefined): { code?: string; name: string } {
  const normalized = String(value || '').trim()
  const trailingCode = /^(.*?)\s*\(([A-Z]{3})\)$/i.exec(normalized)
  if (trailingCode) {
    return { code: trailingCode[2].toUpperCase(), name: trailingCode[1].trim() }
  }
  const leadingCode = /^\(?([A-Z]{3})\)?(?:\s*[-–—]\s*|\s+|$)(.*)$/i.exec(normalized)
  if (leadingCode) {
    return {
      code: leadingCode[1].toUpperCase(),
      name: leadingCode[2].trim() || leadingCode[1].toUpperCase(),
    }
  }
  return { name: normalized }
}

function requestedPeriod(earliest: string | undefined, latest: string | undefined): string | undefined {
  const start = String(earliest || '').slice(0, 5)
  const end = String(latest || '').slice(0, 5)
  if (start && end) return `${start}–${end}`
  if (start) return `a partir de ${start}`
  if (end) return `até ${end}`
  return undefined
}
