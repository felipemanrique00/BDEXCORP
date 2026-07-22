'use client'

import {
  BRAND_LOGO_DARK,
  BRAND_LOGO_LIGHT,
  BRAND_LOGO_MARK_COLOR,
  BRAND_LOGO_MARK_WHITE,
  SYSTEM_NAME,
} from '@/lib/branding'

interface Props {
  variant?: 'mark' | 'full' | 'wide'
  tone?: 'color' | 'white'
  size?: number
  className?: string
}

export function BBTLogo({ variant = 'mark', tone = 'color', size = 40, className = '' }: Props) {
  const isMark = variant === 'mark'
  const width = isMark ? size : Math.round(size * (760 / 260))
  const source = isMark
    ? tone === 'white'
      ? BRAND_LOGO_MARK_WHITE
      : BRAND_LOGO_MARK_COLOR
    : tone === 'white'
      ? BRAND_LOGO_DARK
      : BRAND_LOGO_LIGHT

  return (
    <img
      src={source}
      alt={SYSTEM_NAME}
      width={width}
      height={size}
      className={className}
      style={{ width, height: size, objectFit: 'contain' }}
      draggable={false}
    />
  )
}
