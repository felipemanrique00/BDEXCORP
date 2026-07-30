const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(root, request.slice(2)), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: filename,
  }).outputText
  module._compile(output, filename)
}

const {
  aplicarVinculoEmpresaGrupo,
  empresasPermitidasParaUsuario,
  resolverEscopoGrupoUsuario,
  sincronizarGruposComEmpresas,
} = require('../lib/grupos.ts')
const { countUniqueTravelers, montarLinhasDetalhe, montarMetricasRelatorio, montarRelatorioOperacional } = require('../lib/relatorios.ts')
const {
  criarSequenciadorCodigoIdentificacao,
  encontrarFuncionarioPorNomeInteligente,
  normalizarFuncionariosComCodigo,
} = require('../lib/funcionario-identidade.ts')
const { resolverFuncionario } = require('../lib/import-pipeline.ts')
const {
  combineStorageSyncValues,
  createStorageSyncValue,
  mergeStorageValues,
} = require('../lib/storage-merge.ts')
const {
  buildStorageClearMetadata,
  isFullStorageResetNewer,
  isStorageKeyClearNewer,
  storageWriteAcknowledgesLatestClear,
} = require('../lib/storage-clear-metadata.ts')
const {
  RESETTABLE_SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
} = require('../lib/storage-keys.ts')
const {
  criarFingerprintWintour,
  criarIndiceDuplicatasWintour,
  encontrarDuplicataWintour,
  encontrarDuplicataWintourNoIndice,
  parseWintourFile,
  registrarAtendimentoNoIndiceWintour,
} = require('../lib/wintour-import.ts')
const { criarSequenciadorSerialOS } = require('../lib/atendimento-serial.ts')
const { vincularFuncionarioNaLista } = require('../lib/atendimentos-storage.ts')
const { detectarPassageirosSemFuncionario, detectarVendasDuplicadas } = require('../lib/reconciliacao.ts')
const { scopeStorageEntriesForRead, scopeStorageEntriesForWrite } = require('../lib/security/storage-scope.ts')
const { fetchServerSession } = require('../lib/client-session.ts')
const { escapeHtmlText, serializeForInlineScript } = require('../lib/security/html.ts')
const { validatePdfUpload } = require('../lib/security/pdf-upload.ts')
const { readJsonBody, readJsonBodyResult, RequestBodyError } = require('../lib/security/request-body.ts')
const { buildCsv, csvCell } = require('../lib/browser-download.ts')
const { normalizeMaxOutputTokens } = require('../lib/server-ai.ts')
const { maskSensitive } = require('../lib/integrations/tech/tech-errors.ts')
const { normalizeTechEmission } = require('../lib/integrations/tech/tech-emissions-normalizer.ts')
const { techEmissionQuerySchema } = require('../lib/integrations/tech/tech-schemas.ts')
const { buildStandaloneReportHtml } = require('../app/relatorios/_components/export-html.ts')
const { montarCorporateDashboardStandaloneHtml } = require('../lib/reporting/corporate-dashboard-html.ts')

function assertRouteUsesApiGuard(relativePath, expectedKey) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  assert.match(source, /guardApiRequest\(/, `${relativePath} deve usar guardApiRequest`)
  assert.match(source, /requireAuth:\s*true/, `${relativePath} deve exigir sessao`)
  assert.ok(source.includes(expectedKey), `${relativePath} deve ter rate limit proprio`)
}

assertRouteUsesApiGuard('app/api/ia/search/route.ts', 'ia-search:post')

