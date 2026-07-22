# Arquitetura SaaS

## Visao geral

```text
Browser
  -> Caddy HTTPS
  -> Next.js App Router
     -> guard de API + sessao + permissao
     -> contexto AsyncLocalStorage do request
     -> transacao com app.tenant_id
  -> PostgreSQL 16 (controle, dados e RLS)
  -> volume privado de PDFs
  -> SMTP / Tech Travel / IA / WhatsApp
```

O tenant nunca e aceito como autoridade a partir do navegador. Ele e resolvido pela sessao opaca, membership ativa e tenant ativo.

## Plano de controle

- `plans`: limites e entitlements.
- `tenants`: organizacoes e estado (`trial`, `active`, `suspended`, `cancelled`).
- `tenant_subscriptions`: plano, status e modo de cobranca.
- `users`: identidade global sem senha embutida.
- `user_credentials`: hash, bloqueio e politica de troca.
- `roles`, `permissions`, `role_permissions`: RBAC.
- `tenant_memberships`: relacao usuario/tenant, papel e escopo de empresas/grupos.
- `user_sessions`: sessao revogavel e expirada no servidor.
- `user_invites` e `password_reset_tokens`: tokens de uso unico armazenados como hash.
- `audit_logs`: eventos reais do servidor.
- `rate_limit_buckets`: limite compartilhado entre instancias.

O administrador da plataforma acessa somente metadados operacionais, planos, tenants e uso agregado. Nao existe bypass secreto para ler dados internos de clientes.

## Plano de dados

As migrations criam grupos, empresas, funcionarios, aliases, solicitantes, hoteis, demandas, eventos, aprovacoes, reservas, vouchers, financeiro e importacoes com `tenant_id`, chaves compostas e indices.

Para preservar os fluxos existentes, modulos ainda usam `app_kv` como camada de compatibilidade em PostgreSQL. Ela e versionada, transacional, limitada por tenant e nao e um arquivo local. A evolucao recomendada e migrar agregados de maior volume de `app_kv` para as tabelas relacionais ja preparadas, por modulo e com testes de caracterizacao.

## Isolamento

1. Login resolve usuario, membership, tenant, papel, escopo e plano.
2. A sessao guarda apenas um token aleatorio no cookie; o estado fica no banco.
3. O guard entra o principal no contexto do request.
4. `withTenantTransaction` executa `set_config('app.tenant_id', tenantId, true)`.
5. Tabelas de negocio, armazenamento, arquivos, idempotencia e uso possuem RLS forcado.
6. Chaves estrangeiras compostas impedem vinculo entre registros de tenants diferentes.
7. A conta de migrations e separada da conta web; readiness recusa `SUPERUSER` e `BYPASSRLS`.

O teste `tests/integration/tenant-isolation.test.ts` verifica leitura, agregacao, update, delete e insert cruzados em PostgreSQL real no CI.

## Usuarios e permissoes

- `platform_admin`: administra metadados da plataforma.
- `tenant_admin`: administra um tenant.
- `agent`, `financial_manager`, `supervisor`, `operator`, `company_admin`, `requester`, `readonly`: papeis iniciais.
- Permissoes sensiveis sao avaliadas no servidor (`guardApiRequest`).
- `allowed_company_ids`, `allowed_group_ids` e `company_id` restringem o portal.
- Inativacao, troca de senha e reset revogam sessoes aplicaveis.

## Planos e limites

Os limites sao carregados na sessao a partir da assinatura:

- usuarios ativos/convidados;
- bytes em `app_kv` mais arquivos ativos;
- novas demandas por mes;
- entitlements booleanos.

As verificacoes ocorrem dentro da transacao antes da confirmacao. Excesso retorna erro e nao sucesso parcial.

## Arquivos

Metadados e vinculos ficam no PostgreSQL; bytes ficam em `STORAGE_ROOT`, fora de `public`. Download e exclusao revalidam tenant, entidade e permissao. O volume local e adequado ao piloto em um servidor. Para varias instancias, substituir a implementacao de objeto por armazenamento S3 compativel, mantendo metadados e autorizacao atuais.

## Escala horizontal

Ja sao compartilhados no PostgreSQL:

- sessoes;
- rate limiting;
- idempotencia;
- auditoria;
- dados corporativos;
- limites mensais.

Antes de mais de uma instancia, ainda e necessario:

- armazenamento de objetos compartilhado;
- fila persistente para processamentos longos;
- metricas centralizadas e tracing;
- testes de carga no servidor alvo;
- estrategia de cache explicitamente chaveada por tenant.

## Administracao da plataforma

A pagina `/dashboard/plataforma` e suas APIs exigem `platformAdmin`. Criacao de tenant exige SMTP real, cria papeis e convite em transacao e remove o tenant incompleto se o envio falhar. Suspensao impede autenticacao por status.

## Decisoes de seguranca

- Sem usuario administrador padrao.
- Sem tenant demo automatico.
- Sem tenant informado pelo cliente como fonte de autorizacao.
- Sem persistencia corporativa somente em memoria ou localStorage.
- Sem acesso cruzado de suporte sem uma funcao auditada explicita.
