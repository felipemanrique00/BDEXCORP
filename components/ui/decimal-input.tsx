'use client'

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'

import {
  clampDecimalInputNumber,
  decimalInputToNumber,
  formatDecimalInput,
  numberToDecimalInput,
  sanitizeDecimalInput,
} from '@/lib/decimal-input'
import { cn } from '@/lib/utils'

export interface DecimalInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode'
> {
  value: string
  onValueChange: (value: string) => void
  scale?: number
  prefix?: string
  containerClassName?: string
}

export const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(function DecimalInput({
  value,
  onValueChange,
  scale = 2,
  prefix,
  className,
  containerClassName,
  onBlur,
  ...props
}, ref) {
  return (
    <div className={cn('relative min-w-0', containerClassName)} data-decimal-control>
      {prefix && (
        <span
          className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-xs font-semibold text-slate-400"
          aria-hidden="true"
        >
          {prefix}
        </span>
      )}
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value, scale))}
        onBlur={(event) => {
          const formatted = formatDecimalInput(event.currentTarget.value, scale)
          if (formatted !== value) onValueChange(formatted)
          onBlur?.(event)
        }}
        className={cn(
          'bbt-input appearance-none tabular-nums',
          prefix && 'pl-11',
          className,
        )}
        data-decimal-input
      />
    </div>
  )
})

export interface NumericDecimalInputProps extends Omit<
  DecimalInputProps,
  'value' | 'onValueChange'
> {
  value: number | null | undefined
  onNumberChange: (value: number | null) => void
  /** Numeric/null value exposed to form state when the draft is cleared. */
  emptyValue?: number | null
  minValue?: number
  maxValue?: number
  /** Preserve legacy forms that intentionally render their numeric zero as an empty field. */
  blankWhenZero?: boolean
}

/**
 * Keeps a pt-BR decimal draft while the field is focused, but continuously exposes
 * number/null to the form state so API payload contracts never receive localized strings.
 */
export const NumericDecimalInput = forwardRef<HTMLInputElement, NumericDecimalInputProps>(
  function NumericDecimalInput({
    value,
    onNumberChange,
    emptyValue = null,
    minValue,
    maxValue,
    blankWhenZero = false,
    scale = 2,
    onFocus,
    onBlur,
    ...props
  }, ref) {
    const externalValue = blankWhenZero && value === 0
      ? ''
      : numberToDecimalInput(value, scale)
    const [draft, setDraft] = useState(externalValue)
    const focusedRef = useRef(false)

    useEffect(() => {
      if (!focusedRef.current) setDraft(externalValue)
    }, [externalValue])

    return (
      <DecimalInput
        {...props}
        ref={ref}
        scale={scale}
        value={draft}
        onValueChange={(nextValue) => {
          setDraft(nextValue)
          onNumberChange(clampDecimalInputNumber(
            decimalInputToNumber(nextValue, scale) ?? emptyValue,
            minValue,
            maxValue,
          ))
        }}
        onFocus={(event) => {
          focusedRef.current = true
          onFocus?.(event)
        }}
        onBlur={(event) => {
          focusedRef.current = false
          const numericValue = clampDecimalInputNumber(
            decimalInputToNumber(event.currentTarget.value, scale) ?? emptyValue,
            minValue,
            maxValue,
          )
          setDraft(
            numericValue === null || (blankWhenZero && numericValue === 0)
              ? ''
              : numberToDecimalInput(numericValue, scale),
          )
          onBlur?.(event)
        }}
      />
    )
  },
)
