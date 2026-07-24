export type PolicyBenchmarkRuntimeStatus =
  | 'implemented'
  | 'implemented_with_external_dependencies'
  | 'rejected_security'

export interface PolicyBenchmarkArea {
  id: string
  name: string
  sourcePages: readonly [number, number]
  runtimeStatus: PolicyBenchmarkRuntimeStatus
  familyKeys: readonly string[]
  notes: string
}

export interface PolicyBenchmarkSecurityExclusion {
  reference: string
  sourcePages: readonly number[]
  runtimeStatus: 'rejected_security'
  reason: string
  safeAlternativeFamilyKey: string
}

export const ARGO_POLICY_BENCHMARK_SOURCE = {
  document: '__. ARGO .__ politicas.pdf',
  sha256: 'f84c67292fa47ef800b10ed24d662d6100002488164c04d8c7c03fc83b1b54ac',
  pages: 49,
  reviewedAt: '2026-07-23',
  detectedReferenceCodes: 150,
} as const

export const ARGO_POLICY_BENCHMARK_AREAS: readonly PolicyBenchmarkArea[] = [
  {
    id: 'advances',
    name: 'Adiantamento e prestacao de contas',
    sourcePages: [2, 3],
    runtimeStatus: 'implemented',
    familyKeys: [
      'advance.auto-approve-budget', 'advance.request-window', 'advance.daily-limit',
      'advance.observation', 'advance.max-open-reports', 'advance.pending', 'advance.limit',
      'expense.required-for-trip', 'expense.conference', 'expense.deadline',
    ],
    notes: 'Inclui janela, limites, pendencias, observacao, aprovacao e conferencia.',
  },
  {
    id: 'cost-allocation',
    name: 'Alocacao de custos',
    sourcePages: [3, 5],
    runtimeStatus: 'implemented',
    familyKeys: [
      'allocation.hierarchy', 'allocation.company-bound', 'allocation.debit-change',
      'allocation.total', 'cost-center.required', 'cost-center.active',
      'project.required', 'account.required',
    ],
    notes: 'Valida empresa, hierarquia, centro de custo, projeto, conta e rateio.',
  },
  {
    id: 'approvals',
    name: 'Aprovacao, alcadas e delegacoes',
    sourcePages: [5, 12],
    runtimeStatus: 'implemented',
    familyKeys: [
      'approval.amount', 'approval.international', 'approval.continuation',
      'approval.companion', 'approval.secure-email-link', 'approval.dual-merit-cost',
      'approval.lowest-fare', 'approval.traveler-confirmation', 'approval.expiry-deadline',
      'approval.separation-of-duties', 'authority.executive', 'authority.fare-percentage',
      'delegation.expired', 'delegation.required-metadata', 'delegation.max-active',
    ],
    notes: 'Aprovacao sem autenticacao e excluida e substituida por token individual de uso unico.',
  },
  {
    id: 'communication',
    name: 'Comunicacao',
    sourcePages: [11, 14],
    runtimeStatus: 'implemented',
    familyKeys: [
      'communication.issued', 'communication.status-email',
      'communication.pdf-attachment', 'profile.document-expiration',
    ],
    notes: 'Notificacoes sao tarefas idempotentes e auditadas, nao efeitos locais no navegador.',
  },
  {
    id: 'quotation',
    name: 'Cotacao e distribuicao',
    sourcePages: [15, 17],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'quotation.minimum-offers', 'quotation.online-fallback', 'quotation.assignment-lock',
      'search.preferred', 'search.blocked-supplier', 'sla.quote', 'integration.homologated',
    ],
    notes: 'Pesquisa e reserva online dependem da homologacao de cada provedor externo.',
  },
  {
    id: 'issuance',
    name: 'Emissao',
    sourcePages: [17, 19],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'issuance.authorization', 'issuance.deadline', 'emission.online-authorized',
      'emission.payment-data', 'integration.homologated',
    ],
    notes: 'A emissao automatizada permanece bloqueada para conectores nao homologados.',
  },
  {
    id: 'selection-billing-justification',
    name: 'Escolha, faturamento e justificativas',
    sourcePages: [19, 21],
    runtimeStatus: 'implemented',
    familyKeys: [
      'air.lowest-fare', 'justification.fare', 'selection.predefined-reason',
      'billing.data', 'billing.split', 'billing.fee-disclosure', 'payment.card-exclusive',
    ],
    notes: 'Escolhas fora de politica exigem justificativa estruturada e preservam evidencia.',
  },
  {
    id: 'modules',
    name: 'Modulos corporativos',
    sourcePages: [21, 23],
    runtimeStatus: 'implemented',
    familyKeys: [
      'modules.advance', 'modules.reimbursement', 'modules.services',
      'request.service-enabled',
    ],
    notes: 'A habilitacao de modulo e avaliada no servidor por escopo corporativo.',
  },
  {
    id: 'budgets',
    name: 'Orcamento',
    sourcePages: [23, 25],
    runtimeStatus: 'implemented',
    familyKeys: [
      'budget.warning', 'budget.block', 'budget.by-order', 'budget.period-active',
      'budget.auto-approval', 'budget.motive-account',
      'finance.commit-budget', 'finance.release-budget',
    ],
    notes: 'Compromisso, consumo e liberacao usam operacoes relacionais transacionais.',
  },
  {
    id: 'administrative-controls',
    name: 'Controles administrativos e operacionais',
    sourcePages: [25, 27],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'integration.unflown-ticket', 'integration.parent-request-order',
      'request.duplicate-permission', 'request.outside-business-hours', 'sla.quote',
    ],
    notes: 'Consulta de bilhetes nao voados exige fonte externa homologada.',
  },
  {
    id: 'traveler-profile',
    name: 'Perfil do viajante',
    sourcePages: [27, 29],
    runtimeStatus: 'implemented',
    familyKeys: [
      'profile.complete', 'profile.mandatory-fields', 'profile.document-expiration',
      'documents.passport', 'traveler.preferred-seat',
    ],
    notes: 'Documento e perfil usam a identidade relacional permanente do colaborador.',
  },
  {
    id: 'search',
    name: 'Pesquisa',
    sourcePages: [29, 34],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'search.air-time-window', 'search.air-direct-only', 'search.nearby-airports',
      'search.baggage-restriction', 'air.class', 'air.direct', 'air.lowest-fare',
      'hotel.preferred', 'integration.homologated',
    ],
    notes: 'Ranking e bloqueios sao deterministas; disponibilidade depende do provedor.',
  },
  {
    id: 'deadlines-reservations',
    name: 'Prazos e reservas',
    sourcePages: [34, 37],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'request.outside-business-hours', 'air.advance', 'reservation.minimum-advance',
      'reservation.validity', 'expiration.hold', 'cancellation.online-failure',
    ],
    notes: 'A efetivacao online depende da integracao; os bloqueios e prazos sao locais e auditaveis.',
  },
  {
    id: 'security',
    name: 'Seguranca',
    sourcePages: [37, 38],
    runtimeStatus: 'implemented',
    familyKeys: [
      'security.password-minimum', 'security.destination', 'risk.duty-of-care',
      'approval.secure-email-link', 'approval.separation-of-duties',
    ],
    notes: 'As regras do PDF que reduziriam autenticacao nao sao reproduzidas.',
  },
  {
    id: 'requests',
    name: 'Solicitacao e jornada da viagem',
    sourcePages: [39, 49],
    runtimeStatus: 'implemented_with_external_dependencies',
    familyKeys: [
      'request.max-travelers', 'request.policy-acceptance', 'request.duplicate-permission',
      'request.outside-business-hours', 'request.service-enabled',
      'request.consultant-required', 'itinerary.composite', 'billing.split',
      'billing.fee-disclosure', 'traveler.preferred-seat', 'integration.homologated',
    ],
    notes: 'Abertura e governanca sao locais; reserva e emissao respeitam a homologacao do provedor.',
  },
] as const

export const ARGO_POLICY_SECURITY_EXCLUSIONS: readonly PolicyBenchmarkSecurityExclusion[] = [
  {
    reference: 'ARGO:APROUT',
    sourcePages: [7, 10, 19],
    runtimeStatus: 'rejected_security',
    reason: 'Aprovacao sem autenticacao viola identidade individual, nao repudio e trilha de auditoria.',
    safeAlternativeFamilyKey: 'approval.secure-email-link',
  },
] as const

export function argoBenchmarkFamilyKeys(): string[] {
  return Array.from(new Set(ARGO_POLICY_BENCHMARK_AREAS.flatMap((area) => [...area.familyKeys]))).sort()
}

export function argoBenchmarkReferenceSummary(
  benchmarkReferences: readonly string[],
): { mapped: number; rejectedForSecurity: number; total: number } {
  const mapped = new Set(benchmarkReferences).size
  const rejectedForSecurity = ARGO_POLICY_SECURITY_EXCLUSIONS.length
  return {
    mapped,
    rejectedForSecurity,
    total: mapped + rejectedForSecurity,
  }
}
