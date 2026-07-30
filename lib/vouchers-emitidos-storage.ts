// ============================================================
// V10: Storage de VoucherEmitido (vouchers gerados pelo sistema)
// Diferente de vouchers-storage.ts (que é só anexo de arquivo)
// ============================================================
import type { VoucherEmitido, VoucherTipo } from '@/types'
import { VOUCHER_PREFIX, gerarNumeroVoucher } from '@/types'
import {
  applyDomainApiValueLocally,
  compactarVoucherEmitido,
  loadJSON,
  safeGetRaw,
  safeSetJSON,
  safeSetRaw,
} from '@/lib/storage-quota'

const STORAGE_KEY = 'bbt-vouchers-emitidos'
const STORAGE_LAST_NUMERO = 'bbt-vouchers-last-numero'
type UpsertVoucherEmitidoInput = Omit<VoucherEmitido, 'created_at'> & { created_at?: string }

function load(): VoucherEmitido[] {
  if (typeof window === 'undefined') return []
  return loadJSON<VoucherEmitido[]>(STORAGE_KEY, [])
}

function save(list: VoucherEmitido[]): boolean {
  return safeSetJSON(STORAGE_KEY, list.map((item) => compactarVoucherEmitido(item)))
}

function getLastNumero(): number {
  if (typeof window === 'undefined') return 26261
  const v = safeGetRaw(STORAGE_LAST_NUMERO)
  return v ? parseInt(v, 10) : 26261
}

function setLastNumero(n: number) {
  if (typeof window === 'undefined') return
  safeSetRaw(STORAGE_LAST_NUMERO, String(n))
}

