export interface Voucher {
  id: string
  funcionario_id: string
  demanda_id?: string
  nome_arquivo: string
  tamanho_bytes: number
  mime_type: string
  descricao: string
  data_upload: string
  download_url: string
}

interface StoredFilePayload {
  id: string
  originalName: string
  sizeBytes: number
  mimeType: string
  description: string | null
  createdAt: string
  downloadUrl: string
}

export async function getVouchersByFuncionario(funcionarioId: string): Promise<Voucher[]> {
  return listVouchers('employee', funcionarioId, { funcionario_id: funcionarioId })
}

export async function getVouchersByDemanda(demandaId: string): Promise<Voucher[]> {
  return listVouchers('demand', demandaId, { demanda_id: demandaId, funcionario_id: '' })
}

export async function addVoucher(args: {
  file: File
  funcionario_id?: string | null
  demanda_id?: string | null
  descricao: string
}): Promise<Voucher> {
  const primary = args.demanda_id
    ? { type: 'demand', id: args.demanda_id }
    : args.funcionario_id
      ? { type: 'employee', id: args.funcionario_id }
      : null
  if (!primary) throw new Error('Vinculo do voucher obrigatorio.')

  const form = new FormData()
  form.set('file', args.file)
  form.set('entityType', primary.type)
  form.set('entityId', primary.id)
  form.set('description', args.descricao)
  if (args.demanda_id && args.funcionario_id) {
    form.set('secondaryEntityType', 'employee')
    form.set('secondaryEntityId', args.funcionario_id)
  }

  const response = await fetch('/api/files', { method: 'POST', body: form })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.file) throw new Error(payload?.error || 'Nao foi possivel armazenar o voucher.')
  return mapFile(payload.file as StoredFilePayload, {
    funcionario_id: args.funcionario_id || '',
    demanda_id: args.demanda_id || undefined,
  })
}

export async function deleteVoucher(id: string): Promise<void> {
  const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Nao foi possivel remover o voucher.')
}

export function downloadVoucher(voucher: Voucher): boolean {
  if (!voucher.download_url) return false
  const anchor = document.createElement('a')
  anchor.href = voucher.download_url
  anchor.download = voucher.nome_arquivo
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return true
}

export function openVoucherInNewTab(voucher: Voucher): boolean {
  if (!voucher.download_url) return false
  const separator = voucher.download_url.includes('?') ? '&' : '?'
  const opened = window.open(`${voucher.download_url}${separator}inline=1`, '_blank', 'noopener,noreferrer')
  return Boolean(opened)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function getTotalStorageSize(vouchers: Voucher[]): number {
  return vouchers.reduce((total, voucher) => total + voucher.tamanho_bytes, 0)
}

export async function clearAllVoucherFiles(): Promise<void> {
  // Os arquivos persistentes sao removidos exclusivamente pela rota administrativa de reset.
}

async function listVouchers(
  entityType: 'demand' | 'employee',
  entityId: string,
  identity: Pick<Voucher, 'funcionario_id'> & { demanda_id?: string },
): Promise<Voucher[]> {
  const params = new URLSearchParams({ entityType, entityId })
  const response = await fetch(`/api/files?${params.toString()}`, { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.files)) throw new Error(payload?.error || 'Nao foi possivel carregar os vouchers.')
  return payload.files.map((file: StoredFilePayload) => mapFile(file, identity))
}

function mapFile(
  file: StoredFilePayload,
  identity: Pick<Voucher, 'funcionario_id'> & { demanda_id?: string },
): Voucher {
  return {
    id: file.id,
    funcionario_id: identity.funcionario_id,
    demanda_id: identity.demanda_id,
    nome_arquivo: file.originalName,
    tamanho_bytes: file.sizeBytes,
    mime_type: file.mimeType,
    descricao: file.description || file.originalName,
    data_upload: file.createdAt,
    download_url: file.downloadUrl,
  }
}
