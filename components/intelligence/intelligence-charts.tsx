'use client'

import { BarChart3 } from 'lucide-react'

import type {
  IntelligenceBreakdown,
  IntelligenceSeriesPoint,
} from '@/lib/intelligence'
import { cn } from '@/lib/utils'

export type IntelligenceMetric = 'total' | 'savings' | 'transactions'

const METRIC_LABELS: Record<IntelligenceMetric, string> = {
  total: 'Valor final',
  savings: 'Economia verificada',
  transactions: 'Transações',
}

export function MonthlyEvolutionChart({
  points,
  metric,
  selectedPeriod,
  onMetric,
  onSelect,
}: {
  points: IntelligenceSeriesPoint[]
  metric: IntelligenceMetric
  selectedPeriod: string | null
  onMetric: (metric: IntelligenceMetric) => void
  onSelect: (period: string | null) => void
}) {
  const maximum = Math.max(...points.map((point) => point[metric]), 0)
  const selected = points.find((point) => point.period === selectedPeriod) || null

  return (
    <section
      className="min-w-0 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="intelligence-monthly-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="bbt-section-label">Tendência temporal</p>
          <h2 id="intelligence-monthly-title" className="mt-1 text-base font-semibold text-bbt-primary dark:text-white">
            Evolução mensal
          </h2>
        </div>
        <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-slate-200 p-1 dark:border-slate-700">
          {(Object.keys(METRIC_LABELS) as IntelligenceMetric[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={metric === item}
              className={cn(
                'whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-semibold transition',
                metric === item
                  ? 'bg-bbt-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
              onClick={() => onMetric(item)}
            >
              {METRIC_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <ChartEmptyState />
      ) : (
        <>
          <div className="mt-5 flex h-64 min-w-0 items-end gap-2 overflow-x-auto border-b border-slate-200 px-1 pb-0 dark:border-slate-700">
            {points.map((point) => {
              const value = point[metric]
              const height = maximum > 0 ? Math.max((value / maximum) * 100, value > 0 ? 5 : 1) : 1
              const active = selectedPeriod === point.period
              return (
                <button
                  key={point.period}
                  type="button"
                  aria-label={`${point.label}: ${formatMetric(value, metric)}`}
                  aria-pressed={active}
                  title={`${point.label}: ${formatMetric(value, metric)}`}
                  onClick={() => onSelect(active ? null : point.period)}
                  className="group flex h-full min-w-[64px] flex-1 flex-col items-stretch justify-end focus-visible:outline-none"
                >
                  <span className="mb-2 truncate text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {formatCompactMetric(value, metric)}
                  </span>
                  <span
                    className={cn(
                      'mx-auto w-[min(44px,72%)] rounded-t-sm bg-cyan-600 transition-[height,background-color] duration-300 group-hover:bg-cyan-500',
                      active && 'bg-bbt-primary ring-2 ring-cyan-300 ring-offset-2 dark:ring-offset-slate-900',
                    )}
                    style={{ height: `${height}%` }}
                  />
                  <span className="mt-2 min-h-8 text-center text-[11px] leading-4 text-slate-500">
                    {point.label}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <ChartDetail
              label={selected ? `Valor em ${selected.label}` : 'Valor no período'}
              value={formatCurrency(selected?.total ?? sum(points, 'total'))}
            />
            <ChartDetail
              label={selected ? `Economia em ${selected.label}` : 'Economia no período'}
              value={formatCurrency(selected?.savings ?? sum(points, 'savings'))}
            />
            <ChartDetail
              label={selected ? `Transações em ${selected.label}` : 'Transações no período'}
              value={formatNumber(selected?.transactions ?? sum(points, 'transactions'))}
            />
          </div>
        </>
      )}
    </section>
  )
}

export function BreakdownChart({
  title,
  subtitle,
  items,
  selectedKey,
  onSelect,
}: {
  title: string
  subtitle: string
  items: IntelligenceBreakdown[]
  selectedKey: string | null
  onSelect: (key: string | null) => void
}) {
  const maximum = Math.max(...items.map((item) => item.total), 0)

  return (
    <section
      className="min-w-0 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      aria-label={title}
    >
      <p className="bbt-section-label">{subtitle}</p>
      <h2 className="mt-1 text-base font-semibold text-bbt-primary dark:text-white">{title}</h2>
      {items.length === 0 ? (
        <ChartEmptyState />
      ) : (
        <div className="mt-4 space-y-3">
          {items.slice(0, 10).map((item) => {
            const active = selectedKey === item.key
            const width = maximum > 0 ? Math.max((item.total / maximum) * 100, item.total > 0 ? 3 : 0) : 0
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : item.key)}
                className={cn(
                  'w-full rounded p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                  active ? 'bg-cyan-50 dark:bg-cyan-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                )}
              >
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={item.label}>
                    {item.label}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-bbt-primary dark:text-white">
                    {formatCurrency(item.total)}
                  </span>
                </span>
                <span className="mt-1.5 block h-5 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                  <span
                    className={cn(
                      'flex h-full min-w-0 items-center justify-end bg-bbt-primary px-1.5 text-[10px] font-semibold text-white transition-[width] duration-300',
                      active && 'bg-cyan-600',
                    )}
                    style={{ width: `${width}%` }}
                  >
                    {width >= 18 ? `${formatPercentage(item.percentage)}%` : ''}
                  </span>
                </span>
                <span className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500">
                  <span>{formatNumber(item.transactions)} transação(ões)</span>
                  <span>{formatPercentage(item.percentage)}% do total</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ChartDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
      <span className="block text-slate-500">{label}</span>
      <strong className="mt-0.5 block text-sm text-bbt-primary dark:text-white">{value}</strong>
    </div>
  )
}

function ChartEmptyState() {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-slate-500">
      <BarChart3 className="h-8 w-8" />
      <p className="text-sm">Nenhum dado disponível para este período.</p>
    </div>
  )
}

function sum(
  points: IntelligenceSeriesPoint[],
  key: 'total' | 'savings' | 'transactions',
): number {
  return points.reduce((total, point) => total + point[key], 0)
}

function formatMetric(value: number, metric: IntelligenceMetric): string {
  return metric === 'transactions' ? formatNumber(value) : formatCurrency(value)
}

function formatCompactMetric(value: number, metric: IntelligenceMetric): string {
  if (metric === 'transactions') return formatNumber(value)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  )
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(
    Number.isFinite(value) ? value : 0,
  )
}
