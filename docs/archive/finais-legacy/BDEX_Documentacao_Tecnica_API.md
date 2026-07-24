# Documentação técnica, API e implantação

## 1. Sumário técnico

1. Introducao técnica
2. Arquitetura do sistema
3. Requisitos técnicos
4. Ambientes
5. Instalacao e ativacao
6. Configuracoes iniciais
7. Banco de dados
8. Autenticação e autorização
9. Documentação de API
10. Integrações externas
11. Webhooks
12. Logs e auditoria
13. Segurança técnica
14. Backup e recuperacao
15. Monitoramento
16. Troubleshooting
17. Checklist de implantação
18. Glossario técnico
19. Pendências tecnicas
20. Conclusão técnica

## 2. Introducao técnica

Este documento descreve a estrutura técnica do **BDEX**, sistema desenvolvido para gestao de viagens corporativas, demandas, vouchers, fornecedores, Wintour, financeiro, portal empresa e IA operacional.

### 2.1 Publico-alvo

- Equipes de TI.
- Desenvolvedores.
- Integradores.
- Suporte técnico.
- Administradores de infraestrutura.
- Responsaveis por implantação e manutenção.

### 2.2 Escopo

O documento cobre arquitetura, requisitos, ambiente, banco de dados, APIs, integrações, segurança, backup, monitoramento e troubleshooting. Informacoes ainda nao confirmadas estao sinalizadas como **[INFORMAÇÃO A CONFIRMAR]**.

## 3. Arquitetura do sistema

### 3.1 Visão geral

O BDEX é uma aplicacao web baseada em Next.js, React e TypeScript. O front-end e o back-end convivem no mesmo projeto por meio de rotas App Router e API Routes. O armazenamento de produção previsto e PostgreSQL, com compatibilidade de storage chave-valor/app_kv e fallback local para ambientes de desenvolvimento/homologacao.

### 3.2 Componentes principais

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Front-end | Next.js, React, TypeScript, Tailwind CSS | Interfaces operacionais, dashboards, formularios e portal empresa. |
| Back-end | Next.js API Routes, Node.js | APIs internas, integrações, IA, autenticação e storage. |
| Banco | PostgreSQL | Dados centrais, sessoes, demandas, vouchers, financeiro, IA e auditoria. |
| IA | OpenAI e Gemini opcional | Chat, busca, extracao de dados, audio e automacao assistida. |
| Fornecedores | Tech Travel/TTravel | Hub para aéreo, hotelaria, locação, pacotes e outros serviços. |
| Wintour | Importacao por arquivo | Sincronizacao diaria de vendas/emissões. |
| WhatsApp | Evolution API | Canal de atendimento e IA BIA. |
| Infra | Ubuntu, Nginx, systemd, SSL | Hospedagem e operação em produção. |

### 3.3 Comunicacao entre componentes

1. Usuário acessa o front-end pelo navegador.
2. Front-end chama APIs internas em `/api/*`.
3. APIs validam sessao/permissão.
4. APIs leem/escrevem no storage ou PostgreSQL.
5. Quando necessário, APIs chamam OpenAI, Gemini, Tech Travel ou WhatsApp.
6. Logs e auditoria registram ações relevantes.

## 4. Requisitos técnicos

### 4.1 Servidor recomendado

| Item | Requisito |
|---|---|
| Sistema operacional | Ubuntu Server 24.04 LTS 64-bit |
| Memoria RAM | 16 GB |
| Processador | 6 a 8 vCPU |
| Disco | 250 GB NVMe SSD |
| Acesso | root/SSH |
| Banco de dados | PostgreSQL |
| Web server | Nginx |
| Runtime | Node.js LTS, minimo Node 20.9+ |
| Extras | SSL/HTTPS, firewall, backup diario automatico e snapshot semanal |

### 4.2 Navegadores suportados

- Google Chrome atual.
- Microsoft Edge atual.
- Navegadores Chromium recentes.

