import { describe, expect, it } from 'vitest'

import {
  storageKeysForDashboardPath,
  storageKeysForReportPath,
} from '@/lib/storage-hydration-plan'
import { RESETTABLE_SHARED_STORAGE_KEYS } from '@/lib/storage-keys'

describe('storage hydration plan', () => {
  it('loads only registration data on company pages', () => {
    const result = storageKeysForDashboardPath('/dashboard/empresas')

    expect(result).toContain('bbt-data-v4')
    expect(result).toContain('bbt-solicitantes-empresa')
    expect(result).not.toContain('bbt-atendimentos')
    expect(result).not.toContain('bbt-financeiro')
  })

  it('loads demand and voucher data for the operation queue', () => {
    const result = storageKeysForDashboardPath('/dashboard/demandas')

    expect(result).toEqual(expect.arrayContaining([
      'bbt-data-v4',
      'bbt-atendimentos',
      'bbt-vouchers-emitidos',
    ]))
    expect(result).not.toContain('bbt-transferencias')
    expect(result).not.toContain('bbt-corporate-finance')
  })

  it('loads every report dependency without assistant history', () => {
    const result = storageKeysForReportPath('/relatorios/grupo')

    expect(result).toEqual(expect.arrayContaining([
      'bbt-data-v4',
      'bbt-atendimentos',
      'bbt-vouchers-emitidos',
      'bbt-financeiro',
      'bbt-corporate-finance',
      'bbt-emissoes',
      'bbt-wintour-imports-v1',
    ]))
    expect(result).not.toContain('bbt-assistant-conversations-v1')
  })

  it('loads the complete resettable dataset only for system settings', () => {
    const result = storageKeysForDashboardPath('/dashboard/configuracoes/')

    expect(new Set(result)).toEqual(new Set(RESETTABLE_SHARED_STORAGE_KEYS))
  })

  it('keeps server-managed assistant data out of browser hydration', () => {
    const regular = storageKeysForDashboardPath('/dashboard/usuarios')
    const assistant = storageKeysForDashboardPath('/dashboard/ia-chat')

    expect(regular).not.toContain('bbt-assistant-conversations-v1')
    expect(assistant.some((key) => key.startsWith('bbt-assistant-'))).toBe(false)
    expect(assistant.some((key) => key.startsWith('bbt-ai-agent-'))).toBe(false)
    expect(assistant).not.toContain('bbt-ia-chat-historico-v12')
    expect(assistant).not.toContain('bbt-ia-config-v12')
    expect(assistant).not.toContain('bbt-resumos-executivos-v12')
    expect(assistant).not.toContain('bbt-travel-desk-v11')
    expect(assistant).toContain('bbt-atendimentos')
  })

  it('keeps server-managed communication history out of dashboard hydration', () => {
    const dashboard = storageKeysForDashboardPath('/dashboard')

    expect(dashboard).not.toContain('bbt-mensagens-thread')
    expect(dashboard).not.toContain('bbt-travel-desk-v11')
  })
})
