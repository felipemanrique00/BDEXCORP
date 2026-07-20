'use client'

import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

const STORAGE_KEY = 'bbt-ia-config-v12'

export type IAInteractionScope = 'tudo' | 'sistema_viagens' | 'restrito'

export interface IAConfig {
  scope: IAInteractionScope
  permitirInternet: boolean
  permitirCriarDemandas: boolean
  permitirCadastrarHoteis: boolean
  permitirReservasTech: boolean
  permitirFinanceiro: boolean
  exigirConfirmacaoExecucao: boolean
  assuntosBloqueados: string
}

export const IA_CONFIG_DEFAULT: IAConfig = {
  scope: 'tudo',
  permitirInternet: true,
  permitirCriarDemandas: true,
  permitirCadastrarHoteis: true,
  permitirReservasTech: true,
  permitirFinanceiro: true,
  exigirConfirmacaoExecucao: false,
  assuntosBloqueados: '',
}

export const IA_CONFIG_MAXIMA: IAConfig = {
  scope: 'tudo',
  permitirInternet: true,
  permitirCriarDemandas: true,
  permitirCadastrarHoteis: true,
  permitirReservasTech: true,
  permitirFinanceiro: true,
  exigirConfirmacaoExecucao: false,
  assuntosBloqueados: '',
}

export function getIAConfig(): IAConfig {
  if (typeof window === 'undefined') return IA_CONFIG_DEFAULT
  const saved = loadJSON<Partial<IAConfig>>(STORAGE_KEY, {})
  return { ...IA_CONFIG_DEFAULT, ...saved }
}

export function saveIAConfig(config: IAConfig): IAConfig {
  const next = { ...IA_CONFIG_DEFAULT, ...config, permitirReservasTech: config.permitirReservasTech }
  if (typeof window !== 'undefined') {
    safeSetJSON(STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('bbt-ia-config-updated', { detail: next }))
  }
  return next
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