### 4.3 Dependencias principais

| Dependencia | Uso |
|---|---|
| `next` | Aplicacao web e API routes. |
| `react` / `react-dom` | Interface. |
| `typescript` | Tipagem. |
| `tailwindcss` | Estilo. |
| `pg` | PostgreSQL. |
| `zod` | Validação. |
| `recharts` | Graficos. |
| `leaflet` | Mapas. |
| `pdfjs-dist` | Leitura de PDFs. |
| `papaparse` | CSV. |
| `xlsx` alias `@e965/xlsx` | Planilhas. |
| `qrcode.react` | QR code do WhatsApp. |

## 5. Ambientes

| Ambiente | Objetivo | Observacao |
|---|---|---|
| Desenvolvimento | Evolucao local do sistema. | Pode usar `.env.local` e storage local. |
| Homologacao | Testes com equipe piloto. | Deve usar banco compartilhado e chaves de teste. |
| Produção | Uso oficial. | Deve usar HTTPS, PostgreSQL, backup e credenciais reais. |

### 5.1 Variaveis de ambiente principais

| Variavel | Obrigatoria | Descricao |
|---|---|---|
| `PORT` | Sim | Porta do Next.js. |
| `APP_URL` | Sim | URL publica da aplicacao. |
| `NEXT_PUBLIC_APP_URL` | Sim | URL publica usada no front-end. |
| `DATABASE_URL` | Sim em produção | String de conexao PostgreSQL. |
| `DATABASE_SSL` | Conforme provedor | Habilita TLS no banco. |
| `AUTH_SECRET` | Sim | Segredo de sessao. |
| `AUTH_REQUIRE_SESSION` | Sim | Exige sessao nas APIs protegidas. |
| `BBT_SUPER_MASTER_PASSWORD` | Sim | Senha administrativa inicial. |
| `OPENAI_API_KEY` | Sim para IA completa | Chave do cerebro IA principal. |
| `OPENAI_MODEL` | Sim | Modelo principal, padrao `gpt-5.2`. |
| `GEMINI_API_KEY` | Opcional | Busca/hotéis via Gemini quando configurado. |
| `TECH_API_ENABLED` | Sim para Tech | Liga/desliga integração Tech. |
| `TECH_API_BASE_URL` | Sim para Tech | Base URL da Tech Travel. |
| `TECH_API_LOGIN` | Sim para Tech | Login Tech. |
| `TECH_API_PASSWORD` | Sim para Tech | Senha Tech. |
| `TECH_API_KEY` | Se exigida | Chave adicional da Tech. |
| `WHATSAPP_PROVIDER` | Sim para WhatsApp | Provedor: Evolution API. |
| `WHATSAPP_API_BASE_URL` | Sim para WhatsApp | URL da API WhatsApp. |
| `WHATSAPP_API_KEY` | Sim para WhatsApp | Token/chave. |
| `WHATSAPP_INSTANCE_ID` | Sim para WhatsApp | Instancia. |

## 6. Instalacao ou ativacao do sistema

### 6.1 Preparacao do servidor

~~~bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx postgresql postgresql-contrib ufw certbot python3-certbot-nginx
~~~

Instalar Node.js LTS 20.9+ ou superior:

~~~bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
~~~

### 6.2 Banco PostgreSQL

~~~bash
sudo -u postgres psql
CREATE DATABASE bbt_corporate;
CREATE USER bbt_user WITH ENCRYPTED PASSWORD 'SENHA_FORTE';
GRANT ALL PRIVILEGES ON DATABASE bbt_corporate TO bbt_user;
\q
~~~

Executar schemas:

~~~bash
psql "$DATABASE_URL" -f deploy/postgres/schema.sql
psql "$DATABASE_URL" -f deploy/postgres/assistant-schema.sql
psql "$DATABASE_URL" -f deploy/postgres/production-core-schema.sql
psql "$DATABASE_URL" -f deploy/postgres/techtravel-schema.sql
~~~

