import type { FormaPagamento, StatusAtendimento, TipoServico } from '@/types'
import type { FonteReferenciaEconomia, VisaoRelatorio } from '@/lib/relatorios'
import { escapeHtmlText, serializeForInlineScript } from '@/lib/security/html'

export type HtmlReportDetail = {
  id: string
  data: string
  passageiro: string
  funcionarioId?: string | null
  funcionarioCodigo?: string
  passageiroChave?: string
  nomeInformadoNaReserva?: string
  empresa?: string
  tipo: TipoServico
  localizador: string
  fornecedor: string
  destino: string
  centroCusto?: string
  solicitante?: string
  formaPagamento?: FormaPagamento
  status: StatusAtendimento
  total: number
  valorReferencia: number
  referenciaFonte: FonteReferenciaEconomia
  economia: number
  oportunidadeEconomia: number
  antecedenciaDias: number | null
  co2Kg: number
  rota?: string
  cidade?: string
  dataServico?: string
  dataCompra?: string
  companhia?: string
  bilhete?: string
  produto?: string
  tarifa?: number
  taxasServico?: number
  servicoResumo: string
  custo?: number
  venda?: number
  markup?: number
  taxa?: number
}

export type HtmlReportPayload = {
  title: string
  eyebrow: string
  visao: VisaoRelatorio
  isAgency: boolean
  entityName: string
  entityMeta: string[]
  periodStart: string
  periodEnd: string
  issuedAt: string
  generatedAt: string
  totalDias: number
  brandLogoDataUrl?: string
  detailCompanyColumn: boolean
  categoryLabels: Record<TipoServico, string>
  statusLabels: Record<StatusAtendimento, string>
  paymentLabels: Record<FormaPagamento, string>
  details: HtmlReportDetail[]
  initialState: {
    activeTab: 'resumo' | 'economia' | 'governanca' | 'servicos' | 'detalhes'
    detailQuery: string
    detailType: 'todos' | TipoServico
    detailStatus: 'todos' | StatusAtendimento
    detailCompany: string
    detailFocus: { kind: string; value: string; label: string } | null
    operationalMode: 'graficos' | 'detalhado'
    operationalChart: 'servico' | 'empresa' | 'rota' | 'antecedencia' | 'fornecedor' | 'centro'
  }
}

