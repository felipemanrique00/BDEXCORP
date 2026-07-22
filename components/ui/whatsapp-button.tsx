'use client'
import { MessageCircle, Phone } from 'lucide-react'
import { whatsappLink, formatPhone } from '@/lib/utils'

export function WhatsAppButton({
  phone,
  compact = false,
}: {
  phone: string | null | undefined
  compact?: boolean
}) {
  const link = whatsappLink(phone)
  if (!phone || !link) {
    return <span className="text-slate-400 text-sm">—</span>
  }
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-md transition shadow-sm"
      title="Abrir conversa no WhatsApp"
      onClick={(e) => e.stopPropagation()}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {!compact && <span>{formatPhone(phone)}</span>}
      {compact && <span>WhatsApp</span>}
    </a>
  )
}

export function PhoneDisplay({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <span className="text-slate-400 text-sm">—</span>
  return (
    <div className="flex items-center gap-2">
      <Phone className="w-3.5 h-3.5 text-slate-400" />
      <span className="text-sm">{formatPhone(phone)}</span>
    </div>
  )
}