### 6.3 Build e start

~~~bash
npm ci
npm run build
npm run start
~~~

Para produção, usar systemd com o arquivo base em `deploy/systemd/bbt-corporate.service`.

### 6.4 Nginx e SSL

Usar o arquivo base em `deploy/nginx/bbt-corporate.conf`, ajustar dominio final e ativar SSL:

~~~bash
sudo ln -s /etc/nginx/sites-available/bbt-corporate.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d SEU_DOMINIO
~~~

Dominio de produção: **[INFORMAÇÃO A CONFIRMAR - será informado na versão final]**.

## 7. Configuracoes iniciais

1. Configurar `.env.local` ou variaveis de ambiente no servidor.
2. Configurar banco PostgreSQL.
3. Configurar usuário master.
4. Configurar OpenAI para IA completa.
5. Configurar Tech Travel como integração principal.
6. Configurar Evolution API para WhatsApp.
7. Cadastrar empresas.
8. Cadastrar solicitantes e permissões.
9. Cadastrar viajantes/funcionarios.
10. Cadastrar politicas, centros de custo e regras financeiras.
11. Testar importacao Wintour.
12. Testar cotação/reserva Tech.
13. Testar portal empresa.
14. Testar relatórios, financeiro, auditoria e backup.

## 8. Banco de dados

### 8.1 Tipo de banco

Banco previsto para produção: **PostgreSQL**.

O projeto tambem preserva compatibilidade com storage chave-valor/app_kv e fallback local para ambientes de transicao, desenvolvimento ou homologacao.

### 8.2 Principais tabelas do core

| Tabela | Finalidade |
|---|---|
| `tenants` | Estrutura SaaS/multiempresa. |
| `companies` | Empresas clientes. |
| `users` | Usuários internos e externos. |
| `user_credentials` | Credenciais e senha. |
| `roles` / `permissions` | Controle de acesso. |
| `company_memberships` | Vinculo usuário-empresa. |
| `user_sessions` | Sessoes. |
| `employees` | Viajantes/funcionarios. |
| `requesters` | Solicitantes das empresas. |
| `hotels` | Hotéis cadastrados. |
| `demands` | Demandas/solicitações. |
| `demand_events` | Histórico da demanda. |
| `approvals` | Aprovações. |
| `reservations` | Reservas. |
| `vouchers` | Vouchers emitidos. |
| `files` | Arquivos anexos. |
| `financial_entries` | Lancamentos financeiros. |
| `import_jobs` | Importacoes. |
| `audit_logs` | Auditoria. |

### 8.3 Tabelas da IA/assistente

| Tabela | Finalidade |
|---|---|
| `assistant_settings` | Configuracoes da IA BIA. |
| `assistant_voice_settings` | Voz e audio. |
| `assistant_tools` | Ferramentas permitidas. |
| `assistant_tool_logs` | Execucoes de ferramentas. |
| `assistant_audit_logs` | Auditoria da IA. |
| `whatsapp_sessions` | Sessao WhatsApp. |
| `conversations` | Conversas. |
| `conversation_messages` | Mensagens. |
| `generated_documents` | Documentos gerados. |
| `voucher_send_logs` | Envio de vouchers. |
| `audio_transcription_logs` | Logs de transcrição. |

### 8.4 Tabelas Tech Travel

| Tabela | Finalidade |
|---|---|
| `integration_connections` | Conexoes externas. |
| `provider_company_links` | Relacao empresa BDEX x empresa provedor. |
| `integration_logs` | Logs da Tech. |
| `travel_quotes` | Cotacoes. |
| `travel_reservations` | Reservas. |

## 9. Autenticação e autorização

### 9.1 Login

O login usa endpoint interno `/api/auth/login`. Em produção, APIs protegidas devem usar `AUTH_REQUIRE_SESSION=true`.

