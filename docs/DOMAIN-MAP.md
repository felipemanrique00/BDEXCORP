# Mapa de dominios e matriz funcional

Data de referencia: 2026-07-24.

Este documento liga cada funcao exigida a interface, API, servico, persistencia,
autorizacao, politica, auditoria e teste. O inventario individual das 61 paginas
e 166 arquivos de rotas de API esta em `FEATURE-INVENTORY.generated.md`.

## Regras de leitura

Status usados:

- **Implementado**: ha caminho de codigo completo; ainda pode depender da
  validacao de staging indicada na coluna de testes.
- **Hibrido**: existe caminho relacional, mas a interface ainda possui leitura
  ou compatibilidade por `app_kv`/`/api/storage`.
- **Parcial**: existe parte do modelo ou fluxo, mas nao ha cobertura completa
  ponta a ponta.
- **Nao homologado**: adapter existe, mas fornecedor/credencial/contrato ainda
  nao foi validado.
- **Nao implementado**: nao existe caminho real suficiente. A existencia de
  tabela, tipo ou botao isolado nao altera esse status.

Evidencias abreviadas:

- `U-AUTH`: `password.test.ts`, `api-guard.test.ts`.
- `U-ACCESS`: `corporate-access.test.ts`,
  `navigation-permissions.test.ts`.
- `U-ID`: testes de identidade de funcionario e pessoa.
- `U-DEMAND`: testes de demanda, importacao e transferencia.
- `U-POLICY`: motor, schema e catalogo de politicas.
- `U-APPROVAL`: motor e schema de aprovacao.
- `U-TRAVEL`: lifecycle, cotacao e operacoes de viagem.
- `U-FIN`: financeiro corporativo, lancamentos e reconciliacao.
- `U-REPORT`: snapshot e regressao de relatorios.
- `U-INTEGRATION`: Tech, Wintour, fornecedores e mapeamentos.
- `U-FILE`: upload/PDF e autorizacao de arquivos.
- `I-RLS`: `tenant-isolation.test.ts`.
- `I-ACCESS`: `corporate-access-database.test.ts`.
- `I-IDENTITY-RLS`: `identity-plane-rls.test.ts`.
- `E-AUTH`: `tests/e2e/auth.spec.ts`.

Em 24/07/2026, 50 cenarios em 15 arquivos de integracao passaram contra
PostgreSQL descartavel com papel web sem `SUPERUSER` e sem `BYPASSRLS`.
Isso inclui RLS de tenant, acesso corporativo, identidade, sessao, convite,
MFA, workflows, IA, automacoes e portal do viajante. Staging deve repetir a
mesma suite com sua configuracao real.

Nas linhas detalhadas abaixo, a indicacao `DB pendente` significa que aquela
funcao especifica ainda nao possui um cenario relacional dedicado. Ela nao
significa ausencia de PostgreSQL nem invalida os 50 cenarios executados.

## Visao por dominio

| Dominio | Interface principal | API / servico | Tabelas principais | Estado |
| --- | --- | --- | --- | --- |
| Identidade | login, senha, MFA, convites, usuarios | `auth-service`, `mfa-service`, `user-service` | users, credentials, sessions, MFA, memberships, invites | Implementado |
| Acesso corporativo | seletor, empresas, grupos, usuarios | `corporate-access-service` | grants de grupo/empresa e preferencias | Implementado e validado em PostgreSQL |
| Diretorio | empresas, grupos, funcionarios, hoteis | store compativel e servicos relacionais | groups, companies, employees, aliases, hotels | Hibrido |
| Demandas | entrada, fila, detalhe, transferencia | `demand-service`, `demand-transfer-service` | demands, events, transfers, messages | Relacional; compatibilidade legada controlada |
| Politicas | politicas, simulacao, templates | `policy-service`, `lib/policy` | definitions, versions, evaluations, decisions | Implementado |
| Aprovacoes | aprovacoes e workflows | `approval-service`, `lib/approvals` | workflows, instances, assignments, decisions | Implementado |
| Viagem | cotacao, reserva, emissao e pos-venda | lifecycle e provider adapters | quotes, reservations, emissions, refunds | Implementado; fornecedor nao homologado |
| Financeiro | operacional, carteira, cartoes, faturas | finance services | entries, wallets, cards, invoices | Relacional; compatibilidade legada controlada |
| Importacoes | Wintour e importacao geral | parsers, import service e mappings | jobs, snapshots, actor mappings | Implementado; arquivos reais pendentes |
| Relatorios | BI, empresa, grupo, pessoa e centro | report builders e snapshots | fontes de dominio e report_snapshots | Implementado; snapshot/arquivo privado validados em E2E |
| Assistente | chat, agente e configuracao | assistant e AI services | conversations, tasks, settings | Implementado; provedor nao homologado |
| Arquivos | upload e download privados | file service | stored_files, stored_file_links | Implementado; AV externo pendente |
| Auditoria | eventos e consulta | audit log | audit_logs e eventos de dominio | Implementado |
| Plataforma | tenants, planos e limites | platform service | tenants, subscriptions, usage | Implementado; acesso administrativo e MFA validados em E2E |

