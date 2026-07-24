export interface WorkflowDomainCommandDefinition {
  key: string
  label: string
  description: string
  requiredPermission: string
  resource: string
  action: string
  critical: boolean
  compensationRequired: boolean
  subjectTypes: string[]
}

const lifecycleCommands: Array<{
  command: string
  label: string
  permission: string
  critical?: boolean
  compensationRequired?: boolean
}> = [
  { command: 'submit', label: 'Enviar solicitação', permission: 'criar_demandas' },
  { command: 'request_merit_approval', label: 'Solicitar aprovação de mérito', permission: 'aprovar_demandas' },
  { command: 'approve_merit', label: 'Concluir aprovação de mérito', permission: 'decidir_aprovacoes' },
  { command: 'start_quotation', label: 'Iniciar cotação', permission: 'operar_cotacoes' },
  { command: 'complete_quotation', label: 'Concluir cotação', permission: 'operar_cotacoes' },
  { command: 'select_offer', label: 'Selecionar oferta', permission: 'operar_cotacoes' },
  { command: 'request_cost_approval', label: 'Solicitar aprovação de custo', permission: 'aprovar_demandas' },
  { command: 'approve_cost', label: 'Concluir aprovação de custo', permission: 'decidir_aprovacoes' },
  {
    command: 'start_reservation',
    label: 'Iniciar reserva',
    permission: 'operar_reservas',
    critical: true,
    compensationRequired: true,
  },
  {
    command: 'confirm_reservation',
    label: 'Confirmar reserva',
    permission: 'operar_reservas',
    critical: true,
    compensationRequired: true,
  },
  { command: 'queue_issuance', label: 'Enviar para emissão', permission: 'operar_emissoes' },
  {
    command: 'start_issuance',
    label: 'Iniciar emissão',
    permission: 'operar_emissoes',
    critical: true,
    compensationRequired: true,
  },
  {
    command: 'complete_issuance',
    label: 'Concluir emissão',
    permission: 'operar_emissoes',
    critical: true,
    compensationRequired: true,
  },
  {
    command: 'complete_partial_issuance',
    label: 'Concluir emissão parcial',
    permission: 'operar_emissoes',
    critical: true,
    compensationRequired: true,
  },
  { command: 'reject', label: 'Rejeitar solicitação', permission: 'aprovar_demandas' },
  {
    command: 'cancel',
    label: 'Cancelar viagem',
    permission: 'operar_cancelamentos',
    critical: true,
    compensationRequired: true,
  },
  { command: 'expire', label: 'Expirar solicitação', permission: 'executar_workflows' },
  { command: 'fail', label: 'Registrar falha operacional', permission: 'executar_workflows' },
  {
    command: 'request_refund',
    label: 'Solicitar reembolso',
    permission: 'editar_financeiro',
    critical: true,
    compensationRequired: true,
  },
  {
    command: 'confirm_refund',
    label: 'Confirmar reembolso',
    permission: 'editar_financeiro',
    critical: true,
    compensationRequired: true,
  },
  { command: 'close', label: 'Encerrar viagem', permission: 'executar_workflows' },
]

export const WORKFLOW_DOMAIN_COMMANDS: readonly WorkflowDomainCommandDefinition[] = [
  {
    key: 'workflow.notification.enqueue',
    label: 'Enfileirar notificação',
    description: 'Registra uma notificação no outbox transacional para entrega assíncrona.',
    requiredPermission: 'executar_workflows',
    resource: 'workflows',
    action: 'execute',
    critical: false,
    compensationRequired: false,
    subjectTypes: ['demand', 'reservation', 'employee', 'company', 'generic'],
  },
  {
    key: 'workflow.incident.open',
    label: 'Abrir incidente operacional',
    description: 'Registra uma solicitação idempotente de abertura de incidente no outbox.',
    requiredPermission: 'executar_workflows',
    resource: 'workflows',
    action: 'execute',
    critical: false,
    compensationRequired: false,
    subjectTypes: ['demand', 'reservation', 'integration', 'workflow_execution', 'generic'],
  },
  ...lifecycleCommands.map((item) => ({
    key: `travel.lifecycle.${item.command}`,
    label: item.label,
    description: `Executa o comando autorizado ${item.command} no ciclo de vida da viagem.`,
    requiredPermission: item.permission,
    resource: 'demands',
    action: item.command === 'cancel' ? 'cancel' : 'update',
    critical: item.critical === true,
    compensationRequired: item.compensationRequired === true,
    subjectTypes: ['demand'],
  })),
]

const commandByKey = new Map(WORKFLOW_DOMAIN_COMMANDS.map((command) => [command.key, command]))

export function getWorkflowDomainCommand(key: string): WorkflowDomainCommandDefinition | null {
  return commandByKey.get(key) || null
}
