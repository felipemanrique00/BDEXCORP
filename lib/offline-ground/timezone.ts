const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Serializes a wall-clock value from an HTML datetime-local input with the
 * offset of the store/terminal, rather than the browser's own timezone.
 */
export function localDateTimeWithZoneOffset(value: string, timeZone: string): string {
  const match = String(value || '').trim().match(LOCAL_DATE_TIME)
  if (!match) throw new Error('Informe uma data e hora local valida.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] || 0)
  const wallClockUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second)
  if (!Number.isFinite(wallClockUtc)) throw new Error('Informe uma data e hora local valida.')

  let instant = wallClockUtc
  let offsetMinutes = 0
  for (let pass = 0; pass < 3; pass += 1) {
    const zoned = zonedDateTimeParts(new Date(instant), timeZone)
    const representedUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    )
    offsetMinutes = Math.round((representedUtc - instant) / 60_000)
    instant = wallClockUtc - offsetMinutes * 60_000
  }

  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`
  return `${local}${offset}`
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    throw new Error('O fuso horario da localidade e invalido.')
  }
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  if (!values.year || !values.month || !values.day
      || values.hour === undefined || values.minute === undefined || values.second === undefined) {
    throw new Error('Nao foi possivel resolver o fuso horario da localidade.')
  }
  return values as {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
  }
}
