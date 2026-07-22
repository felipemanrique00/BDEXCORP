'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Building2,
  CheckCircle2,
  Database,
  Edit2,
  Loader2,
  Plus,
  RefreshCcw,
  ServerCog,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'

interface PlatformPlan {
  id: string
  key: string
  name: string
  status: 'active' | 'inactive'
  maxUsers: number | null
  maxStorageBytes: number | null
  maxMonthlyOperations: number | null
  entitlements: Record<string, boolean>
}

interface PlatformTenant {
  id: string
  name: string
  slug: string
  status: TenantStatus
  planId: string
  planName: string
  subscriptionStatus: string
  billingMode: string
  createdAt: string
  suspendedAt: string | null
  usage: {
    users: number
    storageBytes: number
    monthlyOperations: number
  }
}

type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled'
type View = 'tenants' | 'plans'

const ENTITLEMENTS = [
  { key: 'ai', label: 'Central BIA' },
  { key: 'tech_travel', label: 'Tech Travel' },
  { key: 'advanced_reports', label: 'Relatórios avançados' },
  { key: 'file_storage', label: 'Armazenamento de arquivos' },
] as const

const EMPTY_TENANT = {
  name: '',
  slug: '',
  planId: '',
  adminName: '',
  adminEmail: '',
}

const EMPTY_PLAN = {
  id: '',
  key: '',
  name: '',
  active: true,
  maxUsers: '',
  maxStorageGb: '',
  maxMonthlyOperations: '',
  entitlements: {} as Record<string, boolean>,
}

