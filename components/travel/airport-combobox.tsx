'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, Loader2, MapPin, X } from 'lucide-react'

import {
  AIRPORT_SEARCH_DEBOUNCE_MS,
  MIN_AIRPORT_QUERY_LENGTH,
  airportSearchQuery,
  buildAirportSearchUrl,
  formatAirportLegacyValue,
  normalizeAirportSearchLimit,
  parseAirportSearchResponse,
  readAirportApiError,
  type AirportOption,
} from '@/components/travel/airport-combobox-model'
import { cn } from '@/lib/utils'

export {
  AIRPORT_SEARCH_DEBOUNCE_MS,
  MIN_AIRPORT_QUERY_LENGTH,
  buildAirportSearchUrl,
  formatAirportLegacyValue,
  parseAirportSearchResponse,
} from '@/components/travel/airport-combobox-model'
export type { AirportOption } from '@/components/travel/airport-combobox-model'

export interface AirportComboboxProps {
  id?: string
  label: string
  value: string
  onChange: (value: string, airport: AirportOption | null) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  required?: boolean
  className?: string
  limit?: number
}

export function AirportCombobox({
  id,
  label,
  value,
  onChange,
  placeholder = 'Busque por cidade, aeroporto, IATA ou ICAO',
  emptyMessage = 'Nenhum aeroporto encontrado.',
  disabled = false,
  required = false,
  className,
  limit = 20,
}: AirportComboboxProps) {
  const generatedId = useId().replace(/:/g, '')
  const inputId = id || `airport-combobox-${generatedId}`
  const listboxId = `${inputId}-listbox`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastEmittedValueRef = useRef(value)
  const [query, setQuery] = useState(value)
  const [items, setItems] = useState<AirportOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const normalizedLimit = normalizeAirportSearchLimit(limit)
  const trimmedQuery = query.trim()
  const searchQuery = airportSearchQuery(trimmedQuery)
  const canSearch = searchQuery.length >= MIN_AIRPORT_QUERY_LENGTH
  const activeOption = items[activeIndex] || null
  const statusMessage = useMemo(() => {
    if (!open) return ''
    if (!canSearch) return `Digite ao menos ${MIN_AIRPORT_QUERY_LENGTH} caracteres para buscar.`
    if (loading) return 'Buscando aeroportos...'
    if (error) return error
    if (!items.length) return emptyMessage
    return `${items.length} aeroporto(s) encontrado(s).`
  }, [canSearch, emptyMessage, error, items.length, loading, open])

  useEffect(() => {
    if (value === lastEmittedValueRef.current) return
    setQuery(value)
    lastEmittedValueRef.current = value
  }, [value])

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    if (!open || !canSearch || disabled) {
      setLoading(false)
      setError('')
      if (!canSearch) setItems([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setItems([])
      setActiveIndex(0)
      setLoading(true)
      setError('')
      void fetch(buildAirportSearchUrl(searchQuery, normalizedLimit), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload: unknown = await response.json().catch(() => null)
          if (!response.ok) {
            const message = readAirportApiError(payload) || 'Não foi possível buscar os aeroportos.'
            throw new Error(message)
          }
          return parseAirportSearchResponse(payload)
        })
        .then((nextItems) => {
          if (controller.signal.aborted) return
          setItems(nextItems)
          setActiveIndex(0)
        })
        .catch((reason) => {
          if (controller.signal.aborted) return
          setItems([])
          setError(reason instanceof Error ? reason.message : 'Não foi possível buscar os aeroportos.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, AIRPORT_SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [canSearch, disabled, normalizedLimit, open, searchQuery])

  useEffect(() => {
    if (activeIndex < items.length) return
    setActiveIndex(Math.max(0, items.length - 1))
  }, [activeIndex, items.length])

  useEffect(() => {
    if (!open || !activeOption) return
    document.getElementById(optionId(inputId, activeOption.id))?.scrollIntoView({ block: 'nearest' })
  }, [activeOption, inputId, open])

  function emit(nextValue: string, airport: AirportOption | null) {
    lastEmittedValueRef.current = nextValue
    onChange(nextValue, airport)
  }

  function choose(airport: AirportOption) {
    const nextValue = formatAirportLegacyValue(airport)
    setQuery(nextValue)
    setOpen(false)
    setError('')
    emit(nextValue, airport)
  }

  function clear() {
    setQuery('')
    setItems([])
    setOpen(false)
    setError('')
    emit('', null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      else setActiveIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(Math.max(items.length - 1, 0))
      return
    }
    if (event.key === 'Enter' && open && activeOption) {
      event.preventDefault()
      choose(activeOption)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery(value)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <label htmlFor={inputId} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          type="text"
          value={query}
          disabled={disabled}
          required={required}
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && activeOption ? optionId(inputId, activeOption.id) : undefined}
          aria-busy={loading}
          aria-required={required}
          aria-invalid={required && !value ? true : undefined}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value
            setQuery(nextQuery)
            setItems([])
            setOpen(true)
            setActiveIndex(0)
            emit(nextQuery, null)
          }}
          onKeyDown={handleKeyDown}
          className="bbt-input pr-10"
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-bbt-accent" aria-hidden="true" />
        ) : query ? (
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-bbt-accent/30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={`Limpar ${label.toLocaleLowerCase('pt-BR')}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`Opções de ${label}`}
          className="absolute z-[80] mt-1 max-h-72 w-full min-w-[18rem] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {items.map((airport, index) => {
            const selected = value === formatAirportLegacyValue(airport)
            const active = index === activeIndex
            return (
              <button
                key={airport.id}
                id={optionId(inputId, airport.id)}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(airport)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left',
                  active ? 'bg-cyan-50 text-cyan-950 dark:bg-cyan-950/40 dark:text-cyan-50' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{airport.label}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {airportMetadata(airport)}
                  </span>
                </span>
                {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />}
              </button>
            )
          })}

          {!loading && !error && canSearch && items.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">{emptyMessage}</div>
          )}
          {!loading && !canSearch && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">
              Digite ao menos {MIN_AIRPORT_QUERY_LENGTH} caracteres para buscar por cidade ou código.
            </div>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Buscando aeroportos...
            </div>
          )}
          {!loading && error && (
            <div role="alert" className="px-3 py-4 text-center text-xs text-red-600 dark:text-red-300">{error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function airportMetadata(airport: AirportOption): string {
  const codes = [airport.iataCode, airport.icaoCode].filter(Boolean).join(' · ')
  const location = [airport.municipality, airport.subdivisionCode, airport.countryCode].filter(Boolean).join(' · ')
  return [codes, location].filter(Boolean).join(' — ')
}

function optionId(inputId: string, airportId: string): string {
  return `${inputId}-option-${airportId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

export default AirportCombobox
