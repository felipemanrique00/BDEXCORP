# Auditoria pre-documentacao - BBT Corporate TRAVEL ELITE

Data da auditoria: 21/05/2026  
Projeto analisado: `C:\Users\Felipe Manrique\Documents\New project\bbt-corporate-final`  
Objetivo: mapear modulos, telas, funcionalidades, APIs, integracoes e lacunas antes da geracao dos PDFs oficiais.

> Status: esta auditoria foi produzida antes da geracao dos documentos finais. Pontos marcados como **[INFORMACAO A CONFIRMAR]** precisam ser validados pelo responsavel do produto/TI antes da versao final em PDF.

---

## 1. Modulos encontrados

| Modulo | Finalidade | Evidencia no projeto |
|---|---|---|
| Autenticacao e sessoes | Login, sessao do usuario, logout, protecao de APIs internas. | `app/login`, `app/api/auth/*`, `lib/auth.ts`, `lib/server-auth.ts` |
| Dashboard executivo | Cockpit geral com indicadores, graficos, mapas, alertas, financeiro, produtividade e resumo operacional. | `app/dashboard/page.tsx` |
| Entrada de demandas | Recebimento e extracao de solicitacoes por texto, e-mail/arquivo, audio, imagem/PDF e parser local/IA. | `app/dashboard/caixa-entrada/page.tsx`, `lib/ia-parser.ts`, `lib/demand-file-parser.ts` |
| Demandas e vouchers | Fila operacional, status, alertas, serial/OS, vinculo com vouchers e fluxo de atendimento. | `app/dashboard/demandas`, `app/dashboard/vouchers`, `lib/atendimentos-storage.ts`, `lib/atendimento-serial.ts` |
| Vouchers | Criacao manual, importacao, edicao, visualizacao, PDF/voucher, vinculo com atendimento e armazenamento. | `app/dashboard/vouchers/*`, `lib/vouchers-storage.ts`, `lib/vouchers-emitidos-storage.ts` |
| Wintour | Importacao diaria de vendas/emissoes por XML/XLSX/PDF/CSV, conferencia, deduplicacao, agentes, financeiro e vouchers. | `app/dashboard/wintour/page.tsx`, `lib/wintour-import.ts`, `lib/wintour-import-storage.ts` |
| Reservas e cotacoes | Criacao de cotacoes e reservas usando integracao Tech Travel/TTravel como hub de fornecedores. | `app/dashboard/reservas/page.tsx`, `app/api/travel/*`, `lib/integrations/tech/*` |
| Tech Travel | Conexao com provedor externo que centraliza aereo, hotelaria, locacao, pacotes, lazer, transfer, seguro e rodoviario conforme contrato. | `lib/integrations/tech/*`, `deploy/postgres/techtravel-schema.sql` |
| Central IA BIA | Chat, agente operacional, configuracoes, permissoes, canais, audio, WhatsApp, ferramentas e logs. | `app/dashboard/ia`, `components/ai-assistant.tsx`, `app/api/ia/*`, `app/api/assistant/*` |
| Portal empresa | Area para empresas/solicitantes acompanharem viagens, pedidos, vouchers, financeiro e ESG conforme permissao. | `app/dashboard/portal-empresa/page.tsx`, `app/dashboard/solicitantes`, `lib/solicitantes-storage.ts` |
| Empresas | Cadastro de clientes, dados comerciais, centro de custo, cobranca, politicas, solicitantes e relacao com funcionarios. | `app/dashboard/empresas/*`, `types/index.ts` |
| Funcionarios/Viajantes | Cadastro de viajantes, documentos, preferencias, cargo, centro de custo, arquivos e historico. | `app/dashboard/funcionarios/*`, `components/ui/importar-funcionarios-modal.tsx` |
| Hoteis | Cadastro de hoteis, cidade/UF, tarifas, faturamento, formas de pagamento e observacoes. | `app/dashboard/hoteis/*`, `lib/store.ts` |
| Financeiro operacional | Contas a pagar/receber, faturas, saldo, carteira corporativa, Pix, cartoes fisicos/virtuais e movimentos. | `app/dashboard/financeiro/page.tsx`, `lib/financeiro.ts`, `lib/corporate-finance.ts` |
| Reconciliacao | Conferencia de divergencias, alertas de valor/status e validacao entre demandas, vouchers e financeiro. | `app/dashboard/reconciliacao/page.tsx`, `lib/reconciliacao.ts` |
| Aprovacoes | Workflow de aprovacao por politica, custo, nivel e permissao. | `app/dashboard/aprovacoes/page.tsx`, `lib/approval-workflow.ts` |
| Risco/Duty of Care | Centro de risco, viajantes em campo, mapa operacional, alertas de viagem e status de deslocamento. | `app/dashboard/risco/page.tsx`, `lib/duty-of-care.ts`, `lib/operational-alerts.ts` |
| Relatorios e BI | Resumos executivos, indicadores, relatorios por empresa/agente e inteligencia operacional. | `app/dashboard/relatorios`, `app/relatorios/*`, `lib/agregacoes.ts` |
| Produtividade | Produtividade por agente, SLA, carga operacional e acompanhamento de equipe. | `app/dashboard/produtividade/page.tsx`, `lib/sla.ts` |
| Sustentabilidade/ESG | Pegada de carbono e indicadores ESG vinculados a viagens. | `app/dashboard/sustentabilidade/page.tsx`, `lib/esg-carbon.ts` |
| Auditoria | Trilha de acoes, logs, eventos de IA, logs de integracao e suporte a compliance. | `app/dashboard/auditoria`, `app/api/audit/logs`, `lib/audit.ts` |
| Importacao geral | Importacao de empresas, funcionarios, hoteis, vouchers, mapa de producao e bases Wintour. | `app/dashboard/importar/page.tsx`, `lib/import-pipeline.ts`, `lib/detector-arquivo.ts` |
| Usuarios e permissoes | Cadastro de usuarios internos, perfis BBT e matriz de permissoes. | `app/dashboard/usuarios/page.tsx`, `types/index.ts` |
| Configuracoes | Configuracoes gerais, limpeza controlada de dados, IA, integracoes, sistema e ambiente. | `app/dashboard/configuracoes/page.tsx` |
| Perfil | Dados do usuario autenticado, indicadores pessoais e informacoes de acesso. | `app/dashboard/meu-perfil/page.tsx` |

