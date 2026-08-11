'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, Loader2, PencilLine, Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'

import { AirlineLogo } from './airline-logo'
import {
  AIRLINE_SEARCH_DEBOUNCE_MS,
  MIN_AIRLINE_QUERY_LENGTH,
  airlineSearchQuery,
  buildAirlineSearchUrl,
  formatAirlineLegacyValue,
  normalizeAirlineSearchLimit,
  parseAirlineSearchResponse,
  readAirlineApiError,
  type AirlineOption,
} from './airline-combobox-model'

export {
  AIRLINE_SEARCH_DEBOUNCE_MS,
  MIN_AIRLINE_QUERY_LENGTH,
  buildAirlineSearchUrl,
  formatAirlineLegacyValue,
  parseAirlineSearchResponse,
} from './airline-combobox-model'
export type { AirlineOption } from './airline-combobox-model'

export interface AirlineComboboxProps {
  id?: string
  label?: string
  airlineCode: string
  airlineName: string
  onChange: (airlineCode: string, airlineName: string, airline: AirlineOption | null) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  required?: boolean
  className?: string
  limit?: number
}

/**
 * Selects the airline code and name as one catalog-backed value. Consultants
 * can explicitly switch to manual entry when a carrier is not cataloged.
 */
export function AirlineCombobox({
  id,
  label = 'Companhia aérea *',
  airlineCode,
  airlineName,
  onChange,
  placeholder = 'Busque por companhia, IATA ou ICAO',
  emptyMessage = 'Nenhuma companhia aérea encontrada.',
  disabled = false,
  required = true,
  className,
  limit = 20,
}: AirlineComboboxProps) {
  const generatedId = useId().replace(/:/g, '')
  const inputId = id || `airline-combobox-${generatedId}`
  const listboxId = `${inputId}-listbox`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentValue = formatCurrentValue(airlineCode, airlineName)
  const lastEmittedValueRef = useRef(currentValue)
  const [query, setQuery] = useState(currentValue)
  const [items, setItems] = useState<AirlineOption[]>([])
  const [open, setOpen] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const normalizedLimit = normalizeAirlineSearchLimit(limit)
  const searchQuery = airlineSearchQuery(query)
  const canSearch = searchQuery.length >= MIN_AIRLINE_QUERY_LENGTH
  const activeOption = items[activeIndex] || null
  const statusMessage = useMemo(() => {
    if (!open || manualMode) return ''
    if (!canSearch) return 'Digite o nome ou o código da companhia para buscar.'
    if (loading) return 'Buscando companhias aéreas...'
    if (error) return error
    if (!items.length) return emptyMessage
    return `${items.length} companhia(s) encontrada(s).`
  }, [canSearch, emptyMessage, error, items.length, loading, manualMode, open])

  useEffect(() => {
    if (currentValue === lastEmittedValueRef.current) return
    setQuery(currentValue)
    lastEmittedValueRef.current = currentValue
  }, [currentValue])

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    if (!open || manualMode || !canSearch || disabled) {
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
      void fetch(buildAirlineSearchUrl(searchQuery, normalizedLimit), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload: unknown = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(readAirlineApiError(payload) || 'Não foi possível buscar as companhias aéreas.')
          }
          return parseAirlineSearchResponse(payload)
        })
        .then((nextItems) => {
          if (controller.signal.aborted) return
          setItems(nextItems)
          setActiveIndex(0)
        })
        .catch((reason) => {
          if (controller.signal.aborted) return
          setItems([])
          setError(reason instanceof Error ? reason.message : 'Não foi possível buscar as companhias aéreas.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, AIRLINE_SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [canSearch, disabled, manualMode, normalizedLimit, open, searchQuery])

  useEffect(() => {
    if (activeIndex < items.length) return
    setActiveIndex(Math.max(0, items.length - 1))
  }, [activeIndex, items.length])

  useEffect(() => {
    if (!open || !activeOption) return
    document.getElementById(optionId(inputId, activeOption.id))?.scrollIntoView({ block: 'nearest' })
  }, [activeOption, inputId, open])

  function emit(code: string, name: string, airline: AirlineOption | null) {
    const nextValue = formatCurrentValue(code, name)
    lastEmittedValueRef.current = nextValue
    onChange(code, name, airline)
  }

  function choose(airline: AirlineOption) {
    const nextValue = formatAirlineLegacyValue(airline)
    setQuery(nextValue)
    setOpen(false)
    setError('')
    emit(airline.iataCode, airline.name, airline)
  }

  function clear() {
    setQuery('')
    setItems([])
    setOpen(false)
    setError('')
    emit('', '', null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function enableManualMode() {
    setOpen(false)
    setManualMode(true)
  }

  function enableCatalogMode() {
    const nextValue = formatCurrentValue(airlineCode, airlineName)
    setQuery(nextValue)
    setManualMode(false)
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
      setQuery(currentValue)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  if (manualMode) {
    return (
      <fieldset className={cn('space-y-2', className)} disabled={disabled}>
        <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <input
            className="bbt-input"
            value={airlineName}
            onChange={(event) => emit(airlineCode, event.target.value, null)}
            placeholder="Nome da companhia"
            required={required}
            aria-label="Nome da companhia aérea"
          />
          <input
            className="bbt-input uppercase"
            value={airlineCode}
            onChange={(event) => emit(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3), airlineName, null)}
            placeholder="IATA"
            maxLength={3}
            required={required}
            aria-label="Código IATA da companhia aérea"
          />
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold text-bbt-accent hover:underline" onClick={enableCatalogMode}>
          <Search className="h-3.5 w-3.5" aria-hidden="true" /> Buscar no catálogo de companhias
        </button>
      </fieldset>
    )
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
          aria-invalid={required && (!airlineCode || !airlineName) ? true : undefined}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value
            setQuery(nextQuery)
            setItems([])
            setOpen(true)
            setActiveIndex(0)
            emit('', nextQuery, null)
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
            aria-label="Limpar companhia aérea"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>

      {open && !disabled && (
        <div
          className="absolute z-[80] mt-1 max-h-80 w-full min-w-[20rem] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div id={listboxId} role="listbox" aria-label="Companhias aéreas">
            {items.map((airline, index) => {
              const selected = airlineCode === airline.iataCode
              const active = index === activeIndex
              return (
                <button
                  key={airline.id}
                  id={optionId(inputId, airline.id)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(airline)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left',
                    active ? 'bg-cyan-50 text-cyan-950 dark:bg-cyan-950/40 dark:text-cyan-50' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <AirlineLogo iataCode={airline.iataCode} airlineName={airline.name} size="sm" decorative />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{airline.displayName}</span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{airlineMetadata(airline)}</span>
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          {!loading && !error && canSearch && items.length === 0 && (
            <div className="px-3 py-3 text-center text-xs text-slate-500">{emptyMessage}</div>
          )}
          {!loading && !canSearch && (
            <div className="px-3 py-3 text-center text-xs text-slate-500">Digite o nome ou o código da companhia.</div>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Buscando companhias aéreas...
            </div>
          )}
          {!loading && error && <div role="alert" className="px-3 py-3 text-center text-xs text-red-600 dark:text-red-300">{error}</div>}

          <div className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800" onClick={enableManualMode}>
              <PencilLine className="h-3.5 w-3.5 text-bbt-accent" aria-hidden="true" /> Companhia não encontrada? Informar manualmente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatCurrentValue(code: string, name: string): string {
  const normalizedCode = code.trim().toUpperCase()
  const normalizedName = name.trim()
  if (normalizedCode && normalizedName) return `${normalizedCode} - ${normalizedName}`
  return normalizedName || normalizedCode
}

function airlineMetadata(airline: AirlineOption): string {
  const codes = [airline.iataCode, airline.icaoCode].filter(Boolean).join(' · ')
  return [codes, airline.countryCode].filter(Boolean).join(' — ')
}

function optionId(inputId: string, airlineId: string): string {
  return `${inputId}-option-${airlineId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

export default AirlineCombobox
