// ============================================================
// Storage de Emissoes (atendimentos hoteleiros)
// ============================================================
import {
  applyDomainApiValueLocally,
  loadJSON,
  safeSetJSON,
} from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

export interface Emissao {
  id: string
  hotel_id: number
  empresa_id: string
  funcionario_id?: string | null
  funcionario_nome: string
  data_checkin: string
  data_checkout: string
  valor_total: number
  observacoes: string
  created_at: string
  updated_at?: string
  version?: number
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

export function substituirEmissoesDoServidor(emissoes: Emissao[]): boolean {
  return applyDomainApiValueLocally(STORAGE_KEY, emissoes)
}

export function substituirEmissoesDaEmpresaDoServidor(
  empresaId: string,
  emissoes: Emissao[],
): boolean {
  const outrasEmpresas = load().filter((emissao) => emissao.empresa_id !== empresaId)
  return substituirEmissoesDoServidor([
    ...outrasEmpresas,
    ...emissoes.filter((emissao) => emissao.empresa_id === empresaId),
  ])
}

export function aplicarEmissoesDoServidor(emissoes: Emissao[]): boolean {
  const porId = new Map(load().map((emissao) => [emissao.id, emissao]))
  for (const emissao of emissoes) porId.set(emissao.id, emissao)
  return substituirEmissoesDoServidor([...porId.values()])
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
    id: createEntityId('ems'),
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
    id: createEntityId('ems'),
    created_at: new Date().toISOString(),
  }))
  save([...atuais, ...novas])
  return novas.length
}
