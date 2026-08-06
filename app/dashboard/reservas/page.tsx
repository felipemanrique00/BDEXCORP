'use client'
import { todayISODate } from '@/lib/date'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Bot,
  Building2,
  CalendarCheck,
  Car,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Hotel,
  Package,
  Plane,
  RefreshCw,
  Send,
  Settings,
} from 'lucide-react'
import { toast } from 'sonner'

import { useStore } from '@/lib/store'
import { DateInput } from '@/components/ui/date-input'
import { getCurrentUser } from '@/lib/auth'
import {
  criarAtendimentoParaLista,
  getAllAtendimentos,
} from '@/lib/atendimentos-storage'
import {
  persistDemandPatchWithCompatibility,
  persistNewDemandWithCompatibility,
} from '@/lib/demand-persistence-client'
import { getDemandFromServer, listDemandsFromServer } from '@/lib/demands-client'
import { encontrarFuncionarioPorCodigo } from '@/lib/funcionario-identidade'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import { listTravelQuotesFromServer } from '@/lib/travel/quote-client'
import type { GovernedTravelQuoteSummary } from '@/lib/travel/quote-records'
import { listTravelReservationsFromServer } from '@/lib/travel/reservation-client'
import type { GovernedTravelReservationSummary } from '@/lib/travel/reservation-records'
import {
  capabilityLabel,
  filterSuppliersByService,
  getSupplierLogs,
  getSupplierIntegrations,
  getSupplierReservations,
  prepararAcaoFornecedor,
  selectSuppliersFromCatalog,
  serviceLabel,
  type SupplierActionLog,
  type SupplierCapability,
  type SupplierIntegration,
  type SupplierReservation,
  type SupplierReservationStatus,
  type SupplierService,
} from '@/lib/supplier-integrations'
import {
  listIntegrationProvidersFromServer,
  type IntegrationProviderClientRecord,
} from '@/lib/integrations/provider-catalog-client'
import type { Atendimento, Funcionario, Prioridade, TipoServico } from '@/types'
import { isRequesterUser } from '@/lib/user-access-kind'
import { useCorporateContext, useCorporateCompanyScope } from '@/components/corporate-context-provider'
import OfflineTravelWorkspace from '@/components/travel/offline-travel-workspace'
import { PORTAL_REQUESTS_CHOICE_HREF } from '@/lib/portal-relational-sync'

type FormState = {
  serial_os: string
  service: SupplierService
  action: SupplierCapability
  empresa_id: string
  funcionario_codigo: string
  funcionario_id: string
  viajante_nome: string
  solicitante_nome: string
  origem: string
  destino: string
  item_nome: string
  data_inicio: string
  data_fim: string
  centro_custo: string
  valor_estimado: string
  prioridade: Prioridade
  observacoes: string
}

const SERVICES: Array<{ value: SupplierService; label: string; icon: any; hint: string }> = [
  { value: 'aereo', label: 'Aéreo', icon: Plane, hint: 'Tech: LATAM, GOLGWS, AZUL, Amadeus, Sabre' },
  { value: 'hotelaria', label: 'Hotelaria', icon: Hotel, hint: 'Tech: rede hoteleira habilitada na conta' },
  { value: 'locacao', label: 'Locação', icon: Car, hint: 'Tech: locadoras habilitadas na conta' },
  { value: 'pacotes', label: 'Pacotes', icon: Package, hint: 'Pedidos/OS e operadoras pela Tech' },
  { value: 'lazer', label: 'Lazer', icon: Package, hint: 'Fluxo assistido e fornecedores habilitados' },
  { value: 'transfer', label: 'Transfer', icon: Car, hint: 'Pedidos/OS e fornecedores habilitados' },
  { value: 'seguro', label: 'Seguro', icon: CheckCircle2, hint: 'Pedidos/OS e fornecedores habilitados' },
]

const ACTIONS: SupplierCapability[] = ['cotacao', 'reserva', 'emissao', 'status', 'voucher', 'cancelamento', 'remarcacao']

const OFFLINE_TRAVEL_UI_ENABLED = process.env.NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED === 'true'

const INITIAL_FORM: FormState = {
  serial_os: '',
  service: 'hotelaria',
  action: 'cotacao',
  empresa_id: '',
  funcionario_codigo: '',
  funcionario_id: '',
  viajante_nome: '',
  solicitante_nome: '',
  origem: '',
  destino: '',
  item_nome: '',
  data_inicio: '',
  data_fim: '',
  centro_custo: '',
  valor_estimado: '',
  prioridade: 'media',
  observacoes: '',
}