export function buildStandaloneReportHtml(payload: HtmlReportPayload): string {
  const json = serializeForInlineScript(payload)

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(payload.title)} - ${escapeHtmlText(payload.entityName)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #647084;
      --line: #d9e0ea;
      --soft: #f4f6fa;
      --paper: #ffffff;
      --navy: #20265a;
      --orange: #d8a128;
      --blue: #416faf;
      --green: #236a45;
      --danger: #9b4a1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f6fa;
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      letter-spacing: 0;
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      border-top: 3px solid #21bfc5;
      background: rgba(255,255,255,.96);
      padding: 12px 18px;
      backdrop-filter: blur(8px);
    }
    .toolbar-brand { display: flex; min-width: 0; align-items: center; gap: 10px; }
    .toolbar-logo { width: 150px; height: auto; }
    .toolbar small { display: block; color: var(--muted); }
    .toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 34px;
      border: 1px solid var(--navy);
      border-radius: 6px;
      background: var(--navy);
      color: #fff;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
    }
    .btn.secondary { background: #fff; color: var(--navy); }
    .btn.ghost { border-color: var(--line); background: #fff; color: var(--muted); }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 20px; }
    .report { overflow: hidden; border: 1px solid #cfd6e3; border-radius: 6px; background: var(--paper); box-shadow: 0 12px 34px rgba(32,38,90,.09); }
    .report-head { position: relative; display: grid; grid-template-columns: 190px minmax(0,1fr) 190px; min-height: 82px; align-items: center; gap: 18px; border-bottom: 1px solid var(--line); padding: 14px 22px; text-align: center; }
    .report-head::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg,#45d0d4 0 38%,#4a3191 38% 76%,#d8a128 76% 100%); }
    .report-head-logo { display: block; width: 180px; max-width: 100%; height: auto; }
    .report-head-copy { min-width: 0; }
    .report-head-meta { color: var(--muted); font-size: 10px; line-height: 1.5; text-align: right; }
    .report-head-meta strong { display: block; color: #4a3191; text-transform: uppercase; }
    .eyebrow { margin: 0 0 4px; color: #6f7885; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    h1 { margin: 0; color: #303746; font-size: 30px; line-height: 1.12; overflow-wrap: anywhere; }
    h2 { margin: 0 0 14px; color: var(--navy); font-size: 18px; }
    h3 { margin: 0 0 12px; color: var(--navy); font-size: 14px; }
    .shell { display: grid; grid-template-columns: 230px minmax(0,1fr); }
    .side { background: var(--navy); color: #fff; padding: 20px 16px; }
    .side-intro { margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.16); padding-bottom: 12px; color: rgba(185,247,246,.78); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .brand-mark { color: var(--navy); font-size: 25px; font-weight: 900; }
    .side-kpis { display: grid; gap: 14px; }
    .side-kpi { border-bottom: 1px solid rgba(255,255,255,.16); color: #fff; padding: 13px 2px; text-align: left; }
    .side-kpi:last-child { border-bottom: 0; }
    .side-kpi-label { color: rgba(185,247,246,.68); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; overflow-wrap: anywhere; }
    .side-kpi-value { margin-top: 8px; font-size: 25px; font-weight: 800; line-height: 1.12; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .side-kpi-muted { margin-top: 4px; color: rgba(255,255,255,.66); font-size: 10px; line-height: 1.2; overflow-wrap: anywhere; }
    .side-meta { margin-top: 20px; border-top: 1px solid rgba(255,255,255,.16); padding-top: 14px; color: rgba(255,255,255,.72); font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
    .side-meta strong { display: block; color: rgba(255,255,255,.94); text-transform: uppercase; }
    .main { min-width: 0; }
    .top-kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); background: var(--navy); color: #fff; }
    .top-kpi { min-height: 78px; border-right: 1px solid rgba(255,255,255,.28); padding: 15px 18px; }
    .top-kpi:last-child { border-right: 0; }
    .top-kpi-label { color: rgba(255,255,255,.75); font-size: 11px; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
    .top-kpi-value { margin-top: 8px; font-size: 20px; font-weight: 800; line-height: 1.12; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .highlight { color: #e0b64a; }
    .content { padding: 26px 32px; }
    .summary-grid { display: grid; grid-template-columns: minmax(0,1fr) 270px; gap: 34px; }
    .category-chart { position: relative; display: flex; height: 194px; min-width: 440px; align-items: stretch; justify-content: space-around; gap: 10px; padding: 0 10px; overflow-x: auto; overflow-y: hidden; }
    .category-chart::before { content: ""; position: absolute; z-index: 0; top: 152px; right: 10px; left: 10px; border-top: 1px solid var(--line); pointer-events: none; }
    .cat-btn { position: relative; z-index: 1; display: grid; width: auto; min-width: 104px; height: 194px; flex: 1; grid-template-rows: 26px 126px 42px; align-items: stretch; border: 0; border-radius: 4px; background: transparent; padding: 0 4px; color: inherit; }
    .cat-btn:hover, .cat-btn.active { background: #f5f7fa; outline: 1px solid rgba(51,62,80,.18); }
    .cat-value-slot { display: flex; min-width: 0; align-items: flex-end; justify-content: center; padding-bottom: 3px; }
    .cat-value { white-space: nowrap; font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .cat-plot { display: flex; min-height: 0; align-items: flex-end; justify-content: center; }
    .cat-bar { width: 64px; border-radius: 3px 3px 0 0; }
    .cat-label { display: flex; min-width: 0; align-items: flex-start; justify-content: center; margin: 0; padding: 7px 3px 0; color: #707682; font-size: 11px; font-weight: 700; line-height: 1.2; text-align: center; overflow-wrap: anywhere; }
    .quick { border: 1px solid var(--line); border-radius: 6px; background: #f8fafc; padding: 18px; }
    .metric-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e1e6ee; padding: 10px 0; color: var(--muted); font-size: 12px; }
    .metric-line:last-child { border-bottom: 0; }
    .metric-line span { min-width: 0; line-height: 1.2; overflow-wrap: anywhere; }
    .metric-line strong { max-width: 62%; color: var(--navy); font-size: 14px; line-height: 1.2; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .lower-grid { display: grid; grid-template-columns: minmax(0,1fr) 290px; gap: 34px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--line); padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: var(--navy); color: #fff; font-size: 11px; }
    td { font-size: 11px; }
    .category-table { min-width: 640px; }
    .category-table th { border: 0; background: #fff; color: var(--navy); font-size: 13px; }
    .category-table td { border-color: #fff; font-size: 14px; }
    .cell-soft { background: #f1f3f6; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .pct-pill { min-width: 62px; border: 0; color: #fff; padding: 5px 9px; font-weight: 800; }
    .donut { width: 172px; height: 172px; border-radius: 50%; margin: 0 auto; position: relative; background: #e6ebf1; }
    .donut::after { content: ""; position: absolute; inset: 42px; border-radius: 50%; background: #fff; }
    .donut-center { position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; text-align: center; font-weight: 800; color: var(--navy); }
    .legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 14px; font-size: 11px; }
    .legend button { display: flex; min-width: 0; align-items: center; gap: 6px; border: 0; border-radius: 4px; background: transparent; color: #535b67; text-align: left; }
    .legend button:hover { background: #f1f4f8; }
    .legend button span:last-child { min-width: 0; line-height: 1.2; overflow-wrap: anywhere; }
    .dot { width: 11px; height: 11px; border-radius: 3px; flex: 0 0 auto; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .card { border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 14px; }
    .mini-kpi { border: 1px solid var(--line); background: #f8fafc; padding: 13px; }
    .mini-kpi-label { color: #6f7885; font-size: 10px; font-weight: 800; line-height: 1.2; text-transform: uppercase; overflow-wrap: anywhere; }
    .mini-kpi-value { margin-top: 5px; color: var(--navy); font-size: 19px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .tabs, .filters, .modebar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
    .tabs button, .modebar button, .chip-btn { border: 1px solid var(--line); border-radius: 6px; background: #f1f4f8; color: #535d6b; padding: 8px 11px; font-size: 12px; font-weight: 800; }
    .tabs button.active, .modebar button.active { border-color: var(--navy); background: var(--navy); color: #fff; }
    .panel { display: none; }
    .panel.active { display: block; }
    .section { margin-top: 20px; border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 16px; }
    .insights { margin: 0; padding-left: 18px; color: #4e5763; font-size: 13px; line-height: 1.55; }
    .bar-list { display: grid; gap: 12px; }
    .bar-row { display: block; width: 100%; border: 0; border-radius: 6px; background: transparent; padding: 4px; text-align: left; }
    .bar-row:hover { background: #fff; outline: 1px solid var(--line); }
    .bar-head { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: start; gap: 12px; margin-bottom: 5px; color: var(--navy); font-size: 12px; font-weight: 800; }
    .bar-head span { min-width: 0; line-height: 1.2; overflow-wrap: anywhere; }
    .bar-head strong { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .bar-track { height: 26px; border-radius: 5px; background: #fff; box-shadow: inset 0 0 0 1px #e8edf3; }
    .bar-fill { display: flex; height: 26px; align-items: center; justify-content: flex-end; min-width: 28px; border-radius: 5px; background: var(--blue); padding: 0 8px; color: #fff; font-size: 10px; font-weight: 800; }
    .bar-sub { margin-top: 4px; color: var(--muted); font-size: 10px; }
    .grid-2 { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(280px,.8fr); gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
    .ranking-item { display: block; width: 100%; border: 0; border-bottom: 1px solid #e1e6ee; background: transparent; padding: 8px 0; text-align: left; }
    .ranking-item:hover { background: #eef2f6; }
    .ranking-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; font-size: 12px; font-weight: 800; color: var(--navy); }
    .ranking-line span:first-child { min-width: 0; line-height: 1.2; overflow-wrap: anywhere; }
    .ranking-line span:last-child { flex: 0 0 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ranking-sub { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; margin-top: 4px; color: var(--muted); font-size: 10px; }
    .filters input, .filters select {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 7px 10px;
      font-size: 12px;
    }
    .filters input { min-width: 280px; flex: 1; }
    .active-filter { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--line); border-radius: 6px; background: #f8fafc; padding: 10px; color: var(--muted); font-size: 12px; }
    .chip { border-radius: 999px; background: #fff; padding: 5px 9px; color: var(--navy); font-weight: 800; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }
    .detail-table { min-width: 1120px; }
    .detail-table tbody tr:nth-child(even) { background: #f6f8fb; }
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; color: var(--muted); font-size: 12px; }
    .empty { border: 1px dashed #cbd3df; border-radius: 6px; background: #f8fafc; padding: 22px; color: var(--muted); text-align: center; }
    .footer { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px; color: #6d7682; font-size: 10px; text-align: center; }
    @media (max-width: 900px) {
      .wrap { padding: 12px; }
      .report-head { grid-template-columns: 1fr; gap: 8px; }
      .report-head-logo { margin: 0 auto; }
      .report-head-meta { display: none; }
      .shell, .summary-grid, .lower-grid, .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
      .top-kpis, .cards { grid-template-columns: 1fr 1fr; }
      h1 { font-size: 24px; }
    }
    @media print {
      .toolbar, .tabs, .filters, .modebar, .pager, .active-filter { display: none !important; }
      body { background: #fff; }
      .wrap { max-width: none; padding: 0; }
      .report, .section { box-shadow: none; break-inside: avoid; }
      .panel { display: block; margin-top: 18px; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-brand">
      ${payload.brandLogoDataUrl ? `<img class="toolbar-logo" src="${escapeHtmlText(payload.brandLogoDataUrl)}" alt="BBT Corporativo">` : ''}
      <div><strong>BBT Corporativo</strong>
      <small>Arquivo HTML interativo gerado em ${escapeHtmlText(new Date(payload.generatedAt).toLocaleString('pt-BR'))}</small></div>
    </div>
    <div class="toolbar-actions">
      <button class="btn secondary" id="btn-print" type="button">Imprimir / PDF</button>
      <button class="btn secondary" id="btn-csv" type="button">CSV filtrado</button>
    </div>
  </div>
  <div id="app" class="wrap">
    <div class="empty">Carregando relatório interativo...</div>
  </div>
  <script id="bbt-report-data" type="application/json">${json}</script>
  <script>
${STANDALONE_REPORT_SCRIPT}
  </script>
</body>
</html>`
}

const STANDALONE_REPORT_SCRIPT = String.raw`(function () {
  var data = JSON.parse(document.getElementById("bbt-report-data").textContent || "{}");
  var app = document.getElementById("app");
  var state = {
    activeTab: data.initialState && data.initialState.activeTab || "resumo",
    query: data.initialState && data.initialState.detailQuery || "",
    type: data.initialState && data.initialState.detailType || "todos",
    status: data.initialState && data.initialState.detailStatus || "todos",
    company: data.initialState && data.initialState.detailCompany || "todos",
    focus: data.initialState && data.initialState.detailFocus || null,
    operationalMode: data.initialState && data.initialState.operationalMode || "graficos",
    operationalChart: data.initialState && data.initialState.operationalChart || "servico",
    page: 1,
    pageSize: 30
  };

  var categoryColors = {
    "Aéreo": "#B8662B",
    ["A\u00c3\u00a9reo"]: "#B8662B",
    "Hotel": "#828282",
    "Carro": "#5F7F3D",
    "Pacote": "#4D78B2",
    "Outro": "#40599B"
  };

  document.getElementById("btn-print").addEventListener("click", function () { window.print(); });
  document.getElementById("btn-csv").addEventListener("click", exportCsv);

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
  }

  function money(value) {
    var number = Number(value || 0);
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function dateBR(value) {
    if (!value) return "-";
    var text = String(value).slice(0, 10);
    var parts = text.split("-");
    if (parts.length !== 3) return esc(value);
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function kg(value) {
    var number = Number(value || 0);
    if (!number) return "0 kg";
    return number >= 1000 ? (number / 1000).toFixed(2) + " t" : number.toFixed(1) + " kg";
  }

  function categoryLabel(tipo) {
    return data.categoryLabels && data.categoryLabels[tipo] || tipo || "-";
  }

  function categoryColor(tipo) {
    return categoryColors[tipo] || "#40599B";
  }

  function statusLabel(status) {
    return data.statusLabels && data.statusLabels[status] || status || "-";
  }

  function paymentLabel(value) {
    return data.paymentLabels && data.paymentLabels[value] || value || "-";
  }

  function referenceLabel(value) {
    if (value === "cotacao_original") return "Cotacao";
    if (value === "preco_sem_agencia") return "Preco sem agencia";
    if (value === "tarifa_publica") return "Tarifa publica";
    if (value === "contrato") return "Contrato";
    if (value === "outro") return "Outro comparativo";
    if (value === "benchmark_rota") return "Benchmark rota";
    if (value === "benchmark_categoria") return "Benchmark tipo";
    return "-";
  }

  function dayName(value) {
    if (!value) return "Sem data";
    var date = new Date(String(value).slice(0, 10) + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "Sem data";
    return ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"][date.getDay()];
  }

  function bucketAntecedencia(value) {
    if (value == null || !Number.isFinite(Number(value))) return "Sem data";
    var number = Number(value);
    if (number < 0) return "Pos viagem";
    if (number <= 2) return "0-2 dias";
    if (number <= 7) return "3-7 dias";
    if (number <= 14) return "8-14 dias";
    if (number <= 30) return "15-30 dias";
    return "31+ dias";
  }

  function matchesFocus(row) {
    if (!state.focus || !state.focus.value) return true;
    var value = normalize(state.focus.value);
    if (!value) return true;
    switch (state.focus.kind) {
      case "empresa": return normalize(row.empresa) === value;
      case "rota": return [row.rota, row.destino, row.cidade].some(function (item) { return normalize(item) === value; });
      case "antecedencia": return normalize(bucketAntecedencia(row.antecedenciaDias)) === value;
      case "fornecedor": return normalize(row.fornecedor) === value;
      case "centro": return normalize(row.centroCusto || "Sem centro de custo") === value;
      case "cidade": return [row.cidade, row.destino].some(function (item) { return normalize(item) === value; });
      case "passageiro": return normalize(row.passageiro) === value || normalize(row.passageiroChave) === value;
      case "companhia": return [row.companhia, row.fornecedor].some(function (item) { return normalize(item) === value; });
      case "produto": return [row.produto, row.servicoResumo].some(function (item) { return normalize(item) === value; });
      default: return true;
    }
  }

  function filteredRows() {
    var query = normalize(state.query);
    return (data.details || []).filter(function (row) {
      if (state.type !== "todos" && row.tipo !== state.type) return false;
      if (state.status !== "todos" && row.status !== state.status) return false;
      if (state.company !== "todos" && row.empresa !== state.company) return false;
      if (!matchesFocus(row)) return false;
      if (!query) return true;
      return [
        row.passageiro,
        row.funcionarioCodigo,
        row.nomeInformadoNaReserva,
        row.empresa,
        row.localizador,
        row.centroCusto,
        row.fornecedor,
        row.destino,
        row.solicitante,
        row.rota,
        row.cidade,
        row.produto,
        row.servicoResumo
      ].some(function (item) { return normalize(item).indexOf(query) >= 0; });
    });
  }

  function computeMetrics(rows) {
    var categories = {};
    Object.keys(data.categoryLabels || {}).forEach(function (tipo) {
      categories[tipo] = { tipo: tipo, quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 };
    });
    var statuses = {};
    Object.keys(data.statusLabels || {}).forEach(function (status) { statuses[status] = 0; });
    var custoTotal = 0;
    var vendaTotal = 0;
    var markupTotal = 0;
    var taxaTotal = 0;
    var faturadoTotal = 0;
    var valorReferenciaTotal = 0;
    var economiaTotal = 0;
    var oportunidadeTotal = 0;
    var economiaCotacao = 0;
    var economiaBenchmark = 0;
    var itensComparados = 0;
    var viajantes = {};

    rows.forEach(function (row) {
      var amount = Number(row.total || 0);
      if (statuses[row.status] != null) statuses[row.status] += 1;
      if (!categories[row.tipo]) categories[row.tipo] = { tipo: row.tipo, quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 };
      categories[row.tipo].quantidade += 1;
      categories[row.tipo].custo += Number(row.custo || 0);
      categories[row.tipo].venda += Number(row.venda || 0);
      categories[row.tipo].markup += Number(row.markup || 0);
      categories[row.tipo].taxa += Number(row.taxa || 0);
      categories[row.tipo].faturado += amount;
      custoTotal += Number(row.custo || 0);
      vendaTotal += Number(row.venda || 0);
      markupTotal += Number(row.markup || 0);
      taxaTotal += Number(row.taxa || 0);
      faturadoTotal += amount;
      valorReferenciaTotal += Number(row.valorReferencia || 0);
      economiaTotal += Number(row.economia || 0);
      oportunidadeTotal += Number(row.oportunidadeEconomia || 0);
      if (Number(row.valorReferencia || 0) > 0) itensComparados += 1;
      if (Number(row.economia || 0) > 0 && row.referenciaFonte !== "benchmark_rota" && row.referenciaFonte !== "benchmark_categoria" && row.referenciaFonte !== "sem_referencia") economiaCotacao += Number(row.economia || 0);
      if (Number(row.economia || 0) > 0 && (row.referenciaFonte === "benchmark_rota" || row.referenciaFonte === "benchmark_categoria")) economiaBenchmark += Number(row.economia || 0);
      var passenger = row.passageiroChave || normalize(row.passageiro);
      if (passenger) viajantes[passenger] = true;
    });

    return {
      totalDemandas: rows.length,
      totalViajantes: Object.keys(viajantes).length,
      totalDias: data.totalDias || 0,
      statuses: statuses,
      categories: Object.keys(categories).map(function (key) { return categories[key]; }),
      custoTotal: custoTotal,
      vendaTotal: vendaTotal,
      markupTotal: markupTotal,
      taxaTotal: taxaTotal,
      faturadoTotal: faturadoTotal,
      margemMediaPct: vendaTotal > 0 ? (markupTotal / vendaTotal) * 100 : 0,
      economia: {
        valorReferenciaTotal: valorReferenciaTotal,
        valorFinalTotal: faturadoTotal,
        economiaTotal: economiaTotal,
        economiaCotacao: economiaCotacao,
        economiaBenchmark: economiaBenchmark,
        oportunidadeTotal: oportunidadeTotal,
        percentualEconomia: valorReferenciaTotal > 0 ? (economiaTotal / valorReferenciaTotal) * 100 : 0,
        itensComparados: itensComparados
      }
    };
  }

  function rank(rows, getName, getKey) {
    var map = {};
    rows.forEach(function (row) {
      var nome = String(getName(row) || "-").trim() || "-";
      var key = String((getKey ? getKey(row) : nome) || nome).trim() || nome;
      if (!map[key]) map[key] = { nome: nome, quantidade: 0, total: 0, economia: 0, oportunidade: 0 };
      map[key].quantidade += 1;
      map[key].total += Number(row.total || 0);
      map[key].economia += Number(row.economia || 0);
      map[key].oportunidade += Number(row.oportunidadeEconomia || 0);
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) { return b.total - a.total; });
  }

  function serviceRows(rows, names) {
    return rows.filter(function (row) {
      var tipo = normalize(row.tipo);
      var label = normalize(categoryLabel(row.tipo));
      return names.some(function (name) { return tipo === normalize(name) || label === normalize(name); });
    });
  }

  function operational(rows) {
    var aereo = serviceRows(rows, ["aereo"]);
    var hotel = serviceRows(rows, ["hotel", "hospedagem"]);
    var carro = serviceRows(rows, ["carro", "transporte"]);
    var outros = serviceRows(rows, ["pacote", "outro", "outros"]);
    return {
      porEmpresa: rank(rows, function (row) { return row.empresa || "Sem empresa"; }),
      porServico: rank(rows, function (row) { return categoryLabel(row.tipo); }),
      porCentroCusto: rank(rows, function (row) { return row.centroCusto || "Sem centro de custo"; }),
      porCidade: rank(rows, function (row) { return row.cidade || row.destino || "-"; }),
      porRota: rank(rows, function (row) { return row.rota || row.destino || "-"; }),
      porFornecedor: rank(rows, function (row) { return row.fornecedor || "-"; }),
      porDiaSemana: rank(rows, function (row) { return dayName(row.data); }),
      porAntecedencia: rank(rows, function (row) { return bucketAntecedencia(row.antecedenciaDias); }),
      aereo: {
        topRotas: rank(aereo, function (row) { return row.rota || row.destino || "-"; }),
        topCompanhias: rank(aereo, function (row) { return row.companhia || row.fornecedor || "-"; }),
        topPassageiros: rank(aereo, function (row) { return row.passageiro || "-"; }, function (row) { return row.passageiroChave || row.passageiro || "-"; })
      },
      hotel: {
        topHoteis: rank(hotel, function (row) { return row.fornecedor || "-"; }),
        topHospedes: rank(hotel, function (row) { return row.passageiro || "-"; }, function (row) { return row.passageiroChave || row.passageiro || "-"; }),
        topCidades: rank(hotel, function (row) { return row.cidade || row.destino || "-"; })
      },
      carro: {
        topLocadoras: rank(carro, function (row) { return row.fornecedor || "-"; }),
        diariaPorDiaSemana: rank(carro, function (row) { return dayName(row.data); }),
        antecedencia: rank(carro, function (row) { return bucketAntecedencia(row.antecedenciaDias); })
      },
      outros: {
        topProdutos: rank(outros, function (row) { return row.produto || row.servicoResumo || row.tipo; }),
        topPassageiros: rank(outros, function (row) { return row.passageiro || "-"; }, function (row) { return row.passageiroChave || row.passageiro || "-"; }),
        topCidades: rank(outros, function (row) { return row.cidade || row.destino || "-"; })
      }
    };
  }

  function setFocus(kind, value, label) {
    state.query = "";
    state.status = "todos";
    state.company = "todos";
    state.focus = null;
    if (kind === "servico") {
      state.type = tipoFromRankingName(value) || "todos";
    } else {
      state.type = "todos";
      if (kind === "empresa" && companyOptions().indexOf(value) >= 0) {
        state.company = value;
      } else {
        state.focus = { kind: kind, value: value, label: label || value };
      }
    }
    state.activeTab = "detalhes";
    state.page = 1;
    render();
  }

  function tipoFromRankingName(value) {
    var normalized = normalize(value);
    var keys = Object.keys(data.categoryLabels || {});
    for (var i = 0; i < keys.length; i += 1) {
      if (normalize(keys[i]) === normalized || normalize(data.categoryLabels[keys[i]]) === normalized) return keys[i];
    }
    return null;
  }

  function companyOptions() {
    var found = {};
    (data.details || []).forEach(function (row) { if (row.empresa) found[row.empresa] = true; });
    return Object.keys(found).sort();
  }

  function hasFilters() {
    return Boolean(state.query || state.type !== "todos" || state.status !== "todos" || state.company !== "todos" || state.focus);
  }

  function resetFilters() {
    state.query = "";
    state.type = "todos";
    state.status = "todos";
    state.company = "todos";
    state.focus = null;
    state.page = 1;
    render();
  }

  function filterHtml(totalRows, filteredTotal) {
    if (!hasFilters()) return "";
    var chips = [];
    if (state.type !== "todos") chips.push("Categoria: " + categoryLabel(state.type));
    if (state.status !== "todos") chips.push("Status: " + statusLabel(state.status));
    if (state.company !== "todos") chips.push("Empresa: " + state.company);
    if (state.query) chips.push("Busca: " + state.query);
    if (state.focus) chips.push(state.focus.label);
    return '<div class="active-filter"><div><strong>Filtro ativo:</strong> ' +
      chips.map(function (chip) { return '<span class="chip">' + esc(chip) + '</span>'; }).join(" ") +
      ' <span>' + filteredTotal + ' de ' + totalRows + ' demanda(s)</span></div>' +
      '<button class="btn secondary" id="clear-filters" type="button">Limpar filtros</button></div>';
  }

  function sideKpi(label, value, muted) {
    return '<div class="side-kpi"><div class="side-kpi-label">' + esc(label) + '</div><div class="side-kpi-value">' + esc(value) + '</div>' +
      (muted ? '<div class="side-kpi-muted">' + esc(muted) + '</div>' : '') + '</div>';
  }

  function miniKpi(label, value, tone) {
    return '<div class="mini-kpi"><div class="mini-kpi-label">' + esc(label) + '</div><div class="mini-kpi-value" style="color:' + esc(tone || "#333e50") + '">' + esc(value) + '</div></div>';
  }

  function metricLine(label, value) {
    return '<div class="metric-line"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function renderSummary(rows, metrics) {
    var displayRows = metrics.categories.filter(function (row) { return row.quantidade > 0 || row.faturado > 0; }).map(function (row) {
      row.label = categoryLabel(row.tipo);
      row.color = categoryColor(row.tipo);
      row.percent = metrics.faturadoTotal > 0 ? row.faturado / metrics.faturadoTotal * 100 : 0;
      row.perDay = data.totalDias > 0 ? row.faturado / data.totalDias : 0;
      row.perTraveler = metrics.totalViajantes > 0 ? row.faturado / metrics.totalViajantes : 0;
      return row;
    });
    var max = Math.max.apply(Math, [1].concat(displayRows.map(function (row) { return row.faturado; })));
    var bars = displayRows.map(function (row) {
      var height = Math.max(12, Math.round(row.faturado / max * 118));
      var active = state.type === row.tipo;
      return '<button class="cat-btn ' + (active ? 'active' : '') + '" data-category="' + esc(row.tipo) + '" type="button">' +
        '<div class="cat-value-slot"><div class="cat-value" style="color:' + esc(row.color) + '">' + money(row.faturado) + '</div></div>' +
        '<div class="cat-plot"><div class="cat-bar" style="height:' + height + 'px;background:' + esc(row.color) + '"></div></div>' +
        '<div class="cat-label">' + esc(row.label) + '</div></button>';
    }).join("");

    var donutGradient = displayRows.length ? buildDonutGradient(displayRows) : "#e6ebf1";
    var table = '<table class="category-table"><thead><tr><th>Categoria</th><th style="text-align:right">%</th><th style="text-align:right">Gasto R$</th><th style="text-align:right">Por dia</th><th style="text-align:right">Por pessoa</th></tr></thead><tbody>' +
      displayRows.map(function (row) {
        return '<tr><td><button class="chip-btn" data-category="' + esc(row.tipo) + '" type="button">' + esc(row.label) + '</button></td>' +
          '<td style="text-align:right"><button class="pct-pill" data-category="' + esc(row.tipo) + '" type="button" style="background:' + esc(row.color) + '">' + row.percent.toFixed(0) + '%</button></td>' +
          '<td class="cell-soft">' + money(row.faturado) + '</td><td class="cell-soft">' + money(row.perDay) + '</td><td class="cell-soft">' + money(row.perTraveler) + '</td></tr>';
      }).join("") +
      '<tr><td><strong>Total R$</strong></td><td style="text-align:right"><strong>100%</strong></td><td style="text-align:right"><strong>' + money(metrics.faturadoTotal) + '</strong></td><td></td><td></td></tr></tbody></table>';

    var legend = displayRows.map(function (row) {
      return '<button data-category="' + esc(row.tipo) + '" type="button"><span class="dot" style="background:' + esc(row.color) + '"></span><span>' + esc(row.label) + ' ' + row.percent.toFixed(0) + '%</span></button>';
    }).join("");

    return '<div class="report"><header class="report-head">' +
      (data.brandLogoDataUrl ? '<img class="report-head-logo" src="' + esc(data.brandLogoDataUrl) + '" alt="BBT Corporativo">' : '<div class="brand-mark">BBT</div>') +
      '<div class="report-head-copy"><p class="eyebrow">' + esc(data.eyebrow) + '</p><h1>' + esc(data.title) + '</h1></div>' +
      '<div class="report-head-meta"><strong>Relatório corporativo</strong><span>' + dateBR(data.periodStart) + ' a ' + dateBR(data.periodEnd) + '</span></div></header>' +
      '<div class="shell"><aside class="side"><div class="side-intro">Resumo executivo</div><div class="side-kpis">' +
      (data.isAgency
        ? sideKpi("Total faturado", money(metrics.faturadoTotal)) + sideKpi("Custo operacional", money(metrics.custoTotal)) + sideKpi("Resultado BBT", money(metrics.markupTotal + metrics.taxaTotal), "Margem " + metrics.margemMediaPct.toFixed(1) + "%")
        : sideKpi("Valor final do período", money(metrics.faturadoTotal)) + sideKpi("Demandas atendidas", String(metrics.totalDemandas)) + sideKpi("Economia registrada", money(metrics.economia.economiaTotal), metrics.economia.itensComparados ? metrics.economia.percentualEconomia.toFixed(1) + "% sobre valores comparados" : "Sem referência comparável")
      ) + '</div><div class="side-meta"><strong>' + esc(data.entityName) + '</strong>' +
      (data.entityMeta || []).map(function (line) { return '<div>' + esc(line) + '</div>'; }).join("") +
      '<div style="margin-top:10px">Periodo: ' + dateBR(data.periodStart) + ' a ' + dateBR(data.periodEnd) + '</div><div>Emitido em ' + esc(data.issuedAt) + '</div></div></aside>' +
      '<main class="main"><section class="top-kpis"><div class="top-kpi"><div class="top-kpi-label">Viajantes</div><div class="top-kpi-value">' + metrics.totalViajantes + '</div></div>' +
      '<div class="top-kpi"><div class="top-kpi-label">Quantidade de dias</div><div class="top-kpi-value">' + esc(data.totalDias) + '</div></div>' +
      '<div class="top-kpi"><div class="top-kpi-label">' + (data.isAgency ? 'Faturado por pessoa' : 'Valor por pessoa') + '</div><div class="top-kpi-value">' + money(metrics.totalViajantes > 0 ? metrics.faturadoTotal / metrics.totalViajantes : 0) + '</div></div>' +
      '<div class="top-kpi"><div class="top-kpi-label highlight">Total por demanda</div><div class="top-kpi-value highlight">' + money(metrics.totalDemandas > 0 ? metrics.faturadoTotal / metrics.totalDemandas : 0) + '</div></div></section>' +
      '<section class="content"><div class="summary-grid"><div><h2 style="text-align:center">Total de gastos por categoria</h2><div class="category-chart">' + (bars || '<div class="empty">Nenhuma despesa no período.</div>') + '</div></div>' +
      '<div class="quick"><h3>Indicadores rápidos</h3>' + metricLine("Demandas", String(metrics.totalDemandas)) + metricLine("Gasto por dia", money(data.totalDias > 0 ? metrics.faturadoTotal / data.totalDias : 0)) + metricLine(data.isAgency ? "Venda total" : "Valor final", money(metrics.faturadoTotal)) + (data.isAgency ? metricLine("Taxas", money(metrics.taxaTotal)) : metricLine("Economia", money(metrics.economia.economiaTotal))) + '</div></div>' +
      '<div class="lower-grid"><div class="table-wrap">' + table + '</div><div><h3 style="text-align:center">% de gastos por categoria</h3><div class="donut" style="background:' + esc(donutGradient) + '"><div class="donut-center"><div><small>Total</small><br>100%</div></div></div><div class="legend">' + legend + '</div></div></div>' +
      '</section></main></div></div>';
  }

  function buildDonutGradient(rows) {
    var cursor = 0;
    var parts = rows.map(function (row) {
      var start = cursor;
      cursor += row.percent;
      return row.color + " " + start.toFixed(2) + "% " + cursor.toFixed(2) + "%";
    });
    return "conic-gradient(" + parts.join(", ") + ")";
  }

  function renderTabs() {
    var tabs = [
      ["resumo", "Análise executiva"],
      ["economia", "Economia"],
      ["governanca", "Governança"],
      ["servicos", "Operacional"],
      ["detalhes", "Base filtravel"]
    ];
    return '<div class="section"><div class="tabs">' + tabs.map(function (tab) {
      return '<button class="' + (state.activeTab === tab[0] ? 'active' : '') + '" data-tab="' + tab[0] + '" type="button">' + tab[1] + '</button>';
    }).join("") + '</div>';
  }

  function renderExecutive(rows, metrics, op) {
    var cobertura = metrics.totalDemandas > 0 ? metrics.economia.itensComparados / metrics.totalDemandas * 100 : 0;
    var mediaAntecedencia = average(rows.map(function (row) { return row.antecedenciaDias; }).filter(function (value) { return value != null && Number.isFinite(Number(value)); }));
    var co2 = rows.reduce(function (sum, row) { return sum + Number(row.co2Kg || 0); }, 0);
    var insights = [];
    if (metrics.economia.economiaTotal > 0) insights.push("Economia registrada de " + money(metrics.economia.economiaTotal) + " no período filtrado.");
    if (metrics.economia.oportunidadeTotal > 0) insights.push("Oportunidade adicional estimada de " + money(metrics.economia.oportunidadeTotal) + ".");
    if (mediaAntecedencia <= 3 && rows.length) insights.push("Antecedência média baixa: avaliar política de solicitação antecipada.");
    if (op.porCentroCusto.length) insights.push("Centro de custo com maior gasto: " + op.porCentroCusto[0].nome + " (" + money(op.porCentroCusto[0].total) + ").");
    if (!insights.length) insights.push("Sem alertas relevantes no período filtrado.");
    return '<div class="panel ' + (state.activeTab === "resumo" ? "active" : "") + '">' +
      '<h2>Análise executiva</h2><div class="cards">' + miniKpi("Base comparável", cobertura.toFixed(1) + "%") + miniKpi("Oportunidade", money(metrics.economia.oportunidadeTotal), "#9B4A1C") + miniKpi("Antecedência média", mediaAntecedencia.toFixed(1) + " dias") + miniKpi("CO2 estimado", kg(co2), "#236A45") + '</div>' +
      '<div class="grid-2" style="margin-top:14px"><div class="card"><h3>Sinais para decisão</h3><ul class="insights">' + insights.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ul></div>' +
      rankingCard("Tendência mensal", rank(rows, function (row) { return String(row.data || "").slice(0, 7) || "Sem data"; }), "rota", false) + '</div></div>';
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce(function (sum, value) { return sum + Number(value || 0); }, 0) / values.length;
  }

  function renderEconomy(metrics, op) {
    return '<div class="panel ' + (state.activeTab === "economia" ? "active" : "") + '">' +
      '<h2>Economia e oportunidades</h2><div class="cards">' + miniKpi("Economia total", money(metrics.economia.economiaTotal), "#236A45") + miniKpi("Economia comprovada", money(metrics.economia.economiaCotacao)) + miniKpi("Base comparável", money(metrics.economia.valorReferenciaTotal)) + miniKpi("Oportunidade", money(metrics.economia.oportunidadeTotal), "#9B4A1C") + '</div><p style="margin:8px 0 0;color:#66707d;font-size:11px;line-height:1.5">Economia registrada considera somente comparativos informados e auditáveis. Benchmark interno entra como oportunidade estimada, não como economia realizada.</p>' +
      '<div class="grid-3" style="margin-top:14px">' + rankingCard("Centros com maior gasto", op.porCentroCusto, "centro", true) + rankingCard("Viajantes com maior gasto", rank(filteredRows(), function (row) { return row.passageiro || "-"; }, function (row) { return row.passageiroChave || row.passageiro || "-"; }), "passageiro", true) + rankingCard("Fornecedores com maior gasto", op.porFornecedor, "fornecedor", true) + '</div></div>';
  }

  function renderGovernance(rows, metrics, op) {
    var withCentro = rows.filter(function (row) { return row.centroCusto; }).length;
    var withPayment = rows.filter(function (row) { return row.formaPagamento; }).length;
    var withSolicitante = rows.filter(function (row) { return row.solicitante; }).length;
    var urgent = rows.filter(function (row) { return Number(row.antecedenciaDias || 0) <= 2; }).length;
    return '<div class="panel ' + (state.activeTab === "governanca" ? "active" : "") + '">' +
      '<h2>Governança do programa</h2><div class="cards">' + miniKpi("Completude", completion(rows).toFixed(1) + "%") + miniKpi("Centro de custo", pct(withCentro, metrics.totalDemandas).toFixed(1) + "%") + miniKpi("Pagamento", pct(withPayment, metrics.totalDemandas).toFixed(1) + "%") + miniKpi("Solicitante", pct(withSolicitante, metrics.totalDemandas).toFixed(1) + "%") + '</div>' +
      '<div class="grid-2" style="margin-top:14px">' + rankingCard("Antecedência", op.porAntecedencia, "antecedencia", true) + '<div class="card"><h3>Sustentabilidade</h3><div class="mini-kpi-value" style="color:#236A45">' + kg(rows.reduce(function (sum, row) { return sum + Number(row.co2Kg || 0); }, 0)) + '</div><p style="color:#66707d;font-size:12px">Reservas urgentes: <strong>' + urgent + '</strong></p></div></div></div>';
  }

  function completion(rows) {
    if (!rows.length) return 0;
    var score = rows.reduce(function (sum, row) {
      return sum + (row.centroCusto ? 1 : 0) + (row.formaPagamento ? 1 : 0) + (row.solicitante ? 1 : 0) + (row.fornecedor ? 1 : 0);
    }, 0);
    return score / (rows.length * 4) * 100;
  }

  function pct(value, total) {
    return total > 0 ? value / total * 100 : 0;
  }

  function rankingCard(title, rows, kind, clickable) {
    var top = (rows || []).slice(0, 5);
    return '<div class="card"><h3>' + esc(title) + '</h3>' + (top.length ? top.map(function (row) {
      return '<button class="ranking-item" data-kind="' + esc(kind) + '" data-value="' + esc(row.nome) + '" data-label="' + esc(title + ": " + row.nome) + '" type="button" ' + (clickable ? '' : 'disabled') + '><div class="ranking-line"><span>' + esc(row.nome) + '</span><span>' + money(row.total) + '</span></div><div class="ranking-sub"><span>' + row.quantidade + ' demanda(s)</span><span>Eco. ' + money(row.economia) + '</span></div></button>';
    }).join("") : '<div class="empty">Sem dados.</div>') + '</div>';
  }

  function renderOperational(metrics, op) {
    var options = [
      { id: "servico", label: "Serviços", rows: op.porServico, kind: "servico" },
      { id: "empresa", label: "Empresas", rows: op.porEmpresa, kind: "empresa" },
      { id: "rota", label: "Rotas/destinos", rows: op.porRota, kind: "rota" },
      { id: "antecedencia", label: "Antecedência", rows: op.porAntecedencia, kind: "antecedencia" },
      { id: "fornecedor", label: "Fornecedores", rows: op.porFornecedor, kind: "fornecedor" },
      { id: "centro", label: "Centros de custo", rows: op.porCentroCusto, kind: "centro" }
    ];
    var current = options.filter(function (item) { return item.id === state.operationalChart; })[0] || options[0];
    return '<div class="panel ' + (state.activeTab === "servicos" ? "active" : "") + '">' +
      '<h2>Análise operacional por serviço</h2><div class="modebar">' +
      '<button class="' + (state.operationalMode === "graficos" ? "active" : "") + '" data-mode="graficos" type="button">Gráficos interativos</button>' +
      '<button class="' + (state.operationalMode === "detalhado" ? "active" : "") + '" data-mode="detalhado" type="button">Detalhado</button></div>' +
      (state.operationalMode === "graficos"
        ? '<div class="cards">' + miniKpi("Valor final", money(metrics.faturadoTotal)) + miniKpi("Ticket médio", money(metrics.totalDemandas > 0 ? metrics.faturadoTotal / metrics.totalDemandas : 0)) + miniKpi("Transações", String(metrics.totalDemandas)) + miniKpi("Economia", money(metrics.economia.economiaTotal), "#236A45") + '</div><div class="modebar" style="margin-top:14px">' + options.map(function (item) { return '<button class="' + (current.id === item.id ? 'active' : '') + '" data-op-chart="' + item.id + '" type="button">' + item.label + '</button>'; }).join("") + '</div><div class="grid-2">' + barChart(current.label, current.rows, current.kind, false) + '<div>' + barChart("Top fornecedores", op.porFornecedor, "fornecedor", true) + barChart("Centros de custo", op.porCentroCusto, "centro", true) + '</div></div>'
        : '<div class="grid-4">' + rankingCard("Custos por empresa", op.porEmpresa, "empresa", true) + rankingCard("Serviços mais usados", op.porServico, "servico", true) + rankingCard("Top rotas/destinos", op.porRota, "rota", true) + rankingCard("Antecedência", op.porAntecedencia, "antecedencia", true) + '</div><div class="grid-4" style="margin-top:14px">' + rankingCard("Aéreo", op.aereo.topRotas.concat(op.aereo.topCompanhias).slice(0,5), "rota", true) + rankingCard("Hotel", op.hotel.topHoteis.concat(op.hotel.topCidades).slice(0,5), "fornecedor", true) + rankingCard("Carro", op.carro.topLocadoras.concat(op.carro.antecedencia).slice(0,5), "fornecedor", true) + rankingCard("Outros e pacotes", op.outros.topProdutos.concat(op.outros.topCidades).slice(0,5), "produto", true) + '</div>'
      ) + '</div>';
  }

  function barChart(title, rows, kind, compact) {
    var top = (rows || []).slice(0, compact ? 5 : 8);
    var max = Math.max.apply(Math, [1].concat(top.map(function (row) { return row.total; })));
    return '<div class="card" style="' + (compact ? 'margin-bottom:14px' : '') + '"><h3>' + esc(title) + '</h3>' + (top.length ? '<div class="bar-list">' + top.map(function (row) {
      var width = Math.max(4, row.total / max * 100);
      return '<button class="bar-row" data-kind="' + esc(kind) + '" data-value="' + esc(row.nome) + '" data-label="' + esc(title + ": " + row.nome) + '" type="button"><div class="bar-head"><span>' + esc(row.nome) + '</span><span>' + money(row.total) + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + width.toFixed(2) + '%">' + (compact ? '' : row.quantidade + ' dem.') + '</div></div><div class="bar-sub">' + row.quantidade + ' demanda(s) - Eco. ' + money(row.economia) + '</div></button>';
    }).join("") + '</div>' : '<div class="empty">Sem dados.</div>') + '</div>';
  }

  function renderDetails(rows) {
    var companies = companyOptions();
    var pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * state.pageSize;
    var pageRows = rows.slice(start, start + state.pageSize);
    var categories = Object.keys(data.categoryLabels || {});
    var statuses = Object.keys(data.statusLabels || {});
    var headers = '<tr><th>Data</th><th>Passageiro</th>' + (data.detailCompanyColumn ? '<th>Empresa</th>' : '') + '<th>Categoria</th><th>Localizador</th><th>Fornecedor</th><th>Destino</th><th>Detalhe do serviço</th><th>Centro de custo</th><th>Pagamento</th><th>Status</th>' +
      (data.isAgency ? '<th>Custo</th><th>Venda</th><th>Markup</th><th>Taxa</th><th>Total</th>' : '<th>Valor de referência</th><th>Base</th><th>Economia</th><th>Valor final</th>') + '</tr>';
    var body = pageRows.map(function (row) {
      return '<tr><td>' + dateBR(row.data) + '</td><td><strong>' + esc(row.passageiro) + '</strong>' + (row.funcionarioCodigo ? '<br><small>ID ' + esc(row.funcionarioCodigo) + '</small>' : '') + (row.nomeInformadoNaReserva ? '<br><small>Informado: ' + esc(row.nomeInformadoNaReserva) + '</small>' : '') + '</td>' + (data.detailCompanyColumn ? '<td>' + esc(row.empresa || '-') + '</td>' : '') +
        '<td>' + esc(categoryLabel(row.tipo)) + '</td><td>' + esc(row.localizador || '-') + '</td><td>' + esc(row.fornecedor || '-') + '</td><td>' + esc(row.destino || '-') + '</td><td>' + esc(row.servicoResumo || '-') + '</td><td>' + esc(row.centroCusto || '-') + '</td><td>' + esc(row.formaPagamento ? paymentLabel(row.formaPagamento) : '-') + '</td><td>' + esc(statusLabel(row.status)) + '</td>' +
        (data.isAgency
          ? '<td>' + money(row.custo) + '</td><td>' + money(row.venda) + '</td><td>' + money(row.markup) + '</td><td>' + money(row.taxa) + '</td><td><strong>' + money(row.total) + '</strong></td>'
          : '<td>' + (row.valorReferencia > 0 ? money(row.valorReferencia) : '-') + '</td><td>' + esc(referenceLabel(row.referenciaFonte)) + '</td><td>' + (row.economia > 0 ? money(row.economia) : '-') + '</td><td><strong>' + money(row.total) + '</strong></td>'
        ) + '</tr>';
    }).join("");

    return '<div class="section"><h2>Base detalhada (' + rows.length + '/' + (data.details || []).length + ')</h2>' +
      '<div class="filters"><input id="filter-query" value="' + esc(state.query) + '" placeholder="Buscar passageiro, fornecedor, localizador, centro...">' +
      (data.detailCompanyColumn && companies.length ? '<select id="filter-company"><option value="todos">Todas as empresas</option>' + companies.map(function (empresa) { return '<option value="' + esc(empresa) + '" ' + (state.company === empresa ? 'selected' : '') + '>' + esc(empresa) + '</option>'; }).join("") + '</select>' : '') +
      '<select id="filter-type"><option value="todos">Todos os tipos</option>' + categories.map(function (tipo) { return '<option value="' + esc(tipo) + '" ' + (state.type === tipo ? 'selected' : '') + '>' + esc(categoryLabel(tipo)) + '</option>'; }).join("") + '</select>' +
      '<select id="filter-status"><option value="todos">Todos os status</option>' + statuses.map(function (status) { return '<option value="' + esc(status) + '" ' + (state.status === status ? 'selected' : '') + '>' + esc(statusLabel(status)) + '</option>'; }).join("") + '</select></div>' +
      (rows.length ? '<div class="table-wrap"><table class="detail-table"><thead>' + headers + '</thead><tbody>' + body + '</tbody></table></div>' : '<div class="empty">Nenhuma demanda no período selecionado.</div>') +
      (rows.length > state.pageSize ? '<div class="pager"><span>Exibindo ' + pageRows.length + ' de ' + rows.length + ' linhas filtradas.</span><div><button class="btn ghost" id="prev-page" type="button">Anterior</button> <strong>' + state.page + '/' + pageCount + '</strong> <button class="btn ghost" id="next-page" type="button">Próxima</button></div></div>' : '') +
      '<div class="footer">Relatório gerado automaticamente pelo sistema BBT Corporativo. Documento confidencial.</div></div>';
  }

  function render() {
    var rows = filteredRows();
    var metrics = computeMetrics(rows);
    var op = operational(rows);
    var html = filterHtml((data.details || []).length, rows.length) + renderSummary(rows, metrics) + renderTabs() + renderExecutive(rows, metrics, op) + renderEconomy(metrics, op) + renderGovernance(rows, metrics, op) + renderOperational(metrics, op) + '</div>' + renderDetails(rows);
    app.innerHTML = html;
    bind();
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (button) {
      button.addEventListener("click", function () { state.activeTab = button.getAttribute("data-tab"); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-category]"), function (button) {
      button.addEventListener("click", function () { state.type = button.getAttribute("data-category") || "todos"; state.focus = null; state.activeTab = "detalhes"; state.page = 1; render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-kind][data-value]"), function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        setFocus(button.getAttribute("data-kind"), button.getAttribute("data-value"), button.getAttribute("data-label"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (button) {
      button.addEventListener("click", function () { state.operationalMode = button.getAttribute("data-mode"); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-op-chart]"), function (button) {
      button.addEventListener("click", function () { state.operationalChart = button.getAttribute("data-op-chart"); render(); });
    });
    var clear = document.getElementById("clear-filters");
    if (clear) clear.addEventListener("click", resetFilters);
    var query = document.getElementById("filter-query");
    if (query) query.addEventListener("input", function () { state.query = query.value; state.page = 1; render(); });
    var company = document.getElementById("filter-company");
    if (company) company.addEventListener("change", function () { state.company = company.value; state.focus = null; state.page = 1; render(); });
    var type = document.getElementById("filter-type");
    if (type) type.addEventListener("change", function () { state.type = type.value; state.focus = null; state.page = 1; render(); });
    var status = document.getElementById("filter-status");
    if (status) status.addEventListener("change", function () { state.status = status.value; state.page = 1; render(); });
    var prev = document.getElementById("prev-page");
    if (prev) prev.addEventListener("click", function () { state.page = Math.max(1, state.page - 1); render(); });
    var next = document.getElementById("next-page");
    if (next) next.addEventListener("click", function () { state.page += 1; render(); });
  }

  function exportCsv() {
    var rows = filteredRows();
    var headers = ["Data", "ID funcionário", "Passageiro", "Nome informado"].concat(data.detailCompanyColumn ? ["Empresa"] : [], ["Categoria", "Localizador", "Fornecedor", "Destino", "Rota", "Centro de custo", "Pagamento", "Status", "Detalhe do serviço"], data.isAgency ? ["Custo", "Venda", "Markup", "Taxa", "Total"] : ["Valor referência", "Base", "Economia", "Valor final"]);
    function safe(value) {
      var text = String(value == null ? "" : value).replace(/[\r\n]+/g, " ");
      if (/^[\t\r ]*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }
    function n(value) { return Number(value || 0).toFixed(2).replace(".", ","); }
    var lines = rows.map(function (row) {
      return [row.data, row.funcionarioCodigo || "", row.passageiro, row.nomeInformadoNaReserva || ""].concat(data.detailCompanyColumn ? [row.empresa || ""] : [], [categoryLabel(row.tipo), row.localizador || "", row.fornecedor || "", row.destino || "", row.rota || "", row.centroCusto || "", row.formaPagamento ? paymentLabel(row.formaPagamento) : "", statusLabel(row.status), row.servicoResumo || ""], data.isAgency ? [n(row.custo), n(row.venda), n(row.markup), n(row.taxa), n(row.total)] : [row.valorReferencia > 0 ? n(row.valorReferencia) : "", referenceLabel(row.referenciaFonte), row.economia > 0 ? n(row.economia) : "", n(row.total)]);
    });
    var csv = "\uFEFF" + [headers].concat(lines).map(function (line) { return line.map(safe).join(";"); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "relatorio-bbt-filtrado.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  render();
})();`
