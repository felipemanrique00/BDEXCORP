'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { User, Briefcase, Building2, Check, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { encontrarFuncionarioPorNome } from '@/lib/voucher-parser'
import { maskCPF } from '@/lib/utils'

interface Props {
  /** Nome digitado do passageiro */
  value: string
  onChange: (nome: string) => void
  /** Callback quando seleciona um funcionário cadastrado */
  onSelectFuncionario?: (funcionarioId: string | null, nome: string) => void
  /** Filtrar apenas funcionários desta empresa */
  empresaId?: string
  /** ID do funcionário atualmente vinculado (pra mostrar badge de "vinculado") */
  funcionarioIdAtual?: string | null
  placeholder?: string
  required?: boolean
}

export function PassageiroAutocomplete({
  value, onChange, onSelectFuncionario, empresaId, funcionarioIdAtual, placeholder, required,
}: Props) {
  const { funcionarios, empresas } = useStore()
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Sugestões baseadas no nome digitado
  const sugestoes = useMemo(() => {
    if (!value || value.trim().length < 2) return []
    return encontrarFuncionarioPorNome(value, funcionarios, empresaId).slice(0, 4)
  }, [value, funcionarios, empresaId])

  // Dados completos do funcionário atualmente vinculado (se houver)
  const vinculado = useMemo(() => {
    if (!funcionarioIdAtual) return null
    return funcionarios.find((f) => f.id === funcionarioIdAtual)
  }, [funcionarioIdAtual, funcionarios])

  function selecionarFuncionario(funcId: string, nome: string) {
    onChange(nome)
    onSelectFuncionario?.(funcId, nome)
    setOpen(false)
  }

  function usarTextoDigitado() {
    onSelectFuncionario?.(null, value)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || sugestoes.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, sugestoes.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && sugestoes[cursor]) {
      e.preventDefault()
      selecionarFuncionario(sugestoes[cursor].id, sugestoes[cursor].nome)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const mostrarDropdown = open && sugestoes.length > 0 && !vinculado

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setCursor(0)
            // Se estava vinculado e o nome mudou, desvincula
            if (vinculado && e.target.value !== vinculado.nome) {
              onSelectFuncionario?.(null, e.target.value)
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Digite o nome do passageiro...'}
          required={required}
          autoComplete="off"
          className={`bbt-input ${vinculado ? 'pr-10 border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10' : ''}`}
        />
        {vinculado && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-green-600 dark:text-green-400" title="Funcionário vinculado">
            <Check className="w-4 h-4" />
            <button
              type="button"
              onClick={() => { onSelectFuncionario?.(null, value); }}
              className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 transition"
              title="Desvincular"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Badge informativo quando vinculado */}
      {vinculado && (
        <div className="mt-1.5 text-[11px] text-green-700 dark:text-green-300 flex items-center gap-2 flex-wrap">
          <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-[10px]">
            <User className="w-2.5 h-2.5" /> Funcionário vinculado
          </span>
          {vinculado.codigo_identificacao && <span className="font-mono">ID {vinculado.codigo_identificacao}</span>}
          {vinculado.cargo && <span>· {vinculado.cargo}</span>}
          {vinculado.cpf && <span className="font-mono">· {maskCPF(vinculado.cpf)}</span>}
          {(() => {
            const emp = empresas.find((e) => e.id === vinculado.company_id)
            return emp && <span>· {emp.nome}</span>
          })()}
        </div>
      )}

      {/* Dropdown de sugestões */}
      {mostrarDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-bbt-gray-100 dark:border-slate-700 overflow-hidden z-40 max-h-80 overflow-y-auto">
          <div className="p-2 bg-bbt-gray-50 dark:bg-slate-900/50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center justify-between">
            <span>🔎 {sugestoes.length} funcionário{sugestoes.length > 1 ? 's' : ''} encontrado{sugestoes.length > 1 ? 's' : ''}</span>
            {empresaId && <span className="text-bbt-accent">filtrado pela empresa</span>}
          </div>
          {sugestoes.map((s, i) => {
            const func = funcionarios.find((f) => f.id === s.id)
            const emp = empresas.find((e) => e.id === s.empresa_id)
            if (!func) return null
            const isCursor = i === cursor
            return (
              <button
                key={s.id}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => selecionarFuncionario(s.id, s.nome)}
                className={`w-full flex items-center gap-3 p-3 text-left transition border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 ${
                  isCursor ? 'bg-bbt-accent/10' : 'hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30'
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold text-xs shrink-0">
                  {s.nome.split(' ').slice(0, 2).map((n) => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-bbt-primary dark:text-white truncate flex items-center gap-2">
                    {s.nome}
                    {func.cargo && (
                      <span className={`bbt-badge text-[9px] ${
                        func.cargo === 'Diretor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        : func.cargo === 'Gerente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        <Briefcase className="w-2.5 h-2.5" /> {func.cargo}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate flex items-center gap-2">
                    {func.codigo_identificacao && <span className="font-mono font-semibold text-bbt-primary dark:text-slate-200">ID {func.codigo_identificacao}</span>}
                    {func.cpf && <span className="font-mono">{maskCPF(func.cpf)}</span>}
                    {emp && <><Building2 className="w-3 h-3" /><span className="truncate">{emp.nome}</span></>}
                  </div>
                </div>
                <div className="text-xs shrink-0">
                  <div className={`w-10 h-2 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700`}>
                    <div className="h-full bg-gradient-to-r from-bbt-accent to-green-500" style={{ width: `${s.score}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-400 text-center mt-0.5">{s.score}%</div>
                </div>
              </button>
            )
          })}
          {value.trim().length >= 2 && (
            <button
              type="button"
              onClick={usarTextoDigitado}
              className="w-full p-2.5 text-xs text-slate-500 hover:text-bbt-accent hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition border-t border-bbt-gray-100 dark:border-slate-700 flex items-center justify-center gap-1"
            >
              ✏️ Usar "<strong>{value}</strong>" sem vincular funcionário
            </button>
          )}
        </div>
      )}

      {/* Dica quando não há sugestões */}
      {open && value.trim().length >= 2 && sugestoes.length === 0 && !vinculado && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 z-40">
          <div className="font-semibold mb-0.5">Nenhum funcionário encontrado com "{value}"</div>
          <div className="opacity-80">
            {empresaId ? 'Nesta empresa.' : 'Selecione uma empresa para filtrar.'} O nome será salvo como passageiro avulso.
          </div>
        </div>
      )}
    </div>
  )
}