---

## 2. Funcionalidades encontradas

### 2.1 Operacao de viagens

- Criar demandas manualmente.
- Criar demandas a partir da caixa de entrada.
- Extrair dados de texto informal, e-mail, arquivo, PDF, imagem e audio.
- Classificar demandas por tipo: Aereo, Hotel, Carro, Pacote e Outro.
- Definir prioridade: baixa, media, alta e urgente.
- Gerar serial/OS para demanda.
- Vincular demandas a vouchers, reservas, financeiro e relatorios.
- Filtrar demandas por status, empresa, responsavel, datas e prioridade.
- Acompanhar check-in, check-out, viagens proximas, viagens em campo e alertas.
- Criar e editar vouchers de hotel, aereo, carro e pacote.
- Importar vouchers emitidos e manter vinculo com atendimento.
- Visualizar detalhes de voucher por ID.
- Criar cotacao/reserva vinculada a uma demanda/OS.

### 2.2 Wintour

- Importar vendas/emissoes por arquivo.
- Ler XML/XLSX/PDF/CSV conforme parser disponivel.
- Conferir pre-importacao antes de sincronizar.
- Detectar duplicidades.
- Mapear empresa, viajante, valores, tipo de servico, status, check-in/check-out quando disponivel no arquivo.
- Mapear emissor/agente por venda.
- Criar/atualizar demanda finalizada a partir da venda importada.
- Alimentar financeiro e vouchers a partir das importacoes.
- Guardar historico de importacao.

