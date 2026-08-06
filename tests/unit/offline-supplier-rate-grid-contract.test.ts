import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'components/suppliers/offline-supplier-rates.tsx'),
  'utf8',
)

const RATE_DRAFT_FIELDS = [
  'roomTypeId',
  'code',
  'validFrom',
  'validUntil',
  'currency',
  'rackAmount',
  'agreementAmount',
  'taxAmount',
  'serviceFeeAmount',
  'isNet',
  'isSuspended',
  'isActive',
  'refundable',
  'mealPlan',
  'cancellationPolicy',
  'paymentTerms',
  'scopeTargets',
] as const

describe('offline supplier rate inline grid contract', () => {
  it('keeps every RateDraft field wired through edit, submit and rehydration', () => {
    const interfaceBody = section('interface RateDraft {', '\n}')
    const declaredFields = [...interfaceBody.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])
    const editor = section('function EditableRateRows(', 'function RateReadOnlyRow(')
    const save = section('async function save(', '\n  const title')
    const rehydrate = section('function rateToDraft(', 'function validateRateDraft(')

    expect(declaredFields.sort()).toEqual([...RATE_DRAFT_FIELDS].sort())

    for (const field of RATE_DRAFT_FIELDS) {
      const hasFieldMarker = editor.includes(`data-rate-field="${field}"`)
        || editor.includes(`dataField="${field}"`)

      expect(hasFieldMarker, `${field} must have a stable field marker`).toBe(true)
      expect(editor, `${field} must update the controlled draft`).toContain(`onChange('${field}'`)
      expect(save, `${field} must be included in the submitted payload`).toMatch(new RegExp(`draft\\.${field}\\b`))
      expect(rehydrate, `${field} must be restored when editing`).toContain(`${field}:`)
    }
  })

  it('uses one valid, responsive and labelled form around the editable table', () => {
    const formStart = source.indexOf('<form onSubmit=')
    const tableStart = source.indexOf('<table', formStart)
    const tableEnd = source.indexOf('</table>', tableStart)
    const formEnd = source.indexOf('</form>', tableEnd)

    expect(source.match(/<form\b/g)).toHaveLength(1)
    expect(formStart).toBeGreaterThan(-1)
    expect(tableStart).toBeGreaterThan(formStart)
    expect(tableEnd).toBeGreaterThan(tableStart)
    expect(formEnd).toBeGreaterThan(tableEnd)
    expect(source).toContain('data-rate-editor="inline"')
    expect(source).toContain('overflow-x-auto overscroll-x-contain')
    expect(source).toContain('tabIndex={0} role="region"')
    expect(source).toContain('aria-label="Grade de tarifas com rolagem horizontal"')
    expect(source).toContain('aria-describedby={`supplier-rate-scroll-help-${scope}`}')
    expect(source).toContain('<caption className="sr-only">')
    expect(source.match(/<th scope="col"/g)).toHaveLength(9)

    expect(source).not.toMatch(/<tbody[^>]*>\s*<form\b/)
    expect(source).not.toMatch(/<tr[^>]*>\s*<form\b/)
    expect(source).not.toMatch(/<form[^>]*>\s*<tr\b/)
  })

  it('keeps compound date controls outside labels and exposes editor feedback and actions', () => {
    const editor = section('function EditableRateRows(', 'function RateReadOnlyRow(')

    expect(editor.match(/<DateInput\b/g)).toHaveLength(2)
    expect(editor.match(/<GridLabel[^>]*asDiv>/g)).toHaveLength(2)
    expect(editor).toContain('aria-label="Início da vigência da tarifa"')
    expect(editor).toContain('aria-label="Fim da vigência da tarifa"')
    expect(editor).toContain('role="alert"')
    expect(editor).toContain('aria-label="Cancelar edição da tarifa"')
    expect(editor).toContain('aria-label="Salvar tarifa"')
    expect(editor).toContain('<td colSpan={9}')
  })
})

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)

  expect(start, `missing source marker: ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `missing source marker: ${endMarker}`).toBeGreaterThan(start)

  return source.slice(start, end)
}
