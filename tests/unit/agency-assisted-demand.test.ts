import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  canCreateAgencyAssistedDemand,
  resolveAgencyAssistedDemandMode,
  resolveAgencyAssistedDemandUpdateMode,
  shouldBlockAgencyAssistedLegacyFallback,
  validateAgencyAssistedDemandParticipants,
} from '@/lib/demands/agency-assistance'
import { parseLegacyDemands } from '@/lib/travel/legacy-demand'

const modalSource = readFileSync(
  resolve(process.cwd(), 'components/ui/nova-demanda-modal.tsx'),
  'utf8',
)
const optionsServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-agency-options-service.ts'),
  'utf8',
)
const demandServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)
const persistenceClientSource = readFileSync(
  resolve(process.cwd(), 'lib/demand-persistence-client.ts'),
  'utf8',
)

describe('agency-assisted demand', () => {
  it.each(['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'])(
    'allows internal role %s to operate on behalf of a client',
    (roleKey) => {
      expect(canCreateAgencyAssistedDemand({ platformAdmin: false, roleKey })).toBe(true)
    },
  )

  it('does not allow a corporate profile to impersonate another requester', () => {
    expect(canCreateAgencyAssistedDemand({ platformAdmin: false, roleKey: 'company_admin' })).toBe(false)
    expect(validateAgencyAssistedDemandParticipants(
      { platformAdmin: false, roleKey: 'company_admin' },
      { agencyAssisted: true, requesterId: 'requester-1', employeeId: 'employee-1' },
    )?.code).toBe('AGENCY_ASSISTED_DEMAND_DENIED')
  })

  it('derives assisted mode for an internal actor even when the client sends false', () => {
    expect(resolveAgencyAssistedDemandMode(
      { platformAdmin: false, roleKey: 'agent' },
      { declaredAgencyAssisted: false, requesterId: 'requester-from-client' },
    )).toBe(true)
    expect(resolveAgencyAssistedDemandMode(
      { platformAdmin: false, roleKey: 'requester' },
      { declaredAgencyAssisted: false, requesterId: 'own-requester' },
    )).toBe(false)
    expect(demandServiceSource).toContain('agencyAssisted: resolveAgencyAssistedDemandMode(principal')
  })

  it('ignores a corporate attempt to promote an update while preserving a server-trusted assisted origin', () => {
    const corporate = { platformAdmin: false, roleKey: 'requester' }
    expect(resolveAgencyAssistedDemandUpdateMode({
      existingAgencyAssisted: false,
    })).toBe(false)
    expect(resolveAgencyAssistedDemandUpdateMode({
      existingAgencyAssisted: true,
    })).toBe(true)
    expect(validateAgencyAssistedDemandParticipants(corporate, {
      agencyAssisted: true,
      existingAgencyAssisted: true,
      requesterId: 'own-requester',
      employeeId: 'employee-1',
    })).toBeNull()
    expect(demandServiceSource).toContain('resolveAgencyAssistedDemandUpdateMode({')
    expect(demandServiceSource).toContain('existingAgencyAssisted,')
  })

  it('requires an explicit requester and traveler for assisted creation', () => {
    const internal = { platformAdmin: false, roleKey: 'agent' }
    expect(validateAgencyAssistedDemandParticipants(internal, {
      agencyAssisted: true,
      requesterId: null,
      employeeId: 'employee-1',
    })?.code).toBe('AGENCY_ASSISTED_REQUESTER_REQUIRED')
    expect(validateAgencyAssistedDemandParticipants(internal, {
      agencyAssisted: true,
      requesterId: 'requester-1',
      employeeId: null,
    })?.code).toBe('AGENCY_ASSISTED_TRAVELER_REQUIRED')
    expect(validateAgencyAssistedDemandParticipants(internal, {
      agencyAssisted: true,
      requesterId: 'requester-1',
      employeeId: 'employee-1',
    })).toBeNull()
  })

  it('fails closed before every legacy fallback for assisted creation and editing', () => {
    expect(shouldBlockAgencyAssistedLegacyFallback(
      'DEMAND_RELATIONAL_WRITE_DISABLED',
      true,
    )).toBe(true)
    expect(shouldBlockAgencyAssistedLegacyFallback(
      'DEMAND_RELATIONAL_WRITE_DISABLED',
      false,
    )).toBe(false)
    expect(shouldBlockAgencyAssistedLegacyFallback('DEMAND_NOT_FOUND', true)).toBe(true)

    const normalizedModal = modalSource.replace(/\s+/g, ' ')
    const editGuard = normalizedModal.indexOf(
      'shouldBlockAgencyAssistedLegacyFallback(error.code, editingIsAgencyAssisted)',
    )
    const editLegacyWrite = normalizedModal.indexOf('persistirAtendimentos(', editGuard)
    const createGuard = normalizedModal.indexOf(
      'shouldBlockAgencyAssistedLegacyFallback(error.code, agencyAssistedMode)',
    )
    const createLegacyWrite = normalizedModal.indexOf('persistirAtendimentos(', createGuard)
    expect(editGuard).toBeGreaterThan(-1)
    expect(editLegacyWrite).toBeGreaterThan(editGuard)
    expect(createGuard).toBeGreaterThan(editLegacyWrite)
    expect(createLegacyWrite).toBeGreaterThan(createGuard)
    expect(modalSource).toContain('Nenhum dado foi salvo; tente novamente mais tarde.')

    const normalizedPersistenceClient = persistenceClientSource.replace(/\s+/g, ' ')
    const persistenceGuard = normalizedPersistenceClient.indexOf(
      'shouldBlockAgencyAssistedLegacyFallback(error.code, demand.agency_assisted === true)',
    )
    const persistenceLegacyWrite = normalizedPersistenceClient.indexOf(
      'const current = getAllAtendimentos()',
      persistenceGuard,
    )
    expect(persistenceGuard).toBeGreaterThan(-1)
    expect(persistenceLegacyWrite).toBeGreaterThan(persistenceGuard)
  })

  it('requires active portal access and never substitutes the agency actor as requester', () => {
    expect(optionsServiceSource).toContain("membership.status = 'active'")
    expect(optionsServiceSource).toContain("portal_user.status = 'active'")
    expect(optionsServiceSource).toContain('portal_user.deleted_at is null')
    expect(optionsServiceSource).toContain('hasActivePortalAccess: row.has_active_portal_access === true')
    expect(demandServiceSource).toContain('AGENCY_ASSISTED_REQUESTER_PORTAL_ACCESS_REQUIRED')
    expect(demandServiceSource).toContain('!await hasActiveRequesterPortalAccess(client, principal.tenantId, requester)')
    expect(demandServiceSource).toContain("membership.status = 'active'")
    expect(demandServiceSource).toContain("portal_user.status = 'active'")
    expect(demandServiceSource).toContain('portal_user.deleted_at is null')
    expect(demandServiceSource).toContain('snapshot.agencyAssisted ? null : principal.user.id')
    expect(demandServiceSource).toContain('const approvalSubject = {\n    requesterUserId,')
    expect(demandServiceSource).not.toContain('requesterUserId: requester?.user_id || principal.user.id')
  })

  it('preserves the assisted flag in the relational snapshot', () => {
    const parsed = parseLegacyDemands([{
      id: 'atd-assisted',
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      funcionario_id: 'employee-1',
      agency_assisted: true,
      passageiro_nome: 'Viajante Teste',
      tipo_servico: 'Carro',
      status: 'pendente',
    }])
    expect(parsed.failures).toEqual([])
    expect(parsed.demands[0]).toMatchObject({
      requesterId: 'requester-1',
      employeeId: 'employee-1',
      agencyAssisted: true,
      metadata: { agencyAssisted: true },
    })
  })

  it('loads only active same-tenant participants and keeps the lifecycle server-managed', () => {
    expect(optionsServiceSource).toContain('requester.tenant_id = $1')
    expect(optionsServiceSource).toContain('requester.company_id = $2')
    expect(optionsServiceSource).toContain("requester.status = 'active'")
    expect(optionsServiceSource).toContain('requesterQ: z.string().trim().max(160).optional()')
    expect(optionsServiceSource).toContain('count(*) over() as total_count')
    expect(optionsServiceSource).toContain("await requireCompanyAccess(principal, query.companyId, 'criar_demandas')")
    expect(optionsServiceSource).toContain('employee.tenant_id = $1')
    expect(optionsServiceSource).toContain('employee.company_id = $2')
    expect(demandServiceSource).toContain("? 'support_assisted'")
    expect(demandServiceSource).toContain("? 'agency_assisted'")
    expect(demandServiceSource).toContain('const actorUserId = realActorUserId(principal)')
    expect(demandServiceSource).toContain('representedUserId: representation?.targetUserId || null')
    expect(demandServiceSource).toContain("'demand_created', 'draft'")
    expect(modalSource).toContain('Solicitante do cliente *')
    expect(modalSource).toContain('aria-label="Buscar solicitante do cliente"')
    expect(modalSource).toContain("participant: 'requesters'")
    expect(modalSource).toContain("participant: 'travelers'")
    expect(modalSource).toContain('Nova Demanda para Cliente')
    expect(modalSource).toContain('agency_assisted: agencyAssistedMode')
  })
})
