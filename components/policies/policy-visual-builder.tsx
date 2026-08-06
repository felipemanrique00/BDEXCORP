'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { DateTimeInput } from '@/components/ui/date-input'
import {
  policyDraftInputSchema,
  policyVersionInputSchema,
} from '@/lib/policy/admin-schema'
import {
  createPolicyDraft,
  createPolicyVersion,
  type PolicyDetail,
  type PolicyDraftPayload,
  type PolicyScopeInput,
} from '@/lib/policy/admin-client'
import type {
  PolicyAction,
  PolicyActionType,
  PolicyExpression,
  PolicyOperator,
} from '@/lib/policy/types'

interface ScopeOption {
  key: string
  label: string
  description: string
  scope: PolicyScopeInput
}

interface PolicyVisualBuilderProps {
  scopeOptions: ScopeOption[]
  initialPolicy?: PolicyDetail | null
  onSaved: (policy: PolicyDetail) => void
  onCancelEdit?: () => void
}

type ExpressionLogic = 'all' | 'any' | 'not'
type LiteralType = 'string' | 'number' | 'boolean' | 'null' | 'list' | 'json'

interface BuilderCondition {
  id: string
  kind: 'condition'
  fact: string
  operator: PolicyOperator
  source: 'literal' | 'fact'
  valueType: LiteralType
  valueInput: string
  valueFrom: string
  options: BuilderProperty[]
}

interface BuilderGroup {
  id: string
  kind: ExpressionLogic
  children: BuilderExpression[]
}

type BuilderExpression = BuilderCondition | BuilderGroup

interface BuilderProperty {
  id: string
  key: string
  valueType: LiteralType
  valueInput: string
}

interface BuilderAction {
  id: string
  type: PolicyActionType
  message: string
  remediation: string
  configuration: BuilderProperty[]
}

interface BuilderDependency {
  id: string
  type: 'policy' | 'workflow' | 'budget' | 'directory' | 'integration' | 'feature'
  key: string
  required: boolean
  minimumVersion: string
}

interface BuilderState {
  policyCode: string
  name: string
  description: string
  category: string
  priority: string
  severity: PolicyDraftPayload['severity']
  inheritanceMode: PolicyDraftPayload['inheritanceMode']
  overridable: boolean
  businessJustification: string
  changeSummary: string
  tags: string
  timezone: string
  validFrom: string
  validUntil: string
  checkpoints: string[]
  scopeKeys: string[]
  condition: BuilderExpression
  actions: BuilderAction[]
  exceptions: BuilderExpression[]
  dependencies: BuilderDependency[]
}

const CHECKPOINTS = [
  '*',
  'profile',
  'request',
  'search',
  'quotation',
  'selection',
  'submission',
  'merit_approval',
  'cost_approval',
  'reservation',
  'issuance',
  'post_issuance',
  'cancellation',
  'refund',
  'expense',
] as const

const OPERATORS: readonly PolicyOperator[] = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'exists',
  'not_exists',
  'before',
  'after',
  'date_between',
  'time_between',
  'day_of_week',
  'matches_safe_pattern',
  'within_percentage',
  'outside_percentage',
  'distance_greater_than',
  'duration_greater_than',
  'currency_compare',
] as const

const ACTION_TYPES: readonly PolicyActionType[] = [
  'allow',
  'warn',
  'block',
  'require_justification',
  'require_predefined_justification',
  'require_attachment',
  'require_acceptance',
  'require_document',
  'require_insurance',
  'require_budget',
  'require_cost_allocation',
  'require_cost_center',
  'require_project',
  'require_account',
  'auto_approve',
  'request_approval',
  'add_approval_level',
  'replace_approver',
  'require_parallel_approval',
  'require_sequential_approval',
  'set_approval_quorum',
  'route_to_merit_approval',
  'route_to_cost_approval',
  'escalate',
  'notify',
  'create_task',
  'register_occurrence',
  'restrict_search',
  'hide_offer',
  'rank_offer',
  'force_preferred_supplier',
  'block_supplier',
  'enforce_class',
  'enforce_value_limit',
  'enforce_advance_notice',
  'enforce_payment_method',
  'require_reapproval',
  'hold_booking',
  'prevent_issuance',
  'cancel_on_expiration',
  'release_budget',
  'commit_budget',
  'require_manual_review',
] as const

const NO_VALUE_OPERATORS = new Set<PolicyOperator>(['exists', 'not_exists'])

