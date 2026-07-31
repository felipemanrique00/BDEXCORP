# Auditoria de ambiente de producao

Coleta: `2026-07-24/25`
Producao: `https://bdextravel.com.br`
Staging: `https://staging.bdextravel.com.br`

Nenhum valor secreto e reproduzido neste documento. Os estados `definida` e
`vazia` indicam somente presenca, nunca o conteudo.

## Resultado executivo

- O validador `scripts/validate-environment.mjs` aprovou o ambiente de producao.
- O container de producao recebeu apenas uma variavel publica:
  `NEXT_PUBLIC_APP_URL`.
- Nao foram encontrados segredos com prefixo `NEXT_PUBLIC_`.
- SMTP, WhatsApp, Tech Travel transacional e Tech Travel relatorios estao
  desabilitados em producao.
- OpenAI esta configurada; Gemini nao possui chave.
- A chave OpenAI informada anteriormente em conversa deve ser revogada e
  substituida antes da homologacao comercial.
- Existe divergencia confirmada entre `OPENAI_TRANSCRIBE_MODEL`, documentada e
  injetada no container, e `OPENAI_TRANSCRIPTION_MODEL`, lida pelo gateway de
  audio.
- Credenciais de bootstrap permanecem no arquivo de ambiente do servidor,
  embora nao sejam injetadas no container normal. Devem ser removidas ou
  rotacionadas depois de comprovado que o bootstrap inicial nao sera repetido.
- Parte das variaveis usadas diretamente por modulos de IA e integracoes ainda
  nao participa do schema tipado de inicializacao.

## Legenda

| Termo | Significado |
| --- | --- |
| Obrigatoria | A aplicacao ou a infraestrutura nao deve iniciar sem valor valido. |
| Condicional | Obrigatoria somente quando a funcionalidade correspondente esta habilitada. |
| Opcional | Possui default seguro ou habilita recurso adicional. |
| Runtime | Alteracao exige reinicio do servico. |
| Build | Alteracao exige novo build da imagem. |
| Fora do app | Consumida por Compose, PostgreSQL, Caddy, backup ou ferramenta administrativa. |

## Aplicacao e proxy

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `PORT` | Porta interna do Next.js | Opcional | Runtime | Default da imagem | Nenhuma |
| `HOSTNAME` | Interface de escuta do Next.js | Opcional | Runtime | Definida pelo container | Nenhuma |
| `NODE_ENV` | Modo do framework | Obrigatoria | Build/runtime | `production` | Nenhuma |
| `APP_URL` | Origem canonica usada no servidor | Obrigatoria e HTTPS | Runtime | Definida e valida | Nenhuma |
| `NEXT_PUBLIC_APP_URL` | Origem publica usada no navegador | Obrigatoria e HTTPS | Build/runtime publica | Definida e valida | Manter sem segredo |
| `APP_VERSION` | Versao observavel da aplicacao | Obrigatoria | Build/runtime | Definida | Incluir commit na proxima imagem |
| `ALLOW_INSECURE_LOCALHOST` | Permite HTTP apenas em loopback de teste | Opcional | Runtime | Definida como desabilitada | Nenhuma |
| `LOG_LEVEL` | Nivel de log estruturado | Opcional | Runtime | Definida | Nenhuma |
| `APP_DOMAIN` | Dominio atendido pelo Caddy | Obrigatoria | Fora do app | Definida | Nenhuma |
| `ACME_EMAIL` | Contato para certificados ACME | Obrigatoria | Fora do app | Definida | Validar caixa periodicamente |
| `MAX_UPLOAD_SIZE` | Limite do proxy para request/upload | Opcional | Fora do app | Definida | Alinhar com `MAX_UPLOAD_BYTES` |
| `BBT_IMAGE` | Repositorio da imagem Docker | Obrigatoria | Fora do app | Definida | Nenhuma |
| `BACKUP_RETENTION_DAYS` | Retencao automatica de backups | Opcional | Fora do app | Definida | Monitorar execucao |
| `RESTORE_SOURCE` | Backup usado em restore controlado | Condicional | Fora do app | Nao injetada no app | Somente perfil de restore |
| `RESTORE_DATABASE` | Banco temporario de validacao | Condicional | Fora do app | Nao injetada no app | Somente perfil de restore |

