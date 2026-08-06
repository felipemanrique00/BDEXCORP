'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  Hotel,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { DateInput } from '@/components/ui/date-input'
import {
  createHotelSupplierLink,
  listHotelSupplierLinks,
  updateHotelSupplierLink,
} from '@/lib/hotel-supplier-rates/client'
import type { HotelSupplierLink } from '@/lib/hotel-supplier-rates/types'
import { listHotelCatalog } from '@/lib/hotel-catalog/client'
import type { HotelCatalogItem } from '@/lib/hotel-catalog/types'

interface LinkDraft {
  hotelId: string
  propertyCode: string
  reservationEmail: string
  reservationPhone: string
  priority: string
  billingEnabled: boolean
  paymentMethods: string
  commercialTerms: string
  validFrom: string
  validUntil: string
  outOfPeriodPolicy: HotelSupplierLink['outOfPeriodPolicy']
  isActive: boolean
}

const EMPTY_DRAFT: LinkDraft = {
  hotelId: '',
  propertyCode: '',
  reservationEmail: '',
  reservationPhone: '',
  priority: '100',
  billingEnabled: false,
  paymentMethods: '',
  commercialTerms: '',
  validFrom: '',
  validUntil: '',
  outOfPeriodPolicy: 'block',
  isActive: true,
}

const OUT_OF_PERIOD_LABELS: Record<HotelSupplierLink['outOfPeriodPolicy'], string> = {
  block: 'Bloquear fora da vigência',
  warn: 'Permitir com alerta',
  allow: 'Permitir sem bloqueio',
}

