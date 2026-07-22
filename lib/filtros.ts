// ============================================================
// FILTROS PERSISTENTES
// Cada usuário tem seus filtros salvos por tela.
// Sobrevivem a refresh, troca de página, fechamento do navegador.
// ============================================================

import { safeGetRaw, safeRemove, safeSetJSON } from '@/lib/storage-quota'

export interface FiltroPersistente {
  busca?: string
  empresa_id?: string
  funcionario_id?: string
  agente_user_id?: string
  tipo_servico?: string
  status?: string
  prioridade?: string
  desde?: string // ISO YYYY-MM-DD
  ate?: string
  ordenar_por?: string
  ordem?: 'asc' | 'desc'
}

const PREFIX = 'bbt-filtro-'

function chave(userId: string, tela: string): string {
  return `${PREFIX}${userId}::${tela}`
}

export function carregarFiltro(userId: string, tela: string): FiltroPersistente {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(safeGetRaw(chave(userId, tela)) || '{}')
  } catch {
    return {}
  }
}

export function salvarFiltro(userId: string, tela: string, filtro: FiltroPersistente) {
  if (typeof window === 'undefined') return
  // Remove campos vazios pra não inflar
  const limpo: FiltroPersistente = {}
  for (const [k, v] of Object.entries(filtro)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'todos') {
      ;(limpo as any)[k] = v
    }
  }
  if (Object.keys(limpo).length === 0) {
    safeRemove(chave(userId, tela))
  } else {
    safeSetJSON(chave(userId, tela), limpo)
  }
}

export function limparFiltro(userId: string, tela: string) {
  if (typeof window === 'undefined') return
  safeRemove(chave(userId, tela))
}

/**
 * React hook pra usar filtros persistentes facilmente.
 */
import { useState, useEffect, useCallback } from 'react'

export function useFiltroPersistente<T extends FiltroPersistente>(
  userId: string | undefined | null,
  tela: string,
  inicial: T
): [T, (novo: Partial<T>) => void, () => void] {
  const [filtro, setFiltroState] = useState<T>(inicial)

  useEffect(() => {
    if (!userId) return
    const carregado = carregarFiltro(userId, tela)
    setFiltroState({ ...inicial, ...carregado } as T)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tela])

  const setFiltro = useCallback((novo: Partial<T>) => {
    setFiltroState((prev) => {
      const merged = { ...prev, ...novo }
      if (userId) salvarFiltro(userId, tela, merged)
      return merged
    })
  }, [userId, tela])

  const limpar = useCallback(() => {
    setFiltroState(inicial)
    if (userId) limparFiltro(userId, tela)
  }, [userId, tela, inicial])

  return [filtro, setFiltro, limpar]
}