### 2.3 IA BIA

- Chat operacional com dados do sistema.
- Uso de OpenAI como cerebro principal quando `OPENAI_API_KEY` estiver configurada.
- Uso opcional de Gemini para apoio de busca/hoteis quando configurado.
- Busca web via OpenAI Responses ou Gemini, conforme roteamento.
- Extracao de demanda via IA.
- Extracao de documento via IA.
- Busca de hotel via IA.
- Transcricao de audio com OpenAI.
- Geracao de audio/TTS.
- Configuracoes de personalidade, tom, regras, limites e permissoes.
- Ferramentas internas da assistente.
- Logs, auditoria, saude da IA, conversas e testes.
- Envio/registro de voucher por canal assistido.
- Canais de WhatsApp com endpoints de conectar/desconectar/status/QR code.

### 2.4 Reservas, fornecedores e Tech Travel

- Status de integracao Tech.
- Login/sessao Tech.
- Selecao/acesso de empresa provedora na Tech.
- Buscar empresas disponiveis no provedor.
- Buscar cidades.
- Criar cotacao aerea.
- Tarifacao aerea.
- Criar cotacao de hotelaria.
- Criar reserva aerea/hotelaria quando confirmado e endpoint estiver habilitado.
- Preparar reservas para servicos cujo endpoint final dependa do contrato Tech.
- Consultar status de reserva.
- Emitir reserva.
- Cancelar reserva.
- Cancelar bilhete.
- Consultar dados de voucher.
- Consultar politicas, centros de custo, motivos, campos adicionais, churning e bilhetes reutilizaveis.

### 2.5 Cadastros e CRM

- Cadastrar empresas/clientes.
- Configurar cobranca por empresa: markup, taxa percentual, taxa fixa, SLA e observacoes.
- Cadastrar funcionarios/viajantes.
- Registrar documentos pessoais, passaporte, CNH, RG/CPF, preferencias, milhagem, cargo e centro de custo.
- Importar funcionarios por planilha.
- Cadastrar hoteis, tarifas e condicoes de faturamento.
- Importar hoteis por planilha.
- Registrar solicitantes de empresas e permissoes de portal.
- Criar politicas por cargo.

### 2.6 Financeiro

- Gerar lancamentos de contas a pagar e receber.
- Controlar status financeiro: aberto, pago, parcial, atrasado, cancelado.
- Emitir/organizar faturas corporativas.
- Vincular financeiro a demandas e vouchers.
- Controlar carteira corporativa por empresa.
- Registrar Pix, cartao, fatura, ajuste, credito, debito e estorno.
- Representar cartoes fisicos e virtuais.
- Controlar status de carteira e cartoes.
- Apurar saldo previsto.
- Reconciliar divergencias.

### 2.7 Gestao, relatorios e compliance

- Dashboard com periodos/filtros.
- Relatorios executivos e operacionais.
- Relatorios por empresa e por agente.
- Produtividade por agente.
- SLA operacional.
- Auditoria de acoes.
- Logs de integracao.
- Logs de IA.
- Alertas operacionais.
- ESG/pegada de carbono.
- Centro de risco/duty of care.

### 2.8 Infraestrutura e producao

- Projeto Next.js com build/start.
- Deploy previsto em Ubuntu Server 24.04 LTS.
- Suporte a PostgreSQL.
- Scripts e schemas de banco.
- Nginx.
- systemd.
- Script de backup PostgreSQL.
- Configuracao por variaveis de ambiente.
- Storage hibrido: PostgreSQL/app_kv e fallback local conforme configuracao.

---

## 3. Endpoints/API encontrados

### 3.1 Autenticacao, sessao, saude e storage