## Identidade e acesso

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login | `/login` | `/api/auth/login` | `auth-service` | users, user_credentials, user_sessions | publica com credencial | origem, rate limit, bloqueio e hash | audit_logs | U-AUTH | I-RLS | E-AUTH | Implementado |
| Logout | `/sair` | `/api/auth/logout` | `auth-service` | user_sessions | sessao | revogacao da sessao atual | audit_logs | U-AUTH | I-RLS | E-AUTH | Implementado |
| Sessao | layout/header | `/api/auth/session` | `auth-service` | user_sessions, memberships | sessao ativa | tenant e acesso recalculados | audit_logs | U-AUTH, U-ACCESS | I-RLS, I-ACCESS | E-AUTH | Implementado |
| Recuperacao | `/esqueci-senha`, `/redefinir-senha` | `/api/auth/password-reset/*` | `password-reset-service` | password_reset_tokens | fluxo publico limitado | token hash, expiracao e uso unico | audit_logs | U-AUTH | I-RLS | - | Implementado; SMTP pendente |
| Convite | `/aceitar-convite` | `/api/users/[id]/invite`, `/api/auth/invite/accept` | `user-service`, `auth-service` | user_invites, memberships | `gerenciar_usuarios` | tenant, token e escopo corporativo | audit_logs | U-AUTH, U-ACCESS | I-ACCESS | - | Implementado; SMTP pendente |
| Alteracao de senha | `/alterar-senha` | `/api/auth/change-password` | `auth-service` | user_credentials, user_sessions | sessao | senha atual, politica e rotacao | audit_logs | U-AUTH | I-RLS | E-AUTH parcial | Implementado |
| MFA administrativo | `/login`, `/dashboard/configuracoes` | `/api/auth/mfa/enroll`, `/api/auth/mfa/verify`, `/api/auth/mfa/status`, `/api/auth/mfa/recovery-codes` | `mfa-service`, TOTP RFC 6238 | user_mfa_methods, recovery_codes, challenges, user_sessions | perfil administrativo | pre-sessao, segredo AES-GCM, rate limit, anti-replay e recuperacao de uso unico | audit_logs | `totp.test.ts` | `mfa-authentication.test.ts` | `auth.spec.ts` desktop/mobile | Implementado |
| Usuarios | `/dashboard/usuarios` | `/api/users*` | `user-service` | users, memberships, roles | `gerenciar_usuarios` | tenant e limite de delegacao | audit_logs | U-ACCESS | I-ACCESS | - | Implementado; E2E pendente |
| Grupos acessiveis | seletor e `/dashboard/grupos` | `/api/me/corporate-contexts`, `/api/users/[id]/access` | `corporate-access-service` | business_groups, group grants | `ver_empresas` / `gerenciar_vinculos_acesso` | grupo no tenant e grant ativo | audit_logs | U-ACCESS | I-ACCESS | - | Implementado para acesso; CRUD hibrido |
| Empresas acessiveis | seletor e `/dashboard/empresas` | `/api/me/corporate-contexts`, `/api/users/[id]/access` | `corporate-access-service` | companies, company grants | `ver_empresas` | empresa autorizada recalculada | audit_logs | U-ACCESS | I-ACCESS | - | Implementado para acesso; CRUD hibrido |
| Multiempresa | seletor corporativo | `/api/me/corporate-contexts` | `corporate-access-service` | grants e preferences | permissao por empresa | uniao de grants sem confiar no cliente | audit_logs | U-ACCESS | I-ACCESS | - | Implementado |
| Permissoes | usuarios/contexto | `/api/users/[id]/access` | access admin service | roles, permissions, role_permissions | `gerenciar_vinculos_acesso` | anti-escalacao e tenant | audit_logs | U-ACCESS | I-ACCESS | - | Implementado |
| Revogacao | usuarios/contexto | `/api/users/[id]`, `/api/users/[id]/access` | user/access services | memberships e grants | `gerenciar_usuarios` / `gerenciar_vinculos_acesso` | efeito na proxima resolucao | audit_logs | U-ACCESS | I-ACCESS | - | Implementado; sessao real pendente |
| Auditoria de acesso | `/dashboard/auditoria` | `/api/audit/logs` | `audit-query-service` | audit_logs | administrador/escopo | tenant obrigatorio e log append-only | audit_logs | `audit-query-service.test.ts` | I-RLS | - | Implementado |

