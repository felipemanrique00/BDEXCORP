# Portal Empresa: catálogo offline de Carro e Rodoviário

Este documento descreve a fundação relacional criada para Carro e Rodoviário no
laboratório do Portal Empresa. Ela é aditiva e não habilita sozinha um produto
como completo na interface.

## Decisão de arquitetura

O domínio compartilhado continua responsável por `demands`, `travel_quotes`,
`travel_quote_options`, `travel_quote_selections`, aprovações, lifecycle,
reservas, emissões e vouchers. As tabelas terrestres guardam somente:

- os dados específicos solicitados pelo cliente;
- os catálogos de lojas, terminais, operadoras e linhas;
- o snapshot específico de cada opção publicada pelo consultor;
- a proveniência e o estado de revisão de dados externos.

Carro usa `commercial_suppliers` com o serviço `car`. Rodoviário usa a mesma
entidade com o serviço `bus`. Uma locadora ou operadora comercial não é uma
integração/API e não deve ser gravada em `integration_providers`.

## Tabelas introduzidas

- `offline_catalog_sources`: fonte, licença, estratégia de atualização e
  periodicidade de revisão.
- `rental_locations`: lojas de retirada/devolução ligadas à locadora e à
  geografia canônica.
- `bus_terminals`: terminais/rodoviárias ligados à geografia canônica.
- `bus_routes`: mercados/linhas ligados à operadora; terminais são opcionais,
  pois a fonte regulatória pode informar apenas os municípios.
- `car_demand_details`: período, lojas ou descrição manual, motorista e
  preferências.
- `bus_demand_details` e `bus_demand_legs`: tipo de viagem, trechos, cidades,
  terminais e janelas de horário.
- `car_quote_option_details`: locadora, lojas, categoria, diária, proteções,
  taxas e políticas.
- `bus_quote_option_details` e `bus_quote_segments`: operadora, linha, classe,
  trechos, horários, bagagem, valores e políticas.

Todas têm isolamento por tenant. Triggers validam tipo de serviço, fornecedor,
pertencimento das lojas e coerência terminal/cidade. Valores monetários dos
snapshots usam unidades mínimas (centavos).

## Fontes e limites

### Locadoras e lojas

