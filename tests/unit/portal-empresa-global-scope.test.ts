import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const portal = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)

describe('portal empresas/grupos global scope', () => {
  it('offers the explicit global scope only to internal users', () => {
    expect(portal).toContain("type EscopoPortal = 'empresa' | 'grupo' | 'global'")
    expect(portal).toContain("{isInternalUser && empresasVisiveis.length > 1 && <option value=\"global\"")
    expect(portal).toContain('if (next === \'global\') {')
    expect(portal).toContain('if (selectAllCompanies()) {')
  })

  it('keeps all mode global even when the selected companies match one legacy context', () => {
    const globalSelection = portal.indexOf('if (isInternalUser && isAllCompaniesSelected && companyIdsList.length > 1)')
    const groupContext = portal.indexOf("else if (corporateContext?.type === 'group')", globalSelection)
    const companyContext = portal.indexOf("else if (corporateContext?.type === 'company')", globalSelection)
    const crossContextSelection = portal.indexOf('else if (isInternalUser && companyIdsList.length > 1)', globalSelection)

    expect(globalSelection).toBeGreaterThan(-1)
    expect(groupContext).toBeGreaterThan(globalSelection)
    expect(companyContext).toBeGreaterThan(groupContext)
    expect(crossContextSelection).toBeGreaterThan(companyContext)
  })

  it('uses the effective provider selection as the authoritative aggregation boundary', () => {
    expect(portal).toContain('const { companyIdsList, includesCompany } = useCorporateCompanyScope()')
    expect(portal).toContain('const empresaIdsSelecionadas = useMemo(() => new Set(companyIdsList), [companyIdsList])')
    expect(portal).toContain('empresaIdsSelecionadas.has(empresa.id) && includesCompany(empresa.id)')
    expect(portal).toContain("if (escopo === 'global') return empresasSelecionadas")
    expect(portal).toContain("getEmpresasDoGrupo(grupoId, empresasSelecionadas, gruposEmpresariais)")
    expect(portal).not.toContain("if (escopo === 'global') return empresasVisiveis")
    expect(portal).toContain("includesCompany(funcionario.company_id, 'ver_funcionarios')")
    expect(portal).toContain("includesCompany(politica.company_id, 'ver_politicas')")
    expect(portal).toContain(".filter((empresa) => includesCompany(empresa.id, 'ver_solicitantes'))")
    expect(portal).toContain("canViewCompanyDetails={(companyId: string) => includesCompany(companyId, 'ver_empresas')}")
    expect(portal).toContain("? `${empresa.cnpj || 'CNPJ não informado'}")
    expect(portal).toContain("'Dados cadastrais restritos'")
  })

  it('does not infer a company target or expose company mutations in global scope', () => {
    expect(portal).toContain("setEmpresaId('')")
    expect(portal).toContain("escopo === 'empresa' && empresasEscopo.length === 1")
    expect(portal).toContain("hidden: !podeVerFinanceiro || escopo !== 'empresa'")
    expect(portal).toContain("isGroupScope={escopo !== 'empresa'}")
    expect(portal).toContain("{aba === 'carteira' && podeVerFinanceiro && escopo === 'empresa'")
    expect(portal).toContain('disabled={!podeCriarPedido}')
    expect(portal).toContain("if (escopo === 'empresa' || aba !== 'carteira') return")
    expect(portal).toContain("setAba(podeVerFinanceiro ? 'financeiro' : 'home')")
    expect(portal).toContain('Selecione a empresa para abrir o cadastro.')
  })

  it('renders neutral global identity and keeps unsupported external reports disabled', () => {
    expect(portal).toContain("? 'Visão global'")
    expect(portal).toContain('Neutra (sem empresa principal)')
    expect(portal).toContain("const exigeEscopoEspecifico = escopo === 'global'")
    expect(portal).toContain('disabled={exigeEscopoEspecifico}')
    expect(portal).toContain("if (exigeEscopoEspecifico) return toast.error('Selecione uma empresa para gerar este relatório.')")
    expect(portal).toContain('Indicadores consolidados de ${empresasEscopo.length} empresas.')
  })
})
