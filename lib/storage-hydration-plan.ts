import {
  RESETTABLE_SHARED_STORAGE_KEYS,
  type SharedStorageKey,
} from '@/lib/storage-keys'

const CORE_KEYS = keys('bbt-data-v4')
const DEMAND_KEYS = keys(
  'bbt-atendimentos',
  'bbt-alertas',
  'bbt-alertas-resolvidos',
)
const VOUCHER_KEYS = keys(
  'bbt-vouchers-emitidos',
  'bbt-vouchers-last-numero',
)
const SUPPLIER_KEYS = keys(
  'bbt-supplier-integrations-v1',
  'bbt-supplier-action-logs-v1',
  'bbt-supplier-reservations-v1',
)
const FINANCE_KEYS = keys(
  'bbt-financeiro',
  'bbt-corporate-finance',
)
const REPORT_KEYS = combine(
  CORE_KEYS,
  DEMAND_KEYS,
  VOUCHER_KEYS,
  FINANCE_KEYS,
  keys('bbt-emissoes', 'bbt-wintour-imports-v1'),
)
export function storageKeysForDashboardPath(pathname: string): SharedStorageKey[] {
  const path = normalizePath(pathname)

  if (path === '/dashboard/configuracoes') return [...RESETTABLE_SHARED_STORAGE_KEYS]
  if (path === '/dashboard/portal-empresa-lab') {
    // The isolated portal is hydrated exclusively through projected BFF DTOs.
    return []
  }
  if (path.startsWith('/dashboard/relatorios') || path === '/dashboard/portal-empresa') return [...REPORT_KEYS]
  if (path === '/dashboard' || path.startsWith('/dashboard/risco')) {
    return [...REPORT_KEYS]
  }
  if (path.startsWith('/dashboard/demandas') || path.startsWith('/dashboard/produtividade')) {
    return combine(CORE_KEYS, DEMAND_KEYS, VOUCHER_KEYS)
  }
  if (path.startsWith('/dashboard/caixa-entrada')) {
    return combine(CORE_KEYS, DEMAND_KEYS)
  }
  if (path.startsWith('/dashboard/reservas') || path.startsWith('/dashboard/fornecedores')) {
    return combine(CORE_KEYS, DEMAND_KEYS, SUPPLIER_KEYS)
  }
  if (path.startsWith('/dashboard/voucher')) return combine(CORE_KEYS, DEMAND_KEYS, VOUCHER_KEYS)
  if (path.startsWith('/dashboard/aprovacoes')) return combine(CORE_KEYS, DEMAND_KEYS, keys('bbt-aprovacoes'))
  if (path.startsWith('/dashboard/emissoes')) {
    return combine(CORE_KEYS, DEMAND_KEYS, SUPPLIER_KEYS, keys('bbt-emissoes'))
  }
  if (path.startsWith('/dashboard/wintour')) {
    return combine(CORE_KEYS, DEMAND_KEYS, keys('bbt-wintour-imports-v1', 'bbt-wintour-emissor-map-v1'))
  }
  if (path.startsWith('/dashboard/importar')) {
    return combine(CORE_KEYS, DEMAND_KEYS)
  }
  if (path.startsWith('/dashboard/financeiro')) return combine(CORE_KEYS, DEMAND_KEYS, FINANCE_KEYS)
  if (path.startsWith('/dashboard/reconciliacao')) return combine(REPORT_KEYS, keys('bbt-alertas-resolvidos'))
  if (path.startsWith('/dashboard/auditoria')) return combine(CORE_KEYS, keys('bbt-auditoria', 'bbt-transacoes'))
  if (path.startsWith('/dashboard/sustentabilidade')) return combine(CORE_KEYS, DEMAND_KEYS)
  if (
    path.startsWith('/dashboard/ia') ||
    path.startsWith('/dashboard/assistente')
  ) {
    return combine(CORE_KEYS, DEMAND_KEYS, VOUCHER_KEYS, SUPPLIER_KEYS)
  }
  if (path.startsWith('/dashboard/empresas')) return combine(CORE_KEYS, keys('bbt-solicitantes-empresa'))

  return [...CORE_KEYS]
}

export function storageKeysForReportPath(_pathname: string): SharedStorageKey[] {
  return [...REPORT_KEYS]
}

function keys(...values: SharedStorageKey[]): SharedStorageKey[] {
  return values
}

function combine(...groups: readonly SharedStorageKey[][]): SharedStorageKey[] {
  return Array.from(new Set(groups.flat()))
}

function normalizePath(pathname: string): string {
  const path = pathname.split('?')[0].replace(/\/+$/, '')
  return path || '/'
}