### 9.2 Perfis de usuário

- `master`
- `company_admin`
- `colaborador`

### 9.3 Perfis internos BBT

- `lider`
- `gestor_financeiro`
- `supervisor`
- `agente`
- `operacional`

### 9.4 Permissões principais

| Permissão | Uso |
|---|---|
| `ver_financeiro` | Visualizar módulo financeiro. |
| `editar_financeiro` | Alterar dados financeiros. |
| `cadastrar_empresas` | Criar/editar empresas. |
| `cadastrar_funcionarios` | Criar/editar viajantes. |
| `cadastrar_hoteis` | Criar/editar hotéis. |
| `editar_politicas` | Alterar politicas. |
| `gerar_relatorios` | Acessar relatórios. |
| `importar_planilhas` | Importar Wintour e bases. |
| `ver_produtividade_todos` | Ver produtividade geral. |
| `gerenciar_usuarios` | Gerenciar usuários. |
| `excluir_demandas` | Excluir demandas. |
| `aprovar_demandas` | Aprovar exceções. |

## 10. Documentação de API

Padrao geral:

- Base URL: `https://SEU_DOMINIO`
- Content-Type: `application/json`
- Autenticação: sessao/cookie quando `AUTH_REQUIRE_SESSION=true`
- Respostas de erro devem retornar JSON com `ok: false` ou `error`

### 10.1 Autenticação, storage e auditoria

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | Autentica usuário. | `{ "email": "...", "password": "..." }` | Usuário e sessao. | 400, 401, 500 |
| POST | `/api/auth/logout` | Encerra sessao. | vazio | Confirmação. | 500 |
| GET | `/api/auth/session` | Consulta sessao atual. | vazio | Usuário atual e exigencia de sessao. | 500 |
| GET | `/api/health` | Health check. | vazio | Status da aplicacao. | 500 |
| GET | `/api/storage` | Le storage compartilhado. | vazio/query interna | Dados salvos. | 401, 500 |
| PUT | `/api/storage` | Atualiza storage. | JSON de dados. | Confirmação. | 400, 401, 500 |
| DELETE | `/api/storage` | Limpa storage. | vazio | Confirmação. | 401, 500 |
| GET | `/api/audit/logs` | Consulta logs de auditoria. | filtros opcionais | Lista de logs. | 401, 403, 500 |

Exemplo de login:

~~~http
POST /api/auth/login
Content-Type: application/json

{
  "email": "usuário@empresa.com",
  "password": "senha"
}
~~~

Resposta esperada:

~~~json
{
  "ok": true,
  "user": {
    "id": "user_id",
    "email": "usuário@empresa.com",
    "name": "Nome do Usuário",
    "role": "master"
  }
}
~~~

### 10.2 IA BIA

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| GET | `/api/ia` | Status do provedor IA. | vazio | Provedor, modelo e capacidades. | 500 |
| POST | `/api/ia` | Gateway principal da IA. | mensagens, task, provider, busca | Texto, fontes, uso e provedor. | 400, 401, 429, 503 |
| POST | `/api/ia/search` | Busca assistida. | pergunta/contexto | Resposta com fontes. | 401, 429, 503 |
| POST | `/api/ia/hotel-search` | Busca hotéis. | cidade/hotel/criterios | Lista/resumo de hotéis. | 401, 503 |
| POST | `/api/ia/extract-demand` | Extrai demanda. | texto/arquivo/conteudo | JSON estruturado. | 400, 401, 503 |
| POST | `/api/ia/extract-document` | Extrai documento. | imagem/PDF/base64 | Dados extraidos. | 400, 401, 503 |

Exemplo:

~~~http
POST /api/ia
Content-Type: application/json

{
  "task": "chat",
  "enable_search": true,
  "messages": [
    { "role": "user", "content": "Localize o voucher do Pedro para Brasilia em 15/08" }
  ]
}
~~~

