'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Brain,
  CalendarCheck,
  CheckCircle2,
  Globe2,
  Lock,
  MessageCircle,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import IAChatPage from '../ia-chat/page'
import IAOperacionalPage from '../ia-operacional/page'
import AssistantDashboardPage from '../assistente/page'
import { AI_NAME, AI_SHORT_NAME } from '@/lib/branding'
import {
  IA_CONFIG_DEFAULT,
  IA_CONFIG_MAXIMA,
  getIAConfig,
  saveIAConfig,
  type IAConfig,
  type IAInteractionScope,
} from '@/lib/ia-config-storage'
import { getStatusIA, type StatusIA } from '@/lib/ia-parser'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import { getAllAgentApprovals, getAllAgentQuotes, getAllAgentRuns, getAllAgentTasks } from '@/lib/ai-agent-storage'
import { useStore } from '@/lib/store'
import { toast } from 'sonner'

type AbaIA = 'chat' | 'operacional' | 'canais' | 'config'

export default function IAPage() {
  const [aba, setAba] = useState<AbaIA>('chat')
  const [status, setStatus] = useState<StatusIA | null>(null)

  useEffect(() => {
    getStatusIA(true).then(setStatus).catch(() => {})
    if (typeof window === 'undefined') return
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'operacional' || tab === 'config' || tab === 'chat' || tab === 'canais') setAba(tab)
  }, [])

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Inteligência {AI_NAME}</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Brain className="w-6 h-6 text-bbt-accent" /> Central {AI_NAME}
          </h1>
          <p className="bbt-page-subtitle">
            Conversa, execução, memória, aprovações, busca web, canais e permissões em uma área única.
          </p>
        </div>
        <StatusIABox status={status} />
      </div>

      <div className="bbt-tabs overflow-x-auto">
        <TabButton active={aba === 'chat'} onClick={() => setAba('chat')} icon={MessageCircle} label={AI_SHORT_NAME} />
        <TabButton active={aba === 'operacional'} onClick={() => setAba('operacional')} icon={Bot} label="Agente operacional" />
        <TabButton active={aba === 'canais'} onClick={() => setAba('canais')} icon={Bot} label="Canais e automações" />
        <TabButton active={aba === 'config'} onClick={() => setAba('config')} icon={Settings} label="Configurações da IA" />
      </div>

      {aba === 'chat' && <IAChatPage />}
      {aba === 'operacional' && <IAOperacionalPage />}
      {aba === 'canais' && <AssistantDashboardPage />}
      {aba === 'config' && <IAConfigPanel status={status} />}
    </div>
  )
}

