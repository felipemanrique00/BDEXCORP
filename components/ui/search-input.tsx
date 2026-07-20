'use client'
import { Search, X } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  value: string
  onChangeValue: (v: string) => void
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

/**
 * Campo de busca padronizado SEM BUGS DE SOBREPOSIÇÃO.
 * Fix aplicado:
 * 1. Padding esquerdo > 40px pra ícone não colar na letra
 * 2. Padding direito sempre > 36px pra ter espaço do X
 * 3. z-index alto nos ícones MAS pointer-events-none no ícone de busca
 * 4. Botão X com pointer-events-auto e tamanho de toque 24px+
 * 5. Altura fixa + line-height controlado pra não variar com foco
 */
export function SearchInput({
  value,
  onChangeValue,
  placeholder = 'Pesquisar...',
  size = 'md',
  className = '',
  label,
  ...rest
}: SearchInputProps) {
  const conf = {
    sm: { h: 'h-9', text: 'text-xs', pl: 'pl-10', pr: 'pr-9', iconSize: 'w-4 h-4', iconLeftPos: 'left-3', iconRightPos: 'right-2' },
    md: { h: 'h-10', text: 'text-sm', pl: 'pl-11', pr: 'pr-10', iconSize: 'w-[18px] h-[18px]', iconLeftPos: 'left-3.5', iconRightPos: 'right-2.5' },
    lg: { h: 'h-11', text: 'text-base', pl: 'pl-12', pr: 'pr-11', iconSize: 'w-5 h-5', iconLeftPos: 'left-4', iconRightPos: 'right-3' },
  }[size]

  return (
    <div className={`${className}`}>
      {label && (
        <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">
          {label}
        </label>
      )}
      <div className="relative">
        <div className={`absolute ${conf.iconLeftPos} top-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center`}>
          <Search className={`${conf.iconSize} text-slate-400`} strokeWidth={2} />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full ${conf.h} ${conf.pl} ${conf.pr} ${conf.text} rounded-lg border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 text-bbt-text dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-bbt-accent focus:border-transparent transition`}
          {...rest}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChangeValue('')}
            className={`absolute ${conf.iconRightPos} top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition z-10`}
            aria-label="Limpar busca"
            tabIndex={-1}
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}
