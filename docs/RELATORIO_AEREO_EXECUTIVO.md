# Relatorio aereo executivo

## Objetivo

Adicionar um novo modelo de relatorio inspirado no painel enviado como referencia, sem alterar o relatorio consolidado existente.

## Local da implementacao

- Rota nova: `/dashboard/relatorios/aereo`
- Rota externa: `/relatorios/aereo`
- Agregacao de dados: `lib/reporting/aereo-executivo.ts`
- Mapa: `components/reports/aereo-map.tsx`
- Componente reutilizavel: `components/reports/aereo-executivo-report.tsx`
- Acesso no menu: `lib/navigation.ts`
- Acesso pela central atual: botao `Modelo aereo` em `/dashboard/relatorios`
- Acesso pelos relatorios de cliente:
  - `/relatorios/empresa`
  - `/relatorios/grupo`
- Acesso pelo portal empresa/grupo: card `Relatorio aereo executivo` em `Relatorios corporativos`

## O que o relatorio entrega

- KPIs:
  - Custo total
  - Custo medio
  - Taxas
  - Transacoes
  - Viajantes
- Graficos interativos:
  - Evolucao mensal
  - Custo por empresa
  - Top companhias aereas
  - Tipo de trecho
  - Top rotas
- Mapa:
  - Aeroportos/cidades com intensidade por custo
  - Linhas entre origem e destino para principais rotas
- Tabela detalhada:
  - Data
  - Empresa
  - Passageiro
  - ID do funcionario
  - Companhia
  - Rota
  - Tipo de trecho
  - Localizador
  - Taxas
  - Total
- Exportacoes:
  - CSV detalhado
  - HTML executivo independente

## Regras de dados

- O relatorio considera atendimentos aereos normalizando `tipo_servico`, aceitando `Aéreo`, `Aereo` e variacoes de origem importada.
- O valor exibido e sempre o valor final de cliente:
  - `valor_venda`
  - fallback para `valor_final`
  - fallback para `valor_cotacao`
- Markup nao e exibido nesse modelo.
- Pessoas sao resolvidas pelo mecanismo atual de ID/alias via `resolverFuncionarioAtendimento`.
- Rotas usam IATA quando disponivel em `detalhes_aereo`, `observacoes` ou `wintour_dados`.

## Observacao

Esta implementacao foi feita em uma copia separada do projeto (`BDEX_RELATORIO_AEREO`) para preservar o `BDEXFINAL`.
