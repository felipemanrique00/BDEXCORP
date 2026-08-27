'use client'

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { OfflineTravelOperationForm } from '@/components/travel/offline-travel-operation-form'
import { corporateDemandAsAtendimento, type CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import type { OfflineGroundQuoteService } from '@/lib/offline-ground/quote-schema'
import { listTravelReservationsFromServer } from '@/lib/travel/reservation-client'
import type { GovernedTravelReservationSummary } from '@/lib/travel/reservation-records'
import type { Empresa } from '@/types'

export interface GroundOperationWorkspaceProps {
  demand: CorporateDemandSnapshot
  company: Empresa
  service: OfflineGroundQuoteService
  onCompleted: () => void
}

export function GroundOperationWorkspace({
  demand,
  company,
  service,
  onCompleted,
}: GroundOperationWorkspaceProps) {
  const lifecycleStatus = String(demand.relational_lifecycle_status || '').trim().toLowerCase()
  const initialOperation = ['reserved', 'pending_issuance'].includes(lifecycleStatus)
    ? 'issue_existing'
    : 'reservation'
  const [reservations, setReservations] = useState<GovernedTravelReservationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const result = await listTravelReservationsFromServer({
        companyId: company.id,
        demandId: demand.id,
        limit: 20,
      }, signal)
      setReservations(result.items)
    } catch (cause) {
      if (signal?.aborted) return
      setReservations([])
      setError(cause instanceof Error
        ? cause.message
        : `Nao foi possivel carregar a operacao de ${serviceLabel(service)}.`)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [company.id, demand.id, service])

  useEffect(() => {
    void reloadToken
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadToken])

  if (loading) {
    return (
      <div className="bbt-card flex min-h-44 items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando reserva e emissao de {serviceLabel(service)}...
      </div>
    )
  }

  if (error) {
    return (
      <div className="bbt-card flex min-h-44 flex-col items-center justify-center gap-3 border-red-200 p-6 text-center text-red-700" role="alert">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">{error}</span>
        <button type="button" className="bbt-button-outline" onClick={() => setReloadToken((value) => value + 1)}>
          <RefreshCw className="h-4 w-4" />Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div data-company-portal-ground-operation={service}>
      <OfflineTravelOperationForm
        demands={[corporateDemandAsAtendimento(demand)]}
        companies={[company]}
        reservations={reservations}
        initialDemandId={demand.id}
        initialOperation={initialOperation}
        corporateMode
        onCompleted={() => {
          setReloadToken((value) => value + 1)
          onCompleted()
        }}
      />
    </div>
  )
}

function serviceLabel(service: OfflineGroundQuoteService): string {
  return service === 'locacao' ? 'locacao de veiculo' : 'rodoviario'
}
