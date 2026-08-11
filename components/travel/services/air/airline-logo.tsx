import Image from 'next/image'

import { cn } from '@/lib/utils'

import { normalizeAirlineIataCode, resolveAirlineBrand } from './airline-brand'

export interface AirlineLogoProps {
  iataCode: string | null | undefined
  airlineName?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  decorative?: boolean
  eager?: boolean
  className?: string
}

const SIZE_STYLES = {
  xs: { box: 'h-6 w-12', width: 48, height: 24, fallback: 'text-[10px]' },
  sm: { box: 'h-8 w-16', width: 64, height: 32, fallback: 'text-xs' },
  md: { box: 'h-10 w-24', width: 96, height: 40, fallback: 'text-sm' },
  lg: { box: 'h-12 w-32', width: 128, height: 48, fallback: 'text-base' },
} as const

/**
 * Displays a bundled airline wordmark for an exact IATA designator. Unknown
 * carriers receive a stable IATA monogram, so rendering never depends on an
 * external logo service or on free-text airline names.
 */
export function AirlineLogo({
  iataCode,
  airlineName,
  size = 'sm',
  decorative = false,
  eager = false,
  className,
}: AirlineLogoProps) {
  const code = normalizeAirlineIataCode(iataCode)
  const brand = resolveAirlineBrand(code)
  const style = SIZE_STYLES[size]
  const label = String(airlineName || brand?.name || '').trim() || (code ? `Companhia ${code}` : 'Companhia aérea')
  const accessibility = `${label}${code ? ` (${code})` : ''}`
  const monogram = /^[A-Z0-9]{2,3}$/.test(code) ? code : 'AIR'

  if (brand) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden',
          brand.logoSurfaceColor && 'rounded-md p-1',
          style.box,
          className,
        )}
        data-airline-logo={brand.iataCode}
        style={brand.logoSurfaceColor ? { backgroundColor: brand.logoSurfaceColor } : undefined}
        title={accessibility}
      >
        <Image
          src={brand.logoPath}
          width={style.width}
          height={style.height}
          className="h-full w-full object-contain"
          alt={decorative ? '' : `Logomarca da ${label}`}
          priority={eager}
          unoptimized
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1 font-bold tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
        style.box,
        style.fallback,
        className,
      )}
      data-airline-logo-fallback={code || 'unknown'}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibility}
      title={accessibility}
    >
      {monogram}
    </span>
  )
}