## Cadastros

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Empresas | `/dashboard/empresas*` | `/api/storage` no CRUD legado; grants em API dedicada | store e access service | companies + app_kv | `cadastrar_empresas`, `gerenciar_empresas_grupo` | escopo de storage e empresa | parcial no legado | U-ACCESS, storage tests | I-ACCESS | - | **Hibrido; CRUD dedicado pendente** |
| Grupos | `/dashboard/grupos` | `/api/storage` no CRUD legado | store e access service | business_groups + app_kv | `gerenciar_empresas_grupo` | tenant/grupo no acesso; UI legada no CRUD | parcial no legado | U-ACCESS, storage tests | I-ACCESS | - | **Hibrido; CRUD dedicado pendente** |
| Filiais | empresas/grupos | - | - | organizational_units (`branch`) | `gerenciar_empresas_grupo` | tenant/company FK | auditavel apenas por SQL futuro | - | I-RLS estrutural | - | **Parcial: modelo sem CRUD dedicado** |
| Departamentos | empresa/funcionario | - | - | organizational_units (`department`) | `gerenciar_funcionarios` | tenant/company FK | auditavel apenas por SQL futuro | - | I-RLS estrutural | - | **Parcial: modelo sem CRUD dedicado** |
| Centros de custo | empresa, relatorios e Tech | `/api/travel/tech/cost-centers` | Tech adapter / dados locais | cost_centers | por empresa/integracao | tenant, empresa e provider | integration_action_logs | U-INTEGRATION | I-RLS estrutural | - | Parcial; CRUD local dedicado pendente |
| Projetos | relatorios/politicas | - | - | projects | por empresa | tenant/company FK | auditavel apenas por SQL futuro | U-POLICY indireto | I-RLS estrutural | - | **Parcial: modelo sem CRUD dedicado** |
| Contas | `/dashboard/financeiro` | `/api/finance/corporate*` | corporate finance service | corporate_wallets, cards | `ver_financeiro`, `editar_financeiro` | empresa autorizada | audit_logs | U-FIN | I-RLS estrutural | - | Implementado como carteira/cartao; cadastro bancario generico ausente |
| Funcionarios | `/dashboard/funcionarios*` | `/api/employees/link-demands`; CRUD compativel | employee identity service/store | employees, aliases, match_decisions | `ver_funcionarios`, `gerenciar_funcionarios` | empresa e identidade permanente | audit_logs/match decisions | U-ID | I-RLS estrutural | - | Hibrido; identidade implementada |
| Viajantes | funcionario/demandas | APIs de demandas e vinculo | employee identity/demand services | employees, demands | `ver_funcionarios`, `criar_demandas` | `employee_id`, nao nome | demand_events | U-ID, U-DEMAND | I-RLS estrutural | - | Implementado no modelo; E2E pendente |
| Solicitantes | `/dashboard/solicitantes` e empresa | `/api/solicitantes/empresa*` | `requester-service` | requesters | `ver_solicitantes`, `gerenciar_solicitantes` | empresa autorizada | audit_logs | `requester-schema.test.ts` | I-RLS estrutural | - | Hibrido/shadow |
| Aprovadores | `/dashboard/workflows`, `/dashboard/aprovacoes` | `/api/approvals/authorities*` | `approval-service` | approval_authorities, assignments | `gerenciar_workflows` | autoridade, empresa/grupo e alcada | approval_events | U-APPROVAL | DB pendente | - | Implementado |
| Fornecedores | `/dashboard/fornecedores`, configuracoes | `/api/integrations/providers*` | integration provider service | integration_providers | `gerenciar_integracoes` | tenant e capacidade declarada | integration_action_logs | U-INTEGRATION | DB pendente | - | Implementado como catalogo; homologacao por fornecedor pendente |
| Hoteis | `/dashboard/hoteis*` | `/api/storage` no CRUD legado; Tech na busca | store/Tech adapter | hotels + app_kv | `cadastrar_hoteis` | escopo corporativo; provider separado | parcial/integration logs | U-INTEGRATION parcial | I-RLS estrutural | - | Hibrido |
| Locadoras | fornecedores/reservas | provider catalog | integration provider service | integration_providers e travel_segments | `gerenciar_integracoes` | tenant/empresa/provider | integration_action_logs | U-INTEGRATION | DB pendente | - | Parcial; sem cadastro dedicado |
| Companhias | fornecedores/relatorios aereos | provider catalog/importacao | parsers/provider service | integration_providers e snapshots importados | `gerenciar_integracoes` | tenant/empresa | integration_action_logs/import_jobs | U-INTEGRATION | DB pendente | - | Parcial; sem cadastro dedicado |
| Motivos | politicas/Tech/demandas | `/api/travel/tech/motives` | Tech adapter | fatos/metadata; sem tabela local dedicada | `gerenciar_integracoes` | provider e checkpoint | integration_action_logs | U-INTEGRATION | - | - | Nao homologado; catalogo local dedicado ausente |
| Justificativas | politicas/aprovacoes | APIs de politica/aprovacao/viagem | policy/approval/travel services | travel_policy_justifications, approval_decisions | conforme operacao | acao de politica e tamanho minimo | policy/approval/travel events | U-POLICY, U-APPROVAL | DB pendente | - | Implementado |
| Moedas | politicas/financeiro | - | referencia de governanca no SQL | currencies, exchange_rates | financeiro/configuracao | tenant, vigencia e precisao | auditavel apenas por SQL futuro | U-POLICY indireto | I-RLS estrutural | - | Parcial: modelo sem CRUD dedicado |
| Feriados | workflows | - | calculo SLA + referencia SQL | business_calendars, calendar_holidays | `gerenciar_workflows` | calendario no SLA | approval_events | U-APPROVAL | DB pendente | - | Parcial: motor usa calendario; CRUD dedicado pendente |

