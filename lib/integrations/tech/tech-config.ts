import type { IntegrationMode } from '@/lib/integrations/types'

export const TECH_PROVIDER_ID = 'tech-ttravel' as const

export interface TechConfig {
  enabled: boolean
  mode: IntegrationMode
  baseUrl: string
  login: string
  password: string
  apiKey: string
  timeoutMs: number
  defaultCompanyId: string | null
  defaultSystems: string[]
  hotelSuppliers: string[]
  tokenCacheTtlSeconds: number
  reportsEnabled: boolean
  reportsBaseUrl: string
  reportsKey: string
}

export function getTechConfig(): TechConfig {
  const enabled = envBool('TECH_API_ENABLED', false)
  const mode = (process.env.TECH_API_MODE === 'production' ? 'production' : enabled ? 'sandbox' : 'disabled') as IntegrationMode
  return {
    enabled,
    mode,
    baseUrl: stripTrailingSlash(process.env.TECH_API_BASE_URL || 'https://www.ttravel.com.br/ttravelapi/reservas'),
    login: process.env.TECH_API_LOGIN || '',
    password: process.env.TECH_API_PASSWORD || '',
    apiKey: process.env.TECH_API_KEY || '',
    timeoutMs: positiveInt(process.env.TECH_API_TIMEOUT_MS, 30_000),
    defaultCompanyId: process.env.TECH_API_DEFAULT_COMPANY_ID || null,
    defaultSystems: csv(process.env.TECH_API_DEFAULT_SYSTEMS || 'LATAM,GOLGWS,AZUL'),
    hotelSuppliers: csv(process.env.TECH_API_HOTEL_SUPPLIERS || ''),
    tokenCacheTtlSeconds: positiveInt(process.env.TECH_API_TOKEN_CACHE_TTL_SECONDS, 900),
    reportsEnabled: envBool('TECH_REPORTS_ENABLED', false),
    reportsBaseUrl: stripTrailingSlash(process.env.TECH_REPORTS_BASE_URL || 'https://www.ttravel.com.br/ttravelapi/relatorio'),
    reportsKey: process.env.TECH_REPORTS_KEY || '',
  }
}

export function techConfigured(config = getTechConfig()): boolean {
  return Boolean(config.enabled && config.baseUrl && config.login && config.password && config.apiKey)
}

export function techMissingConfig(config = getTechConfig()): string[] {
  const missing: string[] = []
  if (!config.enabled) missing.push('TECH_API_ENABLED=true')
  if (!config.baseUrl) missing.push('TECH_API_BASE_URL')
  if (!config.login) missing.push('TECH_API_LOGIN')
  if (!config.password) missing.push('TECH_API_PASSWORD')
  if (!config.apiKey) missing.push('TECH_API_KEY')
  return missing
}

export function techReportsConfigured(config = getTechConfig()): boolean {
  return Boolean(config.reportsEnabled && config.reportsBaseUrl && config.reportsKey)
}

export function techMissingReportsConfig(config = getTechConfig()): string[] {
  const missing: string[] = []
  if (!config.reportsEnabled) missing.push('TECH_REPORTS_ENABLED=true')
  if (!config.reportsBaseUrl) missing.push('TECH_REPORTS_BASE_URL')
  if (!config.reportsKey) missing.push('TECH_REPORTS_KEY')
  return missing
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'sim', 'on'].includes(value.toLowerCase())
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
