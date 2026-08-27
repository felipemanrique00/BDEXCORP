'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCog,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { DateInput } from '@/components/ui/date-input'
import {
  WINTOUR_PAYMENT_METHODS,
  WINTOUR_UPDATE_FIELDS,
  bindWintourSaleNumberOnServer,
  createWintourSaleAdjustmentOnServer,
  discoverWintourSalesOnServer,
  downloadWintourSyncXmlFromServer,
  getWintourSyncDashboardFromServer,
  prepareWintourSyncSaleOnServer,
  reconcileWintourSyncJobOnServer,
  retryWintourSyncJobOnServer,
  saveWintourSyncSettingsOnServer,
  type WintourAdjustmentChangeClient,
  type WintourOutboundUiState,
  type WintourReconcileTargetState,
  type WintourSaleLinkClient,
  type WintourSyncDashboardClient,
  type WintourSyncSettingsClient,
  type WintourUpdateFieldCode,
} from '@/lib/wintour-sync-client'

const EMPTY_SETTINGS: WintourSyncSettingsClient = {
  enabled: false,
  agencyName: '',
  syncFrom: '',
  maxAttempts: 3,
  discoveryBatchSize: 100,
  branchId: null,
  branchName: null,
  freeField: null,
  productCodes: { air: null, hotel: null, car: null, bus: null },
  paymentMethodCodes: {
    faturado: 'IV',
    pix: 'PX',
    cartao_corporativo: null,
    cartao_agencia: null,
    transferencia: null,
    dinheiro: 'CA',
    outro: null,
  },
  serviceRouteTypes: { air: 1, hotel: 2, car: 3, bus: null },
  tariffNetDefault: 0,
  accountDefaults: {
    issuer: null,
    promoter: null,
    manager: null,
    supplier: null,
    agencyCostCenter: null,
    cardCp: null,
    cardMp: null,
    additionalFee: null,
    additionalFee2: null,
    issuanceFee: null,
  },
  customerAction: 'none',
  autoSend: false,
  autoPoll: false,
  companyMappings: [],
  version: null,
  updatedAt: null,
}

