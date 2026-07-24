# Auditoria sênior e validação - 2026-07-14

## 1. Estado inicial

O projeto já compilava, mas a validação funcional encontrou riscos que os comandos estáticos não detectavam: store do navegador desatualizado após hidratação, grupos invisíveis, gravações concorrentes capazes de perder dados, regras de escopo distribuídas, telas com milhares de elementos renderizados e relatórios HTML sem tratamento móvel suficiente.

Escopo inspecionado: `app`, `components`, `lib`, `scripts`, `types`, configurações, rotas de API, persistência, autenticação, permissões, importações, vouchers, empresas/grupos, viajantes, hotéis, reconciliação e relatórios.

## 2. Causas raiz

- O storage remoto atualizava `localStorage` depois da montagem do Zustand, sem reidratar o store.
- A sincronização anterior podia escolher uma fotografia desatualizada e ressuscitar exclusões ou substituir registros concorrentes.
- A troca atômica do JSON local não repetia `rename` quando o Windows bloqueava o arquivo por alguns milissegundos.
- A leitura inválida do JSON retornava `{}`, o que poderia transformar uma falha de leitura em sobrescrita vazia.
- Regras de visibilidade externa não removiam todos os campos internos em um único limite de segurança.
- Listas de vouchers, viajantes e hotéis montavam centenas ou milhares de linhas e controles no DOM.
- Toolbars e estruturas do relatório tinham implementações repetidas e dimensões fixas.
- A associação de passageiros legados dependia excessivamente do nome informado na reserva.

## 3. Correções funcionais

- Hidratação centralizada em `lib/client-data-hydration.ts`, seguida de `persist.rehydrate()` antes de liberar login, dashboard e relatórios.
- Grupos/holdings voltaram a ser resolvidos pelo ID persistido e pelo escopo autorizado.
- Merge do storage passou a preservar registros concorrentes e marcadores de exclusão.
- Escrita local passou a sincronizar o temporário em disco e repetir apenas erros transitórios `EPERM`, `EACCES` e `EBUSY`.
- Erro de leitura/parsing agora interrompe a mutação; não é mais tratado como banco vazio.
- Viajantes mantêm código permanente, aliases manuais e associação por empresa; relatórios agrupam pelo ID quando disponível.
- Reconciliação permite vincular ocorrências órfãs ao viajante correto e aprender a variação do nome.
- Duplicidade de venda é avaliada dentro da empresa, evitando colisão entre clientes.
- Economia considera somente referência comparável explícita; valor de venda e taxa de serviço não são convertidos em economia.
- Exportações CSV neutralizam fórmulas e exportações HTML escapam dados inseridos em scripts.

## 4. Segurança

- Rotas sensíveis usam guarda de API, sessão, papel/permissão e limites de requisição.
- Leitura de JSON possui tamanho máximo; uploads/importações grandes falham de forma controlada.
- Senhas novas exigem no mínimo oito caracteres e o arquivo local persiste hashes.
- A visão da empresa é filtrada no servidor: custo, markup, observações internas, dados comerciais de hotel e contas a pagar não são entregues ao cliente.
- Vouchers, hotéis, usuários e configurações administrativas possuem restrições de mutação.
- Varredura por padrões de chaves privadas/OpenAI/Google não encontrou segredo real no código-fonte.

## 5. Desempenho e interface

- Cálculos agregados dos relatórios e dashboards foram memorizados.
- Vouchers: 811 registros permanecem acessíveis, com 50 por página.
- Viajantes: 3.681 registros permanecem acessíveis, com 100 por página.
- Hotéis: a tela caiu de aproximadamente 11.821 para 3.432 nós no DOM e de 191 para 50 linhas montadas por página.
- O layout reserva espaço inferior para o botão flutuante da BIA, evitando sobreposição com paginação e ações.
- `PageHero`, relatório consolidado, KPIs, tabelas e toolbars foram ajustados para desktop e celular sem remover informações.
- Filtros receberam nomes acessíveis e links externos usam `noopener,noreferrer`.

## 6. Relatórios

