'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  FileCheck2,
  Hotel,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { DateInput } from '@/components/ui/date-input'
import {
  createHotelSupplierRate,
  listHotelSupplierLinks,
  listHotelSupplierRates,
  updateHotelSupplierRate,
} from '@/lib/hotel-supplier-rates/client'
import type {
  HotelSupplierLink,
  HotelSupplierRate,
  HotelSupplierRateScopeTargetType,
  HotelSupplierRateScopeType,
} from '@/lib/hotel-supplier-rates/types'
import { useStore } from '@/lib/store'

interface RateDraft {
  roomTypeId: string
  code: string
  validFrom: string
  validUntil: string
  currency: string
  rackAmount: string
  agreementAmount: string
  taxAmount: string
  serviceFeeAmount: string
  isNet: boolean
  isSuspended: boolean
  isActive: boolean
  refundable: '' | 'yes' | 'no'
  mealPlan: string
  cancellationPolicy: string
  paymentTerms: string
  scopeTargets: string[]
}

const EMPTY_DRAFT: RateDraft = {
  roomTypeId: '',
  code: '',
  validFrom: '',
  validUntil: '',
  currency: 'BRL',
  rackAmount: '',
  agreementAmount: '',
  taxAmount: '0,00',
  serviceFeeAmount: '0,00',
  isNet: false,
  isSuspended: false,
  isActive: true,
  refundable: '',
  mealPlan: '',
  cancellationPolicy: '',
  paymentTerms: '',
  scopeTargets: [],
}

type RateDraftUpdater = <K extends keyof RateDraft>(field: K, value: RateDraft[K]) => void

