'use client'

import {
  IA_CONFIG_DEFAULT,
  IA_CONFIG_MAXIMA,
  type IAConfig,
} from '@/lib/ia-config'

export {
  IA_CONFIG_DEFAULT,
  IA_CONFIG_MAXIMA,
  type IAConfig,
  type IAInteractionScope,
} from '@/lib/ia-config'

const Endpoint = '/api/ia/config'
let cachedConfig: IAConfig = { ...IA_CONFIG_DEFAULT }
let saveQueue: Promise<void> = Promise.resolve()

export function getIAConfig(): IAConfig {
  return { ...cachedConfig }
}

export async function loadIAConfig(): Promise<IAConfig> {
  const response = await fetch(Endpoint, { method: 'GET', cache: 'no-store' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(payload) || 'Nao foi possivel carregar as configuracoes da IA.')
  const next = normalizeConfig(record(payload)?.config)
  updateCache(next)
  return next
}

export async function saveIAConfig(config: IAConfig): Promise<IAConfig> {
  const next = normalizeConfig(config)
  const operation = saveQueue.then(() => persistConfig(next))
  saveQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function persistConfig(next: IAConfig): Promise<IAConfig> {
  const response = await fetch(Endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(payload) || 'Nao foi possivel salvar as configuracoes da IA.')
  const saved = normalizeConfig(record(payload)?.config)
  updateCache(saved)
  return saved
}

export function avaliarPerguntaIA(texto: string, config: IAConfig = getIAConfig()): { permitido: boolean; motivo?: string } {
  const q = normalizar(texto)
  const bloqueados = config.assuntosBloqueados
    .split(',')
    .map((item) => normalizar(item))
    .filter(Boolean)

  const bloqueado = bloqueados.find((item) => q.includes(item))
  if (bloqueado) {
    return { permitido: false, motivo: `Assunto bloqueado nas configuracoes da IA: ${bloqueado}.` }
  }

  if (config.scope === 'tudo') return { permitido: true }

  const termosSistema = /(demanda|solicitacao|solicita[cç][aã]o|voucher|wintour|hotel|hospedagem|aereo|a[eé]reo|voo|passagem|empresa|funcionario|funcion[aá]rio|cliente|financeiro|faturamento|relatorio|relat[oó]rio|despesa|viagem|reserva|emissao|emiss[aã]o|centro de custo|aprovacao|aprova[cç][aã]o|agente|produtividade|sla|checkin|check-in|checkout|check-out)/
  if (config.scope === 'sistema_viagens') {
    return termosSistema.test(q)
      ? { permitido: true }
      : { permitido: false, motivo: 'A IA esta limitada a assuntos do sistema, viagens, ERP/CRM, financeiro e operacao.' }
  }

  const termosRestritos = /(demanda|solicitacao|solicita[cç][aã]o|voucher|wintour|hotel|aereo|a[eé]reo|empresa|funcionario|funcion[aá]rio|financeiro|relatorio|relat[oó]rio|viagem|reserva|emissao|emiss[aã]o)/
  return termosRestritos.test(q)
    ? { permitido: true }
    : { permitido: false, motivo: 'A IA esta em modo restrito e responde apenas consultas operacionais internas.' }
}

function normalizar(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeConfig(value: unknown): IAConfig {
  const item = record(value) || {}
  const scope = ['tudo', 'sistema_viagens', 'restrito'].includes(String(item.scope))
    ? item.scope as IAConfig['scope']
    : IA_CONFIG_DEFAULT.scope
  return {
    scope,
    permitirInternet: bool(item.permitirInternet, IA_CONFIG_DEFAULT.permitirInternet),
    permitirCriarDemandas: bool(item.permitirCriarDemandas, IA_CONFIG_DEFAULT.permitirCriarDemandas),
    permitirCadastrarHoteis: bool(item.permitirCadastrarHoteis, IA_CONFIG_DEFAULT.permitirCadastrarHoteis),
    permitirReservasTech: bool(item.permitirReservasTech, IA_CONFIG_DEFAULT.permitirReservasTech),
    permitirFinanceiro: bool(item.permitirFinanceiro, IA_CONFIG_DEFAULT.permitirFinanceiro),
    exigirConfirmacaoExecucao: bool(
      item.exigirConfirmacaoExecucao,
      IA_CONFIG_DEFAULT.exigirConfirmacaoExecucao,
    ),
    assuntosBloqueados: typeof item.assuntosBloqueados === 'string'
      ? item.assuntosBloqueados.slice(0, 2_000)
      : '',
  }
}

function updateCache(config: IAConfig): void {
  cachedConfig = { ...config }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bbt-ia-config-updated', { detail: cachedConfig }))
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function errorMessage(value: unknown): string {
  const item = record(value)
  return typeof item?.error === 'string' ? item.error : ''
}