- Toolbar única em `app/relatorios/_components/report-toolbar.tsx` para grupo, empresa, viajante, centro de custo, agente, aéreo e dashboard.
- Relatório consolidado e complemento de BI respondem aos filtros sem recarregar a página.
- Dashboard HTML preserva filtros, abas, gráficos, rankings, evolução mensal, detalhamento e mapa Leaflet.
- O arquivo HTML autônomo recebeu regras específicas para telas de até 600 px.
- O mapa usa tiles reais e atribuição do provedor; exige internet quando o HTML é aberto fora do sistema.
- A visão cliente mostra somente o valor final. Custos internos e markup permanecem restritos à agência.

## 7. Testes e validações

Executados em 14/07/2026:

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Aprovado, sem warnings ou erros do projeto |
| `npm run typecheck` | Aprovado |
| `npm test` | Aprovado (`domain-tests: ok`) |
| `npm run build` | Aprovado, 81 rotas listadas pelo Next.js |
| `npm run validate` | Aprovado |
| `npm audit --omit=dev` | 2 vulnerabilidades moderadas no PostCSS interno do Next.js |

Testes de regressão cobrem, entre outros pontos: concorrência do storage, bloqueio transitório no Windows, tombstones, escopo de grupo, duplicidades por empresa, identificação/aliases de viajante, economia comparável, ocultação de markup, autorização, limite de JSON, CSV e HTML seguros.

Validação no navegador:

- grupo Way Brasil carregado com três empresas vinculadas;
- relatório do grupo com 195 demandas no período testado;
- filtro por categoria e ação de limpar atualizando indicadores e gráficos;
- mapa Leaflet com tiles reais e atribuição;
- portal alternando de empresa para grupo;
- paginação funcional de vouchers, viajantes e hotéis;
- relatório sem overflow horizontal em 390 px e em desktop;
- nenhum erro ou warning de aplicação no console das telas verificadas.

## 8. Arquivos principais alterados

- `lib/client-data-hydration.ts`, `lib/storage-merge.ts`, `lib/server-db.ts`, `lib/security/storage-scope.ts`.
- `lib/funcionario-identidade.ts`, `lib/atendimentos-storage.ts`, `lib/reconciliacao.ts`, `lib/wintour-import.ts`.
- `lib/relatorios.ts`, `lib/reporting/corporate-dashboard.ts`, `lib/reporting/corporate-dashboard-html.ts`.
- `app/relatorios/_components/*` e páginas de relatório por grupo, empresa, viajante, centro de custo e agente.
- `app/dashboard/grupos`, `portal-empresa`, `reconciliacao`, `vouchers`, `funcionarios` e `hoteis`.
- rotas em `app/api`, componentes de autenticação, navegação, PageHero e exportação.
- `scripts/domain-tests.cjs`, `package.json` e `README.md`.

## 9. Dependências

Nenhuma dependência foi adicionada, removida ou atualizada nesta auditoria. O lockfile não foi alterado.

O `npm audit` recomenda `npm audit fix --force`, mas a operação substituiria a versão atual por Next.js 9.3.3 e quebraria o projeto. O risco moderado do PostCSS deve ser acompanhado até existir correção compatível no ramo atual; não foi aplicado downgrade destrutivo.

## 10. Riscos restantes

- O JSON local é uma camada de desenvolvimento/fallback. Produção concorrente deve operar em PostgreSQL.
- É necessário definir e testar restauração de backup, retenção LGPD e monitoramento no ambiente real.
- Integrações Tech Travel, WhatsApp, IA e e-mail dependem das credenciais/contratos de homologação.
- A suíte atual protege domínio e contratos por código, mas ainda deve evoluir para E2E automatizado em CI com banco isolado.
- Algumas páginas possuem bundles iniciais altos por PDF/planilhas/gráficos; divisão adicional deve ser feita por fluxo, com medição, e não por atualização indiscriminada.

## 11. Confirmação

Nenhuma funcionalidade foi intencionalmente removida. As alterações foram incrementais, preservaram rotas, formatos externos, dados existentes e ações disponíveis aos perfis autorizados.
