import { ApprovalWorkflowError } from '@/lib/approvals/graph'
import type { ApprovalSlaResult, BusinessCalendarDefinition } from '@/lib/approvals/types'

const MAX_SCAN_MINUTES = 1_100_000

export function addBusinessMinutes(
  startAt: string,
  durationMinutes: number,
  calendar: BusinessCalendarDefinition,
): string {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new ApprovalWorkflowError('INVALID_SLA_DURATION', 'Duracao do SLA deve ser um inteiro positivo.', 400)
  }
  let timestamp = Date.parse(startAt)
  if (!Number.isFinite(timestamp)) throw new ApprovalWorkflowError('INVALID_SLA_START', 'Inicio do SLA invalido.', 400)
  validateCalendar(calendar)

  let remaining = durationMinutes
  let scanned = 0
  while (remaining > 0 && scanned < MAX_SCAN_MINUTES) {
    timestamp += 60_000
    scanned += 1
    if (isBusinessMinute(timestamp, calendar)) remaining -= 1
  }
  if (remaining > 0) throw new ApprovalWorkflowError('SLA_CALCULATION_LIMIT', 'Nao foi possivel calcular o SLA dentro do limite seguro.')
  return new Date(timestamp).toISOString()
}

export function evaluateApprovalSla(
  startedAt: string,
  durationMinutes: number,
  reminderMinutes: number[],
  calendar: BusinessCalendarDefinition,
  now: string,
): ApprovalSlaResult {
  const dueAt = addBusinessMinutes(startedAt, durationMinutes, calendar)
  const nowValue = Date.parse(now)
  if (!Number.isFinite(nowValue)) throw new ApprovalWorkflowError('INVALID_SLA_NOW', 'Data atual do SLA invalida.', 400)
  const remainingMinutes = Math.ceil((Date.parse(dueAt) - nowValue) / 60_000)
  const reminderAt = [...new Set(reminderMinutes)]
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0 && minutes < durationMinutes)
    .sort((left, right) => right - left)
    .map((minutesBefore) => subtractBusinessMinutes(dueAt, minutesBefore, calendar))
  const dueSoonLimit = reminderMinutes.length ? Math.max(...reminderMinutes) : 60
  return {
    dueAt,
    reminderAt,
    status: remainingMinutes < 0 ? 'overdue' : remainingMinutes <= dueSoonLimit ? 'due_soon' : 'on_time',
    remainingMinutes,
  }
}

function subtractBusinessMinutes(endAt: string, durationMinutes: number, calendar: BusinessCalendarDefinition): string {
  let timestamp = Date.parse(endAt)
  let remaining = durationMinutes
  let scanned = 0
  while (remaining > 0 && scanned < MAX_SCAN_MINUTES) {
    if (isBusinessMinute(timestamp, calendar)) remaining -= 1
    timestamp -= 60_000
    scanned += 1
  }
  if (remaining > 0) throw new ApprovalWorkflowError('SLA_CALCULATION_LIMIT', 'Nao foi possivel calcular o lembrete dentro do limite seguro.')
  return new Date(timestamp + 60_000).toISOString()
}

function isBusinessMinute(timestamp: number, calendar: BusinessCalendarDefinition): boolean {
  const parts = zonedParts(timestamp, calendar.timezone)
  if (calendar.holidays.includes(parts.date)) return false
  return (calendar.weeklySchedule[parts.weekday] || []).some((window) => {
    const current = parts.hour * 60 + parts.minute
    return current >= minutes(window.start) && current < minutes(window.end)
  })
}

function zonedParts(timestamp: number, timezone: string): { date: string; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
  const weekdays: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function validateCalendar(calendar: BusinessCalendarDefinition): void {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: calendar.timezone }).format(new Date())
  } catch {
    throw new ApprovalWorkflowError('INVALID_CALENDAR_TIMEZONE', 'Timezone do calendario invalido.', 400)
  }
  Object.values(calendar.weeklySchedule).flat().forEach((window) => {
    if (minutes(window.end) <= minutes(window.start)) {
      throw new ApprovalWorkflowError('INVALID_BUSINESS_WINDOW', 'Fim do expediente deve ser posterior ao inicio.', 400)
    }
  })
}

function minutes(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) throw new ApprovalWorkflowError('INVALID_BUSINESS_TIME', 'Horario do calendario invalido.', 400)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new ApprovalWorkflowError('INVALID_BUSINESS_TIME', 'Horario do calendario invalido.', 400)
  return hour * 60 + minute
}
