import { techRequest } from '@/lib/integrations/tech/tech-client'
import { getTechConfig, techConfigured, techMissingConfig, type TechConfig } from '@/lib/integrations/tech/tech-config'
import { TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { logTechIntegration } from '@/lib/integrations/tech/tech-logger'
import type { ProviderCompany } from '@/lib/integrations/types'

interface TechSession {
  token: string
  expiresAt: number
  requiresCompanyAccess: boolean
  selectedCompanyId?: string | null
  raw?: unknown
}

let cachedSession: TechSession | null = null

export async function getTechSession(args: { companyId?: string | number | null; force?: boolean } = {}): Promise<TechSession> {
  const config = getTechConfig()
  if (!techConfigured(config)) {
    throw new TechIntegrationError(`Configuração Tech incompleta: ${techMissingConfig(config).join(', ')}.`, {
      status: 503,
      code: 'TECH_NOT_CONFIGURED',
    })
  }

  const wantedCompanyId = args.companyId ? String(args.companyId) : config.defaultCompanyId
  if (
    !args.force &&
    cachedSession &&
    cachedSession.expiresAt > Date.now() &&
    (!wantedCompanyId || cachedSession.selectedCompanyId === wantedCompanyId)
  ) {
    return cachedSession
  }

  const session = await loginTech(config)
  const requiresCompanyAccess = session.requiresCompanyAccess || Boolean(wantedCompanyId)

  if (requiresCompanyAccess && wantedCompanyId) {
    await accessTechCompany(session.token, wantedCompanyId, config)
    cachedSession = { ...session, selectedCompanyId: wantedCompanyId }
  } else {
    cachedSession = session
  }

  return cachedSession
}

export async function loginTech(config: TechConfig = getTechConfig()): Promise<TechSession> {
  const startedAt = Date.now()
  const response = await techRequest<any>(
    '/login',
    {
      method: 'POST',
      body: {
        Login: config.login,
        Senha: config.password,
        ApiKey: config.apiKey,
      },
      skipPayloadAssertion: true,
    },
    config,
  )

  const token = response.data?.Token || response.data?.token
  if (!token) {
    await logTechIntegration({
      action: 'login',
      status: 'error',
      message: 'Login Tech não retornou token.',
      durationMs: Date.now() - startedAt,
      endpoint: '/login',
      metadata: { response: response.data },
    })
    throw new TechIntegrationError('Login Tech não retornou token.', {
      code: 'TECH_LOGIN_WITHOUT_TOKEN',
      details: response.data,
    })
  }

  const access = response.data?.Informcacoes?.Acessos?.[0] || response.data?.Informacoes?.Acessos?.[0] || {}
  const requiresCompanyAccess = Boolean(access.ObrigatorioAcessarEmpresa)
  await logTechIntegration({
    action: 'login',
    status: 'success',
    message: requiresCompanyAccess ? 'Login Tech OK; acesso a empresa exigido.' : 'Login Tech OK.',
    durationMs: Date.now() - startedAt,
    endpoint: '/login',
    metadata: { requiresCompanyAccess },
  })

  return {
    token,
    expiresAt: Date.now() + config.tokenCacheTtlSeconds * 1000,
    requiresCompanyAccess,
    selectedCompanyId: null,
    raw: response.data,
  }
}

export async function listTechCompanies(): Promise<ProviderCompany[]> {
  const config = getTechConfig()
  const session = await getTechSession({ force: true })
  const response = await techRequest<any>(
    '/EmpresasParaAcesso',
    { method: 'GET', query: { token: session.token } },
    config,
  )
  const rawList =
    response.data?.Empresas ||
    response.data?.EmpresasParaAcesso ||
    response.data?.Dados ||
    response.data?.Retorno ||
    []
  const list = Array.isArray(rawList) ? rawList : []
  return list.map((item: any) => ({
    id: String(item.IdEmpresa || item.idEmpresa || item.Id || item.id || item.Codigo || ''),
    name: String(item.NomeFantasia || item.RazaoSocial || item.Nome || item.Descricao || item.name || 'Empresa Tech'),
    raw: item,
  })).filter((item) => item.id)
}

export async function accessTechCompany(token: string, companyId: string | number, config = getTechConfig()): Promise<boolean> {
  const response = await techRequest<any>(
    '/AcessarEmpresa',
    {
      method: 'GET',
      query: { token, IdEmpresa: companyId },
      skipPayloadAssertion: true,
    },
    config,
  )
  const ok = response.data === true || response.data?.Liberado === true || response.data?.Sucesso === true || !response.data?.Erro
  await logTechIntegration({
    action: 'access-company',
    status: ok ? 'success' : 'warning',
    message: ok ? `Empresa Tech ${companyId} acessada.` : `Tech não confirmou acesso à empresa ${companyId}.`,
    endpoint: '/AcessarEmpresa',
    durationMs: response.durationMs,
    metadata: { companyId, response: response.data },
  })
  if (!ok) {
    throw new TechIntegrationError(`Tech não confirmou acesso à empresa ${companyId}.`, {
      code: 'TECH_COMPANY_ACCESS_DENIED',
      details: response.data,
    })
  }
  return true
}

export function clearTechSessionCache(): void {
  cachedSession = null
}
