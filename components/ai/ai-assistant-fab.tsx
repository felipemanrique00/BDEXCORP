'use client'

import { useEffect } from 'react'

export const AI_CONTEXT_EVENTS = {
  update: 'bbt-ai-context:update',
  clear: 'bbt-ai-context:clear',
  open: 'bbt-ai-context:open',
} as const

export interface AIPageContext {
  pageContext: string
  dataContext?: string
  suggestedPrompts?: string[]
}

interface Props extends AIPageContext {
  position?: 'bottom-right' | 'bottom-left'
  hideFab?: boolean
  externalOpen?: boolean
  onClose?: () => void
}

/**
 * Compatibilidade com as paginas existentes.
 * O popup visual agora e unico em `QuickAIPopup`; este componente apenas registra
 * contexto da pagina atual para a assistente global.
 */
export function AIAssistantFab({
  pageContext,
  dataContext = '',
  suggestedPrompts = [],
  externalOpen,
  onClose,
}: Props) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const detail: AIPageContext = { pageContext, dataContext, suggestedPrompts }
    window.dispatchEvent(new CustomEvent(AI_CONTEXT_EVENTS.update, { detail }))

    return () => {
      window.dispatchEvent(new CustomEvent(AI_CONTEXT_EVENTS.clear, { detail: { pageContext } }))
    }
  }, [pageContext, dataContext, suggestedPrompts])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (externalOpen) {
      window.dispatchEvent(new CustomEvent(AI_CONTEXT_EVENTS.open, { detail: { pageContext } }))
    } else if (externalOpen === false) {
      onClose?.()
    }
  }, [externalOpen, onClose, pageContext])

  return null
}
