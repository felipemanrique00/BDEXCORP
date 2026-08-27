import { describe, expect, it } from 'vitest'

import {
  analyzePolicyConflicts,
  applyOperator,
  evaluateExpression,
  evaluatePolicies,
  sha256,
} from '@/lib/policy'
import type {
  ExecutablePolicyVersion,
  PolicyAction,
  PolicyEvaluationContext,
  PolicyExpression,
  PolicyScope,
} from '@/lib/policy'

const TENANT_SCOPE: PolicyScope = { type: 'tenant', specificity: 0 }
const GROUP_SCOPE: PolicyScope = { type: 'group', id: 'group-a', specificity: 20 }
const COMPANY_SCOPE: PolicyScope = { type: 'company', id: 'company-a', specificity: 30 }

function policy(
  code: string,
  condition: PolicyExpression,
  actions: PolicyAction[],
  overrides: Partial<ExecutablePolicyVersion> = {},
): ExecutablePolicyVersion {
  return {
    policyId: `policy-${code}`,
    versionId: `version-${code}`,
    code,
    version: 1,
    name: `Politica ${code}`,
    description: `Politica de teste ${code}`,
    category: 'travel',
    priority: 100,
    severity: 'warning',
    inheritanceMode: 'inherit',
    overridable: true,
    checkpoints: ['*'],
    scopes: [TENANT_SCOPE],
    condition,
    actions,
    timezone: 'America/Sao_Paulo',
    contentHash: 'a'.repeat(64),
    ...overrides,
  }
}

function context(
  facts: Record<string, unknown>,
  overrides: Partial<PolicyEvaluationContext> = {},
): PolicyEvaluationContext {
  return {
    facts,
    scopes: [{ type: 'tenant' }, { type: 'company', id: 'company-a' }],
    checkpoint: 'selection',
    evaluatedAt: '2026-07-22T12:00:00.000Z',
    mode: 'enforce',
    ...overrides,
  }
}