export default function ReservasPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const requesterReadOnly = isRequesterUser(user)
  const { empresas, funcionarios } = useStore()
  const { context, isAllCompaniesSelected } = useCorporateContext()
  const { companyIdsList, includesCompany } = useCorporateCompanyScope()
  const empresasNoContexto = useMemo(
    () => empresas.filter((item) => includesCompany(item.id, 'ver_reservas')),
    [empresas, includesCompany],
  )
  const quoteCompanies = useMemo(
    () => empresasNoContexto.filter((item) => includesCompany(item.id, 'operar_cotacoes')),
    [empresasNoContexto, includesCompany],
  )
  const reservationCompanies = useMemo(
    () => empresasNoContexto.filter((item) => (
      includesCompany(item.id, 'operar_reservas')
      || includesCompany(item.id, 'operar_emissoes')
    )),
    [empresasNoContexto, includesCompany],
  )
  const canOperateQuotes = quoteCompanies.length > 0
  const canOperateReservations = reservationCompanies.length > 0
  const quoteCompanyIds = useMemo(() => quoteCompanies.map((item) => item.id), [quoteCompanies])
  const reservationCompanyIds = useMemo(
    () => reservationCompanies.map((item) => item.id),
    [reservationCompanies],
  )
  const canUseOfflineWorkspace = OFFLINE_TRAVEL_UI_ENABLED && canOperateReservations
  const canAccessOperationalWorkspace = canOperateQuotes || canUseOfflineWorkspace
  const canConfigureConnections = useMemo(
    () => empresasNoContexto.some((item) => includesCompany(item.id, 'gerenciar_integracoes')),
    [empresasNoContexto, includesCompany],
  )
  const selectedReservationCompanyIds = useMemo(
    () => companyIdsList.filter((companyId) => includesCompany(companyId, 'ver_reservas')),
    [companyIdsList, includesCompany],
  )
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [operationChannel, setOperationChannel] = useState<'online' | 'offline'>('online')
  const [demandaVinculadaId, setDemandaVinculadaId] = useState('')
  const [quotes, setQuotes] = useState<GovernedTravelQuoteSummary[]>([])
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [quotesError, setQuotesError] = useState('')
  const [relationalReservations, setRelationalReservations] = useState<GovernedTravelReservationSummary[]>([])
  const [reservationsLoading, setReservationsLoading] = useState(true)
  const [reservationsError, setReservationsError] = useState('')
  const [relationalDemands, setRelationalDemands] = useState<Atendimento[]>([])
  const [demandsLoading, setDemandsLoading] = useState(true)
  const [demandsError, setDemandsError] = useState('')
  const [providerCatalog, setProviderCatalog] = useState<IntegrationProviderClientRecord[] | null>(null)
  const [providerCatalogError, setProviderCatalogError] = useState('')
  const initialDemandAppliedRef = useRef(false)

  useEffect(() => {
    if (!canOperateQuotes && canOperateReservations) setOperationChannel('offline')
    if (canOperateQuotes && !canOperateReservations) setOperationChannel('online')
  }, [canOperateQuotes, canOperateReservations])

  const empresa = useMemo(
    () => quoteCompanies.find((item) => item.id === form.empresa_id),
    [form.empresa_id, quoteCompanies],
  )

  const funcionariosEmpresa = useMemo(
    () => funcionarios.filter((item) => includesCompany(item.company_id, 'ver_funcionarios') && (!form.empresa_id || item.company_id === form.empresa_id)),
    [funcionarios, form.empresa_id, includesCompany],
  )

  const suppliers = useMemo(
    () => {
      void reload
      return filterSuppliersByService(providerCatalog || getSupplierIntegrations(), form.service)
    },
    [form.service, providerCatalog, reload],
  )

  const reservasLegadas = useMemo(
    () => {
      void reload
      if (requesterReadOnly) return []
      return getSupplierReservations(120)
        .filter((reserva) => includesCompany(reserva.empresa_id, 'ver_reservas'))
    },
    [includesCompany, reload, requesterReadOnly],
  )

  const logs = useMemo(
    () => {
      void reload
      if (requesterReadOnly) return []
      return getSupplierLogs(80)
    },
    [reload, requesterReadOnly],
  )

  const reservasLegadasVisiveis = useMemo(() => {
    const migratedReferences = new Set(
      relationalReservations
        .filter((reservation) => reservation.provider === 'legacy_supplier')
        .map((reservation) => reservation.providerReference)
        .filter(Boolean),
    )
    return reservasLegadas.filter((reservation) => !migratedReferences.has(reservation.id))
  }, [relationalReservations, reservasLegadas])

  const demandasMescladas = useMemo(() => {
    void reload
    const merged = new Map<string, Atendimento>()
    const relationalIds = new Set(relationalDemands.map((item) => item.id))
    const relationalSerials = new Set(relationalDemands.flatMap((item) => {
      const serial = demandSerialKey(item.serial_os)
      return serial ? [serial] : []
    }))
    getAllAtendimentos().forEach((item) => {
      if (requesterReadOnly
        && !relationalIds.has(item.id)
        && !relationalSerials.has(demandSerialKey(item.serial_os))) return
      merged.set(item.id, item)
    })
    relationalDemands.forEach((item) => merged.set(item.id, item))
    return Array.from(merged.values())
  }, [relationalDemands, reload, requesterReadOnly])

  const demandasNoContexto = useMemo(
    () => demandasMescladas.filter((item) => includesCompany(item.empresa_id, 'ver_demandas')),
    [demandasMescladas, includesCompany],
  )

  const demandasOperacionais = useMemo(() => (
    [...demandasNoContexto]
      .filter((item) => !['finalizado', 'cancelado'].includes(item.status))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
  ), [demandasNoContexto])
  const demandasRecentes = useMemo(
    () => demandasOperacionais.slice(0, 50),
    [demandasOperacionais],
  )

  const demandById = useMemo(
    () => new Map(demandasMescladas.map((item) => [item.id, item])),
    [demandasMescladas],
  )
  const demandBySerial = useMemo(
    () => new Map(demandasMescladas.flatMap((item) => {
      const serial = demandSerialKey(item.serial_os)
      return serial ? [[serial, item] as const] : []
    })),
    [demandasMescladas],
  )

  useEffect(() => {
    const controller = new AbortController()
    setDemandsLoading(true)
    setDemandsError('')
    void listDemandsFromServer({ limit: 200 })
      .then((result) => {
        if (!controller.signal.aborted) setRelationalDemands(result.items.map((item) => item.demand))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRelationalDemands([])
        setDemandsError(error instanceof Error ? error.message : 'Nao foi possivel carregar as demandas relacionais.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setDemandsLoading(false)
      })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!canOperateQuotes) {
      setProviderCatalog(null)
      setProviderCatalogError('')
      return
    }
    const controller = new AbortController()
    setProviderCatalogError('')
    void listIntegrationProvidersFromServer()
      .then((providers) => {
        if (!controller.signal.aborted) setProviderCatalog(providers)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setProviderCatalog(null)
        setProviderCatalogError(
          error instanceof Error
            ? error.message
            : 'Nao foi possivel carregar o catalogo de conectores.',
        )
      })
    return () => controller.abort()
  }, [canOperateQuotes, reload])

  useEffect(() => {
    if (!isAllCompaniesSelected && selectedReservationCompanyIds.length === 0) {
      setQuotes([])
      setQuotesError('')
      setQuotesLoading(false)
      return
    }
    const controller = new AbortController()
    setQuotesLoading(true)
    setQuotesError('')
    void listTravelQuotesFromServer({
      companyIds: isAllCompaniesSelected ? undefined : selectedReservationCompanyIds,
      limit: 120,
    }, controller.signal)
      .then((result) => {
        setQuotes(result.items)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setQuotes([])
        setQuotesError(error instanceof Error ? error.message : 'Nao foi possivel carregar as cotacoes.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuotesLoading(false)
      })
    return () => controller.abort()
  }, [isAllCompaniesSelected, reload, selectedReservationCompanyIds])

  useEffect(() => {
    if (!isAllCompaniesSelected && selectedReservationCompanyIds.length === 0) {
      setRelationalReservations([])
      setReservationsError('')
      setReservationsLoading(false)
      return
    }
    const controller = new AbortController()
    setReservationsLoading(true)
    setReservationsError('')
    void listTravelReservationsFromServer({
      companyIds: isAllCompaniesSelected ? undefined : selectedReservationCompanyIds,
      limit: 120,
    }, controller.signal)
      .then((result) => {
        setRelationalReservations(result.items)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRelationalReservations([])
        setReservationsError(error instanceof Error ? error.message : 'Nao foi possivel carregar as reservas.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setReservationsLoading(false)
      })
    return () => controller.abort()
  }, [isAllCompaniesSelected, reload, selectedReservationCompanyIds])

  useEffect(() => {
    setForm((current) => {
      if (current.empresa_id && includesCompany(current.empresa_id, 'operar_cotacoes')) return current
      const companyId = context?.type === 'company' && includesCompany(context.id, 'operar_cotacoes') ? context.id : ''
      return current.empresa_id === companyId ? current : { ...current, empresa_id: companyId, funcionario_id: '', funcionario_codigo: '' }
    })
  }, [context, includesCompany])

  const demandaVinculada = useMemo(() => {
    const demanda = demandaVinculadaId ? demandById.get(demandaVinculadaId) || null : null
    return demanda && includesCompany(demanda.empresa_id, 'ver_demandas') ? demanda : null
  }, [demandaVinculadaId, demandById, includesCompany])

  useEffect(() => {
    const recomendados = selectSuppliersFromCatalog(
      providerCatalog || getSupplierIntegrations(),
      form.service,
      4,
    ).map((supplier) => supplier.id)
    setSelectedSupplierIds(recomendados)
  }, [form.service, providerCatalog])

  useEffect(() => {
    if (initialDemandAppliedRef.current || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const atendimentoId = params.get('atendimento')?.trim() || ''
    const serial = params.get('os')?.trim() || ''
    if (!atendimentoId && !serial) {
      initialDemandAppliedRef.current = true
      return
    }

    const cachedDemand = atendimentoId
      ? demandById.get(atendimentoId)
      : demandBySerial.get(demandSerialKey(serial))
    if (!cachedDemand && demandsLoading) return

    let active = true
    void (async () => {
      let demanda = cachedDemand || null
      try {
        if (!demanda && atendimentoId) {
          demanda = (await getDemandFromServer(atendimentoId)).demand
        } else if (!demanda && serial) {
          const normalizedSerial = demandSerialKey(serial)
          const result = await listDemandsFromServer({ search: serial, limit: 20 })
          demanda = result.items.find((item) => (
            demandSerialKey(item.demandNumber) === normalizedSerial
            || demandSerialKey(item.demand.serial_os) === normalizedSerial
          ))?.demand || null
        }
      } catch (error) {
        if (!active || initialDemandAppliedRef.current) return
        initialDemandAppliedRef.current = true
        toast.error(error instanceof Error
          ? error.message
          : 'Não foi possível consultar a demanda informada no acesso direto.')
        return
      }

      if (!active || initialDemandAppliedRef.current) return
      initialDemandAppliedRef.current = true
      if (!demanda) {
        toast.error('Não encontrei a demanda informada no acesso direto.')
        return
      }
      if (!includesCompany(demanda.empresa_id, 'ver_demandas')) {
        toast.error('A demanda informada esta fora do contexto autorizado.')
        return
      }

      setRelationalDemands((current) => mergeDemand(current, demanda))
      setForm((current) => formFromAtendimento(current, demanda, funcionarios, serial))
      setDemandaVinculadaId(demanda.id)
      if (OFFLINE_TRAVEL_UI_ENABLED && serviceFromAtendimento(demanda.tipo_servico) === 'hotelaria') {
        setOperationChannel('offline')
      }
      toast.success(`Demanda ${demanda.serial_os || serial} pronta para cotação/reserva.`)
    })()

    return () => {
      active = false
    }
  }, [demandById, demandBySerial, demandsLoading, funcionarios, includesCompany])

  function refresh() {
    setReload((value) => value + 1)
  }

  function selecionarFuncionario(id: string) {
    const funcionario = funcionarios.find((item) => item.id === id)
    setForm((current) => ({
      ...current,
      funcionario_id: id,
      funcionario_codigo: funcionario?.codigo_identificacao || '',
      viajante_nome: funcionario?.nome || current.viajante_nome,
      centro_custo: funcionario?.centro_custo || current.centro_custo,
    }))
  }

  function selecionarFuncionarioPorCodigo(codigo: string) {
    const funcionario = encontrarFuncionarioPorCodigo(funcionarios, codigo, form.empresa_id || undefined)
    setForm((current) => ({
      ...current,
      funcionario_codigo: codigo,
      funcionario_id: funcionario?.id || '',
      viajante_nome: funcionario?.nome || current.viajante_nome,
      centro_custo: funcionario?.centro_custo || current.centro_custo,
    }))
  }

  function aplicarDemandaPorSerial(serialInformado?: string) {
    const serial = String(serialInformado ?? form.serial_os).trim()
    if (!serial) {
      toast.error('Informe o Serial/OS da demanda.')
      return
    }

    const demanda = demandBySerial.get(demandSerialKey(serial))
    if (!demanda) {
      toast.error('Não encontrei demanda com esse Serial/OS.')
      return
    }

    if (!includesCompany(demanda.empresa_id, 'ver_demandas')) {
      toast.error('A demanda informada esta fora do contexto autorizado.')
      return
    }
    setForm((current) => formFromAtendimento(current, demanda, funcionarios, serial))
    setDemandaVinculadaId(demanda.id)
    toast.success(`Demanda ${demanda.serial_os || serial} vinculada para cotação/reserva.`)
  }

  function selecionarDemandaRecente(atendimentoId: string) {
    if (!atendimentoId) return
    const demanda = demandById.get(atendimentoId)
    if (!demanda) {
      toast.error('A demanda selecionada não está mais disponível.')
      refresh()
      return
    }
    if (!demanda.serial_os) {
      toast.error('A demanda selecionada ainda não possui Serial/OS.')
      return
    }
    aplicarDemandaPorSerial(demanda.serial_os)
  }

  function toggleSupplier(id: string) {
    setSelectedSupplierIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  function portalUrl(supplier: SupplierIntegration): string | null {
    return supplier.portal_url || null
  }

  function resetForm() {
    setDemandaVinculadaId('')
    setForm((current) => ({
      ...INITIAL_FORM,
      service: current.service,
      action: current.action,
      empresa_id: current.empresa_id,
      solicitante_nome: current.solicitante_nome,
    }))
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return

    if (!form.empresa_id) {
      toast.error('Selecione a empresa antes de preparar a reserva.')
      return
    }
    if (!includesCompany(form.empresa_id, 'criar_demandas')) {
      toast.error('Voce nao possui permissao para criar operacoes nesta empresa.')
      return
    }
    if (!includesCompany(form.empresa_id, 'operar_cotacoes')) {
      toast.error('Voce nao possui permissao para operar cotacoes nesta empresa.')
      return
    }
    if (!form.viajante_nome.trim()) {
      toast.error('Informe o viajante/hóspede/passageiro.')
      return
    }
    if (!form.destino.trim() && !form.item_nome.trim()) {
      toast.error('Informe destino, cidade, hotel, locadora ou produto.')
      return
    }
    if (form.action !== 'cotacao') {
      toast.error(
        `${capabilityLabel(form.action)} transacional ainda nao esta homologada no conector. Nenhuma operacao foi criada.`,
      )
      return
    }

    setBusy(true)
    try {
      const funcionario =
        funcionarios.find((item) => item.id === form.funcionario_id) ||
        encontrarFuncionarioPorCodigo(funcionarios, form.funcionario_codigo, form.empresa_id)
      const ids = selectedSupplierIds.length
        ? selectedSupplierIds
        : selectSuppliersFromCatalog(
          providerCatalog || getSupplierIntegrations(),
          form.service,
          4,
        ).map((supplier) => supplier.id)

      prepararAcaoFornecedor({
        service: form.service,
        action: form.action,
        supplier_ids: ids,
        origem: form.origem,
        destino: form.destino,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        viajante: form.viajante_nome,
        empresa_nome: empresa?.nome,
        payload: {
          item_nome: form.item_nome,
          centro_custo: form.centro_custo,
          solicitante_nome: form.solicitante_nome,
          observacoes: form.observacoes,
        },
      }, providerCatalog || undefined)

      const tipoServico = mapTipoServico(form.service)
      const demandaVinculada = form.serial_os.trim()
        ? demandBySerial.get(demandSerialKey(form.serial_os)) || null
        : null
      const atendimentoPayload: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> = {
        empresa_id: form.empresa_id,
        funcionario_id: funcionario?.id || null,
        passageiro_nome: form.viajante_nome.trim(),
        tipo_servico: tipoServico,
        valor_cotacao: money(form.valor_estimado),
        valor_custo: money(form.valor_estimado),
        valor_venda: money(form.valor_estimado),
        agente_user_id: user?.id || 'system',
        status: 'pendente',
        prioridade: form.prioridade,
        origem: 'Outro',
        observacoes: [
          `Preparado em Reservas e cotações por ${user?.name || 'Sistema'}.`,
          `Ação: ${capabilityLabel(form.action)} | Serviço: ${serviceLabel(form.service)}.`,
          form.observacoes,
        ].filter(Boolean).join('\n\n'),
        data_atendimento: today(),
        centro_custo: form.centro_custo || funcionario?.centro_custo || empresa?.centro_custo_padrao,
        solicitante_nome: form.solicitante_nome || undefined,
        origem_emissao: 'manual',
        detalhes_aereo: tipoServico === 'Aéreo' ? {
          origem: form.origem || undefined,
          destino: form.destino || undefined,
          data_ida: form.data_inicio || undefined,
          data_volta: form.data_fim || undefined,
        } : undefined,
        detalhes_hotel: tipoServico === 'Hotel' ? {
          hotel_nome: form.item_nome || undefined,
          cidade: form.destino || undefined,
          data_checkin: form.data_inicio || undefined,
          data_checkout: form.data_fim || undefined,
          num_hospedes: 1,
          tarifa_unitaria: money(form.valor_estimado) || undefined,
        } : undefined,
        detalhes_carro: tipoServico === 'Carro' ? {
          locadora: form.item_nome || undefined,
          cidade_retirada: form.origem || form.destino || undefined,
          data_retirada: form.data_inicio || undefined,
          data_devolucao: form.data_fim || undefined,
        } : undefined,
        detalhes_pacote: tipoServico === 'Pacote' ? {
          destino: form.destino || undefined,
          data_ida: form.data_inicio || undefined,
          data_volta: form.data_fim || undefined,
          descricao: form.item_nome || undefined,
        } : undefined,
      }

      let atendimento: Atendimento | null = null
      if (demandaVinculada) {
        const persistida = await persistDemandPatchWithCompatibility(demandaVinculada, {
          ...atendimentoPayload,
          status: demandaVinculada.status,
          observacoes_internas: [
            demandaVinculada.observacoes_internas,
            `Vinculada em Reservas e cotações pelo Serial/OS ${demandaVinculada.serial_os}.`,
          ].filter(Boolean).join('\n'),
        }, `Vinculo da operacao ${capabilityLabel(form.action)} em Reservas e cotacoes.`)
        atendimento = persistida.demand
      } else {
        const preparada = criarAtendimentoParaLista(atendimentoPayload, getAllAtendimentos())
        atendimento = (await persistNewDemandWithCompatibility(preparada)).demand
      }

      if (!atendimento) {
        toast.error('Não foi possível criar a demanda vinculada. Verifique o armazenamento/banco.')
        return
      }

      let techQuote: any = null
      let databaseQuoteId = ''
      if (form.action === 'cotacao') {
        const techResponse = await fetch('/api/travel/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            demandId: atendimento.id,
            idempotencyKey: `${atendimento.id}:quote:${crypto.randomUUID()}`,
            service: form.service,
            empresaId: form.empresa_id,
            origem: form.origem || undefined,
            destino: form.destino || form.item_nome || undefined,
            dataInicio: form.data_inicio || undefined,
            dataFim: form.data_fim || undefined,
            adultos: 1,
            raw: {
              item_nome: form.item_nome,
              serial_os: atendimento.serial_os,
              centro_custo: form.centro_custo,
              solicitante_nome: form.solicitante_nome,
            },
          }),
        })
        const payload = await techResponse.json().catch(() => null)
        if (techResponse.ok && payload?.quote) {
          techQuote = payload.quote
          databaseQuoteId = String(payload.databaseQuoteId || '')
          toast.success(`Cotação Tech preparada com ${techQuote.options?.length || 0} opção(ões).`)
        } else if (payload?.code === 'TECH_NOT_CONFIGURED') {
          toast.warning('A demanda foi salva, mas a cotacao Tech Travel nao foi executada porque a integracao nao esta configurada.')
        } else {
          toast.error(payload?.error || 'Tech Travel não retornou cotação agora.')
        }
      }
      if (techQuote) {
        atendimento = (await persistDemandPatchWithCompatibility(atendimento, {
          observacoes_internas: [
            atendimento.observacoes_internas,
            databaseQuoteId ? `Cotacao relacional: ${databaseQuoteId}.` : '',
            techQuote.id ? `Cotacao Tech: ${techQuote.id}.` : '',
          ].filter(Boolean).join('\n'),
        }, `Vinculo da cotacao relacional ${databaseQuoteId || techQuote.id}.`)).demand
      }

      await commitPendingRemoteStorage()

      if (techQuote) {
        toast.success(
          `Cotacao confirmada pelo conector e vinculada a ${atendimento.serial_os || atendimento.id}.`,
        )
      } else {
        toast.warning(
          `Demanda ${atendimento.serial_os || atendimento.id} salva; nenhuma cotacao foi confirmada pelo fornecedor.`,
        )
      }
      resetForm()
      refresh()
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao preparar reserva/cotação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Operação · Fornecedores</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <CalendarCheck className="h-6 w-6 text-bbt-accent" /> Reservas e cotações
          </h1>
          <p className="bbt-page-subtitle">
            Prepare cotações, reservas, emissões e consultas usando os conectores configurados. Tudo nasce vinculado a demanda, IA BIA e histórico operacional.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} className="bbt-button-ghost">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
          {canConfigureConnections && (
            <Link href="/dashboard/configuracoes" className="bbt-button-ghost">
              <Settings className="h-4 w-4" /> Configurar conexões
            </Link>
          )}
        </div>
      </div>

      {OFFLINE_TRAVEL_UI_ENABLED && canAccessOperationalWorkspace && (
        <section className="bbt-card p-2" aria-label="Canal da operação de viagem">
          <div className={`grid gap-2 ${canOperateQuotes && canOperateReservations ? 'sm:grid-cols-2' : ''}`}>
            {canOperateQuotes && <button
              type="button"
              onClick={() => setOperationChannel('online')}
              aria-pressed={operationChannel === 'online'}
              className={`rounded-lg px-4 py-3 text-left transition ${operationChannel === 'online' ? 'bg-bbt-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              <span className="block text-sm font-semibold">Conectores online</span>
              <span className={`mt-1 block text-xs ${operationChannel === 'online' ? 'text-white/75' : 'text-slate-500'}`}>Cotação e reserva pelos fornecedores integrados.</span>
            </button>}
            {canOperateReservations && <button
              type="button"
              onClick={() => setOperationChannel('offline')}
              aria-pressed={operationChannel === 'offline'}
              className={`rounded-lg px-4 py-3 text-left transition ${operationChannel === 'offline' ? 'bg-bbt-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              <span className="block text-sm font-semibold">Atendimento offline / manual</span>
              <span className={`mt-1 block text-xs ${operationChannel === 'offline' ? 'text-white/75' : 'text-slate-500'}`}>Reserva, emissão e voucher para qualquer tipo de serviço.</span>
            </button>}
          </div>
        </section>
      )}

      {!canAccessOperationalWorkspace ? (
        <section className="bbt-card p-5" aria-label="Acesso ao acompanhamento de viagens">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-bbt-accent" />
            <div>
              <h2 className="font-semibold text-bbt-primary dark:text-white">Acompanhe suas solicitações</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Seu perfil pode consultar reservas e cotações, mas não executa atividades do consultor.
                Para escolher uma cotação, abra a demanda correspondente na lista abaixo.
              </p>
              <Link href={PORTAL_REQUESTS_CHOICE_HREF} className="mt-3 inline-flex text-sm font-semibold text-bbt-accent hover:underline">
                Abrir meus pedidos e escolhas
              </Link>
            </div>
          </div>
        </section>
      ) : operationChannel === 'online' && canOperateQuotes ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form onSubmit={submit} className="bbt-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-bbt-primary dark:text-white">Nova operação com fornecedor</h2>
              <p className="mt-1 text-sm text-slate-500">Selecione serviço, fornecedor e dados da viagem. O sistema cria a demanda vinculada automaticamente.</p>
            </div>
            <span className="rounded-full bg-bbt-accent/10 px-3 py-1 text-xs font-semibold text-bbt-accent">IA BIA conectada</span>
          </div>

          <div className="mt-5 rounded-lg border border-bbt-accent/25 bg-bbt-accent/5 p-3">
            <div className="grid gap-3 md:grid-cols-[minmax(240px,0.9fr)_minmax(280px,1.25fr)_auto] md:items-end">
              <Field label="Serial/OS da demanda">
                <input
                  value={form.serial_os}
                  onChange={(e) => {
                    setDemandaVinculadaId('')
                    setForm({ ...form, serial_os: e.target.value })
                  }}
                  onBlur={() => form.serial_os.trim() && aplicarDemandaPorSerial()}
                  className="bbt-input"
                  placeholder="Ex: OS-20260513-0001"
                  list="reservas-os-disponiveis"
                />
                <datalist id="reservas-os-disponiveis">
                  {demandasRecentes.map((item) => (
                    <option key={item.id} value={item.serial_os || ''}>
                      {item.passageiro_nome} · {empresas.find((empresaItem) => empresaItem.id === item.empresa_id)?.nome || 'Empresa não localizada'}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="Demandas recentes sem conclusão">
                <select
                  value=""
                  onChange={(event) => selecionarDemandaRecente(event.target.value)}
                  className="bbt-input"
                  aria-label="Selecionar demanda recente pela OS"
                >
                  <option value="">Selecione pela OS, viajante ou empresa</option>
                  {demandasRecentes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.serial_os} · {item.passageiro_nome} · {empresas.find((empresaItem) => empresaItem.id === item.empresa_id)?.nome || 'Empresa não localizada'}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" onClick={() => aplicarDemandaPorSerial()} className="bbt-button-ghost justify-center">
                Vincular OS
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Digite a OS ou escolha uma demanda recente. O sistema preenche empresa, viajante, destino, datas, hotel e centro de custo sem redigitação.
            </p>
            {demandaVinculada && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-bbt-accent/20 pt-3 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-green-700 dark:text-green-400">OS vinculada: {demandaVinculada.serial_os}</span>
                  <span className="ml-2 text-slate-500">
                    {demandaVinculada.passageiro_nome} · {empresas.find((item) => item.id === demandaVinculada.empresa_id)?.nome || 'Empresa não localizada'} · {serviceLabel(serviceFromAtendimento(demandaVinculada.tipo_servico))}
                  </span>
                </div>
                <Link href={`/dashboard/demandas?id=${encodeURIComponent(demandaVinculada.id)}`} className="font-semibold text-bbt-accent hover:underline">
                  Abrir demanda
                </Link>
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {SERVICES.map((item) => {
              const Icon = item.icon
              const active = form.service === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, service: item.value }))}
                  className={`rounded-lg border p-3 text-left transition ${active ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-accent' : 'border-bbt-gray-100 hover:border-bbt-accent/60 dark:border-slate-700'}`}
                >
                  <Icon className="mb-2 h-5 w-5" />
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-[11px] leading-4 text-slate-500">{item.hint}</div>
                </button>
              )
            })}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Empresa *">
              <select
                value={form.empresa_id}
                onChange={(e) => {
                  const nextEmpresa = empresasNoContexto.find((item) => item.id === e.target.value)
                  setForm((current) => ({
                    ...current,
                    empresa_id: e.target.value,
                    funcionario_id: '',
                    funcionario_codigo: '',
                    centro_custo: nextEmpresa?.centro_custo_padrao || current.centro_custo,
                  }))
                }}
                className="bbt-input"
                required
              >
                <option value="">Selecione a empresa</option>
                {quoteCompanies.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
            </Field>

            <Field label="Solicitante">
              <input value={form.solicitante_nome} onChange={(e) => setForm({ ...form, solicitante_nome: e.target.value })} className="bbt-input" placeholder="Nome de quem pediu" />
            </Field>

            <Field label="ID do funcionario/hospede">
              <input
                value={form.funcionario_codigo}
                onChange={(e) => selecionarFuncionarioPorCodigo(e.target.value)}
                className="bbt-input"
                placeholder="Ex.: 1025"
                inputMode="numeric"
              />
            </Field>

            <Field label="Viajante cadastrado">
              <select value={form.funcionario_id} onChange={(e) => selecionarFuncionario(e.target.value)} className="bbt-input">
                <option value="">Selecionar ou preencher manualmente</option>
                {funcionariosEmpresa.map((item) => <option key={item.id} value={item.id}>{item.codigo_identificacao ? `${item.codigo_identificacao} - ` : ''}{item.nome}</option>)}
              </select>
            </Field>

            <Field label="Viajante / hóspede / passageiro *">
              <input value={form.viajante_nome} onChange={(e) => setForm({ ...form, viajante_nome: e.target.value })} className="bbt-input" placeholder="Nome completo" required />
            </Field>

            <Field label={form.service === 'aereo' ? 'Origem' : 'Origem / retirada'}>
              <input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} className="bbt-input" placeholder="Cidade, aeroporto ou local" />
            </Field>

            <Field label={form.service === 'hotelaria' ? 'Cidade / destino' : 'Destino'}>
              <input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className="bbt-input" placeholder="Cidade, aeroporto ou destino" />
            </Field>

            <Field label={itemLabel(form.service)}>
              <input value={form.item_nome} onChange={(e) => setForm({ ...form, item_nome: e.target.value })} className="bbt-input" placeholder={itemPlaceholder(form.service)} />
            </Field>

            <Field label="Ação">
              <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as SupplierCapability })} className="bbt-input">
                {ACTIONS.map((item) => <option key={item} value={item}>{capabilityLabel(item)}</option>)}
              </select>
            </Field>

            <Field label={form.service === 'hotelaria' ? 'Check-in / início' : 'Data ida / início'}>
              <DateInput
                aria-label={form.service === 'hotelaria' ? 'Check-in / início' : 'Data ida / início'}
                value={form.data_inicio}
                onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
              />
            </Field>

            <Field label={form.service === 'hotelaria' ? 'Check-out / fim' : 'Data volta / fim'}>
              <DateInput
                aria-label={form.service === 'hotelaria' ? 'Check-out / fim' : 'Data volta / fim'}
                value={form.data_fim}
                onChange={(e) => setForm({ ...form, data_fim: e.target.value })}
              />
            </Field>

            <Field label="Centro de custo">
              <input value={form.centro_custo} onChange={(e) => setForm({ ...form, centro_custo: e.target.value })} className="bbt-input" placeholder="Centro de custo / obra / projeto" />
            </Field>

            <Field label="Valor estimado">
              <input value={form.valor_estimado} onChange={(e) => setForm({ ...form, valor_estimado: e.target.value })} className="bbt-input" placeholder="0,00" />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
            <Field label="Prioridade">
              <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })} className="bbt-input">
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </Field>

            <Field label="Observações">
              <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} className="bbt-input min-h-[90px] py-2" placeholder="Política, preferências, justificativa, bagagem, horários, faturamento..." />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
            <button type="button" onClick={resetForm} className="bbt-button-ghost">Limpar</button>
            <button type="submit" disabled={busy} className="bbt-button-primary">
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Criar demanda e solicitar cotacao
            </button>
          </div>
        </form>

        <aside className="space-y-5">
          <div className="bbt-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-bbt-primary dark:text-white">Fornecedores para {serviceLabel(form.service)}</h2>
                <p className="mt-1 text-sm text-slate-500">Marque quem deve receber preparação/log da operação.</p>
              </div>
              <Building2 className="h-5 w-5 text-bbt-accent" />
            </div>

            <div className="mt-4 space-y-2">
              {providerCatalogError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  Catálogo central indisponível. Exibindo a configuração local de compatibilidade.
                </div>
              )}
              {suppliers.map((supplier) => {
                const checked = selectedSupplierIds.includes(supplier.id)
                const href = portalUrl(supplier)
                return (
                  <div key={supplier.id} className={`rounded-lg border p-3 transition ${checked ? 'border-bbt-accent bg-bbt-accent/10' : 'border-bbt-gray-100 dark:border-slate-700'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => toggleSupplier(supplier.id)} className="min-w-0 text-left">
                        <div className="font-semibold text-bbt-primary dark:text-white">{supplier.nome}</div>
                        <div className="mt-1 text-xs text-slate-500">{supplier.modo} · {supplier.status} · prioridade {supplier.prioridade}</div>
                      </button>
                      <input type="checkbox" checked={checked} onChange={() => toggleSupplier(supplier.id)} className="h-5 w-5 accent-bbt-accent" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {supplier.capacidades.slice(0, 5).map((cap) => (
                        <span key={cap} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{capabilityLabel(cap)}</span>
                      ))}
                      {href && (
                        <a href={href} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-bbt-accent hover:underline">
                          Abrir portal <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
              {suppliers.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  <div className="flex gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                      Nenhum fornecedor ativo para este serviço. Cadastre em Configurações &gt; Conexões, APIs e fornecedores.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bbt-card p-5">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-bbt-accent" />
              <h2 className="font-semibold text-bbt-primary dark:text-white">Como a IA BIA usa isso</h2>
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p>Quando você pedir cotação, reserva ou status, a IA consulta estes conectores, a política da empresa, o cadastro do viajante e as demandas existentes.</p>
              <p>Com API configurada, o conector fica pronto para endpoint/token. Sem API, o sistema prepara a operação e abre o portal correto com rastreio interno.</p>
            </div>
          </div>
        </aside>
        </section>
      ) : (
        <div className="space-y-3">
          {demandsError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              {demandsError} A lista abaixo usa apenas o cache local como contingencia.
            </div>
          )}
          <OfflineTravelWorkspace
            demands={demandasNoContexto}
            companies={empresasNoContexto}
            reservations={relationalReservations}
            quoteCompanyIds={quoteCompanyIds}
            reservationCompanyIds={reservationCompanyIds}
            initialDemandId={demandaVinculadaId || undefined}
            canQuoteHotels={canOperateQuotes}
            canQuoteAir={canOperateQuotes}
            canOperateReservations={canOperateReservations}
            onCompleted={refresh}
          />
        </div>
      )}

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-5 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-bbt-accent" />
              <h2 className="font-semibold text-bbt-primary dark:text-white">Reservas e cotações registradas</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Resultados confirmados pelo conector e histórico legado preservado.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-bbt-gray-50 dark:bg-slate-900/40">
                <tr>
                  <Th>Operação</Th>
                  <Th>Empresa</Th>
                  <Th>Viajante</Th>
                  <Th>Período</Th>
                  <Th>Valor</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {relationalReservations.map((item) => (
                  <RelationalReservationRow key={item.id} item={item} />
                ))}
                {quotes.map((item) => (
                  <QuoteRow key={item.id} item={item} />
                ))}
                {reservasLegadasVisiveis.map((item) => (
                  <ReservaRow key={item.id} item={item} />
                ))}
                {(quotesLoading || reservationsLoading) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      Carregando reservas e cotações registradas...
                    </td>
                  </tr>
                )}
                {!quotesLoading && quotesError && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-amber-700">
                      {quotesError}
                    </td>
                  </tr>
                )}
                {!reservationsLoading && reservationsError && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-amber-700">
                      {reservationsError}
                    </td>
                  </tr>
                )}
                {!quotesLoading && !reservationsLoading && !quotesError && !reservationsError
                  && relationalReservations.length === 0 && quotes.length === 0 && reservasLegadasVisiveis.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">Nenhuma reserva ou cotação confirmada pelo fornecedor ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-5 dark:border-slate-700">
            <h2 className="font-semibold text-bbt-primary dark:text-white">Logs de fornecedores</h2>
            <p className="mt-1 text-sm text-slate-500">Auditoria das ações preparadas para APIs e portais.</p>
          </div>
          <div className="max-h-[520px] divide-y divide-bbt-gray-100 overflow-y-auto dark:divide-slate-700">
            {logs.map((log) => <LogRow key={log.id} log={log} />)}
            {logs.length === 0 && <div className="p-8 text-center text-sm text-slate-400">Sem logs ainda.</div>}
          </div>
        </div>
      </section>
    </div>
  )
}

function RelationalReservationRow({ item }: { item: GovernedTravelReservationSummary }) {
  const reference = visibleProviderReference(item.providerReference)
  return (
    <tr className="border-t border-bbt-gray-100 hover:bg-bbt-gray-50 dark:border-slate-700 dark:hover:bg-slate-900/30">
      <td className="px-4 py-3">
        <div className="font-semibold text-bbt-primary dark:text-white">
          {serviceLabel(quoteService(item.service))} · Reserva
        </div>
        <div className="text-xs text-slate-500">
          {providerDisplayName(item.provider)}{reference ? ` · Localizador ${reference}` : ''}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.companyName}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.passengerName}</div>
        <Link
          href={`/dashboard/demandas?id=${encodeURIComponent(item.demandId)}`}
          className="text-xs font-semibold text-bbt-accent hover:underline"
        >
          {item.demandNumber}
        </Link>
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
        {formatPeriod(item.startAt, item.endAt)}
      </td>
      <td className="px-4 py-3">
        {item.finalAmount.toLocaleString('pt-BR', {
          style: 'currency',
          currency: item.currency || 'BRL',
        })}
      </td>
      <td className="px-4 py-3"><RelationalReservationStatusBadge status={item.status} /></td>
    </tr>
  )
}

function QuoteRow({ item }: { item: GovernedTravelQuoteSummary }) {
  return (
    <tr className="border-t border-bbt-gray-100 hover:bg-bbt-gray-50 dark:border-slate-700 dark:hover:bg-slate-900/30">
      <td className="px-4 py-3">
        <div className="font-semibold text-bbt-primary dark:text-white">
          {serviceLabel(quoteService(item.service))} · Cotação
        </div>
        <div className="text-xs text-slate-500">
          {providerDisplayName(item.provider)} · {optionCountLabel(item.optionCount)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.companyName}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.passengerName}</div>
        <Link
          href={`/dashboard/demandas?id=${encodeURIComponent(item.demandId)}`}
          className="text-xs font-semibold text-bbt-accent hover:underline"
        >
          {item.demandNumber}
        </Link>
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
        {formatPeriod(item.travelStartDate, item.travelEndDate)}
        <div className="mt-1 text-slate-500">{item.destination || 'Destino não informado'}</div>
      </td>
      <td className="px-4 py-3">
        {item.minimumAmount === null
          ? '-'
          : item.minimumAmount.toLocaleString('pt-BR', {
              style: 'currency',
              currency: item.currency || 'BRL',
            })}
      </td>
      <td className="px-4 py-3"><QuoteStatusBadge status={item.status} /></td>
    </tr>
  )
}

function ReservaRow({ item }: { item: SupplierReservation }) {
  return (
    <tr className="border-t border-bbt-gray-100 hover:bg-bbt-gray-50 dark:border-slate-700 dark:hover:bg-slate-900/30">
      <td className="px-4 py-3">
        <div className="font-semibold text-bbt-primary dark:text-white">{serviceLabel(item.service)} · {capabilityLabel(item.action)}</div>
        <div className="text-xs text-slate-500">Registro do histórico legado</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.empresa_nome || '-'}</div>
        <div className="text-xs text-slate-500">{item.centro_custo || '-'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.viajante_nome}</div>
        <div className="text-xs text-slate-500">{item.solicitante_nome || '-'}</div>
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
        {formatPeriod(item.data_inicio, item.data_fim)}
        <div className="mt-1 text-slate-500">{[item.origem, item.destino].filter(Boolean).join(' → ') || 'Trajeto não informado'}</div>
      </td>
      <td className="px-4 py-3">{currency(item.valor_estimado || 0)}</td>
      <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
    </tr>
  )
}

function RelationalReservationStatusBadge({ status }: { status: GovernedTravelReservationSummary['status'] }) {
  const labels: Record<GovernedTravelReservationSummary['status'], string> = {
    draft: 'Rascunho',
    prepared: 'Preparada',
    reserved: 'Confirmada',
    issued: 'Emitida',
    cancelled: 'Cancelada',
    failed: 'Falhou',
  }
  const classes: Record<GovernedTravelReservationSummary['status'], string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    prepared: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    reserved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    issued: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  }
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${classes[status]}`}>{labels[status]}</span>
}

function QuoteStatusBadge({ status }: { status: GovernedTravelQuoteSummary['status'] }) {
  const labels: Record<GovernedTravelQuoteSummary['status'], string> = {
    pending: 'Em processamento',
    completed: 'Concluída',
    selected: 'Selecionada',
    expired: 'Expirada',
    failed: 'Falhou',
  }
  const classes: Record<GovernedTravelQuoteSummary['status'], string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    selected: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    expired: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  }
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${classes[status]}`}>{labels[status]}</span>
}

function LogRow({ log }: { log: SupplierActionLog }) {
  return (
    <div className="p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-bbt-primary dark:text-white">{log.supplier_name}</div>
          <div className="mt-1 text-xs text-slate-500">{actionLabel(log.action)} · {log.service ? serviceLabel(log.service) : 'geral'}</div>
        </div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${log.status === 'sucesso' ? 'bg-green-100 text-green-700' : log.status === 'falha' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{log.status}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{log.message}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">{children}</th>
}

function StatusBadge({ status }: { status: SupplierReservationStatus }) {
  const classes: Record<SupplierReservationStatus, string> = {
    rascunho: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    cotacao_preparada: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    reserva_preparada: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    enviado_fornecedor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    confirmado: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    falhou: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    cancelado: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${classes[status]}`}>{status}</span>
}

function mapTipoServico(service: SupplierService): TipoServico {
  if (service === 'aereo') return 'Aéreo'
  if (service === 'hotelaria') return 'Hotel'
  if (service === 'locacao') return 'Carro'
  if (service === 'pacotes' || service === 'lazer' || service === 'transfer' || service === 'seguro') return 'Pacote'
  return 'Outro'
}

function quoteService(value: string): SupplierService {
  if (value === 'aereo') return 'aereo'
  if (value === 'hotelaria' || value === 'hotel') return 'hotelaria'
  if (value === 'locacao' || value === 'carro') return 'locacao'
  if (value === 'lazer') return 'lazer'
  if (value === 'transfer') return 'transfer'
  if (value === 'seguro') return 'seguro'
  return 'pacotes'
}

function serviceFromAtendimento(tipo: TipoServico): SupplierService {
  if (tipo === 'Aéreo') return 'aereo'
  if (tipo === 'Hotel') return 'hotelaria'
  if (tipo === 'Carro') return 'locacao'
  if (tipo === 'Pacote') return 'pacotes'
  return 'hotelaria'
}

function formFromAtendimento(
  current: FormState,
  demanda: Atendimento,
  funcionarios: Funcionario[],
  serialInformado = '',
): FormState {
  const funcionario = demanda.funcionario_id
    ? funcionarios.find((item) => item.id === demanda.funcionario_id)
    : null
  const destino =
    demanda.detalhes_hotel?.cidade ||
    demanda.detalhes_aereo?.destino ||
    demanda.detalhes_pacote?.destino ||
    demanda.detalhes_carro?.cidade_retirada ||
    ''
  const valorEstimado = demanda.valor_venda || demanda.valor_final || demanda.valor_cotacao
  const observacoesDemanda = String(demanda.observacoes || '').trim()
  const observacoesAtuais = String(current.observacoes || '').trim()
  const observacoes = observacoesDemanda && !observacoesAtuais.includes(observacoesDemanda)
    ? [observacoesDemanda, observacoesAtuais].filter(Boolean).join('\n\n')
    : observacoesAtuais

  return {
    ...current,
    serial_os: demanda.serial_os || serialInformado,
    service: serviceFromAtendimento(demanda.tipo_servico),
    empresa_id: demanda.empresa_id || current.empresa_id,
    funcionario_id: demanda.funcionario_id || '',
    funcionario_codigo: funcionario?.codigo_identificacao || '',
    viajante_nome: demanda.passageiro_nome || funcionario?.nome || current.viajante_nome,
    solicitante_nome: demanda.solicitante_nome || current.solicitante_nome,
    origem: demanda.detalhes_aereo?.origem || demanda.detalhes_carro?.cidade_retirada || current.origem,
    destino: destino || current.destino,
    item_nome:
      demanda.detalhes_hotel?.hotel_nome ||
      demanda.detalhes_carro?.locadora ||
      demanda.detalhes_pacote?.descricao ||
      current.item_nome,
    data_inicio:
      demanda.detalhes_hotel?.data_checkin ||
      demanda.detalhes_aereo?.data_ida ||
      demanda.detalhes_carro?.data_retirada ||
      demanda.detalhes_pacote?.data_ida ||
      current.data_inicio,
    data_fim:
      demanda.detalhes_hotel?.data_checkout ||
      demanda.detalhes_aereo?.data_volta ||
      demanda.detalhes_carro?.data_devolucao ||
      demanda.detalhes_pacote?.data_volta ||
      current.data_fim,
    centro_custo: demanda.centro_custo || funcionario?.centro_custo || current.centro_custo,
    valor_estimado: valorEstimado ? String(valorEstimado) : current.valor_estimado,
    prioridade: demanda.prioridade || current.prioridade,
    observacoes,
  }
}

function actionLabel(action: SupplierActionLog['action']): string {
  return action === 'teste' ? 'teste' : capabilityLabel(action)
}

function itemLabel(service: SupplierService): string {
  if (service === 'hotelaria') return 'Hotel preferido'
  if (service === 'locacao') return 'Locadora / categoria'
  if (service === 'aereo') return 'Cia / voo / localizador'
  if (service === 'seguro') return 'Plano / seguradora'
  return 'Produto / pacote'
}

function itemPlaceholder(service: SupplierService): string {
  if (service === 'hotelaria') return 'Hotel, bairro ou preferência'
  if (service === 'locacao') return 'Locadora, categoria ou retirada'
  if (service === 'aereo') return 'Companhia, voo ou preferência'
  if (service === 'seguro') return 'Seguro viagem / cobertura'
  return 'Nome do pacote, lazer, transfer ou operador'
}

function money(value: string): number {
  const normalized = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function currency(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function demandSerialKey(value?: string): string {
  return String(value || '').trim().toLocaleUpperCase('pt-BR')
}

function mergeDemand(current: Atendimento[], demand: Atendimento): Atendimento[] {
  const index = current.findIndex((item) => item.id === demand.id)
  if (index < 0) return [demand, ...current]
  const next = current.slice()
  next[index] = demand
  return next
}

function today(): string {
  return todayISODate()
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const [year, month, day] = value.slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatPeriod(start?: string | null, end?: string | null): string {
  if (start && end) return `${formatDate(start)} até ${formatDate(end)}`
  if (start) return `A partir de ${formatDate(start)}`
  if (end) return `Até ${formatDate(end)}`
  return 'Período não informado'
}

function optionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'opção' : 'opções'}`
}

function providerDisplayName(provider: string): string {
  const normalized = String(provider || '').trim().toLowerCase()
  if (normalized === 'manual-offline') return 'Atendimento offline'
  if (normalized === 'legacy_supplier') return 'Histórico legado'
  if (normalized === 'tech_travel') return 'Tech Travel'
  return String(provider || 'Fornecedor').replace(/[_-]+/g, ' ')
}

function visibleProviderReference(reference?: string | null): string | null {
  const normalized = String(reference || '').trim()
  if (!normalized) return null
  if (/^[a-z0-9_-]+:[a-z0-9_-]+:[a-f0-9]{20,}$/i.test(normalized)) return null
  if (/^offline-(?:emission|reservation):/i.test(normalized)) return null
  return normalized
}