| Metodo | Endpoint | Descricao |
|---|---|---|
| POST | `/api/auth/login` | Autentica usuario. |
| POST | `/api/auth/logout` | Encerra sessao. |
| GET | `/api/auth/session` | Retorna sessao atual e exigencia de login. |
| GET | `/api/health` | Health check geral. |
| GET | `/api/storage` | Le storage compartilhado. |
| PUT | `/api/storage` | Atualiza storage compartilhado. |
| DELETE | `/api/storage` | Limpa storage compartilhado. |
| GET | `/api/audit/logs` | Consulta logs de auditoria. |

### 3.2 IA BIA

| Metodo | Endpoint | Descricao |
|---|---|---|
| GET | `/api/ia` | Status do provedor de IA pago/local. |
| POST | `/api/ia` | Chat/gateway principal da IA. |
| POST | `/api/ia/search` | Busca assistida pela IA. |
| POST | `/api/ia/hotel-search` | Busca de hoteis com IA/web. |
| POST | `/api/ia/extract-demand` | Extracao estruturada de demanda. |
| POST | `/api/ia/extract-document` | Extracao estruturada de documentos/imagens/PDF. |

### 3.3 Assistente, voz, WhatsApp e ferramentas

| Metodo | Endpoint | Descricao |
|---|---|---|
| GET | `/api/assistant/health` | Saude da assistente. |
| GET | `/api/assistant/settings` | Consulta configuracoes da IA. |
| PUT | `/api/assistant/settings` | Salva configuracoes da IA. |
| GET | `/api/assistant/tools` | Lista ferramentas da IA. |
| PUT | `/api/assistant/tools/[id]` | Atualiza ferramenta/permissao. |
| GET | `/api/assistant/logs` | Consulta logs da assistente. |
| GET | `/api/assistant/audit` | Consulta auditoria da assistente. |
| GET | `/api/assistant/conversations` | Lista conversas. |
| POST | `/api/assistant/test-message` | Testa mensagem da assistente. |
| POST | `/api/assistant/test-audio` | Testa audio. |
| POST | `/api/assistant/audio/transcribe` | Transcreve audio. |
| POST | `/api/assistant/audio/generate` | Gera audio/TTS. |
| POST | `/api/assistant/pdf/generate` | Gera PDF pela assistente. |
| POST | `/api/assistant/voucher/send` | Prepara/envia voucher via canal. |
| GET | `/api/assistant/whatsapp/status` | Status WhatsApp. |
| GET | `/api/assistant/whatsapp/qrcode` | QR code WhatsApp. |
| POST | `/api/assistant/whatsapp/connect` | Conecta WhatsApp. |
| POST | `/api/assistant/whatsapp/disconnect` | Desconecta WhatsApp. |

### 3.4 Integracoes e Tech Travel

| Metodo | Endpoint | Descricao |
|---|---|---|
| GET | `/api/integrations/status` | Status geral das integracoes. |
| GET | `/api/integrations/tech/status` | Health/status da Tech Travel. |
| GET | `/api/integrations/tech/companies` | Lista empresas da Tech. |
| POST | `/api/integrations/tech/access-company` | Seleciona/acessa empresa na Tech. |

### 3.5 Travel API

| Metodo | Endpoint | Descricao |
|---|---|---|
| POST | `/api/travel/quotes` | Cria cotacao por servico. |
| POST | `/api/travel/quotes/[id]/fare` | Tarifa cotacao aerea. |
| POST | `/api/travel/reservations` | Cria/prepara reserva. |
| GET | `/api/travel/reservations/[id]/status` | Consulta status de reserva. |
| POST | `/api/travel/reservations/[id]/issue` | Emite reserva. |
| POST | `/api/travel/reservations/[id]/cancel` | Cancela reserva. |
| POST | `/api/travel/reservations/[id]/cancel-ticket` | Cancela bilhete. |
| POST | `/api/travel/reservations/[id]/voucher-data` | Consulta dados de voucher da reserva. |
| POST | `/api/travel/tech/cities` | Busca cidades Tech. |
| GET | `/api/travel/tech/policies` | Consulta politicas Tech. |
| GET | `/api/travel/tech/cost-centers` | Consulta centros de custo Tech. |
| GET | `/api/travel/tech/motives` | Consulta motivos Tech. |
| GET | `/api/travel/tech/additional-fields` | Consulta campos adicionais Tech. |
| POST | `/api/travel/tech/churning` | Consulta churning. |
| GET | `/api/travel/tech/reusable-tickets` | Consulta bilhetes reutilizaveis. |

