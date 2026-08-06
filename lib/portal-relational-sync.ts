import type { Atendimento, VoucherEmitido } from '@/types'

export const PORTAL_REQUESTS_CHOICE_PANEL_ID = 'escolha-cotacao'
export const PORTAL_REQUESTS_CHOICE_HREF =
  `/dashboard/portal-empresa?tab=pedidos&panel=${PORTAL_REQUESTS_CHOICE_PANEL_ID}`

const PORTAL_TABS = new Set([
  'home',
  'empresa',
  'viagens',
  'pedidos',
  'vouchers',
  'financeiro',
  'carteira',
  'relatorios',
  'pegada',
] as const)

export type PortalNavigationTab =
  | 'home'
  | 'empresa'
  | 'viagens'
  | 'pedidos'
  | 'vouchers'
  | 'financeiro'
  | 'carteira'
  | 'relatorios'
  | 'pegada'

export interface PortalNavigationTarget {
  tab: PortalNavigationTab | null
  panel: typeof PORTAL_REQUESTS_CHOICE_PANEL_ID | null
}

export interface PortalRecordScope {
  allowedCompanyIds: ReadonlySet<string> | readonly string[]
  requesterRestricted: boolean
  requesterId?: string | null
  requesterEmail?: string | null
  employeeIds?: ReadonlySet<string> | readonly string[]
  /** IDs already filtered by the authenticated requester query on the server. */
  trustedServerDemandIds?: ReadonlySet<string> | readonly string[]
  /** IDs already filtered by the authenticated requester query on the server. */
  trustedServerVoucherIds?: ReadonlySet<string> | readonly string[]
}

export function parsePortalNavigation(search: string): PortalNavigationTarget {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const rawTab = params.get('tab')?.trim() || ''
  const rawPanel = params.get('panel')?.trim() || ''
  return {
    tab: PORTAL_TABS.has(rawTab as PortalNavigationTab)
      ? rawTab as PortalNavigationTab
      : null,
    panel: rawPanel === PORTAL_REQUESTS_CHOICE_PANEL_ID
      ? PORTAL_REQUESTS_CHOICE_PANEL_ID
      : null,
  }
}

export function mergePortalDemands(
  legacy: readonly Atendimento[],
  server: readonly Atendimento[],
  scope: PortalRecordScope,
): Atendimento[] {
  const result: Atendimento[] = []
  const seenIds = new Set<string>()
  const seenSerials = new Set<string>()

  const append = (demand: Atendimento) => {
    if (!isPortalDemandVisible(demand, scope)) return
    const id = normalizedKey(demand.id)
    const serial = normalizedKey(demand.serial_os)
    if ((id && seenIds.has(id)) || (serial && seenSerials.has(serial))) return
    result.push(demand)
    if (id) seenIds.add(id)
    if (serial) seenSerials.add(serial)
  }

  // The relational snapshot is authoritative when it overlaps legacy storage.
  server.forEach(append)
  legacy.forEach(append)
  return result.sort((left, right) => right.created_at.localeCompare(left.created_at))
}

/**
 * Preserves every authorized legacy/relational identity before OS deduplication.
 * Vouchers may still reference the old demand id after the relational cutover.
 */
export function collectVisiblePortalDemandIds(
  legacy: readonly Atendimento[],
  server: readonly Atendimento[],
  scope: PortalRecordScope,
): Set<string> {
  const ids = new Set<string>()
  for (const demand of [...server, ...legacy]) {
    if (!isPortalDemandVisible(demand, scope)) continue
    const id = String(demand.id || '').trim()
    if (id) ids.add(id)
  }
  return ids
}

export function mergePortalVouchers(
  legacy: readonly VoucherEmitido[],
  server: readonly VoucherEmitido[],
  scope: PortalRecordScope,
  ownedDemandIds: ReadonlySet<string> | readonly string[],
): VoucherEmitido[] {
  const result: VoucherEmitido[] = []
  const seenIds = new Set<string>()
  const seenFingerprints = new Set<string>()
  const demandIds = toSet(ownedDemandIds)

  const append = (voucher: VoucherEmitido) => {
    if (!isPortalVoucherVisible(voucher, scope, demandIds)) return
    const id = normalizedKey(voucher.id)
    const fingerprint = normalizedKey(voucher.fingerprint)
    if ((id && seenIds.has(id)) || (fingerprint && seenFingerprints.has(fingerprint))) return
    result.push(voucher)
    if (id) seenIds.add(id)
    if (fingerprint) seenFingerprints.add(fingerprint)
  }

  // The relational snapshot is authoritative when it overlaps legacy storage.
  server.forEach(append)
  legacy.forEach(append)
  return result.sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export function isPortalDemandVisible(
  demand: Atendimento,
  scope: PortalRecordScope,
): boolean {
  if (!toSet(scope.allowedCompanyIds).has(demand.empresa_id)) return false
  if (!scope.requesterRestricted) return true
  if (toSet(scope.trustedServerDemandIds || []).has(demand.id)) return true

  const requesterId = normalizedKey(scope.requesterId)
  const employeeIds = toSet(scope.employeeIds || [])
  return Boolean(
    (requesterId && normalizedKey(demand.solicitante_id) === requesterId)
    || (demand.funcionario_id && employeeIds.has(demand.funcionario_id)),
  )
}

export function isPortalVoucherVisible(
  voucher: VoucherEmitido,
  scope: PortalRecordScope,
  ownedDemandIds: ReadonlySet<string> | readonly string[],
): boolean {
  if (!toSet(scope.allowedCompanyIds).has(voucher.empresa_id)) return false
  if (!scope.requesterRestricted) return true
  if (toSet(scope.trustedServerVoucherIds || []).has(voucher.id)) return true

  const demandIds = toSet(ownedDemandIds)
  if (voucher.atendimento_id) {
    // A linked demand is authoritative. Metadata/e-mail fallbacks are only
    // valid for genuinely unlinked legacy vouchers.
    return demandIds.has(voucher.atendimento_id)
  }
  const employeeIds = toSet(scope.employeeIds || [])
  const requesterId = normalizedKey(scope.requesterId)
  const voucherRequesterId = normalizedKey((voucher as VoucherEmitido & { solicitante_id?: string }).solicitante_id)
  const requesterEmail = normalizedEmail(scope.requesterEmail)
  return Boolean(
    (voucher.funcionario_id && employeeIds.has(voucher.funcionario_id))
    || (requesterId && voucherRequesterId === requesterId)
    || (requesterEmail && normalizedEmail(voucher.solicitante_email) === requesterEmail),
  )
}

function toSet(values: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values)
}

function normalizedKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizedEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}