## Solicitacoes

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Criacao | caixa de entrada/demandas | `POST /api/demands` | `demand-service` | demands, demand_events | `criar_demandas` | empresa, campos e checkpoint `request` | demand_events/audit_logs | U-DEMAND | DB pendente | - | Implementado |
| Rascunho | entrada de demanda | `POST/PATCH /api/demands` | demand service/lifecycle | demands | `criar_demandas` | estado inicial e versao | demand_events | U-DEMAND, U-TRAVEL | DB pendente | - | Parcial; UX E2E pendente |
| Duplicacao | - | - | - | - | `criar_demandas` | deveria revalidar politica | - | - | - | - | **Nao implementado como comando dedicado** |
| Continuacao | detalhe/fila | `PATCH /api/demands/[id]` | `demand-service` | demands, events | `criar_demandas` | optimistic version e empresa | demand_events | U-DEMAND | DB pendente | - | Implementado |
| Multiplos viajantes | demanda/importacao | - | importacao associa registros | demands, employees | `criar_demandas` | identidade por viajante | import/demand events | U-ID, U-DEMAND | DB pendente | - | **Parcial; demanda relacional e de um viajante** |
| Acompanhantes | - | - | - | travel_segments metadata apenas | `criar_demandas` | deveria validar identidade/documentos | - | - | - | - | **Nao implementado como entidade/fluxo** |
| Campos obrigatorios | formularios/importacao | APIs de demandas | Zod + demand service | demands | `criar_demandas` | schema, tenant e empresa | erros/logs seguros | U-DEMAND | DB pendente | - | Implementado |
| Anexos | formularios/detalhe | `/api/files*` | file service | stored_files, links | permissao da entidade | MIME, assinatura, limite e escopo | audit_logs | U-FILE | I-RLS estrutural | E-AUTH parcial | Implementado; antivirus externo pendente |
| Urgencia | demandas | APIs de demandas | demand service | demands.priority | `criar_demandas` | checkpoint/politica de antecedencia | demand_events/policy decisions | U-DEMAND, U-POLICY | DB pendente | - | Implementado |
| Viagem local | demanda | APIs de demandas | demand/lifecycle | demands, segments | `criar_demandas` | fatos de destino | policy/travel events | U-POLICY, U-TRAVEL | DB pendente | - | Parcial; classificacao depende dos dados |
| Viagem nacional | demanda | APIs de demandas | demand/lifecycle | demands, segments | `criar_demandas` | politica nacional | policy/travel events | U-POLICY, U-TRAVEL | DB pendente | - | Parcial; E2E pendente |
| Viagem internacional | demanda | APIs de demandas | demand/lifecycle | demands, segments, files | `criar_demandas` | documentos, risco e politica internacional | policy/travel events | U-POLICY, U-TRAVEL | DB pendente | - | Parcial; validacao documental E2E pendente |