### 10.3 Assistente, audio, PDF e WhatsApp

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| GET | `/api/assistant/health` | Saude da assistente. | vazio | Status. | 401, 500 |
| GET | `/api/assistant/settings` | Consulta configuracoes. | vazio | Configuracoes. | 401, 500 |
| PUT | `/api/assistant/settings` | Salva configuracoes. | JSON de configuracao | Configuracao atualizada. | 400, 401, 500 |
| GET | `/api/assistant/tools` | Lista ferramentas. | vazio | Ferramentas. | 401, 500 |
| PUT | `/api/assistant/tools/[id]` | Atualiza ferramenta. | permissão/status | Ferramenta atualizada. | 400, 401, 404 |
| GET | `/api/assistant/logs` | Logs da assistente. | filtros opcionais | Lista de logs. | 401, 500 |
| GET | `/api/assistant/audit` | Auditoria da IA. | filtros opcionais | Eventos. | 401, 500 |
| GET | `/api/assistant/conversations` | Conversas. | filtros opcionais | Lista. | 401, 500 |
| POST | `/api/assistant/test-message` | Testa mensagem. | texto | Resposta de teste. | 400, 401 |
| POST | `/api/assistant/test-audio` | Testa audio. | audio/base64 | Resultado. | 400, 401 |
| POST | `/api/assistant/audio/transcribe` | Transcreve audio. | arquivo/base64 | Texto transcrito. | 400, 401, 503 |
| POST | `/api/assistant/audio/generate` | Gera audio/TTS. | texto/voz | Audio/base64 ou URL. | 400, 401, 503 |
| POST | `/api/assistant/pdf/generate` | Gera PDF. | HTML/dados | Documento. | 400, 401 |
| POST | `/api/assistant/voucher/send` | Envia/prepara voucher. | voucher/canal | Status de envio. | 400, 401 |
| GET | `/api/assistant/whatsapp/status` | Status WhatsApp. | vazio | Status da instancia. | 401, 500 |
| GET | `/api/assistant/whatsapp/qrcode` | QR code WhatsApp. | vazio | QR code. | 401, 500 |
| POST | `/api/assistant/whatsapp/connect` | Conecta WhatsApp. | config opcional | Status. | 400, 401 |
| POST | `/api/assistant/whatsapp/disconnect` | Desconecta WhatsApp. | vazio | Status. | 401, 500 |

### 10.4 Integrações e Tech Travel

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| GET | `/api/integrations/status` | Status geral das integrações. | vazio | Lista de provedores. | 401, 500 |
| GET | `/api/integrations/tech/status` | Status Tech Travel. | vazio | Conectado/configurado/capacidades. | 401, 500 |
| GET | `/api/integrations/tech/companies` | Empresas Tech. | vazio | Empresas provedoras. | 401, 500 |
| POST | `/api/integrations/tech/access-company` | Acessa empresa Tech. | `{ "companyId": "..." }` | Confirmação. | 400, 401, 503 |

