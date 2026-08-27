import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const pickerSource = readFileSync(
  resolve(process.cwd(), 'components/travel/air-demand-passengers.tsx'),
  'utf8',
)
const profileDialogSource = readFileSync(
  resolve(process.cwd(), 'components/travel/traveler-profile-dialog.tsx'),
  'utf8',
)
const configuratorSource = readFileSync(
  resolve(process.cwd(), 'components/travel/air-demand-configurator.tsx'),
  'utf8',
)
const modalSource = readFileSync(
  resolve(process.cwd(), 'components/ui/nova-demanda-modal.tsx'),
  'utf8',
)
const portalSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)

describe('air demand passenger UI', () => {
  it('uses the shared scoped traveler directory with searchable add/remove and primary ordering', () => {
    expect(pickerSource).toContain('searchTravelers,')
    expect(pickerSource).toContain('{ companyId, q: query.trim() || undefined, limit: 20 }')
    expect(pickerSource).toContain('selectedIds.has(item.id)')
    expect(pickerSource).toContain('onChange([...passengers, { employee_id: item.id, name: item.name }])')
    expect(pickerSource).toContain('removePassenger(passenger.employee_id)')
    expect(pickerSource).toContain('Tornar principal')
    expect(pickerSource).toContain('CPF, data de nascimento, primeiro e último nome')
    expect(pickerSource).toContain('ids: requestedIds')
    expect(pickerSource).toContain('lookupErrors: passengers.flatMap')
    expect(pickerSource).toContain('Tentar novamente')
    expect(pickerSource).toContain('Passageiro {index + 1}')
    expect(pickerSource).toContain('profile?.identificationCode || profile?.registrationCode')
  })

  it('applies the inherited requester setting only to requester users', () => {
    expect(pickerSource).toContain("import { getCurrentUser } from '@/lib/auth'")
    expect(pickerSource).toContain("import { isRequesterUser, userAccessKind } from '@/lib/user-access-kind'")
    expect(pickerSource).toContain('const requesterUser = isRequesterUser(currentUser)')
    expect(pickerSource).toContain('|| !requesterUser')
    expect(pickerSource).toContain("getTravelerManagementSettings('company', companyId, controller.signal)")
    expect(pickerSource).toContain('const canCreateTraveler = canCreateByPermission || requesterManagementEnabled')
    expect(pickerSource).toContain('const canCompleteTraveler = canCompleteByPermission || requesterManagementEnabled')
  })

  it('keeps quick traveler management available to an internal flow operator', () => {
    expect(pickerSource).toContain("userAccessKind(currentUser) === 'internal'")
    expect(pickerSource).toContain("includesCompany(companyId, 'criar_demandas')")
    expect(pickerSource).toContain('|| canManageInAgencyFlow')
  })

  it('supports keyboard and assistive-technology navigation in the traveler picker', () => {
    expect(pickerSource).toContain('role="combobox"')
    expect(pickerSource).toContain('aria-expanded={open && Boolean(companyId) && !disabled}')
    expect(pickerSource).toContain('aria-controls={listboxId}')
    expect(pickerSource).toContain('role="listbox"')
    expect(pickerSource).toContain('role="option"')
    expect(pickerSource).toContain("event.key === 'ArrowDown'")
    expect(pickerSource).toContain("event.key === 'Escape'")
    expect(pickerSource).toContain('event.currentTarget.contains(event.relatedTarget as Node | null)')
  })

  it('keeps completion errors actionable and accessible', () => {
    expect(profileDialogSource).toContain('ref={formRef}')
    expect(profileDialogSource).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')")
    expect(profileDialogSource).toContain("aria-describedby={errors.cpf ? 'traveler-profile-cpf-error' : undefined}")
    expect(profileDialogSource).toContain('id={`${htmlFor}-error`} role="alert"')
    expect(profileDialogSource).toContain('clearError(setErrors,')
    expect(profileDialogSource).toContain('max={todayISODate()}')
  })

  it('embeds the picker once in the reusable air configurator', () => {
    expect(configuratorSource.match(/<AirDemandPassengers/g)).toHaveLength(1)
    expect(configuratorSource).toContain('companyId={companyId}')
    expect(configuratorSource).toContain('onPrimaryTravelerChange={onPrimaryPassengerChange}')
    expect(configuratorSource).toContain('withAirPassengers(')
  })

  it.each([
    ['agency modal', modalSource, "tipoServico !== 'Hotel' && tipoServico !== 'Aéreo'", 'companyId={empresaId}'],
    ['corporate portal', portalSource, "tipo !== 'Hotel' && tipo !== 'Aéreo'", 'companyId={empresaId}'],
  ])('replaces the legacy single selector for air in the %s', (_label, source, guard, companyProp) => {
    expect(source).toContain(guard)
    expect(source).toContain(companyProp)
    expect(source).toContain('onPassengerValidationChange={setAirPassengerValidation}')
    expect(source).toContain('airPrimaryPassenger?.employee_id')
    expect(source).toContain('airPrimaryPassenger?.name')
  })

  it('reapplies the primary air traveler and cost center after changing services', () => {
    expect(pickerSource).toContain('onPrimaryTravelerChange?.(primary, primaryProfile)')
    expect(pickerSource).toContain("primaryProfile ? 'loaded' : 'pending'")
    expect(modalSource).toContain('profile.costCenterId')
    expect(modalSource).toContain('employee?.cost_center_id')
    expect(portalSource).toContain('profile.costCenterId')
    expect(portalSource).toContain('employee?.cost_center_id')
  })

  it('does not run the generic agency traveler query for air or hotel demands', () => {
    expect(modalSource).toContain("tipoServico === 'Hotel' || tipoServico === 'Aéreo'")
  })

  it('limits the unlinked-name fallback to editing the same legacy air demand', () => {
    expect(modalSource).toContain("editing.tipo_servico !== 'Aéreo'")
    expect(modalSource).toContain("editing?.tipo_servico === 'Aéreo'")
    expect(modalSource).toContain('editing.empresa_id === empresaId')
    expect(modalSource).toContain('!airPassengers.length')
    expect(modalSource).toContain('!airPassengers.length && !preservesLegacyUnlinkedAirPassenger')
  })
})