function IAConfigPanel({ status }: { status: StatusIA | null }) {
  const { empresas, funcionarios, hoteis } = useStore()
  const [config, setConfig] = useState<IAConfig>(IA_CONFIG_DEFAULT)
  const [techStatus, setTechStatus] = useState<any | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    setConfig(getIAConfig())
    fetch('/api/integrations/tech/status')
      .then((response) => response.json())
      .then((payload) => setTechStatus(payload?.health || null))
      .catch(() => {})
  }, [])

  const stats = useMemo(() => {
    const atendimentos = getAllAtendimentos()
    return {
      demandas: atendimentos.length,
      empresas: empresas.length,
      funcionarios: funcionarios.length,
      hoteis: hoteis.length,
      tasks: getAllAgentTasks().length,
      approvals: getAllAgentApprovals().filter((item) => item.status === 'pendente').length,
      quotes: getAllAgentQuotes().length,
      runs: getAllAgentRuns().length,
    }
  }, [empresas.length, funcionarios.length, hoteis.length])

  function update<K extends keyof IAConfig>(key: K, value: IAConfig[K]) {
    setConfig((current) => persistConfig({ ...current, [key]: value }))
  }

  function persistConfig(next: IAConfig): IAConfig {
    const saved = saveIAConfig(next)
    setLastSavedAt(new Date())
    return saved
  }

  function salvar() {
    persistConfig(config)
    toast.success('Configurações da IA salvas.')
  }

  function ativarModoMaximo() {
    const saved = persistConfig(IA_CONFIG_MAXIMA)
    setConfig(saved)
    toast.success('Modo máximo da IA ativado.')
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="bbt-card p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-bbt-accent" /> Permissões da {AI_SHORT_NAME}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Essas regras salvam automaticamente e controlam o que a {AI_SHORT_NAME} pode responder e executar dentro do sistema.
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-300">
              Salvamento automático ativo{lastSavedAt ? ` - último salvamento ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={ativarModoMaximo} className="bbt-button-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Modo máximo
            </button>
            <button onClick={salvar} className="bbt-button-ghost flex items-center gap-2">
              <Save className="w-4 h-4" /> Salvar agora
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-bbt-accent/25 bg-bbt-accent/10 p-3">
          <div className="text-sm font-semibold text-bbt-primary dark:text-white">Modo maximo da IA</div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Libera conversa sobre tudo, pesquisa em tempo real, criação de demandas, cadastro de hotéis, cotações/reservas pela Tech, leitura financeira e execução com confirmação quando necessário.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Escopo de conversa</label>
          <div className="grid gap-2 md:grid-cols-3">
            {([
              ['tudo', 'Falar sobre tudo', 'Sem bloqueio de assunto além da lista manual.'],
              ['sistema_viagens', 'Sistema e viagens', 'ERP, CRM, viagens, financeiro, fornecedores e operação.'],
              ['restrito', 'Restrito', 'Somente consultas e ações internas essenciais.'],
            ] as Array<[IAInteractionScope, string, string]>).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                onClick={() => update('scope', value)}
                className={`rounded-lg border p-3 text-left transition ${
                  config.scope === value
                    ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                    : 'border-bbt-gray-100 hover:border-bbt-accent/50 dark:border-slate-700'
                }`}
              >
                <div className="font-semibold text-sm">{title}</div>
                <div className="mt-1 text-xs text-slate-500">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ToggleRow
            icon={Globe2}
            label="Permitir pesquisa na internet"
            detail="Necessário para hotéis, telefones, fornecedores e informações em tempo real."
            checked={config.permitirInternet}
            onChange={(value) => update('permitirInternet', value)}
          />
          <ToggleRow
            icon={Sparkles}
            label="Criar demandas automaticamente"
            detail="A IA pode abrir solicitações interpretadas a partir de texto, e-mail ou áudio."
            checked={config.permitirCriarDemandas}
            onChange={(value) => update('permitirCriarDemandas', value)}
          />
          <ToggleRow
            icon={Sparkles}
            label="Cadastrar hotéis automaticamente"
            detail="Quando não existir hotel no cadastro, a IA pode buscar e criar registros."
            checked={config.permitirCadastrarHoteis}
            onChange={(value) => update('permitirCadastrarHoteis', value)}
          />
          <ToggleRow
            icon={CalendarCheck}
            label="Preparar reservas pela Tech"
            detail="A IA pode consultar disponibilidade, preparar reserva e acionar a Tech/TTravel quando a conexão estiver configurada."
            checked={config.permitirReservasTech}
            onChange={(value) => update('permitirReservasTech', value)}
          />
          <ToggleRow
            icon={Lock}
            label="Permitir leitura financeira"
            detail="Autoriza respostas sobre faturamento, custos, despesas e margem."
            checked={config.permitirFinanceiro}
            onChange={(value) => update('permitirFinanceiro', value)}
          />
          <ToggleRow
            icon={ShieldCheck}
            label="Exigir confirmacao para execucao"
            detail="Use quando quiser a IA preparando ações, mas sem gravar automaticamente."
            checked={config.exigirConfirmacaoExecucao}
            onChange={(value) => update('exigirConfirmacaoExecucao', value)}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Assuntos bloqueados manualmente
          </label>
          <textarea
            value={config.assuntosBloqueados}
            onChange={(event) => update('assuntosBloqueados', event.target.value)}
            rows={3}
            placeholder="Ex: política, religião, investimentos pessoais"
            className="bbt-input w-full"
          />
          <p className="mt-1 text-xs text-slate-500">Separe por vírgula. A IA recusa perguntas que contenham esses termos.</p>
        </div>

        <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <span className="text-xs text-slate-500">
            Qualquer mudança feita aqui já fica gravada para o popup, canais e agente operacional.
          </span>
          <button onClick={salvar} className="bbt-button-primary flex items-center gap-2">
            <Save className="w-4 h-4" /> Salvar configurações
          </button>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white">Status do motor</h3>
          <div className="mt-3 space-y-2 text-sm">
            <InfoLine label="Cerebro" value={status?.provedor === 'openai' ? status.modelo || 'GPT-5.2' : status?.provedor || 'local'} />
            <InfoLine label="Busca web" value={status?.busca_web ? 'Ativa' : 'Inativa'} />
            <InfoLine label="Imagem" value={status?.aceita_imagem ? 'Ativa' : 'Inativa'} />
            <InfoLine label="Áudio" value={status?.aceita_audio ? 'Ativo' : 'Inativo'} />
          </div>
        </div>

        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white">Conector Tech Travel</h3>
          <div className="mt-3 space-y-2 text-sm">
            <InfoLine label="Modo" value={techStatus?.connected ? 'API conectada' : techStatus?.configured ? 'Configurada com erro' : 'Aguardando credenciais'} />
            <InfoLine label="Aéreo" value="Disponibilidade, tarifa, reserva, emissão e status" />
            <InfoLine label="Hotel" value="Cidades, disponibilidade, detalhes, pedido/reserva e voucher" />
          </div>
          {!techStatus?.connected && (
            <p className="mt-3 text-xs text-slate-500">
              Configure TECH_API_LOGIN, TECH_API_PASSWORD e TECH_API_KEY no .env.local para liberar consultas reais na Tech.
            </p>
          )}
          <a href="/dashboard/reservas" className="mt-3 inline-flex text-xs font-semibold text-bbt-accent underline">
            Abrir reservas pela Tech
          </a>
        </div>

        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white">Base conectada</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <MiniStat label="Demandas" value={stats.demandas} />
            <MiniStat label="Empresas" value={stats.empresas} />
            <MiniStat label="Funcionários" value={stats.funcionarios} />
            <MiniStat label="Hotéis" value={stats.hoteis} />
            <MiniStat label="Tarefas IA" value={stats.tasks} />
            <MiniStat label="Aprovações" value={stats.approvals} />
            <MiniStat label="Cotações" value={stats.quotes} />
            <MiniStat label="Execuções" value={stats.runs} />
          </div>
        </div>
      </aside>
    </div>
  )
}

function StatusIABox({ status }: { status: StatusIA | null }) {
  const ok = status && status.provedor !== 'local'
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      <div className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="w-4 h-4" />
        {ok ? `${status?.modelo || status?.provedor} ativo` : 'Modo local'}
      </div>
      <div className="mt-0.5 opacity-80">{status?.busca_web ? 'Com busca web' : 'Sem busca web externa'}</div>
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick} className={`bbt-tab flex items-center gap-1.5 whitespace-nowrap ${active ? 'bbt-tab-active' : ''}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function ToggleRow({ icon: Icon, label, detail, checked, onChange }: { icon: any; label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
        <div>
          <div className="text-sm font-semibold text-bbt-primary dark:text-white">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
        </div>
      </div>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 accent-bbt-accent" />
    </label>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-bbt-primary dark:text-white">{value}</span>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bbt-gray-50 p-3 dark:bg-slate-900">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{value}</div>
    </div>
  )
}
