import { describe, expect, it } from 'vitest'

import {
  buildPolicyTemplateCatalog,
  argoBenchmarkFamilyKeys,
  argoBenchmarkReferenceSummary,
  ARGO_POLICY_BENCHMARK_AREAS,
  ARGO_POLICY_BENCHMARK_SOURCE,
  ARGO_POLICY_SECURITY_EXCLUSIONS,
  evaluatePolicies,
  executablePolicyVersionSchema,
  POLICY_SEGMENT_PROFILES,
  policyTemplateCategoryCount,
  policyTemplateFamilyCount,
  type ExecutablePolicyVersion,
  type PolicyTemplateConfiguration,
} from '@/lib/policy'

const catalog = buildPolicyTemplateCatalog()

const requiredCategories = [
  'approval', 'authority', 'delegation', 'budget', 'cost_center', 'projects',
  'accounts', 'allocation', 'air', 'hotel', 'car_rental', 'bus', 'services',
  'insurance', 'advances', 'reimbursement', 'expense_reports', 'cards',
  'billing', 'justifications', 'communication', 'issuance', 'cancellation',
  'expiration', 'profile', 'security', 'documents', 'search', 'reservation',
  'reconciliation', 'reports', 'sla', 'risk', 'sustainability', 'integrations',
]

describe('policy template catalog', () => {
  it('possui mais de 500 configuracoes uteis sem chaves ou conteudos duplicados', () => {
    expect(policyTemplateFamilyCount()).toBeGreaterThanOrEqual(110)
    expect(POLICY_SEGMENT_PROFILES).toHaveLength(12)
    expect(catalog.length).toBeGreaterThan(500)
    expect(new Set(catalog.map((template) => template.templateKey)).size).toBe(catalog.length)
    expect(new Set(catalog.map((template) => template.contentHash)).size).toBe(catalog.length)
  })

  it('cobre todas as categorias e pacotes de segmento obrigatorios', () => {
    const categories = new Set(catalog.map((template) => template.category))
    requiredCategories.forEach((category) => expect(categories.has(category), category).toBe(true))
    expect(policyTemplateCategoryCount()).toBeGreaterThanOrEqual(requiredCategories.length)

    for (const profile of POLICY_SEGMENT_PROFILES) {
      const segmentTemplates = catalog.filter((template) => template.segment === profile.key)
      expect(segmentTemplates.length).toBe(policyTemplateFamilyCount())
      expect(new Set(segmentTemplates.map((template) => template.familyKey)).size).toBe(policyTemplateFamilyCount())
    }
  })

  it('mantem classificacao, dependencias, riscos e checkpoints estruturados', () => {
    for (const template of catalog) {
      expect(template.description.length).toBeGreaterThan(30)
      expect(template.checkpoints.length).toBeGreaterThan(0)
      expect(template.actions.length).toBeGreaterThan(0)
      expect(template.expectedActions).toEqual(template.actions.map((action) => action.type))
      expect(new Set(template.benchmarkReferences).size).toBe(template.benchmarkReferences.length)
      template.dependencies.forEach((dependency) => {
        expect(dependency.key).not.toBe('')
        expect(typeof dependency.required).toBe('boolean')
      })
    }
  })

  it('rastreia todas as areas e referencias detectadas no PDF sem reproduzir regra insegura', () => {
    const familyKeys = new Set(catalog.map((template) => template.familyKey))
    argoBenchmarkFamilyKeys().forEach((familyKey) => expect(familyKeys.has(familyKey), familyKey).toBe(true))

    const benchmarkReferences = catalog.flatMap((template) => template.benchmarkReferences)
    const summary = argoBenchmarkReferenceSummary(benchmarkReferences)
    expect(ARGO_POLICY_BENCHMARK_AREAS).toHaveLength(15)
    expect(summary).toEqual({
      mapped: 149,
      rejectedForSecurity: 1,
      total: ARGO_POLICY_BENCHMARK_SOURCE.detectedReferenceCodes,
    })
    expect(new Set(benchmarkReferences).has('ARGO:APROUT')).toBe(false)
    expect(ARGO_POLICY_SECURITY_EXCLUSIONS).toContainEqual(expect.objectContaining({
      reference: 'ARGO:APROUT',
      runtimeStatus: 'rejected_security',
      safeAlternativeFamilyKey: 'approval.secure-email-link',
    }))
  })

  it('valida e executa o caso de disparo de cada configuracao', () => {
    for (const template of catalog) {
      const executable = executableFrom(template)
      expect(() => executablePolicyVersionSchema.parse(executable), template.templateKey).not.toThrow()
      const result = evaluatePolicies([executable], {
        facts: template.sampleFacts,
        scopes: [{ type: 'tenant' }],
        checkpoint: template.checkpoints[0],
        evaluatedAt: '2026-07-22T12:00:00.000Z',
        mode: 'simulation',
      })
      expect(result.errors, template.templateKey).toHaveLength(0)
      const actions = [
        ...result.warnings,
        ...result.justificationsRequired,
        ...result.approvalsRequired,
        ...result.blocks,
        ...result.requiredDocuments,
        ...result.requiredActions,
      ].map((item) => item.action)
      template.expectedActions.forEach((action) => expect(actions, template.templateKey).toContain(action))
    }
  })
})

function executableFrom(template: PolicyTemplateConfiguration): ExecutablePolicyVersion {
  return {
    policyId: `policy-${template.templateKey}`,
    versionId: `version-${template.templateKey}`,
    code: template.templateKey,
    version: template.version,
    name: template.name,
    description: template.description,
    category: template.category,
    priority: 100,
    severity: template.actions.some((action) => ['block', 'prevent_issuance'].includes(action.type)) ? 'blocking' : 'warning',
    inheritanceMode: 'inherit',
    overridable: !template.risks.some((risk) => risk.includes('nao sobrescrevivel')),
    checkpoints: template.checkpoints,
    scopes: [{ type: 'tenant', specificity: 0 }],
    condition: template.condition,
    actions: template.actions,
    dependencies: template.dependencies,
    timezone: 'America/Sao_Paulo',
    contentHash: template.contentHash,
  }
}
