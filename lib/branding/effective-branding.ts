import {
  BRAND_LOGO_DARK,
  BRAND_LOGO_LIGHT,
  BRAND_LOGO_MARK_COLOR,
  BRAND_LOGO_MARK_WHITE,
  SYSTEM_NAME,
} from '@/lib/branding'

export type EffectiveBrandingScopeType = 'company' | 'group'
export type EffectiveBrandingSource = 'company' | 'group' | 'tenant' | 'system' | 'agency' | 'fallback'

export interface EffectiveBrandingScope {
  type: EffectiveBrandingScopeType
  id: string
}

export interface EffectiveBrandingFieldSources {
  displayName?: EffectiveBrandingSource
  logoUrl?: EffectiveBrandingSource
  logoAlt?: EffectiveBrandingSource
  primaryColor?: EffectiveBrandingSource
  accentColor?: EffectiveBrandingSource
  sidebarColor?: EffectiveBrandingSource
  documentLegalName?: EffectiveBrandingSource
  documentNumber?: EffectiveBrandingSource
}

export interface EffectiveBranding {
  scopeType: EffectiveBrandingScopeType | 'system'
  scopeId: string | null
  groupId: string | null
  displayName: string
  logoUrl: string
  logoAlt: string
  primaryColor: string
  accentColor: string
  sidebarColor: string
  documentLegalName: string
  documentNumber: string | null
  source: EffectiveBrandingSource
  sources: EffectiveBrandingFieldSources
  version: number | null
  updatedAt: string | null
  isLogoFallback: boolean
  isFallback: boolean
}

export const DEFAULT_EFFECTIVE_BRANDING: EffectiveBranding = Object.freeze({
  scopeType: 'system',
  scopeId: null,
  groupId: null,
  displayName: SYSTEM_NAME,
  logoUrl: BRAND_LOGO_LIGHT,
  logoAlt: SYSTEM_NAME,
  primaryColor: '#20265A',
  accentColor: '#21BFC5',
  sidebarColor: '#20265A',
  documentLegalName: SYSTEM_NAME,
  documentNumber: null,
  source: 'fallback',
  sources: {},
  version: null,
  updatedAt: null,
  isLogoFallback: true,
  isFallback: true,
})

export const AGENCY_BRANDING = Object.freeze({
  displayName: SYSTEM_NAME,
  logoColorUrl: BRAND_LOGO_LIGHT,
  logoWhiteUrl: BRAND_LOGO_DARK,
  markColorUrl: BRAND_LOGO_MARK_COLOR,
  markWhiteUrl: BRAND_LOGO_MARK_WHITE,
})

export function buildEffectiveBrandingUrl(scope: EffectiveBrandingScope): string {
  const params = new URLSearchParams({
    contextType: scope.type,
    contextId: scope.id,
  })
  return `/api/me/effective-branding?${params.toString()}`
}

export function effectiveBrandingScopeKey(scope: EffectiveBrandingScope | null): string {
  return scope ? `${scope.type}:${scope.id}` : 'system'
}

export function resolveEffectiveBrandingScope(input: {
  context: { type: 'company' | 'group'; id: string; companyIds: string[] } | null
  selectedCompanyIds: readonly string[]
}): EffectiveBrandingScope | null {
  const selectedCompanyIds = uniqueStrings(input.selectedCompanyIds)
  if (selectedCompanyIds.length === 1) {
    return { type: 'company', id: selectedCompanyIds[0] }
  }

  if (
    input.context?.type === 'group'
    && sameStringSet(selectedCompanyIds, input.context.companyIds)
  ) {
    return { type: 'group', id: input.context.id }
  }

  // Arbitrary consolidation, all-companies across groups and an empty scope
  // intentionally use the neutral agency/system identity.
  return null
}