export function PlatformAdminConsole() {
  const [view, setView] = useState<View>('tenants')
  const [plans, setPlans] = useState<PlatformPlan[]>([])
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tenantModalOpen, setTenantModalOpen] = useState(false)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<PlatformTenant | null>(null)
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT)
  const [tenantEditForm, setTenantEditForm] = useState<{ status: TenantStatus; planId: string }>({ status: 'active', planId: '' })
  const [planForm, setPlanForm] = useState(EMPTY_PLAN)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [plansResponse, tenantsResponse] = await Promise.all([
        fetch('/api/platform/plans', { cache: 'no-store' }),
        fetch('/api/platform/tenants', { cache: 'no-store' }),
      ])
      const [plansPayload, tenantsPayload] = await Promise.all([
        plansResponse.json().catch(() => null),
        tenantsResponse.json().catch(() => null),
      ])
      if (!plansResponse.ok) throw new Error(plansPayload?.error || 'Não foi possível carregar os planos.')
      if (!tenantsResponse.ok) throw new Error(tenantsPayload?.error || 'Não foi possível carregar os tenants.')
      setPlans(Array.isArray(plansPayload?.plans) ? plansPayload.plans : [])
      setTenants(Array.isArray(tenantsPayload?.tenants) ? tenantsPayload.tenants : [])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Falha ao carregar a administração SaaS.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => ({
    active: tenants.filter((tenant) => tenant.status === 'active' || tenant.status === 'trial').length,
    suspended: tenants.filter((tenant) => tenant.status === 'suspended').length,
    users: tenants.reduce((sum, tenant) => sum + tenant.usage.users, 0),
    storage: tenants.reduce((sum, tenant) => sum + tenant.usage.storageBytes, 0),
  }), [tenants])

  function openNewTenant() {
    const firstPlan = plans.find((plan) => plan.status === 'active')
    setTenantForm({ ...EMPTY_TENANT, planId: firstPlan?.id || '' })
    setEditingTenant(null)
    setTenantModalOpen(true)
  }

  function openTenantEdit(tenant: PlatformTenant) {
    setEditingTenant(tenant)
    setTenantEditForm({ status: tenant.status, planId: tenant.planId })
    setTenantModalOpen(true)
  }

  function openNewPlan() {
    setPlanForm({ ...EMPTY_PLAN, entitlements: {} })
    setPlanModalOpen(true)
  }

  function openPlanEdit(plan: PlatformPlan) {
    setPlanForm({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      active: plan.status === 'active',
      maxUsers: nullableNumberToText(plan.maxUsers),
      maxStorageGb: nullableNumberToText(plan.maxStorageBytes === null ? null : plan.maxStorageBytes / 1024 ** 3),
      maxMonthlyOperations: nullableNumberToText(plan.maxMonthlyOperations),
      entitlements: { ...plan.entitlements },
    })
    setPlanModalOpen(true)
  }

  async function saveTenant(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const endpoint = editingTenant
        ? `/api/platform/tenants/${encodeURIComponent(editingTenant.id)}`
        : '/api/platform/tenants'
      const response = await fetch(endpoint, {
        method: editingTenant ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTenant ? tenantEditForm : tenantForm),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar o tenant.')
      toast.success(editingTenant ? 'Tenant atualizado.' : 'Tenant criado e convite enviado.')
      setTenantModalOpen(false)
      await load()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o tenant.')
    } finally {
      setSaving(false)
    }
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/platform/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: planForm.id || undefined,
          key: planForm.key,
          name: planForm.name,
          active: planForm.active,
          maxUsers: positiveNumberOrNull(planForm.maxUsers),
          maxStorageBytes: planForm.maxStorageGb.trim() ? Math.round(Number(planForm.maxStorageGb) * 1024 ** 3) : null,
          maxMonthlyOperations: positiveNumberOrNull(planForm.maxMonthlyOperations),
          entitlements: planForm.entitlements,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar o plano.')
      toast.success(planForm.id ? 'Plano atualizado.' : 'Plano criado.')
      setPlanModalOpen(false)
      await load()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o plano.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Administração · Plataforma</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <ServerCog className="h-6 w-6 text-bbt-accent" /> Administração SaaS
          </h1>
          <p className="bbt-page-subtitle">Tenants, planos contratados, limites e consumo operacional.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="bbt-button-outline">
            <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} /> Atualizar
          </button>
          <button type="button" onClick={view === 'tenants' ? openNewTenant : openNewPlan} className="bbt-button-accent">
            <Plus className="h-4 w-4" /> {view === 'tenants' ? 'Novo tenant' : 'Novo plano'}
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo da plataforma">
        <Metric icon={Building2} label="Tenants ativos" value={String(totals.active)} />
        <Metric icon={ShieldCheck} label="Tenants suspensos" value={String(totals.suspended)} />
        <Metric icon={Users} label="Usuários cadastrados" value={String(totals.users)} />
        <Metric icon={Database} label="Armazenamento" value={formatBytes(totals.storage)} />
      </section>

      <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist" aria-label="Área administrativa">
        <Tab active={view === 'tenants'} onClick={() => setView('tenants')} icon={Building2} label="Tenants" />
        <Tab active={view === 'plans'} onClick={() => setView('plans')} icon={Activity} label="Planos e limites" />
      </div>

      {error ? (
        <div className="bbt-card border-red-200 p-6 text-center dark:border-red-900/60">
          <p className="font-semibold text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className="bbt-button-outline mt-4">Tentar novamente</button>
        </div>
      ) : loading ? (
        <div className="bbt-card flex min-h-48 items-center justify-center text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando dados da plataforma...
        </div>
      ) : view === 'tenants' ? (
        <TenantTable tenants={tenants} plans={plans} onEdit={openTenantEdit} />
      ) : (
        <PlanTable plans={plans} onEdit={openPlanEdit} />
      )}

      <Modal
        open={tenantModalOpen}
        onClose={() => !saving && setTenantModalOpen(false)}
        title={editingTenant ? `Gerenciar ${editingTenant.name}` : 'Novo tenant'}
        size="lg"
      >
        <form onSubmit={saveTenant} className="space-y-5">
          {editingTenant ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <select className="bbt-input" value={tenantEditForm.status} onChange={(event) => setTenantEditForm((current) => ({ ...current, status: event.target.value as TenantStatus }))}>
                  <option value="trial">Avaliação</option>
                  <option value="active">Ativo</option>
                  <option value="suspended">Suspenso</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </Field>
              <Field label="Plano">
                <PlanSelect value={tenantEditForm.planId} plans={plans} onChange={(planId) => setTenantEditForm((current) => ({ ...current, planId }))} />
              </Field>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome da organização">
                  <input required minLength={2} maxLength={160} className="bbt-input" value={tenantForm.name} onChange={(event) => setTenantForm((current) => ({ ...current, name: event.target.value, slug: current.slug || slugify(event.target.value) }))} />
                </Field>
                <Field label="Identificador do ambiente">
                  <input required minLength={2} maxLength={80} pattern="[a-z0-9-]+" className="bbt-input font-mono" value={tenantForm.slug} onChange={(event) => setTenantForm((current) => ({ ...current, slug: slugify(event.target.value) }))} />
                </Field>
                <Field label="Plano">
                  <PlanSelect value={tenantForm.planId} plans={plans} onChange={(planId) => setTenantForm((current) => ({ ...current, planId }))} />
                </Field>
              </div>
              <div className="border-t border-slate-200 pt-5 dark:border-slate-700">
                <h3 className="mb-4 text-sm font-bold text-bbt-primary dark:text-white">Administrador inicial</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nome completo">
                    <input required minLength={2} maxLength={160} autoComplete="name" className="bbt-input" value={tenantForm.adminName} onChange={(event) => setTenantForm((current) => ({ ...current, adminName: event.target.value }))} />
                  </Field>
                  <Field label="E-mail">
                    <input required type="email" maxLength={254} autoComplete="email" className="bbt-input" value={tenantForm.adminEmail} onChange={(event) => setTenantForm((current) => ({ ...current, adminEmail: event.target.value }))} />
                  </Field>
                </div>
              </div>
            </>
          )}
          <ModalActions saving={saving} onCancel={() => setTenantModalOpen(false)} />
        </form>
      </Modal>

      <Modal open={planModalOpen} onClose={() => !saving && setPlanModalOpen(false)} title={planForm.id ? 'Editar plano' : 'Novo plano'} size="lg">
        <form onSubmit={savePlan} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <input required minLength={2} maxLength={120} className="bbt-input" value={planForm.name} onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Chave">
              <input required minLength={2} maxLength={60} pattern="[a-z0-9-]+" className="bbt-input font-mono" value={planForm.key} onChange={(event) => setPlanForm((current) => ({ ...current, key: slugify(event.target.value) }))} />
            </Field>
            <Field label="Limite de usuários">
              <LimitInput value={planForm.maxUsers} onChange={(maxUsers) => setPlanForm((current) => ({ ...current, maxUsers }))} />
            </Field>
            <Field label="Armazenamento (GB)">
              <LimitInput value={planForm.maxStorageGb} onChange={(maxStorageGb) => setPlanForm((current) => ({ ...current, maxStorageGb }))} step="0.1" />
            </Field>
            <Field label="Operações mensais">
              <LimitInput value={planForm.maxMonthlyOperations} onChange={(maxMonthlyOperations) => setPlanForm((current) => ({ ...current, maxMonthlyOperations }))} />
            </Field>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-md border border-slate-200 px-3 text-sm font-medium dark:border-slate-700">
              <input type="checkbox" checked={planForm.active} onChange={(event) => setPlanForm((current) => ({ ...current, active: event.target.checked }))} className="h-4 w-4" />
              Plano ativo para contratação
            </label>
          </div>
          <fieldset className="border-t border-slate-200 pt-5 dark:border-slate-700">
            <legend className="px-1 text-sm font-bold text-bbt-primary dark:text-white">Recursos habilitados</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ENTITLEMENTS.map((entitlement) => (
                <label key={entitlement.key} className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm dark:border-slate-700">
                  <input type="checkbox" checked={planForm.entitlements[entitlement.key] === true} onChange={(event) => setPlanForm((current) => ({ ...current, entitlements: { ...current.entitlements, [entitlement.key]: event.target.checked } }))} className="h-4 w-4" />
                  {entitlement.label}
                </label>
              ))}
            </div>
          </fieldset>
          <ModalActions saving={saving} onCancel={() => setPlanModalOpen(false)} />
        </form>
      </Modal>
    </div>
  )
}

