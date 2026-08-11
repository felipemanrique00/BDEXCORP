import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MANUAL_DEMAND_BOOKING_MODE,
  resolveDemandBookingMode,
  shouldSubmitDemandOnCreate,
} from '@/lib/travel/demand-booking-mode'

const agencyModal = readFileSync(
  resolve(process.cwd(), 'components/ui/nova-demanda-modal.tsx'),
  'utf8',
)
const requesterPortal = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)
const inbox = readFileSync(
  resolve(process.cwd(), 'app/dashboard/caixa-entrada/page.tsx'),
  'utf8',
)
const travelAgent = readFileSync(
  resolve(process.cwd(), 'lib/ai-travel-orchestrator.ts'),
  'utf8',
)
const systemAI = readFileSync(
  resolve(process.cwd(), 'lib/ia-system-actions.ts'),
  'utf8',
)
const voucherImport = readFileSync(
  resolve(process.cwd(), 'components/ui/importar-voucher-modal.tsx'),
  'utf8',
)
const reservations = readFileSync(
  resolve(process.cwd(), 'app/dashboard/reservas/page.tsx'),
  'utf8',
)
const operationalSync = readFileSync(
  resolve(process.cwd(), 'lib/operational-sync.ts'),
  'utf8',
)

describe('demand booking mode in manual UIs', () => {
  it('defaults old and invalid records to offline while preserving a future online origin', () => {
    expect(MANUAL_DEMAND_BOOKING_MODE).toBe('offline')
    expect(resolveDemandBookingMode(undefined)).toBe('offline')
    expect(resolveDemandBookingMode('legacy-manual')).toBe('offline')
    expect(resolveDemandBookingMode('offline')).toBe('offline')
    expect(resolveDemandBookingMode('online')).toBe('online')
  })

  it('submits only a demand backed by a future online flow', () => {
    expect(shouldSubmitDemandOnCreate('offline')).toBe(false)
    expect(shouldSubmitDemandOnCreate('online')).toBe(true)
  })

  it('marks agency-created manual demands as offline and never submits by service type', () => {
    expect(agencyModal).toContain('const bookingMode = resolveDemandBookingMode(editing?.booking_mode)')
    expect(agencyModal).toContain('booking_mode: bookingMode')
    expect(agencyModal).toContain('createDemandOnServer(preparada, shouldSubmitDemandOnCreate(bookingMode))')
    expect(agencyModal).not.toContain("createDemandOnServer(preparada, tipoServico !== 'Hotel')")
    expect(agencyModal).toContain('criada e encaminhada para cotação do consultor')
    expect(agencyModal).toContain('Criar e enviar para cotação')
    expect(agencyModal).not.toMatch(/<option[^>]*value=["']online["']/i)
  })

  it('marks every portal service as offline and sends it to service quotation', () => {
    expect(requesterPortal).toContain('const bookingMode = MANUAL_DEMAND_BOOKING_MODE')
    expect(requesterPortal).toContain('booking_mode: bookingMode')
    expect(requesterPortal).toContain('shouldSubmitDemandOnCreate(bookingMode)')
    expect(requesterPortal).not.toContain("persistNewDemandWithCompatibility(novo, tipo !== 'Hotel')")
    expect(requesterPortal).toContain('enviado para cotação por serviço do consultor')
    expect(requesterPortal).toContain("{enviando ? 'Enviando...' : 'Enviar para cotação'}")
    expect(requesterPortal).not.toMatch(/<option[^>]*value=["']online["']/i)
  })

  it('keeps inbox and BIA-created requests offline until a quote is chosen', () => {
    expect(inbox).toContain('booking_mode: MANUAL_DEMAND_BOOKING_MODE')
    expect(inbox).toContain('shouldSubmitDemandOnCreate(MANUAL_DEMAND_BOOKING_MODE)')
    expect(inbox).toContain("status: 'pendente'")
    expect(inbox).toContain('criada e encaminhada para cotação do consultor')
    expect(inbox).not.toContain('enviada para aprovação')

    for (const source of [travelAgent, systemAI]) {
      expect(source).toContain('booking_mode: MANUAL_DEMAND_BOOKING_MODE')
      expect(source).toContain('submit: shouldSubmitDemandOnCreate(MANUAL_DEMAND_BOOKING_MODE)')
      expect(source).not.toContain('payload: { demand: demanda, submit: true }')
      expect(source).not.toContain('payload: { demand: demandInput, submit: true }')
    }
  })

  it('does not reclassify voucher imports, reservation operations or operational sync', () => {
    expect(voucherImport).toContain('persistNewDemandWithCompatibility(preparada)')
    expect(reservations).toContain('persistNewDemandWithCompatibility(preparada)')
    expect(operationalSync).toContain('persistNewDemandWithCompatibility(prepared, true)')
  })
})
