'use client'

import { Copy, Trash2 } from 'lucide-react'

import { WORKFLOW_DOMAIN_COMMANDS } from '@/lib/workflows/command-catalog'
import type {
  EnterpriseWorkflowNode,
  EnterpriseWorkflowNodeType,
} from '@/lib/workflows/types'
import { workflowNodeTypeLabel } from '@/components/workflows/workflow-visual-canvas'

const NODE_TYPES: EnterpriseWorkflowNodeType[] = [
  'start',
  'sequence',
  'human_task',
  'automatic_task',
  'condition',
  'decision',
  'domain_command',
  'service_call',
  'integration_call',
  'timer',
  'wait',
  'parallel_split',
  'parallel_join',
  'quorum',
  'sla',
  'escalation',
  'fallback',
  'retry',
  'compensation',
  'subworkflow',
  'approval',
  'fault_handler',
  'end',
]

const WORKFLOW_PERMISSIONS = [
  'criar_demandas',
  'ver_demandas',
  'aprovar_demandas',
  'ver_reservas',
  'operar_cotacoes',
  'operar_reservas',
  'operar_emissoes',
  'operar_cancelamentos',
  'ver_financeiro',
  'editar_financeiro',
  'decidir_aprovacoes',
  'executar_workflows',
  'gerenciar_integracoes',
]

interface WorkflowNodeInspectorProps {
  node: EnterpriseWorkflowNode
  readOnly?: boolean
  onChange: (node: EnterpriseWorkflowNode) => void
  onDuplicate: () => void
  onDelete: () => void
}