## Produtos

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aereo | reservas/cotacoes | `/api/travel/quotes*`, Tech travel APIs | travel governance/Tech adapter | segments, quotes, reservations | `operar_cotacoes`, `operar_reservas` | checkpoints aereo/tarifa | policy/travel/integration events | U-TRAVEL, U-INTEGRATION | DB/provider pendente | - | Implementado; provider nao homologado |
| Hotel | reservas/emissao manual | quotes, reservations, `/api/emissions/manual-hotel` | travel/manual hotel services | segments, reservations, manual_hotel_bookings | cotar/reservar/emitir | diaria, antecedencia e fornecedor | policy/travel events | U-TRAVEL | DB/provider pendente | - | Implementado; provider nao homologado |
| Carro | reservas/cotacoes | quotes/reservations e Tech | travel governance/Tech adapter | travel_segments (`car`) | cotar/reservar | categoria, periodo e politica | policy/travel/integration events | U-TRAVEL, U-INTEGRATION | provider pendente | - | Parcial; Tech nao homologada |
| Rodoviario | demanda/lifecycle | API generica de quotes/reservations | travel governance | travel_segments (`bus`) | cotar/reservar | politica por segmento | policy/travel events | U-TRAVEL | DB pendente | - | Parcial; sem adapter dedicado |
| Transfer | demanda/lifecycle | API generica de quotes/reservations | travel governance | travel_segments (`transfer`) | cotar/reservar | politica por segmento | policy/travel events | U-TRAVEL | DB pendente | - | Parcial; sem adapter dedicado |
| Seguro | demanda/lifecycle | API generica de quotes/reservations | travel governance | travel_segments (`insurance`) | cotar/reservar | obrigatoriedade internacional | policy/travel events | U-TRAVEL, U-POLICY | DB pendente | - | Parcial; sem adapter dedicado |
| Servico | demanda/lifecycle | API generica de quotes/reservations | travel governance | travel_segments (`service`) | cotar/reservar | politica por categoria | policy/travel events | U-TRAVEL | DB pendente | - | Parcial; sem adapter dedicado |
| Adiantamento | financeiro/politicas | finance entries generica | finance/policy services | financial_entries, budgets | `editar_financeiro` | prestacao pendente e alcada | audit/policy events | U-FIN, U-POLICY | DB pendente | - | **Parcial; fluxo dedicado de prestacao ausente** |

## Operacao

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Atendimento | caixa/fila/demandas | `/api/demands*`, `/api/operations/communications` | demand/communication services | demands, messages, notes | `ver_demandas`, `criar_demandas` | empresa e estado | demand_events/audit | U-DEMAND | DB pendente | - | Implementado |
| Distribuicao | fila | `/api/demands/[id]/assignment` | demand service | demands, events | `criar_demandas` | escopo, versao e agente | demand_events | U-DEMAND | DB pendente | - | Implementado |
| Bloqueio concorrente | fila/operacao | APIs mutaveis | demand/travel services | version/idempotency_keys | permissao da operacao | optimistic lock/transacao | domain events | U-DEMAND, U-TRAVEL | concorrencia DB pendente | - | Implementado em codigo |
| Assumir | fila | assignment | demand service | demands, events | `criar_demandas` | agente e empresa | demand_events | U-DEMAND | DB pendente | - | Implementado |
| Transferir | fila/detalhe | `/api/demands/transfers*` | `demand-transfer-service` | demand_transfer_requests | `criar_demandas` | origem/destino e justificativa | audit_logs | `demand-transfer-service.test.ts` | DB pendente | - | Implementado |
| SLA | fila/workflows | `/api/approvals/sla/process` | approval SLA | approval_slas, escalations | `gerenciar_workflows` | calendario, timeout e escalonamento | approval_events | U-APPROVAL | DB pendente | - | Implementado para aprovacao; SLA operacional parcial |
| Cotacao | reservas | `/api/travel/quotes*` | travel governance | travel_quotes, options | `operar_cotacoes` | politica antes/depois da busca | policy/travel events | U-TRAVEL | DB/provider pendente | - | Implementado; provider nao homologado |
| Escolha | reservas | fare/quote option APIs | travel governance | quote_options | `operar_cotacoes` | menor tarifa, justificativa e aprovacao | policy/travel events | U-TRAVEL, U-POLICY | DB/provider pendente | - | Implementado em servico; E2E pendente |
| Reserva | reservas | `/api/travel/reservations*` | travel governance | reservations, provider_operations | `operar_reservas` | estado, policy, approval, idempotencia | travel/integration events | U-TRAVEL | DB/provider pendente | - | Implementado; provider nao homologado |
| Emissao | emissoes/reservas | `/api/travel/reservations/[id]/issue` | travel governance | travel_emissions | `operar_emissoes` | reserva confirmada, aprovacao e pagamento | travel/integration events | U-TRAVEL | DB/provider pendente | - | Implementado; provider nao homologado |
| Voucher | vouchers | `/api/vouchers*` | voucher service | vouchers, files | `ver_vouchers`, `operar_reservas` | empresa, versao e status | audit_logs | voucher/PDF tests | DB pendente | E-AUTH parcial | Implementado |
| Remarcacao | operacao | sem endpoint dedicado | lifecycle generico | travel_state_events/metadata | `operar_cancelamentos` | exige nova policy/reaprovacao | travel events | U-TRAVEL parcial | - | - | **Parcial; comando dedicado ausente** |
| Cancelamento | reservas/vouchers | cancel reservation/ticket | travel governance | travel_cancellations | `operar_cancelamentos` | estado, confirmacao e idempotencia | travel/integration events | U-TRAVEL | DB/provider pendente | - | Implementado; provider nao homologado |
| Reembolso | reconciliacao/financeiro | `/api/travel/refunds/[id]/resolve` | refund service | travel_refunds, events | `editar_financeiro` | cancelamento confirmado e conciliacao | refund/audit events | U-TRAVEL, U-FIN | DB/provider pendente | - | Implementado; provider nao homologado |
| Bilhetes nao utilizados | reservas/Tech | `/api/travel/tech/reusable-tickets` | Tech adapter | resposta externa/operations | `gerenciar_integracoes` | empresa/provider | integration_action_logs | U-INTEGRATION | provider pendente | - | Nao homologado |

