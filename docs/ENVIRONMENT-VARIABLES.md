# Variaveis de ambiente

Nunca coloque valores reais neste documento ou no repositorio. Variaveis vazias significam recurso desabilitado ou configuracao ainda pendente.

## Aplicacao

| Variavel | Obrigatoria | Uso |
| --- | --- | --- |
| `NODE_ENV` | producao | Deve ser `production`. |
| `PORT` | nao | Porta do Next.js, padrao 3000. |
| `HOSTNAME` | nao | Bind do container, padrao `0.0.0.0`. |
| `APP_URL` | producao | URL canonica HTTPS; usada para origem, cookies e links. |
| `NEXT_PUBLIC_APP_URL` | compose | Compatibilidade de configuracao publica; nao armazene segredo. |
| `NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED` | build | Habilita a interface offline no JavaScript compilado; mantenha `false` fora de ambientes homologados. |
| `APP_VERSION` | producao | Identificador imutavel da release. |
| `ALLOW_INSECURE_LOCALHOST` | somente teste/local | Permite HTTP apenas em loopback. |
| `LOG_LEVEL` | nao | `info` ou `debug`; nao habilitar debug permanente. |

## PostgreSQL

| Variavel | Obrigatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | sim | URL PostgreSQL da aplicacao. |
| `MIGRATION_DATABASE_URL` | release | URL administrativa usada somente por migrations, backup e restore. |
| `DATABASE_APP_ROLE` | release | Papel sem `SUPERUSER` e sem `BYPASSRLS`, igual ao usuario de `DATABASE_URL`. |
| `DATABASE_APP_PASSWORD` | primeiro provisionamento | Senha aleatoria do papel da aplicacao. |
| `DATABASE_SSL` | nao | Ativa TLS com validacao do certificado. |
| `POSTGRES_POOL_MAX` | nao | Maximo de conexoes por instancia. |
| `POSTGRES_CONNECT_TIMEOUT_MS` | nao | Timeout de conexao. |
| `POSTGRES_STATEMENT_TIMEOUT_MS` | nao | Timeout de consulta. |
| `POSTGRES_DB` | compose local | Banco criado pelo container. |
| `POSTGRES_USER` | compose local | Usuario do banco. |
| `POSTGRES_PASSWORD` | compose local | Senha sem valor padrao. |

O usuario de `DATABASE_URL` deve ser diferente do usuario de `MIGRATION_DATABASE_URL`. A aplicacao recusa readiness em producao se o papel atual for superusuario ou tiver `BYPASSRLS`.

## Sessao e arquivos

| Variavel | Obrigatoria | Uso |
| --- | --- | --- |
| `AUTH_SECRET` | sim | Segredo aleatorio com pelo menos 32 caracteres. |
| `AUTH_SESSION_HOURS` | nao | Duracao maxima da sessao. |
| `AUTH_COOKIE_NAME` | nao | Nome do cookie. |
| `STORAGE_ROOT` | sim em producao | Diretorio/volume privado de arquivos. |
| `MAX_UPLOAD_BYTES` | nao | Limite do PDF, maximo aceito pelo schema: 100 MB. |

## SMTP

`SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME` e `PASSWORD_RESET_MINUTES`.

Quando `SMTP_ENABLED=true`, host, usuario, senha e remetente sao obrigatorios. Convites e recuperacao de senha nao devem ser considerados operacionais sem teste de entrega real.

## Bootstrap de uso unico

`BOOTSTRAP_TENANT_NAME`, `BOOTSTRAP_TENANT_SLUG`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_PLATFORM_ADMIN`, `BOOTSTRAP_PLAN_KEY`, `BOOTSTRAP_PLAN_NAME`, `BOOTSTRAP_MAX_USERS`, `BOOTSTRAP_MAX_STORAGE_BYTES`, `BOOTSTRAP_MAX_MONTHLY_OPERATIONS` e `BOOTSTRAP_ENTITLEMENTS`.

Remova a senha do ambiente apos o bootstrap.

## Inteligencia artificial

`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_PRO_MODEL`, `OPENAI_SEARCH_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `GEMINI_API_KEY`, `GEMINI_MODEL` e `AI_HOTEL_PROVIDER`.

Sem credencial, a funcao dependente deve ficar indisponivel; nao ha resposta simulada.

## Tech Travel

Transacional: `TECH_API_ENABLED`, `TECH_API_MODE`, `TECH_API_BASE_URL`, `TECH_API_LOGIN`, `TECH_API_PASSWORD`, `TECH_API_KEY`, `TECH_API_TIMEOUT_MS`, `TECH_API_DEFAULT_COMPANY_ID`, `TECH_API_DEFAULT_SYSTEMS`, `TECH_API_HOTEL_SUPPLIERS`, `TECH_API_TOKEN_CACHE_TTL_SECONDS`.

Relatorios: `TECH_REPORTS_ENABLED`, `TECH_REPORTS_BASE_URL`, `TECH_REPORTS_KEY`.

Use `TECH_API_MODE=production` somente depois da homologacao do fornecedor.

## WhatsApp

`WHATSAPP_ENABLED`, `WHATSAPP_PROVIDER`, `WHATSAPP_API_BASE_URL`, `WHATSAPP_API_KEY` e `WHATSAPP_INSTANCE_ID`.

## Proxy e operacao

| Variavel | Uso |
| --- | --- |
| `APP_DOMAIN` | Dominio servido pelo Caddy. |
| `ACME_EMAIL` | Contato ACME. |
| `MAX_UPLOAD_SIZE` | Limite na borda, igual ou maior que `MAX_UPLOAD_BYTES`. |
| `BBT_IMAGE` | Repositorio/nome da imagem. |
| `BACKUP_RETENTION_DAYS` | Retencao local. |
| `ENV_FILE` | Arquivo usado pelos scripts de release. |
| `COMPOSE_FILE` | Compose de producao. |
| `MIN_FREE_KB` | Espaco minimo antes da release. |
| `PREVIOUS_APP_VERSION` | Tag imutavel para rollback. |
| `ROLLBACK_PULL` | Autoriza buscar imagem anterior do registry. |
| `SMOKE_BASE_URL` | URL alvo do smoke test. |
| `RESTORE_SOURCE` | Diretorio do backup para restore isolado. |
| `RESTORE_DATABASE` | Banco isolado de destino. |
| `RESTORE_STORAGE_ROOT` | Diretorio vazio de restore. |

## Testes e CI

`TEST_DATABASE_URL`, `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `LOAD_BASE_URL`, `LOAD_EMAIL`, `LOAD_PASSWORD`, `LOAD_TENANT`, `LOAD_REQUESTS`, `LOAD_CONCURRENCY`, `LOAD_MAX_P95_MS` e `LOAD_REPORT_PATH`.

Essas credenciais devem pertencer exclusivamente ao ambiente de teste.
