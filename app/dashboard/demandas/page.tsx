'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { getCurrentUser, getAllUsers, hasPermission } from '@/lib/auth'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import { getOperationalAlerts } from '@/lib/operational-alerts'
import {
  analisarRepasses, executarRepasse, pegarDemanda,
  calcularPrioridadeAuto, diasAteCheckin, formatarDiasCheckin, corPrioridade, scorePrioridade,
} from '@/lib/priorizacao'
import type { Atendimento, Prioridade } from '@/types'
import { labelOcupante } from '@/types'
import {
  ListChecks, Users as UsersIcon, Clock, AlertTriangle, Zap, Hand,
  ArrowRightLeft, CheckCircle2, Calendar, Hotel as HotelIcon, Plane, Car,
  Package, Filter, RefreshCw, UserCheck, Award, TrendingUp, FileText, CalendarCheck,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { SLABadge } from '@/components/ui/sla-badge'
import { Modal } from '@/components/ui/modal'
import { SearchInput } from '@/components/ui/search-input'
import { NovaDemandaModal } from '@/components/ui/nova-demanda-modal'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { marcarUltimaVista } from '@/lib/notificacoes'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import {
  DemandClientError,
  listDemandsFromServer,
  updateDemandAssignmentOnServer,
  type DemandDomainRollout,
  type RelationalDemandClientItem,
} from '@/lib/demands-client'
import { requestDemandTransfer } from '@/lib/demand-transfer-client'
import { getAllSolicitantesEmpresa } from '@/lib/solicitantes-storage'
import {
  filterDemandsForOperationalAssignment,
  scopeDemandsForRequester,
} from '@/lib/demands/requester-ownership'
import { isRequesterUser } from '@/lib/user-access-kind'
import { demandFocusIdFromSearch } from '@/lib/demands/focus-query'
import { travelLifecycleStatusLabel } from '@/lib/travel-lifecycle/presentation'

type Aba = 'fila' | 'minhas' | 'alertas' | 'operacao' | 'balanceamento' | 'kanban' | 'status'

const OPERATION_PAGE_SIZE = 30
const KANBAN_INITIAL_LIMIT = 30
const DEFAULT_DEMAND_ROLLOUT: DemandDomainRollout = {
  domainKey: 'demands',
  readMode: 'shadow',
  writeMode: 'dual',
  status: 'active',
  version: 1,
  pilotCompanyIds: [],
}

export default function DemandasPage() {
  const router = useRouter()
  const { empresas } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const empresasNoContexto = useMemo(
    () => empresas.filter((empresa) => includesCompany(empresa.id, 'ver_demandas')),
    [empresas, includesCompany],
  )
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const requesterView = isRequesterUser(user)
  const podeVerTudo = !requesterView && (
    hasPermission(user, 'ver_produtividade_todos')
    || Boolean(user?.corporate_profile && hasPermission(user, 'ver_demandas'))
  )
  const podeRepassarDireto = hasPermission(user, 'ver_produtividade_todos')
    || hasPermission(user, 'gerenciar_usuarios')

  const [aba, setAba] = useState<Aba>('operacao')
  const [reload, setReload] = useState(0)
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [busca, setBusca] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<'todos' | 'Hotel' | 'Aéreo' | 'Carro' | 'Pacote'>('todos')
  const [filtroPrioridade, setFiltroPrioridade] = useState<'todas' | Prioridade>('todas')
  const [repasseModal, setRepasseModal] = useState<Atendimento | null>(null)
  const [repasseMotivo, setRepasseMotivo] = useState('')
  const [repasseSavingId, setRepasseSavingId] = useState<string | null>(null)
  const [editando, setEditando] = useState<Atendimento | null>(null)
  const [novaDemandaModal, setNovaDemandaModal] = useState(false)
  const [demandaPage, setDemandaPage] = useState(1)
  const [voucherPage, setVoucherPage] = useState(1)
  const [kanbanLimit, setKanbanLimit] = useState(KANBAN_INITIAL_LIMIT)
  const [relationalItems, setRelationalItems] = useState<RelationalDemandClientItem[]>([])
  const [demandRollout, setDemandRollout] = useState<DemandDomainRollout>(DEFAULT_DEMAND_ROLLOUT)
  const [relationalLoading, setRelationalLoading] = useState(true)
  const [relationalError, setRelationalError] = useState<string | null>(null)
  const empresasNoContextoKey = empresasNoContexto.map((empresa) => empresa.id).sort().join('|')
  const relationalById = useMemo(
    () => new Map(relationalItems.map((item) => [item.id, item])),
    [relationalItems],
  )
  const requesterRecords = useMemo(() => {
    void reload
    if (typeof window === 'undefined' || !requesterView) return []
    return getAllSolicitantesEmpresa()
  }, [reload, requesterView])
  const trustedRequesterDemandIds = useMemo(
    () => new Set(
      requesterView && user?.role_key === 'requester'
        ? relationalItems.map((item) => item.id)
        : [],
    ),
    [relationalItems, requesterView, user?.role_key],
  )
  const allAtendimentos = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    const merged = new Map(getAllAtendimentos().map((item) => [item.id, item]))
    relationalItems.forEach((item) => {
      if (relationalReadEnabledForCompany(demandRollout, item.companyId)) {
        merged.set(item.id, item.demand)
      }
    })
    return scopeDemandsForRequester({
      user,
      demands: [...merged.values()],
      requesters: requesterRecords,
      trustedServerDemandIds: trustedRequesterDemandIds,
    })
  }, [demandRollout, relationalItems, reload, requesterRecords, trustedRequesterDemandIds, user])
  const requesterOwnDemandIds = useMemo(
    () => new Set(requesterView ? allAtendimentos.map((demand) => demand.id) : []),
    [allAtendimentos, requesterView],
  )

  useEffect(() => {
    if (filtroEmpresa && !empresasNoContexto.some((empresa) => empresa.id === filtroEmpresa)) {
      setFiltroEmpresa('')
    }
  }, [empresasNoContexto, empresasNoContextoKey, filtroEmpresa])

  useEffect(() => {
    let active = true
    setRelationalLoading(true)
    listDemandsFromServer({ limit: 200 })
      .then((result) => {
        if (!active) return
        setRelationalItems(result.items)
        setDemandRollout(result.rollout)
        setRelationalError(null)
      })
      .catch((error) => {
        if (!active) return
        setRelationalError(error instanceof Error ? error.message : 'Falha ao carregar a fila relacional.')
      })
      .finally(() => {
        if (active) setRelationalLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload, empresasNoContextoKey])

  // V9: Marca última demanda vista pra zerar badge da sidebar
  useEffect(() => {
    const todosAtendimentos = allAtendimentos.filter((atendimento) => includesCompany(atendimento.empresa_id, 'ver_demandas'))
    const todas = todosAtendimentos
      .filter((a) => ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (todas.length > 0) marcarUltimaVista(todas[0].id)

    const atendimentoId = demandFocusIdFromSearch(window.location.search)
    if (atendimentoId) {
      const demandaAlvo = todosAtendimentos.find((item) => item.id === atendimentoId)
      if (demandaAlvo) {
        setAba('operacao')
        setBusca(demandaAlvo.serial_os || demandaAlvo.id)
        if (!requesterView || requesterOwnDemandIds.has(demandaAlvo.id)) {
          setEditando(demandaAlvo)
        }
      }
    }
  }, [allAtendimentos, includesCompany, requesterOwnDemandIds, requesterView])

  const agentes = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    return getAllUsers().filter((u) => u.perfil_bbt && u.ativo !== false)
  }, [reload])

  const atendimentos = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    const all = allAtendimentos.filter((atendimento) => includesCompany(atendimento.empresa_id, 'ver_demandas'))

    // Quando aba é 'status' (kanban por status), mostra TODAS, mesmo finalizadas
    let filtrados = aba === 'status'
      ? [...all]
      : all.filter((a) => ['em_andamento', 'aguardando_cliente', 'pendente'].includes(a.status))

    filtrados = filterDemandsForOperationalAssignment({
      demands: filtrados,
      userId: user?.id,
      canViewAll: podeVerTudo,
      requesterView,
    })

    if (filtroEmpresa) filtrados = filtrados.filter((a) => a.empresa_id === filtroEmpresa)
    if (tipoFiltro !== 'todos') filtrados = filtrados.filter((a) => a.tipo_servico === tipoFiltro)
    if (filtroPrioridade !== 'todas') filtrados = filtrados.filter((a) => a.prioridade === filtroPrioridade)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      filtrados = filtrados.filter((a) =>
        a.passageiro_nome.toLowerCase().includes(q) ||
        empresasNoContexto.find((e) => e.id === a.empresa_id)?.nome.toLowerCase().includes(q) ||
        (a.numero_solicitacao || '').toLowerCase().includes(q) ||
        (a.serial_os || '').toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.detalhes_hotel?.localizador || '').toLowerCase().includes(q) ||
        (a.detalhes_aereo?.localizador || '').toLowerCase().includes(q)
      )
    }

    return filtrados.map((a) => ({
      ...a,
      _prioridade: calcularPrioridadeAuto(a),
      _dias: diasAteCheckin(a),
      _score: scorePrioridade(a),
    }))
  }, [reload, filtroEmpresa, tipoFiltro, filtroPrioridade, busca, empresasNoContexto, includesCompany, podeVerTudo, requesterView, user, aba, allAtendimentos])

  const analise = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return { sugestoes: [], carga_por_agente: {} }
    return analisarRepasses(allAtendimentos.filter((atendimento) => includesCompany(atendimento.empresa_id, 'ver_demandas')))
  }, [reload, includesCompany, allAtendimentos])

  const alertas = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    return getOperationalAlerts({
      atendimentos: allAtendimentos.filter((atendimento) => includesCompany(atendimento.empresa_id, 'ver_demandas')),
      vouchers: getAllVouchersEmitidos().filter((voucher) => includesCompany(voucher.empresa_id, 'ver_vouchers')),
      empresas: empresasNoContexto,
    })
  }, [reload, empresasNoContexto, includesCompany, allAtendimentos])

  const vouchersOperacao = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    let list = getAllVouchersEmitidos().filter((voucher) => includesCompany(voucher.empresa_id, 'ver_vouchers'))
    if (requesterView) {
      const ownDemandIds = new Set(allAtendimentos.map((demand) => demand.id))
      const ownVoucherIds = new Set(allAtendimentos.flatMap((demand) => demand.voucher_ids || []))
      list = list.filter((voucher) => (
        ownVoucherIds.has(voucher.id)
        || Boolean(voucher.atendimento_id && ownDemandIds.has(voucher.atendimento_id))
      ))
    }
    if (filtroEmpresa) list = list.filter((v) => v.empresa_id === filtroEmpresa)
    if (tipoFiltro !== 'todos') list = list.filter((v) => v.tipo === tipoFiltro)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      list = list.filter((v) =>
        v.id.toLowerCase().includes(q) ||
        v.passageiro_nome.toLowerCase().includes(q) ||
        v.fornecedor_nome.toLowerCase().includes(q) ||
        (v.localizador || '').toLowerCase().includes(q) ||
        (v.numero_confirmacao || '').toLowerCase().includes(q) ||
        (v.numero_solicitacao || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [reload, filtroEmpresa, tipoFiltro, busca, includesCompany, requesterView, allAtendimentos])

  const minhas = useMemo(() => {
    if (requesterView) return [...atendimentos].sort((a: any, b: any) => b._score - a._score)
    return atendimentos.filter((a) => a.agente_user_id === user?.id).sort((a: any, b: any) => b._score - a._score)
  }, [atendimentos, requesterView, user])

  const fila = useMemo(() => {
    if (requesterView) return []
    return atendimentos
      .filter((a) => !a.agente_user_id || a.em_atendimento === false)
      .sort((a: any, b: any) => b._score - a._score)
  }, [atendimentos, requesterView])

  const demandaPageCount = Math.max(1, Math.ceil(atendimentos.length / OPERATION_PAGE_SIZE))
  const currentDemandaPage = Math.min(demandaPage, demandaPageCount)
  const atendimentosPaginados = useMemo(() => {
    const start = (currentDemandaPage - 1) * OPERATION_PAGE_SIZE
    return atendimentos.slice(start, start + OPERATION_PAGE_SIZE)
  }, [atendimentos, currentDemandaPage])

  const voucherPageCount = Math.max(1, Math.ceil(vouchersOperacao.length / OPERATION_PAGE_SIZE))
  const currentVoucherPage = Math.min(voucherPage, voucherPageCount)
  const vouchersPaginados = useMemo(() => {
    const start = (currentVoucherPage - 1) * OPERATION_PAGE_SIZE
    return vouchersOperacao.slice(start, start + OPERATION_PAGE_SIZE)
  }, [currentVoucherPage, vouchersOperacao])

  useEffect(() => {
    setDemandaPage(1)
    setVoucherPage(1)
    setKanbanLimit(KANBAN_INITIAL_LIMIT)
  }, [aba, busca, filtroEmpresa, filtroPrioridade, tipoFiltro])

  function refresh() { setReload((n) => n + 1) }

  function openDemand(demand: Atendimento) {
    if (requesterView && !requesterOwnDemandIds.has(demand.id)) {
      toast.error('Esta demanda não pertence ao seu usuário solicitante.')
      return
    }
    setEditando(demand)
  }

  function upsertRelationalItem(item: RelationalDemandClientItem) {
    setRelationalItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id)
      if (index === -1) return [item, ...current]
      const next = current.slice()
      next[index] = item
      return next
    })
  }

  async function resolveRelationalItem(
    demandId: string,
    companyId: string,
  ): Promise<RelationalDemandClientItem | null> {
    if (!relationalWriteEnabledForCompany(demandRollout, companyId)) return null
    const current = relationalById.get(demandId)
    if (current) return current
    const result = await listDemandsFromServer({ search: demandId, limit: 10 })
    const exact = result.items.find((item) => item.id === demandId) || null
    if (exact) upsertRelationalItem(exact)
    return exact
  }

  function reportDemandMutationFailure(error: unknown) {
    if (error instanceof DemandClientError && error.code === 'STALE_DEMAND_VERSION') {
      toast.error('A demanda foi alterada por outra pessoa. A fila sera atualizada.')
      refresh()
      return
    }
    toast.error(error instanceof Error ? error.message : 'Nao foi possivel atualizar a demanda.')
  }

  async function handlePegar(a: Atendimento) {
    if (!user) return
    if (requesterView) {
      toast.error('Atribuição e triagem são restritas à equipe operacional.')
      return
    }
    if (!includesCompany(a.empresa_id, 'criar_demandas')) {
      toast.error('Seu acesso a esta empresa permite somente consultar demandas.')
      return
    }
    try {
      const relational = await resolveRelationalItem(a.id, a.empresa_id)
      if (relational) {
        const result = await updateDemandAssignmentOnServer(a.id, {
          assigneeUserId: user.id,
          expectedVersion: relational.version,
          reason: `Aceite manual da fila por ${user.name}`,
          idempotencyKey: demandOperationKey(a.id, 'take'),
        })
        upsertRelationalItem(result.item)
        toast.success(`Demanda "${a.passageiro_nome}" agora e sua`)
        return
      }
    } catch (error) {
      reportDemandMutationFailure(error)
      return
    }
    if (pegarDemanda(a, user.id, user.name)) {
      try {
        await commitPendingRemoteStorage()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a atribuicao no servidor.')
        return
      }
      toast.success(`Demanda "${a.passageiro_nome}" agora é sua`)
      refresh()
    } else {
      toast.error('Erro ao pegar demanda')
    }
  }

  async function handleRepassar(a: Atendimento, novoAgenteId: string) {
    if (!user) return
    if (requesterView) {
      toast.error('O repasse é restrito à equipe operacional.')
      return
    }
    if (!includesCompany(a.empresa_id, 'criar_demandas')) {
      toast.error('Seu acesso a esta empresa permite somente consultar demandas.')
      return
    }
    const ag = agentes.find((x) => x.id === novoAgenteId)
    if (!ag) return
    const informedReason = repasseMotivo.trim()
    const reason = informedReason || (repasseModal ? 'Repasse manual' : 'Redistribuicao operacional')
    setRepasseSavingId(novoAgenteId)
    try {
      const relational = await resolveRelationalItem(a.id, a.empresa_id)
      if (relational) {
        if (!podeRepassarDireto) {
          if (a.agente_user_id !== user.id) {
            toast.error('Somente o responsável atual pode solicitar o repasse desta demanda.')
            return
          }
          if (informedReason.length < 5) {
            toast.error('Informe o motivo do repasse com pelo menos 5 caracteres.')
            return
          }
          await requestDemandTransfer({
            demandId: a.id,
            destinationUserId: ag.id,
            reason: informedReason,
            expectedDemandVersion: relational.version,
          })
          toast.success(`Solicitação de repasse enviada para ${ag.name}`)
          setRepasseModal(null)
          setRepasseMotivo('')
          return
        }
        const result = await updateDemandAssignmentOnServer(a.id, {
          assigneeUserId: ag.id,
          expectedVersion: relational.version,
          reason,
          idempotencyKey: demandOperationKey(a.id, 'transfer'),
        })
        upsertRelationalItem(result.item)
        toast.success(`Repassado para ${ag.name}`)
        setRepasseModal(null)
        setRepasseMotivo('')
        return
      }
      if (executarRepasse(a, ag.id, ag.name, user.id, user.name, repasseModal ? 'Repasse manual' : 'Redistribuição')) {
        try {
          await commitPendingRemoteStorage()
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o repasse no servidor.')
          return
        }
        toast.success(`Repassado para ${ag.name}`)
        setRepasseModal(null)
        setRepasseMotivo('')
        refresh()
      }
    } catch (error) {
      reportDemandMutationFailure(error)
    } finally {
      setRepasseSavingId(null)
    }
  }

  async function handleAplicarSugestao(sug: any) {
    if (!user) return
    if (requesterView) {
      toast.error('O balanceamento é restrito à equipe operacional.')
      return
    }
    if (!includesCompany(sug.atendimento?.empresa_id, 'criar_demandas')) {
      toast.error('Seu acesso a esta empresa permite somente consultar demandas.')
      return
    }
    const ag = agentes.find((x) => x.id === sug.agente_sugerido)
    if (!ag) return
    try {
      const relational = await resolveRelationalItem(sug.atendimento.id, sug.atendimento.empresa_id)
      if (relational) {
        const result = await updateDemandAssignmentOnServer(sug.atendimento.id, {
          assigneeUserId: ag.id,
          expectedVersion: relational.version,
          reason: String(sug.motivo || 'Rebalanceamento operacional'),
          idempotencyKey: demandOperationKey(sug.atendimento.id, 'rebalance'),
        })
        upsertRelationalItem(result.item)
        toast.success(`Demanda "${sug.atendimento.passageiro_nome}" atribuida a ${ag.name}`)
        return
      }
    } catch (error) {
      reportDemandMutationFailure(error)
      return
    }
    if (executarRepasse(sug.atendimento, ag.id, ag.name, user.id, user.name, sug.motivo)) {
      try {
        await commitPendingRemoteStorage()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o repasse no servidor.')
        return
      }
      toast.success(`Demanda "${sug.atendimento.passageiro_nome}" → ${ag.name}`)
      refresh()
    }
  }

  async function aplicarTodasSugestoes() {
    if (!user) return
    if (requesterView) {
      toast.error('O balanceamento é restrito à equipe operacional.')
      return
    }
    let ok = 0
    let failed = 0
    let legacyChanged = false
    for (const sug of analise.sugestoes.slice(0, 20)) {
      if (!includesCompany(sug.atendimento?.empresa_id, 'criar_demandas')) continue
      const ag = agentes.find((x) => x.id === sug.agente_sugerido)
      if (!ag) continue
      try {
        const relational = await resolveRelationalItem(sug.atendimento.id, sug.atendimento.empresa_id)
        if (relational) {
          const result = await updateDemandAssignmentOnServer(sug.atendimento.id, {
            assigneeUserId: ag.id,
            expectedVersion: relational.version,
            reason: String(sug.motivo || 'Rebalanceamento operacional'),
            idempotencyKey: demandOperationKey(sug.atendimento.id, 'rebalance-bulk'),
          })
          upsertRelationalItem(result.item)
          ok += 1
          continue
        }
        if (executarRepasse(sug.atendimento, ag.id, ag.name, user.id, user.name, sug.motivo)) {
          ok += 1
          legacyChanged = true
        }
      } catch {
        failed += 1
      }
    }
    if (legacyChanged) {
      try {
        await commitPendingRemoteStorage()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar as redistribuicoes no servidor.')
        return
      }
    }
    if (failed > 0) {
      toast.warning(`${ok} demanda(s) redistribuída(s); ${failed} precisa(m) ser atualizada(s) e revisada(s).`)
    } else {
      toast.success(`${ok} demanda(s) redistribuída(s).`)
    }
    refresh()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* HERO operacional V16 */}
      <section className="relative overflow-hidden rounded-lg border border-[#353d78] bg-[#20265a] text-white shadow-[0_12px_30px_rgba(32,38,90,0.16)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)]" />
        <div className="relative grid gap-5 p-6 lg:p-7 xl:grid-cols-[1fr_auto] xl:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
              {requesterView ? 'Portal · Solicitações' : 'Operação · Atendimento'}
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight lg:text-3xl flex items-center gap-3">
              <ListChecks className="w-7 h-7 text-cyan-200" />
              {requesterView ? 'Minhas demandas' : 'Demandas e Vouchers'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100/75">
              {requesterView
                ? 'Acompanhe somente as solicitações vinculadas ao seu cadastro de solicitante.'
                : 'Operação unificada: demandas criadas, vouchers manuais, PDFs importados e Wintour no mesmo fluxo.'}
            </p>
            {requesterView ? (
              <div className="mt-4 grid max-w-xs grid-cols-1 gap-2">
                <DemHeroMetric icon={ListChecks} label="Minhas solicitações" value={atendimentos.length} />
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
                <DemHeroMetric icon={Hand} label="Fila" value={fila.length} />
                <DemHeroMetric icon={UserCheck} label="Minhas" value={minhas.length} />
                <DemHeroMetric icon={AlertTriangle} label="Alertas" value={alertas.length} highlight={alertas.length > 0} />
                <DemHeroMetric icon={FileText} label="Operação" value={atendimentos.length + vouchersOperacao.length} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => {
              if (requesterView) router.push('/dashboard/portal-empresa')
              else { setEditando(null); setNovaDemandaModal(true) }
            }}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20">
              <Zap className="w-4 h-4" /> {requesterView ? 'Abrir portal' : 'Nova demanda para cliente'}
            </button>
            <button onClick={refresh}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-white text-sm hover:bg-white/15 transition border border-white/15">
              <RefreshCw className={`w-4 h-4 ${relationalLoading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
        </div>
      </section>

      {relationalError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Sincronização operacional indisponível</p>
            <p className="mt-0.5 break-words text-xs opacity-80">{relationalError}</p>
          </div>
        </div>
      )}

      {/* Abas */}
      <div className="bbt-tabs overflow-x-auto">
        {requesterView ? (
          <BtnAba active={aba === 'operacao'} onClick={() => setAba('operacao')} icon={FileText} label={`Minhas demandas (${atendimentos.length})`} />
        ) : (
          <>
            <BtnAba active={aba === 'fila'} onClick={() => setAba('fila')} icon={Hand} label={`Fila (${fila.length})`} />
            <BtnAba active={aba === 'minhas'} onClick={() => setAba('minhas')} icon={UserCheck} label={`Minhas (${minhas.length})`} />
            <BtnAba active={aba === 'alertas'} onClick={() => setAba('alertas')} icon={AlertTriangle} label={`Alertas (${alertas.length})`} badge={alertas.length > 0} />
            <BtnAba active={aba === 'operacao'} onClick={() => setAba('operacao')} icon={FileText} label={`Operação (${atendimentos.length + vouchersOperacao.length})`} />
            <BtnAba active={aba === 'status'} onClick={() => setAba('status')} icon={Filter} label="Por Status" />
            {podeVerTudo && (
              <>
                <BtnAba active={aba === 'balanceamento'} onClick={() => setAba('balanceamento')} icon={ArrowRightLeft}
                  label={`Balanceamento${analise.sugestoes.length > 0 ? ` (${analise.sugestoes.length})` : ''}`}
                  badge={analise.sugestoes.length > 0} />
                <BtnAba active={aba === 'kanban'} onClick={() => setAba('kanban')} icon={UsersIcon} label="Por Agente" />
              </>
            )}
          </>
        )}
      </div>

      {/* Filtros */}
      <div className="bbt-card p-3 space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px]">
            <SearchInput value={busca} onChangeValue={setBusca} placeholder="Buscar OS, passageiro, empresa ou localizador..." />
          </div>
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="bbt-input max-w-xs">
            <option value="">Todas empresas</option>
            {empresasNoContexto.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Tipo:</span>
          <div className="flex gap-1">
            {(['todos', 'Hotel', 'Aéreo', 'Carro', 'Pacote'] as const).map((t) => (
              <button key={t} onClick={() => setTipoFiltro(t)}
                className={`text-xs px-3 py-1.5 rounded-lg transition ${
                  tipoFiltro === t ? 'bg-bbt-accent text-white' : 'bg-bbt-gray-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-bbt-gray-100'
                }`}>{t}</button>
            ))}
          </div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold ml-3">Prioridade:</span>
          <div className="flex gap-1">
            {(['todas', 'urgente', 'alta', 'media', 'baixa'] as const).map((p) => (
              <button key={p} onClick={() => setFiltroPrioridade(p)}
                className={`text-xs px-3 py-1.5 rounded-lg transition ${
                  filtroPrioridade === p
                    ? p === 'urgente' ? 'bg-red-500 text-white'
                    : p === 'alta' ? 'bg-amber-500 text-white'
                    : p === 'media' ? 'bg-blue-500 text-white'
                    : p === 'baixa' ? 'bg-slate-500 text-white'
                    : 'bg-bbt-accent text-white'
                    : 'bg-bbt-gray-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-bbt-gray-100'
                }`}>{p === 'todas' ? 'Todas' : p === 'media' ? 'Média' : p.charAt(0).toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ABA: FILA (demandas sem agente) */}
      {aba === 'fila' && (
        <div>
          {fila.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nenhuma demanda na fila"
              subtitle="Todas as demandas têm agente responsável" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fila.map((a) => (
                <DemandaCard key={a.id} demanda={a as any} empresas={empresas} agentes={agentes}
                  onPegar={!requesterView ? () => handlePegar(a) : undefined}
                  onRepassar={!requesterView ? () => setRepasseModal(a) : undefined}
                  showOperationalLinks={!requesterView}
                  showAgente />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA: MINHAS */}
      {aba === 'minhas' && (
        <div>
          {minhas.length === 0 ? (
            <EmptyState icon={UserCheck} title="Você não tem demandas abertas"
              subtitle="Veja a Fila pra pegar as que estão disponíveis" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {minhas.map((a) => (
                <DemandaCard key={a.id} demanda={a as any} empresas={empresas} agentes={agentes}
                  onRepassar={!requesterView ? () => setRepasseModal(a) : undefined}
                  showOperationalLinks={!requesterView}
                  isOwn />
              ))}
            </div>
          )}
        </div>
      )}

      {aba === 'alertas' && (
        <div className="space-y-3">
          {alertas.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nenhum alerta operacional"
              subtitle="Check-ins, embarques e importações Wintour próximas aparecem aqui." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {alertas.map((alerta) => (
                <button
                  key={alerta.id}
                  onClick={() => router.push(alerta.href)}
                  className="bbt-card p-4 text-left transition hover:border-bbt-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase ${classeAlerta(alerta.severity)}`}>
                      {alerta.severity}
                    </span>
                    <span className="text-[11px] text-slate-500">{alerta.date || '-'}</span>
                  </div>
                  <div className="mt-3 font-semibold text-bbt-primary dark:text-white">{alerta.title}</div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{alerta.detail}</div>
                  <div className="mt-3 text-[11px] uppercase tracking-wider text-slate-400">
                    {alerta.entityType} · {alerta.service || 'serviço'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA: BALANCEAMENTO (só master/supervisor) */}
      {aba === 'operacao' && (
        <div className={`grid grid-cols-1 gap-4 ${requesterView ? '' : 'xl:grid-cols-2'}`}>
          <div className="bbt-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-bbt-accent" /> Demandas/Solicitações
              </h3>
              <span className="text-xs text-slate-500">{atendimentos.length} registro{atendimentos.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-2 max-h-[650px] overflow-y-auto pr-1">
              {atendimentos.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Nenhuma demanda no filtro atual.</p>
              ) : (
                atendimentosPaginados.map((a) => (
                  <DemandaCardMini key={a.id} demanda={a as any} empresas={empresas}
                    onClick={() => openDemand(a)}
                    mostrarAgente={podeVerTudo} agentes={agentes} />
                ))
              )}
            </div>
            <ListPagination
              page={currentDemandaPage}
              pageSize={OPERATION_PAGE_SIZE}
              total={atendimentos.length}
              onPageChange={setDemandaPage}
            />
          </div>

          {!requesterView && <div className="bbt-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-bbt-accent" /> Vouchers vinculados/importados
              </h3>
              <span className="text-xs text-slate-500">{vouchersOperacao.length} registro{vouchersOperacao.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-2 max-h-[650px] overflow-y-auto pr-1">
              {vouchersOperacao.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Nenhum voucher no filtro atual.</p>
              ) : (
                vouchersPaginados.map((v) => {
                  const empresa = empresas.find((e) => e.id === v.empresa_id)
                  return (
                    <button
                      key={v.id}
                      onClick={() => router.push(`/dashboard/vouchers/${v.id}`)}
                      className="w-full text-left rounded-lg border border-bbt-gray-100 dark:border-slate-700 p-3 hover:border-bbt-accent transition bg-white dark:bg-slate-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-sm truncate">{v.passageiro_nome}</strong>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-bbt-accent/10 text-bbt-accent font-semibold">{v.id}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{empresa?.nome || 'Empresa não localizada'}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                        <span>{v.tipo} · {v.status}</span>
                        <span className="text-right truncate">{v.data_checkin || v.data_ida || v.retirada_data || '-'}</span>
                        <span className="truncate">{v.fornecedor_nome}</span>
                        <span className="text-right">{v.atendimento_id ? 'com demanda' : 'sem demanda'}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
            <ListPagination
              page={currentVoucherPage}
              pageSize={OPERATION_PAGE_SIZE}
              total={vouchersOperacao.length}
              onPageChange={setVoucherPage}
            />
          </div>}
        </div>
      )}

      {aba === 'balanceamento' && podeVerTudo && (
        <div className="space-y-4">
          {/* Carga por agente */}
          <div className="bbt-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-bbt-accent" /> Carga da equipe
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(analise.carga_por_agente).map(([uid, c]: any) => (
                <div key={uid} className="p-3 rounded-lg border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{c.nome}</span>
                    <span className="text-xs font-bold text-bbt-primary dark:text-white">{c.total}</span>
                  </div>
                  <div className="flex gap-1 text-[10px] flex-wrap">
                    {c.urgentes > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">🚨 {c.urgentes} urg</span>}
                    {c.altas > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">⚡ {c.altas} alta</span>}
                    {c.medias > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">📅 {c.medias} média</span>}
                    {c.baixas > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-700">📆 {c.baixas} baixa</span>}
                  </div>
                  {c.mais_urgente_dias !== null && c.mais_urgente_dias <= 3 && (
                    <div className="mt-2 text-[10px] text-red-600 dark:text-red-400 font-semibold">
                      ⚠ Check-in mais próximo: {formatarDiasCheckin(c.mais_urgente_dias)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sugestões de repasse */}
          {analise.sugestoes.length > 0 ? (
            <div className="bbt-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Sugestões de repasse ({analise.sugestoes.length})
                </h3>
                <button onClick={aplicarTodasSugestoes} className="bbt-button-primary text-xs flex items-center gap-1">
                  <ArrowRightLeft className="w-3 h-3" /> Aplicar lote (até 20)
                </button>
              </div>
              <div className="space-y-2">
                {analise.sugestoes.map((sug) => {
                  const agAtual = agentes.find((x) => x.id === sug.agente_atual)
                  const agNovo = agentes.find((x) => x.id === sug.agente_sugerido)
                  const empresa = empresas.find((e) => e.id === sug.atendimento.empresa_id)
                  return (
                    <div key={sug.atendimento.id} className="p-3 rounded-lg border border-bbt-accent/30 bg-bbt-accent/5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <strong className="text-sm truncate">{sug.atendimento.passageiro_nome}</strong>
                          <span className="text-[10px] px-1.5 rounded bg-bbt-gray-100 dark:bg-slate-700">{empresa?.nome || '—'}</span>
                          <span className="text-[10px] font-semibold text-bbt-accent">{formatarDiasCheckin(sug.dias_checkin)}</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                          <span className="text-red-600">{agAtual?.name || 'Sem agente'}</span>
                          <ArrowRightLeft className="w-3 h-3" />
                          <span className="text-green-600 font-semibold">{agNovo?.name}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 italic mt-0.5">{sug.motivo}</div>
                      </div>
                      <button onClick={() => handleAplicarSugestao(sug)}
                        className="bbt-button-primary text-xs whitespace-nowrap">
                        Aplicar
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Tudo equilibrado"
              subtitle="Não há sugestões de repasse. A carga está bem distribuída" />
          )}
        </div>
      )}

      {/* ABA: KANBAN por agente */}
      {aba === 'kanban' && podeVerTudo && (
        <div className="overflow-x-auto">
          <div className="flex gap-3 min-w-max pb-3">
            {agentes.filter((u) => u.perfil_bbt !== 'gestor_financeiro').map((ag) => {
              const minhasAg = atendimentos.filter((a) => a.agente_user_id === ag.id)
                .sort((a: any, b: any) => b._score - a._score)
              return (
                <div key={ag.id} className="w-80 shrink-0">
                  <div className="bbt-card p-3 mb-2 flex items-center justify-between bg-bbt-primary text-white">
                    <div>
                      <div className="font-semibold text-sm">{ag.name}</div>
                      <div className="text-[10px] opacity-80">{minhasAg.length} demandas</div>
                    </div>
                    {(analise.carga_por_agente[ag.id]?.urgentes || 0) > 0 && (
                      <div className="bbt-badge bg-red-500 text-white text-[10px]">
                        {analise.carga_por_agente[ag.id].urgentes} urg
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {minhasAg.length === 0 ? (
                      <div className="text-xs text-slate-400 text-center p-6 border border-dashed rounded-lg border-bbt-gray-100 dark:border-slate-700">
                        Sem demandas
                      </div>
                    ) : (
                      minhasAg.slice(0, kanbanLimit).map((a) => (
                        <DemandaCardMini key={a.id} demanda={a as any} empresas={empresas}
                          onClick={() => openDemand(a)} />
                      ))
                    )}
                    {minhasAg.length > kanbanLimit && (
                      <ShowMoreButton
                        remaining={minhasAg.length - kanbanLimit}
                        onClick={() => setKanbanLimit((limit) => limit + KANBAN_INITIAL_LIMIT)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ABA: KANBAN POR STATUS (V8) */}
      {aba === 'status' && (
        <div className="overflow-x-auto">
          <div className="flex gap-3 min-w-max pb-3">
            {(['pendente', 'em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado'] as const).map((st) => {
              const items = atendimentos.filter((a) => a.status === st).sort((a: any, b: any) => b._score - a._score)
              const cor = st === 'pendente' ? 'bg-slate-500'
                : st === 'em_andamento' ? 'bg-blue-500'
                : st === 'aguardando_cliente' ? 'bg-amber-500'
                : st === 'finalizado' ? 'bg-green-500'
                : 'bg-red-500'
              const label = st === 'em_andamento' ? 'Em Andamento'
                : st === 'aguardando_cliente' ? 'Aguardando Cliente'
                : st === 'finalizado' ? 'Finalizado'
                : st === 'cancelado' ? 'Cancelado' : 'Pendente'
              return (
                <div key={st} className="w-80 shrink-0">
                  <div className={`p-3 mb-2 rounded-xl flex items-center justify-between text-white ${cor}`}>
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">{items.length}</div>
                  </div>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {items.length === 0 ? (
                      <div className="text-xs text-slate-400 text-center p-6 border border-dashed rounded-lg border-bbt-gray-100 dark:border-slate-700">
                        Sem demandas
                      </div>
                    ) : (
                      items.slice(0, kanbanLimit).map((a) => (
                        <DemandaCardMini key={a.id} demanda={a as any} empresas={empresas}
                          onClick={() => openDemand(a)}
                          mostrarAgente={podeVerTudo} agentes={agentes} />
                      ))
                    )}
                    {items.length > kanbanLimit && (
                      <ShowMoreButton
                        remaining={items.length - kanbanLimit}
                        onClick={() => setKanbanLimit((limit) => limit + KANBAN_INITIAL_LIMIT)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal de repasse manual */}
      <Modal
        open={!!repasseModal}
        onClose={() => {
          setRepasseModal(null)
          setRepasseMotivo('')
        }}
        title={repasseModal ? `Repassar: ${repasseModal.passageiro_nome}` : ''}
        size="md">
        {repasseModal && (
          <div className="space-y-3">
            <div className="text-sm text-slate-600 dark:text-slate-400 p-3 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
              <div><strong>{repasseModal.passageiro_nome}</strong> · {repasseModal.tipo_servico}</div>
              <div className="text-xs mt-1">Check-in: {formatarDiasCheckin(diasAteCheckin(repasseModal))}</div>
              <div className="text-xs">Agente atual: {agentes.find((x) => x.id === repasseModal.agente_user_id)?.name || 'Sem agente'}</div>
            </div>
            <div>
              <label
                htmlFor="repasse-motivo"
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400"
              >
                Motivo do repasse {!podeRepassarDireto && <span className="text-red-500">*</span>}
              </label>
              <textarea
                id="repasse-motivo"
                value={repasseMotivo}
                onChange={(event) => setRepasseMotivo(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={podeRepassarDireto
                  ? 'Contexto opcional para a trilha operacional'
                  : 'Explique por que a demanda deve ser transferida'}
                className="bbt-input w-full resize-y"
              />
              {!podeRepassarDireto && (
                <p className="mt-1 text-xs text-slate-500">
                  O novo responsável precisa aceitar a solicitação antes da troca.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                {podeRepassarDireto ? 'Repassar para:' : 'Solicitar repasse para:'}
              </label>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {agentes.filter((u) => u.id !== repasseModal.agente_user_id).map((ag) => {
                  const carga = analise.carga_por_agente[ag.id]
                  return (
                    <button
                      key={ag.id}
                      onClick={() => void handleRepassar(repasseModal, ag.id)}
                      disabled={repasseSavingId !== null}
                      className="w-full flex items-center justify-between p-2 rounded-lg border border-bbt-gray-100 dark:border-slate-700 hover:bg-bbt-accent/5 hover:border-bbt-accent text-left transition">
                      <div>
                        <div className="text-sm font-medium">{ag.name}</div>
                        <div className="text-[10px] text-slate-500">{carga?.total || 0} demandas · {carga?.urgentes || 0} urgentes</div>
                      </div>
                      {repasseSavingId === ag.id
                        ? <RefreshCw className="w-4 h-4 animate-spin text-bbt-accent" />
                        : <ArrowRightLeft className="w-4 h-4 text-bbt-accent" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de edição de demanda (V8: cards agora editam direto) */}
      <NovaDemandaModal
        open={!!editando || novaDemandaModal}
        onClose={() => { setEditando(null); setNovaDemandaModal(false) }}
        editing={editando}
        requesterOwnershipVerified={Boolean(editando && requesterOwnDemandIds.has(editando.id))}
        readOnly={Boolean(editando && requesterView && !includesCompany(editando.empresa_id, 'criar_demandas'))}
        onSaved={() => { refresh(); setNovaDemandaModal(false); setEditando(null) }}
      />

      <AIAssistantFab
        pageContext="Demandas e Vouchers"
        dataContext={`Total atendimentos: ${atendimentos.length}\nNa fila (sem agente): ${fila.length}\nMinhas demandas: ${minhas.length}\nAlertas operacionais: ${alertas.length}\nVouchers em operação: ${vouchersOperacao.length}\nFiltro empresa: ${filtroEmpresa ? empresas.find(e => e.id === filtroEmpresa)?.nome || 'desconhecida' : 'todas'}\nFiltro tipo: ${tipoFiltro}\nFiltro prioridade: ${filtroPrioridade}`}
        suggestedPrompts={[
          'Quais demandas devem ser tratadas primeiro?',
          'Tem alguém com sobrecarga de tarefas?',
          'Mostre as demandas urgentes sem agente',
          'Quais alertas posso resolver agora?',
          'Sugira quem pegar a próxima demanda da fila',
        ]}
      />
    </div>
  )
}

// ============ Componentes auxiliares ============

function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-bbt-gray-100 pt-3 text-xs text-slate-500 dark:border-slate-700">
      <span>Exibindo {start}-{end} de {total}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-bbt-gray-100 transition hover:border-bbt-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <strong className="min-w-12 text-center text-bbt-primary dark:text-white">{page}/{totalPages}</strong>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-bbt-gray-100 transition hover:border-bbt-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-dashed border-bbt-gray-100 px-3 py-2 text-xs font-semibold text-bbt-primary transition hover:border-bbt-accent hover:bg-bbt-accent/5 dark:border-slate-700 dark:text-white"
    >
      Mostrar mais ({remaining} restante{remaining === 1 ? '' : 's'})
    </button>
  )
}

function BtnAba({ active, onClick, icon: Icon, label, badge }: any) {
  return (
    <button onClick={onClick}
      className={`bbt-tab flex items-center gap-1.5 whitespace-nowrap relative ${active ? 'bbt-tab-active' : ''}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
    </button>
  )
}

function DemandaCard({
  demanda,
  empresas,
  agentes,
  onPegar,
  onRepassar,
  isOwn,
  showAgente,
  showOperationalLinks = true,
}: any) {
  const empresa = empresas.find((e: any) => e.id === demanda.empresa_id)
  const agente = agentes.find((x: any) => x.id === demanda.agente_user_id)
  const cor = corPrioridade(demanda._prioridade)
  const serialOS = demanda.serial_os || demanda.id?.slice(-8)?.toUpperCase()
  const Icon = demanda.tipo_servico === 'Hotel' ? HotelIcon
    : demanda.tipo_servico === 'Aéreo' ? Plane
    : demanda.tipo_servico === 'Carro' ? Car : Package

  return (
    <div className={`bbt-card p-3 border-l-4 ${cor.border} ${cor.bg}`}>
      <div className="flex items-start gap-2 mb-2">
        <Icon className="w-4 h-4 text-bbt-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-sm truncate">{demanda.passageiro_nome}</strong>
            <span className={`text-[10px] px-1.5 rounded font-semibold ${cor.text}`}>
              {demanda._prioridade.toUpperCase()}
            </span>
            <SLABadge atendimento={demanda} empresa={empresa} variant="badge" />
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {serialOS ? `${serialOS} · ` : ''}{empresa?.nome || '—'}
          </div>
          {(demanda.voucher_ids || []).length > 0 && (
            <div className="mt-1 text-[10px] text-bbt-accent font-semibold">
              {(demanda.voucher_ids || []).length} voucher(s) vinculado(s)
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300 mb-2">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatarDiasCheckin(demanda._dias)}
        </span>
        {showAgente && agente && (
          <span className="flex items-center gap-1">
            <UserCheck className="w-3 h-3" /> {agente.name}
          </span>
        )}
      </div>

      <div className="flex gap-1">
        {onPegar && !demanda.agente_user_id && (
          <button onClick={onPegar} className="flex-1 bbt-button-primary text-[11px] py-1.5 flex items-center justify-center gap-1">
            <Hand className="w-3 h-3" /> Pegar
          </button>
        )}
        {onRepassar && (
          <button onClick={onRepassar} className="flex-1 bbt-button-ghost text-[11px] py-1.5 flex items-center justify-center gap-1">
            <ArrowRightLeft className="w-3 h-3" /> Repassar
          </button>
        )}
        {showOperationalLinks && (
          <>
            <a
              href={`/dashboard/reservas?atendimento=${encodeURIComponent(demanda.id)}&os=${encodeURIComponent(serialOS || '')}`}
              onClick={(e) => e.stopPropagation()}
              className="bbt-button-ghost text-[11px] py-1.5 px-2 flex items-center justify-center gap-1"
              title={`Abrir ${serialOS} em Reservas e cotações`}
              aria-label={`Abrir ${serialOS} em Reservas e cotações`}
            >
              <CalendarCheck className="w-3 h-3" />
            </a>
            <a
              href={`/dashboard/vouchers/novo?atendimento=${demanda.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="bbt-button-ghost text-[11px] py-1.5 px-2 flex items-center justify-center gap-1"
              title="Gerar Voucher"
            >
              <FileText className="w-3 h-3" />
            </a>
          </>
        )}
      </div>
      <div className="mt-2 rounded-md bg-white/70 px-2 py-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
        {travelLifecycleStatusLabel(demanda.relational_lifecycle_status || demanda.status)}
        <span className="ml-1 font-normal text-slate-400">· automático</span>
      </div>
    </div>
  )
}

function DemandaCardMini({ demanda, empresas, onClick, mostrarAgente, agentes }: any) {
  const empresa = empresas.find((e: any) => e.id === demanda.empresa_id)
  const cor = corPrioridade(demanda._prioridade)
  const agente = mostrarAgente && agentes ? agentes.find((u: any) => u.id === demanda.agente_user_id) : null
  const serialOS = demanda.serial_os || demanda.id?.slice(-8)?.toUpperCase()
  const Icon = demanda.tipo_servico === 'Hotel' ? HotelIcon
    : demanda.tipo_servico === 'Aéreo' ? Plane
    : demanda.tipo_servico === 'Carro' ? Car : Package
  return (
    <div className={`w-full text-left p-2 rounded-lg border-l-4 ${cor.border} ${cor.bg} hover:shadow transition`}>
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Icon className="w-3 h-3 text-bbt-accent shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{demanda.passageiro_nome}</span>
        </div>
        <div className="text-[10px] text-slate-500 truncate">
          {serialOS ? `${serialOS} · ` : ''}{empresa?.nome || '—'}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="text-[10px] font-semibold" style={{ color: cor.text.includes('red') ? '#dc2626' : cor.text.includes('amber') ? '#d97706' : cor.text.includes('blue') ? '#2563eb' : '#64748b' }}>
            {formatarDiasCheckin(demanda._dias)}
          </div>
          {agente && <div className="text-[9px] text-slate-400 truncate ml-1 max-w-[100px]">{agente.name.split(' ')[0]}</div>}
        </div>
      </button>
    </div>
  )
}

function classeAlerta(severity: string) {
  if (severity === 'critico') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  if (severity === 'alto') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
  if (severity === 'medio') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
}

function EmptyState({ icon: Icon, title, subtitle }: any) {
  return (
    <div className="bbt-card p-12 text-center">
      <Icon className="w-12 h-12 mx-auto text-bbt-gray-200 dark:text-slate-600 mb-3" />
      <h3 className="font-semibold text-slate-600 dark:text-slate-300">{title}</h3>
      <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
    </div>
  )
}

function DemHeroMetric({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 transition ${
      highlight
        ? 'border-amber-300/40 bg-amber-300/10'
        : 'border-white/12 bg-white/8 hover:bg-white/12'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-amber-200' : 'text-cyan-200'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-100/60">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  )
}

function demandOperationKey(demandId: string, operation: string): string {
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `demand:${operation}:${demandId.slice(-36)}:${nonce}`.slice(0, 200)
}

function relationalReadEnabledForCompany(rollout: DemandDomainRollout, companyId: string): boolean {
  return rollout.status === 'active'
    && rollout.readMode === 'relational'
    && rolloutAppliesToCompany(rollout, companyId)
}

function relationalWriteEnabledForCompany(rollout: DemandDomainRollout, companyId: string): boolean {
  return rollout.status === 'active'
    && rollout.writeMode !== 'legacy'
    && rolloutAppliesToCompany(rollout, companyId)
}

function rolloutAppliesToCompany(rollout: DemandDomainRollout, companyId: string): boolean {
  return rollout.pilotCompanyIds.length === 0 || rollout.pilotCompanyIds.includes(companyId)
}