### 3.6 Portal empresa/solicitantes

| Metodo | Endpoint | Descricao |
|---|---|---|
| POST | `/api/solicitantes/empresa` | Operacao de solicitante/portal empresa conforme payload enviado. |

---

## 4. Telas encontradas

### 4.1 Acesso

- `/` - entrada/redirecionamento inicial.
- `/login` - tela de login corporativa.

### 4.2 Operacao interna

- `/dashboard` - Dashboard executivo.
- `/dashboard/caixa-entrada` - Entrada de demandas.
- `/dashboard/demandas` - Demandas e vouchers.
- `/dashboard/vouchers` - Lista de vouchers.
- `/dashboard/vouchers/novo` - Novo voucher.
- `/dashboard/vouchers/[id]` - Detalhe do voucher.
- `/dashboard/vouchers/[id]/editar` - Edicao de voucher.
- `/dashboard/voucher/[id]` - rota legada/redirecionamento.
- `/dashboard/voucher/novo` - rota legada/redirecionamento.
- `/dashboard/reservas` - Reservas e cotacoes via fornecedores/Tech.
- `/dashboard/aprovacoes` - Aprovacoes.
- `/dashboard/risco` - Centro de risco/duty of care.

### 4.3 Inteligencia artificial

- `/dashboard/ia` - Central IA BIA unificada.
- `/dashboard/ia-chat` - rota legada redirecionada para a Central IA BIA.
- `/dashboard/ia-operacional` - rota legada redirecionada para a Central IA BIA.
- `/dashboard/assistente` - rota legada redirecionada para a Central IA BIA.

### 4.4 Integracoes e importacoes

- `/dashboard/wintour` - Importacao Wintour.
- `/dashboard/importar` - Importador geral.
- `/dashboard/emissoes` - Emissoes avulsas/importador legado.

### 4.5 Cadastros

- `/dashboard/empresas` - Empresas.
- `/dashboard/empresas/[id]` - Detalhe da empresa, funcionarios, solicitantes, politicas, atendimentos e emissoes.
- `/dashboard/funcionarios` - Viajantes/funcionarios.
- `/dashboard/funcionarios/[id]` - Detalhe do viajante.
- `/dashboard/hoteis` - Hoteis.
- `/dashboard/hoteis/[id]` - Detalhe do hotel.
- `/dashboard/solicitantes` - Solicitantes/acessos empresariais.

### 4.6 Financeiro, gestao e administracao

- `/dashboard/financeiro` - Financeiro operacional, faturas, carteira e cartoes.
- `/dashboard/reconciliacao` - Reconciliacao.
- `/dashboard/produtividade` - Equipe e produtividade.
- `/dashboard/relatorios` - Relatorios e BI.
- `/relatorios/agente` - Relatorio por agente.
- `/relatorios/empresa` - Relatorio por empresa.
- `/dashboard/sustentabilidade` - Sustentabilidade/ESG.
- `/dashboard/auditoria` - Auditoria.
- `/dashboard/usuarios` - Usuarios e permissoes.
- `/dashboard/configuracoes` - Configuracoes do sistema.
- `/dashboard/meu-perfil` - Perfil do usuario.
- `/dashboard/portal-empresa` - Portal da empresa/solicitante.

---

## 5. Integracoes encontradas