### 10.5 Travel API

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| POST | `/api/travel/quotes` | Cria cotação. | serviço, origem, destino, datas, empresa | Cotação e opcoes. | 400, 401, 503 |
| POST | `/api/travel/quotes/[id]/fare` | Tarifa cotação aerea. | dados da opcao | Resultado tarifado. | 400, 401, 503 |
| POST | `/api/travel/reservations` | Cria/prepara reserva. | serviço, quoteId, optionId, passageiros, confirmed | Reserva. | 400, 401, 503 |
| GET | `/api/travel/reservations/[id]/status` | Consulta status. | id | Status. | 401, 404, 503 |
| POST | `/api/travel/reservations/[id]/issue` | Emite reserva. | payload Tech | Status emitido. | 400, 401, 503 |
| POST | `/api/travel/reservations/[id]/cancel` | Cancela reserva. | motivo/dados | Status cancelado. | 400, 401, 503 |
| POST | `/api/travel/reservations/[id]/cancel-ticket` | Cancela bilhete. | bilhete/motivo | Status. | 400, 401, 503 |
| POST | `/api/travel/reservations/[id]/voucher-data` | Consulta dados voucher. | id/localizador | Dados do voucher. | 400, 401, 503 |
| POST | `/api/travel/tech/cities` | Busca cidades. | query/serviço | Lista de cidades. | 400, 401, 503 |
| GET | `/api/travel/tech/policies` | Politicas Tech. | filtros opcionais | Politicas. | 401, 503 |
| GET | `/api/travel/tech/cost-centers` | Centros de custo Tech. | filtros opcionais | Centros de custo. | 401, 503 |
| GET | `/api/travel/tech/motives` | Motivos Tech. | filtros opcionais | Motivos. | 401, 503 |
| GET | `/api/travel/tech/additional-fields` | Campos adicionais. | filtros opcionais | Campos. | 401, 503 |
| POST | `/api/travel/tech/churning` | Consulta churning. | payload Tech | Resultado. | 400, 401, 503 |
| GET | `/api/travel/tech/reusable-tickets` | Bilhetes reutilizaveis. | filtros opcionais | Lista. | 401, 503 |

Exemplo de cotação:

~~~http
POST /api/travel/quotes
Content-Type: application/json

{
  "service": "hotelaria",
  "empresaId": "empresa_id",
  "destino": "Sao Paulo",
  "dataInicio": "2026-08-15",
  "dataFim": "2026-08-17",
  "adultos": 1
}
~~~

### 10.6 Portal empresa/solicitantes

| Metodo | Endpoint | Descricao | Body/Query | Response esperado | Erros comuns |
|---|---|---|---|---|---|
| POST | `/api/solicitantes/empresa` | Operacoes de solicitante/empresa conforme payload. | acao e dados do solicitante | Resultado da operação. | 400, 401, 403, 500 |

## 11. Integrações externas

### 11.1 Tech Travel/TTravel

Objetivo: ser o hub principal de fornecedores de viagem. Pela Tech Travel, o BDEX pode acessar serviços de aéreo, hotelaria, locação, pacotes, lazer, transfer, seguro e rodoviário conforme contrato e endpoints habilitados.

Dados enviados:

- Serviço desejado.
- Origem/destino.
- Datas.
- Passageiros/viajantes.
- Empresa provedora.
- Politica, centro de custo e campos adicionais quando disponiveis.

Dados recebidos:

- Opcoes de cotação.
- Tarifas.
- Reservas.
- Localizadores.
- Status.
- Dados de voucher.

Autenticação: credenciais Tech Travel em variaveis de ambiente.

### 11.2 Wintour

Objetivo: importar vendas/emissões realizadas no Wintour por arquivo exportado diariamente.

Formato: XML/XLSX/PDF/CSV conforme parser.

Fluxo:

1. Usuário exporta vendas do dia no Wintour.
2. Usuário importa arquivo no BDEX.
3. Sistema mostra previa.
4. Usuário revisa registros.
5. Sistema sincroniza demandas, vouchers e financeiro.

### 11.3 OpenAI

Objetivo: IA BIA, chat, interpretacao, busca, documentos, audio, TTS e automacoes assistidas.

Modelos configurados:

- `OPENAI_MODEL=gpt-5.2`
- `OPENAI_PRO_MODEL=gpt-5.2-pro`
- `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe`
- `OPENAI_TTS_MODEL=gpt-4o-mini-tts`

### 11.4 Gemini

Objetivo: apoio opcional para busca/hotelaria quando configurado.

### 11.5 WhatsApp Evolution API

Objetivo: canal de atendimento e operação da IA BIA.

Status: provedor oficial confirmado como **Evolution API**.

Webhook publico: **[INFORMAÇÃO A CONFIRMAR]**.

### 11.6 Carteira Pix/cartoes