describe('policy DSL operators', () => {
  it.each([
    ['eq', 10, 10, {}, true],
    ['neq', 'A', 'B', {}, true],
    ['in', 'hotel', ['air', 'hotel'], {}, true],
    ['not_in', 'car', ['air', 'hotel'], {}, true],
    ['gt', 11, 10, {}, true],
    ['gte', 10, 10, {}, true],
    ['lt', 9, 10, {}, true],
    ['lte', 10, 10, {}, true],
    ['between', 10, [9, 11], {}, true],
    ['contains', ['bagagem', 'cafe'], 'cafe', {}, true],
    ['not_contains', 'tarifa flexivel', 'bloqueada', {}, true],
    ['starts_with', 'GRU/CGH', 'GRU', {}, true],
    ['ends_with', 'GRU/CGH', 'CGH', {}, true],
    ['exists', 'valor', undefined, {}, true],
    ['not_exists', null, undefined, {}, true],
    ['before', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', {}, true],
    ['after', '2026-07-03T00:00:00Z', '2026-07-02T00:00:00Z', {}, true],
    ['date_between', '2026-07-02T00:00:00Z', ['2026-07-01T00:00:00Z', '2026-07-03T00:00:00Z'], {}, true],
    ['time_between', '23:30', ['22:00', '06:00'], {}, true],
    ['day_of_week', '2026-07-22T12:00:00Z', ['wed'], { timezone: 'UTC' }, true],
    ['matches_safe_pattern', 'CGH-1234', '^CGH-[0-9]{4}$', {}, true],
    ['within_percentage', 1080, { reference: 1000, tolerancePct: 10 }, {}, true],
    ['outside_percentage', 1300, { reference: 1000, tolerancePct: 10 }, {}, true],
    ['distance_greater_than', 12.5, 10, {}, true],
    ['duration_greater_than', 181, 180, {}, true],
  ] as const)('%s avalia valores validos', (operator, observed, expected, options, result) => {
    expect(applyOperator(operator, observed, expected, options)).toBe(result)
  })

  it('compara moedas usando taxas declaradas nos fatos', () => {
    expect(applyOperator(
      'currency_compare',
      { amount: 100, currency: 'USD' },
      { amount: 600, currency: 'BRL' },
      { comparison: 'lte', targetCurrency: 'BRL' },
      { finance: { exchangeRates: { 'USD/BRL': 5.5 } } },
    )).toBe(true)
  })

  it('rejeita padrao potencialmente inseguro e nao executa expressao arbitraria', () => {
    expect(() => applyOperator('matches_safe_pattern', 'aaaa', '(a+)+$')).toThrow(/inseguro/i)
  })

  it('nao converte null, booleano ou string vazia para zero', () => {
    expect(() => applyOperator('gt', null, 0)).not.toThrow()
    expect(applyOperator('eq', null, 0)).toBe(false)
    expect(applyOperator('eq', '', 0)).toBe(false)
    expect(applyOperator('eq', false, 0)).toBe(false)
  })
})

describe('policy evaluation', () => {
  it('avalia a politica somente nos checkpoints declarados', () => {
    const issuanceOnly = policy(
      'issuance-only',
      { fact: 'operation.ready', operator: 'eq', value: true },
      [{ type: 'prevent_issuance', message: 'Emissao bloqueada.' }],
      { checkpoints: ['issuance'] },
    )

    const reservation = evaluatePolicies([issuanceOnly], context(
      { 'operation.ready': true },
      { checkpoint: 'reservation' },
    ))
    const issuance = evaluatePolicies([issuanceOnly], context(
      { 'operation.ready': true },
      { checkpoint: 'issuance' },
    ))

    expect(reservation.applicablePolicies).toEqual([])
    expect(reservation.passed).toBe(true)
    expect(issuance.blocks).toHaveLength(1)
    expect(issuance.passed).toBe(false)
  })

  it('exige justificativa e aprovacao para hotel acima do limite da cidade', () => {
    const result = evaluatePolicies([
      policy(
        'hotel-city-limit',
        { all: [
          { fact: 'traveler.level', operator: 'eq', value: 'analyst' },
          { fact: 'hotel.city', operator: 'eq', value: 'Sao Paulo' },
          { fact: 'hotel.dailyRate', operator: 'gt', value: 400 },
        ] },
        [
          { type: 'require_justification', message: 'Justifique a diaria acima de R$ 400.' },
          { type: 'request_approval', message: 'Aprovacao do gestor obrigatoria.', configuration: { approverRole: 'manager' } },
        ],
      ),
    ], context({ traveler: { level: 'analyst' }, hotel: { city: 'Sao Paulo', dailyRate: 450 } }))

    expect(result.passed).toBe(true)
    expect(result.justificationsRequired).toHaveLength(1)
    expect(result.approvalsRequired).toHaveLength(1)
    expect(result.decisions[0].explanation).toContain('condicao atendida')
  })

  it('aplica tolerancia aerea e bloqueio antes da emissao', () => {
    const tolerance = policy(
      'air-fare-tolerance',
      { fact: 'air.selectedFare', operator: 'outside_percentage', valueFrom: 'air.lowestFare', options: { tolerancePct: 10 } },
      [
        { type: 'require_justification', message: 'Justifique a escolha acima da menor tarifa.' },
        { type: 'add_approval_level', message: 'Segundo nivel obrigatorio.' },
      ],
    )
    const forbidden = policy(
      'air-forbidden-fare',
      { fact: 'air.fareStatus', operator: 'eq', value: 'forbidden' },
      [{ type: 'prevent_issuance', message: 'Tarifa proibida para emissao.' }],
      { priority: 500, severity: 'critical', overridable: false },
    )

    const within = evaluatePolicies([tolerance], context({ air: { selectedFare: 1080, lowestFare: 1000 } }))
    const outside = evaluatePolicies([tolerance], context({ air: { selectedFare: 1300, lowestFare: 1000 } }))
    const blocked = evaluatePolicies([tolerance, forbidden], context({
      air: { selectedFare: 1300, lowestFare: 1000, fareStatus: 'forbidden' },
    }, { checkpoint: 'issuance' }))

    expect(within.approvalsRequired).toHaveLength(0)
    expect(outside.justificationsRequired).toHaveLength(1)
    expect(outside.approvalsRequired).toHaveLength(1)
    expect(blocked.passed).toBe(false)
    expect(blocked.blocks.some((item) => item.action === 'prevent_issuance')).toBe(true)
  })

  it('exige justificativa para antecedencia e preserva fluxo urgente explicito', () => {
    const result = evaluatePolicies([
      policy(
        'air-advance-notice',
        { all: [
          { fact: 'trip.advanceDays', operator: 'lt', value: 14 },
          { fact: 'trip.urgent', operator: 'neq', value: true },
        ] },
        [{ type: 'require_justification', message: 'Antecedencia inferior a 14 dias.' }],
      ),
      policy(
        'urgent-trip-flow',
        { fact: 'trip.urgent', operator: 'eq', value: true },
        [{ type: 'route_to_merit_approval', message: 'Encaminhar urgencia para aprovacao de merito.' }],
      ),
    ], context({ trip: { advanceDays: 5, urgent: true } }, { checkpoint: 'submission' }))

    expect(result.justificationsRequired).toHaveLength(0)
    expect(result.approvalsRequired.map((item) => item.policyCode)).toEqual(['urgent-trip-flow'])
  })

  it('preserva regra critica nao sobrescrevivel em override mais especifico', () => {
    const legal = policy(
      'passport-required',
      { fact: 'trip.type', operator: 'eq', value: 'international' },
      [{ type: 'require_document', message: 'Passaporte valido obrigatorio.' }],
      { category: 'documents', severity: 'critical', overridable: false },
    )
    const companyOverride = policy(
      'passport-required',
      { fact: 'trip.type', operator: 'eq', value: 'international' },
      [{ type: 'allow', message: 'Excecao local.' }],
      {
        policyId: 'policy-passport-company',
        versionId: 'version-passport-company',
        scopes: [COMPANY_SCOPE],
        category: 'documents',
        inheritanceMode: 'override',
        contentHash: 'b'.repeat(64),
      },
    )

    const result = evaluatePolicies([companyOverride, legal], context({ trip: { type: 'international' } }))
    expect(result.requiredDocuments.map((item) => item.policyVersionId)).toContain('version-passport-required')
  })

  it.each(['disable', 'stop_inheritance', 'replace', 'override'] as const)(
    'nao permite que politica comum em modo %s suprima o gatilho canonico da matriz',
    (inheritanceMode) => {
      const matrixTrigger = policy(
        'matrix.trigger.cost.group.abc',
        { fact: 'operation.ready', operator: 'eq', value: true },
        [{
          type: 'request_approval',
          message: 'Aprovacao da matriz obrigatoria.',
          configuration: { workflow: 'matrix.cost.group.abc' },
        }],
        {
          category: 'approval_matrix_cost',
          inheritanceMode: 'replace',
          scopes: [GROUP_SCOPE],
        },
      )
      const genericCompanyPolicy = policy(
        `generic-${inheritanceMode}`,
        { fact: 'operation.ready', operator: 'eq', value: true },
        [{ type: 'allow', message: 'Regra comum da empresa.' }],
        {
          category: 'approval_matrix_cost',
          inheritanceMode,
          scopes: [COMPANY_SCOPE],
        },
      )

      const result = evaluatePolicies(
        [genericCompanyPolicy, matrixTrigger],
        context(
          { operation: { ready: true } },
          { scopes: [{ type: 'tenant' }, { type: 'group', id: 'group-a' }, { type: 'company', id: 'company-a' }] },
        ),
      )

      expect(result.approvalsRequired.map((item) => item.policyCode)).toContain(matrixTrigger.code)
      expect(result.policyVersions).toContain(matrixTrigger.versionId)
    },
  )

  it('permite que matriz de empresa mais especifica substitua a matriz herdada do grupo', () => {
    const groupMatrix = policy(
      'matrix.trigger.cost.group.abc',
      { fact: 'operation.ready', operator: 'eq', value: true },
      [{ type: 'request_approval', message: 'Aprovacao do grupo.', configuration: { workflow: 'matrix.cost.group.abc' } }],
      { category: 'approval_matrix_cost', inheritanceMode: 'replace', scopes: [GROUP_SCOPE] },
    )
    const companyMatrix = policy(
      'matrix.trigger.cost.company.def',
      { fact: 'operation.ready', operator: 'eq', value: true },
      [{ type: 'request_approval', message: 'Aprovacao da empresa.', configuration: { workflow: 'matrix.cost.company.def' } }],
      { category: 'approval_matrix_cost', inheritanceMode: 'replace', scopes: [COMPANY_SCOPE] },
    )

    const result = evaluatePolicies(
      [companyMatrix, groupMatrix],
      context(
        { operation: { ready: true } },
        { scopes: [{ type: 'tenant' }, { type: 'group', id: 'group-a' }, { type: 'company', id: 'company-a' }] },
      ),
    )

    expect(result.approvalsRequired.map((item) => item.policyCode)).toEqual([companyMatrix.code])
    expect(result.policyVersions).toEqual([companyMatrix.versionId])
  })

  it('aplica versoes por vigencia sem depender da ordem de entrada', () => {
    const current = policy('hotel-current', { fact: 'hotel.dailyRate', operator: 'gt', value: 400 }, [
      { type: 'warn', message: 'Limite atual excedido.' },
    ], { validUntil: '2026-08-01T00:00:00.000Z', contentHash: 'c'.repeat(64) })
    const future = policy('hotel-future', { fact: 'hotel.dailyRate', operator: 'gt', value: 500 }, [
      { type: 'warn', message: 'Limite futuro excedido.' },
    ], { validFrom: '2026-08-01T00:00:00.000Z', contentHash: 'd'.repeat(64) })

    const now = evaluatePolicies([future, current], context({ hotel: { dailyRate: 450 } }))
    const later = evaluatePolicies([current, future], context(
      { hotel: { dailyRate: 550 } },
      { evaluatedAt: '2026-08-02T12:00:00.000Z' },
    ))

    expect(now.policyVersions).toEqual(['version-hotel-current'])
    expect(later.policyVersions).toEqual(['version-hotel-future'])
  })

  it('produz resultado deterministico para fatos e politicas semanticamente iguais', () => {
    const rules = [
      policy('rule-b', { fact: 'trip.type', operator: 'eq', value: 'domestic' }, [{ type: 'warn', message: 'B' }], { priority: 20 }),
      policy('rule-a', { fact: 'trip.type', operator: 'eq', value: 'domestic' }, [{ type: 'warn', message: 'A' }], { priority: 30 }),
    ]
    const first = evaluatePolicies(rules, context({ trip: { type: 'domestic' }, company: 'A' }))
    const second = evaluatePolicies([...rules].reverse(), context({ company: 'A', trip: { type: 'domestic' } }))

    expect(first.evaluationId).toBe(second.evaluationId)
    expect(first.resultHash).toBe(second.resultHash)
    expect(first.policyVersions).toEqual(['version-rule-a', 'version-rule-b'])
  })

  it('falha de operador aninhado bloqueia para revisao manual', () => {
    const result = evaluatePolicies([
      policy(
        'currency-limit',
        { all: [
          {
            fact: 'finance.total',
            operator: 'currency_compare',
            value: { amount: 5_000, currency: 'BRL' },
            options: { comparison: 'gt', targetCurrency: 'BRL' },
          },
        ] },
        [{ type: 'request_approval', message: 'Aprovacao financeira.' }],
      ),
    ], context({ finance: { total: { amount: 1_000, currency: 'USD' } } }))

    expect(result.passed).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.blocks[0]).toMatchObject({ action: 'require_manual_review' })
    expect(result.decisions[0].evaluationError).toMatch(/Taxa USD\/BRL/)
  })

  it('erro em excecao nao libera a politica', () => {
    const result = evaluatePolicies([
      policy(
        'international-documents',
        { fact: 'trip.type', operator: 'eq', value: 'international' },
        [{ type: 'require_document', message: 'Documento internacional obrigatorio.' }],
        {
          exceptions: [{ fact: 'traveler.code', operator: 'matches_safe_pattern', value: '(a+)+$' }],
        },
      ),
    ], context({ trip: { type: 'international' }, traveler: { code: 'aaaa' } }))

    expect(result.passed).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.decisions[0].exceptionApplied).toBe(false)
  })
})

