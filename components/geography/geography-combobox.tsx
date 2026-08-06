'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'

import {
  filterGeographyOptions,
  type GeographyComboboxOption,
} from '@/components/geography/geography-combobox-search'
import { cn } from '@/lib/utils'

export type { GeographyComboboxOption } from '@/components/geography/geography-combobox-search'

interface GeographyComboboxProps {
  id?: string
  label: string
  value: string
  options: GeographyComboboxOption[]
  onChange: (value: string, option: GeographyComboboxOption | null) => void
  onSearchChange?: (query: string) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  loading?: boolean
  required?: boolean
  className?: string
  inputClassName?: string
}

export function GeographyCombobox({
  id,
  label,
  value,
  options,
  onChange,
  onSearchChange,
  placeholder = 'Selecione...',
  emptyMessage = 'Nenhuma localidade encontrada.',
  disabled = false,
  loading = false,
  required = false,
  className,
  inputClassName,
}: GeographyComboboxProps) {
  const generatedId = useId().replace(/:/g, '')
  const inputId = id || `geography-combobox-${generatedId}`
  const listboxId = `${inputId}-listbox`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value],
  )
  const visibleOptions = useMemo(
    () => filterGeographyOptions(options, typed ? query : ''),
    [options, query, typed],
  )
  const activeOption = visibleOptions[activeIndex] || null

  useEffect(() => {
    if (open && typed) return
    setQuery(selectedOption?.label || '')
  }, [open, selectedOption?.label, typed])

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        closeAndRestore()
      }
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
    // closeAndRestore usa somente o estado mais recente por meio do render corrente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOption?.label])

  useEffect(() => {
    if (!open || !activeOption) return
    document.getElementById(optionId(inputId, activeOption.value))?.scrollIntoView({ block: 'nearest' })
  }, [activeOption, inputId, open])

  useEffect(() => {
    if (activeIndex < visibleOptions.length) return
    setActiveIndex(Math.max(0, visibleOptions.length - 1))
  }, [activeIndex, visibleOptions.length])

  function openList() {
    if (disabled) return
    setOpen(true)
    setTyped(false)
    setQuery(selectedOption?.label || '')
    const selectedIndex = options.findIndex((option) => option.value === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }

  function closeAndRestore() {
    setOpen(false)
    setTyped(false)
    setQuery(selectedOption?.label || '')
  }

  function choose(option: GeographyComboboxOption) {
    onChange(option.value, option)
    onSearchChange?.('')
    setQuery(option.label)
    setTyped(false)
    setOpen(false)
  }

  function clearSelection() {
    onChange('', null)
    onSearchChange?.('')
    setQuery('')
    setTyped(false)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      setActiveIndex((current) => Math.min(current + 1, Math.max(visibleOptions.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(Math.max(visibleOptions.length - 1, 0))
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
      closeAndRestore()
      return
    }
    if (event.key === 'Tab') closeAndRestore()
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          role="combobox"
          type="text"
          value={query}
          disabled={disabled}
          required={required}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && activeOption ? optionId(inputId, activeOption.value) : undefined}
          aria-required={required}
          aria-invalid={required && !value ? true : undefined}
          placeholder={placeholder}
          onFocus={(event) => {
            openList()
            event.currentTarget.select()
          }}
          onClick={() => {
            if (!open) openList()
          }}
          onChange={(event) => {
            const nextQuery = event.target.value
            setQuery(nextQuery)
            setTyped(true)
            setOpen(true)
            setActiveIndex(0)
            onSearchChange?.(nextQuery)
          }}
          onKeyDown={handleKeyDown}
          className={cn('bbt-input pl-9 pr-10', inputClassName)}
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-bbt-accent" />
        ) : value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={clearSelection}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-bbt-accent/30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={`Limpar ${label.toLocaleLowerCase('pt-BR')}`}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {open && !loading ? `${visibleOptions.length} opção(ões) encontrada(s).` : ''}
      </span>

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`Opções de ${label}`}
          className="absolute z-[70] mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {visibleOptions.map((option, index) => {
            const selected = option.value === value
            const active = index === activeIndex
            return (
              <button
                key={option.value}
                id={optionId(inputId, option.value)}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm',
                  active ? 'bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />}
              </button>
            )
          })}
          {!loading && visibleOptions.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">{emptyMessage}</div>
          )}
          {loading && visibleOptions.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function optionId(inputId: string, value: string): string {
  return `${inputId}-option-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
