import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const pickerSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-traveler-slot-picker.tsx'),
  'utf8',
)
const configuratorSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-demand-configurator.tsx'),
  'utf8',
)
const adminSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-demand-guests-admin.tsx'),
  'utf8',
)
const dialogSource = readFileSync(
  resolve(process.cwd(), 'components/travel/traveler-profile-dialog.tsx'),
  'utf8',
)
const modalSource = readFileSync(
  resolve(process.cwd(), 'components/ui/modal.tsx'),
  'utf8',
)
const portalEmpresaSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)
const novaDemandaSource = readFileSync(
  resolve(process.cwd(), 'components/ui/nova-demanda-modal.tsx'),
  'utf8',
)
const dateInputSource = readFileSync(
  resolve(process.cwd(), 'components/ui/date-input.tsx'),
  'utf8',
)

describe('hotel traveler profile UI', () => {
  it('replaces both duplicated hotel guest pickers with one shared component', () => {
    expect(configuratorSource).toContain("from '@/components/travel/hotel-traveler-slot-picker'")
    expect(adminSource).toContain("from '@/components/travel/hotel-traveler-slot-picker'")
    expect(configuratorSource).not.toContain('function TravelerSlotPicker(')
    expect(adminSource).not.toContain('function TravelerSlotPicker(')
    expect(configuratorSource).toContain('<HotelTravelerSlotPicker')
    expect(adminSource).toContain('<HotelTravelerSlotPicker')
    expect(adminSource).toContain('externalContactFields')
    expect(configuratorSource).toContain('surface="subtle"')
  })

  it('keeps agency and requester authorization paths explicit and separate', () => {
    expect(pickerSource).toContain("userAccessKind(sessionUser) === 'internal'")
    expect(pickerSource).toContain("includesCompany(companyId, 'criar_demandas')")
    expect(pickerSource).toContain("includesCompany(companyId, 'cadastrar_funcionarios')")
    expect(pickerSource).toContain("includesCompany(companyId, 'gerenciar_funcionarios')")
    expect(pickerSource).toContain('if (!enabled || !companyId || !requesterUser)')
    expect(pickerSource).toContain("getTravelerManagementSettings('company', companyId, controller.signal)")
    expect(pickerSource).toContain('canCreate: requesterSettingEnabled')
    expect(pickerSource).toContain('canComplete: requesterSettingEnabled')
    expect(pickerSource).toContain('canCompleteName: false')
  })

  it('creates travelers and completes only fields allowed by the active capability', () => {
    expect(pickerSource).toContain('<TravelerProfileDialog')
    expect(pickerSource).toContain('const created = await createTraveler({')
    expect(pickerSource).toContain('const updated = await completeTravelerMissingProfile(')
    expect(pickerSource).toContain('props.capabilities.canCompleteName && value.name')
    expect(pickerSource).toContain("issue === 'cpf'")
    expect(pickerSource).toContain("issue === 'birth_date'")
    expect(pickerSource).toContain('props.onChange(guestFromTraveler(item, props.slotIndex, props.role))')
  })

  it('provides accessible search, creation and completion affordances', () => {
    expect(pickerSource).toContain('role="combobox"')
    expect(pickerSource).toContain('role="listbox"')
    expect(pickerSource).toContain('role="option"')
    expect(pickerSource).toContain("event.key === 'ArrowDown'")
    expect(pickerSource).toContain("event.key === 'Escape'")
    expect(pickerSource).toContain('Cadastrar novo viajante')
    expect(pickerSource).toContain('Completar cadastro')
    expect(pickerSource).toContain('aria-live="polite"')
  })

  it('loads traveler capabilities once per hotel form instead of once per room slot', () => {
    expect(configuratorSource).toContain(
      'useHotelTravelerManagementCapabilities(companyId, showGuests)',
    )
    expect(adminSource).toContain('useHotelTravelerManagementCapabilities(companyId)')
    expect(configuratorSource).toContain('capabilities={travelerManagement}')
    expect(adminSource).toContain('capabilities={travelerManagement}')
  })

  it('isolates the traveler profile form from the enclosing demand form', () => {
    const preventDefaultPosition = dialogSource.indexOf('event.preventDefault()')
    const stopPropagationPosition = dialogSource.indexOf('event.stopPropagation()')

    expect(preventDefaultPosition).toBeGreaterThan(-1)
    expect(stopPropagationPosition).toBeGreaterThan(preventDefaultPosition)
    expect(modalSource).toContain("import { createPortal } from 'react-dom'")
    expect(modalSource).toContain('return createPortal(')
    expect(modalSource).toContain('document.body')
    expect(modalSource).toContain('if (!open || !mounted) return null')
    expect(modalSource).toMatch(/<button\s+type="button"\s+onClick=\{onClose\}/)
  })

  it('makes both enclosing demand forms ignore submit events from descendants', () => {
    expect(portalEmpresaSource).toMatch(
      /async function enviarPedido\(e: React\.FormEvent\)[\s\S]*?e\.preventDefault\(\)[\s\S]*?if \(e\.target !== e\.currentTarget\) return/,
    )
    expect(novaDemandaSource).toMatch(
      /async function handleSubmit\(e: React\.FormEvent\)[\s\S]*?e\.preventDefault\(\)[\s\S]*?if \(e\.target !== e\.currentTarget\) return/,
    )
  })

  it('keeps temporal picker controls from submitting either form', () => {
    expect(dateInputSource).toMatch(/<button\s+type="button"/)
    expect(dateInputSource).toContain('event.preventDefault()')
    expect(dateInputSource).toContain('event.stopPropagation()')
  })

  it('reports stale create or completion context instead of closing silently', () => {
    expect(pickerSource).not.toContain('if (!props.companyId || !profileDialog) return')
    expect(pickerSource).not.toContain('if (!selectedProfile) return')
    expect(pickerSource).toContain("throw new Error('O contexto da empresa ou do cadastro nao esta disponivel.')")
    expect(pickerSource).toContain("throw new Error('Selecione novamente o viajante que precisa ser atualizado.')")
  })

  it('closes only after a successful mutation and keeps failures visible', () => {
    const submitPosition = dialogSource.indexOf('await onSubmit({')
    const closePosition = dialogSource.indexOf('onClose()', submitPosition)
    const catchPosition = dialogSource.indexOf('} catch (cause)', submitPosition)

    expect(submitPosition).toBeGreaterThan(-1)
    expect(closePosition).toBeGreaterThan(submitPosition)
    expect(catchPosition).toBeGreaterThan(closePosition)
    expect(dialogSource).toContain('form: cause instanceof Error ? cause.message')
    expect(dialogSource).toContain('{errors.form && (')
    expect(dialogSource).toContain('<div role="alert"')
  })
})