| Integracao | Tipo | Status tecnico identificado | Observacoes |
|---|---|---|---|
| OpenAI | IA generativa, busca, audio, visao/documentos | Implementada por API quando `OPENAI_API_KEY` existir. | Modelo padrao configurado como `gpt-5.2`; transcricao por `gpt-4o-transcribe`; TTS por `gpt-4o-mini-tts`. |
| Gemini | IA/busca/hotelaria auxiliar | Opcional por `GEMINI_API_KEY`. | Usado principalmente quando roteamento de busca/hotel apontar para Gemini. |
| Tech Travel/TTravel | Hub de fornecedores de viagem | Implementado em adaptador e endpoints internos. | Cobre aereo, hotelaria, locacao, pacotes, lazer, transfer, seguro e rodoviario conforme endpoints/contrato Tech. |
| Wintour | Integracao por arquivo | Implementada por importador. | Fluxo correto para exportacao diaria sem API direta: arquivo exportado do Wintour alimenta demandas, vouchers e financeiro. |
| WhatsApp | Atendimento/canal da IA | Estrutura de configuracao e endpoints presente. | Provedor default `evolution_api`. Precisa credenciais e webhook reais para producao. |
| PostgreSQL | Banco de dados producao | Schemas e camada `pg` presentes. | Projeto ainda preserva compatibilidade com storage chave-valor/fallback local. |
| Nginx/systemd | Deploy producao | Arquivos em `deploy/`. | Configurado para Ubuntu 24.04 LTS. |
| Backup PostgreSQL | Infraestrutura | Script presente. | Necessita agendamento em cron/systemd timer no servidor. |
| Leaflet | Mapas | Dependencia instalada. | Usado para mapa operacional/duty of care. |
| PDF parsing | Leitura/importacao | `pdfjs-dist`. | Usado em vouchers, documentos e importacoes. |
| XLSX/CSV parsing | Importacao | `@e965/xlsx` e `papaparse`. | Usado para Wintour e bases cadastrais. |
| QR Code | WhatsApp | `qrcode.react`. | Exibicao de QR code para sessao/canal. |

---

## 6. Banco de dados e estruturas encontradas

### 6.1 Schemas de producao

Arquivos encontrados:

- `deploy/postgres/schema.sql`
- `deploy/postgres/assistant-schema.sql`
- `deploy/postgres/production-core-schema.sql`
- `deploy/postgres/techtravel-schema.sql`
- `lib/supabase-schema.sql`
- `lib/bbt-unified-schema.sql`

### 6.2 Principais tabelas do schema core

- `tenants`
- `companies`
- `users`
- `user_credentials`
- `roles`
- `permissions`
- `role_permissions`
- `company_memberships`
- `user_sessions`
- `employees`
- `requesters`
- `hotels`
- `demands`
- `demand_events`
- `approvals`
- `reservations`
- `vouchers`
- `files`
- `generated_documents_core`
- `financial_entries`
- `import_jobs`
- `audit_logs`

### 6.3 Principais tabelas da assistente

- `assistant_settings`
- `assistant_voice_settings`
- `assistant_tools`
- `assistant_tool_logs`
- `assistant_audit_logs`
- `whatsapp_sessions`
- `whatsapp_connection_logs`
- `conversations`
- `conversation_participants`
- `conversation_messages`
- `generated_documents`
- `voucher_send_logs`
- `audio_transcription_logs`

### 6.4 Principais tabelas Tech Travel

- `integration_connections`
- `provider_company_links`
- `integration_logs`
- `travel_quotes`
- `travel_reservations`

---

## 7. Usuarios, perfis e permissoes encontrados

### 7.1 Tipos de usuario

- `master`
- `company_admin`
- `colaborador`

### 7.2 Perfis internos BBT

- `lider`
- `gestor_financeiro`
- `supervisor`
- `agente`
- `operacional`

### 7.3 Permissoes mapeadas

