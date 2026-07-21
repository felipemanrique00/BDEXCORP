# BDEX - BBT Corporativo

Plataforma multiempresa para operacao de viagens corporativas, empresas e grupos, viajantes, demandas, reservas, vouchers, financeiro, importacoes, relatorios e assistencia operacional.

Esta pasta e a evolucao isolada para producao. O projeto de origem permanece sem alteracoes em `BDEX_RELATORIO_AEREO`.

## Stack

- Next.js 15 (App Router), React 18 e TypeScript.
- Tailwind CSS, Lucide, Recharts e Leaflet.
- PostgreSQL 16 com migrations versionadas e Row Level Security.
- Zod, React Hook Form e Zustand.
- Vitest, Playwright, ESLint e TypeScript.
- Docker multi-stage, Docker Compose e Caddy.

## Requisitos

- Node.js 22 LTS e npm 10 ou versoes compativeis.
- PostgreSQL 16 para qualquer ambiente que persista dados.
- Docker Engine com Compose v2 para a implantacao de referencia.

Nao existe fallback de producao para JSON local. O navegador mantem apenas cache de trabalho; a fonte compartilhada e PostgreSQL.

## Desenvolvimento

1. Instale as dependencias com `npm ci`.
2. Crie `.env.local` a partir de `.env.example` e preencha as URLs separadas de aplicacao/migrations, `DATABASE_APP_*`, `AUTH_SECRET` e `APP_URL`.
3. Execute `npm run db:migrate`.
4. Defina as variaveis `BOOTSTRAP_*` e execute `npm run db:bootstrap` uma unica vez.
5. Inicie com `npm run dev`.

O bootstrap e idempotente pelo slug do tenant e nao imprime a senha informada.

## Validacao

```bash
npm run db:validate-migrations
npm run inventory:check
npm run security:scan
npm run lint
npm run typecheck
npm test
npm run build
```

O comando `npm run validate` executa essa linha local completa. Testes com PostgreSQL, navegador, imagem e recuperacao de desastre estao no workflow `.github/workflows/quality.yml`.

## Producao

O caminho oficial e `docker-compose.production.yml`:

```bash
cp .env.example .env.production
# Preencha apenas no servidor e proteja o arquivo.
ENV_FILE=.env.production ./scripts/release.sh
```

Servicos de referencia:

- `app`: Next.js como usuario nao root e filesystem somente leitura;
- `postgres`: rede interna, volume persistente e sem porta publica;
- `migrate`: migrations com checksum e lock;
- `caddy`: HTTPS e reverse proxy;
- `backup`: PostgreSQL e arquivos privados;
- `restore-validation`: restauracao obrigatoriamente isolada;
- `bootstrap`: criacao controlada do primeiro tenant e administrador.

Consulte [DEPLOYMENT-SERVER.md](docs/DEPLOYMENT-SERVER.md), [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) e [RUNBOOK.md](docs/RUNBOOK.md) antes da primeira implantacao.

## Seguranca

- Sessao opaca armazenada no PostgreSQL, cookie `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS.
- Senhas com `scrypt`, politica forte e bloqueio progressivo de login.
- Permissoes verificadas no servidor e escopo de empresa/grupo aplicado nas APIs.
- Tenant obtido exclusivamente da sessao; RLS e transacoes definem `app.tenant_id`.
- O processo web usa papel PostgreSQL sem `SUPERUSER/BYPASSRLS`; readiness bloqueia configuracao insegura.
- Upload apenas de PDF validado por extensao, tamanho e assinatura, em volume privado.
- Rate limiting compartilhado no PostgreSQL, auditoria e logs estruturados com redacao de segredos.
- CSP e headers de seguranca configurados em `next.config.mjs`.

## Integracoes

- Tech Travel Relatorios: preparada; exige `TECH_REPORTS_ENABLED` e credenciais reais.
- Tech Travel transacional: permanece bloqueada enquanto cotacao/reserva/emissao/cancelamento nao forem homologados pelo fornecedor.
- SMTP: necessario para convites e recuperacao de senha em operacao real.
- OpenAI/Gemini: opcionais; indisponibilidade e exibida como erro, sem resposta simulada.
- WhatsApp: somente habilite depois de configurar e homologar o transporte real.

## Documentacao

- [PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md)
- [SAAS-ARCHITECTURE.md](docs/SAAS-ARCHITECTURE.md)
- [SECURITY.md](docs/SECURITY.md)
- [ENVIRONMENT-VARIABLES.md](docs/ENVIRONMENT-VARIABLES.md)
- [FEATURE-VERIFICATION.md](docs/FEATURE-VERIFICATION.md)
- [LGPD-TECHNICAL-CONTROLS.md](docs/LGPD-TECHNICAL-CONTROLS.md)
- [Inventario gerado](docs/FEATURE-INVENTORY.generated.md)

Nenhuma funcionalidade foi intencionalmente removida. Operacoes sem integracao real retornam indisponibilidade explicita em vez de sucesso ficticio.