## PostgreSQL

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Conexao da aplicacao com papel sujeito a RLS | Obrigatoria e secreta | Runtime | Definida e valida | Nunca usar papel administrativo |
| `MIGRATION_DATABASE_URL` | Conexao administrativa para migrations | Obrigatoria e secreta | Fora do app normal | Definida | Usar somente no job de migration |
| `DATABASE_APP_ROLE` | Nome do papel restrito da aplicacao | Obrigatoria | Fora do app normal | Definida | Nenhuma |
| `DATABASE_APP_PASSWORD` | Senha do papel restrito | Obrigatoria e secreta | Fora do app normal | Definida | Rotacao programada |
| `DATABASE_SSL` | TLS na conexao PostgreSQL | Opcional conforme topologia | Runtime | Definida | Banco esta em rede Docker privada |
| `POSTGRES_POOL_MAX` | Limite do pool | Opcional | Runtime | Definida | Medir antes de aumentar |
| `POSTGRES_CONNECT_TIMEOUT_MS` | Timeout de conexao | Opcional | Runtime | Definida | Nenhuma |
| `POSTGRES_STATEMENT_TIMEOUT_MS` | Timeout de consultas | Opcional | Runtime | Definida | Revisar consultas que excederem |
| `POSTGRES_DB` | Banco inicial do container | Obrigatoria | Fora do app | Definida | Nenhuma |
| `POSTGRES_USER` | Usuario administrativo do container | Obrigatoria e sensivel | Fora do app | Definida | Nao injetar no app |
| `POSTGRES_PASSWORD` | Senha administrativa | Obrigatoria e secreta | Fora do app | Definida | Nao injetar no app |

## Automacoes

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `AUTOMATION_WORKER_ENABLED` | Habilita executor de automacoes | Opcional | Runtime | Habilitada | Monitorar fila e falhas |
| `AUTOMATION_WORKER_INTERVAL_MS` | Intervalo do worker | Opcional | Runtime | Definida | Nenhuma |
| `AUTOMATION_WORKER_BATCH_SIZE` | Lote maximo por ciclo | Opcional | Runtime | Definida | Ajustar somente com teste de carga |

## Autenticacao, sessao e MFA

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `AUTH_SECRET` | Assinatura de sessao e tokens | Obrigatoria e secreta | Runtime | Definida e valida | Rotacao exige plano de sessoes |
| `AUTH_SESSION_HOURS` | Duracao maxima da sessao | Opcional | Runtime | Definida | Nenhuma |
| `AUTH_COOKIE_NAME` | Nome do cookie de sessao | Opcional | Build/runtime | Definida | Diferente no staging |
| `MFA_ENCRYPTION_KEY` | Criptografia dos segredos MFA | Obrigatoria e secreta | Runtime | Definida e valida | Backup seguro e rotacao planejada |
| `MFA_ADMIN_REQUIRED` | Exige MFA administrativo | Obrigatoria em producao | Runtime | Habilitada | Nenhuma |
| `MFA_ISSUER` | Emissor exibido no autenticador | Opcional | Runtime | Default do Compose | Documentar no env |
| `MFA_CHALLENGE_MINUTES` | Validade do desafio MFA | Opcional | Runtime | Default do Compose | Documentar no env |
| `MFA_MAX_ATTEMPTS` | Tentativas por desafio | Opcional | Runtime | Default do Compose | Documentar no env |
| `PASSWORD_RESET_MINUTES` | Validade do reset de senha | Opcional | Runtime | Definida | Nenhuma |

## Arquivos

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `STORAGE_ROOT` | Raiz de arquivos privados | Obrigatoria em producao | Runtime | Definida em volume persistente | Manter fora do diretorio publico |
| `MAX_UPLOAD_BYTES` | Limite validado pela API | Opcional | Runtime | Definida | Manter menor ou igual ao proxy |

## SMTP

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `SMTP_ENABLED` | Habilita envio transacional | Opcional | Runtime | Desabilitada | Convites por e-mail indisponiveis |
| `SMTP_HOST` | Servidor SMTP | Condicional | Runtime | Definida | Nao e usada enquanto desabilitado |
| `SMTP_PORT` | Porta SMTP | Condicional | Runtime | Definida | Nenhuma |
| `SMTP_SECURE` | TLS implicito | Condicional | Runtime | Definida | Conferir com provedor |
| `SMTP_USER` | Usuario SMTP | Condicional e sensivel | Runtime | Definida | Nao e usada enquanto desabilitado |
| `SMTP_PASSWORD` | Senha SMTP | Condicional e secreta | Runtime | Definida | Rotacionar ao homologar |
| `SMTP_FROM` | Remetente | Condicional | Runtime | Definida | Validar SPF/DKIM/DMARC |
| `SMTP_FROM_NAME` | Nome do remetente | Opcional | Runtime | Definida | Nenhuma |

