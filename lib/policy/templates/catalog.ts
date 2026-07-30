import { sha256 } from '@/lib/policy/evaluator'
import type { PolicyAction, PolicyExpression, PolicyOperator } from '@/lib/policy/types'
import type {
  PolicySegmentProfile,
  PolicyTemplateClassification,
  PolicyTemplateConfiguration,
  PolicyTemplateDependency,
} from '@/lib/policy/templates/types'

interface TemplateBlueprint {
  key: string
  category: string
  title: string
  description: string
  classification: PolicyTemplateClassification
  condition: (profile: PolicySegmentProfile) => PolicyExpression
  actions: (profile: PolicySegmentProfile) => PolicyAction[]
  sampleFacts: (profile: PolicySegmentProfile) => Record<string, unknown>
  parameters: (profile: PolicySegmentProfile) => Record<string, unknown>
  dependencies: PolicyTemplateDependency[]
  risks: string[]
  checkpoints: string[]
}

interface SimpleBlueprintInput {
  key: string
  category: string
  title: string
  description: string
  classification?: PolicyTemplateClassification
  fact: string
  operator: PolicyOperator
  expected: (profile: PolicySegmentProfile) => unknown
  observed: (profile: PolicySegmentProfile) => unknown
  actionType: PolicyAction['type']
  actionMessage: string
  remediation?: string
  parameters?: (profile: PolicySegmentProfile) => Record<string, unknown>
  actionConfiguration?: (profile: PolicySegmentProfile) => Record<string, unknown>
  dependencies?: PolicyTemplateDependency[]
  risks?: string[]
  checkpoints: string[]
}

export const POLICY_SEGMENT_PROFILES: readonly PolicySegmentProfile[] = [
  segment('industry', 'Industria', 8_000, 30_000, 80, 100, 12, 14, 520, 12, 380, 5_000, 3_000, 10, 15, 12_000, 20, 90, 480, 900, 'high'),
  segment('pharmaceutical', 'Farmaceutica', 5_000, 20_000, 75, 95, 8, 21, 650, 8, 420, 4_000, 2_500, 7, 10, 10_000, 15, 60, 360, 650, 'critical'),
  segment('construction', 'Construcao', 6_000, 25_000, 80, 98, 12, 10, 430, 18, 360, 4_500, 3_500, 10, 15, 8_000, 25, 120, 420, 1_000, 'high'),
  segment('agribusiness', 'Agronegocio', 7_500, 28_000, 82, 100, 15, 10, 460, 25, 390, 5_500, 4_000, 12, 15, 10_000, 25, 120, 480, 1_100, 'high'),
  segment('technology', 'Tecnologia', 10_000, 40_000, 85, 105, 15, 10, 600, 10, 450, 8_000, 4_000, 15, 20, 15_000, 25, 90, 300, 800, 'medium'),
  segment('healthcare', 'Saude', 5_000, 18_000, 75, 95, 8, 21, 580, 8, 400, 3_500, 2_000, 7, 10, 8_000, 15, 60, 300, 600, 'critical'),
  segment('consulting', 'Consultoria', 12_000, 50_000, 85, 105, 15, 7, 700, 8, 500, 10_000, 5_000, 15, 20, 18_000, 30, 90, 240, 1_000, 'medium'),
  segment('education', 'Educacao', 3_000, 12_000, 70, 90, 8, 21, 350, 15, 280, 2_500, 1_500, 7, 10, 5_000, 15, 60, 600, 500, 'medium'),
  segment('logistics', 'Logistica', 6_000, 20_000, 78, 98, 10, 10, 420, 20, 340, 4_000, 3_000, 10, 15, 8_000, 25, 120, 360, 1_200, 'high'),
  segment('holding', 'Holding', 15_000, 75_000, 88, 108, 20, 7, 850, 8, 650, 15_000, 8_000, 20, 30, 25_000, 30, 120, 240, 1_200, 'medium'),
  segment('financial', 'Setor financeiro', 4_000, 15_000, 72, 92, 8, 21, 620, 8, 420, 3_000, 2_000, 7, 10, 7_500, 15, 60, 300, 550, 'critical'),
  segment('multinational', 'Empresa multinacional', 10_000, 45_000, 82, 102, 12, 21, 780, 10, 550, 9_000, 6_000, 15, 20, 20_000, 25, 120, 360, 1_500, 'high'),
] as const

const WORKFLOW = (key: string): PolicyTemplateDependency => ({ type: 'workflow', key, required: true })
const FEATURE = (key: string): PolicyTemplateDependency => ({ type: 'feature', key, required: true })
const DIRECTORY = (key: string): PolicyTemplateDependency => ({ type: 'directory', key, required: true })
const INTEGRATION = (key: string): PolicyTemplateDependency => ({ type: 'integration', key, required: true })

