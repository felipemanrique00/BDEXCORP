import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const temporalInputSource = source('components/ui/date-input.tsx')
const globalStyles = source('app/globals.css')

describe('browser-safe temporal inputs', () => {
  it('uses one accessible picker with progressive browser fallback', () => {
    expect(temporalInputSource).toContain("type={temporalKind}")
    expect(temporalInputSource).toContain('autoComplete="off"')
    expect(temporalInputSource).toContain("typeof input.showPicker === 'function'")
    expect(temporalInputSource).toContain('input.showPicker()')
    expect(temporalInputSource).toContain('input.click()')
    expect(temporalInputSource).toContain('type="button"')
    expect(temporalInputSource).toContain('aria-label={resolvedPickerLabel}')
    expect(temporalInputSource).toContain('bbt-temporal-input pr-10')
    expect(temporalInputSource).toContain("type TemporalKind = 'date' | 'datetime-local' | 'time'")
    expect(temporalInputSource).toContain('export const TimeInput')
  })

  it('scopes native calendar normalization and preserves both themes', () => {
    expect(globalStyles).toContain('.bbt-temporal-control')
    expect(globalStyles).toContain('.bbt-temporal-input::-webkit-calendar-picker-indicator')
    expect(globalStyles).toContain('.bbt-temporal-input::-webkit-inner-spin-button')
    expect(globalStyles).toContain('.bbt-temporal-input::-webkit-datetime-edit')
    expect(globalStyles).toContain('.bbt-temporal-input::-webkit-date-and-time-value')
    expect(globalStyles).toContain('.dark .bbt-temporal-input')
    expect(globalStyles).toContain('color-scheme: light')
    expect(globalStyles).toContain('color-scheme: dark')
    expect(globalStyles).not.toContain('data-1p-ignore')
    expect(globalStyles).not.toContain('data-lpignore')
  })

  it.each([
    ['components/users/corporate-access-editor.tsx', 'DateInput', 4],
    ['app/dashboard/reservas/page.tsx', 'DateInput', 2],
    ['components/travel/hotel-demand-configurator.tsx', 'DateInput', 2],
    ['components/travel/offline-hotel-quote-form.tsx', 'DateTimeInput', 2],
    ['components/travel/offline-travel-operation-form.tsx', 'DateTimeInput', 3],
  ] as const)('migrates %s to %s', (path, component, expectedCount) => {
    const migratedSource = source(path)
    const instances = migratedSource.match(new RegExp(`<${component}\\b`, 'g')) || []

    expect(instances).toHaveLength(expectedCount)
    expect(migratedSource).not.toContain('type="date"')
    expect(migratedSource).not.toContain('type="datetime-local"')
  })

  it('keeps picker buttons out of wrapping labels in the migrated offline forms', () => {
    for (const path of [
      'components/travel/offline-hotel-quote-form.tsx',
      'components/travel/offline-travel-operation-form.tsx',
    ]) {
      const migratedSource = source(path)
      expect(migratedSource).toContain('function TemporalField')
      expect(migratedSource).toContain('<div>')
    }
  })

  it('uses the shared temporal control for the air request date and time windows', () => {
    const airDemandSource = source('components/travel/air-demand-configurator.tsx')
    expect(airDemandSource.match(/<TimeInput\b/g)).toHaveLength(2)
    expect(airDemandSource).not.toContain('type="time"')
    expect(airDemandSource).toContain('function TemporalField')
  })
})