export function PolicyVisualBuilder({
  scopeOptions,
  initialPolicy,
  onSaved,
  onCancelEdit,
}: PolicyVisualBuilderProps) {
  const validFromInputId = useId()
  const validUntilInputId = useId()
  const [state, setState] = useState<BuilderState>(() => stateFromPolicy(initialPolicy, scopeOptions))
  const [saving, setSaving] = useState(false)
  const [showExceptions, setShowExceptions] = useState(Boolean(initialPolicy?.current?.exceptions?.length))

  useEffect(() => {
    setState(stateFromPolicy(initialPolicy, scopeOptions))
    setShowExceptions(Boolean(initialPolicy?.current?.exceptions?.length))
  }, [initialPolicy, scopeOptions])

  const validation = useMemo(() => {
    try {
      const payload = buildPayload(state, scopeOptions)
      const parsed = initialPolicy?.currentVersion
        ? policyVersionInputSchema.safeParse({
            ...withoutPolicyCode(payload),
            expectedCurrentVersion: initialPolicy.currentVersion,
          })
        : policyDraftInputSchema.safeParse(payload)
      return parsed.success
        ? { valid: true, issues: [] as string[] }
        : {
            valid: false,
            issues: parsed.error.issues.map((issue) => (
              `${issue.path.join('.') || 'politica'}: ${issue.message}`
            )),
          }
    } catch (error) {
      return {
        valid: false,
        issues: [error instanceof Error ? error.message : 'Configuracao invalida.'],
      }
    }
  }, [initialPolicy?.currentVersion, scopeOptions, state])

  async function save() {
    let payload: PolicyDraftPayload
    try {
      payload = buildPayload(state, scopeOptions)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revise a configuracao.')
      return
    }
    if (!validation.valid) {
      toast.error('Corrija os itens de validacao antes de salvar.')
      return
    }

    setSaving(true)
    try {
      const policy = initialPolicy?.currentVersion
        ? await createPolicyVersion(initialPolicy.id, {
            ...withoutPolicyCode(payload),
            expectedCurrentVersion: initialPolicy.currentVersion,
          })
        : await createPolicyDraft(payload)
      toast.success(initialPolicy ? 'Nova versao criada.' : 'Rascunho criado.')
      onSaved(policy)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar a politica.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="policy-builder-title">
      <div className="flex flex-col gap-3 border-b border-bbt-gray-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="bbt-section-label">Definicao versionada</p>
          <h2 id="policy-builder-title" className="mt-1 flex items-center gap-2 text-lg font-bold text-bbt-primary dark:text-white">
            <ShieldCheck className="h-5 w-5 text-bbt-accent" />
            {initialPolicy ? `Nova versao de ${initialPolicy.name}` : 'Nova politica'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {initialPolicy && onCancelEdit && (
            <button type="button" className="bbt-button-ghost" onClick={onCancelEdit}>
              <X className="h-4 w-4" />
              Cancelar
            </button>
          )}
          <button
            type="button"
            className="bbt-button-primary"
            disabled={saving || !validation.valid}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {initialPolicy ? 'Criar versao' : 'Salvar rascunho'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <div className="min-w-0 space-y-6">
          <BuilderSection title="Identificacao">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Codigo">
                <input
                  value={state.policyCode}
                  disabled={Boolean(initialPolicy)}
                  onChange={(event) => setState((current) => ({ ...current, policyCode: event.target.value.toLowerCase() }))}
                  className="bbt-input font-mono"
                />
              </Field>
              <Field label="Nome">
                <input
                  value={state.name}
                  onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
              <Field label="Categoria">
                <input
                  value={state.category}
                  onChange={(event) => setState((current) => ({ ...current, category: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
              <Field label="Prioridade">
                <input
                  type="number"
                  value={state.priority}
                  onChange={(event) => setState((current) => ({ ...current, priority: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
            </div>
            <Field label="Descricao">
              <textarea
                value={state.description}
                onChange={(event) => setState((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                className="bbt-input"
              />
            </Field>
          </BuilderSection>

          <BuilderSection title="Escopo e vigencia">
            <div className="grid gap-2 sm:grid-cols-2">
              {scopeOptions.map((option) => {
                const checked = state.scopeKeys.includes(option.key)
                return (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
                      checked
                        ? 'border-bbt-accent bg-cyan-50/60 dark:bg-cyan-950/20'
                        : 'border-bbt-gray-100 dark:border-slate-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setState((current) => ({
                        ...current,
                        scopeKeys: checked
                          ? current.scopeKeys.filter((key) => key !== option.key)
                          : [...current.scopeKeys, option.key],
                      }))}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-bbt-primary dark:text-white">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Fuso horario">
                <input
                  value={state.timezone}
                  onChange={(event) => setState((current) => ({ ...current, timezone: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
              <div className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                <label htmlFor={validFromInputId}>Inicio opcional</label>
                <div className="mt-1">
                  <DateTimeInput
                    id={validFromInputId}
                    value={state.validFrom}
                    onChange={(event) => setState((current) => ({ ...current, validFrom: event.target.value }))}
                    className="bbt-input"
                    pickerLabel="Abrir calendario de inicio da vigencia"
                  />
                </div>
              </div>
              <div className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                <label htmlFor={validUntilInputId}>Fim opcional</label>
                <div className="mt-1">
                  <DateTimeInput
                    id={validUntilInputId}
                    value={state.validUntil}
                    onChange={(event) => setState((current) => ({ ...current, validUntil: event.target.value }))}
                    className="bbt-input"
                    pickerLabel="Abrir calendario de fim da vigencia"
                  />
                </div>
              </div>
            </div>
          </BuilderSection>

          <BuilderSection title="Checkpoints">
            <div className="flex flex-wrap gap-2">
              {CHECKPOINTS.map((checkpoint) => {
                const checked = state.checkpoints.includes(checkpoint)
                return (
                  <label
                    key={checkpoint}
                    className={`cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold ${
                      checked
                        ? 'border-bbt-accent bg-bbt-primary text-white'
                        : 'border-bbt-gray-100 text-slate-600 dark:border-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setState((current) => ({
                        ...current,
                        checkpoints: checked
                          ? current.checkpoints.filter((item) => item !== checkpoint)
                          : checkpoint === '*'
                            ? ['*']
                            : [...current.checkpoints.filter((item) => item !== '*'), checkpoint],
                      }))}
                      className="sr-only"
                    />
                    {checkpoint === '*' ? 'todos' : checkpoint}
                  </label>
                )
              })}
            </div>
          </BuilderSection>

          <BuilderSection title="Condicoes">
            <ExpressionEditor
              expression={state.condition}
              root
              onChange={(condition) => setState((current) => ({ ...current, condition }))}
            />
          </BuilderSection>

          <BuilderSection title="Acoes">
            <div className="space-y-4">
              {state.actions.map((action, index) => (
                <ActionEditor
                  key={action.id}
                  action={action}
                  index={index}
                  removable={state.actions.length > 1}
                  onChange={(next) => setState((current) => ({
                    ...current,
                    actions: current.actions.map((item) => item.id === next.id ? next : item),
                  }))}
                  onRemove={() => setState((current) => ({
                    ...current,
                    actions: current.actions.filter((item) => item.id !== action.id),
                  }))}
                />
              ))}
              <button
                type="button"
                className="bbt-button-ghost"
                onClick={() => setState((current) => ({
                  ...current,
                  actions: [...current.actions, emptyAction()],
                }))}
              >
                <Plus className="h-4 w-4" />
                Adicionar acao
              </button>
            </div>
          </BuilderSection>

          <BuilderSection title="Excecoes">
            <button
              type="button"
              className="bbt-button-ghost"
              onClick={() => {
                setShowExceptions((current) => !current)
                if (!state.exceptions.length) {
                  setState((current) => ({ ...current, exceptions: [emptyCondition()] }))
                }
              }}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showExceptions ? 'rotate-180' : ''}`} />
              {showExceptions ? 'Ocultar excecoes' : 'Configurar excecoes'}
            </button>
            {showExceptions && (
              <div className="mt-3 space-y-4">
                {state.exceptions.map((exception, index) => (
                  <div key={exception.id} className="border-l-2 border-amber-300 pl-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-amber-700">Excecao {index + 1}</span>
                      <IconButton
                        label="Remover excecao"
                        icon={Trash2}
                        onClick={() => setState((current) => ({
                          ...current,
                          exceptions: current.exceptions.filter((item) => item.id !== exception.id),
                        }))}
                      />
                    </div>
                    <ExpressionEditor
                      expression={exception}
                      root
                      onChange={(next) => setState((current) => ({
                        ...current,
                        exceptions: current.exceptions.map((item) => item.id === next.id ? next : item),
                      }))}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="bbt-button-ghost"
                  onClick={() => setState((current) => ({
                    ...current,
                    exceptions: [...current.exceptions, emptyCondition()],
                  }))}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar excecao
                </button>
              </div>
            )}
          </BuilderSection>

          <BuilderSection title="Dependencias">
            <div className="space-y-3">
              {state.dependencies.map((dependency) => (
                <div key={dependency.id} className="grid gap-2 border-b border-bbt-gray-100 pb-3 dark:border-slate-800 md:grid-cols-[150px_minmax(0,1fr)_110px_110px_auto]">
                  <select
                    value={dependency.type}
                    onChange={(event) => updateDependency(state, setState, dependency.id, {
                      type: event.target.value as BuilderDependency['type'],
                    })}
                    className="bbt-input"
                  >
                    {['policy', 'workflow', 'budget', 'directory', 'integration', 'feature'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <input
                    value={dependency.key}
                    onChange={(event) => updateDependency(state, setState, dependency.id, { key: event.target.value })}
                    placeholder="Chave"
                    className="bbt-input"
                  />
                  <label className="flex items-center gap-2 rounded-md border border-bbt-gray-100 px-3 text-xs dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={dependency.required}
                      onChange={(event) => updateDependency(state, setState, dependency.id, {
                        required: event.target.checked,
                      })}
                    />
                    Obrigatoria
                  </label>
                  <input
                    value={dependency.minimumVersion}
                    onChange={(event) => updateDependency(state, setState, dependency.id, { minimumVersion: event.target.value })}
                    placeholder="Versao"
                    className="bbt-input"
                  />
                  <IconButton
                    label="Remover dependencia"
                    icon={Trash2}
                    onClick={() => setState((current) => ({
                      ...current,
                      dependencies: current.dependencies.filter((item) => item.id !== dependency.id),
                    }))}
                  />
                </div>
              ))}
              <button
                type="button"
                className="bbt-button-ghost"
                onClick={() => setState((current) => ({
                  ...current,
                  dependencies: [...current.dependencies, emptyDependency()],
                }))}
              >
                <Plus className="h-4 w-4" />
                Adicionar dependencia
              </button>
            </div>
          </BuilderSection>

          <BuilderSection title="Governanca">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Severidade">
                <select
                  value={state.severity}
                  onChange={(event) => setState((current) => ({
                    ...current,
                    severity: event.target.value as BuilderState['severity'],
                  }))}
                  className="bbt-input"
                >
                  {['info', 'warning', 'blocking', 'critical'].map((severity) => (
                    <option key={severity} value={severity}>{severity}</option>
                  ))}
                </select>
              </Field>
              <Field label="Heranca">
                <select
                  value={state.inheritanceMode}
                  onChange={(event) => setState((current) => ({
                    ...current,
                    inheritanceMode: event.target.value as BuilderState['inheritanceMode'],
                  }))}
                  className="bbt-input"
                >
                  {['inherit', 'merge', 'override', 'replace', 'disable', 'stop_inheritance'].map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-3 self-end rounded-md border border-bbt-gray-100 px-3 py-3 text-sm dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={state.overridable}
                  onChange={(event) => setState((current) => ({ ...current, overridable: event.target.checked }))}
                />
                Permite sobreposicao
              </label>
            </div>
            <Field label="Justificativa de negocio">
              <textarea
                value={state.businessJustification}
                onChange={(event) => setState((current) => ({ ...current, businessJustification: event.target.value }))}
                rows={3}
                className="bbt-input"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Resumo da alteracao">
                <input
                  value={state.changeSummary}
                  onChange={(event) => setState((current) => ({ ...current, changeSummary: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
              <Field label="Etiquetas">
                <input
                  value={state.tags}
                  onChange={(event) => setState((current) => ({ ...current, tags: event.target.value }))}
                  className="bbt-input"
                />
              </Field>
            </div>
          </BuilderSection>
        </div>

        <aside className="min-w-0 xl:border-l xl:border-bbt-gray-100 xl:pl-6 dark:xl:border-slate-800">
          <div className="sticky top-4 space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
              <GitBranch className="h-4 w-4 text-bbt-accent" />
              Validacao
            </h3>
            <div className={`rounded-md border p-4 ${
              validation.valid
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
            }`}>
              <div className="flex items-start gap-3">
                {validation.valid
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {validation.valid ? 'Configuracao valida' : `${validation.issues.length} item(ns) pendente(s)`}
                  </p>
                  {!validation.valid && (
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                      {validation.issues.slice(0, 12).map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            <dl className="divide-y divide-bbt-gray-100 border-y border-bbt-gray-100 text-sm dark:divide-slate-800 dark:border-slate-800">
              <Summary label="Escopos" value={String(state.scopeKeys.length)} />
              <Summary label="Checkpoints" value={String(state.checkpoints.length)} />
              <Summary label="Acoes" value={String(state.actions.length)} />
              <Summary label="Excecoes" value={String(showExceptions ? state.exceptions.length : 0)} />
              <Summary label="Dependencias" value={String(state.dependencies.length)} />
            </dl>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ExpressionEditor({
  expression,
  onChange,
  onRemove,
  root = false,
}: {
  expression: BuilderExpression
  onChange: (expression: BuilderExpression) => void
  onRemove?: () => void
  root?: boolean
}) {
  if (expression.kind === 'condition') {
    const hideValue = NO_VALUE_OPERATORS.has(expression.operator)
    return (
      <div className="space-y-3 border-l-2 border-cyan-300 pl-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(160px,1fr)_180px_130px_minmax(160px,1fr)_auto]">
          <input
            value={expression.fact}
            onChange={(event) => onChange({ ...expression, fact: event.target.value })}
            placeholder="Fato, ex.: finance.totalAmount"
            className="bbt-input font-mono text-xs"
          />
          <select
            value={expression.operator}
            onChange={(event) => onChange({
              ...expression,
              operator: event.target.value as PolicyOperator,
            })}
            className="bbt-input text-xs"
          >
            {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
          </select>
          {!hideValue && (
            <select
              value={expression.source === 'fact' ? 'fact' : expression.valueType}
              onChange={(event) => {
                const value = event.target.value
                onChange(value === 'fact'
                  ? { ...expression, source: 'fact', valueFrom: expression.valueFrom || 'reference.value' }
                  : { ...expression, source: 'literal', valueType: value as LiteralType })
              }}
              className="bbt-input text-xs"
            >
              <option value="string">Texto</option>
              <option value="number">Numero</option>
              <option value="boolean">Booleano</option>
              <option value="null">Nulo</option>
              <option value="list">Lista</option>
              <option value="json">Estrutura</option>
              <option value="fact">Outro fato</option>
            </select>
          )}
          {!hideValue && (
            expression.source === 'fact' ? (
              <input
                value={expression.valueFrom}
                onChange={(event) => onChange({ ...expression, valueFrom: event.target.value })}
                placeholder="Fato de referencia"
                className="bbt-input font-mono text-xs"
              />
            ) : expression.valueType === 'boolean' ? (
              <select
                value={expression.valueInput}
                onChange={(event) => onChange({ ...expression, valueInput: event.target.value })}
                className="bbt-input text-xs"
              >
                <option value="true">Verdadeiro</option>
                <option value="false">Falso</option>
              </select>
            ) : (
              <input
                value={expression.valueInput}
                disabled={expression.valueType === 'null'}
                onChange={(event) => onChange({ ...expression, valueInput: event.target.value })}
                placeholder={expression.valueType === 'list' ? 'valor 1, valor 2' : 'Valor'}
                className="bbt-input text-xs"
              />
            )
          )}
          {!root && onRemove && (
            <IconButton label="Remover condicao" icon={Trash2} onClick={onRemove} />
          )}
        </div>
        <PropertyEditor
          label="Opcoes"
          properties={expression.options}
          onChange={(options) => onChange({ ...expression, options })}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3 border-l-2 border-indigo-300 pl-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          Grupo
          <select
            value={expression.kind}
            onChange={(event) => {
              const kind = event.target.value as ExpressionLogic
              onChange({
                ...expression,
                kind,
                children: kind === 'not'
                  ? [expression.children[0] || emptyCondition()]
                  : expression.children.length ? expression.children : [emptyCondition()],
              })
            }}
            className="bbt-input w-32 py-1.5 text-xs"
          >
            <option value="all">Todas</option>
            <option value="any">Qualquer</option>
            <option value="not">Negacao</option>
          </select>
        </label>
        {!root && onRemove && <IconButton label="Remover grupo" icon={Trash2} onClick={onRemove} />}
      </div>
      <div className="space-y-4">
        {expression.children.map((child) => (
          <ExpressionEditor
            key={child.id}
            expression={child}
            onChange={(next) => onChange({
              ...expression,
              children: expression.children.map((item) => item.id === next.id ? next : item),
            })}
            onRemove={() => onChange({
              ...expression,
              children: expression.children.filter((item) => item.id !== child.id),
            })}
          />
        ))}
      </div>
      {expression.kind !== 'not' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bbt-button-ghost"
            onClick={() => onChange({ ...expression, children: [...expression.children, emptyCondition()] })}
          >
            <Plus className="h-4 w-4" />
            Condicao
          </button>
          <button
            type="button"
            className="bbt-button-ghost"
            onClick={() => onChange({ ...expression, children: [...expression.children, emptyGroup()] })}
          >
            <Plus className="h-4 w-4" />
            Grupo
          </button>
        </div>
      )}
    </div>
  )
}

function ActionEditor({
  action,
  index,
  removable,
  onChange,
  onRemove,
}: {
  action: BuilderAction
  index: number
  removable: boolean
  onChange: (action: BuilderAction) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-3 border-l-2 border-emerald-300 pl-4">
      <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
        <select
          value={action.type}
          onChange={(event) => onChange({ ...action, type: event.target.value as PolicyActionType })}
          className="bbt-input text-xs"
          aria-label={`Tipo da acao ${index + 1}`}
        >
          {ACTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input
          value={action.message}
          onChange={(event) => onChange({ ...action, message: event.target.value })}
          placeholder="Mensagem"
          className="bbt-input"
          aria-label={`Mensagem da acao ${index + 1}`}
        />
        {removable && <IconButton label="Remover acao" icon={Trash2} onClick={onRemove} />}
      </div>
      <input
        value={action.remediation}
        onChange={(event) => onChange({ ...action, remediation: event.target.value })}
        placeholder="Orientacao para regularizacao"
        className="bbt-input"
        aria-label={`Remediacao da acao ${index + 1}`}
      />
      <PropertyEditor
        label="Configuracao"
        properties={action.configuration}
        onChange={(configuration) => onChange({ ...action, configuration })}
      />
    </div>
  )
}

function PropertyEditor({
  label,
  properties,
  onChange,
}: {
  label: string
  properties: BuilderProperty[]
  onChange: (properties: BuilderProperty[]) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase text-slate-500">{label}</span>
        <button
          type="button"
          className="bbt-button-ghost px-2 py-1 text-xs"
          onClick={() => onChange([...properties, emptyProperty()])}
        >
          <Plus className="h-3.5 w-3.5" />
          Campo
        </button>
      </div>
      {properties.map((property) => (
        <div key={property.id} className="grid gap-2 sm:grid-cols-[minmax(130px,0.7fr)_120px_minmax(160px,1fr)_auto]">
          <input
            value={property.key}
            onChange={(event) => onChange(properties.map((item) => (
              item.id === property.id ? { ...item, key: event.target.value } : item
            )))}
            placeholder="Chave"
            className="bbt-input font-mono text-xs"
          />
          <select
            value={property.valueType}
            onChange={(event) => onChange(properties.map((item) => (
              item.id === property.id
                ? { ...item, valueType: event.target.value as LiteralType }
                : item
            )))}
            className="bbt-input text-xs"
          >
            <option value="string">Texto</option>
            <option value="number">Numero</option>
            <option value="boolean">Booleano</option>
            <option value="null">Nulo</option>
            <option value="list">Lista</option>
            <option value="json">Estrutura</option>
          </select>
          {property.valueType === 'boolean' ? (
            <select
              value={property.valueInput}
              onChange={(event) => onChange(properties.map((item) => (
                item.id === property.id ? { ...item, valueInput: event.target.value } : item
              )))}
              className="bbt-input text-xs"
            >
              <option value="true">Verdadeiro</option>
              <option value="false">Falso</option>
            </select>
          ) : (
            <input
              value={property.valueInput}
              disabled={property.valueType === 'null'}
              onChange={(event) => onChange(properties.map((item) => (
                item.id === property.id ? { ...item, valueInput: event.target.value } : item
              )))}
              className="bbt-input text-xs"
            />
          )}
          <IconButton
            label={`Remover campo ${property.key || ''}`}
            icon={Trash2}
            onClick={() => onChange(properties.filter((item) => item.id !== property.id))}
          />
        </div>
      ))}
    </div>
  )
}

function BuilderSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-b border-bbt-gray-100 pb-6 last:border-b-0 dark:border-slate-800">
      <h3 className="text-sm font-bold text-bbt-primary dark:text-white">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: typeof Trash2
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="bbt-button-ghost self-start p-2 text-red-600"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-bbt-primary dark:text-white">{value}</dd>
    </div>
  )
}

function stateFromPolicy(
  policy: PolicyDetail | null | undefined,
  scopeOptions: ScopeOption[],
): BuilderState {
  const current = policy?.current
  const scopeKeys = current
    ? current.scopes.flatMap((scope) => {
        const key = scope.type === 'tenant' ? 'tenant' : `${scope.type}:${scope.id}`
        return scopeOptions.some((option) => option.key === key) ? [key] : []
      })
    : scopeOptions[0]?.key ? [scopeOptions[0].key] : []

  return {
    policyCode: policy?.code || '',
    name: current?.name || '',
    description: current?.description || '',
    category: current?.category || '',
    priority: String(current?.priority ?? 100),
    severity: current?.severity || 'warning',
    inheritanceMode: current?.inheritanceMode || 'inherit',
    overridable: current?.overridable ?? true,
    businessJustification: policy?.businessJustification || '',
    changeSummary: policy ? `Nova versao de ${policy.code}` : '',
    tags: policy?.tags.join(', ') || '',
    timezone: current?.timezone || 'America/Sao_Paulo',
    validFrom: toLocalDateTime(current?.validFrom),
    validUntil: toLocalDateTime(current?.validUntil),
    checkpoints: current?.checkpoints || ['submission'],
    scopeKeys,
    condition: current ? expressionFromPolicy(current.condition) : emptyCondition(),
    actions: current?.actions.map(actionFromPolicy) || [emptyAction()],
    exceptions: current?.exceptions?.map(expressionFromPolicy) || [],
    dependencies: current?.dependencies?.map((dependency) => ({
      id: newId('dependency'),
      type: dependency.type as BuilderDependency['type'],
      key: dependency.key,
      required: dependency.required,
      minimumVersion: '',
    })) || [],
  }
}

function buildPayload(state: BuilderState, scopeOptions: ScopeOption[]): PolicyDraftPayload {
  const scopes = state.scopeKeys.map((key) => {
    const option = scopeOptions.find((candidate) => candidate.key === key)
    if (!option) throw new Error(`Escopo indisponivel: ${key}.`)
    return option.scope
  })
  return {
    policyCode: state.policyCode.trim(),
    name: state.name.trim(),
    description: state.description.trim(),
    category: state.category.trim(),
    priority: Number(state.priority),
    severity: state.severity,
    inheritanceMode: state.inheritanceMode,
    overridable: state.overridable,
    businessJustification: state.businessJustification.trim(),
    changeSummary: state.changeSummary.trim(),
    tags: state.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    checkpoints: state.checkpoints,
    timezone: state.timezone.trim(),
    validFrom: toIso(state.validFrom),
    validUntil: toIso(state.validUntil),
    scopes,
    condition: expressionToPolicy(state.condition),
    actions: state.actions.map(actionToPolicy),
    exceptions: state.exceptions.map(expressionToPolicy),
    dependencies: state.dependencies.map((dependency) => ({
      type: dependency.type,
      key: dependency.key.trim(),
      required: dependency.required,
      ...(dependency.minimumVersion.trim() ? { minimumVersion: dependency.minimumVersion.trim() } : {}),
      configuration: {},
    })),
  }
}

function expressionFromPolicy(expression: PolicyExpression): BuilderExpression {
  if ('all' in expression) {
    return { id: newId('group'), kind: 'all', children: expression.all.map(expressionFromPolicy) }
  }
  if ('any' in expression) {
    return { id: newId('group'), kind: 'any', children: expression.any.map(expressionFromPolicy) }
  }
  if ('not' in expression) {
    return { id: newId('group'), kind: 'not', children: [expressionFromPolicy(expression.not)] }
  }
  const literal = expression.valueFrom
    ? { valueType: 'string' as LiteralType, valueInput: '' }
    : literalToBuilder(expression.value)
  return {
    id: newId('condition'),
    kind: 'condition',
    fact: expression.fact,
    operator: expression.operator,
    source: expression.valueFrom ? 'fact' : 'literal',
    valueFrom: expression.valueFrom || '',
    ...literal,
    options: propertiesFromRecord(expression.options || {}),
  }
}

function expressionToPolicy(expression: BuilderExpression): PolicyExpression {
  if (expression.kind !== 'condition') {
    if (expression.kind === 'all') {
      if (!expression.children.length) throw new Error('Um grupo Todas precisa de ao menos uma condicao.')
      return { all: expression.children.map(expressionToPolicy) }
    }
    if (expression.kind === 'any') {
      if (!expression.children.length) throw new Error('Um grupo Qualquer precisa de ao menos uma condicao.')
      return { any: expression.children.map(expressionToPolicy) }
    }
    if (expression.children.length !== 1) throw new Error('Uma negacao precisa de exatamente uma condicao.')
    return { not: expressionToPolicy(expression.children[0]) }
  }
  const condition: Extract<PolicyExpression, { fact: string }> = {
    fact: expression.fact.trim(),
    operator: expression.operator,
  }
  if (!NO_VALUE_OPERATORS.has(expression.operator)) {
    if (expression.source === 'fact') condition.valueFrom = expression.valueFrom.trim()
    else condition.value = parseLiteral(expression.valueType, expression.valueInput)
  }
  const options = recordFromProperties(expression.options)
  if (Object.keys(options).length) condition.options = options
  return condition
}

function actionFromPolicy(action: PolicyAction): BuilderAction {
  return {
    id: newId('action'),
    type: action.type,
    message: action.message,
    remediation: action.remediation || '',
    configuration: propertiesFromRecord(action.configuration || {}),
  }
}

function actionToPolicy(action: BuilderAction): PolicyAction {
  const configuration = recordFromProperties(action.configuration)
  return {
    type: action.type,
    message: action.message.trim(),
    ...(action.remediation.trim() ? { remediation: action.remediation.trim() } : {}),
    ...(Object.keys(configuration).length ? { configuration } : {}),
  }
}

function propertiesFromRecord(record: Record<string, unknown>): BuilderProperty[] {
  return Object.entries(record).map(([key, value]) => {
    const literal = literalToBuilder(value)
    return { id: newId('property'), key, ...literal }
  })
}

function recordFromProperties(properties: BuilderProperty[]): Record<string, unknown> {
  const seen = new Set<string>()
  return Object.fromEntries(properties.map((property) => {
    const key = property.key.trim()
    if (!key) throw new Error('Campo de configuracao sem chave.')
    if (seen.has(key)) throw new Error(`Campo de configuracao duplicado: ${key}.`)
    seen.add(key)
    return [key, parseLiteral(property.valueType, property.valueInput)]
  }))
}

function literalToBuilder(value: unknown): { valueType: LiteralType; valueInput: string } {
  if (value === null || value === undefined) return { valueType: 'null', valueInput: '' }
  if (typeof value === 'boolean') return { valueType: 'boolean', valueInput: String(value) }
  if (typeof value === 'number') return { valueType: 'number', valueInput: String(value) }
  if (Array.isArray(value)) return { valueType: 'list', valueInput: value.join(', ') }
  if (typeof value === 'object') return { valueType: 'json', valueInput: JSON.stringify(value) }
  return { valueType: 'string', valueInput: String(value) }
}

function parseLiteral(type: LiteralType, input: string): unknown {
  if (type === 'null') return null
  if (type === 'boolean') return input === 'true'
  if (type === 'number') {
    const number = Number(input)
    if (!Number.isFinite(number)) throw new Error(`Numero invalido: ${input}.`)
    return number
  }
  if (type === 'list') return input.split(',').map((value) => value.trim()).filter(Boolean)
  if (type === 'json') {
    try {
      return JSON.parse(input)
    } catch {
      throw new Error('Estrutura JSON invalida em uma propriedade.')
    }
  }
  return input
}

function emptyCondition(): BuilderCondition {
  return {
    id: newId('condition'),
    kind: 'condition',
    fact: '',
    operator: 'eq',
    source: 'literal',
    valueType: 'boolean',
    valueInput: 'true',
    valueFrom: '',
    options: [],
  }
}

function emptyGroup(): BuilderGroup {
  return { id: newId('group'), kind: 'all', children: [emptyCondition()] }
}

function emptyAction(): BuilderAction {
  return {
    id: newId('action'),
    type: 'warn',
    message: '',
    remediation: '',
    configuration: [],
  }
}

function emptyProperty(): BuilderProperty {
  return {
    id: newId('property'),
    key: '',
    valueType: 'string',
    valueInput: '',
  }
}

function emptyDependency(): BuilderDependency {
  return {
    id: newId('dependency'),
    type: 'feature',
    key: '',
    required: true,
    minimumVersion: '',
  }
}

function withoutPolicyCode(payload: PolicyDraftPayload): Omit<PolicyDraftPayload, 'policyCode'> {
  const { policyCode: _policyCode, ...version } = payload
  return version
}

function updateDependency(
  state: BuilderState,
  setState: React.Dispatch<React.SetStateAction<BuilderState>>,
  id: string,
  patch: Partial<BuilderDependency>,
) {
  setState({
    ...state,
    dependencies: state.dependencies.map((item) => item.id === id ? { ...item, ...patch } : item),
  })
}

function toIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`Data invalida: ${value}.`)
  return date.toISOString()
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

let idSequence = 0
function newId(prefix: string): string {
  idSequence += 1
  return `${prefix}-${idSequence}`
}
