import { describe, expect, it } from 'vitest'

import { localDateTimeWithZoneOffset } from '@/lib/offline-ground/timezone'

describe('offline ground wall-clock timezone serialization', () => {
  it('uses the location timezone instead of the browser timezone', () => {
    expect(localDateTimeWithZoneOffset('2026-09-01T23:30', 'America/Sao_Paulo'))
      .toBe('2026-09-01T23:30:00-03:00')
    expect(localDateTimeWithZoneOffset('2026-09-01T23:30', 'America/Manaus'))
      .toBe('2026-09-01T23:30:00-04:00')
  })

  it('respects daylight-saving offsets where they exist', () => {
    expect(localDateTimeWithZoneOffset('2026-07-01T12:00', 'America/New_York'))
      .toBe('2026-07-01T12:00:00-04:00')
    expect(localDateTimeWithZoneOffset('2026-01-01T12:00', 'America/New_York'))
      .toBe('2026-01-01T12:00:00-05:00')
  })

  it('rejects invalid wall-clock values and zones', () => {
    expect(() => localDateTimeWithZoneOffset('', 'America/Sao_Paulo')).toThrow()
    expect(() => localDateTimeWithZoneOffset('2026-09-01T10:00', 'Invalid/Zone')).toThrow()
  })
})
