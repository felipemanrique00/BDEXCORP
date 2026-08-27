'use client'

import { useMemo, useState } from 'react'
import { Loader2, Mail, Plus, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { sendVoucherEmailFromServer } from '@/lib/voucher-persistence-client'
import {
  isSafeVoucherEmail,
  VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS,
  VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS,
  voucherEmailRecipients,
  type VoucherEmailSource,
} from '@/lib/vouchers/email'

export const MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS = VOUCHER_EMAIL_MAX_CUSTOM_RECIPIENTS
export const MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS = VOUCHER_EMAIL_MAX_TOTAL_RECIPIENTS

interface CustomRecipientMergeResult {
  recipients: string[]
  error: string | null
}

interface MergeCustomRecipientsInput {
  rawValue: string
  currentRecipients: string[]
  linkedRecipients: string[]
  selectedLinkedCount: number
}

export function mergeCustomVoucherEmailRecipients({
  rawValue,
  currentRecipients,
  linkedRecipients,
  selectedLinkedCount,
}: MergeCustomRecipientsInput): CustomRecipientMergeResult {
  const tokens = rawValue
    .split(/[,;\n]+/)
    .map(normalizeEmail)
    .filter(Boolean)
  const uniqueTokens = [...new Set(tokens)]

  if (!uniqueTokens.length) {
    return { recipients: currentRecipients, error: 'Informe um endereço de e-mail.' }
  }

  const invalidEmail = uniqueTokens.find((email) => !isValidEmail(email))
  if (invalidEmail) {
    return { recipients: currentRecipients, error: `O e-mail ${invalidEmail} não é válido.` }
  }

  const linkedSet = new Set(linkedRecipients.map(normalizeEmail))
  const linkedDuplicate = uniqueTokens.find((email) => linkedSet.has(email))
  if (linkedDuplicate) {
    return {
      recipients: currentRecipients,
      error: `${linkedDuplicate} já está nos destinatários vinculados. Marque-o na lista acima.`,
    }
  }

  const currentSet = new Set(currentRecipients.map(normalizeEmail))
  const newRecipients = uniqueTokens.filter((email) => !currentSet.has(email))
  if (!newRecipients.length) {
    return { recipients: currentRecipients, error: 'Esse e-mail já foi adicionado.' }
  }

  const recipients = [...currentRecipients, ...newRecipients]
  if (recipients.length > MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS) {
    return {
      recipients: currentRecipients,
      error: `Adicione no máximo ${MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS} destinatários personalizados.`,
    }
  }
  if (selectedLinkedCount + recipients.length > MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS) {
    return {
      recipients: currentRecipients,
      error: `O envio aceita no máximo ${MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS} destinatários ao todo.`,
    }
  }

  return { recipients, error: null }
}

type SendVoucherEmailDialogProps =
  | { voucher: VoucherEmailSource; voucherId?: never; loadVoucher?: never }
  | { voucher?: never; voucherId: string; loadVoucher: () => Promise<VoucherEmailSource> }

export function SendVoucherEmailDialog({ voucher, voucherId, loadVoucher }: SendVoucherEmailDialogProps) {
  const [loadedVoucher, setLoadedVoucher] = useState<VoucherEmailSource | null>(null)
  const [loadingVoucher, setLoadingVoucher] = useState(false)
  const activeVoucher = voucher || loadedVoucher
  const recipients = useMemo(
    () => activeVoucher ? voucherEmailRecipients(activeVoucher) : [],
    [activeVoucher],
  )
  const linkedEmails = useMemo(() => recipients.map((recipient) => recipient.email), [recipients])
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [customRecipients, setCustomRecipients] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')
  const [customError, setCustomError] = useState('')
  const [externalSharingConfirmed, setExternalSharingConfirmed] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const recipientCount = selected.length + customRecipients.length
  const hasCustomRecipients = customRecipients.length > 0
  const hasPendingCustomInput = Boolean(customInput.trim())

  async function begin() {
    let resolvedVoucher = activeVoucher
    if (!resolvedVoucher && loadVoucher) {
      setLoadingVoucher(true)
      try {
        resolvedVoucher = await loadVoucher()
        setLoadedVoucher(resolvedVoucher)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel carregar os destinatÃ¡rios do voucher.')
        return
      } finally {
        setLoadingVoucher(false)
      }
    }
    if (!resolvedVoucher) return
    const resolvedLinkedEmails = voucherEmailRecipients(resolvedVoucher)
      .map((recipient) => recipient.email)
    setSelected(resolvedLinkedEmails.slice(0, MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS))
    setCustomRecipients([])
    setCustomInput('')
    setCustomError('')
    setExternalSharingConfirmed(false)
    setIdempotencyKey(createIdempotencyKey(resolvedVoucher.id))
    setOpen(true)
  }

  function close() {
    if (sending) return
    setOpen(false)
    setCustomError('')
  }

  function toggle(email: string) {
    setSelected((current) => {
      if (current.includes(email)) {
        setCustomError('')
        return current.filter((value) => value !== email)
      }
      if (current.length + customRecipients.length >= MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS) {
        setCustomError(`O envio aceita no máximo ${MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS} destinatários ao todo.`)
        return current
      }
      setCustomError('')
      return [...current, email]
    })
  }

  function mergeCustomInput(rawValue = customInput): CustomRecipientMergeResult {
    const result = mergeCustomVoucherEmailRecipients({
      rawValue,
      currentRecipients: customRecipients,
      linkedRecipients: linkedEmails,
      selectedLinkedCount: selected.length,
    })
    if (result.error) {
      setCustomError(result.error)
      return result
    }
    setCustomRecipients(result.recipients)
    setCustomInput('')
    setCustomError('')
    setExternalSharingConfirmed(false)
    return result
  }

  function removeCustomRecipient(email: string) {
    setCustomRecipients((current) => current.filter((value) => value !== email))
    setCustomError('')
    setExternalSharingConfirmed(false)
  }

  async function send() {
    if (sending || !activeVoucher) return

    const resolvedCount = selected.length + customRecipients.length
    if (!resolvedCount) {
      setCustomError('Selecione ou adicione pelo menos um destinatário.')
      return
    }
    if (hasPendingCustomInput) {
      setCustomError('Adicione ou remova o e-mail digitado antes de confirmar o envio.')
      return
    }
    if (hasCustomRecipients && !externalSharingConfirmed) {
      setCustomError('Confirme o compartilhamento dos dados do voucher com destinatários externos.')
      return
    }

    setSending(true)
    try {
      const result = await sendVoucherEmailFromServer(
        activeVoucher.id,
        selected,
        idempotencyKey,
        customRecipients,
        hasCustomRecipients && externalSharingConfirmed,
      )
      if (result.rejectedRecipients.length > 0) {
        toast.warning(
          `Envio parcial: ${result.acceptedRecipients.length} destinatário(s) aceito(s) e ${result.rejectedRecipients.length} rejeitado(s).`,
        )
      } else {
        toast.success(result.duplicate
          ? 'Este voucher já havia sido enviado com segurança.'
          : `Voucher enviado pelo SMTP para ${result.acceptedRecipients.length} destinatário(s).`)
      }
      setOpen(false)
      setIdempotencyKey('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar o voucher.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { void begin() }}
        disabled={loadingVoucher}
        className="bbt-button-ghost flex items-center gap-2 text-sm"
        aria-label={`Enviar voucher ${activeVoucher?.id || voucherId} por e-mail`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {loadingVoucher ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {loadingVoucher ? 'Carregando...' : 'Enviar por e-mail'}
      </button>

      {open && activeVoucher && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voucher-email-title"
            aria-describedby="voucher-email-description"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-bbt-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-700">
              <div>
                <h2 id="voucher-email-title" className="text-base font-bold text-bbt-primary dark:text-white">
                  Enviar voucher {activeVoucher.id}
                </h2>
                <p id="voucher-email-description" className="mt-1 text-xs text-slate-500">
                  O sistema enviará diretamente pelo SMTP configurado. Nenhum aplicativo de e-mail será aberto.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={sending}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Fechar envio de voucher"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <section aria-labelledby="linked-voucher-recipients-title" className="space-y-2">
                <p id="linked-voucher-recipients-title" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Destinatários vinculados
                </p>
                {recipients.length ? recipients.map((recipient) => (
                  <label
                    key={recipient.email}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-bbt-gray-100 px-3 py-3 transition hover:border-bbt-accent/50 hover:bg-cyan-50/40 dark:border-slate-700 dark:hover:bg-cyan-950/20"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(recipient.email)}
                      onChange={() => toggle(recipient.email)}
                      disabled={sending}
                      className="h-4 w-4 rounded border-slate-300 accent-cyan-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-bbt-primary dark:text-white">{recipient.name}</span>
                      <span className="block truncate text-xs text-slate-500">{recipient.email}</span>
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                      {recipient.kind === 'requester' ? 'Solicitante' : 'Viajante'}
                    </span>
                  </label>
                )) : (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500 dark:border-slate-700">
                    Não há e-mails vinculados ao voucher. Adicione um destinatário personalizado abaixo.
                  </p>
                )}
              </section>

              <section aria-labelledby="custom-voucher-recipients-title" className="space-y-2">
                <div>
                  <p id="custom-voucher-recipients-title" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Outros destinatários
                  </p>
                  <p id="custom-voucher-recipients-help" className="mt-1 text-xs text-slate-500">
                    Digite um e-mail e pressione Enter ou vírgula. Máximo de {MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS} endereços externos.
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    id="custom-voucher-recipient"
                    type="email"
                    multiple
                    inputMode="email"
                    autoComplete="off"
                    value={customInput}
                    onChange={(event) => {
                      setCustomInput(event.target.value)
                      if (customError) setCustomError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                        event.preventDefault()
                        mergeCustomInput()
                      }
                    }}
                    disabled={sending || customRecipients.length >= MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS}
                    aria-describedby="custom-voucher-recipients-help custom-voucher-recipient-error"
                    aria-invalid={Boolean(customError)}
                    placeholder="nome@empresa.com.br"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-bbt-primary outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => mergeCustomInput()}
                    disabled={sending || !customInput.trim() || customRecipients.length >= MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS}
                    className="bbt-button-ghost flex shrink-0 items-center gap-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Adicionar destinatário personalizado"
                  >
                    <Plus className="h-4 w-4" /> Adicionar
                  </button>
                </div>

                {customError && (
                  <p id="custom-voucher-recipient-error" role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                    {customError}
                  </p>
                )}

                {customRecipients.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Destinatários personalizados adicionados">
                    {customRecipients.map((email) => (
                      <li key={email} className="flex max-w-full items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">
                        <span className="truncate">{email}</span>
                        <button
                          type="button"
                          onClick={() => removeCustomRecipient(email)}
                          disabled={sending}
                          className="rounded-full p-0.5 transition hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 dark:hover:bg-cyan-900"
                          aria-label={`Remover ${email}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {hasCustomRecipients && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <input
                      type="checkbox"
                      checked={externalSharingConfirmed}
                      onChange={(event) => {
                        setExternalSharingConfirmed(event.target.checked)
                        if (event.target.checked) setCustomError('')
                      }}
                      disabled={sending}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 accent-amber-600"
                    />
                    <span>
                      <strong className="block">
                        Confirmo que estes destinatários estão autorizados a receber os dados deste voucher
                      </strong>
                      <span className="mt-0.5 block text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                        Esses endereços não fazem parte da reserva e receberão os dados pessoais, administrativos e financeiros exibidos no voucher.
                      </span>
                    </span>
                  </label>
                )}
              </section>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300" aria-live="polite">
                {selected.length} vinculado(s) + {customRecipients.length} personalizado(s) = <strong>{recipientCount} destinatário(s)</strong>
              </p>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-bbt-gray-100 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/70">
              <button type="button" onClick={close} disabled={sending} className="bbt-button-ghost text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending
                  || recipientCount === 0
                  || hasPendingCustomInput
                  || (hasCustomRecipients && !externalSharingConfirmed)}
                className="bbt-button-primary flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Enviando...' : `Enviar (${recipientCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string): boolean {
  return isSafeVoucherEmail(value)
}

function createIdempotencyKey(voucherId: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `voucher-email:${voucherId}:${random}`
}
