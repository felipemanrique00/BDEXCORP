import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('input visual contract', () => {
  it('keeps bbt input defaults in the component layer so local spacing utilities win', () => {
    const css = source('app/globals.css')
    expect(css).toMatch(/@layer components\s*{\s*\.bbt-input\s*{/)
  })

  it('does not render a decorative icon over airport text', () => {
    const airport = source('components/travel/airport-combobox.tsx')
    expect(airport).not.toContain('<Search')
    expect(airport).not.toContain('pl-9 pr-10')
    expect(airport).toContain('className="bbt-input pr-10"')
  })

  it('uses the shared decimal control in the offline monetary forms', () => {
    for (const path of [
      'components/travel/services/air/offline-air-quote-form.tsx',
      'components/travel/offline-hotel-quote-form.tsx',
      'components/travel/offline-travel-operation-form.tsx',
      'components/suppliers/offline-supplier-rates.tsx',
    ]) {
      const form = source(path)
      expect(form).toContain('DecimalInput')
      expect(form).not.toMatch(/type="number"[^>]*step="0\.01"/)
    }
  })
})