export function parseEffectiveBrandingResponse(
  payload: unknown,
  requestedScope: EffectiveBrandingScope,
): EffectiveBranding | null {
  if (!isRecord(payload)) return null
  const raw = isRecord(payload.branding) ? payload.branding : payload

  const displayName = readString(raw.displayName)
  const logoUrl = normalizeBrandLogoUrl(readString(raw.logoUrl))
  const primaryColor = normalizeBrandColor(readString(raw.primaryColor))
  const accentColor = normalizeBrandColor(readString(raw.accentColor))
  const sidebarColor = normalizeBrandColor(readString(raw.sidebarColor)) || primaryColor
  if (!displayName || !logoUrl || !primaryColor || !accentColor || !sidebarColor) return null

  const responseScopeType = readScopeType(raw.scopeType)
  const responseScopeId = readString(raw.scopeId)
  if (responseScopeType && responseScopeType !== requestedScope.type) return null
  if (responseScopeId && responseScopeId !== requestedScope.id) return null

  const source = readSource(raw.source) || requestedScope.type
  const sources = parseFieldSources(raw.sources)
  const visualSources = [sources.logoUrl, sources.primaryColor, sources.accentColor, sources.sidebarColor]
  const hasFieldSources = visualSources.some(Boolean)
  const isLogoFallback = sources.logoUrl
    ? sources.logoUrl === 'system' || sources.logoUrl === 'fallback' || sources.logoUrl === 'agency'
    : source === 'system' || source === 'fallback' || source === 'agency'
  const isFallback = hasFieldSources
    ? visualSources.every((fieldSource) => !fieldSource || fieldSource === 'system' || fieldSource === 'fallback' || fieldSource === 'agency')
    : source === 'system' || source === 'fallback' || source === 'agency'
  return {
    scopeType: responseScopeType || requestedScope.type,
    scopeId: responseScopeId || requestedScope.id,
    groupId: readString(raw.groupId) || null,
    displayName,
    logoUrl,
    logoAlt: readString(raw.logoAlt) || displayName,
    primaryColor,
    accentColor,
    sidebarColor,
    documentLegalName: readString(raw.documentLegalName) || displayName,
    documentNumber: readString(raw.documentNumber) || null,
    source,
    sources,
    version: readVersion(raw.version),
    updatedAt: readString(raw.updatedAt) || null,
    isLogoFallback,
    isFallback,
  }
}

export function effectiveBrandingCssVariables(branding: EffectiveBranding): Record<string, string> {
  const primary = normalizeBrandColor(branding.primaryColor) || DEFAULT_EFFECTIVE_BRANDING.primaryColor
  const accent = normalizeBrandColor(branding.accentColor) || DEFAULT_EFFECTIVE_BRANDING.accentColor
  const sidebar = normalizeBrandColor(branding.sidebarColor) || primary
  const primaryMid = mixHex(primary, '#000000', 0.16)
  const primaryLight = mixHex(primary, '#FFFFFF', 0.2)

  return {
    '--bbt-primary': primary,
    '--bbt-primary-rgb': hexToRgbTriplet(primary),
    '--bbt-primary-mid': primaryMid,
    '--bbt-primary-mid-rgb': hexToRgbTriplet(primaryMid),
    '--bbt-primary-light': primaryLight,
    '--bbt-primary-light-rgb': hexToRgbTriplet(primaryLight),
    '--bbt-accent': accent,
    '--bbt-accent-rgb': hexToRgbTriplet(accent),
    '--bbt-sidebar': sidebar,
    '--bbt-sidebar-rgb': hexToRgbTriplet(sidebar),
  }
}

export function normalizeBrandColor(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
  if (/^#[0-9A-F]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split('').map((digit) => `${digit}${digit}`).join('')}`
  }
  return ''
}

export function normalizeBrandLogoUrl(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (/^\/(?!\/)[A-Za-z0-9/_\-.%]+(?:\?[A-Za-z0-9=&_\-.%]*)?$/.test(normalized)) return normalized
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9/_\-.%]+(?:\?[A-Za-z0-9=&_\-.%]*)?$/.test(normalized)) return normalized
  return ''
}

function parseFieldSources(value: unknown): EffectiveBrandingFieldSources {
  if (!isRecord(value)) return {}
  const result: EffectiveBrandingFieldSources = {}
  for (const key of ['displayName', 'logoUrl', 'logoAlt', 'primaryColor', 'accentColor', 'sidebarColor', 'documentLegalName', 'documentNumber'] as const) {
    const source = readSource(value[key])
    if (source) result[key] = source
  }
  return result
}

function readScopeType(value: unknown): EffectiveBrandingScopeType | null {
  return value === 'company' || value === 'group' ? value : null
}

function readSource(value: unknown): EffectiveBrandingSource | null {
  return value === 'company' || value === 'group' || value === 'tenant' || value === 'system' || value === 'agency' || value === 'fallback'
    ? value
    : null
}

function hexToRgbTriplet(hex: string): string {
  const normalized = normalizeBrandColor(hex) || '#000000'
  return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)).join(' ')
}

function mixHex(base: string, target: string, targetRatio: number): string {
  const baseParts = hexParts(base)
  const targetParts = hexParts(target)
  const mixed = baseParts.map((value, index) => Math.round(value + ((targetParts[index] - value) * targetRatio)))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function hexParts(hex: string): number[] {
  const normalized = normalizeBrandColor(hex) || '#000000'
  return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(uniqueStrings(left))
  const rightSet = new Set(uniqueStrings(right))
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