A Movida mantém uma [lista oficial de lojas](https://www.movida.com.br/lojas) e
páginas públicas individuais. Não foi identificado um feed público ou contrato
de API destinado à sincronização do catálogo. Por isso:

- não deve haver scraping periódico silencioso;
- o caminho preferencial é feed/API contratual da locadora;
- enquanto isso, a agência pode cadastrar/importar CSV e revisar os registros;
- endereço público não significa disponibilidade, tarifa nem acordo comercial.

O fixture local inclui quatro referências Movida, cada uma com URL e data de
observação, mas mantém `review_status=pending`, `referenceOnly=true`,
`noCommercialAgreement=true` e não cria tarifas.

### Empresas e linhas rodoviárias

O [Portal de Dados Abertos da ANTT](https://dados.antt.gov.br/dataset/gerenciamento-de-autorizacoes)
publica CSV/API de empresas, linhas e seções do SIGMA sob licença Creative
Commons Atribuição. A base informa CNPJ, razão social, TAR/LOP, prefixo e
municípios de origem/destino. Ela é adequada para importar operadoras e mercados,
mas não prova preço, horário, assento disponível nem terminal de embarque.

### Terminais rodoviários

Não foi identificada uma base federal única e completa de terminais. O catálogo
deve combinar fontes oficiais estaduais/administradores, mantendo a fonte por
registro. O fixture referencia:

- [AGR Goiás — Terminais Rodoviários de Passageiros](https://dadosabertos.go.gov.br/dataset/terminais-rodoviarios-de-passageiros);
- [CODERTE — Terminais Rodoviários do RJ](https://www.rj.gov.br/coderte/Terminais_Rodoviarios).

Os endereços dos dois terminais foram intencionalmente omitidos até revisão
humana. Município e nome não devem ser confundidos com ponto exato de embarque.

## Empresa-fábrica local

O comando preparado (não executado automaticamente) é:

```powershell
# Pré-requisito: publica o template local de política/workflow usado pela fixture.
$env:BDEX_ALLOW_LOCAL_APPROVAL_SEED='1'
npm.cmd run db:seed:local-offline-approvals

$env:COMPANY_PORTAL_FIXTURE_CONFIRM='local:company-portal-offline'
$env:COMPANY_PORTAL_FIXTURE_REQUESTER_EMAIL='solicitante.portal.local@bdextravel.test' # opcional
$env:COMPANY_PORTAL_FIXTURE_APPROVER_EMAIL='autorizador.portal.local@bdextravel.test' # opcional e distinto
npm.cmd run db:seed:local-company-portal-offline
```

O seed recusa produção/staging, host remoto, porta diferente de `55433`, banco
diferente de `bdex_gap_closure`, migration ausente e execução sem confirmação.
Usa transação, lock e IDs determinísticos; só atualiza registros que preservam o
marcador `company_portal_offline_local_v1` e nunca remove registros.

Ele prepara:

- grupo e empresa `[TESTE]`, identidade visual e cadastro de viajantes liberado;
- solicitante e viajante sintéticos, sem login vinculado;
- quatro hotéis e oito tarifas totalmente fictícios e explicitamente marcados;
- quatro lojas Movida como referências públicas pendentes de revisão, sem preço;
- dois terminais reais como referências públicas, sem endereço não revisado;
- duas lojas e dois terminais inteiramente fictícios, marcados como `[TESTE]` e
  verificados apenas para exercitar o fluxo local ponta a ponta;
- uma operadora/linha totalmente fictícia para teste local;
- uma referência pública de operadora/linha ANTT, sem preço nem horário.

Opcionalmente, `COMPANY_PORTAL_FIXTURE_REQUESTER_EMAIL` (ou o alias legado
`COMPANY_PORTAL_FIXTURE_ACCESS_EMAIL`) vincula explicitamente um usuário
corporativo local preexistente ao solicitante da fixture. Uma segunda conta,
informada por `COMPANY_PORTAL_FIXTURE_APPROVER_EMAIL`, recebe acesso corporativo
`viewer` restrito explicitamente a `ver_demandas`, `ver_aprovacoes` e
`decidir_aprovacoes` para esta empresa. As demais permissões de leitura herdadas
por `viewer` são negadas no próprio grant da fixture. As contas precisam ser
distintas para preservar a segregação de
funções. A conta solicitante precisa ter exatamente `role_key=requester`. A conta
aprovadora não pode ter esse papel, não pode ser administradora da plataforma e
precisa possuir `decidir_aprovacoes` em seu papel/permissão-base, pois o motor de
aprovação exige essa permissão antes de considerar qualquer acesso corporativo.
O seed não cria credenciais e não vincula nenhum usuário quando as variáveis não
são informadas.

O mesmo seed publica quatro políticas independentes no checkpoint `selection`,
uma para cada `request.service`: `aereo`, `hotelaria`, `locacao` e `rodoviario`. Cada
política e seu workflow possuem somente o escopo da empresa `[TESTE]`. Os
workflows reutilizam a topologia do template local publicado, mas resolvem o
aprovador exclusivamente pela alçada relacional nativa. Para a conta aprovadora
informada são criadas quatro alçadas `cost`, todas restritas à empresa, em BRL, e
separadas pelos quatro produtos. Se a conta aprovadora mudar
ou deixar de ser informada, alçadas ativas antigas que tenham o marcador exato
da fixture são revogadas (nunca apagadas), evitando um aprovador residual.

Não há `auto_approve`, aprovação passiva, autoaprovação nem caminho que contorne
um nó de aprovação. Sem conta aprovadora válida, o roteamento permanece publicado,
mas falha fechado ao tentar resolver a aprovação. A saída do comando informa
`approvals.e2eAvailable=true` somente quando solicitante, aprovador, policies,
workflows e as quatro alçadas foram validados dentro da mesma transação.

## Fluxo implementado e próximos passos de catálogo

O Portal Empresa já integra Carro e Rodoviário ao ciclo offline formal: criação,
snapshot bloqueado após envio, correção governada após rejeição, cotação,
escolha, aprovação, reserva, emissão e voucher. As APIs de catálogo só retornam
registros ativos e `review_status=verified`; referências públicas pendentes não
podem ser usadas em pedidos nem em cotações.

Permanecem como evolução operacional do catálogo, sem bloquear o laboratório:

1. importador ANTT com staging, reconciliação por chave natural, relatório de
   divergências e aprovação humana;
2. cadastro/importador revisável de lojas e terminais, sem scraping;
3. feed/API contratual de locadoras quando disponibilizado;
4. ampliação da base verificada por cidade e revisão periódica da proveniência;
5. cotação rodoviária com conexões, que deve usar os UUIDs reais de cada trecho.

As fixtures verificadas deste seed são locais, sintéticas e explicitamente
marcadas como `[TESTE]`. Elas não validam nem promovem os registros públicos de
Movida, ANTT, AGR ou CODERTE.