- Ver financeiro.
- Editar financeiro.
- Cadastrar empresas.
- Cadastrar funcionarios/viajantes.
- Cadastrar hoteis.
- Editar politicas.
- Gerar relatorios.
- Importar planilhas.
- Ver produtividade de todos.
- Gerenciar usuarios.
- Excluir demandas.
- Aprovar demandas.

### 7.4 Solicitantes de empresa

O sistema possui estrutura para solicitantes vinculados a empresas com:

- Nome, e-mail e telefone.
- Empresa.
- Centro de custo.
- Area/departamento/cargo.
- Permissao para criar pedido.
- Permissao para ver vouchers.
- Permissao para ver financeiro.
- Limite por pedido.
- Status ativo/bloqueado/pendente.

---

## 8. Tecnologias encontradas

| Camada | Tecnologia |
|---|---|
| Front-end | Next.js 15.5.18, React 18.3.1, TypeScript, Tailwind CSS |
| UI/UX | Lucide React, Recharts, Leaflet, QR Code React, Sonner |
| Estado/storage | Zustand, storage local/server, PostgreSQL/app_kv |
| Back-end | Next.js API routes, Node.js |
| Banco | PostgreSQL com `pg` |
| Validacao | Zod |
| Arquivos | PDF.js, PapaParse, XLSX alias `@e965/xlsx` |
| IA | OpenAI Responses API, OpenAI audio, Gemini opcional |
| Deploy | Ubuntu 24.04 LTS, Node.js LTS, Nginx, systemd, PostgreSQL |

---

## 9. Informacoes ausentes que precisam ser confirmadas

1. **Nome juridico/comercial da empresa responsavel** pelo sistema e nome que deve aparecer na capa dos documentos.
2. **Nome final do produto**: o codigo usa `BBT Corporate` com tagline `TRAVEL · ELITE`. Confirmar se este sera o nome oficial dos PDFs.
3. **Versao oficial do documento**: sugestao inicial `v1.0 - 2026`.
4. **Dominio de producao** que sera usado no servidor.
5. **Contato de suporte**: e-mail, telefone/WhatsApp e horario/SLA.
6. **Politica comercial de suporte/manutencao**: mensal, sob demanda, 24h, horario comercial etc.
7. **Credenciais reais da Tech Travel/TTravel** e quais modulos estao contratados: aereo, hotel, locacao, pacotes, transfer, seguro, rodoviario.
8. **Fornecedores habilitados dentro da Tech** por categoria.
9. **Provedor oficial de WhatsApp**: Evolution API, Meta Cloud API, Z-API, Twilio ou outro.
10. **URL de webhook do WhatsApp** e regra de autenticacao do provedor.
11. **Provedor financeiro real** para Pix, carteira digital e cartoes corporativos, caso a funcao saia de controle operacional para transacao real.
12. **Politica de emissao/cancelamento**: quais acoes a IA pode executar sozinha e quais exigem aprovacao humana.
13. **Matriz final de permissoes** por perfil e por modulo.
14. **Politica LGPD**: retencao de dados, base legal, consentimento, descarte, anonimização e acesso a dados pessoais.
15. **Retencao de backups**: diaria/semanal/mensal e prazo.
16. **Ambientes oficiais**: desenvolvimento, homologacao e producao com URLs.
17. **Credenciais iniciais de administrador** para implantacao.
18. **Se a API externa sera publica para clientes/integradores** ou apenas interna do front-end.
19. **Padrao de numeracao oficial** para demanda/serial/OS e voucher.
20. **Nivel de precisao esperado e provedor para OCR/documentos**: OpenAI Vision, Google Vision, Azure Document Intelligence ou outro.
21. **Fluxo oficial de Outlook/e-mail**: drag-and-drop de arquivo, Microsoft Graph, mailbox compartilhada ou encaminhamento para e-mail monitorado.
22. **Politica de auditoria**: quais eventos sao obrigatorios para compliance.
23. **Logo oficial em alta resolucao** para capa dos PDFs.
24. **CNPJ/dados institucionais** que devem aparecer na apresentacao.