export function getAllVouchersEmitidos(): VoucherEmitido[] {
  return load().sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getVoucherEmitidoById(id: string): VoucherEmitido | undefined {
  return load().find((v) => v.id === id)
}

export function aplicarVouchersEmitidosDoServidor(vouchers: VoucherEmitido[]): boolean {
  const current = load()
  const byId = new Map(current.map((voucher) => [voucher.id, voucher]))
  for (const voucher of vouchers) {
    if (voucher.fingerprint) {
      const duplicate = [...byId.values()].find(
        (item) => item.id !== voucher.id && item.fingerprint === voucher.fingerprint,
      )
      if (duplicate) byId.delete(duplicate.id)
    }
    byId.set(voucher.id, compactarVoucherEmitido(voucher) as VoucherEmitido)
  }
  return applyDomainApiValueLocally(STORAGE_KEY, [...byId.values()])
}

export function removerVoucherEmitidoDoServidor(id: string): boolean {
  return applyDomainApiValueLocally(
    STORAGE_KEY,
    load().filter((voucher) => voucher.id !== id),
  )
}

export function getVouchersByAtendimento(atendimentoId: string): VoucherEmitido[] {
  return load().filter((v) => v.atendimento_id === atendimentoId)
}

export function getVouchersByEmpresa(empresaId: string): VoucherEmitido[] {
  return load().filter((v) => v.empresa_id === empresaId)
}

export function getVouchersByFuncionario(funcId: string): VoucherEmitido[] {
  return load().filter((v) => v.funcionario_id === funcId)
}

export function addVoucherEmitido(
  data: Omit<VoucherEmitido, 'id' | 'numero' | 'created_at' | 'updated_at'>
): VoucherEmitido | null {
  try {
    const list = load()
    const last = getLastNumero()
    const id = gerarNumeroVoucher(data.tipo, last)
    const numero = id.split('-')[1]
    const v: VoucherEmitido = {
      ...data,
      id,
      numero,
      origem_voucher: data.origem_voucher || 'criado',
      created_at: new Date().toISOString(),
    }
    list.push(v)
    if (!save(list)) return null
    setLastNumero(parseInt(numero, 10))
    return v
  } catch (e) {
    console.error('Erro ao adicionar voucher:', e)
    return null
  }
}

export function upsertVouchersEmitidosBatch(items: UpsertVoucherEmitidoInput[]): VoucherEmitido[] {
  try {
    const list = load()
    const now = new Date().toISOString()
    let lastNumero = getLastNumero()
    const saved: VoucherEmitido[] = []

    for (const data of items) {
      const fingerprint = data.fingerprint || criarFingerprint(data)
      const existingIndex = list.findIndex((v) => v.id === data.id || (!!fingerprint && v.fingerprint === fingerprint))
      const normalized: VoucherEmitido = {
        ...data,
        fingerprint,
        origem_voucher: data.origem_voucher || 'importado',
        created_at: data.created_at || now,
        updated_at: now,
      }

      if (existingIndex >= 0) {
        list[existingIndex] = { ...list[existingIndex], ...normalized, created_at: list[existingIndex].created_at }
        saved.push(list[existingIndex])
      } else {
        list.push(normalized)
        saved.push(normalized)
      }

      const numero = parseInt(String(normalized.numero || '').replace(/\D/g, ''), 10)
      if (Number.isFinite(numero) && numero > lastNumero) lastNumero = numero
    }

    if (!save(list)) return []
    setLastNumero(lastNumero)
    return saved
  } catch (e) {
    console.error('Erro ao importar/atualizar vouchers:', e)
    return []
  }
}

export function upsertVoucherEmitido(data: UpsertVoucherEmitidoInput): VoucherEmitido | null {
  return upsertVouchersEmitidosBatch([data])[0] || null
}

export function updateVoucherEmitido(id: string, patch: Partial<VoucherEmitido>): VoucherEmitido | null {
  const list = load()
  const idx = list.findIndex((v) => v.id === id)
  if (idx === -1) return null
  list[idx] = { ...list[idx], ...patch, updated_at: new Date().toISOString() }
  if (!save(list)) return null
  return list[idx]
}

export function deleteVoucherEmitido(id: string): boolean {
  const list = load().filter((v) => v.id !== id)
  return save(list)
}

export function buscarVouchers(termo: string): VoucherEmitido[] {
  const t = termo.toLowerCase()
  return load().filter((v) =>
    v.id.toLowerCase().includes(t) ||
    v.numero.toLowerCase().includes(t) ||
    v.passageiro_nome.toLowerCase().includes(t) ||
    (v.passageiros || []).join(' ').toLowerCase().includes(t) ||
    v.fornecedor_nome.toLowerCase().includes(t) ||
    (v.fornecedor_cidade || '').toLowerCase().includes(t) ||
    (v.destino || '').toLowerCase().includes(t) ||
    (v.data_checkin || '').toLowerCase().includes(t) ||
    (v.data_ida || '').toLowerCase().includes(t) ||
    (v.arquivo_original_nome || '').toLowerCase().includes(t) ||
    (v.numero_confirmacao || '').toLowerCase().includes(t) ||
    (v.localizador || '').toLowerCase().includes(t)
  )
}

function criarFingerprint(v: Pick<VoucherEmitido, 'tipo' | 'numero' | 'passageiro_nome' | 'fornecedor_nome' | 'data_checkin' | 'data_ida'>): string {
  return [
    v.tipo,
    v.numero,
    v.passageiro_nome,
    v.fornecedor_nome,
    v.data_checkin || v.data_ida || '',
  ]
    .join('|')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Estatísticas
export function getEstatisticasVouchers(companyIds?: ReadonlySet<string> | null) {
  const all = companyIds ? load().filter((voucher) => companyIds.has(voucher.empresa_id)) : load()
  return {
    total: all.length,
    rascunhos: all.filter((v) => v.status === 'rascunho').length,
    emitidos: all.filter((v) => v.status === 'emitido').length,
    confirmados: all.filter((v) => v.status === 'confirmado').length,
    cancelados: all.filter((v) => v.status === 'cancelado').length,
    importados: all.filter((v) => v.origem_voucher === 'importado' || v.origem_voucher === 'pdf').length,
    valor_total: all.reduce((s, v) => s + (v.total || 0), 0),
    por_tipo: {
      Hotel: all.filter((v) => v.tipo === 'Hotel').length,
      'Aéreo': all.filter((v) => v.tipo === 'Aéreo').length,
      Carro: all.filter((v) => v.tipo === 'Carro').length,
      Pacote: all.filter((v) => v.tipo === 'Pacote').length,
    },
  }
}
