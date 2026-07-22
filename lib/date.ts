const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/

export function localDateToISODate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function utcDateToISODate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISODate(): string {
  return localDateToISODate(new Date())
}

export function excelSerialToISODate(serial: number): string {
  if (!Number.isFinite(serial) || serial <= 0) return ''
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + Math.floor(serial) * 86400000)
  return utcDateToISODate(date)
}

export function toISODateOnly(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''

  if (value instanceof Date) return localDateToISODate(value)

  if (typeof value === 'number') {
    if (value > 1 && value < 90000) return excelSerialToISODate(value)
    return ''
  }

  const text = String(value).trim()
  if (!text) return ''

  const iso = text.match(DATE_ONLY)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  let m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += year < 50 ? 2000 : 1900

    const n1 = Number(m[1])
    const n2 = Number(m[2])
    let day = n1
    let month = n2

    if (n2 > 12 && n1 <= 12) {
      day = n2
      month = n1
    }

    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const months: Record<string, string> = {
    jan: '01', janeiro: '01',
    fev: '02', fevereiro: '02',
    mar: '03', marco: '03', marco_: '03',
    abr: '04', abril: '04',
    mai: '05', maio: '05',
    jun: '06', junho: '06',
    jul: '07', julho: '07',
    ago: '08', agosto: '08',
    set: '09', setembro: '09',
    out: '10', outubro: '10',
    nov: '11', novembro: '11',
    dez: '12', dezembro: '12',
  }
  m = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3,})\s*(?:de\s+)?(\d{2,4})/)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += year < 50 ? 2000 : 1900
    const month = months[m[2]] || months[m[2].slice(0, 3)]
    const day = Number(m[1])
    if (month && year >= 1900 && year <= 2100 && day >= 1 && day <= 31) {
      return `${year}-${month}-${String(day).padStart(2, '0')}`
    }
  }

  const asNumber = Number(text)
  if (Number.isFinite(asNumber) && /^[0-9]+(?:\.[0-9]+)?$/.test(text)) {
    return excelSerialToISODate(asNumber)
  }

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return localDateToISODate(parsed)

  return ''
}

export function formatDateBR(value: string | Date | null | undefined, fallback = '-'): string {
  if (!value) return fallback
  const iso = toISODateOnly(value)
  if (!iso) return typeof value === 'string' ? value : fallback
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function addDaysISODate(iso: string, days: number): string {
  const base = toISODateOnly(iso)
  if (!base) return ''
  const [year, month, day] = base.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return localDateToISODate(date)
}

export function lastDayOfMonthISODate(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-').map(Number)
  if (!year || !month) return ''
  return localDateToISODate(new Date(year, month, 0))
}