O BDEX possui estrutura operacional para carteira digital corporativa, Pix, cartoes fisicos e virtuais. A integração transacional real depende da documentação do provedor financeiro a ser enviada posteriormente.

Status: **[INFORMAÇÃO A CONFIRMAR]**.

## 12. Webhooks

### 12.1 WhatsApp

Evento esperado:

- Mensagem recebida.
- Status de conexao.
- QR code.
- Status de envio.

Payload final: **[INFORMAÇÃO A CONFIRMAR - depende da Evolution API configurada]**.

### 12.2 Tech Travel

Nao foi identificado webhook final obrigatorio no código atual. A integração principal usa chamadas HTTP ativas para cotação, reserva, status, emissão e cancelamento.

## 13. Logs e auditoria

O sistema possui:

- Logs de auditoria geral.
- Logs de IA BIA.
- Logs de ferramentas da IA.
- Logs de WhatsApp.
- Logs de transcrição de audio.
- Logs de envio de voucher.
- Logs de integração Tech.
- Histórico de importacao.
- Eventos de demanda.

Boas praticas:

- Registrar usuário, módulo, acao, entidade, antes/depois e timestamp.
- Nunca gravar segredos em log.
- Mascarar tokens, senhas, documentos sensíveis e cartoes.
- Manter retenção definida por politica LGPD.

## 14. Segurança técnica

Recomendacoes:

- HTTPS obrigatorio em produção.
- `AUTH_SECRET` forte.
- `AUTH_REQUIRE_SESSION=true`.
- Senhas com hash seguro.
- Rate limit em endpoints sensíveis.
- CORS restrito ao dominio oficial.
- Segredos apenas em variaveis de ambiente.
- Firewall liberando apenas SSH, HTTP e HTTPS.
- PostgreSQL sem exposicao publica.
- Backup criptografado.
- Logs sem dados sensíveis.
- Permissões da IA BIA com aprovacao para ações críticas.

## 15. Backup e recuperacao

### 15.1 Backup recomendado

- Backup diario do PostgreSQL.
- Snapshot semanal do servidor.
- Retenção minima: **[INFORMAÇÃO A CONFIRMAR]**.

Exemplo:

~~~bash
pg_dump "$DATABASE_URL" > backup_bdex_$(date +%F).sql
~~~

### 15.2 Restore

~~~bash
psql "$DATABASE_URL" < backup_bdex_YYYY-MM-DD.sql
~~~

Antes do restore:

1. Parar aplicacao.
2. Fazer backup do estado atual.
3. Validar arquivo de backup.
4. Restaurar em homologacao quando possivel.
5. Restaurar em produção.
6. Executar testes de login, dashboard, demandas, vouchers e financeiro.

## 16. Monitoramento

Monitorar:

- Processo Node.js/systemd.
- Nginx.
- PostgreSQL.
- CPU.
- Memoria.
- Disco.
- Latencia das APIs.
- Erros 4xx/5xx.
- Health check `/api/health`.
- Status Tech Travel.
- Status IA/OpenAI.
- Status WhatsApp.
- Tamanho de logs.
- Backups executados.

## 17. Troubleshooting