## Financeiro

| Funcao | Pagina | API | Servico | Tabela | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fee | financeiro/relatorios | finance entries | finance service | financial_entries metadata | `ver_financeiro`, `editar_financeiro` | empresa e contrato | audit_logs | U-FIN | DB pendente | - | Hibrido |
| Markup | configuracoes/relatorio agencia | finance/storage compativel | finance/report builders | companies/app_kv/entries | financeiro; oculto do cliente | visao cliente nunca autoriza markup | audit parcial | U-FIN, U-REPORT | DB pendente | - | Hibrido; teste visual pendente |
| Impostos | financeiro | finance entries | finance service | financial_entries metadata | financeiro | validacao monetaria | audit_logs | U-FIN | DB pendente | - | Parcial |
| Orcamento | politicas/financeiro | APIs de politica; sem CRUD financeiro dedicado | policy/finance services | budgets | financeiro/politicas | checkpoint de orcamento | policy/audit events | U-POLICY, U-FIN | concorrencia DB pendente | - | Parcial |
| Compromisso | lifecycle | operacao interna | travel/finance services | budget_commitments | financeiro/operacao | idempotencia e transacao | travel/audit events | U-TRAVEL, U-FIN | concorrencia DB pendente | - | Parcial; runtime DB pendente |
| Liberacao | cancelamento/reembolso | operacao interna | travel/finance services | budget_commitments | financeiro/operacao | transicao valida | travel/audit events | U-TRAVEL, U-FIN | concorrencia DB pendente | - | Parcial; runtime DB pendente |
| Rateio | financeiro | finance entries | finance service | financial_entries metadata | `editar_financeiro` | soma e empresa | audit_logs | U-FIN | DB pendente | - | Parcial; entidade dedicada ausente |
| Contas operacionais | `/dashboard/financeiro` | `/api/finance/entries*` | finance service | financial_entries | ver/editar financeiro | empresa e status | audit_logs | U-FIN | DB pendente | - | Hibrido/shadow |
| Faturamento | financeiro | corporate invoices | corporate finance service | corporate_invoices | ver/editar financeiro | empresa, vinculos e versao | audit_logs | U-FIN | DB pendente | - | Implementado |
| Contas a pagar | financeiro | finance entries | finance service | financial_entries (`payable`) | ver/editar financeiro | empresa e liquidacao | audit_logs | U-FIN | DB pendente | - | Implementado |
| Contas a receber | financeiro | finance entries | finance service | financial_entries (`receivable`) | ver/editar financeiro | empresa e liquidacao | audit_logs | U-FIN | DB pendente | - | Implementado |
| Cartao | financeiro | `/api/finance/corporate/cards` | corporate finance service | corporate_cards | editar financeiro | empresa e limites | audit_logs | U-FIN | DB pendente | - | Implementado |
| Adiantamento | financeiro/politica | finance entries generica | finance/policy services | financial_entries | editar financeiro | pendencia e aprovacao | policy/audit events | U-FIN, U-POLICY | DB pendente | - | Parcial; fluxo dedicado ausente |
| Prestacao de contas | - | - | policy facts apenas | files/financial_entries | editar financeiro | checkpoint `expense` | policy/audit futuro | U-POLICY parcial | - | - | **Nao implementado ponta a ponta** |
| Conciliacao | `/dashboard/reconciliacao` | `/api/reconciliation/alerts*` | reconciliation service | runs, alerts, events | ver/editar financeiro | empresa, resolucao e versao | reconciliation events/audit | U-FIN | DB pendente | - | Implementado |