describe('policy conflict analysis', () => {
  it('detecta contradicao, versoes sobrepostas, dependencia ausente e ciclo', () => {
    const allow = policy(
      'fare-rule',
      { fact: 'air.class', operator: 'eq', value: 'economy' },
      [{ type: 'allow', message: 'Permitido.' }],
      {
        dependencies: [{ type: 'policy', key: 'hotel-rule', required: true }],
        contentHash: sha256({ rule: 'allow' }),
      },
    )
    const block = policy(
      'fare-rule',
      { fact: 'air.class', operator: 'eq', value: 'economy' },
      [{ type: 'block', message: 'Bloqueado.' }],
      {
        policyId: 'policy-fare-rule-2',
        versionId: 'version-fare-rule-2',
        dependencies: [{ type: 'policy', key: 'fare-rule', required: true }],
        contentHash: sha256({ rule: 'block' }),
      },
    )
    const hotel = policy(
      'hotel-rule',
      { fact: 'hotel.allowed', operator: 'eq', value: true },
      [{ type: 'allow', message: 'Hotel permitido.' }],
      {
        dependencies: [{ type: 'policy', key: 'fare-rule', required: true }],
        contentHash: sha256({ rule: 'hotel' }),
      },
    )

    const conflicts = analyzePolicyConflicts([allow, block, hotel])
    expect(conflicts.some((item) => item.type === 'contradictory_actions')).toBe(true)
    expect(conflicts.some((item) => item.type === 'overlapping_versions')).toBe(true)
    expect(conflicts.some((item) => item.type === 'missing_dependency')).toBe(true)
    expect(conflicts.some((item) => item.type === 'dependency_cycle')).toBe(true)
  })

  it('mantem a avaliacao booleana pura e explicavel', () => {
    const trace = evaluateExpression({ not: { fact: 'trip.weekend', operator: 'eq', value: true } }, { trip: { weekend: false } })
    expect(trace).toMatchObject({ kind: 'not', matched: true })
  })
})
