import type { SystemAIResponse } from '@/lib/ia-system-actions'

const TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bvoce\b/gi, 'você'],
  [/\bnao\b/gi, 'não'],
  [/\bja\b/gi, 'já'],
  [/\besta\b/gi, 'está'],
  [/\bestao\b/gi, 'estão'],
  [/\bacao\b/gi, 'ação'],
  [/\bacoes\b/gi, 'ações'],
  [/\bcotacao\b/gi, 'cotação'],
  [/\bcotacoes\b/gi, 'cotações'],
  [/\bemissao\b/gi, 'emissão'],
  [/\bemissoes\b/gi, 'emissões'],
  [/\baprovacao\b/gi, 'aprovação'],
  [/\baprovacoes\b/gi, 'aprovações'],
  [/\bpolitica\b/gi, 'política'],
  [/\bpoliticas\b/gi, 'políticas'],
  [/\boperacao\b/gi, 'operação'],
  [/\boperacoes\b/gi, 'operações'],
  [/\bpermissao\b/gi, 'permissão'],
  [/\bpermissoes\b/gi, 'permissões'],
  [/\bconfiguracao\b/gi, 'configuração'],
  [/\bconfiguracoes\b/gi, 'configurações'],
  [/\bintegracao\b/gi, 'integração'],
  [/\bintegracoes\b/gi, 'integrações'],
  [/\bfuncionario\b/gi, 'funcionário'],
  [/\bfuncionarios\b/gi, 'funcionários'],
  [/\bhospede\b/gi, 'hóspede'],
  [/\bhospedes\b/gi, 'hóspedes'],
  [/\bhoteis\b/gi, 'hotéis'],
  [/\baereo\b/gi, 'aéreo'],
  [/\baereas\b/gi, 'aéreas'],
  [/\baudio\b/gi, 'áudio'],
  [/\bproxima\b/gi, 'próxima'],
  [/\bproximas\b/gi, 'próximas'],
  [/\bperiodo\b/gi, 'período'],
  [/\bmodulo\b/gi, 'módulo'],
  [/\bmodulos\b/gi, 'módulos'],
]

const TECHNICAL_LINE_PATTERNS = [
  /\bquote-[a-z0-9-]+\b/i,
  /\bappr-[a-z0-9-]+\b/i,
  /\btask-[a-z0-9-]+\b/i,
  /\brun-[a-z0-9-]+\b/i,
  /\bentity_type\b/i,
  /\bpayload\b/i,
  /\bstack trace\b/i,
  /\bfailed to\b/i,
]

export function humanizeAIText(value: string): string {
  let text = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!text) return text

  text = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^criei a cotação inteligente\s+\*\*?quote-/i.test(trimmed)) return false
      if (/^aprovação aberta:\s*appr-/i.test(trimmed)) return false
      return !TECHNICAL_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
    })
    .join('\n')

  text = text
    .replace(/\*\*([a-z]+-[a-z0-9-]+)\*\*/gi, '$1')
    .replace(/\bquote-[a-z0-9-]+\b/gi, 'cotação')
    .replace(/\bappr-[a-z0-9-]+\b/gi, 'aprovação')
    .replace(/\b(em_andamento)\b/g, 'em andamento')
    .replace(/\b(Nao sei responder isso no modo local)[\s\S]*?(\n\n|$)/i, 'Consigo seguir usando os dados internos do sistema.\n\n')
    .replace(/Pra IA generativa completa[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/Configure\s+`?OPENAI_API_KEY`?[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\b(\d+)\s+acao\(oes\)/gi, '$1 ações')
    .replace(/\bacao\(oes\)/gi, 'ações')

  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function humanizeAIResponse<T extends SystemAIResponse>(response: T): T {
  return {
    ...response,
    title: response.title ? humanizeAIText(response.title) : response.title,
    badge: response.badge ? humanizeAIText(response.badge) : response.badge,
    message: humanizeAIText(response.message),
    links: response.links?.map((link) => ({ ...link, label: humanizeAIText(link.label) })),
    cards: response.cards?.map((card) => ({
      ...card,
      title: humanizeAIText(card.title),
      subtitle: card.subtitle ? humanizeAIText(card.subtitle) : card.subtitle,
      meta: card.meta ? humanizeAIText(card.meta) : card.meta,
    })),
  }
}
