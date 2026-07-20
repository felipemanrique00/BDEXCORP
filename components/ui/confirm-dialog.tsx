'use client'
import { Modal } from './modal'
import { AlertTriangle } from 'lucide-react'

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmar',
  message,
  confirmLabel = 'Confirmar',
  danger = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: string
  confirmLabel?: string
  danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex items-start gap-4">
        <div
          className={`p-3 rounded-full ${
            danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
          }`}
        >
          <AlertTriangle
            className={`w-6 h-6 ${
              danger ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
            }`}
          />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 pt-2">{message}</p>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="bbt-button-ghost">
          Cancelar
        </button>
        <button
          onClick={() => {
            onConfirm()
            onClose()
          }}
          className={`${
            danger
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-bbt-primary hover:bg-bbt-primary-mid'
          } text-white font-medium px-4 py-2 rounded-lg transition shadow-sm`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
