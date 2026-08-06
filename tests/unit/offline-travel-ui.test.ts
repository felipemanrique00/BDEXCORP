import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const reservationsPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/reservas/page.tsx'),
  'utf8',
)
const offlineForm = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-travel-operation-form.tsx'),
  'utf8',
)
const offlineWorkspace = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-travel-workspace.tsx'),
  'utf8',
)
const offlineHotelQuoteForm = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-hotel-quote-form.tsx'),
  'utf8',
)
const offlineReservationRoute = readFileSync(
  resolve(process.cwd(), 'app/api/offline-travel/reservations/[id]/route.ts'),
  'utf8',
)
const travelGovernanceService = readFileSync(
  resolve(process.cwd(), 'lib/server/travel-governance-service.ts'),
  'utf8',
)
const offlineTravelService = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
  'utf8',
)
const vouchersPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/vouchers/page.tsx'),
  'utf8',
)
const voucherDetailPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/vouchers/[id]/page.tsx'),
  'utf8',
)
const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8')
const stagingCompose = readFileSync(
  resolve(process.cwd(), 'docker-compose.staging.yml'),
  'utf8',
)
const stagingEnvironmentExample = readFileSync(
  resolve(process.cwd(), '.env.staging.example'),
  'utf8',
)

describe('offline travel UI wiring', () => {
  it('keeps the existing connector flow as the default and gates the offline form locally', () => {
    expect(reservationsPage).toContain("useState<'online' | 'offline'>('online')")
    expect(reservationsPage).toContain("process.env.NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED === 'true'")
    expect(reservationsPage).toContain("operationChannel === 'online'")
    expect(reservationsPage).toContain('<OfflineTravelWorkspace')
    expect(reservationsPage).toContain('Atendimento offline / manual')
  })

  it('injects the staging offline flag during the image build and at runtime', () => {
    const buildArgument = 'ARG NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED=false'
    const buildEnvironment = 'ENV NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED=${NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED}'
    const requiredStagingFlag = 'NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED: ${NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED:?Defina NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED}'

    expect(dockerfile).toContain(buildArgument)
    expect(dockerfile).toContain(buildEnvironment)
    expect(dockerfile.indexOf(buildArgument)).toBeLessThan(dockerfile.indexOf('RUN npm run build'))
    expect(dockerfile.indexOf(buildEnvironment)).toBeLessThan(dockerfile.indexOf('RUN npm run build'))
    expect(stagingCompose.match(new RegExp(requiredStagingFlag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2)
    expect(stagingEnvironmentExample).toContain('NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED=true')
  })

  it('supports reservation, issuance and safe correction of an existing offline reservation', () => {
    expect(offlineForm).toContain("'reservation' | 'reservation_and_issue' | 'issue_existing' | 'correct_existing'")
    expect(offlineForm).toContain('createOfflineReservationFromServer')
    expect(offlineForm).toContain('issueOfflineReservationFromServer')
    expect(offlineForm).toContain('correctOfflineReservationFromServer')
    expect(offlineForm).toContain('Motivo da correção *')
    expect(offlineForm).toContain('sumMoneyInputs(grossAmount, taxAmount)')
    expect(offlineForm).toContain('readOnly aria-readonly="true"')
    expect(offlineForm).toContain('Gerar voucher automaticamente')
    expect(offlineForm).toContain('Confirmação humana obrigatória')
  })

  it('shows the seven governed offline stages in order', () => {
    for (const stage of ['Solicitação', 'Cotações', 'Escolha', 'Aprovação', 'Reserva', 'Emissão', 'Voucher']) {
      expect(offlineWorkspace).toContain(`'${stage}'`)
    }
    expect(offlineWorkspace).toContain('stageFromContext(context)')
  })

  it('connects hotel, air quotation and reservation to the same demand context', () => {
    expect(offlineWorkspace).toContain('<OfflineHotelQuoteForm')
    expect(offlineWorkspace).toContain('<OfflineAirQuoteWorkspace')
    expect(offlineWorkspace).toContain('Cotação de hotel')
    expect(offlineWorkspace).toContain('Cotação aérea')
    expect(offlineWorkspace).toContain('Reserva, emissão e correção')
    expect(offlineWorkspace.match(/initialDemandId=\{sharedDemandId \|\| undefined\}/g)).toHaveLength(3)
    expect(offlineHotelQuoteForm).toContain('onContextChange?.({')
    expect(offlineForm).toContain('appliedInitialDemandRef')
    expect(reservationsPage).toContain('getDemandFromServer(atendimentoId)')
    expect(reservationsPage).toContain("listDemandsFromServer({ search: serial, limit: 20 })")
  })

  it('allows a hotel quote with one option and removes only additional drafts', () => {
    expect(offlineHotelQuoteForm).toContain('const MIN_OPTIONS = 1')
    expect(offlineHotelQuoteForm).toContain('return [emptyOption(1)]')
    expect(offlineHotelQuoteForm).toContain('canRemove={options.length > MIN_OPTIONS}')
    expect(offlineHotelQuoteForm).toContain('Cadastre de uma a dez alternativas.')
    expect(offlineHotelQuoteForm).toContain('A cotação deve manter pelo menos uma opção.')
    expect(offlineHotelQuoteForm).not.toContain('A cotação deve manter pelo menos duas opções.')
  })

  it('prefills one editable quotation option per available requester preference only once', () => {
    expect(offlineHotelQuoteForm).toContain('hotelDemandPreferredHotelIds(selectedDemand.detalhes_hotel)')
    expect(offlineHotelQuoteForm).toContain('buildPreferredHotelQuoteDrafts({')
    expect(offlineHotelQuoteForm).toContain('preparedDemandRef.current !== selectedDemand.id')
    expect(offlineHotelQuoteForm).toContain('prepared.drafts.map((draft, index) => ({')
    expect(offlineHotelQuoteForm).toContain('...emptyOption(index + 1)')
    expect(offlineHotelQuoteForm).toContain('...draft')
    expect(offlineHotelQuoteForm).toContain('setOptions(preparedOptions)')
    expect(offlineHotelQuoteForm).toContain('prepared.unavailableHotelIds.length')

    // Hotel and suggested room are prefilled, while every commercial field remains editable.
    expect(offlineHotelQuoteForm).toContain('onChange={(event) => onSelectHotel(event.target.value)}')
    expect(offlineHotelQuoteForm).toContain("onChange={(event) => onPatch({ roomCategory: event.target.value })}")
    expect(offlineHotelQuoteForm).toContain('onChange={(value) => onPatch({ nightlyRate: value })}')
    expect(offlineHotelQuoteForm).toContain("onChange={(event) => onPatch({ cancellationPolicy: event.target.value })}")
  })

  it('exposes GET and PATCH with optimistic concurrency and immutable issuance guards', () => {
    expect(offlineReservationRoute).toContain('export async function GET')
    expect(offlineReservationRoute).toContain('export async function PATCH')
    expect(offlineTravelService).toContain('STALE_RESERVATION_VERSION')
    expect(offlineTravelService).toContain('offline_reservation_revisions')
    expect(offlineTravelService).toContain('previousSnapshot')
    expect(offlineTravelService).toContain('nextSnapshot')
    expect(offlineTravelService).toContain("reservation.status !== 'reserved'")
  })

  it('binds the company and service to the selected OS and does not expose unsafe partial issuance', () => {
    expect(offlineForm).toContain('companyId: selectedDemand.empresa_id')
    expect(offlineForm).toContain('disabled={Boolean(selectedDemand)}')
    expect(offlineForm).toContain(".filter((reservation) => reservation.status === 'reserved')")
    expect(offlineForm).not.toContain('Emissão parcial')
    expect(offlineForm).not.toContain('setPartial')
  })

  it('loads relational demands so an authorized user can continue a request created in another session', () => {
    expect(reservationsPage).toContain('listDemandsFromServer({ limit: 200 })')
    expect(reservationsPage).toContain('result.items.map((item) => item.demand)')
    expect(reservationsPage).toContain('relationalDemands.forEach((item) => merged.set(item.id, item))')
  })

  it('keeps requester views read-only and hides internal identifiers from the operational table', () => {
    expect(reservationsPage).toContain('canAccessOperationalWorkspace')
    expect(reservationsPage).toContain('Acompanhe suas solicitações')
    expect(reservationsPage).toContain('if (!canOperateQuotes)')
    expect(reservationsPage).toContain('providerDisplayName(item.provider)')
    expect(reservationsPage).toContain('visibleProviderReference(item.providerReference)')
    expect(reservationsPage).toContain('optionCountLabel(item.optionCount)')
    expect(reservationsPage).toContain("return 'Período não informado'")
    expect(reservationsPage).not.toContain('{item.companyId}</div>')
    expect(reservationsPage).not.toContain('{item.id} · histórico legado')
  })

  it('loads and preserves the hotel option formally chosen before reservation', () => {
    expect(offlineForm).toContain('listOfflineHotelQuotesFromServer(demand.id)')
    expect(offlineForm).toContain('item.id === quote.selectedOptionId || item.selected')
    expect(offlineForm).toContain('Hotel escolhido pelo solicitante')
    expect(offlineForm).toContain('data-selected-hotel-quote={option.id}')
    expect(offlineForm).toContain("selectionStatus: option.selectionStatus")
    expect(offlineForm).toContain('quoteOptionId: option.id')
  })

  it('locks approved hotel, stay and price fields while allowing an operational supplier divergence', () => {
    expect(offlineForm).toContain('const locksSelectedHotelQuote = createsReservation && Boolean(selectedHotelQuote)')
    expect(offlineForm).toContain("['itemName', 'destination', 'accommodation', 'mealPlan', 'category']")
    expect(offlineForm).toContain('readOnly={quoteFieldLocked}')
    expect(offlineForm).toContain('readOnly={locksSelectedHotelQuote}')
    expect(offlineForm).toContain('Fornecedor operacional *')
    expect(offlineForm).toContain('Fornecedor cotado:')
    expect(offlineForm).toContain('O fornecedor operacional diverge do cotado')
    expect(offlineForm).toContain('setSupplierName(option.supplierName)')
    expect(offlineForm).toContain("option.approvalStatus !== 'approved'")
    expect(offlineForm).toContain("if (approvalStatus === 'approved') return 'Escolha aprovada'")
    expect(offlineForm).toContain('option.breakdown.roomSubtotal + option.breakdown.serviceFee')
    expect(offlineForm).toContain('setTaxAmount(moneyInput(option.breakdown.taxesSubtotal))')
    expect(offlineForm).toContain('const requiresSelectedCommercialQuote = Boolean(')
    expect(offlineForm).toContain("['hotelaria', 'aereo'].includes(serviceKey)")
    expect(offlineForm).toContain('requiresSelectedCommercialQuote && !selectedHotelQuote && !selectedAirQuote')
    expect(offlineForm).toContain('Carregue a opção escolhida e aprovada antes de registrar a reserva.')
    expect(offlineForm).toContain('isOfflineDemandEligibleForOperation')
    expect(offlineTravelService).toContain('OFFLINE_APPROVED_SELECTION_REQUIRED')
    expect(offlineTravelService).toContain('loadApprovedOfflineQuoteSelection')
  })

  it('locks approved hotel guests outside the audited correction path and hides technical metadata from common users', () => {
    expect(offlineForm).toContain("const locksSelectedHotelGuests = locksSelectedHotelQuote && serviceKey === 'hotelaria'")
    expect(offlineForm).toContain("hotelGuestNames(selectedDemand).join('\\n')")
    expect(offlineForm).toContain('readOnly={locksSelectedHotelGuests}')
    expect(offlineForm).toContain('Para alterar, use a correção da reserva com motivo e auditoria.')
    expect(offlineForm).toContain('travelLifecycleStatusLabel(selectedDemand.relational_lifecycle_status || selectedDemand.status)')
    expect(offlineForm).toContain('{showTechnicalMetadata && (')
    expect(offlineForm).toContain('Versão técnica:')
  })

  it('keeps date-time fields synchronized and lists reservations with the real company columns', () => {
    expect(offlineForm).toContain('onInput={(event) => setStartsAt(event.currentTarget.value)}')
    expect(offlineForm).toContain('onInput={(event) => setEndsAt(event.currentTarget.value)}')
    expect(offlineForm).toContain('onInput={(event) => setIssuedAt(event.currentTarget.value)}')
    expect(travelGovernanceService).toContain('coalesce(company.trade_name, company.legal_name) as company_name')
    expect(travelGovernanceService).not.toContain('company.name as company_name')
  })

  it('keeps relational vouchers visible and formats ISO confirmation dates safely', () => {
    expect(vouchersPage).toContain('setServerVouchers(result.items as VoucherEmitido[])')
    expect(vouchersPage).toContain('for (const voucher of serverVouchers)')
    expect(vouchersPage).toContain('setServerVouchers((current) => current.filter((item) => item.id !== v.id))')
    expect(voucherDetailPage).toContain("formatDateBR as formatDateValueBR")
    expect(voucherDetailPage).toContain('return formatDateValueBR(value')
  })

  it('refreshes lifecycle state after approval handoff and binds approvals to the offline intent', () => {
    expect(offlineForm).toContain("operationalError.code?.includes('APPROVAL')")
    expect(offlineForm).toContain('if (approvalStateChanged) onCompleted()')
    expect(offlineTravelService).toContain('subject.offlineOperation === true')
    expect(offlineTravelService).toContain('subject.offlineIntentHash !== intentHash')
    expect(offlineTravelService).toContain('subject_snapshot from approval_instances')
  })
})
