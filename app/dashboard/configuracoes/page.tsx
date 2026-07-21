'use client'
import { todayISODate } from '@/lib/date'
import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { AI_NAME, SYSTEM_FULL_NAME } from '@/lib/branding'
import { getCurrentUser, roleLabel } from '@/lib/auth'
import {
  Settings, User as UserIcon, Database, Trash2, Download, Upload as UploadIcon,
  Palette, AlertTriangle, ListChecks, Building2, Users as UsersIcon,
  Hotel as HotelIcon, FileText, FileSpreadsheet, History, Cloud, Bell, Volume2, Sparkles, CheckCircle2, XCircle,
  PlugZap, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { SupplierConfigPanel } from '@/components/suppliers/supplier-config-panel'
import {
  getPrefSom, setPrefSom, getPrefNotif, setPrefNotif,
  pedirPermissaoNotificacao, notificacaoEstaAtiva, tocarSomNotificacao,
} from '@/lib/notificacoes'
import { iaConfigurada } from '@/lib/ia-parser'
import { flushPendingRemoteStorage, safeGetRaw, safeRemove, safeSetJSON } from '@/lib/storage-quota'
import { downloadTextFile } from '@/lib/browser-download'
import { resetAllSystemData } from '@/lib/system-reset-client'

const STORE_KEY = 'bbt-data-v4'
const LEGACY_STORE_KEY = 'bbt-storage'

export default function ConfiguracoesPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas, funcionarios, hoteis, politicas } = useStore()
  const [confirmacao, setConfirmacao] = useState<{
    titulo: string
    mensagem: string
    palavraConfirmacao: string
    requiresPassword?: boolean
    onConfirmar: () => void | Promise<void>
  } | null>(null)
  const [textoConfirmacao, setTextoConfirmacao] = useState('')
  const [senhaConfirmacao, setSenhaConfirmacao] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  // === Contadores de dados ===
  const [stats, setStats] = useState(() => calcularStats())

  // V10: Configurações de notificação + IA
  const [somAtivo, setSomAtivo] = useState(true)
  const [notifAtivo, setNotifAtivo] = useState(true)
  const [permissaoNotif, setPermissaoNotif] = useState<NotificationPermission | null>(null)
  const [iaConfig, setIaConfig] = useState<boolean | null>(null)

  useEffect(() => {
    setSomAtivo(getPrefSom())
    setNotifAtivo(getPrefNotif())
    if (typeof Notification !== 'undefined') setPermissaoNotif(Notification.permission)
    iaConfigurada().then(setIaConfig)
  }, [])
  function calcularStats() {
    if (typeof window === 'undefined') return { atendimentos: 0, financeiro: 0, auditoria: 0, transferencias: 0, caixa: 0, fornecedores: 0, reservas_fornecedores: 0, vouchers: 0, emissoes: 0, aprovacoes: 0, resumos: 0 }
    const ler = (k: string) => { try { return JSON.parse(safeGetRaw(k) || '[]').length } catch { return 0 } }
    return {
      atendimentos: ler('bbt-atendimentos'),
      financeiro: ler('bbt-financeiro'),
      auditoria: ler('bbt-auditoria'),
      transferencias: ler('bbt-transferencias'),
      caixa: ler('bbt-caixa-entrada'),
      fornecedores: ler('bbt-supplier-integrations-v1'),
      reservas_fornecedores: ler('bbt-supplier-reservations-v1'),
      vouchers: ler('bbt-vouchers-emitidos'),
      emissoes: ler('bbt-emissoes'),
      aprovacoes: ler('bbt-aprovacoes'),
      resumos: ler('bbt-resumos-executivos-v12'),
    }
  }

  // === Backup/Restauração ===
  function exportBackupCompleto() {
    if (typeof window === 'undefined') return
    const data: any = {
      version: 10,
      exported_at: new Date().toISOString(),
      sistema: SYSTEM_FULL_NAME,
      empresas, funcionarios, hoteis, politicas,
      // Dados do localStorage
      atendimentos: ler('bbt-atendimentos'),
      financeiro: ler('bbt-financeiro'),
      auditoria: ler('bbt-auditoria'),
      transferencias: ler('bbt-transferencias'),
      caixa_entrada: ler('bbt-caixa-entrada'),
      mensagens: ler('bbt-mensagens-thread'),
      transacoes: ler('bbt-transacoes'),
      alertas: ler('bbt-alertas'),
      fornecedores: ler('bbt-supplier-integrations-v1'),
      fornecedor_logs: ler('bbt-supplier-action-logs-v1'),
      reservas_fornecedores: ler('bbt-supplier-reservations-v1'),
      reservas_tech: ler('bbt-tech-travel-reservations-v1'),
      cotacoes_tech: ler('bbt-tech-travel-quotes-v1'),
      logs_tech: ler('bbt-tech-integration-logs-v1'),
      corporate_finance: ler('bbt-corporate-finance'),
      solicitantes_empresa: ler('bbt-solicitantes-empresa'),
    }
    function ler(k: string) { try { return JSON.parse(safeGetRaw(k) || 'null') } catch { return null } }

    downloadTextFile(
      `bbt-backup-completo-${todayISODate()}.json`,
      JSON.stringify(data, null, 2),
      'application/json;charset=utf-8',
    )
    toast.success('✅ Backup completo exportado')
  }

  function importarBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (![7, 8, 9, 10].includes(Number(data.version))) {
          if (!confirm('Backup é de outra versão. Tentar importar mesmo assim?')) return
        }
        // Restaura empresa/funcionários/hotéis via store
        if (data.empresas) {
          safeSetJSON(STORE_KEY, {
            state: {
              empresas: data.empresas,
              funcionarios: data.funcionarios || [],
              hoteis: data.hoteis || [],
              politicas: data.politicas || politicas,
            },
            version: 1,
          })
          safeRemove(LEGACY_STORE_KEY)
        }
        // Restaura demais
        if (data.atendimentos) safeSetJSON('bbt-atendimentos', data.atendimentos)
        if (data.financeiro) safeSetJSON('bbt-financeiro', data.financeiro)
        if (data.auditoria) safeSetJSON('bbt-auditoria', data.auditoria)
        if (data.transferencias) safeSetJSON('bbt-transferencias', data.transferencias)
        if (data.caixa_entrada) safeSetJSON('bbt-caixa-entrada', data.caixa_entrada)
        if (data.mensagens) safeSetJSON('bbt-mensagens-thread', data.mensagens)
        if (data.transacoes) safeSetJSON('bbt-transacoes', data.transacoes)
        if (data.alertas) safeSetJSON('bbt-alertas', data.alertas)
        if (data.fornecedores) safeSetJSON('bbt-supplier-integrations-v1', data.fornecedores)
        if (data.fornecedor_logs) safeSetJSON('bbt-supplier-action-logs-v1', data.fornecedor_logs)
        if (data.reservas_fornecedores) safeSetJSON('bbt-supplier-reservations-v1', data.reservas_fornecedores)
        if (data.reservas_tech) safeSetJSON('bbt-tech-travel-reservations-v1', data.reservas_tech)
        if (data.cotacoes_tech) safeSetJSON('bbt-tech-travel-quotes-v1', data.cotacoes_tech)
        if (data.logs_tech) safeSetJSON('bbt-tech-integration-logs-v1', data.logs_tech)
        if (data.corporate_finance) safeSetJSON('bbt-corporate-finance', data.corporate_finance)
        if (data.solicitantes_empresa) safeSetJSON('bbt-solicitantes-empresa', data.solicitantes_empresa)
        toast.success('✅ Backup restaurado! Recarregando...')
        setTimeout(() => window.location.reload(), 1000)
      } catch (err: any) {
        toast.error('Erro ao importar: ' + err.message)
      }
    }
    reader.readAsText(file)
  }

  // === Limpezas inteligentes ===
  async function confirmarLimpezaCompartilhada() {
    const sincronizado = await flushPendingRemoteStorage()
    if (!sincronizado) throw new Error('Nao foi possivel confirmar a limpeza no servidor.')
  }

  function limparAtendimentos() {
    setConfirmacao({
      titulo: 'Apagar TODAS as demandas?',
      mensagem: `Isso apagará permanentemente ${stats.atendimentos} demandas/atendimentos.\n\nEmpresas, funcionários, hotéis e usuários serão MANTIDOS.\n\nEssa ação não pode ser desfeita. Para confirmar, digite a palavra abaixo:`,
      palavraConfirmacao: 'APAGAR DEMANDAS',
      onConfirmar: async () => {
        if (typeof window === 'undefined') return
        safeRemove('bbt-atendimentos')
        safeRemove('bbt-financeiro')
        safeRemove('bbt-transferencias')
        safeRemove('bbt-mensagens-thread')
        await confirmarLimpezaCompartilhada()
        toast.success('✅ Todas as demandas foram apagadas')
        setStats(calcularStats())
      },
    })
  }

  function limparFinanceiro() {
    setConfirmacao({
      titulo: 'Apagar lançamentos financeiros?',
      mensagem: `Isso apagará ${stats.financeiro} lançamentos do contas a pagar/receber.\n\nAs demandas serão mantidas.`,
      palavraConfirmacao: 'APAGAR FINANCEIRO',
      onConfirmar: async () => {
        safeRemove('bbt-financeiro')
        safeRemove('bbt-transacoes')
        await confirmarLimpezaCompartilhada()
        toast.success('✅ Financeiro limpo')
        setStats(calcularStats())
      },
    })
  }

  function limparAuditoria() {
    setConfirmacao({
      titulo: 'Apagar histórico de auditoria?',
      mensagem: `Isso apagará ${stats.auditoria} eventos do log.\n\nNada do operacional será afetado.`,
      palavraConfirmacao: 'APAGAR LOG',
      onConfirmar: async () => {
        safeRemove('bbt-auditoria')
        await confirmarLimpezaCompartilhada()
        toast.success('✅ Auditoria limpa')
        setStats(calcularStats())
      },
    })
  }

  function limparEmpresas() {
    setConfirmacao({
      titulo: 'Apagar TODAS as empresas?',
      mensagem: `Isso apagará todas as ${empresas.length} empresas, ${funcionarios.length} funcionários vinculados e suas demandas.\n\n⚠️ AÇÃO DESTRUTIVA. Faça backup antes!`,
      palavraConfirmacao: 'APAGAR EMPRESAS',
      onConfirmar: async () => {
        const raw = safeGetRaw(STORE_KEY)
        if (raw) {
          try {
            const obj = JSON.parse(raw)
            obj.state = obj.state || {}
            obj.state.empresas = []
            obj.state.funcionarios = []
            obj.state.politicas = []
            if (!safeSetJSON(STORE_KEY, obj)) throw new Error('Falha ao preparar a limpeza das empresas.')
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha ao preparar a limpeza das empresas.')
            throw error
          }
        }
        safeRemove('bbt-atendimentos')
        await confirmarLimpezaCompartilhada()
        toast.success('✅ Empresas apagadas. Recarregando...')
        setTimeout(() => window.location.reload(), 1000)
      },
    })
  }

  function limparHoteis() {
    setConfirmacao({
      titulo: 'Apagar TODOS os hotéis?',
      mensagem: `Isso apagará ${hoteis.length} hotéis do catálogo.`,
      palavraConfirmacao: 'APAGAR HOTEIS',
      onConfirmar: async () => {
        const raw = safeGetRaw(STORE_KEY)
        if (raw) {
          try {
            const obj = JSON.parse(raw)
            obj.state = obj.state || {}
            obj.state.hoteis = []
            if (!safeSetJSON(STORE_KEY, obj)) throw new Error('Falha ao preparar a limpeza dos hoteis.')
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha ao preparar a limpeza dos hoteis.')
            throw error
          }
        }
        await confirmarLimpezaCompartilhada()
        toast.success('✅ Hotéis apagados. Recarregando...')
        setTimeout(() => window.location.reload(), 1000)
      },
    })
  }

  function limparAbsolutamenteTudo() {
    setConfirmacao({
      titulo: '⚠️ APAGAR ABSOLUTAMENTE TUDO?',
      mensagem: `Isso apagará TODOS os dados operacionais do tenant:\n\n• Empresas, grupos, funcionários, hotéis e políticas\n• Demandas, reservas, vouchers, anexos e emissões\n• Financeiro, aprovações, transferências e reconciliação\n• Importações, relatórios salvos e históricos da assistente\n\nUsuários, permissões, tenant e trilha de auditoria serão preservados.\nA limpeza será confirmada no servidor antes de recarregar.\n\nEsta ação não pode ser desfeita. Faça um backup validado antes.`,
      palavraConfirmacao: 'APAGAR TUDO',
      requiresPassword: true,
      onConfirmar: async () => {
        const result = await resetAllSystemData('APAGAR TUDO', senhaConfirmacao)
        toast.success(`✅ Sistema zerado e verificado (${result.deleted} conjuntos removidos). Recarregando...`)
        setTimeout(() => window.location.reload(), 1500)
      },
    })
  }

  function fecharConfirmacao() {
    if (confirmando) return
    setConfirmacao(null)
    setTextoConfirmacao('')
    setSenhaConfirmacao('')
  }

  async function confirmarExclusao() {
    if (!confirmacao) return
    if (textoConfirmacao !== confirmacao.palavraConfirmacao) {
      toast.error('Texto de confirmação incorreto')
      return
    }

    setConfirmando(true)
    try {
      await confirmacao.onConfirmar()
      setConfirmacao(null)
      setTextoConfirmacao('')
      setSenhaConfirmacao('')
    } catch (error) {
      console.error('[configuracoes:limpeza]', error)
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a limpeza.')
    } finally {
      setConfirmando(false)
    }
  }

  if (!user) return null

  return (
    <div className="space-y-5 animate-fade-in max-w-none">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Administração · Sistema</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Settings className="w-6 h-6 text-bbt-accent" /> Configurações
          </h1>
          <p className="bbt-page-subtitle">Gerenciamento e manutenção do sistema.</p>
        </div>
      </div>

      {/* Meu Perfil */}
      <div className="bbt-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="w-5 h-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Meu Perfil</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold text-xl">
            {user.name.charAt(0)}
          </div>
          <div>
            <div className="font-medium text-bbt-primary dark:text-white">{user.name}</div>
            <div className="text-sm text-slate-500">{user.email}</div>
            <span className="bbt-badge bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent mt-1 inline-block">
              {roleLabel(user.role)}
            </span>
          </div>
        </div>
      </div>

      {/* Contadores */}
      <div className="bbt-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Dados do sistema</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CardStat icon={Building2} label="Empresas" valor={empresas.length} cor="text-purple-600" />
          <CardStat icon={UsersIcon} label="Funcionários" valor={funcionarios.length} cor="text-blue-600" />
          <CardStat icon={HotelIcon} label="Hotéis" valor={hoteis.length} cor="text-emerald-600" />
          <CardStat icon={ListChecks} label="Demandas" valor={stats.atendimentos} cor="text-orange-600" />
          <CardStat icon={FileText} label="Financeiro" valor={stats.financeiro} cor="text-green-600" />
          <CardStat icon={History} label="Auditoria" valor={stats.auditoria} cor="text-slate-600" />
          <CardStat icon={UploadIcon} label="Transferências" valor={stats.transferencias} cor="text-amber-600" />
          <CardStat icon={ListChecks} label="Caixa entrada" valor={stats.caixa} cor="text-pink-600" />
          <CardStat icon={PlugZap} label="Fornecedores" valor={stats.fornecedores} cor="text-indigo-600" />
          <CardStat icon={PlugZap} label="Reservas prep." valor={stats.reservas_fornecedores} cor="text-cyan-600" />
          <CardStat icon={FileText} label="Vouchers" valor={stats.vouchers} cor="text-blue-600" />
          <CardStat icon={FileSpreadsheet} label="Emissões" valor={stats.emissoes} cor="text-violet-600" />
          <CardStat icon={CheckCircle2} label="Aprovações" valor={stats.aprovacoes} cor="text-emerald-600" />
          <CardStat icon={FileText} label="Relatórios salvos" valor={stats.resumos} cor="text-slate-600" />
        </div>
      </div>

      {/* V10: Notificações */}
      <div className="bbt-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Notificações de demandas novas</h2>
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-bbt-accent/50 cursor-pointer">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-bbt-accent" />
              <div>
                <div className="font-medium text-sm">Som de alerta</div>
                <div className="text-xs text-slate-500">Toca um beep quando uma demanda nova chega</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => tocarSomNotificacao()} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded hover:bg-slate-200">▶ Testar</button>
              <input type="checkbox" checked={somAtivo} onChange={(e) => { setSomAtivo(e.target.checked); setPrefSom(e.target.checked) }}
                className="w-5 h-5 accent-bbt-accent" />
            </div>
          </label>

          <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-bbt-accent/50 cursor-pointer">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-bbt-accent" />
              <div>
                <div className="font-medium text-sm">Notificações do navegador</div>
                <div className="text-xs text-slate-500">Pop-ups quando uma demanda nova chega (mesmo com aba em background)</div>
                <div className="text-[10px] mt-1">
                  Permissão atual: <strong className={
                    permissaoNotif === 'granted' ? 'text-green-600' :
                    permissaoNotif === 'denied' ? 'text-red-600' : 'text-slate-500'
                  }>{permissaoNotif === 'granted' ? '✓ Concedida' : permissaoNotif === 'denied' ? '✗ Bloqueada' : 'Não solicitada'}</strong>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {permissaoNotif !== 'granted' && (
                <button onClick={async () => {
                  const ok = await pedirPermissaoNotificacao()
                  setPermissaoNotif(typeof Notification !== 'undefined' ? Notification.permission : null)
                  toast[ok ? 'success' : 'error'](ok ? 'Permissão concedida' : 'Permissão negada (verifique nas configurações do navegador)')
                }} className="text-xs px-2 py-1 bg-bbt-accent/10 text-bbt-accent rounded hover:bg-bbt-accent/20">
                  Permitir
                </button>
              )}
              <input type="checkbox" checked={notifAtivo} onChange={(e) => { setNotifAtivo(e.target.checked); setPrefNotif(e.target.checked) }}
                className="w-5 h-5 accent-bbt-accent" />
            </div>
          </label>
        </div>
      </div>

      {/* V12: IA Status */}
      <div className="bbt-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">{AI_NAME}</h2>
        </div>
        <div className={`p-4 rounded-lg border-2 ${iaConfig === true ? 'bg-green-50 dark:bg-green-900/10 border-green-300' : iaConfig === false ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-300' : 'bg-slate-50 dark:bg-slate-800 border-slate-200'}`}>
          {iaConfig === null && <div className="text-sm text-slate-500">Verificando configuração...</div>}
          {iaConfig === true && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
              <div className="text-sm">
                <strong className="text-green-700 dark:text-green-400">IA configurada e funcionando</strong>
                <p className="mt-1 text-slate-700 dark:text-slate-300">
                  A IA premium está ativa. Funcionalidades disponíveis: análise inteligente de mensagens, imagens, áudios, chat conversacional, busca web e ações no sistema.
                </p>
              </div>
            </div>
          )}
          {iaConfig === false && (
            <div className="flex items-start gap-3">
              <XCircle className="w-6 h-6 text-amber-600 shrink-0" />
              <div className="text-sm">
                <strong className="text-amber-700 dark:text-amber-400">IA não configurada</strong>
                <p className="mt-1 text-slate-700 dark:text-slate-300 mb-2">
                  Pra ativar a IA, crie um arquivo <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">.env.local</code> na raiz do projeto:
                </p>
                <pre className="p-2 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto">OPENAI_API_KEY=sk-sua-chave-aqui{'\n'}GEMINI_API_KEY=sua-chave-google-opcional</pre>
                <p className="mt-2 text-xs text-slate-500">
                  Pegue a chave principal em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="underline text-bbt-accent">platform.openai.com/api-keys</a>. Use Gemini apenas como motor auxiliar de busca Google/hotéis. Reinicie o servidor com <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">npm run dev</code> após criar.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-3">
          <strong>Sem IA:</strong> sistema usa parser local (regex + heurísticas) — funciona, mas tem precisão menor em mensagens informais.
          <br />
          <strong>Com IA:</strong> reconhece prints, áudios transcritos, emails complexos com altíssima precisão.
        </div>
      </div>

      {/* Conexoes com fornecedores */}
      <div className="bbt-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <PlugZap className="h-5 w-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Conexões, APIs e fornecedores</h2>
        </div>
        <SupplierConfigPanel canEdit={user.role === 'master'} />
      </div>

      {/* Backup */}
      <div className="bbt-card p-6 border-l-4 border-l-blue-500">
        <div className="flex items-center gap-2 mb-2">
          <Cloud className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Backup e Restauração</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Sempre faça backup antes de limpar dados. O arquivo JSON contém TUDO e pode ser restaurado depois.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportBackupCompleto} className="bbt-button-primary flex items-center gap-2">
            <Download className="w-4 h-4" /> Exportar backup completo
          </button>
          <label className="bbt-button-ghost flex items-center gap-2 cursor-pointer">
            <UploadIcon className="w-4 h-4" /> Restaurar de backup
            <input type="file" accept=".json" onChange={importarBackup} className="hidden" />
          </label>
        </div>
      </div>

      {/* Limpezas individuais */}
      {user.role === 'master' && (
        <div className="bbt-card p-6 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-2 mb-2">
            <Trash2 className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-bbt-primary dark:text-white">Limpeza de Dados</h2>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Apague apenas o que você não precisa mais. Cada ação exige confirmação digitando uma palavra.
          </p>

          <div className="space-y-2">
            <BotaoLimpar
              titulo="Apagar todas as demandas"
              descricao={`${stats.atendimentos} demandas + financeiro vinculado serão apagados`}
              icon={ListChecks}
              onClick={limparAtendimentos}
              disabled={stats.atendimentos === 0}
            />
            <BotaoLimpar
              titulo="Apagar lançamentos financeiros"
              descricao={`${stats.financeiro} lançamentos do contas a pagar/receber`}
              icon={FileText}
              onClick={limparFinanceiro}
              disabled={stats.financeiro === 0}
            />
            <BotaoLimpar
              titulo="Apagar histórico de auditoria"
              descricao={`${stats.auditoria} eventos do log`}
              icon={History}
              onClick={limparAuditoria}
              disabled={stats.auditoria === 0}
            />
            <BotaoLimpar
              titulo="Apagar todas as empresas"
              descricao={`${empresas.length} empresas + funcionários + demandas`}
              icon={Building2}
              onClick={limparEmpresas}
              disabled={empresas.length === 0}
              perigoso
            />
            <BotaoLimpar
              titulo="Apagar todos os hotéis"
              descricao={`${hoteis.length} hotéis do catálogo`}
              icon={HotelIcon}
              onClick={limparHoteis}
              disabled={hoteis.length === 0}
            />
          </div>

          <div className="mt-6 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
            <button onClick={limparAbsolutamenteTudo}
              className="w-full px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition">
              <AlertTriangle className="w-5 h-5" /> APAGAR ABSOLUTAMENTE TUDO (zerar sistema)
            </button>
          </div>
        </div>
      )}

      {/* Aparência */}
      <div className="bbt-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="w-5 h-5 text-bbt-accent" />
          <h2 className="font-semibold text-bbt-primary dark:text-white">Aparência</h2>
        </div>
        <p className="text-sm text-slate-500">
          Alterne entre modo claro e escuro pelo botão ☀️/🌙 no cabeçalho. A preferência fica salva no seu navegador.
        </p>
      </div>

      {/* Modal de confirmação */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full shadow-2xl">
            <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-1" />
              <div>
                <h3 className="font-bold text-lg">{confirmacao.titulo}</h3>
              </div>
            </div>
            <div className="p-5">
              <pre className="text-sm whitespace-pre-wrap font-sans text-slate-600 dark:text-slate-300 mb-4">{confirmacao.mensagem}</pre>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Digite <code className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 rounded font-bold">{confirmacao.palavraConfirmacao}</code> para confirmar:
                </label>
                <input type="text" value={textoConfirmacao} onChange={(e) => setTextoConfirmacao(e.target.value)}
                  className="bbt-input w-full" placeholder={confirmacao.palavraConfirmacao} autoFocus />
                {confirmacao.requiresPassword && (
                  <label className="block pt-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Confirme sua senha atual
                    <input
                      type="password"
                      value={senhaConfirmacao}
                      onChange={(event) => setSenhaConfirmacao(event.target.value)}
                      autoComplete="current-password"
                      className="bbt-input mt-1.5 w-full"
                      required
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-bbt-gray-100 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={fecharConfirmacao} disabled={confirmando} className="bbt-button-ghost">Cancelar</button>
              <button
                onClick={confirmarExclusao}
                disabled={confirmando || textoConfirmacao !== confirmacao.palavraConfirmacao || (confirmacao.requiresPassword && !senhaConfirmacao)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-2">
                {confirmando && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirmando ? 'Limpando e verificando...' : 'Confirmar e apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CardStat({ icon: Icon, label, valor, cor }: any) {
  return (
    <div className="text-center p-3 border border-bbt-gray-100 dark:border-slate-700 rounded-lg">
      <Icon className={`w-5 h-5 mx-auto mb-1 ${cor}`} />
      <div className={`text-2xl font-bold ${cor}`}>{valor}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function BotaoLimpar({ titulo, descricao, icon: Icon, onClick, disabled, perigoso }: any) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left p-3 rounded-lg border flex items-center gap-3 transition ${
        disabled
          ? 'opacity-30 cursor-not-allowed border-bbt-gray-100 dark:border-slate-700'
          : perigoso
            ? 'border-red-200 hover:bg-red-50 dark:hover:bg-red-900/10 hover:border-red-400'
            : 'border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/10 hover:border-amber-400'
      }`}>
      <Icon className={`w-5 h-5 ${perigoso ? 'text-red-500' : 'text-amber-500'} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{titulo}</div>
        <div className="text-xs text-slate-500">{descricao}</div>
      </div>
      <Trash2 className={`w-4 h-4 ${perigoso ? 'text-red-500' : 'text-amber-500'}`} />
    </button>
  )
}
