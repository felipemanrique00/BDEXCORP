import {
  BedDouble,
  Building2,
  CalendarDays,
  CircleDollarSign,
  MapPin,
  ReceiptText,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

import {
  extractApprovalBusinessSummary,
  extractHotelQuoteApprovalSummary,
  type ApprovalSubjectPresentation,
  type ApprovalPresentationContext,
  type ApprovalBusinessSummary,
  type HotelQuoteApprovalSummary,
} from '@/lib/approvals/subject-presentation'

export function ApprovalSubjectSummary({
  subject,
  context = {},
  presentation = null,
}: {
  subject: Record<string, unknown>
  context?: ApprovalPresentationContext
  presentation?: ApprovalSubjectPresentation | null
}) {
  const hotelQuote = presentation?.kind === 'hotel_quote'
    ? presentation.hotelQuote
    : extractHotelQuoteApprovalSummary(subject)
  if (hotelQuote) return <HotelQuoteSummary summary={hotelQuote} context={context} />
  const business = presentation?.kind === 'business'
    ? presentation.business
    : extractApprovalBusinessSummary(subject, context)
  return <GenericSubjectSummary summary={business} />
}

function HotelQuoteSummary({
  summary,
  context,
}: {
  summary: HotelQuoteApprovalSummary
  context: ApprovalPresentationContext
}) {
  return (
    <div className="mt-3 space-y-4">
      <section className="overflow-hidden rounded-lg border border-bbt-accent/30 bg-bbt-accent/5" aria-label="Resumo da cotação escolhida">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bbt-accent/20 p-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-bbt-accent">
              <ShieldCheck className="h-4 w-4" />
              Resumo para decisão
            </div>
            <h4 className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">
              {summary.demandNumber} · {summary.hotelName}
            </h4>
          </div>
          <div className="rounded-md bg-white px-3 py-2 text-right shadow-sm dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total escolhido</div>
            <div className="mt-0.5 text-xl font-bold text-bbt-primary dark:text-white">
              {formatMoney(summary.total, summary.currency)}
            </div>
          </div>
        </div>

        <dl className="grid gap-3 p-4 sm:grid-cols-2">
          {context.companyName && <BusinessDetail icon={Building2} label="Empresa" value={context.companyName} />}
          {context.requesterName && <BusinessDetail icon={UserRound} label="Solicitante" value={context.requesterName} />}
          <BusinessDetail icon={UserRound} label="Viajante / hóspede" value={summary.passengerName} />
          <BusinessDetail icon={MapPin} label="Destino" value={summary.destination} />
          <BusinessDetail
            icon={CalendarDays}
            label="Período"
            value={`${formatDate(summary.checkIn)} a ${formatDate(summary.checkOut)}`}
            helper={`${pluralize(summary.nights, 'diária', 'diárias')} · ${pluralize(summary.roomCount, 'quarto', 'quartos')}`}
          />
          <BusinessDetail
            icon={ReceiptText}
            label="Rodada de cotação"
            value={pluralize(summary.optionCount, 'opção apresentada', 'opções apresentadas')}
            helper={summary.expiresAt ? `Válida até ${formatDateTime(summary.expiresAt)}` : 'Validade não informada'}
          />
        </dl>
      </section>

      <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-800" aria-labelledby="chosen-hotel-title">
        <h4 id="chosen-hotel-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
          <Building2 className="h-4 w-4 text-bbt-accent" />
          Hotel escolhido
        </h4>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextDetail label="Hotel" value={summary.hotelName} />
          <TextDetail label="Categoria do hotel" value={summary.hotelCategory || 'Não informada'} />
          <TextDetail label="Acomodação" value={summary.roomCategory || 'Não informada'} />
          <TextDetail label="Regime de alimentação" value={summary.mealPlan || 'Não informado'} />
          <TextDetail label="Fornecedor" value={summary.supplierName || 'Não informado'} />
          <TextDetail label="Forma de pagamento" value={summary.paymentTerms || 'Não informada'} />
          {summary.hotelAddress && <TextDetail label="Endereço" value={summary.hotelAddress} />}
          {summary.hotelPhone && <TextDetail label="Telefone" value={summary.hotelPhone} />}
        </dl>
      </section>

      <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-800" aria-labelledby="quote-value-title">
        <h4 id="quote-value-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
          <CircleDollarSign className="h-4 w-4 text-bbt-accent" />
          Composição do valor
        </h4>
        <div className="mt-3 overflow-hidden rounded-md border border-bbt-gray-100 dark:border-slate-800">
          <MoneyRow
            label="Diárias"
            detail={`${formatMoney(summary.nightlyRate, summary.currency)} × ${summary.nights} × ${summary.roomCount}`}
            value={summary.roomSubtotal}
            currency={summary.currency}
          />
          <MoneyRow
            label="Taxas da hospedagem"
            detail={`${formatMoney(summary.nightlyTaxes, summary.currency)} × ${summary.nights} × ${summary.roomCount}`}
            value={summary.taxesSubtotal}
            currency={summary.currency}
          />
          <MoneyRow label="Taxa de serviço" value={summary.serviceFee} currency={summary.currency} />
          <MoneyRow label="Total selecionado" value={summary.total} currency={summary.currency} total />
        </div>
      </section>

      <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-800" aria-labelledby="approval-conditions-title">
        <h4 id="approval-conditions-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
          <BedDouble className="h-4 w-4 text-bbt-accent" />
          Condições para decisão
        </h4>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextDetail label="Tipo de tarifa" value={summary.refundable ? 'Reembolsável' : 'Não reembolsável'} />
          <TextDetail
            label="Prazo para cancelamento"
            value={summary.cancellationDeadline ? formatDateTime(summary.cancellationDeadline) : 'Não informado'}
            warning={!summary.cancellationDeadline}
          />
          <div className="sm:col-span-2">
            <TextDetail
              label="Política de cancelamento"
              value={summary.cancellationPolicy || 'Não informada pelo consultor'}
              warning={!summary.cancellationPolicy}
            />
          </div>
          {summary.notes && (
            <div className="sm:col-span-2">
              <TextDetail label="Observações" value={summary.notes} />
            </div>
          )}
          {summary.reason && (
            <div className="sm:col-span-2">
              <TextDetail label="Motivo da aprovação" value={summary.reason} />
            </div>
          )}
          {summary.policyLabels.length > 0 && (
            <div className="sm:col-span-2">
              <TextDetail label="Política aplicável" value={summary.policyLabels.join(' · ')} />
            </div>
          )}
        </dl>
      </section>
    </div>
  )
}

function GenericSubjectSummary({
  summary,
}: {
  summary: ApprovalBusinessSummary
}) {
  const period = formatPeriod(summary.travelStartDate, summary.travelEndDate)
  const hasFinancialContext = summary.budgetAvailable !== null
    || summary.percentageAboveLowest !== null
    || summary.percentageAboveAverage !== null

  return (
    <div className="mt-3 space-y-4">
      <section className="overflow-hidden rounded-lg border border-bbt-accent/30 bg-bbt-accent/5" aria-label="Resumo da solicitação para aprovação">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bbt-accent/20 p-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-bbt-accent">
              <ShieldCheck className="h-4 w-4" />
              Resumo para decisão
            </div>
            <h4 className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">
              {summary.demandNumber || 'Solicitação'}{summary.service ? ` · ${summary.service}` : ''}
            </h4>
          </div>
          {summary.amount !== null && (
            <div className="rounded-md bg-white px-3 py-2 text-right shadow-sm dark:bg-slate-900">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Valor avaliado</div>
              <div className="mt-0.5 text-xl font-bold text-bbt-primary dark:text-white">
                {formatMoney(summary.amount, summary.currency)}
              </div>
            </div>
          )}
        </div>

        <dl className="grid gap-3 p-4 sm:grid-cols-2">
          {summary.companyName && <BusinessDetail icon={Building2} label="Empresa" value={summary.companyName} />}
          {summary.requesterName && <BusinessDetail icon={UserRound} label="Solicitante" value={summary.requesterName} />}
          {summary.travelerName && <BusinessDetail icon={UserRound} label="Viajante / hóspede" value={summary.travelerName} />}
          {summary.service && <BusinessDetail icon={ReceiptText} label="Serviço" value={summary.service} />}
          {summary.destination && <BusinessDetail icon={MapPin} label="Destino" value={summary.destination} />}
          {period && <BusinessDetail icon={CalendarDays} label="Período" value={period} />}
          {summary.urgent !== null && (
            <BusinessDetail icon={ShieldCheck} label="Urgência" value={summary.urgent ? 'Urgente' : 'Normal'} />
          )}
        </dl>
      </section>

      {(summary.reason || summary.policyLabels.length > 0) && (
        <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-800" aria-labelledby="merit-reason-title">
          <h4 id="merit-reason-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <BedDouble className="h-4 w-4 text-bbt-accent" />
            Motivo e política da decisão
          </h4>
          <dl className="mt-3 grid gap-3">
            {summary.reason && <TextDetail label="Motivo" value={summary.reason} />}
            {summary.policyLabels.length > 0 && (
              <TextDetail label="Política aplicável" value={summary.policyLabels.join(' · ')} />
            )}
          </dl>
        </section>
      )}

      {hasFinancialContext && (
        <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-800" aria-labelledby="financial-context-title">
          <h4 id="financial-context-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <CircleDollarSign className="h-4 w-4 text-bbt-accent" />
            Contexto financeiro
          </h4>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {summary.budgetAvailable !== null && (
              <TextDetail label="Orçamento disponível" value={formatMoney(summary.budgetAvailable, summary.currency)} />
            )}
            {summary.percentageAboveLowest !== null && (
              <TextDetail label="Acima da menor opção" value={`${summary.percentageAboveLowest.toLocaleString('pt-BR')}%`} />
            )}
            {summary.percentageAboveAverage !== null && (
              <TextDetail label="Acima da média" value={`${summary.percentageAboveAverage.toLocaleString('pt-BR')}%`} />
            )}
          </dl>
        </section>
      )}
    </div>
  )
}

function BusinessDetail({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof UserRound
  label: string
  value: string
  helper?: string
}) {
  return (
    <div className="flex min-w-0 gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-0.5 font-semibold text-bbt-primary dark:text-white">{value}</dd>
        {helper && <div className="mt-0.5 text-xs text-slate-500">{helper}</div>}
      </div>
    </div>
  )
}

function TextDetail({
  label,
  value,
  warning = false,
}: {
  label: string
  value: string
  warning?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-words ${warning ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-bbt-primary dark:text-white'}`}>
        {value}
      </dd>
    </div>
  )
}

function MoneyRow({
  label,
  detail,
  value,
  currency,
  total = false,
}: {
  label: string
  detail?: string
  value: number
  currency: string
  total?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-bbt-gray-100 px-3 py-2.5 last:border-b-0 dark:border-slate-800 ${total ? 'bg-bbt-primary/5 font-bold' : ''}`}>
      <div>
        <div className="text-sm text-bbt-primary dark:text-white">{label}</div>
        {detail && <div className="text-[11px] text-slate-500">{detail}</div>}
      </div>
      <div className={`shrink-0 tabular-nums text-bbt-primary dark:text-white ${total ? 'text-base' : 'text-sm font-semibold'}`}>
        {formatMoney(value, currency)}
      </div>
    </div>
  )
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
  } catch {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  }
}

function formatDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`
  return formatDateTime(value)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleString('pt-BR')
}

function pluralize(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function formatPeriod(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatDate(start)} a ${formatDate(end)}`
  if (start) return `A partir de ${formatDate(start)}`
  if (end) return `Até ${formatDate(end)}`
  return null
}
