'use client'
/**
 * PageHero — V17
 *
 * Hero corporativo reutilizável alinhado à identidade efetiva do contexto.
 * Background sólido com faixa de marca e imagem opcional.
 *
 * Slot lateral opcional pra ações/ações rápidas no canto direito.
 */
import type { LucideIcon } from 'lucide-react'

interface Props {
  /** Subtítulo pequeno acima do título (ex: "Documentos · Vouchers") */
  eyebrow?: string
  /** Título principal */
  title: string
  /** Ícone do título (lucide) */
  icon?: LucideIcon
  /** Descrição abaixo do título */
  description?: string
  /** Imagem de fundo (URL). Omitir pra usar só gradient sólido */
  bgImage?: string
  /** Mini-KPIs no hero */
  metrics?: Array<{
    icon: LucideIcon
    label: string
    value: number | string
    highlight?: boolean
  }>
  /** Slot pra botões/ações (canto direito) */
  actions?: React.ReactNode
  /** Filhos opcionais (renderizados após o conteúdo principal) */
  children?: React.ReactNode
}

export function PageHero({
  eyebrow, title, icon: Icon, description, bgImage, metrics, actions, children,
}: Props) {
  const metricColumnsClass = getMetricColumnsClass(metrics?.length || 0)

  return (
    <section className="relative overflow-hidden rounded-lg border border-bbt-primary-light bg-bbt-primary text-white shadow-[0_12px_30px_rgb(var(--bbt-primary-rgb)/0.16)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--bbt-accent)_0_38%,var(--bbt-primary-light)_38%_76%,var(--bbt-gold)_76%_100%)]" />
      {bgImage && (
        <div
          className="absolute inset-0 opacity-25 mix-blend-luminosity"
          style={{
            backgroundImage: `linear-gradient(rgb(var(--bbt-primary-rgb) / .72),rgb(var(--bbt-primary-rgb) / .72)),url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div className="relative grid gap-5 p-6 lg:p-7 xl:grid-cols-[1fr_auto] xl:items-center">
        <div>
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 text-2xl font-semibold leading-tight lg:text-3xl flex items-center gap-3">
            {Icon && <Icon className="w-7 h-7 text-cyan-200" />}
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm text-blue-100/75">{description}</p>
          )}
          {metrics && metrics.length > 0 && (
            <div className={`mt-4 grid max-w-3xl grid-cols-1 gap-2 ${metricColumnsClass}`}>
              {metrics.map((m) => (
                <div
                  key={m.label}
                  className={`rounded-md border p-3 transition ${
                    m.highlight
                      ? 'border-amber-300/40 bg-amber-300/10'
                      : 'border-white/12 bg-white/8 hover:bg-white/12'
                  }`}
                >
                  <div className="mb-1 flex min-w-0 items-start gap-2">
                    <m.icon className={`h-3.5 w-3.5 shrink-0 ${m.highlight ? 'text-amber-200' : 'text-cyan-200'}`} />
                    <span className="min-w-0 break-words text-[10px] font-semibold uppercase leading-tight text-blue-100/60">
                      {m.label}
                    </span>
                  </div>
                  <div className="text-xl font-bold">{m.value}</div>
                </div>
              ))}
            </div>
          )}
          {children}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 self-start xl:self-center">
            {actions}
          </div>
        )}
      </div>
    </section>
  )
}

function getMetricColumnsClass(count: number): string {
  if (count <= 1) return ''
  if (count === 2) return 'sm:grid-cols-2'
  if (count === 3) return 'sm:grid-cols-3'
  if (count === 4) return 'sm:grid-cols-2 lg:grid-cols-4'
  if (count === 5) return 'sm:grid-cols-2 lg:grid-cols-5'
  return 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
}
