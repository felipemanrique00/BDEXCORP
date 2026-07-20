export interface IAWebSearchResult {
  source: 'openai-web' | 'gemini-google' | 'fallback-link'
  query: string
  answer: string
  summary: string
  confidence: 'alta' | 'media' | 'baixa'
  sources: Array<{ title?: string; uri?: string }>
  action_items?: string[]
  provider_error?: string
}

export async function pesquisarWebComIA(params: {
  query: string
  location?: string
  deep?: boolean
}): Promise<IAWebSearchResult> {
  const r = await fetch('/api/ia/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
  return data
}

export function deveUsarPesquisaTempoReal(texto: string): boolean {
  const q = normalizar(texto)
  return /(pesquise|pesquisar|busque|buscar|internet|tempo real|agora|atualizado|hoje|noticia|noticias|telefone|endereco|site oficial|status do voo|clima|cambio|cotacao|disponibilidade|fornecedor online|tech travel|ttravel)/.test(q)
}

function normalizar(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
