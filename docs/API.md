# API

## Escopo

O projeto usa Route Handlers do Next.js em `app/api`. O inventario canonico,
incluindo metodo, protecao e arquivo, e gerado em:

`docs/FEATURE-INVENTORY.generated.md`

Na ultima geracao existem 132 rotas de API. Este documento descreve contratos
transversais e grupos funcionais; nao substitui o inventario.

## Autenticacao

A sessao usa cookie opaco, revogavel e armazenado no PostgreSQL. Rotas protegidas
chamam `guardApiRequest`.

Endpoints de autenticacao:

- `POST /api/auth/login`;
- `POST /api/auth/logout`;
- `GET /api/auth/session`;
- `POST /api/auth/change-password`;
- convite e recuperacao em `/api/auth/invite/**` e
  `/api/auth/password-reset/**`.

O cliente nao envia um tenant confiavel. O principal da sessao contem tenant,
membership, papel, permissoes, limites e acesso corporativo efetivo.

## Cabecalhos

- `Content-Type: application/json` para JSON;
- `X-Request-Id`: UUID opcional; se invalido/ausente, o servidor gera outro;
- `Origin`: obrigatorio e validado em mutacoes de producao;
- cookie de sessao: `HttpOnly`, configurado pelo fluxo de login.

Respostas do guard incluem `X-Request-Id`.

## Erros

Formato comum:

```json
{
  "ok": false,
  "error": "Mensagem segura para o usuario.",
  "code": "PERMISSION_DENIED",
  "requestId": "uuid"
}
```

Status usuais:

- `400`: entrada invalida;
- `401`: sessao ausente/expirada;
- `403`: permissao, escopo, origem ou entitlement negado;
- `404`: entidade invisivel/inexistente;
- `409`: versao, idempotencia ou transicao em conflito;
- `413`: corpo/arquivo acima do limite;
- `429`: rate limit;
- `501`: capacidade externa nao implementada/homologada;
- `502`/`504`: fornecedor falhou/timeout;
- `503`: banco, autenticacao ou dependencia indisponivel.

Erros internos e segredos nao sao devolvidos ao cliente.

## Autorizacao de empresa e grupo

Toda rota que usa empresa/grupo deve recalcular o acesso no servidor:

- `requireCompanyAccess`;
- `requireGroupAccess`;
- `canViewConsolidatedGroup`;
- `resolveCorporateContext`.

`companyId`, `groupId` ou lista de IDs enviados pelo navegador sao apenas o
contexto solicitado. O conjunto oficial vem da sessao e do PostgreSQL.

## Grupos de endpoints

| Prefixo | Responsabilidade |
| --- | --- |
| `/api/users` | Usuarios, convite e acesso corporativo |
| `/api/me/corporate-contexts` | Contextos efetivos da sessao |
| `/api/demands` | Demandas, OS, importacao, atribuicao e transferencia |
| `/api/approvals` | Workflows, instancias, decisoes, delegacoes e SLA |
| `/api/policies` | Politicas, versoes, publicacao, simulacao e templates |
| `/api/travel` | Cotacoes, reservas, emissao, cancelamento e Tech |
| `/api/vouchers` | CRUD e lote de vouchers |
| `/api/finance` | Lancamentos e financeiro corporativo |
| `/api/reconciliation` | Execucoes, alertas e resolucao |
| `/api/integrations` | Provedores, Tech, Wintour e logs |
| `/api/files` | Upload privado, download e exclusao |
| `/api/assistant`, `/api/ia` | Assistente, configuracao e tarefas IA |
| `/api/audit` | Consulta auditavel e limitada |
| `/api/system` | Reset, resumo e rollout administrativo |
| `/api/platform` | Administracao SaaS restrita |

## Contextos corporativos

`GET /api/me/corporate-contexts` retorna somente grupos e empresas autorizados,
origem do acesso, permissoes e contexto padrao valido. Preferencia do navegador
nao amplia esse conjunto.

APIs administrativas de usuario permitem consultar e atualizar grants. A
atualizacao usa transacao, preserva grants fora do escopo administrativo do ator
e impede elevacao de privilegio.

## Concorrencia e idempotencia

Mutacoes criticas usam:

- `expectedVersion` para optimistic locking;
- `idempotencyKey` para repeticao segura;
- transacao PostgreSQL;
- locks quando a conclusao depende de estado corrente;
- `409` quando a mesma chave possui conteudo diferente.

Uma resposta `2xx` de entrada nao deve ser interpretada como confirmacao externa
se o contrato retornar estado pendente.

## Paginacao e limites

As rotas definem limites Zod e tamanho maximo de corpo. Listagens devem usar
`limit`/`offset` ou contrato especifico da rota. Upload usa streaming/arquivo
privado e limite configurado; base64 de arquivo nao e persistido em `app_kv`.

## Health

- `GET /api/health`: processo responde;
- `GET /api/ready`: dependencias e papel de banco estao seguros.

`health=200` com `ready=503` significa processo vivo, mas indisponivel para
trafego.

## Protecoes

- autenticacao e RBAC;
- acesso de grupo/empresa;
- RLS;
- validacao Zod;
- limite de corpo;
- rate limit;
- validacao de origem;
- auditoria de negacao;
- request ID;
- mascaramento de erro externo;
- entitlement e quota.

## Compatibilidade

`/api/storage` permanece somente para compatibilidade durante rollout. Ele nao
deve receber novos dominios criticos e nao substitui APIs relacionais
especificas.

## Validacao

Use:

```bash
npm run inventory:features
npm run inventory:check
npm run typecheck
npm run test:integration
npm run test:e2e
```

`test:integration` exige `TEST_DATABASE_URL`/`DATABASE_URL`; sem isso os testes
sao ignorados e nao contam como aprovados.
