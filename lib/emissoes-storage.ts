// ============================================================
// Storage de Emissoes (atendimentos hoteleiros)
// ============================================================
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

export interface Emissao {
  id: string
  hotel_id: number
  empresa_id: string
  funcionario_nome: string
  data_checkin: string
  data_checkout: string
  valor_total: number
  observacoes: string
  created_at: string
}

const STORAGE_KEY = 'bbt-emissoes'

function load(): Emissao[] {
  if (typeof window === 'undefined') return []
  return loadJSON<Emissao[]>(STORAGE_KEY, [])
}

function save(list: Emissao[]) {
  return safeSetJSON(STORAGE_KEY, list)
}

export function getAllEmissoes(): Emissao[] {
  return load()
}

export function getEmissoesByEmpresa(empresaId: string): Emissao[] {
  return load().filter((e) => e.empresa_id === empresaId)
}

export function getEmissoesByHotel(hotelId: number): Emissao[] {
  return load().filter((e) => e.hotel_id === hotelId)
}

export function addEmissao(data: Omit<Emissao, 'id' | 'created_at'>): Emissao | null {
  const nova: Emissao = {
    ...data,
    id: `ems-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
  }
  const list = load()
  list.push(nova)
  if (!save(list)) return null
  return nova
}

export function deleteEmissao(id: string): boolean {
  return save(load().filter((e) => e.id !== id))
}

export function getRankingHoteisByEmpresa(empresaId: string): { hotel_id: number; total: number; valor_total: number }[] {
  const emissoes = getEmissoesByEmpresa(empresaId)
  const map = new Map<number, { total: number; valor_total: number }>()
  emissoes.forEach((e) => {
    const atual = map.get(e.hotel_id) || { total: 0, valor_total: 0 }
    map.set(e.hotel_id, { total: atual.total + 1, valor_total: atual.valor_total + (e.valor_total || 0) })
  })
  return Array.from(map.entries())
    .map(([hotel_id, v]) => ({ hotel_id, ...v }))
    .sort((a, b) => b.total - a.total)
}

export function importEmissoes(emissoes: Array<Omit<Emissao, 'id' | 'created_at'>>): number {
  const atuais = load()
  const novas = emissoes.map((emissao) => ({
    ...emissao,
    id: `ems-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
  }))
  save([...atuais, ...novas])
  return novas.length
}