export function OfflineSupplierRates({
  supplierId,
  scope,
  canManage,
}: {
  supplierId: string
  scope: HotelSupplierRateScopeType
  canManage: boolean
}) {
  const [links, setLinks] = useState<HotelSupplierLink[]>([])
  const [rates, setRates] = useState<HotelSupplierRate[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('')
  const [loadingLinks, setLoadingLinks] = useState(true)
  const [loadingRates, setLoadingRates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<HotelSupplierRate | null>(null)
  const [draft, setDraft] = useState<RateDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState('')

  const selectedLink = links.find((link) => link.id === selectedLinkId) || null
  const roomTypes = useMemo(() => selectedLink?.roomTypes.filter((room) => room.isActive) || [], [selectedLink])

  const loadLinks = useCallback(async () => {
    setLoadingLinks(true)
    setError('')
    try {
      const items = await listHotelSupplierLinks(supplierId)
      setLinks(items)
      setSelectedLinkId((current) => items.some((item) => item.id === current)
        ? current
        : items.find((item) => item.isActive)?.id || items[0]?.id || '')
    } catch (loadError) {
      setLinks([])
      setSelectedLinkId('')
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os hotéis do fornecedor.')
    } finally {
      setLoadingLinks(false)
    }
  }, [supplierId])

  const loadRates = useCallback(async () => {
    if (!selectedLinkId) {
      setRates([])
      return
    }
    setLoadingRates(true)
    setError('')
    try {
      setRates(await listHotelSupplierRates(supplierId, selectedLinkId))
    } catch (loadError) {
      setRates([])
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as tarifas.')
    } finally {
      setLoadingRates(false)
    }
  }, [selectedLinkId, supplierId])

  useEffect(() => { void loadLinks() }, [loadLinks])
  useEffect(() => {
    setSelectedRoomTypeId('')
    setFormOpen(false)
    setEditing(null)
    void loadRates()
  }, [loadRates])

  const visibleRates = useMemo(() => rates
    .filter((rate) => rate.scopeType === scope)
    .filter((rate) => !selectedRoomTypeId || rate.roomTypeId === selectedRoomTypeId)
    .sort((left, right) => `${left.roomType.name}${left.validFrom}${left.code}`.localeCompare(`${right.roomType.name}${right.validFrom}${right.code}`, 'pt-BR')), [rates, scope, selectedRoomTypeId])

  function openCreate() {
    const roomTypeId = selectedRoomTypeId || roomTypes[0]?.id || ''
    setEditing(null)
    setDraft({ ...EMPTY_DRAFT, roomTypeId })
    setFormError('')
    setFormOpen(true)
  }

  function openEdit(rate: HotelSupplierRate) {
    setEditing(rate)
    setSelectedRoomTypeId(rate.roomTypeId)
    setDraft(rateToDraft(rate))
    setFormError('')
    setFormOpen(true)
  }

  function closeEditor() {
    setFormOpen(false)
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormError('')
  }

  function updateDraft<K extends keyof RateDraft>(field: K, value: RateDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }))
    if (formError) setFormError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!selectedLinkId) return
    const validation = validateRateDraft(draft, scope)
    if (validation) {
      setFormError(validation)
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const common = {
        roomTypeId: draft.roomTypeId,
        code: draft.code.trim(),
        validFrom: draft.validFrom,
        validUntil: draft.validUntil,
        rackAmount: optionalMoney(draft.rackAmount),
        agreementAmount: requiredMoney(draft.agreementAmount),
        taxAmount: optionalMoney(draft.taxAmount) || 0,
        serviceFeeAmount: optionalMoney(draft.serviceFeeAmount) || 0,
        currency: draft.currency.trim().toUpperCase(),
        isNet: draft.isNet,
        isSuspended: draft.isSuspended,
        isActive: draft.isActive,
        refundable: draft.refundable === '' ? null : draft.refundable === 'yes',
        mealPlan: draft.mealPlan.trim() || null,
        cancellationPolicy: draft.cancellationPolicy.trim() || null,
        paymentTerms: draft.paymentTerms.trim() || null,
        scopeType: scope,
        scopeTargets: scope === 'restricted' ? draft.scopeTargets.map(parseTargetKey) : [],
        metadata: editing?.metadata || {},
      }
      if (editing) {
        await updateHotelSupplierRate(supplierId, selectedLinkId, editing.id, { ...common, expectedVersion: editing.version })
        toast.success(scope === 'global' ? 'Tarifa atualizada.' : 'Acordo corporativo atualizado.')
      } else {
        await createHotelSupplierRate(supplierId, selectedLinkId, common)
        toast.success(scope === 'global' ? 'Tarifa cadastrada.' : 'Acordo corporativo cadastrado.')
      }
      closeEditor()
      await loadRates()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Não foi possível salvar a tarifa.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const title = scope === 'global' ? 'Tarifas padrão' : 'Acordos por grupo ou empresa'
  const description = scope === 'global'
    ? 'Valores gerais oferecidos pelo fornecedor para cada propriedade e tipo de quarto.'
    : 'Tarifas restritas a grupos econômicos e empresas selecionadas explicitamente.'

  return (
    <div className="space-y-6">
      <section className="bbt-card p-5" aria-labelledby={`supplier-rate-context-${scope}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id={`supplier-rate-context-${scope}`} className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
              {scope === 'global' ? <BadgeDollarSign className="h-4 w-4 text-bbt-accent" aria-hidden="true" /> : <FileCheck2 className="h-4 w-4 text-bbt-accent" aria-hidden="true" />}
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{description}</p>
          </div>
          <button type="button" onClick={() => void loadRates()} disabled={!selectedLinkId || loadingRates || formOpen} className="bbt-button-ghost h-10 px-3">
            <RefreshCw className={`h-4 w-4 ${loadingRates ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Field label="Hotel / vínculo" required>
            <select value={selectedLinkId} onChange={(event) => setSelectedLinkId(event.target.value)} className="bbt-input" disabled={loadingLinks || formOpen}>
              <option value="">Selecione um hotel vinculado</option>
              {links.map((link) => <option key={link.id} value={link.id}>{link.hotel.name} · {locationLabel(link)}{link.isActive ? '' : ' · inativo'}</option>)}
            </select>
          </Field>
          <Field label="Tipo de quarto">
            <select value={selectedRoomTypeId} onChange={(event) => setSelectedRoomTypeId(event.target.value)} className="bbt-input" disabled={!selectedLinkId || loadingLinks || formOpen}>
              <option value="">Todos os tipos de quarto</option>
              {roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.code} · até {room.maxGuests} hóspede(s)</option>)}
            </select>
          </Field>
        </div>
      </section>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      {loadingLinks ? (
        <State icon={Loader2} title="Carregando hotéis e quartos..." spin />
      ) : links.length === 0 ? (
        <State icon={Hotel} title="Nenhum hotel vinculado" description="Crie primeiro um vínculo na aba Hotéis vinculados." />
      ) : selectedLink && roomTypes.length === 0 ? (
        <State icon={Hotel} title="Hotel sem tipos de quarto" description="Cadastre ao menos um tipo de quarto ativo no catálogo do hotel para criar tarifas." />
      ) : (
        <section className="bbt-card overflow-hidden" aria-labelledby={`supplier-rate-list-${scope}`} aria-busy={loadingRates}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bbt-gray-100 p-5 dark:border-slate-700">
            <div>
              <h2 id={`supplier-rate-list-${scope}`} className="font-semibold text-bbt-primary dark:text-white">{scope === 'global' ? 'Grade de tarifas' : 'Grade de acordos'}</h2>
              <p className="mt-1 text-xs text-slate-500">{loadingRates ? 'Atualizando...' : `${visibleRates.length} registro(s). Os campos principais podem ser editados diretamente na linha.`}</p>
            </div>
            {canManage && selectedLink && roomTypes.length > 0 && !formOpen && <button type="button" onClick={openCreate} className="bbt-button-primary"><Plus className="h-4 w-4" aria-hidden="true" /> {scope === 'global' ? 'Nova tarifa' : 'Novo acordo'}</button>}
          </div>

          {loadingRates ? (
            <State icon={Loader2} title="Carregando tarifas..." spin compact />
          ) : visibleRates.length === 0 && !formOpen ? (
            <State icon={BadgeDollarSign} title={scope === 'global' ? 'Nenhuma tarifa cadastrada' : 'Nenhum acordo cadastrado'} description={scope === 'global' ? 'Cadastre o valor padrão para o hotel e o quarto selecionados.' : 'Cadastre uma tarifa e selecione explicitamente os grupos ou empresas autorizados.'} compact />
          ) : (
            <form onSubmit={(event) => void save(event)} aria-label={editing ? 'Editar tarifa na grade' : 'Cadastrar tarifa na grade'}>
              <p id={`supplier-rate-scroll-help-${scope}`} className="border-b border-bbt-gray-100 bg-cyan-50/60 px-4 py-2 text-xs text-cyan-800 md:hidden dark:border-slate-700 dark:bg-cyan-950/20 dark:text-cyan-200">
                Deslize horizontalmente para consultar e editar todas as colunas.
              </p>
              <div className="overflow-x-auto overscroll-x-contain" tabIndex={0} role="region" aria-label="Grade de tarifas com rolagem horizontal" aria-describedby={`supplier-rate-scroll-help-${scope}`}>
                <table className="w-full min-w-[1360px] table-fixed text-left text-sm">
                  <caption className="sr-only">{scope === 'global' ? 'Tarifas padrão do fornecedor com linhas editáveis' : 'Tarifas restritas por grupo ou empresa com linhas editáveis'}</caption>
                  <colgroup>
                    <col className="w-[210px]" />
                    <col className="w-[150px]" />
                    <col className="w-[230px]" />
                    <col className="w-[145px]" />
                    <col className="w-[145px]" />
                    <col className="w-[170px]" />
                    <col className="w-[180px]" />
                    <col className="w-[230px]" />
                    <col className="w-[100px]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600 dark:bg-slate-800/90 dark:text-slate-300">
                    <tr>
                      <th scope="col" className="px-3 py-3">Quarto</th>
                      <th scope="col" className="px-3 py-3">Código / moeda</th>
                      <th scope="col" className="px-3 py-3">Vigência</th>
                      <th scope="col" className="px-3 py-3 text-right">Tarifa balcão</th>
                      <th scope="col" className="px-3 py-3 text-right">Tarifa acordo</th>
                      <th scope="col" className="px-3 py-3 text-right">Taxas</th>
                      <th scope="col" className="px-3 py-3">Condições</th>
                      <th scope="col" className="px-3 py-3">Abrangência / status</th>
                      <th scope="col" className="px-3 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                    {formOpen && !editing && (
                      <EditableRateRows
                        key="new-rate"
                        draft={draft}
                        roomTypes={roomTypes}
                        scope={scope}
                        saving={saving}
                        formError={formError}
                        onChange={updateDraft}
                        onCancel={closeEditor}
                      />
                    )}
                    {visibleRates.map((rate) => editing?.id === rate.id && formOpen ? (
                      <EditableRateRows
                        key={rate.id}
                        draft={draft}
                        roomTypes={roomTypes}
                        scope={scope}
                        saving={saving}
                        formError={formError}
                        onChange={updateDraft}
                        onCancel={closeEditor}
                      />
                    ) : (
                      <RateReadOnlyRow key={rate.id} rate={rate} scope={scope} canManage={canManage && !formOpen} onEdit={() => openEdit(rate)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  )
}

function EditableRateRows({
  draft,
  roomTypes,
  scope,
  saving,
  formError,
  onChange,
  onCancel,
}: {
  draft: RateDraft
  roomTypes: HotelSupplierLink['roomTypes']
  scope: HotelSupplierRateScopeType
  saving: boolean
  formError: string
  onChange: RateDraftUpdater
  onCancel: () => void
}) {
  return (
    <>
      <tr data-rate-editor="inline" className="align-top bg-cyan-50/40 dark:bg-cyan-950/10">
        <td className="px-3 py-3">
          <GridLabel label="Tipo de quarto *">
            <select data-rate-field="roomTypeId" className="bbt-input min-w-0" value={draft.roomTypeId} onChange={(event) => onChange('roomTypeId', event.target.value)} disabled={saving} required>
              <option value="">Selecione</option>
              {roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name} | {room.code}</option>)}
            </select>
          </GridLabel>
        </td>
        <td className="space-y-2 px-3 py-3">
          <GridLabel label="Código *">
            <input data-rate-field="code" className="bbt-input min-w-0" value={draft.code} onChange={(event) => onChange('code', event.target.value)} disabled={saving} maxLength={120} required />
          </GridLabel>
          <GridLabel label="Moeda *">
            <input data-rate-field="currency" className="bbt-input min-w-0 uppercase" value={draft.currency} onChange={(event) => onChange('currency', event.target.value.toUpperCase())} disabled={saving} maxLength={3} minLength={3} required />
          </GridLabel>
        </td>
        <td className="space-y-2 px-3 py-3">
          <GridLabel label="Válida de *" asDiv>
            <DateInput data-rate-field="validFrom" aria-label="Início da vigência da tarifa" value={draft.validFrom} onChange={(event) => onChange('validFrom', event.target.value)} disabled={saving} required pickerLabel="Abrir calendário de início da tarifa" />
          </GridLabel>
          <GridLabel label="Até *" asDiv>
            <DateInput data-rate-field="validUntil" aria-label="Fim da vigência da tarifa" value={draft.validUntil} onChange={(event) => onChange('validUntil', event.target.value)} disabled={saving} required pickerLabel="Abrir calendário de fim da tarifa" />
          </GridLabel>
        </td>
        <td className="px-3 py-3">
          <GridMoneyInput dataField="rackAmount" label="Tarifa balcao" value={draft.rackAmount} currency={draft.currency} onChange={(value) => onChange('rackAmount', value)} disabled={saving} />
        </td>
        <td className="px-3 py-3">
          <GridMoneyInput dataField="agreementAmount" label="Tarifa acordo *" value={draft.agreementAmount} currency={draft.currency} onChange={(value) => onChange('agreementAmount', value)} disabled={saving} required />
        </td>
        <td className="space-y-2 px-3 py-3">
          <GridMoneyInput dataField="taxAmount" label="Impostos / taxas" value={draft.taxAmount} currency={draft.currency} onChange={(value) => onChange('taxAmount', value)} disabled={saving} />
          <GridMoneyInput dataField="serviceFeeAmount" label="Taxa de serviço" value={draft.serviceFeeAmount} currency={draft.currency} onChange={(value) => onChange('serviceFeeAmount', value)} disabled={saving} />
        </td>
        <td className="space-y-2 px-3 py-3">
          <GridLabel label="Regime">
            <input data-rate-field="mealPlan" className="bbt-input min-w-0" value={draft.mealPlan} onChange={(event) => onChange('mealPlan', event.target.value)} disabled={saving} placeholder="Ex.: Café da manhã" maxLength={200} />
          </GridLabel>
          <GridLabel label="Reembolsável">
            <select data-rate-field="refundable" className="bbt-input min-w-0" value={draft.refundable} onChange={(event) => onChange('refundable', event.target.value as RateDraft['refundable'])} disabled={saving}>
              <option value="">Não informado</option>
              <option value="yes">Sim</option>
              <option value="no">Não</option>
            </select>
          </GridLabel>
        </td>
        <td className="space-y-2 px-3 py-3">
          <GridCheckField dataField="isActive" label="Ativa" checked={draft.isActive} onChange={(value) => onChange('isActive', value)} disabled={saving} />
          <GridCheckField dataField="isSuspended" label="Suspensa" checked={draft.isSuspended} onChange={(value) => onChange('isSuspended', value)} disabled={saving} />
          <GridCheckField dataField="isNet" label="Tarifa líquida" checked={draft.isNet} onChange={(value) => onChange('isNet', value)} disabled={saving} />
          <p className="text-[11px] text-slate-500">{scope === 'global' ? 'Abrangência global' : `${draft.scopeTargets.length} abrangência(s)`}</p>
        </td>
        <td className="px-3 py-3 text-right">
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onCancel} disabled={saving} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:hover:bg-slate-800" aria-label="Cancelar edição da tarifa">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="submit" disabled={saving} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bbt-primary text-white hover:bg-bbt-primary/90 focus:outline-none focus:ring-2 focus:ring-bbt-accent/40 disabled:opacity-60" aria-label="Salvar tarifa">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </td>
      </tr>
      <tr className="bg-cyan-50/20 dark:bg-cyan-950/5">
        <td colSpan={9} className="px-4 pb-5 pt-1">
          <div className="rounded-xl border border-cyan-200 bg-white p-4 dark:border-cyan-900/70 dark:bg-slate-950">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Detalhes e condições da tarifa</h3>
              <p className="mt-1 text-xs text-slate-500">Complete os dados administrativos desta mesma linha antes de salvar.</p>
            </div>
            {formError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{formError}</div>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Condições de pagamento">
                <textarea data-rate-field="paymentTerms" className="bbt-input min-h-24 py-2" value={draft.paymentTerms} onChange={(event) => onChange('paymentTerms', event.target.value)} disabled={saving} maxLength={2000} />
              </Field>
              <Field label="Política de cancelamento">
                <textarea data-rate-field="cancellationPolicy" className="bbt-input min-h-24 py-2" value={draft.cancellationPolicy} onChange={(event) => onChange('cancellationPolicy', event.target.value)} disabled={saving} maxLength={4000} />
              </Field>
            </div>
            {scope === 'restricted' && (
              <div data-rate-field="scopeTargets">
                <ScopePicker selected={draft.scopeTargets} onChange={(scopeTargets) => onChange('scopeTargets', scopeTargets)} disabled={saving} />
              </div>
            )}
          </div>
        </td>
      </tr>
    </>
  )
}

function RateReadOnlyRow({
  rate,
  scope,
  canManage,
  onEdit,
}: {
  rate: HotelSupplierRate
  scope: HotelSupplierRateScopeType
  canManage: boolean
  onEdit: () => void
}) {
  return (
    <tr className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
      <td className="px-3 py-3">
        <div className="font-semibold text-bbt-primary dark:text-white">{rate.roomType.name}</div>
        <div className="mt-0.5 text-xs text-slate-500">{rate.roomType.code} | até {rate.roomType.maxGuests} hóspede(s)</div>
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-slate-800 dark:text-slate-100">{rate.code}</div>
        <div className="mt-0.5 text-xs text-slate-500">{rate.currency}{rate.isNet ? ' | líquida' : ''}</div>
      </td>
      <td className="px-3 py-3 text-xs">
        <div>{formatDate(rate.validFrom)}</div>
        <div className="text-slate-400">até</div>
        <div>{formatDate(rate.validUntil)}</div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{rate.rackAmount == null ? '—' : formatMoney(rate.rackAmount, rate.currency)}</td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums text-bbt-primary dark:text-white">{formatMoney(rate.agreementAmount, rate.currency)}</td>
      <td className="px-3 py-3 text-right text-xs tabular-nums">
        <div><span className="text-slate-500">Impostos</span> {formatMoney(rate.taxAmount, rate.currency)}</div>
        <div className="mt-1"><span className="text-slate-500">Serviço</span> {formatMoney(rate.serviceFeeAmount, rate.currency)}</div>
      </td>
      <td className="px-3 py-3 text-xs">
        <div className="font-medium text-slate-700 dark:text-slate-200">{rate.mealPlan || 'Regime não informado'}</div>
        <div className="mt-1 text-slate-500">{rate.refundable == null ? 'Reembolso não informado' : rate.refundable ? 'Reembolsável' : 'Não reembolsável'}</div>
        {(rate.paymentTerms || rate.cancellationPolicy) && <div className="mt-1 text-slate-500" title={[rate.paymentTerms, rate.cancellationPolicy].filter(Boolean).join(' | ')}>Pagamento/cancelamento informado</div>}
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {scope === 'restricted' && rate.scopeTargets.slice(0, 3).map((target) => <span key={`${target.type}:${target.id}`} className="bbt-badge bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">{target.name}</span>)}
          {scope === 'restricted' && rate.scopeTargets.length > 3 && <span className="bbt-badge bg-slate-100 text-slate-600">+{rate.scopeTargets.length - 3}</span>}
          {scope === 'global' && <span className="bbt-badge bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">Global</span>}
          <RateStatus rate={rate} />
        </div>
      </td>
      <td className="px-3 py-3 text-right">
        {canManage && <button type="button" onClick={onEdit} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-300 dark:hover:bg-cyan-950/30" aria-label={`Editar tarifa ${rate.code}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>}
      </td>
    </tr>
  )
}

function GridLabel({ label, children, asDiv = false }: { label: string; children: React.ReactNode; asDiv?: boolean }) {
  const content = <><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</>
  return asDiv ? <div>{content}</div> : <label className="block">{content}</label>
}

function GridMoneyInput({ dataField, label, value, currency, onChange, disabled, required = false }: { dataField: keyof RateDraft; label: string; value: string; currency: string; onChange: (value: string) => void; disabled: boolean; required?: boolean }) {
  return (
    <GridLabel label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400">{currency || 'BRL'}</span>
        <input data-rate-field={dataField} className="bbt-input min-w-0 pl-10 text-right tabular-nums" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} inputMode="decimal" placeholder="0,00" required={required} />
      </div>
    </GridLabel>
  )
}

function GridCheckField({ dataField, label, checked, onChange, disabled }: { dataField: keyof RateDraft; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled: boolean }) {
  return <label className="flex min-h-8 items-center gap-2 rounded-lg border border-bbt-gray-100 px-2 py-1 text-xs dark:border-slate-700"><input data-rate-field={dataField} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="h-4 w-4 accent-bbt-accent" /> {label}</label>
}

function ScopePicker({ selected, onChange, disabled }: { selected: string[]; onChange: (values: string[]) => void; disabled: boolean }) {
  const { empresas, gruposEmpresariais } = useStore()
  const [search, setSearch] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const normalized = search.trim().toLocaleLowerCase('pt-BR')
  const groups = gruposEmpresariais.filter((group) => group.ativo && (!normalized || `${group.nome} ${group.codigo || ''}`.toLocaleLowerCase('pt-BR').includes(normalized)))
  const companies = empresas.filter((company) => company.ativa && (!normalized || `${company.nome} ${company.cnpj}`.toLocaleLowerCase('pt-BR').includes(normalized)))

  function toggle(key: string) {
    onChange(selectedSet.has(key) ? selected.filter((value) => value !== key) : [...selected, key])
  }

  return (
    <fieldset className="mt-5 rounded-xl border border-purple-200 p-4 dark:border-purple-900/60">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">Abrangência obrigatória</legend>
      <p className="text-xs text-slate-500">Marque um ou mais grupos e/ou empresas autorizados a usar este acordo.</p>
      <label className="relative mt-3 block">
        <span className="sr-only">Buscar grupo ou empresa</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input type="search" className="bbt-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} disabled={disabled} placeholder="Buscar grupo, empresa ou CNPJ..." />
      </label>
      <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
        {groups.length > 0 && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Grupos econômicos</p><div className="space-y-1">{groups.map((group) => <ScopeOption key={group.id} label={group.nome} detail={`${group.empresa_ids.length} empresa(s)`} checked={selectedSet.has(targetKey('group', group.id))} onChange={() => toggle(targetKey('group', group.id))} disabled={disabled} />)}</div></div>}
        {companies.length > 0 && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Empresas individuais</p><div className="space-y-1">{companies.map((company) => <ScopeOption key={company.id} label={company.nome} detail={company.cnpj} checked={selectedSet.has(targetKey('company', company.id))} onChange={() => toggle(targetKey('company', company.id))} disabled={disabled} />)}</div></div>}
        {groups.length === 0 && companies.length === 0 && <p className="py-4 text-center text-xs text-slate-500">Nenhum grupo ou empresa encontrado.</p>}
      </div>
      <p className={`mt-3 text-xs font-semibold ${selected.length ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{selected.length ? `${selected.length} abrangência(s) selecionada(s).` : 'Selecione ao menos uma abrangência.'}</p>
    </fieldset>
  )
}

function ScopeOption({ label, detail, checked, onChange, disabled }: { label: string; detail: string; checked: boolean; onChange: () => void; disabled: boolean }) {
  return <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-bbt-gray-100 px-3 py-2 text-sm hover:border-purple-300 dark:border-slate-700"><input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="h-4 w-4 accent-purple-600" /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-bbt-primary dark:text-white">{label}</span><span className="block truncate text-[11px] text-slate-500">{detail}</span></span></label>
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}</label>
}

function State({ icon: Icon, title, description, spin = false, compact = false }: { icon: typeof Hotel; title: string; description?: string; spin?: boolean; compact?: boolean }) {
  return <div className={`bbt-card flex flex-col items-center justify-center p-8 text-center ${compact ? 'min-h-64 rounded-none border-0 shadow-none' : 'min-h-72'}`} role="status"><Icon className={`h-7 w-7 text-slate-400 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" /><p className="mt-3 font-semibold text-bbt-primary dark:text-white">{title}</p>{description && <p className="mt-1 max-w-lg text-sm text-slate-500">{description}</p>}</div>
}

function RateStatus({ rate }: { rate: HotelSupplierRate }) {
  if (!rate.isActive) return <span className="bbt-badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Inativa</span>
  if (rate.isSuspended) return <span className="bbt-badge bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Suspensa</span>
  return <span className="bbt-badge bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Ativa</span>
}

function rateToDraft(rate: HotelSupplierRate): RateDraft {
  return {
    roomTypeId: rate.roomTypeId,
    code: rate.code,
    validFrom: rate.validFrom,
    validUntil: rate.validUntil,
    currency: rate.currency,
    rackAmount: rate.rackAmount == null ? '' : moneyInput(rate.rackAmount),
    agreementAmount: moneyInput(rate.agreementAmount),
    taxAmount: moneyInput(rate.taxAmount),
    serviceFeeAmount: moneyInput(rate.serviceFeeAmount),
    isNet: rate.isNet,
    isSuspended: rate.isSuspended,
    isActive: rate.isActive,
    refundable: rate.refundable == null ? '' : rate.refundable ? 'yes' : 'no',
    mealPlan: rate.mealPlan || '',
    cancellationPolicy: rate.cancellationPolicy || '',
    paymentTerms: rate.paymentTerms || '',
    scopeTargets: rate.scopeTargets.map((target) => targetKey(target.type, target.id)),
  }
}

function validateRateDraft(draft: RateDraft, scope: HotelSupplierRateScopeType): string | null {
  if (!draft.roomTypeId) return 'Selecione o tipo de quarto.'
  if (!draft.code.trim()) return 'Informe o código da tarifa.'
  if (!draft.validFrom || !draft.validUntil) return 'Informe a vigência completa.'
  if (draft.validUntil < draft.validFrom) return 'A data final deve ser igual ou posterior à data inicial.'
  if (draft.currency.trim().length !== 3) return 'A moeda deve ter três letras, como BRL.'
  for (const [label, value, required] of [
    ['tarifa balcão', draft.rackAmount, false],
    ['tarifa acordo', draft.agreementAmount, true],
    ['impostos e taxas', draft.taxAmount, false],
    ['taxa de serviço', draft.serviceFeeAmount, false],
  ] as const) {
    if (required && !value.trim()) return `Informe a ${label}.`
    if (!value.trim()) continue
    const amount = optionalMoney(value)
    if (amount == null || !Number.isFinite(amount) || amount < 0) return `Informe um valor válido e não negativo para ${label}.`
  }
  if (scope === 'restricted' && draft.scopeTargets.length === 0) return 'Selecione ao menos um grupo ou empresa para o acordo.'
  return null
}

function optionalMoney(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : Number.NaN
}

function requiredMoney(value: string): number {
  return optionalMoney(value) as number
}

function moneyInput(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function targetKey(type: HotelSupplierRateScopeTargetType, id: string): string {
  return `${type}:${id}`
}

function parseTargetKey(value: string): { type: HotelSupplierRateScopeTargetType; id: string } {
  const [type, ...id] = value.split(':')
  return { type: type as HotelSupplierRateScopeTargetType, id: id.join(':') }
}

function locationLabel(link: HotelSupplierLink): string {
  return [link.hotel.cityName, link.hotel.subdivisionCode, link.hotel.countryCode].filter(Boolean).join(' / ') || 'sem localidade'
}
