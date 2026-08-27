import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  canSelectExplicitDemandRequester,
  resolveInitialDemandAssignee,
} from '@/lib/server/demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

const requesterPortal = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)
const demandService = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)
const demandsPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/demandas/page.tsx'),
  'utf8',
)
const demandModal = readFileSync(
  resolve(process.cwd(), 'components/ui/nova-demanda-modal.tsx'),
  'utf8',
)

describe('requester demand governance UI', () => {
  it('derives company visibility from the authoritative dashboard session', () => {
    expect(requesterPortal).toContain('const { context: corporateContext, selectContext, user } = useCorporateContext()')
    expect(requesterPortal).not.toContain("export default function PortalEmpresaPage() {\n  const user = typeof window !== 'undefined' ? getCurrentUser() : null")
  })

  it('persists the authenticated requester identity in a new demand', () => {
    expect(requesterPortal).toContain('solicitanteAtual={solicitanteAtual}')
    expect(requesterPortal).not.toContain("(!isInternalUser ? authenticatedUser?.id : '')")
    expect(requesterPortal).toContain('...(requesterId ? { solicitante_id: requesterId } : {})')
    expect(requesterPortal).toContain('requesterFallbackLabel={!isInternalUser')
    expect(demandService).toContain('snapshot.requesterId,')
    expect(demandService).toContain('principal.user.id,')
    expect(demandService).toContain('and company_id = $2 and user_id = $3')
    expect(demandService).toContain('...(requester ? { solicitante_id: requester.id } : {})')
  })

  it('recognizes every internal agency role before enabling assisted creation', () => {
    expect(requesterPortal).toContain("import { isRequesterUser, userAccessKind } from '@/lib/user-access-kind'")
    expect(requesterPortal).toContain("import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'")
    expect(requesterPortal).toContain("userAccessKind(user) === 'internal'")
    expect(requesterPortal).toContain('canCreateAgencyAssistedDemand({')
    expect(requesterPortal).toContain('canCreateForClient={canCreateForClient}')
  })

  it('shows one common requester selector before every service-specific form', () => {
    const commonSelector = requesterPortal.indexOf('data-agency-requester-selector')
    const genericServiceFields = requesterPortal.indexOf("tipo !== 'Hotel' && tipo !== 'Aéreo'", commonSelector)
    const hotelFields = requesterPortal.indexOf("tipo === 'Hotel'", commonSelector)
    const airFields = requesterPortal.indexOf("tipo === 'Aéreo'", commonSelector)

    expect(commonSelector).toBeGreaterThan(-1)
    expect(genericServiceFields).toBeGreaterThan(commonSelector)
    expect(hotelFields).toBeGreaterThan(commonSelector)
    expect(airFields).toBeGreaterThan(commonSelector)
    expect(requesterPortal).toContain('aria-label="Buscar solicitante responsavel pelo pedido"')
    expect(requesterPortal).toContain('aria-label="Solicitante responsável pelo pedido"')
    expect(requesterPortal).toContain('showRequesterField={!canCreateForClient}')
  })

  it('requires an active requester globally and persists assisted ownership for every service', () => {
    const requesterRequired = requesterPortal.indexOf('if (canCreateForClient && !requesterId)')
    const activeAccessRequired = requesterPortal.indexOf('if (canCreateForClient && !selectedRequester?.hasActivePortalAccess)')
    const hotelValidation = requesterPortal.indexOf("if (tipo === 'Hotel')", requesterRequired)

    expect(requesterRequired).toBeGreaterThan(-1)
    expect(activeAccessRequired).toBeGreaterThan(requesterRequired)
    expect(hotelValidation).toBeGreaterThan(activeAccessRequired)
    expect(requesterPortal).toContain('...(requesterId ? { solicitante_id: requesterId } : {})')
    expect(requesterPortal).toContain('...(requesterName ? { solicitante_nome: requesterName } : {})')
    expect(requesterPortal).toContain('agency_assisted: canCreateForClient || undefined')
    expect(requesterPortal).not.toContain("} : solicitanteAtual ? {")
  })

  it('keeps quote choice requester-only even when an internal consultant created the demand', () => {
    expect(requesterPortal).toContain('{isRequesterUser(authenticatedUser) && (')
    expect(requesterPortal).toContain('<OfflineQuoteChoicePanel')
    expect(requesterPortal).toContain('<OfflineAirQuoteChoiceWorkspace')
    expect(requesterPortal).not.toContain('{canCreateForClient && (\n        <div id={PORTAL_REQUESTS_CHOICE_PANEL_ID}')
  })

  it('blocks a requester without active portal access in the agency demand modal', () => {
    const requesterRequired = demandModal.indexOf('if (agencyAssistedMode && !solicitanteId)')
    const activeAccessRequired = demandModal.indexOf(
      'requester.id === solicitanteId && requester.hasActivePortalAccess',
      requesterRequired,
    )
    const travelerRequired = demandModal.indexOf(
      'if (agencyAssistedMode && !effectiveEmployeeId',
      activeAccessRequired,
    )

    expect(requesterRequired).toBeGreaterThan(-1)
    expect(activeAccessRequired).toBeGreaterThan(requesterRequired)
    expect(travelerRequired).toBeGreaterThan(activeAccessRequired)
    expect(demandModal).toContain('O solicitante precisa ter acesso ativo ao portal para receber e escolher a cotação.')
    expect(demandModal).toContain('disabled={!requester.hasActivePortalAccess}')
  })

  it('keeps a manual demand in quotation before the governed approval queue', () => {
    expect(requesterPortal).toContain('booking_mode: bookingMode')
    expect(requesterPortal).toContain('shouldSubmitDemandOnCreate(bookingMode)')
    expect(requesterPortal).toContain('enviado para cotação por serviço do consultor')
    expect(requesterPortal.indexOf('persistida.governance?.policy.blocked'))
      .toBeLessThan(requesterPortal.indexOf("bookingMode === 'offline'"))
    expect(requesterPortal.indexOf("bookingMode === 'offline'"))
      .toBeLessThan(requesterPortal.indexOf('persistida.governance?.approval.required'))
  })

  it('preserves the current requester on updates without an explicit requester', () => {
    expect(demandService).toContain('current.requester_id,')
    expect(demandService).toContain('async function loadRequesterForUpdate(')
    expect(demandService).toContain('if (!currentRequesterId) return null')
    expect(demandService).toContain('requesterUserId: requester?.user_id || null')
  })

  it('limits relational demand lists to the authenticated requester owner', () => {
    expect(demandService).toContain('if (isRequesterReadPrincipal(principal))')
    expect(demandService).toContain("requesterOwnDemandExistsSql('demand', `$${values.length}`)")
    expect(demandService).toContain("requesterOwnDemandExistsSql('demand', '$3')")
  })

  it('also scopes the compatibility queue and blocks requester-only operational actions', () => {
    expect(demandsPage).toContain('scopeDemandsForRequester({')
    expect(demandsPage).toContain("user?.role_key === 'requester'")
    expect(demandsPage).toContain('const podeVerTudo = !requesterView')
    expect(demandsPage).toContain('filterDemandsForOperationalAssignment({')
    expect(demandsPage).toContain('showOperationalLinks={!requesterView}')
    expect(demandsPage).not.toContain('onStatusChange=')
    expect(demandsPage).toContain('travelLifecycleStatusLabel(')
    expect(demandsPage).toContain('· automático')
    expect(demandsPage).not.toContain("Boolean(user?.corporate_profile && hasPermission(user, 'ver_demandas'))\n  const podeRepassarDireto")
  })

  it('refuses a foreign demand in the modal and hides internal requester mutations', () => {
    expect(demandModal).toContain('requesterOwnsDemand({')
    expect(demandModal).toContain('requesterOwnershipVerified')
    expect(demandModal).toContain('requesterAccessDenied')
    expect(demandModal).toContain('Você só pode abrir demandas vinculadas ao seu cadastro de solicitante.')
    expect(demandModal).toContain('{!requesterView && <PolicyValidator')
    expect(demandModal).toContain('{!requesterView && <a href={`/dashboard/vouchers/novo?atendimento=${editing.id}`}')
    expect(demandModal).toContain('const hotelDemandLocked = isHotelDemandLockedForNormalEdit(editing)')
    expect(demandModal).toContain('readOnly || hotelDemandLocked')
    expect(demandModal).toContain('agente_user_id: editing ? editing.agente_user_id : user.id')
    expect(demandModal).not.toContain('editing?.agente_user_id || user.id')
    expect(demandModal).toContain('Atualizado automaticamente')
    expect(demandModal).not.toContain('setStatus(')
  })

  it('only lets corporate profiles select their own requester identity', () => {
    const corporate = requesterPrincipal('requester', 'user-requester')
    expect(canSelectExplicitDemandRequester(corporate, 'user-requester')).toBe(true)
    expect(canSelectExplicitDemandRequester(corporate, 'user-other')).toBe(false)
    expect(canSelectExplicitDemandRequester(requesterPrincipal('company_admin', 'user-admin'), null)).toBe(false)
  })

  it.each(['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'])(
    'lets the authorized internal role %s select a requester for the company',
    (roleKey) => {
      expect(canSelectExplicitDemandRequester(requesterPrincipal(roleKey, 'user-internal'), 'user-requester')).toBe(true)
    },
  )

  it('lets a platform administrator select a requester', () => {
    expect(canSelectExplicitDemandRequester(
      requesterPrincipal('readonly', 'user-platform', true),
      'user-requester',
    )).toBe(true)
  })

  it('keeps corporate requests unassigned until an internal consultant accepts them', () => {
    expect(resolveInitialDemandAssignee(requesterPrincipal('requester', 'user-requester'))).toBeNull()
    expect(resolveInitialDemandAssignee(requesterPrincipal('company_admin', 'user-admin'))).toBeNull()
    expect(resolveInitialDemandAssignee(requesterPrincipal('agent', 'user-agent'))).toBe('user-agent')
    expect(resolveInitialDemandAssignee(requesterPrincipal('readonly', 'user-platform', true))).toBe('user-platform')
  })
})

function requesterPrincipal(
  roleKey: string,
  userId: string,
  platformAdmin = false,
): Pick<RequestPrincipal, 'platformAdmin' | 'roleKey' | 'user'> {
  return {
    platformAdmin,
    roleKey,
    user: { id: userId } as RequestPrincipal['user'],
  }
}
