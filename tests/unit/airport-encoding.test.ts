import { describe, expect, it } from 'vitest'

import {
  sanitizeAirportStagePayload,
  toWindows1252SafeText,
} from '@/lib/geography/airport-encoding'

describe('airport staging database encoding', () => {
  it('preserves Portuguese accents and characters represented by WIN1252', () => {
    expect(toWindows1252SafeText('São José · Vitória – Café')).toBe('São José · Vitória – Café')
  })

  it('transliterates non-representable punctuation deterministically', () => {
    expect(toWindows1252SafeText('Fuaʻamotu / Nukuʼalofa')).toBe("Fua'amotu / Nuku'alofa")
    expect(toWindows1252SafeText('Łódź ✈')).toBe('Lódz ?')
  })

  it('sanitizes only staged WIN1252 payloads, including nested metadata', () => {
    const payload = {
      name: 'Aeroporto João Paulo II',
      municipality: 'Nukuʼalofa',
      aliases: [{ alias: 'Fuaʻamotu' }],
    }
    expect(sanitizeAirportStagePayload(payload, 'WIN1252')).toEqual({
      name: 'Aeroporto João Paulo II',
      municipality: "Nuku'alofa",
      aliases: [{ alias: "Fua'amotu" }],
    })
    expect(sanitizeAirportStagePayload(payload, 'UTF8')).toBe(payload)
  })
})