## Bootstrap

As variaveis abaixo pertencem apenas ao perfil administrativo `bootstrap` e nao
sao injetadas no container normal:

| Variavel | Finalidade | Producao | Acao |
| --- | --- | --- | --- |
| `BOOTSTRAP_TENANT_NAME` | Nome do tenant inicial | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_TENANT_SLUG` | Slug do tenant inicial | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_ADMIN_NAME` | Nome do primeiro administrador | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_ADMIN_EMAIL` | E-mail do primeiro administrador | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_ADMIN_PASSWORD` | Senha inicial | Definida e secreta | Rotacionar conta e remover do arquivo |
| `BOOTSTRAP_PLATFORM_ADMIN` | Eleva o primeiro usuario na plataforma | Definida | Nao reutilizar em operacao normal |
| `BOOTSTRAP_PLAN_KEY` | Chave do plano inicial | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_PLAN_NAME` | Nome do plano inicial | Definida | Remover apos confirmar bootstrap |
| `BOOTSTRAP_MAX_USERS` | Limite inicial | Vazia | Opcional |
| `BOOTSTRAP_MAX_STORAGE_BYTES` | Armazenamento inicial | Vazia | Opcional |
| `BOOTSTRAP_MAX_MONTHLY_OPERATIONS` | Operacoes mensais iniciais | Vazia | Opcional |
| `BOOTSTRAP_ENTITLEMENTS` | Direitos iniciais em JSON | Definida | Validar antes de eventual novo tenant |

## Inteligencia artificial

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | Credencial do provedor | Condicional e secreta | Runtime | Definida | Revogar a chave exposta e substituir |
| `OPENAI_MODEL` | Modelo principal | Opcional | Runtime | Definida | Validar disponibilidade no provedor |
| `OPENAI_PRO_MODEL` | Modelo de tarefas complexas | Opcional | Runtime | Definida | Validar disponibilidade |
| `OPENAI_SEARCH_MODEL` | Modelo com busca | Opcional | Runtime | Definida | Validar disponibilidade |
| `OPENAI_TRANSCRIBE_MODEL` | Modelo de transcricao documentado | Opcional | Runtime | Definida | Tornar nome canonico no gateway |
| `OPENAI_TRANSCRIPTION_MODEL` | Nome alternativo lido pelo gateway | Nao documentada | Runtime | Ausente | Remover divergencia de codigo |
| `OPENAI_TTS_MODEL` | Modelo de voz | Opcional | Runtime | Definida | Validar com teste sandbox |
| `OPENAI_TTS_VOICE` | Voz sintetizada | Opcional | Runtime | Definida | Nenhuma |
| `GEMINI_API_KEY` | Credencial alternativa | Condicional e secreta | Runtime | Vazia | Recurso indisponivel |
| `GEMINI_MODEL` | Modelo alternativo | Opcional | Runtime | Definida | Sem efeito sem chave |
| `AI_HOTEL_PROVIDER` | Provedor da busca de hotel | Opcional | Runtime | Definida | Manter coerente com credencial |

## Tech Travel

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `TECH_API_ENABLED` | Habilita operacoes transacionais | Opcional | Runtime | Desabilitada | Homologar antes de ativar |
| `TECH_API_MODE` | `sandbox`, `production` ou desabilitado | Condicional | Runtime | Definida | Sem efeito enquanto desabilitado |
| `TECH_API_BASE_URL` | Endpoint transacional | Condicional | Runtime | Definida | Validar contrato do fornecedor |
| `TECH_API_LOGIN` | Login transacional | Condicional e secreto | Runtime | Vazia | Bloqueia ativacao |
| `TECH_API_PASSWORD` | Senha transacional | Condicional e secreta | Runtime | Vazia | Bloqueia ativacao |
| `TECH_API_KEY` | Chave transacional | Condicional e secreta | Runtime | Vazia | Bloqueia ativacao |
| `TECH_API_TIMEOUT_MS` | Timeout do conector | Opcional | Runtime | Definida | Nenhuma |
| `TECH_API_DEFAULT_COMPANY_ID` | Empresa padrao do fornecedor | Opcional | Runtime | Vazia | Nao assumir empresa implicitamente |
| `TECH_API_DEFAULT_SYSTEMS` | Sistemas do fornecedor | Opcional | Runtime | Vazia | Definir na homologacao |
| `TECH_API_HOTEL_SUPPLIERS` | Fornecedores de hotel | Opcional | Runtime | Vazia | Definir na homologacao |
| `TECH_API_TOKEN_CACHE_TTL_SECONDS` | Cache de token | Opcional | Runtime | Definida | Menor que validade real |
| `TECH_REPORTS_ENABLED` | Habilita relatorios de emissoes | Opcional | Runtime | Desabilitada | Homologar antes de ativar |
| `TECH_REPORTS_BASE_URL` | Endpoint de relatorios | Condicional | Runtime | Definida | Nenhuma enquanto desabilitado |
| `TECH_REPORTS_KEY` | Chave de relatorios | Condicional e secreta | Runtime | Vazia | Bloqueia ativacao |

## WhatsApp

| Variavel | Finalidade | Regra | Contexto | Producao | Acao |
| --- | --- | --- | --- | --- | --- |
| `WHATSAPP_ENABLED` | Habilita mensagens | Opcional | Runtime | Desabilitada | Manter bloqueada sem homologacao |
| `WHATSAPP_PROVIDER` | Provedor suportado | Opcional | Runtime | Definida | Atualmente `evolution_api` |
| `WHATSAPP_API_BASE_URL` | Endpoint do provedor | Condicional | Runtime | Definida | Nao e usada enquanto desabilitado |
| `WHATSAPP_API_KEY` | Chave do provedor | Condicional e secreta | Runtime | Definida | Rotacionar antes da homologacao |
| `WHATSAPP_INSTANCE_ID` | Instancia do canal | Condicional e sensivel | Runtime | Definida | Nao e usada enquanto desabilitado |

## Variaveis exclusivas de teste e operacao

Estas variaveis aparecem em testes ou scripts e nao devem existir no container
de producao:

- E2E: `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`,
  `E2E_ADMIN_TOTP_SECRET`, `E2E_RUN_ID`, `ALLOW_E2E_MFA_FIXTURE`,
  `PLAYWRIGHT_CHANNEL`, `PLAYWRIGHT_DISABLE_VIDEO`.
- Banco descartavel: `TEST_DATABASE_URL`,
  `TEST_DATABASE_CONFIRM_DISPOSABLE`.
- Carga: `LOAD_BASE_URL`, `LOAD_EMAIL`, `LOAD_PASSWORD`, `LOAD_TENANT`,
  `LOAD_REQUESTS`, `LOAD_CONCURRENCY`, `LOAD_TARGET_PATH`,
  `LOAD_MAX_P95_MS`, `LOAD_REPORT_PATH`, `ALLOW_LOAD_TEST_FIXTURE`.
- Smoke: `SMOKE_BASE_URL`, `SECURITY_SMOKE_BASE_URL`,
  `BROWSER_SMOKE_SCREENSHOT`.
- CI/framework: `CI`, `NEXT_RUNTIME`.

Nenhuma dessas variaveis foi observada no container de producao.

## Lacunas confirmadas

1. O schema tipado de `lib/server/environment.ts` cobre autenticacao, banco,
   arquivos, SMTP, WhatsApp e o nucleo Tech, mas nao cobre todo o conjunto de
   modelos de IA, configuracoes avancadas Tech e `LOG_LEVEL`.
2. O gateway de audio usa um nome de variavel diferente do Compose.
3. A imagem nao registra commit Git, impedindo rastreabilidade completa.
4. Credenciais de bootstrap permanecem no arquivo de producao.
5. A chave OpenAI compartilhada fora do cofre deve ser considerada comprometida.
6. SMTP desabilitado explica a indisponibilidade de envio de convites.

## Criterio antes de producao

- Rotacionar a chave OpenAI e qualquer segredo compartilhado fora do cofre.
- Corrigir e testar o nome canonico do modelo de transcricao.
- Expandir o schema tipado apenas para variaveis realmente consumidas pelo app.
- Remover credenciais de bootstrap do ambiente operacional.
- Registrar commit e checksum na imagem.
- Nao habilitar SMTP, WhatsApp ou Tech Travel sem sandbox e teste de ponta a
  ponta.