export function WorkflowNodeInspector({
  node,
  readOnly = false,
  onChange,
  onDuplicate,
  onDelete,
}: WorkflowNodeInspectorProps) {
  const configuration = node.configuration

  function patchNode(patch: Partial<EnterpriseWorkflowNode>) {
    onChange({ ...node, ...patch })
  }

  function patchConfiguration(key: string, value: unknown) {
    const next = { ...configuration }
    if (value === '' || value === undefined || value === null) delete next[key]
    else next[key] = value
    patchNode({ configuration: next })
  }

  function patchAssignment(key: 'type' | 'value', value: string) {
    const assignment = recordValue(configuration.assignment)
    const next = { ...assignment, [key]: value }
    if (!value) delete next[key]
    patchConfiguration('assignment', next)
  }

  return (
    <aside className="space-y-4" aria-label="Propriedades do nó">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Nó selecionado</p>
          <h3 className="mt-1 text-sm font-bold text-bbt-primary dark:text-white">{node.name}</h3>
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <button
              type="button"
              className="bbt-button-ghost h-9 w-9 justify-center p-0"
              onClick={onDuplicate}
              title="Duplicar nó"
              aria-label="Duplicar nó"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="bbt-button-ghost h-9 w-9 justify-center p-0 text-red-600"
              onClick={onDelete}
              title="Excluir nó"
              aria-label="Excluir nó"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <Field label="Nome">
        <input
          value={node.name}
          onChange={(event) => patchNode({ name: event.target.value })}
          className="bbt-input w-full"
          disabled={readOnly}
          maxLength={240}
        />
      </Field>

      <Field label="Chave técnica">
        <input
          value={node.key}
          onChange={(event) => patchNode({ key: normalizeKey(event.target.value) })}
          className="bbt-input w-full font-mono text-xs"
          disabled={readOnly}
          maxLength={120}
        />
      </Field>

      <Field label="Tipo">
        <select
          value={node.type}
          onChange={(event) => patchNode({
            type: event.target.value as EnterpriseWorkflowNodeType,
            configuration: defaultWorkflowNodeConfiguration(event.target.value as EnterpriseWorkflowNodeType),
          })}
          className="bbt-input w-full"
          disabled={readOnly || node.type === 'start' || node.type === 'end'}
        >
          {NODE_TYPES.map((type) => (
            <option key={type} value={type}>{workflowNodeTypeLabel(type)}</option>
          ))}
        </select>
      </Field>

      <Field label="Descrição">
        <textarea
          value={node.description || ''}
          onChange={(event) => patchNode({ description: event.target.value })}
          className="bbt-input min-h-20 w-full resize-y"
          disabled={readOnly}
          maxLength={2_000}
        />
      </Field>

      {node.type === 'human_task' && (
        <>
          <Field label="Responsável">
            <select
              value={textValue(recordValue(configuration.assignment).type) || 'role'}
              onChange={(event) => patchAssignment('type', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
            >
              <option value="role">Perfil</option>
              <option value="user">Usuário específico</option>
              <option value="manager">Gestor da pessoa</option>
              <option value="requester">Solicitante</option>
              <option value="company_role">Perfil da empresa</option>
            </select>
          </Field>
          {['role', 'user', 'company_role'].includes(
            textValue(recordValue(configuration.assignment).type) || 'role',
          ) && (
            <Field label="Identificador do responsável">
              <input
                value={textValue(recordValue(configuration.assignment).value)}
                onChange={(event) => patchAssignment('value', event.target.value)}
                className="bbt-input w-full"
                disabled={readOnly}
                placeholder="Ex.: financial_manager"
              />
            </Field>
          )}
          <PermissionField
            value={textValue(configuration.requiredPermission)}
            disabled={readOnly}
            onChange={(value) => patchConfiguration('requiredPermission', value)}
          />
        </>
      )}

      {node.type === 'automatic_task' && (
        <>
          <Field label="Operação determinística">
            <select
              value={textValue(configuration.operation) || 'set_variable'}
              onChange={(event) => patchConfiguration('operation', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
            >
              <option value="set_variable">Definir variável</option>
              <option value="copy_value">Copiar valor</option>
              <option value="calculate_expression">Calcular expressão</option>
              <option value="format_value">Formatar valor</option>
            </select>
          </Field>
          <Field label="Destino">
            <input
              value={textValue(configuration.targetPath)}
              onChange={(event) => patchConfiguration('targetPath', event.target.value)}
              className="bbt-input w-full font-mono text-xs"
              disabled={readOnly}
              placeholder="variables.nome"
            />
          </Field>
          {textValue(configuration.operation) !== 'set_variable' && (
            <Field label="Origem">
              <input
                value={textValue(configuration.sourcePath)}
                onChange={(event) => patchConfiguration('sourcePath', event.target.value)}
                className="bbt-input w-full font-mono text-xs"
                disabled={readOnly}
                placeholder="facts.campo"
              />
            </Field>
          )}
          {textValue(configuration.operation) === 'set_variable' && (
            <Field label="Valor">
              <input
                value={String(configuration.value ?? '')}
                onChange={(event) => patchConfiguration('value', parseScalar(event.target.value))}
                className="bbt-input w-full"
                disabled={readOnly}
              />
            </Field>
          )}
        </>
      )}

      {(node.type === 'domain_command' || node.type === 'compensation') && (
        <>
          <Field label="Comando de domínio">
            <select
              value={textValue(configuration.commandKey)}
              onChange={(event) => patchConfiguration('commandKey', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
            >
              <option value="">Selecione</option>
              {WORKFLOW_DOMAIN_COMMANDS.map((command) => (
                <option key={command.key} value={command.key}>{command.label}</option>
              ))}
            </select>
          </Field>
          {node.type === 'domain_command' && (
            <Field label="Comando de compensação">
              <select
                value={textValue(configuration.compensationCommandKey)}
                onChange={(event) => patchConfiguration('compensationCommandKey', event.target.value)}
                className="bbt-input w-full"
                disabled={readOnly}
              >
                <option value="">Usar caminho de compensação</option>
                {WORKFLOW_DOMAIN_COMMANDS.map((command) => (
                  <option key={command.key} value={command.key}>{command.label}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}

      {(node.type === 'service_call' || node.type === 'integration_call') && (
        <>
          <Field label="Provedor registrado">
            <input
              value={textValue(configuration.providerKey)}
              onChange={(event) => patchConfiguration('providerKey', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
              placeholder="Ex.: tech_travel"
            />
          </Field>
          <Field label="Operação">
            <input
              value={textValue(configuration.operation)}
              onChange={(event) => patchConfiguration('operation', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
              placeholder="Ex.: create_reservation"
            />
          </Field>
          <Field label="Escopo de idempotência">
            <input
              value={textValue(configuration.idempotencyScope)}
              onChange={(event) => patchConfiguration('idempotencyScope', event.target.value)}
              className="bbt-input w-full"
              disabled={readOnly}
              placeholder="execution_step"
            />
          </Field>
          <NumberField
            label="Máximo de tentativas"
            value={numberValue(configuration.maxAttempts, 3)}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(value) => patchConfiguration('maxAttempts', value)}
          />
        </>
      )}

      {['timer', 'wait', 'sla'].includes(node.type) && (
        <NumberField
          label="Duração em minutos"
          value={numberValue(configuration.durationMinutes, 30)}
          min={1}
          max={525_600}
          disabled={readOnly}
          onChange={(value) => patchConfiguration('durationMinutes', value)}
        />
      )}

      {node.type === 'retry' && (
        <NumberField
          label="Máximo de tentativas"
          value={numberValue(configuration.maxAttempts, 3)}
          min={1}
          max={10}
          disabled={readOnly}
          onChange={(value) => patchConfiguration('maxAttempts', value)}
        />
      )}

      {node.type === 'quorum' && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Necessários"
            value={numberValue(configuration.required, 1)}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(value) => patchConfiguration('required', value)}
          />
          <NumberField
            label="Total"
            value={numberValue(configuration.total, 1)}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(value) => patchConfiguration('total', value)}
          />
        </div>
      )}

      {node.type === 'subworkflow' && (
        <Field label="Código do subworkflow">
          <input
            value={textValue(configuration.workflowCode)}
            onChange={(event) => patchConfiguration('workflowCode', normalizeKey(event.target.value))}
            className="bbt-input w-full font-mono text-xs"
            disabled={readOnly}
          />
        </Field>
      )}

      {node.type === 'approval' && (
        <Field label="Workflow de aprovação">
          <input
            value={textValue(configuration.approvalWorkflowCode)}
            onChange={(event) => patchConfiguration('approvalWorkflowCode', normalizeKey(event.target.value))}
            className="bbt-input w-full font-mono text-xs"
            disabled={readOnly}
          />
        </Field>
      )}
    </aside>
  )
}

function PermissionField({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field label="Permissão necessária">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bbt-input w-full"
        disabled={disabled}
      >
        <option value="">Selecione</option>
        {WORKFLOW_PERMISSIONS.map((permission) => (
          <option key={permission} value={permission}>{permission}</option>
        ))}
      </select>
    </Field>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="bbt-input w-full"
        disabled={disabled}
      />
    </Field>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase text-slate-500">
      {label}
      <span className="mt-1 block normal-case text-slate-900 dark:text-slate-100">
        {children}
      </span>
    </label>
  )
}

export function defaultWorkflowNodeConfiguration(
  type: EnterpriseWorkflowNodeType,
): Record<string, unknown> {
  if (type === 'human_task') {
    return {
      assignment: { type: 'role', value: 'operator' },
      requiredPermission: 'executar_workflows',
    }
  }
  if (type === 'automatic_task') {
    return { operation: 'set_variable', targetPath: 'variables.resultado', value: '' }
  }
  if (type === 'domain_command' || type === 'compensation') {
    return { commandKey: 'workflow.notification.enqueue' }
  }
  if (type === 'service_call' || type === 'integration_call') {
    return {
      providerKey: '',
      operation: '',
      idempotencyScope: 'execution_step',
      maxAttempts: 3,
    }
  }
  if (type === 'timer' || type === 'wait' || type === 'sla') return { durationMinutes: 30 }
  if (type === 'retry') return { maxAttempts: 3 }
  if (type === 'quorum') return { required: 1, total: 1 }
  if (type === 'subworkflow') return { workflowCode: '' }
  if (type === 'approval') return { approvalWorkflowCode: '' }
  return {}
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseScalar(value: string): string | number | boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