---

## 10. Estrutura sugerida - Documento 1: Apresentacao profissional

Titulo sugerido: `BBT Corporate TRAVEL ELITE - Apresentacao Profissional`

1. Capa
2. Sumario
3. Visao geral
4. Problema de mercado
5. Proposta de valor
6. Objetivos do sistema
7. Publico-alvo e perfis de uso
8. Beneficios operacionais
9. Beneficios financeiros
10. Beneficios para gestao e compliance
11. Jornada geral de uso
12. Modulos do sistema
    - Dashboard executivo
    - Entrada de demandas
    - Demandas e vouchers
    - Wintour
    - Reservas e cotacoes
    - Central IA BIA
    - Portal empresa
    - Cadastros
    - Financeiro
    - Relatorios/BI
    - Risco/Duty of Care
    - Auditoria
13. IA BIA como cerebro operacional
14. Fluxo de importacao Wintour
15. Fluxo de reserva via Tech Travel
16. Fluxo do portal empresa
17. Indicadores e relatorios
18. Seguranca e confiabilidade
19. Implantacao em alto nivel
20. Suporte, manutencao e evolucao
21. Conclusao executiva
22. Anexo: informacoes a confirmar

---

## 11. Estrutura sugerida - Documento 2: Documentacao tecnica/API/implantacao

Titulo sugerido: `BBT Corporate TRAVEL ELITE - Documentacao Tecnica, API e Implantacao`

1. Capa tecnica
2. Sumario tecnico
3. Objetivo e escopo
4. Visao geral da arquitetura
5. Stack tecnologica
6. Estrutura de pastas
7. Modulos internos
8. Modelo de dados
9. Banco de dados PostgreSQL
10. Storage e compatibilidade app_kv/fallback local
11. Autenticacao e autorizacao
12. Perfis e permissoes
13. Variaveis de ambiente
14. Instalacao local
15. Deploy Ubuntu 24.04 LTS
16. Configuracao Nginx
17. Configuracao systemd
18. Configuracao SSL/HTTPS
19. Backup e restore
20. Monitoramento
21. Documentacao de API
    - Auth/session/storage
    - IA BIA
    - Assistant/WhatsApp/audio/PDF
    - Tech Travel
    - Travel quotes/reservations
    - Audit logs
    - Portal solicitantes
22. Integracao Tech Travel/TTravel
23. Integracao Wintour por arquivo
24. Integracao OpenAI/Gemini
25. Integracao WhatsApp
26. Financeiro/carteira/cartoes
27. Logs e auditoria
28. Seguranca tecnica
29. LGPD e protecao de dados
30. Troubleshooting
31. Checklist de implantacao
32. Glossario tecnico
33. Pendencias para producao
34. Conclusao tecnica

---

## 12. Observacoes tecnicas para a documentacao final

- A documentacao deve diferenciar claramente:
  - Funcoes implementadas no sistema.
  - Funcoes implementadas que dependem de credenciais reais.
  - Funcoes operacionais representadas no sistema, mas que exigem contrato/API externa para transacao real.
- A carteira corporativa e cartoes aparecem como estrutura operacional no sistema; para movimentacao financeira real, falta confirmar provedor bancario/fintech.
- A Tech Travel deve ser documentada como integracao principal de fornecedores, substituindo conectores individuais antigos.
- O Wintour deve ser documentado como integracao por arquivo exportado, nao como API direta, salvo confirmacao futura de API Wintour.
- A IA BIA deve ser documentada como camada de orquestracao e apoio operacional, com limites de permissao e auditoria.
- Para a versao de investidores, nao usar termos como "simulacao" ou "mock" como proposta do produto; quando necessario, tratar como "modo local", "ambiente de homologacao" ou "dependente de credencial".