function TenantTable({ tenants, plans, onEdit }: { tenants: PlatformTenant[]; plans: PlatformPlan[]; onEdit: (tenant: PlatformTenant) => void }) {
  if (!tenants.length) return <EmptyState icon={Building2} title="Nenhum tenant cadastrado" />
  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  return (
    <div className="bbt-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
            <tr>
              <TableHead>Organização</TableHead><TableHead>Plano</TableHead><TableHead>Status</TableHead><TableHead>Usuários</TableHead><TableHead>Armazenamento</TableHead><TableHead>Operações/mês</TableHead><TableHead align="right">Ação</TableHead>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => {
              const plan = planById.get(tenant.planId)
              return (
                <tr key={tenant.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3"><div className="font-semibold text-bbt-primary dark:text-white">{tenant.name}</div><div className="mt-0.5 font-mono text-xs text-slate-500">{tenant.slug}</div></td>
                  <td className="px-4 py-3">{tenant.planName}</td>
                  <td className="px-4 py-3"><StatusBadge status={tenant.status} /></td>
                  <td className="px-4 py-3"><Usage value={tenant.usage.users} limit={plan?.maxUsers ?? null} /></td>
                  <td className="px-4 py-3"><Usage value={tenant.usage.storageBytes} limit={plan?.maxStorageBytes ?? null} formatter={formatBytes} /></td>
                  <td className="px-4 py-3"><Usage value={tenant.usage.monthlyOperations} limit={plan?.maxMonthlyOperations ?? null} /></td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => onEdit(tenant)} className="bbt-button-ghost h-9 px-3" aria-label={`Gerenciar ${tenant.name}`}><Edit2 className="h-4 w-4" /> Gerenciar</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlanTable({ plans, onEdit }: { plans: PlatformPlan[]; onEdit: (plan: PlatformPlan) => void }) {
  if (!plans.length) return <EmptyState icon={Activity} title="Nenhum plano cadastrado" />
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {plans.map((plan) => (
        <article key={plan.id} className="bbt-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-bold text-bbt-primary dark:text-white">{plan.name}</h2><p className="mt-1 font-mono text-xs text-slate-500">{plan.key}</p></div>
            <span className={cn('bbt-badge text-xs', plan.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{plan.status === 'active' ? 'Ativo' : 'Inativo'}</span>
          </div>
          <dl className="mt-5 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <PlanLimit label="Usuários" value={plan.maxUsers === null ? 'Ilimitado' : String(plan.maxUsers)} />
            <PlanLimit label="Armazenamento" value={plan.maxStorageBytes === null ? 'Ilimitado' : formatBytes(plan.maxStorageBytes)} />
            <PlanLimit label="Operações mensais" value={plan.maxMonthlyOperations === null ? 'Ilimitado' : String(plan.maxMonthlyOperations)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {ENTITLEMENTS.filter((item) => plan.entitlements[item.key]).map((item) => <span key={item.key} className="bbt-badge bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300"><CheckCircle2 className="h-3 w-3" /> {item.label}</span>)}
          </div>
          <button type="button" onClick={() => onEdit(plan)} className="bbt-button-outline mt-5 w-full"><Edit2 className="h-4 w-4" /> Editar plano</button>
        </article>
      ))}
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return <div className="bbt-card flex min-h-24 items-center gap-4 p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300"><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 truncate text-xl font-bold text-bbt-primary dark:text-white">{value}</p></div></div>
}

function Tab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Building2; label: string }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition', active ? 'bg-bbt-primary text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}><Icon className="h-4 w-4" />{label}</button>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">{label}</span>{children}</label>
}

function PlanSelect({ value, plans, onChange }: { value: string; plans: PlatformPlan[]; onChange: (value: string) => void }) {
  return <select required className="bbt-input" value={value} onChange={(event) => onChange(event.target.value)}><option value="" disabled>Selecione</option>{plans.filter((plan) => plan.status === 'active' || plan.id === value).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
}

function LimitInput({ value, onChange, step = '1' }: { value: string; onChange: (value: string) => void; step?: string }) {
  return <input type="number" min="0.1" step={step} className="bbt-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Sem limite" />
}

function ModalActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return <div className="flex justify-end gap-2 border-t border-slate-200 pt-5 dark:border-slate-700"><button type="button" onClick={onCancel} disabled={saving} className="bbt-button-ghost">Cancelar</button><button type="submit" disabled={saving} className="bbt-button-primary">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</button></div>
}

function TableHead({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('px-4 py-3 text-xs font-semibold uppercase text-slate-500', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>
}

function StatusBadge({ status }: { status: TenantStatus }) {
  const styles: Record<TenantStatus, string> = {
    trial: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  }
  const labels: Record<TenantStatus, string> = { trial: 'Avaliação', active: 'Ativo', suspended: 'Suspenso', cancelled: 'Cancelado' }
  return <span className={cn('bbt-badge text-xs', styles[status])}>{labels[status]}</span>
}

function Usage({ value, limit, formatter = String }: { value: number; limit: number | null; formatter?: (value: number) => string }) {
  const exceeded = limit !== null && value > limit
  return <div className={cn('font-medium', exceeded && 'text-red-600 dark:text-red-400')}><span>{formatter(value)}</span><span className="text-xs font-normal text-slate-400"> / {limit === null ? '∞' : formatter(limit)}</span></div>
}

function PlanLimit({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-bbt-primary dark:text-white">{value}</dd></div>
}

function EmptyState({ icon: Icon, title }: { icon: typeof Building2; title: string }) {
  return <div className="bbt-card flex min-h-48 flex-col items-center justify-center p-6 text-center text-slate-500"><Icon className="mb-3 h-8 w-8 text-slate-300" /><p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p></div>
}

function nullableNumberToText(value: number | null): string {
  return value === null ? '' : String(value)
}

function positiveNumberOrNull(value: string): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024
    unit = units[index]
  }
  return `${amount.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`
}
