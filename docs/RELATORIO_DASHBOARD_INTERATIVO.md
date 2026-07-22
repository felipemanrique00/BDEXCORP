# Relatorio dashboard interativo

## Objetivo

Adicionar um modelo de dashboard executivo inspirado no HTML de referencia enviado, sem remover o relatorio consolidado atual e sem alterar o relatorio aereo executivo.

## Rotas

- Interna: `/dashboard/relatorios/dashboard`
- Externa: `/relatorios/dashboard`

## Integracoes

- Relatorios e BI:
  - Botao geral `Dashboard`
  - Botao `Dashboard` por empresa
  - Botao `Dashboard` por grupo/holding
- Relatorio de empresa:
  - Botao `Dashboard` no toolbar superior
- Relatorio de grupo:
  - Botao `Dashboard` no toolbar superior
- Portal empresa/grupo:
  - Card `Dashboard executivo` em `Relatorios corporativos`

## Arquivos principais

- Agregacao e regras: `lib/reporting/corporate-dashboard.ts`
- Tela reutilizavel: `components/reports/corporate-dashboard-report.tsx`
- Mapa SVG funcional: `components/reports/corporate-map-svg.tsx`
- Rota interna: `app/dashboard/relatorios/dashboard/page.tsx`
- Rota externa: `app/relatorios/dashboard/page.tsx`

## Funcionalidades

- Filtros:
  - Periodo
  - Empresa
  - Grupo
  - Categoria
  - Status
  - Mes
  - Busca livre
  - Clique em graficos, rankings e mapa
- Abas:
  - Painel
  - Consolidado
  - Analises
  - Detalhes
- Indicadores:
  - Custo total
  - Custo medio
  - Taxas
  - Transacoes
  - Viajantes
  - Economia
  - Oportunidade
  - CO2 estimado
- Graficos:
  - Evolucao mensal com meses preenchidos entre inicio e fim
  - Custo por empresa
  - Top fornecedores/cias/locadoras
  - Tipo de servico
  - Top rotas/destinos
- Mapa:
  - SVG offline do Brasil
  - Pontos proporcionais ao custo
  - Tooltip nativo
  - Clique no ponto filtra a cidade/aeroporto
- Exportacoes:
  - CSV filtrado
  - HTML standalone com KPIs, evolucao mensal, mapa e base detalhada

## Regras

- O valor exibido para cliente e sempre o valor final/faturado do atendimento.
- Markup nao aparece no dashboard de cliente.
- Pessoas continuam agrupadas pela resolucao de funcionario/ID existente em `montarLinhasDetalhe`.
- A evolucao mensal preenche todos os meses do intervalo selecionado, inclusive para relatorios de ano fechado.
