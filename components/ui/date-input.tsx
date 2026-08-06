'use client'

import { CalendarDays, CalendarClock } from 'lucide-react'
import {
  forwardRef,
  useRef,
  type ForwardedRef,
  type InputHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

type TemporalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete'> & {
  containerClassName?: string
  pickerLabel?: string
}

type TemporalKind = 'date' | 'datetime-local'

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  if (ref) ref.current = value
}

const BrowserSafeTemporalInput = forwardRef<HTMLInputElement, TemporalInputProps & { temporalKind: TemporalKind }>(function BrowserSafeTemporalInput(
  {
    className,
    containerClassName,
    pickerLabel,
    disabled,
    readOnly,
    ...props
  }: TemporalInputProps & { temporalKind: TemporalKind },
  forwardedRef,
) {
  const { temporalKind, ...inputProps } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const Icon = temporalKind === 'date' ? CalendarDays : CalendarClock
  const resolvedPickerLabel = pickerLabel
    || (temporalKind === 'date' ? 'Abrir calendário' : 'Abrir calendário e horário')

  function openPicker() {
    const input = inputRef.current
    if (!input || input.disabled || input.readOnly) return

    input.focus({ preventScroll: true })
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // Alguns navegadores restringem showPicker; o clique nativo é o fallback.
      }
    }
    input.click()
  }

  return (
    <div className={cn('bbt-temporal-control relative min-w-0', containerClassName)}>
      <input
        {...inputProps}
        ref={(node) => {
          inputRef.current = node
          assignRef(forwardedRef, node)
        }}
        type={temporalKind}
        autoComplete="off"
        disabled={disabled}
        readOnly={readOnly}
        className={cn('bbt-input bbt-temporal-input pl-9 pr-10 tabular-nums', className)}
      />
      <button
        type="button"
        aria-label={resolvedPickerLabel}
        title={resolvedPickerLabel}
        disabled={disabled || readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openPicker()
        }}
        className="bbt-temporal-picker absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-bbt-primary focus:outline-none focus:ring-2 focus:ring-bbt-accent/30 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
})

export const DateInput = forwardRef<HTMLInputElement, TemporalInputProps>(
  function DateInput(props, ref) {
    return <BrowserSafeTemporalInput {...props} temporalKind="date" ref={ref} />
  },
)

export const DateTimeInput = forwardRef<HTMLInputElement, TemporalInputProps>(
  function DateTimeInput(props, ref) {
    return <BrowserSafeTemporalInput {...props} temporalKind="datetime-local" ref={ref} />
  },
)