{
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
  assert.doesNotMatch(envExample, /sk-proj-[A-Za-z0-9_-]{20,}/, '.env.example nao pode conter chave OpenAI real')
  assert.doesNotMatch(envExample, /AIza[0-9A-Za-z_-]{20,}/, '.env.example nao pode conter chave Google real')
  assert.match(envExample, /^TECH_REPORTS_KEY=\s*$/m, '.env.example deve documentar a chave de relatorios sem incluir segredo')

  const techEmissionsRoute = fs.readFileSync(path.join(root, 'app/api/integrations/tech/emissions/route.ts'), 'utf8')
  assert.match(techEmissionsRoute, /permission:\s*'importar_planilhas'/, 'relatorio Tech deve exigir permissao de importacao')

  const readinessRoute = fs.readFileSync(path.join(root, 'app/api/ready/route.ts'), 'utf8')
  const migrationRunner = fs.readFileSync(path.join(root, 'scripts/migrate.mjs'), 'utf8')
  assert.match(readinessRoute, /DATABASE_ROLE_INSECURE/, 'readiness deve bloquear papel PostgreSQL inseguro')
  assert.match(readinessRoute, /rolsuper/, 'readiness deve verificar superusuario')
  assert.match(readinessRoute, /rolbypassrls/, 'readiness deve verificar BYPASSRLS')
  assert.match(migrationRunner, /DATABASE_APP_ROLE/, 'migrations devem provisionar papel separado da aplicacao')
  assert.match(migrationRunner, /nosuperuser[\s\S]*nobypassrls/, 'papel da aplicacao deve ser criado sem bypass de RLS')
  assert.match(techEmissionsRoute, /readJsonBodyResult<unknown>\(request,\s*32 \* 1024\)/, 'relatorio Tech deve limitar o corpo da requisicao')

  const storageRoute = fs.readFileSync(path.join(root, 'app/api/storage/route.ts'), 'utf8')
  assert.match(storageRoute, /readJsonBody/, 'storage compartilhado deve limitar o corpo da requisicao')
  assert.match(storageRoute, /MAX_STORAGE_BODY_BYTES/, 'storage deve declarar limite compativel com importacoes grandes')
  assert.match(storageRoute, /storageWriteAcknowledgesLatestClear/, 'storage deve rejeitar gravacoes de sessoes anteriores ao reset')

  const storageQuota = fs.readFileSync(path.join(root, 'lib/storage-quota.ts'), 'utf8')
  assert.match(storageQuota, /LOCAL_CACHE_ENTRY_LIMIT_CHARS = 512 \* 1024/, 'storage local deve limitar copias redundantes de conjuntos grandes')
  assert.match(storageQuota, /shouldKeepSharedValueInMemory\(key, rawValue, true\)/, 'hidratacao remota deve manter conjuntos grandes fora do localStorage')
  assert.match(storageQuota, /keepValueInMemory/, 'storage deve preservar em memoria valores que excedem a cota local')
  assert.match(storageQuota, /if \(Object\.keys\(pendingRemoteEntries\)\.length\) scheduleRemoteFlush\(\)/, 'mesclas locais devem ser reenviadas ao servidor')
  assert.match(storageQuota, /wasStorageKeyCleared\(remoteMetadata, key\)/, 'dados apagados nao podem ser reenviados por navegadores antigos')

  const resetRoute = fs.readFileSync(path.join(root, 'app/api/system/reset/route.ts'), 'utf8')
  const resetService = fs.readFileSync(path.join(root, 'lib/server/system-reset-service.ts'), 'utf8')
  assert.match(resetRoute, /permission:\s*'gerenciar_usuarios'/, 'reset completo deve exigir permissao administrativa')
  assert.match(resetRoute, /resetTenantBusinessData/, 'reset completo deve delegar para o servico transacional')
  assert.match(resetService, /RESETTABLE_SHARED_STORAGE_KEYS/, 'reset completo deve usar o catalogo central de dados')
  assert.match(resetService, /fullReset:\s*true/, 'reset completo deve registrar o marcador global')

  const settingsPage = fs.readFileSync(path.join(root, 'app/dashboard/configuracoes/page.tsx'), 'utf8')
  assert.match(
    settingsPage,
    /await resetAllSystemData\('APAGAR TUDO',\s*senhaConfirmacao\)/,
    'tela de configuracoes deve aguardar o reset transacional com reautenticacao',
  )
  assert.doesNotMatch(settingsPage, /const chaves = \[/, 'tela de configuracoes nao deve manter uma lista manual incompleta')

  for (const requiredKey of [
    'bbt-data-v4',
    'bbt-atendimentos',
    'bbt-vouchers-emitidos',
    'bbt-emissoes',
    'bbt-aprovacoes',
    'bbt-resumos-executivos-v12',
    'bbt-assistant-conversations-v1',
  ]) {
    assert.ok(RESETTABLE_SHARED_STORAGE_KEYS.includes(requiredKey), `reset deve incluir ${requiredKey}`)
  }

  const storeSource = fs.readFileSync(path.join(root, 'lib/store.ts'), 'utf8')
  assert.match(storeSource, /empresas:\s*\[\],\s*\n\s*gruposEmpresariais:\s*\[\],\s*\n\s*funcionarios:\s*\[\]/, 'store deve iniciar sem empresas ou funcionarios ficticios')
  const supplierSource = fs.readFileSync(path.join(root, 'lib/supplier-integrations.ts'), 'utf8')
  assert.doesNotMatch(supplierSource, /safeSetJSON\(STORAGE_SUPPLIERS, DEFAULT_SUPPLIERS\)/, 'conector padrao nao deve recriar dados depois do reset')

  const agentReport = fs.readFileSync(path.join(root, 'app/relatorios/agente/page.tsx'), 'utf8')
  assert.match(agentReport, /user\?\.role === 'master'/, 'relatorio de produtividade deve ser restrito a equipe interna')
  assert.match(agentReport, /ver_produtividade_todos/, 'relatorio de outro agente deve exigir permissao especifica')

  const voucherList = fs.readFileSync(path.join(root, 'app/dashboard/vouchers/page.tsx'), 'utf8')
  const voucherView = fs.readFileSync(path.join(root, 'app/dashboard/vouchers/[id]/page.tsx'), 'utf8')
  const voucherEdit = fs.readFileSync(path.join(root, 'app/dashboard/vouchers/[id]/editar/page.tsx'), 'utf8')
  const voucherCreate = fs.readFileSync(path.join(root, 'app/dashboard/vouchers/novo/page.tsx'), 'utf8')
  assert.match(voucherList, /canManageVouchers = user\?\.role === 'master'/, 'lista de vouchers deve ocultar mutacoes de usuarios externos')
  assert.match(voucherView, /canViewCompany\(/, 'voucher individual deve validar o escopo da empresa')
  assert.match(voucherView, /canManageVoucher = user\?\.role === 'master'/, 'voucher individual deve restringir mutacoes a equipe interna')
  assert.match(voucherEdit, /canEditCompany\(/, 'edicao de voucher deve validar o escopo da empresa')
  assert.match(voucherEdit, /user\?\.role === 'master'/, 'edicao de voucher deve ser restrita a equipe interna')
  assert.match(voucherCreate, /user\?\.role !== 'master'/, 'criacao de voucher deve ser restrita a equipe interna')

  const reportsPage = fs.readFileSync(path.join(root, 'app/dashboard/relatorios/page.tsx'), 'utf8')
  assert.match(reportsPage, /const isAgency = user\?\.role === 'master'/, 'CSV geral deve separar visao interna e externa')
  assert.match(reportsPage, /: \['Valor final'\]/, 'CSV externo nao deve expor colunas internas')
  assert.match(reportsPage, /REPORT_LIST_BATCH_SIZE = 30/, 'listas de relatorios devem carregar em lotes seguros')
  assert.doesNotMatch(reportsPage, /relatorios(?:Funcionario|CentroCusto)\.slice\(0,\s*80\)/, 'listas de relatorios nao podem ocultar registros depois do item 80')

  const dashboardLayout = fs.readFileSync(path.join(root, 'app/dashboard/layout.tsx'), 'utf8')
  const dashboardPage = fs.readFileSync(path.join(root, 'app/dashboard/page.tsx'), 'utf8')
  const demandInboxPage = fs.readFileSync(path.join(root, 'app/dashboard/caixa-entrada/page.tsx'), 'utf8')
  const demandsPage = fs.readFileSync(path.join(root, 'app/dashboard/demandas/page.tsx'), 'utf8')
  const reservationsPage = fs.readFileSync(path.join(root, 'app/dashboard/reservas/page.tsx'), 'utf8')
  const companyPortalPage = fs.readFileSync(path.join(root, 'app/dashboard/portal-empresa/page.tsx'), 'utf8')
  const companyDetailPage = fs.readFileSync(path.join(root, 'app/dashboard/empresas/[id]/page.tsx'), 'utf8')
  const emissionsPage = fs.readFileSync(path.join(root, 'app/dashboard/emissoes/page.tsx'), 'utf8')
  const generalImportPage = fs.readFileSync(path.join(root, 'app/dashboard/importar/page.tsx'), 'utf8')
  const globalStyles = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  const header = fs.readFileSync(path.join(root, 'components/header.tsx'), 'utf8')
  const sidebar = fs.readFileSync(path.join(root, 'components/sidebar.tsx'), 'utf8')
  const operationalMap = fs.readFileSync(path.join(root, 'components/dashboard/operational-map.tsx'), 'utf8')
  const quickAiPopup = fs.readFileSync(path.join(root, 'components/ai/quick-ai-popup.tsx'), 'utf8')
  const iaParser = fs.readFileSync(path.join(root, 'lib/ia-parser.ts'), 'utf8')
  const assistantSettingsClient = fs.readFileSync(path.join(root, 'lib/assistant-settings-client.ts'), 'utf8')
  const wintourImport = fs.readFileSync(path.join(root, 'lib/wintour-import.ts'), 'utf8')
  assert.doesNotMatch(dashboardLayout, /pedirPermissaoNotificacao/, 'dashboard nao deve solicitar notificacao sem gesto do usuario')
  assert.match(header, /aria-label="Abrir menu principal"/, 'cabecalho deve oferecer navegacao movel acessivel')
  assert.match(sidebar, /-translate-x-full/, 'menu lateral deve iniciar fora da tela no celular')
  assert.match(sidebar, /onMobileClose/, 'menu lateral deve fechar depois da navegacao movel')
  assert.match(demandsPage, /OPERATION_PAGE_SIZE = 30/, 'fila operacional deve limitar o custo de renderizacao')
  assert.match(demandsPage, /function ListPagination/, 'fila operacional deve preservar acesso a todos os registros por paginacao')
  assert.doesNotMatch(demandsPage, /slice\(0,\s*80\)/, 'fila operacional nao pode ocultar silenciosamente registros depois do item 80')
  assert.match(demandInboxPage, /serialDemandaCriada/, 'entrada de demandas deve exibir a OS gerada')
  assert.match(demandInboxPage, /\/dashboard\/reservas\?atendimento=/, 'entrada de demandas deve abrir reservas com vinculo direto')
  assert.match(demandsPage, /\(a\.serial_os \|\| ''\)\.toLowerCase\(\)\.includes\(q\)/, 'fila deve permitir busca por OS')
  assert.match(demandsPage, /new URLSearchParams\(window\.location\.search\)\.get\('id'\)/, 'notificacao deve abrir a demanda indicada')
  assert.match(reservationsPage, /Demandas recentes sem conclusão/, 'reservas deve oferecer seletor de demandas recentes')
  assert.match(reservationsPage, /formFromAtendimento\(current, demanda, funcionarios, serial\)/, 'reservas deve preencher os dados da demanda vinculada')
  assert.match(companyPortalPage, /pedidosVisiveis/, 'portal da empresa deve permitir carregar todos os pedidos progressivamente')
  assert.match(companyPortalPage, /vouchersVisiveis/, 'portal da empresa deve permitir carregar todos os vouchers progressivamente')
  assert.doesNotMatch(companyPortalPage, /atendimentos\.slice\(0,\s*50\)/, 'portal da empresa nao pode ocultar pedidos depois do item 50')
  assert.doesNotMatch(companyPortalPage, /vouchers\.slice\(0,\s*100\)/, 'portal da empresa nao pode ocultar vouchers depois do item 100')
  assert.match(companyDetailPage, /dynamic\(\s*\(\) => import\('\@\/components\/ui\/importar-funcionarios-modal'\)/, 'cadastro da empresa deve carregar importador de funcionarios sob demanda')
  assert.match(emissionsPage, /await import\('\@\/lib\/emissoes-parser'\)/, 'importacao de emissoes deve carregar o parser XLSX somente ao selecionar arquivo')
  assert.match(generalImportPage, /await import\('\@\/lib\/parser-funcionarios-xlsx'\)/, 'central de importacao deve carregar o parser XLSX somente quando necessario')
  assert.match(operationalMap, /ResizeObserver/, 'mapa deve reagir a mudancas de tamanho do layout')
  assert.match(operationalMap, /invalidateSize/, 'mapa deve recalcular suas dimensoes depois de redimensionamentos')
  assert.match(operationalMap, /mapRef\.current !== map/, 'efeitos assincronos do mapa devem rejeitar instancias desmontadas')
  assert.match(iaParser, /_statusRequest/, 'status da IA deve compartilhar requisicoes simultaneas')
  assert.doesNotMatch(dashboardPage, /getStatusIA\(true\)/, 'dashboard deve reutilizar o cache de status da IA')
  assert.doesNotMatch(quickAiPopup, /getStatusIA\(true\)/, 'atalho da IA deve reutilizar o cache de status')
  assert.match(assistantSettingsClient, /settingsRequest/, 'configuracoes do assistente devem compartilhar requisicoes simultaneas')
  assert.doesNotMatch(wintourImport, /^import \* as XLSX from 'xlsx'/m, 'Wintour nao deve carregar o XLSX antes de uma importacao')
  assert.match(wintourImport, /const XLSX = await import\('xlsx'\)/, 'Wintour deve carregar o XLSX somente ao processar planilha')
  assert.doesNotMatch(globalStyles, /\.bbt-sidebar\s*\{[^}]*position:\s*sticky/s, 'CSS global nao pode anular o menu movel fixo')
  assert.match(globalStyles, /\.recharts-default-tooltip\s*\{[^}]*overflow-wrap:\s*anywhere/s, 'tooltips de graficos devem quebrar rotulos longos')
  assert.match(dashboardPage, /a\.funcionario_id \|\| normalizarNome\(a\.passageiro_nome\)/, 'dashboard deve priorizar o ID permanente do viajante')

  const standaloneReport = fs.readFileSync(path.join(root, 'app/relatorios/_components/export-html.ts'), 'utf8')
  assert.match(standaloneReport, /\^\[\\t\\r \]\*\[=\+\\-@\]/, 'CSV do HTML autonomo deve bloquear formulas de planilha')
  assert.match(standaloneReport, /\.cat-value-slot\s*\{/, 'HTML autonomo deve reservar uma faixa propria para valores do grafico')
  assert.match(standaloneReport, /\.cat-plot\s*\{/, 'HTML autonomo deve limitar as barras a uma area de plotagem estavel')
  assert.doesNotMatch(standaloneReport, /\.top-kpi-value[^}]*text-overflow:\s*ellipsis/, 'HTML autonomo nao deve ocultar valores financeiros dos KPIs')
  assert.match(standaloneReport, /pageSize: 30/, 'HTML autonomo deve paginar a base detalhada em lotes seguros')

  const corporateReport = fs.readFileSync(path.join(root, 'app/relatorios/_components/corporate-report.tsx'), 'utf8')
  assert.match(corporateReport, /grid-rows-\[26px_126px_40px\]/, 'relatorio consolidado deve separar valor, barra e legenda')
  assert.doesNotMatch(corporateReport, /h-\[170px\][^\n]*items-end/, 'grafico consolidado nao deve usar a altura antiga que recortava o maior valor')
  assert.match(corporateReport, /const pageSize = 30/, 'relatorio consolidado deve paginar a base detalhada em lotes seguros')

  const corporateDashboardHtml = fs.readFileSync(path.join(root, 'lib/reporting/corporate-dashboard-html.ts'), 'utf8')
  assert.match(corporateDashboardHtml, /class=\"bar-plot\"/, 'dashboard HTML deve reservar a area de plotagem dos graficos')
  assert.match(corporateDashboardHtml, /class=\"category-plot\"/, 'consolidado HTML deve separar barra e rotulo de categoria')

  const branding = fs.readFileSync(path.join(root, 'lib/branding.ts'), 'utf8')
  const logoComponent = fs.readFileSync(path.join(root, 'components/branding/bbt-logo.tsx'), 'utf8')
  const loginPage = fs.readFileSync(path.join(root, 'app/login/page.tsx'), 'utf8')
  const aerialReport = fs.readFileSync(path.join(root, 'components/reports/aereo-executivo-report.tsx'), 'utf8')
  const manifest = fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8')
  const serviceWorker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.match(branding, /SYSTEM_NAME = 'BBT Corporativo'/, 'nome oficial deve ser centralizado na identidade visual')
  assert.match(branding, /bbt-corporativo-lockup-color\.webp/, 'identidade deve oferecer lockup transparente para superficies claras')
  assert.match(branding, /bbt-corporativo-lockup-white\.webp/, 'identidade deve oferecer lockup transparente para superficies escuras')
  assert.match(logoComponent, /tone\?: 'color' \| 'white'/, 'componente de marca deve controlar contraste por superficie')
  assert.match(loginPage, /variant="full" tone="white"/, 'login deve aplicar o lockup branco diretamente sobre a imagem')
  assert.match(loginPage, /variant="full" tone="color"/, 'login deve aplicar o lockup colorido diretamente sobre a area clara')
  assert.doesNotMatch(loginPage, /MetricCard|Cockpit operacional/, 'login nao deve exibir metricas decorativas sem dados reais')
  assert.match(standaloneReport, /brandLogoDataUrl/, 'HTML consolidado deve incorporar a marca para funcionar offline')
  assert.match(standaloneReport, /class="report-head-logo"/, 'HTML consolidado deve integrar a marca ao cabecalho do relatorio')
  assert.doesNotMatch(standaloneReport, /\.brand-logo-wrap/, 'HTML consolidado nao deve colocar a marca em um cartao branco')
  assert.match(corporateDashboardHtml, /brandLogoDataUrl/, 'dashboard HTML deve incorporar a marca para funcionar offline')
  assert.doesNotMatch(corporateDashboardHtml, /border-radius:6px;background:#fff/, 'dashboard HTML nao deve colar fundo branco no logo')
  assert.doesNotMatch(aerialReport, /\.brand-logo\{[^}]*background:white/, 'relatorio aereo HTML nao deve colar fundo branco no logo')
  assert.match(manifest, /\/brand\/bbt-corporativo-mark-192\.png/, 'PWA deve usar o icone oficial da BBT Corporativo')
  assert.doesNotMatch(manifest, /\/bbt-logo/, 'manifesto nao deve depender dos assets antigos')
  assert.match(serviceWorker, /bbt-shell-v20-1/, 'service worker deve versionar o shell seguro do portal do viajante')
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/, 'service worker nao deve interceptar respostas autenticadas da API')
  assert.match(serviceWorker, /request\.mode === 'navigate'/, 'service worker deve oferecer fallback somente para navegacao offline')
  assert.doesNotMatch(serviceWorker, /cache\.put\(request[^)]*\/api\//, 'service worker nao deve persistir respostas da API')

  for (const asset of [
    'bbt-corporativo-lockup-color.webp',
    'bbt-corporativo-lockup-white.webp',
    'bbt-corporativo-report-v2.webp',
    'bbt-corporativo-mark-color.webp',
    'bbt-corporativo-mark-white.webp',
    'bbt-corporativo-mark.png',
    'bbt-corporativo-mark-192.png',
    'bbt-corporativo-mark-512.png',
  ]) {
    const stat = fs.statSync(path.join(root, 'public/brand', asset))
    assert.ok(stat.size > 1024, `${asset} deve existir e conter uma imagem valida`)
  }

  const embeddedLogo = 'data:image/webp;base64,UklGRg=='
  const consolidatedHtml = buildStandaloneReportHtml({
    title: 'Relatorio consolidado',
    eyebrow: 'Visao da empresa',
    visao: 'cliente',
    isAgency: false,
    entityName: 'Empresa Teste',
    entityMeta: [],
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    issuedAt: '2026-07-14T12:00:00.000Z',
    generatedAt: '2026-07-14T12:00:00.000Z',
    totalDias: 31,
    brandLogoDataUrl: embeddedLogo,
    detailCompanyColumn: false,
    categoryLabels: {},
    statusLabels: {},
    paymentLabels: {},
    details: [],
    initialState: {
      activeTab: 'resumo',
      detailQuery: '',
      detailType: 'todos',
      detailStatus: 'todos',
      detailCompany: 'todas',
      detailFocus: null,
      operationalMode: 'graficos',
      operationalChart: 'servico',
    },
  })
  assert.match(consolidatedHtml, /data:image\/webp;base64,UklGRg==/, 'HTML consolidado deve conter a marca embutida')
  assert.match(consolidatedHtml, /BBT Corporativo/, 'HTML consolidado deve exibir o nome oficial')

  const dashboardHtml = montarCorporateDashboardStandaloneHtml(
    { linhas: [] },
    { inicio: '2026-07-01', fim: '2026-07-31' },
    {},
    embeddedLogo,
  )
  assert.match(dashboardHtml, /data:image\/webp;base64,UklGRg==/, 'dashboard HTML deve conter a marca embutida')
  assert.match(dashboardHtml, /BBT Corporativo/, 'dashboard HTML deve exibir o nome oficial')
}

{
  const firstClear = buildStorageClearMetadata(null, ['bbt-atendimentos'], {
    clearedAt: '2026-07-20T10:00:00.000Z',
    clearId: 'clear-1',
  })
  const fullReset = buildStorageClearMetadata(firstClear, ['bbt-atendimentos', 'bbt-data-v4'], {
    clearedAt: '2026-07-20T11:00:00.000Z',
    clearId: 'clear-2',
    fullReset: true,
  })
  assert.equal(isStorageKeyClearNewer(fullReset, firstClear, 'bbt-atendimentos'), true)
  assert.equal(isStorageKeyClearNewer(firstClear, fullReset, 'bbt-atendimentos'), false)
  assert.equal(isFullStorageResetNewer(fullReset, firstClear), true)
  assert.equal(storageWriteAcknowledgesLatestClear(fullReset, {}, 'bbt-atendimentos'), false)
  assert.equal(storageWriteAcknowledgesLatestClear(fullReset, fullReset.cleared_keys, 'bbt-atendimentos'), true)

  const mergedWithStaleClient = mergeStorageValues(SYSTEM_STORAGE_META_KEY, fullReset, firstClear)
  assert.equal(mergedWithStaleClient.full_reset_id, 'clear-2')
  assert.equal(mergedWithStaleClient.cleared_keys['bbt-data-v4'], '2026-07-20T11:00:00.000Z')
}

{
  const masked = maskSensitive({
    Key: 'segredo-do-relatorio',
    nested: { chave: 'outro-segredo', safe: 'valor-publico' },
  })
  assert.equal(masked.Key, '***')
  assert.equal(masked.nested.chave, '***')
  assert.equal(masked.nested.safe, 'valor-publico')

  assert.equal(techEmissionQuerySchema.safeParse({ startDate: '2026-06-01', endDate: '2026-06-29' }).success, true)
  assert.equal(techEmissionQuerySchema.safeParse({ startDate: '2026-06-29', endDate: '2026-06-01' }).success, false)
  assert.equal(techEmissionQuerySchema.safeParse({ startDate: '2026-01-01', endDate: '2027-01-02' }).success, false)

  const air = normalizeTechEmission({
    NOMEFANTASIAAGENCIA: 'Agencia A',
    NOMECLIENTE: 'Empresa A',
    NumeroOS: '1234',
    NOMEPAX: 'ALDO',
    SOBRENOMEPAX: 'FERNANDES JUNIOR',
    TIPO: 'AEREO',
    BILHETE: '9570000000000',
    LOCALIZADOR: 'ABC123',
    DTEMISSAO: '2026-06-10T12:30:00',
    TARIFACLIENTE: '1.000,00',
    TAXASEMBARQUECLIENTE: '100,00',
    TAXADUFEECLIENTE: '20,00',
    TOTALCLIENTE: '1.120,00',
    TARIFAFORNECEDOR: 900,
    TAXASEMBARQUEFORNECEDOR: 80,
    TOTALFORNECEDOR: 980,
    ORIGEM1: 'GYN',
    DESTINO1: 'CGH',
    DTPARTIDA1: '2026-06-20T08:00:00',
    DTCHEGADA1: '2026-06-20T09:35:00',
    VOO1: 'LA1234',
  })
  assert.equal(air.passengerName, 'ALDO FERNANDES JUNIOR')
  assert.equal(air.service, 'Aéreo')
  assert.equal(air.saleNumber, 'TECH:9570000000000')
  assert.equal(air.customerTotal, 1120)
  assert.equal(air.supplierTotal, 980)
  assert.equal(air.route, 'GYN/CGH')
  assert.equal(air.segments.length, 1)

  const sameIdentityWithUpdatedAmount = normalizeTechEmission({
    NOMEFANTASIAAGENCIA: 'Agencia A',
    NOMECLIENTE: 'Empresa A',
    NumeroOS: '1234',
    NOMEPAX: 'ALDO',
    SOBRENOMEPAX: 'FERNANDES JUNIOR',
    TIPO: 'AEREO',
    BILHETE: '9570000000000',
    LOCALIZADOR: 'ABC123',
    DTEMISSAO: '2026-06-10T12:30:00',
    TOTALCLIENTE: 1200,
    TOTALFORNECEDOR: 1000,
    ORIGEM1: 'GYN',
    DESTINO1: 'CGH',
    DTPARTIDA1: '2026-06-20T08:00:00',
    DTCHEGADA1: '2026-06-20T09:35:00',
    VOO1: 'LA1234',
  })
  assert.equal(sameIdentityWithUpdatedAmount.externalId, air.externalId, 'mudanca financeira nao pode duplicar a emissao')

  const hotel = normalizeTechEmission({
    NOMECLIENTE: 'Empresa A',
    NumeroOS: '5678',
    NOMEPAX: 'MARIA SOUZA',
    TIPO: 'HOTEL',
    LOCALIZADOR: 'HOTEL01',
    FORNECEDOR: 'Hotel Central',
    TRECHOS: 'GOIANIA, GO, BRASIL',
    TARIFACLIENTE: 500,
    TAXASEMBARQUECLIENTE: 20,
    TARIFAFORNECEDOR: 450,
    TAXASEMBARQUEFORNECEDOR: 10,
  })
  assert.equal(hotel.service, 'Hotel')
  assert.equal(hotel.route, 'GOIANIA, GO, BRASIL')
  assert.equal(hotel.customerTotal, 520, 'total ausente deve usar tarifa e taxas do cliente')
  assert.equal(hotel.supplierTotal, 460, 'total ausente deve usar tarifa e taxas do fornecedor')
}

{
  const serverAuthSource = fs.readFileSync(path.join(root, 'lib/server-auth.ts'), 'utf8')
  assert.match(
    serverAuthSource,
    /export function authRequired\(\): boolean \{\s*return true\s*\}/,
    'as APIs nunca podem iniciar com sessao opcional',
  )
  assert.doesNotMatch(
    serverAuthSource,
    /AUTH_REQUIRE_SESSION/,
    'a exigencia de sessao nao pode depender de uma flag de ambiente',
  )
}

for (const directory of ['app/api/travel']) {
  const pending = [path.join(root, directory)]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      if (!entry.isFile() || entry.name !== 'route.ts') continue
      const source = fs.readFileSync(absolute, 'utf8')
      assert.match(source, /requireAuth:\s*true/, `${path.relative(root, absolute)} deve exigir autenticacao`)
      assert.match(source, /permission:\s*'[a-z_]+'/, `${path.relative(root, absolute)} deve exigir permissao operacional explicita`)
      assert.match(source, /roleKeys:\s*\[[^\]]*'tenant_admin'[^\]]*\]/, `${path.relative(root, absolute)} deve restringir acesso a perfis internos`)
    }
  }
}

{
  const pending = [path.join(root, 'app/api/integrations/tech')]
  const tenantGlobalRoutes = new Set([
    path.join('access-company', 'route.ts'),
    path.join('companies', 'route.ts'),
    path.join('emissions', 'route.ts'),
    path.join('status', 'route.ts'),
  ])
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      if (!entry.isFile() || entry.name !== 'route.ts') continue
      const source = fs.readFileSync(absolute, 'utf8')
      const relative = path.relative(path.join(root, 'app/api/integrations/tech'), absolute)
      assert.match(source, /requireAuth:\s*true/, `${path.relative(root, absolute)} deve exigir autenticacao`)
      if (tenantGlobalRoutes.has(relative)) {
        assert.match(source, /tenantAdmin:\s*true/, `${path.relative(root, absolute)} deve exigir administracao global do tenant`)
      } else {
        assert.match(
          source,
          /permission:\s*'(gerenciar_integracoes|importar_planilhas)'/,
          `${path.relative(root, absolute)} deve exigir permissao explicita e validar escopo no servico`,
        )
      }
    }
  }
}

{
  const pending = [path.join(root, 'app/api')]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      if (!entry.isFile() || entry.name !== 'route.ts') continue
      const source = fs.readFileSync(absolute, 'utf8')
      assert.doesNotMatch(
        source,
        /\b(?:request|req)\.json\(/,
        `${path.relative(root, absolute)} deve limitar o corpo JSON antes de desserializar`,
      )
    }
  }

  const authService = fs.readFileSync(path.join(root, 'lib/server/auth-service.ts'), 'utf8')
  const usersPage = fs.readFileSync(path.join(root, 'app/dashboard/usuarios/page.tsx'), 'utf8')
  const requestersPage = fs.readFileSync(path.join(root, 'components/empresas/solicitantes-empresa-tab.tsx'), 'utf8')
  const requesterRoute = fs.readFileSync(path.join(root, 'app/api/solicitantes/empresa/route.ts'), 'utf8')
  assert.match(authService, /password\.length < 12/, 'servidor deve exigir senha minima de 12 caracteres')
  assert.match(authService, /!\/\[a-z\]\//, 'servidor deve exigir letra minuscula')
  assert.match(authService, /!\/\[A-Z\]\//, 'servidor deve exigir letra maiuscula')
  assert.match(authService, /!\/\\d\//, 'servidor deve exigir numero')
  assert.match(authService, /!\/\[\^A-Za-z0-9\]\//, 'servidor deve exigir simbolo')
  assert.match(usersPage, /password\.length < 12/, 'cadastro interno deve validar senha minima de 12 caracteres')
  assert.doesNotMatch(requestersPage, /type="password"/, 'administrador nao deve definir senha do solicitante')
  assert.match(requestersPage, /convite seguro/i, 'acesso do portal deve utilizar convite individual')
  assert.doesNotMatch(requesterRoute, /password:\s*envelope\.password/, 'API de solicitantes nao deve criar senha conhecida pelo administrador')
}

for (const relativePath of [
  'app/api/integrations/status/route.ts',
  'app/api/assistant/logs/route.ts',
  'app/api/assistant/audit/route.ts',
  'app/api/assistant/conversations/route.ts',
  'app/api/assistant/health/route.ts',
  'app/api/assistant/whatsapp/status/route.ts',
  'app/api/assistant/whatsapp/qrcode/route.ts',
]) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  assert.match(source, /tenantAdmin:\s*true/, `${relativePath} deve exigir administracao global do tenant`)
}

{
  const attack = '</script><script>globalThis.compromised=true</script>'
  const serialized = serializeForInlineScript({ name: attack })
  assert.equal(serialized.includes('</script>'), false)
  assert.ok(serialized.includes('\\u003c/script\\u003e'))
  assert.equal(escapeHtmlText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')

  const validPdf = Buffer.from('%PDF-1.7\n%%EOF')
  assert.doesNotThrow(() => validatePdfUpload(validPdf, 'voucher.pdf', 1024))
  assert.throws(
    () => validatePdfUpload(Buffer.from('<script>alert(1)</script>'), 'voucher.pdf', 1024),
    /nao e um PDF valido/,
  )

  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"')
  assert.equal(csvCell('  @SUM(1,1)'), '"\'  @SUM(1,1)"')
  assert.equal(buildCsv([['Nome', 'Valor'], ['Cliente', 10]]), '"Nome";"Valor"\n"Cliente";"10"')
}

{
  const source = fs.readFileSync(path.join(root, 'app/api/auth/login/route.ts'), 'utf8')
  assert.match(source, /guardApiRequest\(/, 'login deve usar guardApiRequest')
  assert.match(source, /requireAuth:\s*false/, 'login deve permanecer publico')
  assert.ok(source.includes('auth-login:post'), 'login deve limitar tentativas')
}

const empresas = [
  { id: 'emp-a', nome: 'Alpha', cnpj: '1', endereco: '', responsavel: '', email_responsavel: '', telefone: '', centro_custo_padrao: '', ativa: true, grupo_id: 'grp-1', created_at: '2026-01-01' },
  { id: 'emp-b', nome: 'Beta', cnpj: '2', endereco: '', responsavel: '', email_responsavel: '', telefone: '', centro_custo_padrao: '', ativa: true, grupo_id: null, created_at: '2026-01-01' },
  { id: 'emp-c', nome: 'Gamma', cnpj: '3', endereco: '', responsavel: '', email_responsavel: '', telefone: '', centro_custo_padrao: '', ativa: true, grupo_id: 'grp-2', created_at: '2026-01-01' },
]

const grupos = [
  { id: 'grp-1', nome: 'Holding A', ativo: true, empresa_ids: ['emp-a'], created_at: '2026-01-01' },
  { id: 'grp-2', nome: 'Holding B', ativo: true, empresa_ids: ['emp-c'], created_at: '2026-01-01' },
]

{
  const atualizados = aplicarVinculoEmpresaGrupo(grupos, 'emp-b', 'grp-1')
  assert.deepEqual(atualizados.find((grupo) => grupo.id === 'grp-1').empresa_ids.sort(), ['emp-a', 'emp-b'])
  assert.deepEqual(atualizados.find((grupo) => grupo.id === 'grp-2').empresa_ids, ['emp-c'])
}

{
  const sincronizados = sincronizarGruposComEmpresas([{ ...grupos[0], empresa_ids: [] }, grupos[1]], empresas)
  assert.deepEqual(sincronizados.find((grupo) => grupo.id === 'grp-1').empresa_ids, ['emp-a'])
}

{
  const userGrupo = { id: 'u1', email: 'u1@x.com', name: 'Grupo', role: 'master', company_id: null, grupo_ids: ['grp-1'] }
  const permitidas = empresasPermitidasParaUsuario(userGrupo, empresas, grupos).map((empresa) => empresa.id).sort()
  assert.deepEqual(permitidas, ['emp-a'])
  const escopo = resolverEscopoGrupoUsuario(userGrupo, grupos[0], empresas)
  assert.equal(escopo.podeAcessar, true)
  assert.equal(escopo.podeVerConsolidado, true)
  assert.deepEqual(escopo.empresaIdsPermitidas, ['emp-a'])
}

{
  const userEmpresa = { id: 'u2', email: 'u2@x.com', name: 'Empresa', role: 'company_admin', company_id: 'emp-a' }
  const escopo = resolverEscopoGrupoUsuario(userEmpresa, grupos[0], empresas)
  assert.equal(escopo.podeAcessar, true)
  assert.equal(escopo.podeVerConsolidado, false)
  assert.deepEqual(escopo.empresaIdsPermitidas, ['emp-a'])
}

{
  const merged = mergeStorageValues(
    'bbt-atendimentos',
    [
      { id: 'atd-antigo', venda_numero: '100', passageiro_nome: 'Registro antigo', updated_at: '2026-06-01T10:00:00.000Z', valor_venda: 100 },
      { id: 'atd-mesma-venda-local', venda_numero: '200', passageiro_nome: 'Versao local', updated_at: '2026-06-01T10:00:00.000Z', valor_venda: 200 },
    ],
    [
      { id: 'atd-novo', venda_numero: '101', passageiro_nome: 'Registro novo', updated_at: '2026-06-02T10:00:00.000Z', valor_venda: 300 },
      { id: 'atd-mesma-venda-remoto', venda_numero: '200', passageiro_nome: 'Versao mais nova', updated_at: '2026-06-03T10:00:00.000Z', valor_venda: 250 },
    ],
  )
  assert.equal(merged.length, 3)
  assert.ok(merged.some((item) => item.venda_numero === '100'))
  assert.ok(merged.some((item) => item.venda_numero === '101'))
  const mesmaVenda = merged.find((item) => item.venda_numero === '200')
  assert.equal(mesmaVenda.passageiro_nome, 'Versao mais nova')
  assert.equal(mesmaVenda.valor_venda, 250)
}

{
  const merged = mergeStorageValues(
    'bbt-data-v4',
    { state: { empresas: [{ id: 'emp-a', nome: 'Alpha' }], gruposEmpresariais: [{ id: 'grp-1', nome: 'Holding A', empresa_ids: ['emp-a'] }] } },
    { state: { empresas: [{ id: 'emp-b', nome: 'Beta' }], gruposEmpresariais: [{ id: 'grp-2', nome: 'Holding B', empresa_ids: ['emp-b'] }] } },
  )
  assert.deepEqual(merged.state.empresas.map((empresa) => empresa.id).sort(), ['emp-a', 'emp-b'])
  assert.deepEqual(merged.state.gruposEmpresariais.map((grupo) => grupo.id).sort(), ['grp-1', 'grp-2'])
}

{
  const merged = mergeStorageValues(
    'bbt-alertas-resolvidos',
    ['alerta-1', 'alerta-2', 'alerta-1'],
    ['alerta-2', 'alerta-3'],
  )
  assert.deepEqual(merged, ['alerta-1', 'alerta-2', 'alerta-3'])
}

{
  const note = { text: 'Revisar reserva', created_at: '2026-06-01T10:00:00.000Z' }
  const merged = mergeStorageValues('bbt-travel-desk-v11', [note, note], [note])
  assert.equal(merged.length, 1)
}

{
  const merged = mergeStorageValues(
    'bbt-atendimentos',
    [{ id: 'atd-a', empresa_id: 'emp-a', venda_numero: '100', valor_venda: 100 }],
    [{ id: 'atd-b', empresa_id: 'emp-b', venda_numero: '100', valor_venda: 200 }],
  )
  assert.equal(merged.length, 2, 'numero de venda igual em empresas diferentes nao pode consolidar registros')
}

{
  const previousLocal = [
    { id: 'atd-manter', empresa_id: 'emp-a', updated_at: '2026-06-01T10:00:00.000Z' },
    { id: 'atd-excluir', empresa_id: 'emp-a', updated_at: '2026-06-01T10:00:00.000Z' },
  ]
  const nextLocal = [previousLocal[0]]
  const syncValue = createStorageSyncValue('bbt-atendimentos', previousLocal, nextLocal)
  const merged = mergeStorageValues('bbt-atendimentos', previousLocal, syncValue)
  assert.deepEqual(merged.map((item) => item.id), ['atd-manter'], 'registro excluido nao pode reaparecer apos sincronizacao')

  const stalePatch = createStorageSyncValue(
    'bbt-atendimentos',
    [previousLocal[0]],
    [previousLocal[0]],
  )
  const withConcurrentRecord = mergeStorageValues(
    'bbt-atendimentos',
    [...previousLocal, { id: 'atd-outro-cliente', empresa_id: 'emp-a' }],
    stalePatch,
  )
  assert.ok(withConcurrentRecord.some((item) => item.id === 'atd-outro-cliente'), 'cliente desatualizado nao pode apagar registro que nunca carregou')

  const secondPatch = createStorageSyncValue(
    'bbt-atendimentos',
    nextLocal,
    [{ ...nextLocal[0], observacoes: 'alterado depois da exclusao' }],
  )
  const pendingPatch = combineStorageSyncValues('bbt-atendimentos', syncValue, secondPatch)
  const mergedPending = mergeStorageValues('bbt-atendimentos', previousLocal, pendingPatch)
  assert.equal(mergedPending.length, 1, 'marcador de exclusao deve sobreviver ao debounce de outra alteracao')
  assert.equal(mergedPending[0].observacoes, 'alterado depois da exclusao')
}

{
  const previous = {
    state: {
      empresas: empresas.slice(0, 2),
      gruposEmpresariais: grupos,
      funcionarios: [],
      hoteis: [],
      politicas: [],
    },
  }
  const next = {
    state: {
      ...previous.state,
      empresas: [empresas[0]],
    },
  }
  const patch = createStorageSyncValue('bbt-data-v4', previous, next)
  const merged = mergeStorageValues('bbt-data-v4', previous, patch)
  assert.deepEqual(merged.state.empresas.map((empresa) => empresa.id), ['emp-a'])
}

{
  const recordA = { venda_numero: '100', empresa_codigo: 'EMP-A', empresa_nome: 'Alpha' }
  const recordB = { venda_numero: '100', empresa_codigo: 'EMP-B', empresa_nome: 'Beta' }
  assert.notEqual(criarFingerprintWintour(recordA), criarFingerprintWintour(recordB))

  const existentes = [
    { id: 'atd-a', empresa_id: 'emp-a', venda_numero: '100', observacoes_internas: '' },
    { id: 'atd-b', empresa_id: 'emp-b', venda_numero: '100', observacoes_internas: '' },
  ]
  assert.equal(encontrarDuplicataWintour(recordA, existentes, 'emp-a')?.id, 'atd-a')
  assert.equal(encontrarDuplicataWintour(recordB, existentes, 'emp-b')?.id, 'atd-b')
  assert.equal(encontrarDuplicataWintour(recordA, existentes), undefined, 'sem empresa, venda ambigua nao pode atualizar registro')

  const index = criarIndiceDuplicatasWintour(existentes)
  assert.equal(encontrarDuplicataWintourNoIndice(recordA, index, 'emp-a')?.id, 'atd-a')
  const novoAtendimento = { id: 'atd-c', empresa_id: 'emp-a', venda_numero: '101', observacoes_internas: '' }
  registrarAtendimentoNoIndiceWintour(index, novoAtendimento)
  assert.equal(
    encontrarDuplicataWintourNoIndice({ ...recordA, venda_numero: '101' }, index, 'emp-a')?.id,
    'atd-c',
    'indice incremental deve reconhecer registros adicionados durante a importacao',
  )
}

{
  const resultado = vincularFuncionarioNaLista(
    [
      { id: 'atd-vinculo-a', empresa_id: 'emp-a', funcionario_id: null, passageiro_nome: 'FERNANDES/ALDO' },
      { id: 'atd-vinculo-b', empresa_id: 'emp-b', funcionario_id: null, passageiro_nome: 'ALDO FERNANDES' },
    ],
    ['atd-vinculo-a', 'atd-vinculo-b'],
    'func-aldo',
    'emp-a',
    '2026-06-10T10:00:00.000Z',
  )
  assert.equal(resultado.atualizados, 1)
  assert.equal(resultado.ignorados, 1)
  assert.equal(resultado.atendimentos[0].funcionario_id, 'func-aldo')
  assert.equal(resultado.atendimentos[0].passageiro_nome, 'FERNANDES/ALDO', 'nome original deve permanecer como historico')
  assert.equal(resultado.atendimentos[0].updated_at, '2026-06-10T10:00:00.000Z')
  assert.equal(resultado.atendimentos[1].funcionario_id, null, 'vinculo nao pode atravessar empresas')
}

{
  const alertasEmpresasDiferentes = detectarVendasDuplicadas([
    { id: 'atd-dup-a', empresa_id: 'emp-a', venda_numero: '500' },
    { id: 'atd-dup-b', empresa_id: 'emp-b', venda_numero: '500' },
  ])
  assert.equal(alertasEmpresasDiferentes.length, 0, 'mesma venda em empresas distintas nao e duplicidade')

  const alertasMesmaEmpresa = detectarVendasDuplicadas([
    { id: 'atd-dup-a1', empresa_id: 'emp-a', venda_numero: '500' },
    { id: 'atd-dup-a2', empresa_id: 'emp-a', venda_numero: '500' },
  ])
  assert.equal(alertasMesmaEmpresa.length, 1)
  assert.equal(alertasMesmaEmpresa[0].tipo, 'venda_duplicada')
}

{
  const alertas = detectarPassageirosSemFuncionario(
    [{
      id: 'atd-vinculo-orfa',
      empresa_id: 'emp-a',
      funcionario_id: 'func-removido',
      passageiro_nome: 'ALDO FERNANDES JUNIOR',
    }],
    [{
      id: 'func-aldo',
      codigo_identificacao: '1025',
      company_id: 'emp-a',
      nome: 'ALDO FERNANDES JUNIOR',
      ativo: true,
    }],
  )
  assert.equal(alertas.length, 1, 'vinculo apontando para funcionario inexistente deve ser reconciliado')
  assert.equal(alertas[0].entidades.at(-1).id, 'func-aldo')
}

{
  const dataSerial = new Date('2026-06-01T12:00:00.000Z')
  const proximoSerial = criarSequenciadorSerialOS([
    { serial_os: 'OS-20260601-0010' },
    { serial_os: 'OS-20260601-0012' },
  ], dataSerial)
  assert.equal(proximoSerial(), 'OS-20260601-0013')
  assert.equal(proximoSerial(), 'OS-20260601-0014')

  const proximoCodigo = criarSequenciadorCodigoIdentificacao([
    { codigo_identificacao: '1000' },
    { codigo_identificacao: '1025' },
  ])
  assert.equal(proximoCodigo(), '1026')
  assert.equal(proximoCodigo(), '1027')
}

{
  const entries = {
    'bbt-data-v4': {
      state: {
        empresas: empresas.map((empresa) => ({
          ...empresa,
          config_cobranca: { aplicar_markup: true, markup_padrao_pct: 15 },
        })),
        gruposEmpresariais: grupos,
        funcionarios: [
          { id: 'func-a', company_id: 'emp-a', nome: 'Ana' },
          { id: 'func-b', company_id: 'emp-b', nome: 'Bia' },
        ],
        hoteis: [{
          id: 1,
          nome: 'Hotel global',
          cidade: 'Goiania',
          uf: 'GO',
          telefone: '62999999999',
          tarifa_sgl: 450,
          formas_pagamento: ['Faturamento'],
          info_faturamento: 'Condicao interna',
          observacoes: 'Contato interno',
        }],
        politicas: [],
      },
    },
    'bbt-users-v4': [{ user: { id: 'u-secret' }, password: 'segredo' }],
    'bbt-atendimentos': [
      { id: 'atd-a', empresa_id: 'emp-a', valor_venda: 1200, valor_custo: 900, markup_valor: 300, observacoes_internas: 'interno', wintour_dados: { prev_lucro_bruto: 300 } },
      { id: 'atd-b', empresa_id: 'emp-b' },
    ],
    'bbt-financeiro': [
      { id: 'fin-receber-a', empresa_id: 'emp-a', tipo: 'receber', valor: 1200 },
      { id: 'fin-pagar-a', empresa_id: 'emp-a', tipo: 'pagar', valor: 900 },
      { id: 'fin-receber-b', empresa_id: 'emp-b', tipo: 'receber', valor: 500 },
    ],
    'bbt-corporate-finance': {
      carteiras: [{ id: 'wallet-a', company_id: 'emp-a' }, { id: 'wallet-b', company_id: 'emp-b' }],
      cartoes: [],
      movimentos: [],
      faturas: [],
    },
  }
  const companyUser = { id: 'u-company', email: 'a@x.com', name: 'Empresa A', role: 'company_admin', company_id: 'emp-a' }
  const visible = scopeStorageEntriesForRead(entries, companyUser)
  assert.equal(visible['bbt-data-v4'].state.empresas.length, 1)
  assert.equal(visible['bbt-data-v4'].state.funcionarios.length, 1)
  assert.equal(visible['bbt-data-v4'].state.empresas[0].config_cobranca, undefined)
  assert.equal(visible['bbt-data-v4'].state.hoteis[0].nome, 'Hotel global')
  assert.equal(visible['bbt-data-v4'].state.hoteis[0].tarifa_sgl, null)
  assert.equal(visible['bbt-data-v4'].state.hoteis[0].telefone, null)
  assert.equal(visible['bbt-data-v4'].state.hoteis[0].info_faturamento, null)
  assert.deepEqual(visible['bbt-data-v4'].state.hoteis[0].formas_pagamento, [])
  assert.equal(visible['bbt-atendimentos'].length, 1)
  assert.equal(visible['bbt-atendimentos'][0].valor_venda, 1200)
  assert.equal(visible['bbt-atendimentos'][0].valor_custo, undefined)
  assert.equal(visible['bbt-atendimentos'][0].markup_valor, undefined)
  assert.equal(visible['bbt-atendimentos'][0].observacoes_internas, undefined)
  assert.equal(visible['bbt-atendimentos'][0].wintour_dados, undefined)
  assert.deepEqual(visible['bbt-financeiro'].map((item) => item.id), ['fin-receber-a'])
  assert.equal(visible['bbt-corporate-finance'].carteiras.length, 1)
  assert.equal(visible['bbt-users-v4'], undefined)

  const attemptedWrite = scopeStorageEntriesForWrite({
    'bbt-atendimentos': [
      { id: 'allowed', empresa_id: 'emp-a', valor_custo: 10, markup_valor: 5 },
      { id: 'blocked', empresa_id: 'emp-b' },
    ],
    'bbt-financeiro': [
      { id: 'blocked-payable', empresa_id: 'emp-a', tipo: 'pagar', valor: 10 },
    ],
  }, entries, companyUser)
  assert.deepEqual(attemptedWrite['bbt-atendimentos'].map((item) => item.id), ['allowed'])
  assert.equal(attemptedWrite['bbt-atendimentos'][0].valor_custo, undefined)
  assert.equal(attemptedWrite['bbt-atendimentos'][0].markup_valor, undefined)
  assert.equal(attemptedWrite['bbt-financeiro'], undefined)
}

const atendimentos = [
  {
    id: 'atd-1',
    empresa_id: 'emp-a',
    funcionario_id: null,
    passageiro_nome: 'Maria Silva',
    tipo_servico: 'Aéreo',
    valor_cotacao: 1500,
    valor_custo: 900,
    valor_venda: 1100,
    taxa_ativa: true,
    taxa_valor_fixo: 50,
    agente_user_id: 'ag-1',
    status: 'finalizado',
    prioridade: 'media',
    observacoes: '',
    data_atendimento: '2026-06-01',
    detalhes_aereo: { origem: 'BSB', destino: 'CGH', cia_aerea: 'LATAM', data_ida: '2026-06-15', numero_bilhete: '123' },
    created_at: '2026-06-01',
  },
  {
    id: 'atd-2',
    empresa_id: 'emp-a',
    funcionario_id: null,
    passageiro_nome: 'Joao Lima',
    tipo_servico: 'Hotel',
    valor_cotacao: 800,
    valor_custo: 600,
    valor_venda: 700,
    agente_user_id: 'ag-1',
    status: 'finalizado',
    prioridade: 'media',
    observacoes: '',
    data_atendimento: '2026-06-03',
    detalhes_hotel: { hotel_nome: 'Hotel Central', cidade: 'Sao Paulo', data_checkin: '2026-06-10', data_checkout: '2026-06-12', noites: 2 },
    created_at: '2026-06-03',
  },
]

{
  const metricas = montarMetricasRelatorio(atendimentos)
  assert.equal(metricas.total, 2)
  assert.equal(metricas.faturadoTotal, 1850)
  assert.equal(metricas.economia.economiaTotal, 450)
}

{
  const semBaseComparavel = [{
    ...atendimentos[0],
    id: 'atd-sem-base',
    valor_cotacao: 1100,
    valor_venda: 1100,
    taxa_ativa: true,
    taxa_valor_fixo: 100,
  }]
  const metricas = montarMetricasRelatorio(semBaseComparavel)
  assert.equal(metricas.economia.economiaTotal, 0, 'valor de venda nao pode ser tratado como economia')
  assert.equal(metricas.economia.oportunidadeTotal, 0, 'taxa de servico nao pode virar oportunidade de economia')
  assert.equal(metricas.economia.itensComparados, 0)
}

{
  const comBaseExplicita = [{
    ...atendimentos[0],
    id: 'atd-base-explicita',
    valor_cotacao: 1100,
    valor_venda: 1100,
    taxa_ativa: false,
    taxa_valor_fixo: 0,
    valor_referencia_economia: 1500,
    fonte_referencia_economia: 'preco_sem_agencia',
  }]
  const linhas = montarLinhasDetalhe(comBaseExplicita)
  assert.equal(linhas[0].referenciaFonte, 'preco_sem_agencia')
  assert.equal(linhas[0].economia, 400)
  const metricas = montarMetricasRelatorio(comBaseExplicita)
  assert.equal(metricas.economia.economiaTotal, 400)
  assert.equal(metricas.economia.economiaCotacao, 400)
  assert.equal(metricas.economia.itensComparados, 1)
}

{
  const comparativoMaisBarato = [{
    ...atendimentos[1],
    id: 'atd-oportunidade-explicita',
    valor_cotacao: 1000,
    valor_venda: 1000,
    valor_referencia_economia: 900,
    fonte_referencia_economia: 'preco_sem_agencia',
  }]
  const metricas = montarMetricasRelatorio(comparativoMaisBarato)
  assert.equal(metricas.economia.economiaTotal, 0)
  assert.equal(metricas.economia.oportunidadeTotal, 100)
}

{
  const operacional = montarRelatorioOperacional(atendimentos, empresas)
  assert.equal(operacional.porEmpresa[0].nome, 'Alpha')
  assert.equal(operacional.aereo.topRotas[0].nome, 'BSB -> CGH')
  assert.equal(operacional.hotel.topHoteis[0].nome, 'Hotel Central')
}

{
  const funcionarios = normalizarFuncionariosComCodigo([
    { id: 'func-1', codigo_identificacao: '1025', company_id: 'emp-a', nome: 'Joao da Silva', cpf: '12345678900', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'PROD', ativo: true, created_at: '2026-01-01' },
    { id: 'func-2', company_id: 'emp-a', nome: 'Maria Souza', cpf: '98765432100', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'ADM', ativo: true, created_at: '2026-01-01' },
  ])
  assert.equal(funcionarios[0].codigo_identificacao, '1025')
  assert.equal(funcionarios[1].codigo_identificacao, '1026')

  const reservasMesmoFuncionario = [
    {
      id: 'atd-f1',
      empresa_id: 'emp-a',
      funcionario_id: 'func-1',
      passageiro_nome: 'Joao',
      tipo_servico: 'Hotel',
      valor_cotacao: 700,
      valor_custo: 500,
      valor_venda: 600,
      agente_user_id: 'ag-1',
      status: 'finalizado',
      prioridade: 'media',
      observacoes: '',
      data_atendimento: '2026-06-05',
      detalhes_hotel: { hotel_nome: 'Hotel A', cidade: 'Goiania', data_checkin: '2026-06-10', data_checkout: '2026-06-11' },
      created_at: '2026-06-05',
    },
    {
      id: 'atd-f2',
      empresa_id: 'emp-a',
      funcionario_id: 'func-1',
      passageiro_nome: 'JOAO DA SILVA SANTOS',
      tipo_servico: 'Hotel',
      valor_cotacao: 900,
      valor_custo: 700,
      valor_venda: 800,
      agente_user_id: 'ag-1',
      status: 'finalizado',
      prioridade: 'media',
      observacoes: '',
      data_atendimento: '2026-06-06',
      detalhes_hotel: { hotel_nome: 'Hotel B', cidade: 'Goiania', data_checkin: '2026-06-12', data_checkout: '2026-06-13' },
      created_at: '2026-06-06',
    },
  ]
  assert.equal(countUniqueTravelers(reservasMesmoFuncionario, funcionarios), 1)
  const linhas = montarLinhasDetalhe(reservasMesmoFuncionario, undefined, funcionarios)
  assert.equal(linhas[0].passageiro, 'Joao da Silva')
  assert.equal(linhas[0].funcionarioCodigo, '1025')
  assert.equal(linhas[1].nomeInformadoNaReserva, 'JOAO DA SILVA SANTOS')
  const metricas = montarMetricasRelatorio(reservasMesmoFuncionario, funcionarios)
  assert.equal(metricas.analise.topViajantes[0].nome, 'Joao da Silva')
  assert.equal(metricas.analise.topViajantes[0].quantidade, 2)
}

{
  const funcionarios = normalizarFuncionariosComCodigo([
    { id: 'func-aldo', codigo_identificacao: '1025', company_id: 'emp-a', nome: 'ALDO FERNANDES JUNIOR', cpf: '11111111111', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'PROD', ativo: true, created_at: '2026-01-01' },
    { id: 'func-maria', codigo_identificacao: '1026', company_id: 'emp-a', nome: 'MARIA FERNANDES', cpf: '22222222222', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'ADM', ativo: true, created_at: '2026-01-01' },
  ])

  for (const nome of ['FERNANDES JUNIOR/ALDO', 'ALDO JUNIOR', 'ALDO FERNANDES', 'ALDO FERNANDES JUNIOR']) {
    const match = encontrarFuncionarioPorNomeInteligente(funcionarios, nome, 'emp-a', 84)
    assert.ok(match, `esperava match para ${nome}`)
    assert.equal(match.ambiguo, undefined, `match nao deveria ser ambiguo para ${nome}`)
    assert.equal(match.funcionario.id, 'func-aldo')
  }

  const reservasLegadas = [
    {
      id: 'atd-aldo-1',
      empresa_id: 'emp-a',
      funcionario_id: null,
      passageiro_nome: 'FERNANDES JUNIOR/ALDO',
      tipo_servico: 'Aereo',
      valor_cotacao: 1500,
      valor_custo: 900,
      valor_venda: 1100,
      agente_user_id: 'ag-1',
      status: 'finalizado',
      prioridade: 'media',
      observacoes: '',
      data_atendimento: '2026-06-01',
      detalhes_aereo: { origem: 'BSB', destino: 'CGH', cia_aerea: 'LATAM', data_ida: '2026-06-15', numero_bilhete: '123' },
      created_at: '2026-06-01',
    },
    {
      id: 'atd-aldo-2',
      empresa_id: 'emp-a',
      funcionario_id: null,
      passageiro_nome: 'ALDO FERNANDES',
      tipo_servico: 'Hotel',
      valor_cotacao: 800,
      valor_custo: 600,
      valor_venda: 700,
      agente_user_id: 'ag-1',
      status: 'finalizado',
      prioridade: 'media',
      observacoes: '',
      data_atendimento: '2026-06-03',
      detalhes_hotel: { hotel_nome: 'Hotel Central', cidade: 'Sao Paulo', data_checkin: '2026-06-10', data_checkout: '2026-06-12', noites: 2 },
      created_at: '2026-06-03',
    },
  ]
  assert.equal(countUniqueTravelers(reservasLegadas, funcionarios), 1)
  const linhas = montarLinhasDetalhe(reservasLegadas, undefined, funcionarios)
  assert.equal(linhas[0].funcionarioCodigo, '1025')
  assert.equal(linhas[0].passageiro, 'ALDO FERNANDES JUNIOR')
  assert.equal(linhas[0].nomeInformadoNaReserva, 'FERNANDES JUNIOR/ALDO')
  const metricas = montarMetricasRelatorio(reservasLegadas, funcionarios)
  assert.equal(metricas.analise.topViajantes[0].nome, 'ALDO FERNANDES JUNIOR')
  assert.equal(metricas.analise.topViajantes[0].quantidade, 2)
}

{
  const funcionarios = normalizarFuncionariosComCodigo([
    { id: 'func-aldo-fernandes', codigo_identificacao: '1025', company_id: 'emp-a', nome: 'ALDO FERNANDES JUNIOR', cpf: '11111111111', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'PROD', ativo: true, created_at: '2026-01-01' },
    { id: 'func-aldo-santos', codigo_identificacao: '1026', company_id: 'emp-a', nome: 'ALDO SANTOS JUNIOR', cpf: '22222222222', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'ADM', ativo: true, created_at: '2026-01-01' },
  ])
  const match = encontrarFuncionarioPorNomeInteligente(funcionarios, 'ALDO JUNIOR', 'emp-a', 84)
  assert.ok(match?.ambiguo, 'ALDO JUNIOR deve ficar ambiguo quando ha dois cadastros compativeis')
}

{
  const funcionarios = normalizarFuncionariosComCodigo([
    { id: 'func-aldo-fernandes', codigo_identificacao: '1025', company_id: 'emp-a', nome: 'ALDO FERNANDES JUNIOR', aliases_nome: ['ALDO JUNIOR'], cpf: '11111111111', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'PROD', ativo: true, created_at: '2026-01-01' },
    { id: 'func-aldo-santos', codigo_identificacao: '1026', company_id: 'emp-a', nome: 'ALDO SANTOS JUNIOR', cpf: '22222222222', data_nascimento: '', telefone: '', email: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '', cargo: 'Colaborador', centro_custo: 'ADM', ativo: true, created_at: '2026-01-01' },
  ])
  const match = encontrarFuncionarioPorNomeInteligente(funcionarios, 'ALDO JUNIOR', 'emp-a', 84)
  assert.equal(match?.funcionario.id, 'func-aldo-fernandes')
  assert.equal(match?.motivo, 'alias_manual')
  assert.equal(match?.ambiguo, undefined)

  const resolvidoImportacao = resolverFuncionario(funcionarios, { nome: 'ALDO JUNIOR' }, 'emp-a')
  assert.equal(resolvidoImportacao?.id, 'func-aldo-fernandes')
  assert.equal(resolvidoImportacao?.metodo, 'alias_manual')
}

{
  const serverDbSource = fs.readFileSync(path.join(root, 'lib/server-db.ts'), 'utf8')
  assert.match(serverDbSource, /withTenantTransaction\(/, 'persistencia compartilhada deve executar em transacao de tenant')
  assert.match(serverDbSource, /tenant_id = \$1/, 'consultas compartilhadas devem filtrar pelo tenant')
  assert.doesNotMatch(serverDbSource, /BBT_STORAGE_FILE|app-kv\.json|writeFile\(/, 'persistencia local nao pode voltar como fonte de verdade')
}

async function testClientSessionFailsClosed() {
  const previousFetch = global.fetch

  try {
    global.fetch = async () => { throw new Error('offline') }
    const unavailable = await fetchServerSession()
    assert.equal(unavailable.reachable, false)
    assert.equal(unavailable.requireSession, true)
    assert.equal(unavailable.user, null)

    global.fetch = async () => new Response(
      JSON.stringify({ ok: false, requireSession: false, user: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
    const explicitLocalMode = await fetchServerSession()
    assert.equal(explicitLocalMode.reachable, true)
    assert.equal(explicitLocalMode.requireSession, false)
  } finally {
    global.fetch = previousFetch
  }
}

async function testLimitedJsonReader() {
  const valid = await readJsonBody(
    new Request('http://local.test', { method: 'POST', body: JSON.stringify({ ok: true }) }),
    64,
  )
  assert.equal(valid.ok, true)

  await assert.rejects(
    () => readJsonBody(
      new Request('http://local.test', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(200) }) }),
      64,
    ),
    (error) => error instanceof RequestBodyError && error.status === 413,
  )

  const limited = await readJsonBodyResult(
    new Request('http://local.test', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(200) }) }),
    64,
  )
  assert.equal(limited.ok, false)
  assert.equal(limited.status, 413)

  const optional = await readJsonBodyResult(
    new Request('http://local.test', { method: 'POST' }),
    64,
    {},
  )
  assert.deepEqual(optional, { ok: true, body: {} })

  assert.equal(normalizeMaxOutputTokens(undefined, 2_000), 2_000)
  assert.equal(normalizeMaxOutputTokens(10, 2_000), 128)
  assert.equal(normalizeMaxOutputTokens(100_000, 2_000), 8_000)
}

async function testLazyWintourCsvParser() {
  const csv = [
    'Venda;Data Venda;Produto;Cod Cliente;Nome Cliente;Pax;Total Tarifa;Saldo Pagar;Previsao Lucro;Status',
    '1001;01/06/2026;HTL;WAY262;Empresa Teste;JOAO DA SILVA;100,00;80,00;20,00;CF',
  ].join('\n')
  const result = await parseWintourFile(new File([csv], 'wintour.csv', { type: 'text/csv' }))
  assert.equal(result.source_format, 'csv')
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].venda_numero, '1001')
  assert.equal(result.records[0].passageiro, 'JOAO DA SILVA')
  assert.equal(result.records[0].valor_total, 100)
}

testClientSessionFailsClosed()
  .then(testLimitedJsonReader)
  .then(testLazyWintourCsvParser)
  .then(() => console.log('domain-tests: ok'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