| Problema | Causa provavel | Solucao |
|---|---|---|
| Usuário nao consegue fazer login | Credencial invalida, sessao obrigatoria ou usuário inativo | Verificar usuário, senha, `AUTH_SECRET`, `AUTH_REQUIRE_SESSION` e logs. |
| Sistema fica carregando | Falha de sessao/storage ou API inicial | Verificar console, `/api/health`, banco e variaveis. |
| IA responde erro técnico | Chave OpenAI ausente, quota, modelo invalido ou rate limit | Validar `OPENAI_API_KEY`, billing, modelo e logs de IA. |
| Busca web nao funciona | Provedor IA sem busca ou chave ausente | Validar OpenAI/Gemini e `enable_search`. |
| Importacao Wintour falha | Arquivo invalido, storage cheio, duplicidade ou parser | Conferir arquivo exportado, limpar dados antigos, revisar previa e logs. |
| Tech Travel nao conecta | Credenciais/base URL incorretas ou contrato sem endpoint | Validar `.env`, status Tech e retorno do provedor. |
| Reserva nao emite | Endpoint/contrato ausente ou dados obrigatorios faltando | Conferir payload, politicas, empresa Tech e logs de integração. |
| WhatsApp nao conecta | Token/base URL/instancia incorretos | Validar Evolution API e QR code. |
| Financeiro nao atualiza | Demanda/voucher sem vinculo ou importacao incompleta | Executar sincronizacao operacional e reconciliacao. |
| Mapa nao mostra dados | Sem destinos ativos ou coordenadas ausentes | Verificar viagens em campo, cidades e dados geograficos. |

## 18. Checklist de implantação

- [ ] Servidor Ubuntu 24.04 LTS criado.
- [ ] SSH/root ativo e seguro.
- [ ] Firewall configurado.
- [ ] Node.js 20.9+ instalado.
- [ ] PostgreSQL instalado.
- [ ] Banco e usuário criados.
- [ ] Schemas executados.
- [ ] `.env.local`/variaveis configuradas.
- [ ] `AUTH_SECRET` gerado.
- [ ] `AUTH_REQUIRE_SESSION=true`.
- [ ] OpenAI configurada.
- [ ] Tech Travel configurada.
- [ ] Evolution API configurada.
- [ ] Build executado com sucesso.
- [ ] systemd ativo.
- [ ] Nginx configurado.
- [ ] SSL emitido.
- [ ] Login master testado.
- [ ] Cadastro de empresa testado.
- [ ] Cadastro de solicitante testado.
- [ ] Portal empresa testado.
- [ ] Criacao de demanda testada.
- [ ] Voucher testado.
- [ ] Importacao Wintour testada.
- [ ] Cotação Tech testada.
- [ ] Financeiro testado.
- [ ] IA BIA testada.
- [ ] Backup automatico configurado.
- [ ] Snapshot semanal configurado.
- [ ] Logs e monitoramento revisados.

## 19. Glossario técnico

| Termo | Definicao |
|---|---|
| BDEX | Nome oficial do sistema/documento. |
| IA BIA | Assistente de inteligencia artificial do sistema. |
| Demanda | Pedido operacional de viagem ou serviço. |
| Serial/OS | Identificador operacional da demanda. |
| Voucher | Documento/registro de confirmação de serviço. |
| Wintour | Sistema externo usado para vendas/emissões e importacao diaria por arquivo. |
| Tech Travel/TTravel | Hub de fornecedores e reservas. |
| Solicitante | Usuário da empresa cliente que cria/acompanhada pedidos. |
| Duty of Care | Monitoramento de viajantes e riscos durante a viagem. |
| Reconciliacao | Conferencia entre demanda, voucher, financeiro e importacao. |
| app_kv | Estrutura chave-valor usada para compatibilidade de storage. |

## 20. Pendências tecnicas

- Dominio final de produção.
- Provedor financeiro real para Pix/cartoes/carteira.
- Contrato e credenciais finais da Tech Travel.
- Webhook final da Evolution API.
- Politica LGPD e retenção.
- Matriz final de permissões da IA BIA.
- Politica de backup/restore definitiva.
- Exposicao ou nao de API publica para integradores externos.

## 21. Conclusão técnica

O BDEX possui base técnica para operar como plataforma web de gestao de viagens corporativas com IA, importacao Wintour, portal empresa, financeiro, auditoria e integração Tech Travel. Para produção, a prioridade técnica e consolidar PostgreSQL, configurar segredos, ativar HTTPS, validar credenciais externas, testar fluxos principais e definir politicas formais de segurança, backup, LGPD e permissão da IA.