const BLUEPRINTS: readonly TemplateBlueprint[] = [
  simple({ key: 'approval.amount', category: 'approval', title: 'Aprovacao por valor', description: 'Encaminha despesas acima da alçada para aprovacao.', fact: 'finance.totalAmount', operator: 'gt', expected: p => p.approvalAmount, observed: p => p.approvalAmount + 1, actionType: 'request_approval', actionMessage: 'Aprovacao por valor obrigatoria.', parameters: p => ({ amount: p.approvalAmount, currency: 'BRL' }), actionConfiguration: p => ({ workflow: 'cost-approval', threshold: p.approvalAmount }), dependencies: [WORKFLOW('cost-approval')], checkpoints: ['submission', 'cost_approval'] }),
  simple({ key: 'approval.international', category: 'approval', title: 'Aprovacao internacional', description: 'Exige aprovacao especifica em viagem internacional.', fact: 'trip.type', operator: 'eq', expected: () => 'international', observed: () => 'international', actionType: 'route_to_merit_approval', actionMessage: 'Aprovacao internacional obrigatoria.', dependencies: [WORKFLOW('international-merit')], checkpoints: ['submission'] }),
  simple({ key: 'authority.executive', category: 'authority', title: 'Segundo nivel executivo', description: 'Inclui diretoria quando o valor supera a alçada executiva.', fact: 'finance.totalAmount', operator: 'gt', expected: p => p.executiveAmount, observed: p => p.executiveAmount + 1, actionType: 'add_approval_level', actionMessage: 'Segundo nivel executivo obrigatorio.', parameters: p => ({ amount: p.executiveAmount }), dependencies: [WORKFLOW('executive-authority')], checkpoints: ['cost_approval'] }),
  simple({ key: 'authority.fare-percentage', category: 'authority', title: 'Alçada por diferenca tarifaria', description: 'Escalona escolha muito acima da menor tarifa.', fact: 'air.selectedFare', operator: 'outside_percentage', expected: p => ({ reference: 1_000, tolerancePct: p.airTolerancePct * 2 }), observed: p => 1_000 * (1 + (p.airTolerancePct * 2 + 1) / 100), actionType: 'add_approval_level', actionMessage: 'Alçada adicional por diferenca tarifaria.', parameters: p => ({ tolerancePct: p.airTolerancePct * 2 }), dependencies: [WORKFLOW('fare-exception')], checkpoints: ['selection', 'cost_approval'] }),
  simple({ key: 'delegation.expired', category: 'delegation', title: 'Delegacao expirada', description: 'Impede decisao baseada em delegacao fora da vigencia.', classification: 'workflow', fact: 'approval.delegationValid', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Delegacao invalida ou expirada.', risks: ['Aprovacao sem autoridade valida.'], checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'budget.warning', category: 'budget', title: 'Alerta de consumo de orcamento', description: 'Alerta quando o consumo se aproxima do limite.', classification: 'financial_rule', fact: 'finance.budgetUsagePct', operator: 'gte', expected: p => p.budgetWarningPct, observed: p => p.budgetWarningPct, actionType: 'warn', actionMessage: 'Orcamento proximo do limite.', parameters: p => ({ warningPct: p.budgetWarningPct }), dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['submission', 'cost_approval'] }),
  simple({ key: 'budget.block', category: 'budget', title: 'Bloqueio de estouro de orcamento', description: 'Bloqueia compromisso que ultrapassa o limite.', classification: 'financial_rule', fact: 'finance.budgetUsagePct', operator: 'gt', expected: p => p.budgetBlockPct, observed: p => p.budgetBlockPct + 1, actionType: 'block', actionMessage: 'Saldo de orcamento insuficiente.', remediation: 'Solicite ajuste do orcamento ou aprovacao de excecao.', parameters: p => ({ blockPct: p.budgetBlockPct }), dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['submission', 'reservation', 'issuance'] }),
  simple({ key: 'cost-center.required', category: 'cost_center', title: 'Centro de custo obrigatorio', description: 'Exige centro de custo antes do envio.', fact: 'finance.costCenterId', operator: 'not_exists', expected: () => undefined, observed: () => null, actionType: 'require_cost_center', actionMessage: 'Informe o centro de custo.', dependencies: [DIRECTORY('cost-centers')], checkpoints: ['submission'] }),
  simple({ key: 'cost-center.active', category: 'cost_center', title: 'Centro de custo ativo', description: 'Bloqueia centro de custo inativo.', fact: 'finance.costCenterActive', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Centro de custo inativo.', dependencies: [DIRECTORY('cost-centers')], checkpoints: ['submission', 'issuance'] }),
  simple({ key: 'project.required', category: 'projects', title: 'Projeto obrigatorio', description: 'Exige projeto quando a empresa controla despesas por projeto.', fact: 'finance.projectRequiredAndMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_project', actionMessage: 'Informe o projeto da viagem.', dependencies: [DIRECTORY('projects')], checkpoints: ['submission'] }),
  simple({ key: 'account.required', category: 'accounts', title: 'Conta contabil obrigatoria', description: 'Exige conta contabil valida para a despesa.', fact: 'finance.accountId', operator: 'not_exists', expected: () => undefined, observed: () => null, actionType: 'require_account', actionMessage: 'Informe a conta contabil.', dependencies: [DIRECTORY('accounts')], checkpoints: ['submission', 'expense'] }),
  simple({ key: 'allocation.total', category: 'allocation', title: 'Rateio integral', description: 'Exige que as linhas de rateio totalizem cem por cento.', fact: 'finance.allocationPct', operator: 'neq', expected: () => 100, observed: () => 90, actionType: 'require_cost_allocation', actionMessage: 'O rateio deve totalizar 100%.', checkpoints: ['submission', 'expense'] }),
  simple({ key: 'air.advance', category: 'air', title: 'Antecedencia aerea', description: 'Exige justificativa para compra aerea fora da antecedencia.', fact: 'trip.advanceDays', operator: 'lt', expected: p => p.airAdvanceDays, observed: p => p.airAdvanceDays - 1, actionType: 'require_justification', actionMessage: 'Justifique a antecedencia reduzida.', parameters: p => ({ minimumDays: p.airAdvanceDays }), checkpoints: ['request', 'submission'] }),
  percentageRule('air.lowest-fare', 'air', 'Tolerancia da menor tarifa', 'Controla a escolha acima da menor tarifa.', 'air.selectedFare', 'air.lowestFare', p => p.airTolerancePct, 'require_justification', 'Justifique a escolha acima da menor tarifa.', ['selection', 'issuance'], [FEATURE('fare-comparison')]),
  simple({ key: 'air.class', category: 'air', title: 'Classe aerea permitida', description: 'Bloqueia classe superior sem autorizacao.', fact: 'air.classAllowed', operator: 'eq', expected: () => false, observed: () => false, actionType: 'enforce_class', actionMessage: 'Classe aerea fora da politica.', checkpoints: ['search', 'selection', 'issuance'] }),
  simple({ key: 'air.direct', category: 'air', title: 'Preferencia por voo direto', description: 'Prioriza voo direto dentro da tolerancia.', fact: 'air.directFlightAvailable', operator: 'eq', expected: () => true, observed: () => true, actionType: 'rank_offer', actionMessage: 'Priorizar opcao de voo direto.', actionConfiguration: p => ({ maxPremiumPct: p.airTolerancePct }), checkpoints: ['search'] }),
  simple({ key: 'hotel.daily', category: 'hotel', title: 'Limite de diaria', description: 'Controla diaria de hotel por perfil e destino.', fact: 'hotel.dailyRate', operator: 'gt', expected: p => p.hotelDailyLimit, observed: p => p.hotelDailyLimit + 1, actionType: 'request_approval', actionMessage: 'Diaria acima do limite.', parameters: p => ({ dailyLimit: p.hotelDailyLimit, currency: 'BRL' }), dependencies: [WORKFLOW('hotel-exception')], checkpoints: ['selection', 'reservation'] }),
  simple({ key: 'hotel.preferred', category: 'hotel', title: 'Hotel preferencial', description: 'Prioriza hotel homologado pela empresa.', fact: 'hotel.preferred', operator: 'eq', expected: () => true, observed: () => true, actionType: 'rank_offer', actionMessage: 'Priorizar hotel preferencial.', dependencies: [DIRECTORY('preferred-hotels')], checkpoints: ['search'] }),
  simple({ key: 'hotel.distance', category: 'hotel', title: 'Distancia maxima do compromisso', description: 'Exige justificativa para hotel distante.', fact: 'hotel.distanceKm', operator: 'distance_greater_than', expected: p => p.hotelDistanceKm, observed: p => p.hotelDistanceKm + 1, actionType: 'require_justification', actionMessage: 'Hotel acima da distancia recomendada.', parameters: p => ({ maxDistanceKm: p.hotelDistanceKm }), checkpoints: ['selection'] }),
  simple({ key: 'car.daily', category: 'car_rental', title: 'Limite de diaria de veiculo', description: 'Controla valor da diaria de locacao.', fact: 'car.dailyRate', operator: 'gt', expected: p => p.carDailyLimit, observed: p => p.carDailyLimit + 1, actionType: 'request_approval', actionMessage: 'Diaria de veiculo acima do limite.', parameters: p => ({ dailyLimit: p.carDailyLimit }), dependencies: [WORKFLOW('car-exception')], checkpoints: ['selection', 'reservation'] }),
  simple({ key: 'car.insurance', category: 'car_rental', title: 'Seguro de locacao', description: 'Exige cobertura minima na locacao.', fact: 'car.insuranceIncluded', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_insurance', actionMessage: 'Seguro da locacao obrigatorio.', checkpoints: ['selection', 'reservation'] }),
  simple({ key: 'bus.advance', category: 'bus', title: 'Antecedencia rodoviaria', description: 'Exige justificativa em compra rodoviaria urgente.', fact: 'bus.advanceDays', operator: 'lt', expected: p => Math.max(1, Math.floor(p.airAdvanceDays / 2)), observed: () => 0, actionType: 'require_justification', actionMessage: 'Justifique a compra rodoviaria urgente.', checkpoints: ['submission'] }),
  simple({ key: 'services.limit', category: 'services', title: 'Limite para servicos adicionais', description: 'Controla o valor de servicos complementares.', fact: 'service.totalAmount', operator: 'gt', expected: p => p.serviceLimit, observed: p => p.serviceLimit + 1, actionType: 'request_approval', actionMessage: 'Servico adicional acima do limite.', parameters: p => ({ serviceLimit: p.serviceLimit }), dependencies: [WORKFLOW('service-exception')], checkpoints: ['selection'] }),
  simple({ key: 'insurance.international', category: 'insurance', title: 'Seguro internacional obrigatorio', description: 'Exige seguro em viagem internacional.', fact: 'trip.internationalWithoutInsurance', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_insurance', actionMessage: 'Seguro viagem internacional obrigatorio.', checkpoints: ['submission', 'issuance'] }),
  simple({ key: 'advance.pending', category: 'advances', title: 'Prestacao pendente', description: 'Bloqueia novo adiantamento com pendencia anterior.', classification: 'financial_rule', fact: 'finance.hasPendingExpenseReport', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Existe prestacao de contas pendente.', checkpoints: ['submission', 'expense'] }),
  simple({ key: 'advance.limit', category: 'advances', title: 'Limite de adiantamento', description: 'Exige aprovacao acima do limite de adiantamento.', classification: 'financial_rule', fact: 'finance.advanceAmount', operator: 'gt', expected: p => p.advanceLimit, observed: p => p.advanceLimit + 1, actionType: 'request_approval', actionMessage: 'Adiantamento acima do limite.', parameters: p => ({ advanceLimit: p.advanceLimit }), dependencies: [WORKFLOW('advance-exception')], checkpoints: ['submission'] }),
  simple({ key: 'reimbursement.deadline', category: 'reimbursement', title: 'Prazo de reembolso', description: 'Exige justificativa para reembolso atrasado.', classification: 'financial_rule', fact: 'expense.daysSinceTrip', operator: 'gt', expected: p => p.reimbursementDeadlineDays, observed: p => p.reimbursementDeadlineDays + 1, actionType: 'require_justification', actionMessage: 'Reembolso enviado fora do prazo.', parameters: p => ({ deadlineDays: p.reimbursementDeadlineDays }), checkpoints: ['expense'] }),
  simple({ key: 'reimbursement.receipt', category: 'reimbursement', title: 'Comprovante de reembolso', description: 'Exige comprovante fiscal para reembolso.', classification: 'financial_rule', fact: 'expense.receiptRequiredAndMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_attachment', actionMessage: 'Anexe o comprovante da despesa.', checkpoints: ['expense'] }),
  simple({ key: 'expense.deadline', category: 'expense_reports', title: 'Prazo de prestacao de contas', description: 'Controla prazo apos retorno da viagem.', classification: 'financial_rule', fact: 'expense.daysAfterReturn', operator: 'gt', expected: p => p.expenseDeadlineDays, observed: p => p.expenseDeadlineDays + 1, actionType: 'escalate', actionMessage: 'Prestacao de contas atrasada.', parameters: p => ({ deadlineDays: p.expenseDeadlineDays }), checkpoints: ['expense'] }),
  simple({ key: 'expense.duplicate', category: 'expense_reports', title: 'Duplicidade de despesa', description: 'Bloqueia comprovante potencialmente duplicado.', classification: 'financial_rule', fact: 'expense.duplicateDetected', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Despesa duplicada detectada.', checkpoints: ['expense'] }),
  simple({ key: 'cards.payment', category: 'cards', title: 'Forma de pagamento corporativa', description: 'Exige forma de pagamento permitida.', classification: 'financial_rule', fact: 'finance.paymentMethodAllowed', operator: 'eq', expected: () => false, observed: () => false, actionType: 'enforce_payment_method', actionMessage: 'Forma de pagamento fora da politica.', checkpoints: ['reservation', 'issuance'] }),
  simple({ key: 'cards.limit', category: 'cards', title: 'Limite do cartao', description: 'Bloqueia operacao acima do limite disponivel.', classification: 'financial_rule', fact: 'finance.cardChargeAmount', operator: 'gt', expected: p => p.cardLimit, observed: p => p.cardLimit + 1, actionType: 'block', actionMessage: 'Valor acima do limite do cartao.', parameters: p => ({ cardLimit: p.cardLimit }), checkpoints: ['issuance', 'expense'] }),
  simple({ key: 'billing.data', category: 'billing', title: 'Dados de faturamento', description: 'Exige dados completos para faturamento.', classification: 'financial_rule', fact: 'billing.complete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Dados de faturamento incompletos.', checkpoints: ['issuance', 'post_issuance'] }),
  percentageRule('justification.fare', 'justifications', 'Justificativa por diferenca', 'Exige justificativa acima da tolerancia da tarifa.', 'air.selectedFare', 'air.lowestFare', p => p.airTolerancePct, 'require_predefined_justification', 'Selecione o motivo da escolha tarifaria.', ['selection'], [FEATURE('fare-comparison')]),
  simple({ key: 'communication.issued', category: 'communication', title: 'Comunicacao de emissao', description: 'Gera notificacao apos emissao confirmada.', classification: 'domain_action', fact: 'operation.status', operator: 'eq', expected: () => 'issued', observed: () => 'issued', actionType: 'notify', actionMessage: 'Notificar viajante e solicitante.', actionConfiguration: () => ({ channels: ['email', 'in_app'] }), checkpoints: ['post_issuance'] }),
  simple({ key: 'issuance.authorization', category: 'issuance', title: 'Autorizacao antes da emissao', description: 'Impede emissao sem aprovacao vigente.', fact: 'approval.costApproved', operator: 'eq', expected: () => false, observed: () => false, actionType: 'prevent_issuance', actionMessage: 'Aprovacao de custo pendente.', checkpoints: ['issuance'] }),
  simple({ key: 'issuance.deadline', category: 'issuance', title: 'Prazo de emissao', description: 'Escalona reserva proxima da expiracao.', fact: 'operation.minutesToIssueDeadline', operator: 'lt', expected: () => 60, observed: () => 30, actionType: 'escalate', actionMessage: 'Prazo de emissao proximo.', parameters: () => ({ warningMinutes: 60 }), checkpoints: ['issuance'] }),
  simple({ key: 'cancellation.penalty', category: 'cancellation', title: 'Penalidade de cancelamento', description: 'Exige aprovacao quando a multa supera a tolerancia.', fact: 'cancellation.penaltyPct', operator: 'gt', expected: p => p.cancellationPenaltyPct, observed: p => p.cancellationPenaltyPct + 1, actionType: 'request_approval', actionMessage: 'Multa de cancelamento acima da tolerancia.', parameters: p => ({ penaltyPct: p.cancellationPenaltyPct }), dependencies: [WORKFLOW('cancellation-exception')], checkpoints: ['cancellation'] }),
  simple({ key: 'expiration.hold', category: 'expiration', title: 'Expiracao da reserva', description: 'Cancela reserva nao emitida ao vencer o prazo.', classification: 'job', fact: 'operation.holdExpired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'cancel_on_expiration', actionMessage: 'Cancelar reserva expirada.', parameters: p => ({ defaultHoldMinutes: p.reservationHoldMinutes }), checkpoints: ['reservation', 'issuance'] }),
  simple({ key: 'profile.complete', category: 'profile', title: 'Perfil do viajante completo', description: 'Exige dados essenciais do viajante.', fact: 'traveler.profileComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Perfil do viajante incompleto.', checkpoints: ['profile', 'request'] }),
  simple({ key: 'security.destination', category: 'security', title: 'Destino de alto risco', description: 'Exige revisao de seguranca para destino de risco.', fact: 'risk.level', operator: 'in', expected: p => p.riskLevel === 'critical' ? ['high', 'critical'] : ['critical'], observed: () => 'critical', actionType: 'request_approval', actionMessage: 'Aprovacao de seguranca obrigatoria.', dependencies: [WORKFLOW('security-review')], checkpoints: ['submission', 'issuance'] }),
  simple({ key: 'documents.passport', category: 'documents', title: 'Passaporte valido', description: 'Bloqueia viagem internacional sem passaporte valido.', fact: 'traveler.passportValid', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_document', actionMessage: 'Passaporte valido obrigatorio.', risks: ['Requisito legal e migratorio; nao sobrescrevivel.'], checkpoints: ['profile', 'submission', 'issuance'] }),
  simple({ key: 'search.preferred', category: 'search', title: 'Fornecedor preferencial', description: 'Prioriza fornecedores homologados.', fact: 'offer.preferredSupplier', operator: 'eq', expected: () => true, observed: () => true, actionType: 'rank_offer', actionMessage: 'Priorizar fornecedor preferencial.', dependencies: [DIRECTORY('preferred-suppliers')], checkpoints: ['search'] }),
  simple({ key: 'search.blocked-supplier', category: 'search', title: 'Fornecedor bloqueado', description: 'Oculta fornecedor bloqueado por compliance.', fact: 'offer.supplierBlocked', operator: 'eq', expected: () => true, observed: () => true, actionType: 'hide_offer', actionMessage: 'Oferta de fornecedor bloqueado.', dependencies: [DIRECTORY('blocked-suppliers')], checkpoints: ['search'] }),
  simple({ key: 'reservation.validity', category: 'reservation', title: 'Validade da cotacao', description: 'Impede reserva com cotacao expirada.', fact: 'offer.expired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'hold_booking', actionMessage: 'Cotacao expirada; pesquise novamente.', checkpoints: ['reservation'] }),
  simple({ key: 'reconciliation.mismatch', category: 'reconciliation', title: 'Divergencia de conciliacao', description: 'Encaminha diferenca financeira para revisao.', classification: 'financial_rule', fact: 'reconciliation.amountDifference', operator: 'gt', expected: () => 0.01, observed: () => 1, actionType: 'create_task', actionMessage: 'Revisar divergencia de conciliacao.', checkpoints: ['post_issuance', 'expense'] }),
  simple({ key: 'reports.allocation', category: 'reports', title: 'Classificacao para relatorio', description: 'Exige dimensoes corporativas para consolidacao.', classification: 'report', fact: 'report.allocationComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_cost_allocation', actionMessage: 'Complete a classificacao corporativa.', checkpoints: ['submission', 'expense'] }),
  simple({ key: 'sla.quote', category: 'sla', title: 'SLA de cotacao', description: 'Escalona demanda quando o SLA de cotacao vence.', classification: 'workflow', fact: 'operation.quoteElapsedMinutes', operator: 'gt', expected: p => p.quoteSlaMinutes, observed: p => p.quoteSlaMinutes + 1, actionType: 'escalate', actionMessage: 'SLA de cotacao excedido.', parameters: p => ({ quoteSlaMinutes: p.quoteSlaMinutes }), checkpoints: ['quotation'] }),
  simple({ key: 'risk.duty-of-care', category: 'risk', title: 'Duty of care', description: 'Exige aceite e monitoramento em viagem de risco.', fact: 'risk.monitoringRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_acceptance', actionMessage: 'Aceite do protocolo de seguranca obrigatorio.', dependencies: [FEATURE('duty-of-care')], checkpoints: ['submission', 'post_issuance'] }),
  simple({ key: 'sustainability.co2', category: 'sustainability', title: 'Limite de emissao de carbono', description: 'Alerta sobre opcoes acima da meta de CO2.', fact: 'sustainability.co2Kg', operator: 'gt', expected: p => p.co2LimitKg, observed: p => p.co2LimitKg + 1, actionType: 'warn', actionMessage: 'Emissao estimada acima da meta.', parameters: p => ({ co2LimitKg: p.co2LimitKg }), checkpoints: ['selection'] }),
  simple({ key: 'integration.homologated', category: 'integrations', title: 'Integracao homologada', description: 'Impede automacao por conector nao homologado.', classification: 'integration', fact: 'integration.homologated', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Integracao nao homologada; use operacao assistida.', dependencies: [INTEGRATION('travel-provider')], risks: ['Operacao externa sem homologacao confirmada.'], checkpoints: ['search', 'reservation', 'issuance'] }),
  simple({ key: 'finance.commit-budget', category: 'budget', title: 'Compromisso orcamentario', description: 'Registra compromisso antes da reserva.', classification: 'financial_rule', fact: 'finance.commitmentRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'commit_budget', actionMessage: 'Comprometer saldo orcamentario.', dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['reservation'] }),
  simple({ key: 'finance.release-budget', category: 'budget', title: 'Liberacao de orcamento', description: 'Libera compromisso em cancelamento confirmado.', classification: 'financial_rule', fact: 'cancellation.releaseBudget', operator: 'eq', expected: () => true, observed: () => true, actionType: 'release_budget', actionMessage: 'Liberar saldo comprometido.', dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['cancellation'] }),
  simple({ key: 'advance.auto-approve-budget', category: 'advances', title: 'Aprovacao automatica de adiantamento', description: 'Aprova automaticamente o adiantamento quando existe saldo no orcamento aplicavel.', classification: 'financial_rule', fact: 'finance.advanceWithinBudget', operator: 'eq', expected: () => true, observed: () => true, actionType: 'auto_approve', actionMessage: 'Adiantamento elegivel para aprovacao automatica.', dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['submission'] }),
  simple({ key: 'advance.request-window', category: 'advances', title: 'Janela para solicitar adiantamento', description: 'Impede solicitacao de adiantamento fora da janela definida antes da viagem.', classification: 'financial_rule', fact: 'finance.advanceHoursUntilTravel', operator: 'gt', expected: () => 72, observed: () => 73, actionType: 'block', actionMessage: 'Adiantamento fora da janela permitida.', parameters: () => ({ maximumHoursBeforeTravel: 72 }), checkpoints: ['request', 'submission'] }),
  simple({ key: 'advance.daily-limit', category: 'advances', title: 'Valor diario de adiantamento', description: 'Encaminha para aprovacao o adiantamento que supera o valor diario permitido.', classification: 'financial_rule', fact: 'finance.advanceDailyAmount', operator: 'gt', expected: p => p.advanceLimit, observed: p => p.advanceLimit + 1, actionType: 'request_approval', actionMessage: 'Valor diario de adiantamento acima do limite.', parameters: p => ({ dailyLimit: p.advanceLimit }), dependencies: [WORKFLOW('advance-exception')], checkpoints: ['submission'] }),
  simple({ key: 'advance.observation', category: 'advances', title: 'Observacao obrigatoria no adiantamento', description: 'Exige justificativa ou observacao quando a regra de adiantamento determinar.', classification: 'financial_rule', fact: 'finance.advanceObservationMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_justification', actionMessage: 'Informe a observacao do adiantamento.', checkpoints: ['request', 'submission'] }),
  simple({ key: 'advance.max-open-reports', category: 'advances', title: 'Limite de prestacoes pendentes', description: 'Bloqueia novo adiantamento quando o viajante excede a quantidade de prestacoes em aberto.', classification: 'financial_rule', fact: 'finance.openExpenseReportCount', operator: 'gt', expected: () => 0, observed: () => 1, actionType: 'block', actionMessage: 'Limite de prestacoes de contas em aberto excedido.', parameters: () => ({ maximumOpenReports: 0 }), checkpoints: ['request', 'submission'] }),
  simple({ key: 'expense.required-for-trip', category: 'expense_reports', title: 'Prestacao obrigatoria por viagem', description: 'Cria a obrigacao de prestacao de contas para toda viagem abrangida pela politica.', classification: 'financial_rule', fact: 'trip.expenseReportRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'create_task', actionMessage: 'Criar tarefa de prestacao de contas apos o retorno.', actionConfiguration: p => ({ dueDays: p.expenseDeadlineDays, taskType: 'expense_report' }), checkpoints: ['post_issuance'] }),
  simple({ key: 'expense.conference', category: 'expense_reports', title: 'Conferencia antes da aprovacao', description: 'Encaminha a prestacao de contas para conferencia antes da aprovacao financeira.', classification: 'workflow', fact: 'expense.conferenceRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_sequential_approval', actionMessage: 'Conferencia financeira obrigatoria antes da aprovacao.', actionConfiguration: () => ({ workflow: 'expense-conference' }), dependencies: [WORKFLOW('expense-conference')], checkpoints: ['expense'] }),
  simple({ key: 'allocation.hierarchy', category: 'allocation', title: 'Hierarquia de centro de custo', description: 'Valida a selecao do centro de custo conforme a hierarquia corporativa configurada.', classification: 'financial_rule', fact: 'finance.costCenterHierarchyValid', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Centro de custo fora da hierarquia permitida.', dependencies: [DIRECTORY('cost-centers')], checkpoints: ['submission', 'expense'] }),
  simple({ key: 'allocation.company-bound', category: 'allocation', title: 'Dimensoes vinculadas a empresa', description: 'Impede centro de custo, projeto ou conta contabil pertencente a outra empresa.', classification: 'financial_rule', fact: 'finance.allocationBelongsToCompany', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'A dimensao de custo nao pertence a empresa selecionada.', dependencies: [DIRECTORY('cost-centers'), DIRECTORY('projects'), DIRECTORY('accounts')], checkpoints: ['submission', 'expense'] }),
  simple({ key: 'allocation.debit-change', category: 'allocation', title: 'Mudanca do debito da viagem', description: 'Encaminha para aprovacao a alteracao de empresa ou centro de custo de debito.', classification: 'financial_rule', fact: 'finance.debitChanged', operator: 'eq', expected: () => true, observed: () => true, actionType: 'route_to_cost_approval', actionMessage: 'Mudanca de debito exige aprovacao de custo.', actionConfiguration: () => ({ workflow: 'debit-change' }), dependencies: [WORKFLOW('debit-change')], checkpoints: ['submission', 'cost_approval'] }),
  simple({ key: 'approval.continuation', category: 'approval', title: 'Continuidade de viagem', description: 'Permite aprovacao automatica de uma continuacao vinculada a viagem previamente aprovada.', classification: 'workflow', fact: 'request.continuationEligible', operator: 'eq', expected: () => true, observed: () => true, actionType: 'auto_approve', actionMessage: 'Continuacao elegivel para aprovacao automatica.', checkpoints: ['submission'] }),
  simple({ key: 'approval.companion', category: 'approval', title: 'Aprovacao por acompanhante', description: 'Exige aprovacao quando a viagem inclui acompanhante conforme a configuracao corporativa.', classification: 'workflow', fact: 'trip.companionApprovalRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'request_approval', actionMessage: 'Viagem com acompanhante exige aprovacao.', dependencies: [WORKFLOW('companion-approval')], checkpoints: ['submission'] }),
  simple({ key: 'approval.secure-email-link', category: 'approval', title: 'Link seguro de aprovacao', description: 'Impede decisao por link quando o token individual esta invalido, expirado ou ja utilizado.', classification: 'authorization', fact: 'approval.secureTokenValid', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Link de aprovacao invalido ou expirado.', risks: ['A decisao exige identidade individual e token de uso unico.'], checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'approval.dual-merit-cost', category: 'approval', title: 'Aprovacao de merito e custo', description: 'Exige aprovacao de merito do viajante e aprovacao de custo da dimensao de debito.', classification: 'workflow', fact: 'approval.dualMeritCostRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_sequential_approval', actionMessage: 'Aprovacoes de merito e custo obrigatorias.', actionConfiguration: () => ({ workflow: 'dual-merit-cost', sequence: ['merit', 'cost'] }), dependencies: [WORKFLOW('dual-merit-cost')], checkpoints: ['submission'] }),
  simple({ key: 'approval.lowest-fare', category: 'approval', title: 'Aprovacao automatica da menor tarifa', description: 'Permite aprovacao automatica quando a opcao selecionada e a menor tarifa elegivel.', classification: 'workflow', fact: 'air.selectedLowestEligibleFare', operator: 'eq', expected: () => true, observed: () => true, actionType: 'auto_approve', actionMessage: 'Menor tarifa elegivel selecionada.', dependencies: [FEATURE('fare-comparison')], checkpoints: ['selection'] }),
  simple({ key: 'approval.traveler-confirmation', category: 'approval', title: 'Confirmacao do viajante master', description: 'Exige confirmacao individual do viajante quando a politica nao permite liberacao automatica.', classification: 'workflow', fact: 'approval.travelerConfirmationPending', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_acceptance', actionMessage: 'Confirmacao do viajante obrigatoria.', checkpoints: ['selection', 'cost_approval'] }),
  simple({ key: 'approval.expiry-deadline', category: 'approval', title: 'Prazo para aprovacao', description: 'Escalona a aprovacao quando o prazo restante nao permite emissao segura.', classification: 'workflow', fact: 'operation.minutesToApprovalDeadline', operator: 'lt', expected: () => 30, observed: () => 15, actionType: 'escalate', actionMessage: 'Prazo de aprovacao em risco.', parameters: () => ({ minimumRemainingMinutes: 30 }), checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'approval.separation-of-duties', category: 'approval', title: 'Separacao de funcoes', description: 'Bloqueia autoaprovacao ou decisao por participante conflitante no processo.', classification: 'authorization', fact: 'approval.separationOfDutiesValid', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Conflito de funcao impede esta decisao.', risks: ['Controle de fraude e segregacao de responsabilidade.'], checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'delegation.required-metadata', category: 'delegation', title: 'Justificativa e vigencia da delegacao', description: 'Impede delegacao sem justificativa, inicio e termino validos.', classification: 'authorization', fact: 'approval.delegationMetadataComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Complete a justificativa e a vigencia da delegacao.', checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'delegation.max-active', category: 'delegation', title: 'Limite de delegados ativos', description: 'Impede que o aprovador exceda a quantidade simultanea de delegacoes permitida.', classification: 'authorization', fact: 'approval.activeDelegationCount', operator: 'gt', expected: () => 1, observed: () => 2, actionType: 'block', actionMessage: 'Quantidade maxima de delegacoes ativas excedida.', parameters: () => ({ maximumActiveDelegations: 1 }), checkpoints: ['merit_approval', 'cost_approval'] }),
  simple({ key: 'communication.status-email', category: 'communication', title: 'Notificacao por mudanca de status', description: 'Dispara comunicacao auditavel aos destinatarios configurados quando o status muda.', classification: 'domain_action', fact: 'operation.statusNotificationRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'notify', actionMessage: 'Enviar notificacao de status.', actionConfiguration: () => ({ channels: ['email', 'in_app'], template: 'travel-status' }), checkpoints: ['quotation', 'reservation', 'issuance', 'post_issuance', 'cancellation'] }),
  simple({ key: 'communication.pdf-attachment', category: 'communication', title: 'Documento da viagem em PDF', description: 'Gera e anexa o documento da viagem somente depois da confirmacao transacional.', classification: 'domain_action', fact: 'operation.pdfDocumentRequired', operator: 'eq', expected: () => true, observed: () => true, actionType: 'create_task', actionMessage: 'Gerar documento PDF da viagem.', actionConfiguration: () => ({ taskType: 'generate_travel_pdf' }), checkpoints: ['post_issuance'] }),
  simple({ key: 'quotation.minimum-offers', category: 'quotation', title: 'Quantidade minima de ofertas', description: 'Exige revisao quando a cotacao nao possui a quantidade minima de ofertas comparaveis.', fact: 'quote.offerCount', operator: 'lt', expected: () => 3, observed: () => 2, actionType: 'require_manual_review', actionMessage: 'Quantidade minima de ofertas nao atingida.', parameters: () => ({ minimumOffers: 3 }), checkpoints: ['quotation', 'selection'] }),
  simple({ key: 'quotation.online-fallback', category: 'quotation', title: 'Tentativas antes do atendimento offline', description: 'Impede encaminhamento offline antes da quantidade minima de tentativas online.', classification: 'workflow', fact: 'quote.offlineRequestedTooEarly', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Realize as tentativas online previstas antes do atendimento offline.', parameters: () => ({ minimumOnlineAttempts: 2 }), checkpoints: ['search', 'quotation'] }),
  simple({ key: 'quotation.assignment-lock', category: 'quotation', title: 'Bloqueio de atendimento concorrente', description: 'Impede alteracao simultanea da mesma cotacao por consultores diferentes.', classification: 'authorization', fact: 'operation.assignmentConflict', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Esta cotacao esta em atendimento por outro consultor.', checkpoints: ['quotation'] }),
  simple({ key: 'emission.online-authorized', category: 'issuance', title: 'Emissao online autorizada', description: 'Impede emissao automatizada por canal ou fornecedor nao autorizado e nao homologado.', classification: 'integration', fact: 'integration.onlineEmissionAllowed', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Emissao online nao autorizada para este canal.', dependencies: [INTEGRATION('travel-provider')], checkpoints: ['issuance'] }),
  simple({ key: 'emission.payment-data', category: 'issuance', title: 'Dados de pagamento para emissao', description: 'Impede emissao quando a forma de pagamento exigida nao esta disponivel ou valida.', classification: 'financial_rule', fact: 'billing.paymentDataComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'prevent_issuance', actionMessage: 'Dados de pagamento incompletos para emissao.', checkpoints: ['issuance'] }),
  simple({ key: 'selection.predefined-reason', category: 'justifications', title: 'Motivo de escolha obrigatorio', description: 'Exige motivo padronizado quando a opcao escolhida viola o criterio comparativo.', fact: 'selection.predefinedReasonMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_predefined_justification', actionMessage: 'Selecione o motivo da escolha.', checkpoints: ['selection'] }),
  simple({ key: 'budget.by-order', category: 'budget', title: 'Orcamento por pedido', description: 'Exige pedido valido e saldo disponivel quando o controle orcamentario opera por pedido.', classification: 'financial_rule', fact: 'finance.orderBudgetMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_budget', actionMessage: 'Informe um pedido com orcamento disponivel.', dependencies: [{ type: 'budget', key: 'order-budget', required: true }], checkpoints: ['issuance'] }),
  simple({ key: 'budget.period-active', category: 'budget', title: 'Vigencia do orcamento', description: 'Bloqueia compromisso fora do periodo de vigencia do orcamento aplicavel.', classification: 'financial_rule', fact: 'finance.budgetPeriodActive', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Orcamento fora da vigencia.', dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['submission', 'reservation', 'issuance'] }),
  simple({ key: 'budget.auto-approval', category: 'budget', title: 'Aprovacao dentro do orcamento', description: 'Permite aprovacao automatica somente quando o saldo e as dimensoes do orcamento sao validos.', classification: 'financial_rule', fact: 'finance.withinBudgetAndDimensions', operator: 'eq', expected: () => true, observed: () => true, actionType: 'auto_approve', actionMessage: 'Operacao dentro do orcamento e elegivel para aprovacao automatica.', dependencies: [{ type: 'budget', key: 'active-budget', required: true }], checkpoints: ['submission', 'cost_approval'] }),
  simple({ key: 'budget.motive-account', category: 'budget', title: 'Conta por motivo de viagem', description: 'Exige conta contabil mapeada para o motivo informado na solicitacao.', classification: 'financial_rule', fact: 'finance.motiveAccountMapped', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_account', actionMessage: 'Motivo de viagem sem conta contabil configurada.', dependencies: [DIRECTORY('accounts')], checkpoints: ['submission', 'expense'] }),
  simple({ key: 'profile.mandatory-fields', category: 'profile', title: 'Campos obrigatorios do viajante', description: 'Impede solicitacao quando os dados obrigatorios do perfil estao incompletos.', fact: 'traveler.mandatoryFieldsComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Complete os dados obrigatorios do viajante.', checkpoints: ['profile', 'request'] }),
  simple({ key: 'profile.document-expiration', category: 'profile', title: 'Vencimento de documentos', description: 'Notifica viajante e responsaveis sobre documento proximo do vencimento.', classification: 'job', fact: 'traveler.documentExpiring', operator: 'eq', expected: () => true, observed: () => true, actionType: 'notify', actionMessage: 'Documento do viajante proximo do vencimento.', actionConfiguration: () => ({ channels: ['email', 'in_app'], leadDays: [180, 90, 60, 30] }), checkpoints: ['profile'] }),
  simple({ key: 'search.air-time-window', category: 'search', title: 'Janela de horario do voo', description: 'Restringe resultados fora da janela de partida ou chegada definida pela empresa.', fact: 'air.withinAllowedTimeWindow', operator: 'eq', expected: () => false, observed: () => false, actionType: 'restrict_search', actionMessage: 'Voo fora da janela de horario permitida.', checkpoints: ['search'] }),
  simple({ key: 'search.air-direct-only', category: 'search', title: 'Somente voos diretos', description: 'Oculta opcoes com conexao quando a politica exige voo direto.', fact: 'air.directRequiredAndMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'hide_offer', actionMessage: 'Opcao com conexao fora da politica.', checkpoints: ['search'] }),
  simple({ key: 'search.nearby-airports', category: 'search', title: 'Aeroportos proximos', description: 'Inclui aeroportos proximos dentro do raio configurado para ampliar alternativas validas.', fact: 'air.nearbyAirportOffer', operator: 'eq', expected: () => true, observed: () => true, actionType: 'rank_offer', actionMessage: 'Alternativa em aeroporto proximo disponivel.', actionConfiguration: () => ({ maximumDistanceKm: 100 }), checkpoints: ['search'] }),
  simple({ key: 'search.baggage-restriction', category: 'search', title: 'Restricao de bagagem', description: 'Impede selecao de tarifa de bagagem incompatível com a duracao e a politica da viagem.', fact: 'air.baggagePolicyViolation', operator: 'eq', expected: () => true, observed: () => true, actionType: 'hide_offer', actionMessage: 'Tarifa com bagagem fora da politica.', checkpoints: ['search', 'selection'] }),
  simple({ key: 'reservation.minimum-advance', category: 'reservation', title: 'Antecedencia para reserva online', description: 'Impede reserva online quando a antecedencia minima do produto nao foi atendida.', fact: 'reservation.minimumAdvanceMet', operator: 'eq', expected: () => false, observed: () => false, actionType: 'hold_booking', actionMessage: 'Antecedencia insuficiente para reserva online.', checkpoints: ['reservation'] }),
  simple({ key: 'security.password-minimum', category: 'security', title: 'Tamanho minimo de senha', description: 'Impede definicao de senha abaixo do tamanho minimo corporativo.', classification: 'authorization', fact: 'security.passwordLength', operator: 'lt', expected: () => 12, observed: () => 8, actionType: 'block', actionMessage: 'A senha nao atende ao tamanho minimo.', parameters: () => ({ minimumLength: 12 }), risks: ['Regra minima; o provedor de identidade pode exigir controles adicionais.'], checkpoints: ['profile'] }),
  simple({ key: 'request.max-travelers', category: 'requests', title: 'Quantidade maxima de viajantes', description: 'Impede solicitacao com quantidade de viajantes superior ao limite configurado.', fact: 'request.travelerCount', operator: 'gt', expected: () => 5, observed: () => 6, actionType: 'block', actionMessage: 'Quantidade maxima de viajantes excedida.', parameters: () => ({ maximumTravelers: 5 }), checkpoints: ['request', 'submission'] }),
  simple({ key: 'request.policy-acceptance', category: 'requests', title: 'Aceite da politica de viagem', description: 'Exige aceite explicito e auditavel das regras aplicaveis antes do envio.', fact: 'request.policyAccepted', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_acceptance', actionMessage: 'Aceite a politica de viagem para continuar.', checkpoints: ['request', 'submission'] }),
  simple({ key: 'request.duplicate-permission', category: 'requests', title: 'Permissao para duplicar solicitacao', description: 'Impede duplicacao quando o perfil ou o estado da solicitacao nao permite a acao.', classification: 'authorization', fact: 'request.duplicateRequestedWithoutPermission', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Duplicacao de solicitacao nao permitida.', checkpoints: ['request'] }),
  simple({ key: 'request.outside-business-hours', category: 'requests', title: 'Solicitacao fora do horario util', description: 'Alerta e comunica quando a solicitacao e criada fora do horario de atendimento.', classification: 'workflow', fact: 'request.outsideBusinessHours', operator: 'eq', expected: () => true, observed: () => true, actionType: 'warn', actionMessage: 'Solicitacao registrada fora do horario util.', actionConfiguration: () => ({ notify: true, calendar: 'agency-business-hours' }), checkpoints: ['request', 'submission'] }),
  simple({ key: 'request.service-enabled', category: 'requests', title: 'Produto habilitado para solicitacao', description: 'Impede solicitacao de produto que nao esta habilitado para o escopo corporativo.', fact: 'request.serviceEnabled', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Produto nao habilitado para esta empresa.', checkpoints: ['request'] }),
  simple({ key: 'request.consultant-required', category: 'requests', title: 'Consultor responsavel', description: 'Exige selecao ou distribuicao automatica de consultor quando o fluxo determinar.', classification: 'workflow', fact: 'operation.consultantRequiredAndMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_manual_review', actionMessage: 'Defina o consultor responsavel pela solicitacao.', dependencies: [FEATURE('consultant-assignment')], checkpoints: ['submission', 'quotation'] }),
  simple({ key: 'billing.split', category: 'billing', title: 'Separacao de faturamento', description: 'Exige que todas as linhas de faturamento estejam completas e conciliadas antes da emissao.', classification: 'financial_rule', fact: 'billing.splitComplete', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_cost_allocation', actionMessage: 'Complete a separacao de faturamento.', checkpoints: ['issuance'] }),
  simple({ key: 'billing.fee-disclosure', category: 'billing', title: 'Exibicao de fee', description: 'Exige apresentacao do fee ao solicitante nos estados definidos pela politica.', classification: 'financial_rule', fact: 'billing.feeDisclosurePending', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_acceptance', actionMessage: 'Confirme a ciencia do fee apresentado.', checkpoints: ['selection', 'cost_approval', 'issuance'] }),
  simple({ key: 'itinerary.composite', category: 'requests', title: 'Reserva aerea composta', description: 'Valida passageiros e associacao pai-filho em solicitacao aerea composta.', fact: 'request.compositeReservationInvalid', operator: 'eq', expected: () => true, observed: () => true, actionType: 'block', actionMessage: 'Configuracao invalida da reserva composta.', checkpoints: ['request', 'reservation'] }),
  simple({ key: 'cancellation.online-failure', category: 'cancellation', title: 'Falha de reserva online', description: 'Cria atendimento offline auditavel depois de falha confirmada na reserva online.', classification: 'workflow', fact: 'reservation.onlineFailureConfirmed', operator: 'eq', expected: () => true, observed: () => true, actionType: 'create_task', actionMessage: 'Criar atendimento offline para a reserva.', actionConfiguration: () => ({ taskType: 'offline-quotation' }), checkpoints: ['reservation'] }),
  simple({ key: 'traveler.preferred-seat', category: 'profile', title: 'Assento preferencial', description: 'Solicita marcacao do assento disponivel conforme a preferencia cadastrada do viajante.', classification: 'domain_action', fact: 'air.preferredSeatAvailable', operator: 'eq', expected: () => true, observed: () => true, actionType: 'create_task', actionMessage: 'Marcar assento preferencial do viajante.', actionConfiguration: () => ({ taskType: 'preferred-seat' }), checkpoints: ['reservation'] }),
  simple({ key: 'modules.advance', category: 'modules', title: 'Modulo de adiantamento', description: 'Impede operacao de adiantamento quando o modulo nao esta habilitado para a empresa.', classification: 'authorization', fact: 'feature.advanceEnabled', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Modulo de adiantamento nao habilitado.', dependencies: [FEATURE('advances')], checkpoints: ['request', 'submission'] }),
  simple({ key: 'modules.reimbursement', category: 'modules', title: 'Modulo de reembolso', description: 'Impede operacao de reembolso quando o modulo nao esta habilitado para a empresa.', classification: 'authorization', fact: 'feature.reimbursementEnabled', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Modulo de reembolso nao habilitado.', dependencies: [FEATURE('reimbursement')], checkpoints: ['expense'] }),
  simple({ key: 'modules.services', category: 'modules', title: 'Modulo de servicos', description: 'Impede solicitacao de servicos complementares quando o modulo nao esta habilitado.', classification: 'authorization', fact: 'feature.servicesEnabled', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Modulo de servicos nao habilitado.', dependencies: [FEATURE('services')], checkpoints: ['request'] }),
  simple({ key: 'integration.unflown-ticket', category: 'integrations', title: 'Bilhete nao voado', description: 'Cria tarefa de acompanhamento quando a integracao identifica bilhete nao utilizado.', classification: 'integration', fact: 'ticket.unflownDetected', operator: 'eq', expected: () => true, observed: () => true, actionType: 'create_task', actionMessage: 'Analisar bilhete nao voado.', actionConfiguration: () => ({ taskType: 'unflown-ticket' }), dependencies: [INTEGRATION('ticket-status')], checkpoints: ['post_issuance'] }),
  simple({ key: 'integration.parent-request-order', category: 'integrations', title: 'Ordem de exportacao pai-filho', description: 'Retem exportacao da continuacao ate que a solicitacao pai esteja em estado terminal valido.', classification: 'integration', fact: 'integration.parentRequestReady', operator: 'eq', expected: () => false, observed: () => false, actionType: 'require_manual_review', actionMessage: 'Solicitacao pai ainda nao pode ser exportada.', checkpoints: ['post_issuance'] }),
  simple({ key: 'reimbursement.tax-field', category: 'reimbursement', title: 'Campo fiscal do reembolso', description: 'Exige os dados fiscais adicionais configurados para reembolso e prestacao de contas.', classification: 'financial_rule', fact: 'expense.taxFieldRequiredAndMissing', operator: 'eq', expected: () => true, observed: () => true, actionType: 'require_manual_review', actionMessage: 'Complete os dados fiscais da despesa.', checkpoints: ['expense'] }),
  simple({ key: 'payment.card-exclusive', category: 'cards', title: 'Cartao corporativo exclusivo', description: 'Exige o cartao corporativo quando ele e a forma de pagamento obrigatoria do viajante.', classification: 'financial_rule', fact: 'finance.requiredCardMismatch', operator: 'eq', expected: () => true, observed: () => true, actionType: 'enforce_payment_method', actionMessage: 'Utilize o cartao corporativo vinculado ao viajante.', checkpoints: ['reservation', 'issuance', 'expense'] }),
  simple({ key: 'expense.account-restricted', category: 'expense_reports', title: 'Conta contabil da despesa', description: 'Impede lancamento de despesa em conta contabil incompatível com a solicitacao.', classification: 'financial_rule', fact: 'expense.accountMatchesRequest', operator: 'eq', expected: () => false, observed: () => false, actionType: 'block', actionMessage: 'Tipo de despesa incompatível com a conta contabil da solicitacao.', checkpoints: ['expense'] }),
] as const

const ARGO_REFERENCES_BY_FAMILY: Readonly<Record<string, readonly string[]>> = {
  'advance.auto-approve-budget': ['ARGO:APRORC'],
  'advance.request-window': ['ARGO:ANTADI'],
  'advance.daily-limit': ['ARGO:VLAPAD'],
  'advance.observation': ['ARGO:OBRJUS'],
  'advance.max-open-reports': ['ARGO:BADTPR'],
  'advance.pending': ['ARGO:BADTPR'],
  'expense.required-for-trip': ['ARGO:MODDES'],
  'expense.conference': ['ARGO:MODREE'],
  'allocation.hierarchy': ['ARGO:CCUSUB', 'ARGO:CCUPAI'],
  'allocation.company-bound': ['ARGO:EMPCCU', 'ARGO:EMPPRO', 'ARGO:EMPCON'],
  'allocation.debit-change': ['ARGO:MUDDEB'],
  'allocation.total': ['ARGO:APRRAT'],
  'cost-center.required': ['ARGO:EMPCUS', 'ARGO:OBRCAM'],
  'project.required': ['ARGO:PROCUS', 'ARGO:OBRCAM'],
  'account.required': ['ARGO:CONCUS', 'ARGO:OBRCAM'],
  'approval.continuation': ['ARGO:EXPCON'],
  'approval.companion': ['ARGO:COMVIA'],
  'approval.secure-email-link': ['ARGO:APREMA', 'ARGO:CODAUT'],
  'approval.dual-merit-cost': ['ARGO:VIACCU', 'ARGO:APRMER', 'ARGO:MUDAPR', 'ARGO:TRAAPR', 'ARGO:DESMER'],
  'approval.lowest-fare': ['ARGO:VALAER'],
  'approval.traveler-confirmation': ['ARGO:MASESC', 'ARGO:MASAPR'],
  'approval.expiry-deadline': ['ARGO:TEMMIN', 'ARGO:PERAPR'],
  'approval.separation-of-duties': ['ARGO:COSESI', 'ARGO:USUAGE'],
  'approval.amount': ['ARGO:APVLAE', 'ARGO:VALGER'],
  'authority.executive': ['ARGO:ADIALC', 'ARGO:ESTALC', 'ARGO:TROALC'],
  'delegation.required-metadata': ['ARGO:DELEGA', 'ARGO:DELSOL', 'ARGO:CADDEL'],
  'delegation.max-active': ['ARGO:DELEGA'],
  'communication.status-email': ['ARGO:EMAAPR', 'ARGO:EMACOT', 'ARGO:EMAVIA', 'ARGO:EMIAUT', 'ARGO:SEMAVI', 'ARGO:AGEALE', 'ARGO:ALESER', 'ARGO:NOTHOS'],
  'communication.pdf-attachment': ['ARGO:EMAPDF', 'ARGO:COAUTP'],
  'quotation.minimum-offers': ['ARGO:OFEAER', 'ARGO:OFEHOS', 'ARGO:OFELOC', 'ARGO:CALQTD'],
  'quotation.online-fallback': ['ARGO:QTDPES', 'ARGO:COTFHO', 'ARGO:COTFLO', 'ARGO:COTFRO', 'ARGO:COTAGE', 'ARGO:AGEESC'],
  'quotation.assignment-lock': ['ARGO:BLOCOT', 'ARGO:DISATE'],
  'emission.online-authorized': ['ARGO:EMICLI', 'ARGO:EMIAER', 'ARGO:EMIAZU', 'ARGO:EMIGOL', 'ARGO:EMITER', 'ARGO:RESEMI'],
  'emission.payment-data': ['ARGO:CADCAR'],
  'selection.predefined-reason': ['ARGO:JUSCON', 'ARGO:JUSESC', 'ARGO:JUSHOR', 'ARGO:JUSHOS', 'ARGO:JUSLIS', 'ARGO:JUSLOC', 'ARGO:JUSMIN', 'ARGO:JUSPER', 'ARGO:JUSPRO', 'ARGO:JUSROD', 'ARGO:JUSTRA', 'ARGO:JUSTIF'],
  'budget.by-order': ['ARGO:ORCPED'],
  'budget.period-active': ['ARGO:PERORC', 'ARGO:ORCANU', 'ARGO:ORCPAI'],
  'budget.auto-approval': ['ARGO:APRORC'],
  'budget.motive-account': ['ARGO:ORCMOT'],
  'profile.mandatory-fields': ['ARGO:OBRTEL'],
  'profile.document-expiration': ['ARGO:OBRTEL'],
  'search.air-time-window': ['ARGO:RANAER', 'ARGO:MUDRAN', 'ARGO:AERSAI', 'ARGO:AERCHE', 'ARGO:AERPER', 'ARGO:PERVIA'],
  'search.air-direct-only': ['ARGO:VOODIR', 'ARGO:PESAER'],
  'search.nearby-airports': ['ARGO:AERPRO'],
  'air.class': ['ARGO:TRAN_I', 'ARGO:TRAN_N', 'ARGO:TRAN_T'],
  'air.lowest-fare': ['ARGO:CIAPRE'],
  'hotel.daily': ['ARGO:HOTCOT', 'ARGO:VALHOS'],
  'hotel.preferred': ['ARGO:HOTFIL'],
  'search.baggage-restriction': ['ARGO:EXITAR'],
  'reservation.minimum-advance': ['ARGO:RESAER', 'ARGO:RESHOS', 'ARGO:RESLOC', 'ARGO:VIALOC'],
  'security.password-minimum': ['ARGO:TAMSEN'],
  'request.max-travelers': ['ARGO:MAXPES', 'ARGO:RESCOM', 'ARGO:RESMUL'],
  'request.policy-acceptance': ['ARGO:CIENTE', 'ARGO:ACEREG'],
  'request.duplicate-permission': ['ARGO:DUPLOS', 'ARGO:CANOFF'],
  'request.outside-business-hours': ['ARGO:AGEUTI', 'ARGO:CLIUTI', 'ARGO:ALEPER'],
  'request.service-enabled': ['ARGO:MODSER', 'ARGO:HOSCLI', 'ARGO:HOSDIR', 'ARGO:HOTOFF', 'ARGO:SOLABE'],
  'request.consultant-required': ['ARGO:DISATE', 'ARGO:POSATE'],
  'profile.complete': ['ARGO:CADSOL', 'ARGO:PERSOL'],
  'billing.split': ['ARGO:BLOLAN', 'ARGO:LANRET', 'ARGO:SEGMAS', 'ARGO:SEGPAR'],
  'billing.fee-disclosure': ['ARGO:TAXBIL'],
  'itinerary.composite': ['ARGO:RESCOM'],
  'cancellation.online-failure': ['ARGO:CANOFF', 'ARGO:REPESC'],
  'expiration.hold': ['ARGO:CANEXP', 'ARGO:EXPHOS', 'ARGO:EXPLOC'],
  'traveler.preferred-seat': ['ARGO:PREVOO'],
  'modules.advance': ['ARGO:MODADI'],
  'modules.reimbursement': ['ARGO:MODREE'],
  'modules.services': ['ARGO:MODSER'],
  'integration.unflown-ticket': ['ARGO:NAOVOA', 'ARGO:STABIL'],
  'integration.parent-request-order': ['ARGO:EXPCON', 'ARGO:ESTLIS', 'ARGO:LISSOL'],
  'integration.homologated': ['ARGO:CMNET', 'ARGO:DIRONL', 'ARGO:ROBEMI'],
  'reimbursement.tax-field': ['ARGO:CAMADI'],
  'payment.card-exclusive': ['ARGO:CADCAR'],
  'expense.account-restricted': ['ARGO:CONCUS'],
  'sla.quote': ['ARGO:SLAATE'],
  'reservation.validity': ['ARGO:RESEMI'],
}

export function buildPolicyTemplateCatalog(): PolicyTemplateConfiguration[] {
  return POLICY_SEGMENT_PROFILES.flatMap((profile) => BLUEPRINTS.map((blueprint) => buildTemplate(profile, blueprint)))
}

export function policyTemplateFamilyCount(): number {
  return BLUEPRINTS.length
}

export function policyTemplateCategoryCount(): number {
  return new Set(BLUEPRINTS.map((blueprint) => blueprint.category)).size
}

function buildTemplate(profile: PolicySegmentProfile, blueprint: TemplateBlueprint): PolicyTemplateConfiguration {
  const condition: PolicyExpression = {
    all: [
      { fact: 'company.segment', operator: 'eq', value: profile.key },
      blueprint.condition(profile),
    ],
  }
  const actions = blueprint.actions(profile)
  const parameters = blueprint.parameters(profile)
  const semantic = {
    familyKey: blueprint.key,
    category: blueprint.category,
    segment: profile.key,
    classification: blueprint.classification,
    condition,
    actions,
    parameters,
    dependencies: blueprint.dependencies,
    risks: blueprint.risks,
    checkpoints: blueprint.checkpoints,
    benchmarkReferences: ARGO_REFERENCES_BY_FAMILY[blueprint.key] || [],
  }
  return {
    templateKey: `${profile.key}.${blueprint.key}.v1`,
    familyKey: blueprint.key,
    version: 1,
    name: `${blueprint.title} - ${profile.name}`,
    description: `${blueprint.description} Configuracao inicial para o segmento ${profile.name}.`,
    category: blueprint.category,
    segment: profile.key,
    segmentName: profile.name,
    classification: blueprint.classification,
    condition,
    actions,
    parameters,
    dependencies: blueprint.dependencies,
    risks: blueprint.risks,
    checkpoints: blueprint.checkpoints,
    benchmarkReferences: [...(ARGO_REFERENCES_BY_FAMILY[blueprint.key] || [])],
    sampleFacts: { 'company.segment': profile.key, ...blueprint.sampleFacts(profile) },
    expectedActions: actions.map((action) => action.type),
    contentHash: sha256(semantic),
  }
}

function simple(input: SimpleBlueprintInput): TemplateBlueprint {
  return {
    key: input.key,
    category: input.category,
    title: input.title,
    description: input.description,
    classification: input.classification || 'generic_policy',
    condition: profile => ({ fact: input.fact, operator: input.operator, value: input.expected(profile) }),
    actions: profile => [{
      type: input.actionType,
      message: input.actionMessage,
      remediation: input.remediation,
      configuration: input.actionConfiguration?.(profile),
    }],
    sampleFacts: profile => ({ [input.fact]: input.observed(profile) }),
    parameters: input.parameters || (() => ({})),
    dependencies: input.dependencies || [],
    risks: input.risks || [],
    checkpoints: input.checkpoints,
  }
}

function percentageRule(
  key: string,
  category: string,
  title: string,
  description: string,
  observedFact: string,
  referenceFact: string,
  tolerance: (profile: PolicySegmentProfile) => number,
  actionType: PolicyAction['type'],
  message: string,
  checkpoints: string[],
  dependencies: PolicyTemplateDependency[],
): TemplateBlueprint {
  return {
    key, category, title, description, classification: 'generic_policy', checkpoints, dependencies, risks: [],
    condition: profile => ({ fact: observedFact, operator: 'outside_percentage', valueFrom: referenceFact, options: { tolerancePct: tolerance(profile) } }),
    actions: profile => [{ type: actionType, message, configuration: { tolerancePct: tolerance(profile) } }],
    sampleFacts: profile => ({ [observedFact]: 1_000 * (1 + (tolerance(profile) + 1) / 100), [referenceFact]: 1_000 }),
    parameters: profile => ({ tolerancePct: tolerance(profile) }),
  }
}

function segment(
  key: string,
  name: string,
  approvalAmount: number,
  executiveAmount: number,
  budgetWarningPct: number,
  budgetBlockPct: number,
  airTolerancePct: number,
  airAdvanceDays: number,
  hotelDailyLimit: number,
  hotelDistanceKm: number,
  carDailyLimit: number,
  serviceLimit: number,
  advanceLimit: number,
  expenseDeadlineDays: number,
  reimbursementDeadlineDays: number,
  cardLimit: number,
  cancellationPenaltyPct: number,
  reservationHoldMinutes: number,
  quoteSlaMinutes: number,
  co2LimitKg: number,
  riskLevel: PolicySegmentProfile['riskLevel'],
): PolicySegmentProfile {
  return {
    key, name, approvalAmount, executiveAmount, budgetWarningPct, budgetBlockPct,
    airTolerancePct, airAdvanceDays, hotelDailyLimit, hotelDistanceKm,
    carDailyLimit, serviceLimit, advanceLimit, expenseDeadlineDays,
    reimbursementDeadlineDays, cardLimit, cancellationPenaltyPct,
    reservationHoldMinutes, quoteSlaMinutes, co2LimitKg, riskLevel,
  }
}