const STATE_META: Record<WintourOutboundUiState, { label: string; classes: string }> = {
  blocked: { label: 'Bloqueados', classes: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300' },
  ready: { label: 'Prontos', classes: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' },
  ambiguous: { label: 'Resposta ambígua', classes: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300' },
  protocol: { label: 'Com protocolo', classes: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300' },
  manual_review: { label: 'Revisão manual', classes: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300' },
  completed: { label: 'Concluídos', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' },
}

const BLOCKED_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  settings_disabled: 'A sincronização Wintour está desativada para esta empresa.',
  company_mapping_missing: 'Associe a empresa a uma conta de cliente do Wintour.',
  emission_issuer_missing: 'A emissão não identifica o usuário emissor.',
  emissor_mapping_missing: 'Associe o emissor a um usuário correspondente no Wintour.',
  emissor_mapping_ambiguous: 'Há mais de uma associação possível para o emissor.',
  service_type_unsupported: 'O tipo de serviço desta emissão ainda não é compatível com a integração.',
  product_mapping_missing: 'Configure o produto Wintour correspondente a este serviço.',
  route_type_mapping_missing: 'Configure o tipo de roteiro Wintour correspondente a este serviço.',
  tariff_net_default_missing: 'Defina se a tarifa padrão deve ser tratada como líquida.',
  creation_sale_input_missing: 'A emissão não contém todos os dados necessários para montar a venda.',
  air_ticket_amount_allocation_missing: 'Não foi possível conciliar os valores entre os bilhetes aéreos.',
  air_ticket_amount_allocation_inconsistent: 'Os valores do bilhete divergem dos totais conciliados da emissão.',
  source_changed_after_wintour_link: 'A emissão foi alterada depois de ser vinculada ao Wintour.',
  source_changed_in_flight: 'A emissão mudou enquanto a sincronização estava em andamento.',
  source_changed_after_prepare: 'A emissão foi alterada depois da preparação do arquivo.',
  source_changed_or_ineligible_after_prepare: 'A emissão ou um de seus itens mudou e deixou de ser elegível depois da preparação do arquivo.',
  configuration_changed_after_prepare: 'A parametrização Wintour mudou depois da preparação; gere um novo arquivo.',
  artifact_preparation_failed: 'Não foi possível preparar o arquivo desta venda com segurança.',
  source_provider_unsupported: 'A origem desta emissão ainda não é compatível com a exportação Wintour.',
  canonical_hotel_mapping_unavailable: 'A exportação segura de hotel ainda não está disponível.',
  canonical_car_mapping_unavailable: 'A exportação segura de locação de carro ainda não está disponível.',
  canonical_bus_mapping_unavailable: 'A exportação segura de serviço rodoviário ainda não está disponível.',
  currency_unsupported: 'A moeda da emissão não é aceita por esta integração.',
  currency_mismatch: 'Os itens da emissão possuem moedas incompatíveis entre si.',
  currency_brl_required: 'A exportação automática aceita somente emissões integralmente em reais.',
  amount_invalid: 'Os valores da emissão estão ausentes ou não puderam ser conciliados.',
  emission_amounts_inconsistent: 'Os totais da emissão e da reserva não puderam ser conciliados.',
  payment_method_missing: 'Informe a forma de pagamento utilizada na emissão.',
  payment_mapping_missing: 'Associe a forma de pagamento ao código correspondente no Wintour.',
  payment_account_missing: 'Configure a conta necessária para esta forma de pagamento.',
  payment_split_missing: 'O detalhamento dos pagamentos da emissão está incompleto.',
  payment_card_cp_account_missing: 'Configure a conta de cartão CP exigida pela forma de pagamento.',
  payment_card_mp_account_missing: 'Configure a conta de cartão MP exigida pela forma de pagamento.',
  payment_split_mapping_unsupported: 'Esta forma de pagamento exige um rateio ainda não suportado.',
  customer_action_unsupported: 'A ação de cliente configurada não é compatível com esta venda.',
  customer_data_mapping_unsupported: 'A inclusão ou alteração automática do cliente ainda não é suportada.',
  air_details_missing: 'Os dados do serviço aéreo estão incompletos.',
  air_demand_details_missing: 'Os dados do pedido aéreo necessários para classificar o roteiro estão incompletos.',
  air_ticket_missing: 'A emissão não possui um bilhete aéreo identificável.',
  emission_status_not_exportable: 'O status atual da emissão não permite exportação ao Wintour.',
  air_ticket_status_not_issued: 'O bilhete não está mais no status emitido.',
  air_emission_contains_non_issued_ticket: 'A emissão contém outro bilhete que não está emitido e precisa de revisão.',
  air_ticket_number_missing_or_too_long: 'O número do bilhete aéreo está ausente ou excede o limite do Wintour.',
  air_ticket_number_invalid_length: 'O número do bilhete deve ter exatamente 10 caracteres (formulário e documento) para o Wintour.',
  air_ticket_count_invalid: 'A quantidade de bilhetes da emissão precisa ser revisada.',
  air_ticket_number_incompatible: 'O número do bilhete não está no formato aceito pelo Wintour.',
  air_provider_missing: 'A companhia aérea ou o fornecedor do bilhete não foi identificado.',
  air_provider_missing_or_too_long: 'A companhia aérea ou o fornecedor está ausente ou excede o limite do Wintour.',
  air_provider_ambiguous_across_segments: 'O itinerário envolve mais de uma companhia e não informa de forma segura a transportadora emissora.',
  air_provider_mismatch_with_segments: 'A companhia emissora do bilhete diverge da companhia identificada nos trechos.',
  air_locator_missing_or_too_long: 'O localizador está ausente ou excede o limite do Wintour.',
  air_traveler_missing: 'O viajante do bilhete não foi identificado.',
  air_passenger_missing_or_too_long: 'O nome do passageiro está ausente ou excede o limite do Wintour.',
  air_traveler_name_mismatch: 'O nome do viajante diverge entre os dados da emissão.',
  air_birth_date_missing: 'Informe a data de nascimento exigida para este passageiro.',
  air_passenger_birth_date_missing_or_invalid: 'A data de nascimento necessária para classificar o passageiro está ausente ou inválida.',
  air_passenger_type_ambiguous: 'Não foi possível determinar com segurança o tipo do passageiro.',
  air_itinerary_missing: 'O itinerário aéreo está incompleto.',
  air_itinerary_status_invalid: 'O status de um trecho aéreo não é aceito pela integração.',
  air_itinerary_sequence_invalid: 'A sequência dos trechos aéreos precisa ser revisada.',
  air_segments_missing: 'A emissão não contém trechos aéreos utilizáveis.',
  air_segments_not_fully_issued_or_ordered: 'Os trechos precisam estar emitidos e na sequência correta.',
  air_segment_datetime_invalid: 'A data ou o horário de um trecho aéreo é inválido.',
  air_airport_timezone_missing: 'Não foi possível determinar o fuso horário de um aeroporto.',
  air_airport_timezone_missing_or_ambiguous: 'O fuso horário ou o país de um aeroporto não foi identificado com segurança.',
  air_airport_ambiguous: 'Não foi possível identificar um aeroporto de forma inequívoca.',
  air_unmapped_rav_rac: 'Há valores de RAV ou RAC sem parametrização para o Wintour.',
  air_rav_rac_allocation_unsupported: 'A emissão possui RAV ou RAC sem regra segura de distribuição.',
  air_reservation_amounts_inconsistent: 'Os valores aéreos da reserva divergem dos totais da emissão.',
  canonical_dates_invalid: 'As datas da emissão ou da solicitação são inválidas.',
  requester_name_too_long: 'O nome do solicitante excede o limite aceito pelo Wintour.',
  cost_center_code_too_long: 'O código do centro de custo excede o limite aceito pelo Wintour.',
  demand_number_too_long: 'O número da solicitação excede o limite aceito pelo Wintour.',
  employee_department_too_long: 'O departamento do viajante excede o limite aceito pelo Wintour.',
  employee_registration_too_long: 'A matrícula do viajante excede o limite aceito pelo Wintour.',
  poll_limit_exhausted: 'O limite seguro de consultas do protocolo foi atingido; faça a conciliação manual no Wintour.',
})

function blockedReasonLabel(reason: string): string {
  return BLOCKED_REASON_LABELS[reason]
    || 'Esta venda precisa de revisão antes de ser enviada ao Wintour.'
}

type AdjustmentDraftChange = {
  id: string
  field: WintourUpdateFieldCode
  content: string
  appendToExisting: boolean
  keepValuesOnCancellation: boolean
}

let nextDraftChangeId = 1

function newAdjustmentChange(): AdjustmentDraftChange {
  return {
    id: `change-${nextDraftChangeId++}`,
    field: 'vl_tarifa',
    content: '',
    appendToExisting: false,
    keepValuesOnCancellation: false,
  }
}

export function WintourOutboundPanel({
  canManage,
  canConfigure,
}: {
  canManage: boolean
  canConfigure: boolean
}) {
  const [dashboard, setDashboard] = useState<WintourSyncDashboardClient | null>(null)
  const [settings, setSettings] = useState<WintourSyncSettingsClient>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [stateFilter, setStateFilter] = useState<WintourOutboundUiState | ''>('')
  const [mappingCompanyId, setMappingCompanyId] = useState('')
  const [mappingCode, setMappingCode] = useState('')
  const [selectedSaleLinkId, setSelectedSaleLinkId] = useState('')
  const [saleNumber, setSaleNumber] = useState('')
  const [saleNumberReason, setSaleNumberReason] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [recalculate, setRecalculate] = useState(false)
  const [changes, setChanges] = useState<AdjustmentDraftChange[]>([newAdjustmentChange()])
  const [retryJobId, setRetryJobId] = useState('')
  const [retryReason, setRetryReason] = useState('')
  const [reconcileJobId, setReconcileJobId] = useState('')
  const [reconcileTarget, setReconcileTarget] = useState<WintourReconcileTargetState>('completed')
  const [reconcileSaleNumber, setReconcileSaleNumber] = useState('')
  const [reconcileReason, setReconcileReason] = useState('')

  const selectedSaleLink = useMemo(
    () => dashboard?.saleLinks.find((item) => item.id === selectedSaleLinkId) || null,
    [dashboard?.saleLinks, selectedSaleLinkId],
  )

  const retryJob = useMemo(
    () => dashboard?.jobs.find((item) => item.id === retryJobId) || null,
    [dashboard?.jobs, retryJobId],
  )

  const reconcileJob = useMemo(
    () => dashboard?.jobs.find((item) => item.id === reconcileJobId) || null,
    [dashboard?.jobs, reconcileJobId],
  )

  const visibleJobs = useMemo(
    () => dashboard?.jobs.filter((job) => !stateFilter || job.uiState === stateFilter) || [],
    [dashboard?.jobs, stateFilter],
  )

  const availableCompanies = useMemo(
    () => (dashboard?.availableCompanies || [])
      .filter((company) => !settings.companyMappings.some((mapping) => mapping.companyId === company.id))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [dashboard?.availableCompanies, settings.companyMappings],
  )

  async function loadDashboard(silent = false) {
    if (!canManage) return
    if (!silent) setLoading(true)
    setError('')
    try {
      const next = await getWintourSyncDashboardFromServer({ limit: 100 })
      setDashboard(next)
      setSettings(next.settings)
      setSelectedSaleLinkId((current) => (
        current && next.saleLinks.some((item) => item.id === current)
          ? current
          : next.saleLinks[0]?.id || ''
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a sincronização Wintour.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  useEffect(() => {
    setSaleNumber(selectedSaleLink?.wintourSaleNumber || '')
  }, [selectedSaleLink])

  async function saveSettings() {
    if (!canConfigure) return
    if (!settings.agencyName.trim()) {
      toast.error('Informe o nome da agência usado no arquivo Wintour.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.syncFrom)) {
      toast.error('Informe a data inicial da sincronização.')
      return
    }
    if (settings.tariffNetDefault === null) {
      toast.error('Defina se a tarifa padrão é net ou não net.')
      return
    }
    setBusy('settings')
    try {
      const saved = await saveWintourSyncSettingsOnServer({
        ...settings,
        version: settings.version,
      })
      setSettings(saved)
      await loadDashboard(true)
      toast.success('Configuração de envio ao Wintour salva.')
    } catch (saveError) {
      toast.error(messageFrom(saveError, 'Não foi possível salvar a configuração.'))
    } finally {
      setBusy('')
    }
  }

  async function discover() {
    setBusy('discover')
    try {
      await discoverWintourSalesOnServer()
      await loadDashboard(true)
      toast.success('Emissões elegíveis atualizadas.')
    } catch (discoverError) {
      toast.error(messageFrom(discoverError, 'Não foi possível buscar as emissões.'))
    } finally {
      setBusy('')
    }
  }

  async function prepare(saleLinkId: string, expectedVersion: number) {
    setBusy(`prepare:${saleLinkId}`)
    try {
      await prepareWintourSyncSaleOnServer(saleLinkId, expectedVersion)
      await loadDashboard(true)
      toast.success('Venda preparada para o Wintour.')
    } catch (prepareError) {
      toast.error(messageFrom(prepareError, 'Não foi possível preparar a venda.'))
    } finally {
      setBusy('')
    }
  }

  async function download(jobId: string) {
    setBusy(`download:${jobId}`)
    try {
      const file = await downloadWintourSyncXmlFromServer(jobId)
      const href = URL.createObjectURL(file.blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = file.filename
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (downloadError) {
      toast.error(messageFrom(downloadError, 'Não foi possível baixar o arquivo.'))
    } finally {
      setBusy('')
    }
  }

  async function retryFailedJob() {
    if (!retryJob) return
    const reason = retryReason.trim()
    if (reason.length < 5) {
      toast.error('Informe o motivo da nova tentativa com pelo menos 5 caracteres.')
      return
    }
    setBusy(`retry:${retryJob.id}`)
    try {
      await retryWintourSyncJobOnServer({
        jobId: retryJob.id,
        expectedJobVersion: retryJob.version,
        reason,
      })
      setRetryJobId('')
      setRetryReason('')
      await loadDashboard(true)
      toast.success('A venda foi liberada para uma nova tentativa automática.')
    } catch (retryError) {
      toast.error(messageFrom(retryError, 'Não foi possível liberar uma nova tentativa.'))
    } finally {
      setBusy('')
    }
  }

  async function reconcileJobManually() {
    if (!reconcileJob) return
    const reason = reconcileReason.trim()
    if (reason.length < 5) {
      toast.error('Informe o motivo da reconciliação com pelo menos 5 caracteres.')
      return
    }
    const saleNumber = reconcileSaleNumber.trim()
    if (reconcileTarget === 'completed'
        && reconcileJob.operation === 'create'
        && !reconcileJob.wintourSaleNumber
        && !/^[1-9][0-9]{0,9}$/.test(saleNumber)) {
      toast.error('Para concluir uma nova venda, informe o número Wintour com até 10 dígitos.')
      return
    }
    setBusy(`reconcile:${reconcileJob.id}`)
    try {
      await reconcileWintourSyncJobOnServer({
        jobId: reconcileJob.id,
        expectedJobVersion: reconcileJob.version,
        targetState: reconcileTarget,
        wintourSaleNumber: reconcileTarget === 'completed'
          && reconcileJob.operation === 'create'
          && !reconcileJob.wintourSaleNumber
          ? saleNumber
          : undefined,
        reason,
      })
      setReconcileJobId('')
      setReconcileReason('')
      setReconcileSaleNumber('')
      setReconcileTarget('completed')
      await loadDashboard(true)
      toast.success('Situação Wintour reconciliada manualmente.')
    } catch (reconcileError) {
      toast.error(messageFrom(reconcileError, 'Não foi possível reconciliar esta venda.'))
    } finally {
      setBusy('')
    }
  }

  function addMapping() {
    const company = dashboard?.availableCompanies.find((item) => item.id === mappingCompanyId)
    const code = mappingCode.trim()
    if (!company || !code) {
      toast.error('Selecione a empresa e informe a conta correspondente no Wintour.')
      return
    }
    setSettings((current) => ({
      ...current,
      companyMappings: [
        ...current.companyMappings,
        { companyId: company.id, companyName: company.name, wintourAccountCode: code },
      ],
    }))
    setMappingCompanyId('')
    setMappingCode('')
  }

  async function bindSaleNumber() {
    if (!selectedSaleLink) return
    const normalized = saleNumber.trim()
    if (!/^\d{1,10}$/.test(normalized)) {
      toast.error('Informe o número numérico da venda no Wintour, com até 10 dígitos.')
      return
    }
    const reason = saleNumberReason.trim()
    if (reason.length < 5) {
      toast.error('Informe o motivo do vínculo manual com pelo menos 5 caracteres.')
      return
    }
    setBusy('bind-sale')
    try {
      await bindWintourSaleNumberOnServer({
        saleLinkId: selectedSaleLink.id,
        expectedVersion: selectedSaleLink.version,
        wintourSaleNumber: normalized,
        reason,
      })
      setSaleNumberReason('')
      await loadDashboard(true)
      toast.success('Número da venda Wintour vinculado.')
    } catch (bindError) {
      toast.error(messageFrom(bindError, 'Não foi possível vincular a venda.'))
    } finally {
      setBusy('')
    }
  }

  function updateChange(id: string, patch: Partial<AdjustmentDraftChange>) {
    setChanges((current) => {
      const next = current.map((item) => item.id === id ? { ...item, ...patch } : item)
      const changed = next.find((item) => item.id === id)
      return changed?.field === 'id_pa' ? [changed] : next
    })
  }

  async function createAdjustment() {
    if (!selectedSaleLink) {
      toast.error('Selecione uma venda emitida.')
      return
    }
    if (!selectedSaleLink.wintourSaleNumber) {
      toast.error('Vincule primeiro o número da venda no Wintour.')
      return
    }
    const reason = adjustmentReason.trim()
    if (reason.length < 5) {
      toast.error('Informe o motivo da alteração com pelo menos 5 caracteres.')
      return
    }
    const duplicate = changes.find((item, index) => changes.findIndex((other) => other.field === item.field) !== index)
    if (duplicate) {
      toast.error('Cada campo pode aparecer apenas uma vez na alteração.')
      return
    }
    if (changes.some((item) => !item.content.trim())) {
      toast.error('Informe o novo conteúdo de todos os campos selecionados.')
      return
    }
    const normalizedChanges: WintourAdjustmentChangeClient[] = changes.map((item) => {
      const field = WINTOUR_UPDATE_FIELDS.find((candidate) => candidate.code === item.field)!
      const content = field.kind === 'date' ? toWintourDate(item.content) : item.content.trim()
      if (field.kind === 'append' && item.appendToExisting) return { field: item.field, content, remark: 'append' }
      if (item.field === 'fop' && content.toUpperCase() === 'XX' && item.keepValuesOnCancellation) {
        return { field: item.field, content: 'XX', remark: 'xxmanter' }
      }
      return { field: item.field, content }
    })

    setBusy('adjustment')
    try {
      await createWintourSaleAdjustmentOnServer({
        saleLinkId: selectedSaleLink.id,
        expectedVersion: selectedSaleLink.version,
        reason,
        recalculateCalculatedFields: recalculate,
        changes: normalizedChanges,
      })
      setAdjustmentReason('')
      setChanges([newAdjustmentChange()])
      setRecalculate(false)
      await loadDashboard(true)
      toast.success('Alteração preparada. Ela ainda deverá ser processada na mesa do Wintour.')
    } catch (adjustmentError) {
      toast.error(messageFrom(adjustmentError, 'Não foi possível criar a alteração.'))
    } finally {
      setBusy('')
    }
  }

  if (!canManage) {
    return (
      <div className="bbt-card p-5 text-sm text-slate-600 dark:text-slate-300">
        Você não possui a permissão de gerenciamento de integrações para enviar vendas ao Wintour.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bbt-card p-10 text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-bbt-accent" />
        <p className="text-sm text-slate-500">Carregando a fila de sincronização...</p>
      </div>
    )
  }

  if (error && !dashboard) {
    return (
      <div className="bbt-card p-6">
        <div className="flex items-start gap-3 text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Não foi possível abrir a sincronização</p>
            <p className="mt-1 text-sm">{error}</p>
            <button type="button" onClick={() => void loadDashboard()} className="bbt-button-ghost mt-3">
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {canConfigure ? (
      <section className="bbt-card p-5 space-y-5" aria-labelledby="wintour-outbound-settings">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="wintour-outbound-settings" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
              <Settings2 className="h-5 w-5 text-bbt-accent" /> Configuração de saída
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Defina a agência, a data inicial e os vínculos usados para preparar vendas. Credenciais de integração não são exibidas nesta tela.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Preparação de vendas habilitada
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Nome da agência no Wintour">
            <input
              value={settings.agencyName}
              onChange={(event) => setSettings((current) => ({ ...current, agencyName: event.target.value }))}
              className="bbt-input w-full"
              maxLength={50}
            />
          </Field>
          <Field label="Sincronizar emissões a partir de">
            <DateInput
              value={settings.syncFrom}
              onChange={(event) => setSettings((current) => ({ ...current, syncFrom: event.target.value }))}
              className="w-full"
              pickerLabel="Abrir calendário da data inicial de sincronização"
            />
          </Field>
          <Field label="ID da filial no Wintour (opcional)">
            <input
              type="number"
              min={1}
              max={2_147_483_647}
              value={settings.branchId ?? ''}
              onChange={(event) => setSettings((current) => ({
                ...current,
                branchId: event.target.value ? Number(event.target.value) : null,
              }))}
              className="bbt-input w-full"
            />
          </Field>
          <Field label="Nome da filial (opcional)">
            <input value={settings.branchName || ''} onChange={(event) => setSettings((current) => ({ ...current, branchName: event.target.value.trimStart() || null }))} className="bbt-input w-full" maxLength={60} />
          </Field>
        </div>

        <div className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold">Códigos de produto e pagamento</h3>
          <p className="mt-1 text-xs text-slate-500">Mapeamentos internos para os códigos oficiais aceitos pelo layout do Wintour.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <ProductCodeField label="Produto aéreo" field="air" settings={settings} setSettings={setSettings} />
            <ProductCodeField label="Produto hotel" field="hotel" settings={settings} setSettings={setSettings} />
            <ProductCodeField label="Produto locação" field="car" settings={settings} setSettings={setSettings} />
            <ProductCodeField label="Produto rodoviário" field="bus" settings={settings} setSettings={setSettings} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <PaymentMappingField label="Faturado" field="faturado" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Pix" field="pix" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Cartão corporativo" field="cartao_corporativo" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Cartão agência" field="cartao_agencia" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Transferência" field="transferencia" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Dinheiro" field="dinheiro" settings={settings} setSettings={setSettings} />
            <PaymentMappingField label="Outro" field="outro" settings={settings} setSettings={setSettings} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <ServiceRouteField label="Roteiro aéreo" field="air" settings={settings} setSettings={setSettings} />
            <ServiceRouteField label="Roteiro hotel" field="hotel" settings={settings} setSettings={setSettings} />
            <ServiceRouteField label="Roteiro locação" field="car" settings={settings} setSettings={setSettings} />
            <ServiceRouteField label="Roteiro rodoviário" field="bus" settings={settings} setSettings={setSettings} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Tarifa padrão (obrigatório)">
              <select value={settings.tariffNetDefault ?? ''} onChange={(event) => setSettings((current) => ({ ...current, tariffNetDefault: event.target.value === '' ? null : Number(event.target.value) as 0 | 1 }))} className="bbt-input w-full">
                <option value="">Selecione</option>
                <option value="0">0 — tarifa não é net</option>
                <option value="1">1 — tarifa é net</option>
              </select>
            </Field>
            <Field label="Ação de cadastro do cliente">
              <select value={settings.customerAction} onChange={(event) => setSettings((current) => ({ ...current, customerAction: event.target.value as WintourSyncSettingsClient['customerAction'] }))} className="bbt-input w-full">
                <option value="none">Não incluir nem atualizar</option>
                <option value="I">Incluir</option>
                <option value="U">Atualizar</option>
                <option value="IU">Incluir ou atualizar</option>
              </select>
            </Field>
            <Field label="Campo livre (opcional)">
              <textarea value={settings.freeField || ''} onChange={(event) => setSettings((current) => ({ ...current, freeField: event.target.value || null }))} className="bbt-input min-h-16 w-full" maxLength={1200} />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold">Contas padrão</h3>
          <p className="mt-1 text-xs text-slate-500">Valores usados somente quando a emissão não fornecer uma conta específica.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <DefaultCodeField label="Emissor" field="issuer" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Promotor" field="promoter" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Gerente" field="manager" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Fornecedor" field="supplier" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Centro de custo da agência" field="agencyCostCenter" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Cartão CP" field="cardCp" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Cartão MP" field="cardMp" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Taxa adicional 1" field="additionalFee" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Taxa adicional 2" field="additionalFee2" settings={settings} setSettings={setSettings} />
            <DefaultCodeField label="Taxa de emissão" field="issuanceFee" settings={settings} setSettings={setSettings} />
          </div>
        </div>

        <div className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold">Mapeamento de empresas</h3>
          <p className="mt-1 text-xs text-slate-500">Relacione a empresa do BBT à conta correspondente no Wintour.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_auto]">
            <select value={mappingCompanyId} onChange={(event) => setMappingCompanyId(event.target.value)} className="bbt-input w-full">
              <option value="">Selecione a empresa</option>
              {availableCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}{company.customerCode ? ` · ${company.customerCode}` : ''}</option>)}
            </select>
            <input value={mappingCode} onChange={(event) => setMappingCode(event.target.value)} className="bbt-input w-full" placeholder="Conta no Wintour" maxLength={35} />
            <button type="button" onClick={addMapping} className="bbt-button-ghost flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          </div>
          {settings.companyMappings.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {settings.companyMappings.map((mapping) => (
                <div key={mapping.companyId} className="flex items-center justify-between gap-3 rounded-lg bg-bbt-gray-50 p-3 text-sm dark:bg-slate-800">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{mapping.companyName}</p>
                    <p className="text-xs text-slate-500">Conta {mapping.wintourAccountCode}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings((current) => ({
                      ...current,
                      companyMappings: current.companyMappings.filter((item) => item.companyId !== mapping.companyId),
                    }))}
                    className="rounded p-1 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-950/40"
                    aria-label={`Remover vínculo de ${mapping.companyName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void saveSettings()} disabled={Boolean(busy)} className="bbt-button-ghost flex items-center gap-2 disabled:opacity-50">
            {busy === 'settings' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar configuração
          </button>
        </div>
      </section>
      ) : (
        <div className="bbt-card p-4 text-sm text-slate-600 dark:text-slate-300">
          <p className="font-medium text-bbt-primary dark:text-white">Configuração administrada pelo tenant</p>
          <p className="mt-1 text-xs text-slate-500">
            {settings.agencyName || 'Agência ainda não configurada'} · início {settings.syncFrom || 'não definido'}. Somente o administrador do tenant pode alterar estes parâmetros.
          </p>
        </div>
      )}

      <section className="space-y-3" aria-labelledby="wintour-outbound-queue">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="wintour-outbound-queue" className="font-semibold text-bbt-primary dark:text-white">Fila de envio</h2>
            <p className="text-sm text-slate-500">A listagem não inclui o XML nem o retrato completo da emissão.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void discover()} disabled={Boolean(busy) || !settings.enabled} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
              {busy === 'discover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Buscar novas emissões
            </button>
            <button type="button" onClick={() => void loadDashboard(true)} disabled={Boolean(busy)} className="bbt-button-ghost flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          {(Object.keys(STATE_META) as WintourOutboundUiState[]).map((state) => (
            <button
              type="button"
              key={state}
              onClick={() => setStateFilter((current) => current === state ? '' : state)}
              className={`rounded-lg border p-3 text-left transition ${STATE_META[state].classes} ${stateFilter === state ? 'ring-2 ring-bbt-accent ring-offset-1' : ''}`}
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wide">{STATE_META[state].label}</span>
              <span className="mt-1 block text-xl font-bold tabular-nums">{dashboard?.counts[state] || 0}</span>
            </button>
          ))}
        </div>

        {!dashboard?.capabilities.send && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>O envio automático ainda não está habilitado. É possível descobrir, preparar e baixar o XML para homologação, sem simular um envio ao Wintour.</p>
          </div>
        )}

        {visibleJobs.length === 0 ? (
          <div className="bbt-card p-8 text-center text-sm text-slate-500">Nenhuma venda encontrada para este filtro.</div>
        ) : (
          <div className="space-y-2">
            {visibleJobs.map((job) => {
              const meta = STATE_META[job.uiState]
              return (
                <article key={job.id} className="bbt-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>{meta.label}</span>
                        <span className="rounded-full bg-bbt-gray-50 px-2 py-0.5 text-[10px] uppercase dark:bg-slate-800">{job.operation === 'create' ? 'Nova venda' : 'Alteração'}</span>
                      </div>
                      <h3 className="mt-2 truncate font-semibold text-bbt-primary dark:text-white">{job.sourceLabel}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[job.companyName, job.travelerName, job.wintourSaleNumber ? `Wintour ${job.wintourSaleNumber}` : null].filter(Boolean).join(' · ') || 'Dados resumidos indisponíveis'}
                      </p>
                      {job.protocol && (
                        <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">Protocolo: {job.protocol}</p>
                      )}
                      {job.blockedReasons.length > 0 && (
                        <ul className="mt-2 list-disc pl-4 text-xs text-rose-700 dark:text-rose-300">
                          {job.blockedReasons.map((reason, index) => (
                            <li key={`${reason}:${index}`}>{blockedReasonLabel(reason)}</li>
                          ))}
                        </ul>
                      )}
                      {(job.humanActionRequired || job.uiState === 'protocol') && (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          O protocolo confirma apenas o recebimento. Um usuário ainda precisa processar a venda na mesa do Wintour.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dashboard?.capabilities.prepare && job.preparable && job.saleLinkId && (
                        <button type="button" onClick={() => void prepare(job.saleLinkId!, job.saleLinkVersion)} disabled={Boolean(busy)} className="bbt-button-ghost flex items-center gap-2 text-sm disabled:opacity-50">
                          {busy === `prepare:${job.saleLinkId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCog className="h-4 w-4" />} Preparar
                        </button>
                      )}
                      {dashboard?.capabilities.download && job.downloadAvailable && (
                        <button type="button" onClick={() => void download(job.id)} disabled={Boolean(busy)} className="bbt-button-ghost flex items-center gap-2 text-sm disabled:opacity-50">
                          {busy === `download:${job.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar XML
                        </button>
                      )}
                      {job.status === 'failed' && job.downloadAvailable && (
                        <button
                          type="button"
                          onClick={() => {
                            setRetryJobId(job.id)
                            setRetryReason('')
                            setReconcileJobId('')
                          }}
                          disabled={Boolean(busy)}
                          className="bbt-button-ghost flex items-center gap-2 text-sm disabled:opacity-50"
                        >
                          <RefreshCw className="h-4 w-4" /> Nova tentativa
                        </button>
                      )}
                      {dashboard?.capabilities.reconcile
                        && ['ambiguous', 'manual_review', 'received', 'processing'].includes(job.status) && (
                        <button
                          type="button"
                          onClick={() => {
                            setReconcileJobId(job.id)
                            setReconcileSaleNumber(job.wintourSaleNumber || '')
                            setReconcileReason('')
                            setReconcileTarget('completed')
                            setRetryJobId('')
                          }}
                          disabled={Boolean(busy)}
                          className="bbt-button-ghost flex items-center gap-2 text-sm disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Reconciliar
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {retryJob && (
          <div className="bbt-card space-y-3 border-amber-200 p-4 dark:border-amber-900">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white">Liberar nova tentativa</h3>
              <p className="text-xs text-slate-500">
                {retryJob.sourceLabel}. Esta ação apenas devolve a falha conhecida à fila; o envio ocorrerá pelo processador automático quando habilitado.
              </p>
            </div>
            <Field label="Motivo obrigatório">
              <textarea
                value={retryReason}
                onChange={(event) => setRetryReason(event.target.value)}
                rows={2}
                maxLength={2_000}
                className="bbt-input w-full"
                placeholder="Ex.: falha de configuração corrigida e conferida"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRetryJobId('')} disabled={Boolean(busy)} className="bbt-button-ghost">Cancelar</button>
              <button type="button" onClick={() => void retryFailedJob()} disabled={Boolean(busy)} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
                {busy === `retry:${retryJob.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Liberar tentativa
              </button>
            </div>
          </div>
        )}

        {reconcileJob && (
          <div className="bbt-card space-y-3 border-orange-200 p-4 dark:border-orange-900">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white">Reconciliação manual</h3>
              <p className="text-xs text-slate-500">
                Confirme primeiro o resultado diretamente no Wintour. Esta ação não consulta nem reenvia a venda.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Situação confirmada no Wintour">
                <select value={reconcileTarget} onChange={(event) => setReconcileTarget(event.target.value as WintourReconcileTargetState)} className="bbt-input w-full">
                  <option value="completed">Concluída</option>
                  <option value="rejected">Rejeitada</option>
                  <option value="failed">Falha confirmada</option>
                  <option value="cancelled">Cancelada</option>
                  <option value="manual_review">Manter em revisão manual</option>
                </select>
              </Field>
              {reconcileTarget === 'completed' && reconcileJob.operation === 'create' && (
                <Field label="Número da venda no Wintour">
                  <input
                    value={reconcileSaleNumber}
                    onChange={(event) => setReconcileSaleNumber(event.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="bbt-input w-full"
                    placeholder="Ex.: 123456"
                    inputMode="numeric"
                    disabled={Boolean(reconcileJob.wintourSaleNumber)}
                  />
                </Field>
              )}
            </div>
            <Field label="Motivo obrigatório">
              <textarea
                value={reconcileReason}
                onChange={(event) => setReconcileReason(event.target.value)}
                rows={2}
                maxLength={2_000}
                className="bbt-input w-full"
                placeholder="Registre como o resultado foi conferido no Wintour"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReconcileJobId('')} disabled={Boolean(busy)} className="bbt-button-ghost">Cancelar</button>
              <button type="button" onClick={() => void reconcileJobManually()} disabled={Boolean(busy)} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
                {busy === `reconcile:${reconcileJob.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar reconciliação
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="bbt-card p-5 space-y-4" aria-labelledby="wintour-adjustment-title">
        <div>
          <h2 id="wintour-adjustment-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <FileCog className="h-5 w-5 text-bbt-accent" /> Alteração pós-emissão
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Selecione uma venda já vinculada, informe o motivo e altere somente os campos autorizados pelo layout DGR-046.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_1fr_auto]">
          <Field label="Venda emitida no BBT">
            <select value={selectedSaleLinkId} onChange={(event) => setSelectedSaleLinkId(event.target.value)} className="bbt-input w-full">
              <option value="">Selecione a venda</option>
              {dashboard?.saleLinks.map((link) => (
                <option key={link.id} value={link.id}>{saleLinkLabel(link)}</option>
              ))}
            </select>
          </Field>
          <Field label="Número da venda no Wintour">
            <input value={saleNumber} onChange={(event) => setSaleNumber(event.target.value.replace(/\D/g, '').slice(0, 10))} className="bbt-input w-full" inputMode="numeric" maxLength={10} />
          </Field>
          <Field label="Motivo do vínculo manual">
            <input value={saleNumberReason} onChange={(event) => setSaleNumberReason(event.target.value)} className="bbt-input w-full" maxLength={500} placeholder="Ex.: confirmação na mesa do Wintour" />
          </Field>
          <div className="flex items-end">
            <button type="button" onClick={() => void bindSaleNumber()} disabled={!selectedSaleLink || busy === 'bind-sale'} className="bbt-button-ghost flex w-full items-center justify-center gap-2 disabled:opacity-50">
              {busy === 'bind-sale' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Vincular número
            </button>
          </div>
        </div>

        <Field label="Motivo obrigatório da alteração">
          <textarea value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} className="bbt-input min-h-20 w-full" maxLength={500} placeholder="Explique por que a venda precisa ser alterada." />
        </Field>

        <div className="space-y-3">
          {changes.map((change, index) => {
            const definition = WINTOUR_UPDATE_FIELDS.find((item) => item.code === change.field)!
            const isCancellation = change.field === 'fop' && change.content.trim().toUpperCase() === 'XX'
            return (
              <div key={change.id} className="rounded-xl border border-bbt-gray-100 p-3 dark:border-slate-700">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(240px,.8fr)_1fr_auto]">
                  <select
                    value={change.field}
                    onChange={(event) => updateChange(change.id, {
                      field: event.target.value as WintourUpdateFieldCode,
                      content: '',
                      appendToExisting: false,
                      keepValuesOnCancellation: false,
                    })}
                    className="bbt-input w-full"
                    aria-label={`Campo da alteração ${index + 1}`}
                  >
                    {WINTOUR_UPDATE_FIELDS.map((field) => <option key={field.code} value={field.code}>{field.label}</option>)}
                  </select>
                  {definition.kind === 'append' ? (
                    <textarea value={change.content} onChange={(event) => updateChange(change.id, { content: event.target.value })} className="bbt-input min-h-16 w-full" maxLength={4000} placeholder="Texto que será acrescentado" />
                  ) : definition.kind === 'payment' ? (
                    <select value={change.content} onChange={(event) => updateChange(change.id, { content: event.target.value, keepValuesOnCancellation: false })} className="bbt-input w-full">
                      <option value="">Selecione a forma de pagamento</option>
                      {WINTOUR_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                    </select>
                  ) : (
                    <input
                      type={definition.kind === 'date' ? 'date' : 'text'}
                      inputMode={definition.kind === 'currency' ? 'decimal' : definition.kind === 'integer' ? 'numeric' : undefined}
                      value={change.content}
                      onChange={(event) => updateChange(change.id, { content: event.target.value })}
                      className="bbt-input w-full"
                      maxLength={120}
                      placeholder={valuePlaceholder(definition.kind)}
                    />
                  )}
                  <button type="button" onClick={() => setChanges((current) => current.filter((item) => item.id !== change.id))} disabled={changes.length === 1} className="rounded p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-950/30" aria-label={`Remover alteração ${index + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {definition.kind === 'append' && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-blue-700 dark:text-blue-300">
                    <input type="checkbox" checked={change.appendToExisting} onChange={(event) => updateChange(change.id, { appendToExisting: event.target.checked })} />
                    Acrescentar ao texto atual. Desmarcado, o conteúdo atual será substituído.
                  </label>
                )}
                {isCancellation && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                    <input type="checkbox" checked={change.keepValuesOnCancellation} onChange={(event) => updateChange(change.id, { keepValuesOnCancellation: event.target.checked })} />
                    Manter os valores atuais ao cancelar com a forma de pagamento XX. Desmarcado, o Wintour aplica o procedimento padrão de zerar os valores.
                  </label>
                )}
                {change.field === 'id_pa' && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">A filial deve ser alterada sozinha; os demais campos foram removidos desta solicitação.</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => setChanges((current) => [...current, newAdjustmentChange()])} disabled={changes.some((item) => item.field === 'id_pa')} className="bbt-button-ghost flex items-center gap-2 text-sm disabled:opacity-50">
              <Plus className="h-4 w-4" /> Adicionar campo
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recalculate} onChange={(event) => setRecalculate(event.target.checked)} />
              Recalcular campos parametrizados
            </label>
          </div>
          <button type="button" onClick={() => void createAdjustment()} disabled={Boolean(busy) || !selectedSaleLink?.wintourSaleNumber} className="bbt-button-primary flex items-center gap-2 disabled:opacity-50">
            {busy === 'adjustment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Preparar alteração
          </button>
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          O recebimento de um protocolo não efetiva a alteração: ela permanecerá pendente até ser validada e processada por um usuário no Wintour.
        </p>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function DefaultCodeField({
  label,
  field,
  settings,
  setSettings,
}: {
  label: string
  field: keyof WintourSyncSettingsClient['accountDefaults']
  settings: WintourSyncSettingsClient
  setSettings: React.Dispatch<React.SetStateAction<WintourSyncSettingsClient>>
}) {
  return (
    <Field label={label}>
      <input
        value={settings.accountDefaults[field] || ''}
        onChange={(event) => setSettings((current) => ({
          ...current,
          accountDefaults: { ...current.accountDefaults, [field]: event.target.value.trim() || null },
        }))}
        className="bbt-input w-full"
        maxLength={['issuer', 'promoter', 'manager', 'supplier'].includes(field) ? 60 : 10}
      />
    </Field>
  )
}

function ProductCodeField({
  label,
  field,
  settings,
  setSettings,
}: {
  label: string
  field: keyof WintourSyncSettingsClient['productCodes']
  settings: WintourSyncSettingsClient
  setSettings: React.Dispatch<React.SetStateAction<WintourSyncSettingsClient>>
}) {
  return (
    <Field label={label}>
      <input
        value={settings.productCodes[field] || ''}
        onChange={(event) => setSettings((current) => ({
          ...current,
          productCodes: { ...current.productCodes, [field]: event.target.value.trim() || null },
        }))}
        className="bbt-input w-full"
        maxLength={10}
      />
    </Field>
  )
}

function PaymentMappingField({
  label,
  field,
  settings,
  setSettings,
}: {
  label: string
  field: keyof WintourSyncSettingsClient['paymentMethodCodes']
  settings: WintourSyncSettingsClient
  setSettings: React.Dispatch<React.SetStateAction<WintourSyncSettingsClient>>
}) {
  return (
    <Field label={label}>
      <select
        value={settings.paymentMethodCodes[field] || ''}
        onChange={(event) => setSettings((current) => ({
          ...current,
          paymentMethodCodes: {
            ...current.paymentMethodCodes,
            [field]: event.target.value || null,
          },
        }))}
        className="bbt-input w-full"
      >
        <option value="">Não mapear</option>
        {WINTOUR_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
      </select>
    </Field>
  )
}

function ServiceRouteField({
  label,
  field,
  settings,
  setSettings,
}: {
  label: string
  field: keyof WintourSyncSettingsClient['serviceRouteTypes']
  settings: WintourSyncSettingsClient
  setSettings: React.Dispatch<React.SetStateAction<WintourSyncSettingsClient>>
}) {
  const options = field === 'bus'
    ? [{ value: 4, label: '4 — Outros' }, { value: 7, label: '7 — Outros serviços' }]
    : field === 'air'
      ? [{ value: 1, label: '1 — Aéreo' }]
      : field === 'hotel'
        ? [{ value: 2, label: '2 — Hotel' }]
        : [{ value: 3, label: '3 — Locação' }]
  return (
    <Field label={label}>
      <select
        value={settings.serviceRouteTypes[field] ?? ''}
        onChange={(event) => setSettings((current) => ({
          ...current,
          serviceRouteTypes: {
            ...current.serviceRouteTypes,
            [field]: event.target.value ? Number(event.target.value) : null,
          },
        }))}
        className="bbt-input w-full"
      >
        <option value="">Não mapear</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {field === 'bus' && <span className="mt-1 block text-[10px] text-amber-700 dark:text-amber-300">Escolha 4 ou 7 somente conforme a homologação do produto rodoviário no Wintour.</span>}
    </Field>
  )
}

function saleLinkLabel(link: WintourSaleLinkClient): string {
  return [
    link.sourceLabel,
    link.companyName,
    link.wintourSaleNumber ? `Wintour ${link.wintourSaleNumber}` : 'número pendente',
  ].filter(Boolean).join(' · ')
}

function toWintourDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value.trim()
}

function valuePlaceholder(kind: typeof WINTOUR_UPDATE_FIELDS[number]['kind']): string {
  if (kind === 'currency') return '0.00'
  if (kind === 'boolean-code') return '1 ou 0'
  if (kind === 'payment') return 'Ex.: IV, PX, CA ou XX'
  if (kind === 'integer') return 'Somente números'
  return 'Novo conteúdo'
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