## Relatorios

| Funcao | Pagina | API | Servico | Tabela / fonte | Permissao | Politica / guard | Auditoria | Unitario | Integracao | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gastos | relatorios/dashboard/empresa/grupo | snapshots + builders locais | reporting/report snapshot | demands, entries, imports, snapshots | `ver_relatorios`, `gerar_relatorios` | empresas autorizadas recalculadas | snapshot audit | U-REPORT | I-ACCESS parcial | - | Hibrido; conciliacao visual pendente |
| Economia | relatorios interativos | builders | reporting | atendimentos/demandas comparaveis | ver relatorios | somente referencia identificavel | snapshot audit parcial | U-REPORT/domino | - | - | Implementado em calculo; dados reais pendentes |
| Politica | politicas/relatorios | policy APIs | policy service | evaluations, decisions | `ver_politicas` | escopo autorizado | policy events | U-POLICY | DB pendente | - | Implementado no backend; relatorio dedicado parcial |
| Violacoes | politicas/relatorios | policy APIs | policy service | policy_violations | `ver_politicas` | escopo autorizado | policy events | U-POLICY | DB pendente | - | Implementado no backend; UI dedicada parcial |
| SLA | produtividade/aprovacoes | approval APIs | approval service | slas, escalations | `ver_aprovacoes` | escopo autorizado | approval_events | U-APPROVAL | DB pendente | - | Parcial |
| Fornecedor | relatorio corporativo/aereo | builders | reporting | imports, reservations, providers | ver relatorios | empresas autorizadas | snapshot audit | U-REPORT, U-INTEGRATION | - | - | Implementado; E2E visual pendente |
| Companhia | relatorio aereo | builders | `reporting/aereo-executivo` | imports/segments | ver relatorios | empresas autorizadas | snapshot audit | U-REPORT | - | - | Implementado; E2E visual pendente |
| Hotel | relatorio corporativo | builders | reporting | imports/reservations/hotels | ver relatorios | empresas autorizadas | snapshot audit | U-REPORT | - | - | Implementado; E2E visual pendente |
| Centro de custo | `/relatorios/centro-custo` | builders/snapshots | reporting | cost centers + demandas | ver relatorios | empresa autorizada | snapshot audit | U-REPORT | - | - | Implementado; E2E visual pendente |
| Projeto | relatorio corporativo | builders por metadado | reporting | projects/demand metadata | ver relatorios | empresa autorizada | snapshot audit | U-REPORT parcial | - | - | Parcial; depende de dado de origem |
| Funcionario | `/relatorios/funcionario` | builders/snapshots | reporting + identity | employees, demands | ver relatorios/funcionarios | agrupa por `employee_id` | snapshot/match decisions | U-ID, U-REPORT | - | - | Implementado; dados legados exigem reconciliacao |
| Grupo | `/relatorios/grupo` | builders/snapshots | reporting/access | grupos, empresas e dados permitidos | `ver_consolidado_grupo`, ver relatorios | somente empresas autorizadas | snapshot audit | U-ACCESS, U-REPORT | I-ACCESS | - | Implementado; E2E visual pendente |
| Empresa | `/relatorios/empresa` | builders/snapshots | reporting/access | empresa e dados permitidos | ver relatorios | `requireCompanyAccess` no backend novo | snapshot audit | U-ACCESS, U-REPORT | I-ACCESS | - | Hibrido; E2E visual pendente |
| Risco | `/dashboard/risco` | builders/storage compativel | client reporting | demandas/importacoes | ver relatorios | escopo da empresa | parcial | U-REPORT parcial | - | - | Parcial |
| CO2 | `/dashboard/sustentabilidade` | builders/storage compativel | sustainability/reporting | demandas/importacoes | ver relatorios | escopo da empresa | parcial | U-REPORT parcial | - | - | Parcial |
| Orcamento | financeiro/relatorios | builders | finance/reporting | budgets, commitments | ver financeiro/relatorios | nao expor financeiro sem permissao | snapshot audit | U-FIN, U-REPORT | DB pendente | - | Parcial |
| Auditoria | `/dashboard/auditoria` | `/api/audit/logs` | audit query service | audit_logs e jobs | administrador/escopo | tenant obrigatorio | propria trilha | audit tests | I-RLS | - | Implementado |

## Integracoes

