'use client'

import { BBTLogo } from '@/components/branding/bbt-logo'
import {
  useEffectiveBranding,
  useScopedEffectiveBranding,
} from '@/components/branding/effective-branding-provider'
import type { EffectiveBranding, EffectiveBrandingScope } from '@/lib/branding/effective-branding'
import { cn } from '@/lib/utils'

export interface EffectiveBrandLogoProps {
  variant?: 'mark' | 'full' | 'wide'
  tone?: 'color' | 'white'
  size?: number
  className?: string
  brandedSurface?: boolean
}

export function EffectiveBrandLogo({
  variant = 'mark',
  tone = 'color',
  size = 40,
  className,
  brandedSurface = false,
}: EffectiveBrandLogoProps) {
  const { branding } = useEffectiveBranding()
  return (
    <BrandLogoPresentation
      branding={branding}
      variant={variant}
      tone={tone}
      size={size}
      className={className}
      brandedSurface={brandedSurface}
    />
  )
}

export function ScopedEffectiveBrandLogo({
  scope,
  hideFallback = false,
  ...props
}: EffectiveBrandLogoProps & {
  scope: EffectiveBrandingScope | null
  hideFallback?: boolean
}) {
  const { branding } = useScopedEffectiveBranding(scope)
  if (hideFallback && branding.isLogoFallback) return null
  return <BrandLogoPresentation branding={branding} {...props} />
}

export function ScopedDocumentClientBrand({ scope }: { scope: EffectiveBrandingScope | null }) {
  const { branding } = useScopedEffectiveBranding(scope)
  if (branding.isLogoFallback) return null
  return (
    <div className="flex flex-col items-end gap-1" data-document-client-brand={branding.scopeId || undefined}>
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Identidade do cliente</span>
      <BrandLogoPresentation branding={branding} variant="full" size={38} />
    </div>
  )
}

function BrandLogoPresentation({
  branding,
  variant = 'mark',
  tone = 'color',
  size = 40,
  className,
  brandedSurface = false,
}: EffectiveBrandLogoProps & { branding: EffectiveBranding }) {
  if (branding.isLogoFallback) {
    return <BBTLogo variant={variant} tone={tone} size={size} className={className} />
  }

  const isMark = variant === 'mark'
  const width = isMark ? size : Math.round(size * 2.9)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden',
        brandedSurface && 'rounded-md bg-white/95 p-1 shadow-sm',
        className,
      )}
      style={{ width, height: size }}
      data-effective-brand-logo={branding.scopeId || 'system'}
      title={branding.displayName}
    >
      {/* The endpoint only accepts a sanitized same-origin or HTTPS URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={branding.logoUrl}
        alt={branding.logoAlt}
        width={width}
        height={size}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  )
}

/**
 * Client reports may carry the active corporate identity, but the agency mark
 * remains visible as issuer/manager. Vouchers keep their full legal agency
 * header and use this component only as a secondary client mark.
 */
export function CoBrandedDocumentLogo({ className }: { className?: string }) {
  const { branding } = useEffectiveBranding()
  if (branding.isLogoFallback) {
    return <BBTLogo variant="full" tone="color" size={44} className={className} />
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-3', className)} data-document-branding="co-branded">
      <EffectiveBrandLogo variant="full" tone="color" size={44} />
      <span className="h-9 w-px bg-slate-200" aria-hidden="true" />
      <span className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        Gestão de viagens por
        <BBTLogo variant="full" tone="color" size={24} />
      </span>
    </div>
  )
}
