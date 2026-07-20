import { ASSISTANT_KEYS, appendAssistantList, createId } from '@/lib/assistant/storage'
import { formatDateBR } from '@/lib/date'
import type { GeneratedDocument } from '@/lib/assistant/types'
import type { VoucherEmitido } from '@/types'

export async function generateVoucherDocument(
  voucher: VoucherEmitido,
  options: { createdBy?: string; protectSensitiveData?: boolean } = {},
): Promise<GeneratedDocument> {
  const html = renderVoucherHtml(voucher, options.protectSensitiveData !== false)
  const document: GeneratedDocument = {
    id: createId('doc'),
    type: 'voucher',
    status: 'generated',
    title: `Voucher ${voucher.id}`,
    entityId: voucher.id,
    companyId: voucher.empresa_id,
    html,
    fileName: `voucher-${voucher.id}.html`,
    mimeType: 'text/html',
    createdBy: options.createdBy,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.generatedDocuments, document, 500)
  return document
}

export function renderVoucherHtml(voucher: VoucherEmitido, protectSensitiveData = true): string {
  const cpf = protectSensitiveData && voucher.cpf ? maskDocument(voucher.cpf) : voucher.cpf || ''
  const periodo = [voucher.data_checkin || voucher.data_ida, voucher.data_checkout || voucher.data_volta]
    .filter(Boolean)
    .map((item) => formatDateBR(item, item || ''))
    .join(' a ')

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Voucher ${escapeHtml(voucher.id)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; }
    .page { max-width: 820px; margin: 0 auto; background: white; padding: 32px; }
    .header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #006FCF; padding-bottom: 18px; }
    .brand { font-size: 22px; font-weight: 800; color: #001B44; }
    .badge { display: inline-block; padding: 5px 10px; border-radius: 6px; background: #e0f2fe; color: #075985; font-weight: 700; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
    .label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: .06em; }
    .value { margin-top: 4px; font-size: 15px; font-weight: 700; }
    .full { grid-column: 1 / -1; }
    .footer { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div>
        <div class="brand">BBT Corporativo</div>
        <div class="label">Voucher gerado pelo sistema</div>
      </div>
      <div>
        <div class="badge">${escapeHtml(voucher.status.toUpperCase())}</div>
        <div class="value">${escapeHtml(voucher.id)}</div>
      </div>
    </section>
    <section class="grid">
      ${field('Passageiro/Hospede', voucher.passageiro_nome)}
      ${field('CPF', cpf || 'Nao informado')}
      ${field('Fornecedor', voucher.fornecedor_nome)}
      ${field('Cidade', voucher.fornecedor_cidade || voucher.destino || 'Nao informada')}
      ${field('Periodo', periodo || 'Nao informado')}
      ${field('Confirmacao/Localizador', voucher.numero_confirmacao || voucher.localizador || 'Nao informado')}
      ${field('Apartamento/Classe', voucher.tipo_apartamento || voucher.classe || 'Nao informado')}
      ${field('Pagamento', voucher.forma_pagamento_voucher || 'Conforme politica/contrato')}
      ${field('Observacoes', voucher.observacoes || 'Sem observacoes.', 'full')}
    </section>
    <section class="footer">
      Confira os dados antes da utilizacao. Em caso de divergencia, acione a equipe BBT.
    </section>
  </main>
</body>
</html>`
}

function field(label: string, value: string, extraClass = ''): string {
  return `<div class="box ${extraClass}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function maskDocument(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return '***'
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
}