| Funcao | Pagina | API | Adapter / servico | Persistencia | Permissao | Politica / guard | Auditoria | Unitario | Integracao real | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fornecedores | fornecedores/configuracoes | `/api/integrations/providers*` | provider service/registry | providers, action_logs | `gerenciar_integracoes` | tenant, empresa, capability | integration_action_logs | U-INTEGRATION | pendente | - | Catalogo implementado; adapters variam |
| GDS | fornecedores | - | - | provider catalog apenas | gerenciar integracoes | exigiria contrato/adaptador | - | - | - | - | **Nao implementado** |
| NDC | fornecedores | - | - | provider catalog apenas | gerenciar integracoes | exigiria contrato/adaptador | - | - | - | - | **Nao implementado** |
| Consolidadoras | fornecedores/Tech | Tech APIs | Tech adapter | mappings, operations | gerenciar integracoes | empresa, idempotencia e confirmacao | integration_action_logs | U-INTEGRATION | pendente | - | Nao homologado |
| Hoteis externos | reservas/Tech | travel/Tech APIs | Tech adapter | quotes/reservations/operations | cotar/reservar | policy + provider | integration logs | U-INTEGRATION, U-TRAVEL | pendente | - | Nao homologado |
| Locadoras externas | reservas/fornecedores | provider generico | registry | provider catalog | gerenciar integracoes | capability declarada | integration logs | U-INTEGRATION parcial | pendente | - | Parcial; adapter real ausente |
| E-mail | convite/reset/voucher | auth/assistant APIs | SMTP/email service | tokens/events | conforme fluxo | segredo no servidor, link unico | audit/assistant events | U-AUTH parcial | pendente | - | Implementado; SMTP nao homologado |
| WhatsApp | assistente/voucher | `/api/assistant/whatsapp*` | adapter da assistente | sessions/events | configuracao/admin | confirmacao e opt-in | assistant_events | U-INTEGRATION parcial | pendente | - | Nao homologado |
| IA | assistente/IA | `/api/ia*`, `/api/assistant*` | AI/assistant services | tenant_ai_settings, conversations, tasks | por ferramenta/tenant | dados autorizados e confirmacao humana | assistant_events/audit | AI unit tests | provider pendente | - | Implementado; provider nao homologado |
| Mapas | relatorio interativo | export/client map | Leaflet/tiles | snapshot no HTML | ver relatorios | dados ja autorizados | snapshot audit | U-REPORT parcial | tiles pendentes | - | Implementado; provedor/fallback nao homologados |
| Armazenamento | anexos/documentos | `/api/files*` | file service | stored_files/links | permissao da entidade | MIME, assinatura, checksum, quota | audit_logs | U-FILE | I-RLS estrutural | E-AUTH parcial | Implementado local; object storage/AV pendentes |
| Contabilidade | financeiro | - | - | financial_entries apenas | financeiro | exigiria adapter/contrato | - | - | - | - | **Nao implementado** |
| ERP | configuracoes/fornecedores | - | - | provider catalog apenas | gerenciar integracoes | exigiria adapter/contrato | - | - | - | - | **Nao implementado** |
| Webhooks de entrada | - | - | - | integration_webhook_events | gerenciar integracoes | assinatura/replay exigidos | tabela disponivel | - | - | - | **Nao implementado como endpoint** |

## Fronteiras arquiteturais

- Componentes React nao acessam PostgreSQL diretamente.
- Route Handlers novos validam DTO e chamam servicos.
- Servicos relacionais resolvem autorizacao, transacao, estado e auditoria.
- Integracoes externas ficam atras de adapters e retornam indisponibilidade
  real; interface ou catalogo nao equivalem a homologacao.
- Codigo de compatibilidade nao e fonte de autorizacao.
- `app_kv` e `/api/storage` permanecem apenas durante rollout; as linhas
  marcadas como hibridas nao podem fazer cutover sem comparacao de dados.

## Conclusao da matriz

A matriz nao autoriza go-live. Os principais vazios funcionais encontrados sao:

1. CRUD relacional dedicado para empresas, grupos e parte do diretorio.
2. Multiplos viajantes/acompanhantes na mesma solicitacao.
3. Remarcacao como comando explicito.
4. Prestacao de contas ponta a ponta.
5. Adapters GDS, NDC, locadoras, contabilidade e ERP.
6. Endpoint de webhook assinado e protegido contra replay.
7. E2E individual dos fluxos corporativos, operacionais e financeiros.

Os itens acima estao refletidos em `KNOWN-LIMITATIONS.md`,
`GO-LIVE-CHECKLIST.md` e `FINAL-PRODUCTION-READINESS.md`. Enquanto continuarem
pendentes, o status de piloto, producao publica e venda SaaS permanece `NO-GO`.