export function OfflineSupplierHotelLinks({ supplierId, canManage }: { supplierId: string; canManage: boolean }) {
  const [links, setLinks] = useState<HotelSupplierLink[]>([])
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<HotelSupplierLink | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<LinkDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [linkItems, hotelItems] = await Promise.all([
        listHotelSupplierLinks(supplierId),
        listHotelCatalog({ includeInactive: 'true', limit: '200' }),
      ])
      setLinks(linkItems)
      setHotels(hotelItems)
    } catch (loadError) {
      setLinks([])
      setHotels([])
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os vínculos de hotéis.')
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  useEffect(() => { void load() }, [load])

  const linkedHotelIds = useMemo(() => new Set(links.filter((link) => link.isActive).map((link) => link.hotelId)), [links])
  const hotelOptions = useMemo(() => hotels
    .filter((hotel) => hotel.status === 'active' || hotel.id === draft.hotelId)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')), [draft.hotelId, hotels])

  function openCreate() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormError('')
    setFormOpen(true)
  }

  function openEdit(link: HotelSupplierLink) {
    setEditing(link)
    setDraft(linkToDraft(link))
    setFormError('')
    setFormOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.hotelId && !editing) {
      setFormError('Selecione o hotel que será vinculado.')
      return
    }
    if (draft.validFrom && draft.validUntil && draft.validUntil < draft.validFrom) {
      setFormError('A data final deve ser igual ou posterior à data inicial.')
      return
    }
    const priority = Number(draft.priority)
    if (!Number.isInteger(priority) || priority < 1 || priority > 999) {
      setFormError('A prioridade deve ser um número entre 1 e 999.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const common = {
        propertyCode: draft.propertyCode.trim() || null,
        reservationEmail: draft.reservationEmail.trim() || null,
        reservationPhone: draft.reservationPhone.trim() || null,
        priority,
        billingEnabled: draft.billingEnabled,
        paymentMethods: splitList(draft.paymentMethods),
        commercialTerms: {
          ...(editing?.commercialTerms || {}),
          description: draft.commercialTerms.trim(),
        },
        validFrom: draft.validFrom || null,
        validUntil: draft.validUntil || null,
        outOfPeriodPolicy: draft.outOfPeriodPolicy,
        isActive: draft.isActive,
      }
      if (editing) {
        await updateHotelSupplierLink(supplierId, editing.id, { ...common, expectedVersion: editing.version })
        toast.success('Vínculo com o hotel atualizado.')
      } else {
        await createHotelSupplierLink(supplierId, { ...common, hotelId: draft.hotelId })
        toast.success('Hotel vinculado ao fornecedor.')
      }
      setFormOpen(false)
      setEditing(null)
      setDraft(EMPTY_DRAFT)
      await load()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Não foi possível salvar o vínculo.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section className="bbt-card overflow-hidden" aria-labelledby="supplier-hotels-title" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bbt-gray-100 p-5 dark:border-slate-700">
          <div>
            <h2 id="supplier-hotels-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
              <Hotel className="h-4 w-4 text-bbt-accent" aria-hidden="true" /> Hotéis vinculados
            </h2>
            <p className="mt-1 text-xs text-slate-500">Cada vínculo representa a propriedade que este fornecedor pode reservar.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="bbt-button-ghost h-10 px-3" aria-label="Atualizar vínculos de hotéis">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
            </button>
            {canManage && (
              <button type="button" onClick={openCreate} className="bbt-button-primary h-10 px-4">
                <Plus className="h-4 w-4" aria-hidden="true" /> Vincular hotel
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <State icon={Loader2} title="Carregando hotéis vinculados..." spin />
        ) : error ? (
          <State icon={RefreshCw} title="Não foi possível carregar os vínculos" description={error} />
        ) : links.length === 0 ? (
          <State icon={Hotel} title="Nenhum hotel vinculado" description="Vincule ao menos uma propriedade ativa para habilitar as tarifas de hotel." />
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
            {links.map((link) => (
              <article key={link.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-bbt-primary dark:text-white">{link.hotel.name}</h3>
                      <span className={`bbt-badge ${link.isActive ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{link.isActive ? 'Ativo' : 'Inativo'}</span>
                      {link.billingEnabled && <span className="bbt-badge bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">Faturamento</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{locationLabel(link)}{link.hotel.category ? ` · ${link.hotel.category}` : ''}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
                      <span><strong>Código:</strong> {link.propertyCode || 'Não informado'}</span>
                      <span><strong>Prioridade:</strong> {link.priority}</span>
                      <span><strong>Quartos:</strong> {link.roomTypes.filter((room) => room.isActive).length}</span>
                      <span><strong>Tarifas:</strong> {link.rates.filter((rate) => rate.isActive).length}</span>
                      <span><strong>Fora da vigência:</strong> {OUT_OF_PERIOD_LABELS[link.outOfPeriodPolicy]}</span>
                    </div>
                    {(link.reservationEmail || link.reservationPhone) && (
                      <p className="mt-2 text-xs text-slate-500">Reservas: {[link.reservationEmail, link.reservationPhone].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => openEdit(link)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 transition hover:bg-cyan-50 hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-300 dark:text-slate-300 dark:hover:bg-cyan-950/30" aria-label={`Editar vínculo com ${link.hotel.name}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Editar
                    </button>
                  )}
                </div>
                {!link.roomTypes.some((room) => room.isActive) && (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Este hotel ainda não possui tipos de quarto ativos; cadastre-os no catálogo de hotéis antes de criar tarifas.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {formOpen ? (
        <form onSubmit={(event) => void save(event)} className="bbt-card h-fit p-5 2xl:sticky 2xl:top-4" aria-labelledby="hotel-link-form-title">
          <div className="flex items-start justify-between gap-3 border-b border-bbt-gray-100 pb-4 dark:border-slate-700">
            <div><h2 id="hotel-link-form-title" className="font-semibold text-bbt-primary dark:text-white">{editing ? 'Editar vínculo' : 'Novo vínculo'}</h2><p className="mt-1 text-xs text-slate-500">Configuração comercial específica desta propriedade.</p></div>
            <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fechar formulário de vínculo"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>

          {formError && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{formError}</div>}

          <div className="mt-4 space-y-4">
            <Field label="Hotel" required>
              <select className="bbt-input" value={draft.hotelId} onChange={(event) => setDraft((current) => ({ ...current, hotelId: event.target.value }))} disabled={saving || Boolean(editing)} required>
                <option value="">Selecione a propriedade</option>
                {hotelOptions.map((hotel) => <option key={hotel.id} value={hotel.id} disabled={hotel.id !== draft.hotelId && linkedHotelIds.has(hotel.id)}>{hotel.name} · {[hotel.cityName, hotel.subdivisionCode].filter(Boolean).join(' / ') || 'sem cidade'}</option>)}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código da propriedade"><input className="bbt-input" value={draft.propertyCode} onChange={(event) => setDraft((current) => ({ ...current, propertyCode: event.target.value }))} disabled={saving} maxLength={160} /></Field>
              <Field label="Prioridade"><input type="number" min="1" max="999" className="bbt-input" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} disabled={saving} required /></Field>
            </div>
            <Field label="E-mail de reservas"><input type="email" className="bbt-input" value={draft.reservationEmail} onChange={(event) => setDraft((current) => ({ ...current, reservationEmail: event.target.value }))} disabled={saving} maxLength={320} /></Field>
            <Field label="Telefone de reservas"><input type="tel" className="bbt-input" value={draft.reservationPhone} onChange={(event) => setDraft((current) => ({ ...current, reservationPhone: event.target.value }))} disabled={saving} maxLength={80} /></Field>
            <Field label="Meios de pagamento"><input className="bbt-input" value={draft.paymentMethods} onChange={(event) => setDraft((current) => ({ ...current, paymentMethods: event.target.value }))} disabled={saving} placeholder="Faturado, cartão virtual" /><p className="mt-1 text-[11px] text-slate-500">Separe múltiplas opções por vírgula.</p></Field>
            <Field label="Termos comerciais"><textarea className="bbt-input min-h-24 py-2" value={draft.commercialTerms} onChange={(event) => setDraft((current) => ({ ...current, commercialTerms: event.target.value }))} disabled={saving} maxLength={2000} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <TemporalField label="Válido de"><DateInput aria-label="Início da vigência" value={draft.validFrom} onChange={(event) => setDraft((current) => ({ ...current, validFrom: event.target.value }))} disabled={saving} pickerLabel="Abrir calendário de início da vigência" /></TemporalField>
              <TemporalField label="Até"><DateInput aria-label="Fim da vigência" value={draft.validUntil} onChange={(event) => setDraft((current) => ({ ...current, validUntil: event.target.value }))} disabled={saving} pickerLabel="Abrir calendário de fim da vigência" /></TemporalField>
            </div>
            <Field label="Uso fora da vigência"><select className="bbt-input" value={draft.outOfPeriodPolicy} onChange={(event) => setDraft((current) => ({ ...current, outOfPeriodPolicy: event.target.value as LinkDraft['outOfPeriodPolicy'] }))} disabled={saving}>{Object.entries(OUT_OF_PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-bbt-gray-100 px-3 py-2 text-sm dark:border-slate-700"><input type="checkbox" checked={draft.billingEnabled} onChange={(event) => setDraft((current) => ({ ...current, billingEnabled: event.target.checked }))} disabled={saving} className="h-4 w-4 accent-bbt-accent" /> Aceita faturamento</label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-bbt-gray-100 px-3 py-2 text-sm dark:border-slate-700"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} disabled={saving} className="h-4 w-4 accent-bbt-accent" /> Vínculo ativo</label>
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
            <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="bbt-button-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="bbt-button-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{saving ? 'Salvando...' : 'Salvar vínculo'}</button>
          </div>
        </form>
      ) : (
        <aside className="bbt-card flex h-fit min-h-56 flex-col items-center justify-center p-6 text-center 2xl:sticky 2xl:top-4">
          <Building2 className="h-7 w-7 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-semibold text-bbt-primary dark:text-white">Relação fornecedor × hotel</p>
          <p className="mt-1 text-sm text-slate-500">Selecione um vínculo para editar ou adicione uma nova propriedade.</p>
          {canManage && <button type="button" onClick={openCreate} className="bbt-button-outline mt-4"><Plus className="h-4 w-4" aria-hidden="true" /> Vincular hotel</button>}
        </aside>
      )}
    </div>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}</label>
}

function TemporalField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>{children}</div>
}

function State({ icon: Icon, title, description, spin = false }: { icon: typeof Hotel; title: string; description?: string; spin?: boolean }) {
  return <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center" role="status"><Icon className={`h-7 w-7 text-slate-400 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" /><p className="mt-3 font-semibold text-bbt-primary dark:text-white">{title}</p>{description && <p className="mt-1 max-w-lg text-sm text-slate-500">{description}</p>}</div>
}

function linkToDraft(link: HotelSupplierLink): LinkDraft {
  return {
    hotelId: link.hotelId,
    propertyCode: link.propertyCode || '',
    reservationEmail: link.reservationEmail || '',
    reservationPhone: link.reservationPhone || '',
    priority: String(link.priority),
    billingEnabled: link.billingEnabled,
    paymentMethods: link.paymentMethods.join(', '),
    commercialTerms: typeof link.commercialTerms.description === 'string' ? link.commercialTerms.description : '',
    validFrom: link.validFrom || '',
    validUntil: link.validUntil || '',
    outOfPeriodPolicy: link.outOfPeriodPolicy,
    isActive: link.isActive,
  }
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

function locationLabel(link: HotelSupplierLink): string {
  return [link.hotel.cityName, link.hotel.subdivisionCode, link.hotel.countryCode].filter(Boolean).join(' / ') || 'Localidade não informada'
}
