# API

## Escopo

O projeto usa Route Handlers do Next.js em `app/api`. O inventario canonico,
incluindo metodo, protecao e arquivo, e gerado em:

`docs/FEATURE-INVENTORY.generated.md`

Este documento descreve contratos transversais e grupos funcionais; nao
substitui o inventario gerado, que e a fonte para a contagem corrente de rotas.

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
| `/api/companies/:companyId/approvers` | Diretorio de funcionarios, vinculo de autorizador, convite e remocao da funcao |
| `/api/me/corporate-contexts` | Contextos efetivos da sessao |
| `/api/auth/impersonation` | Representacao assistida temporaria e auditada |
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

## Autorizadores do diretorio de funcionarios

`/api/companies/:companyId/approvers` usa sempre o tenant da sessao e o escopo
da empresa recalculado no servidor. As respostas possuem
`Cache-Control: no-store, private`.

### Listar

`GET /api/companies/:companyId/approvers` exige `ver_funcionarios` na empresa e
retorna `employees`. A lista contem somente os campos necessarios para a tela:

```json
{
  "ok": true,
  "employees": [
    {
      "employeeId": "employee-id",
      "name": "Nome da pessoa",
      "registrationCode": "M-123",
      "department": "Financeiro",
      "costCenter": "CC-100",
      "identityStatus": "active",
      "approvalStatus": "active",
      "membershipId": "membership-uuid",
      "hasManagedLink": true,
      "reassignable": false,
      "canEnterRules": true,
      "blockedReason": null,
      "requiresIdentityConfirmation": false,
      "invitationState": "not_required",
      "inviteExpiresAt": null,
      "resendable": false
    }
  ]
}
```

O contrato nao devolve e-mail, documento ou telefone do funcionario nessa
listagem. `canEnterRules=true` e a condicao autoritativa para oferecer a pessoa
na matriz.

### Atribuir

`POST /api/companies/:companyId/approvers` exige simultaneamente
`gerenciar_usuarios` e `gerenciar_vinculos_acesso` na empresa.

```json
{
  "employeeId": "employee-id"
}
```

O corpo e estrito. Nao aceita nome, e-mail, senha, perfil ou permissoes livres.
Como esta e uma operacao administrativa dedicada, o ator precisa possuir
simultaneamente `gerenciar_usuarios` e `gerenciar_vinculos_acesso` na empresa.
Ele nao precisa ser autorizador nem possuir `decidir_aprovacoes`; a capacidade
de decisao continua vinculada exclusivamente ao funcionario escolhido e e
auditada separadamente.
Se uma conta corporativa preexistente precisar ser associada, a primeira chamada
retorna `409 EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED` com apenas:

```json
{
  "ok": false,
  "code": "EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED",
  "candidate": {
    "membershipId": "membership-uuid",
    "name": "Nome da conta"
  }
}
```

Depois da confirmacao visual, repita com `expectedMembershipId`. O servidor
revalida empresa, funcionario, e-mail, identidade, autoatribuicao e escopo; o ID
confirmado nao ignora essas verificacoes.

Sucesso retorna `201` quando cria a atribuicao ou `200` quando reutiliza/reativa:

```json
{
  "ok": true,
  "authorizer": {
    "employeeId": "employee-id",
    "name": "Nome da pessoa",
    "identityStatus": "invited",
    "approvalStatus": "pending_activation",
    "canEnterRules": false,
    "hasManagedLink": true,
    "invitationState": "sent",
    "inviteExpiresAt": "2026-08-30T12:00:00.000Z",
    "resendable": true,
    "reassignable": false
  },
  "invitation": { "state": "sent" }
}
```

`invitation.state` pode ser `not_required`, `sent` ou `delivery_pending`.
`delivery_pending` em uma resposta `2xx` confirma a atribuicao local, nao a
entrega do e-mail; o autorizador continua indisponivel para regras ate aceitar o
convite.

### Reenviar convite

Use o mesmo `POST` para uma atribuicao pendente:

```json
{
  "employeeId": "employee-id",
  "action": "resend_invite"
}
```

O reenvio expira convites nao aceitos anteriores, cria um token de 72 horas e
reatribui o novo convite ao vinculo pendente. A resposta informa novamente
`sent` ou `delivery_pending`.

Um vinculo historico revogado que volte a satisfazer todos os requisitos pode
ser retornado com `reassignable: true`. Nesse caso, uma nova atribuicao envia o
`membershipId` ja confirmado em `expectedMembershipId`; identidades inativas,
internas, ambiguas ou com e-mail divergente nunca sao reativadas implicitamente.

### Remover a funcao

`DELETE /api/companies/:companyId/approvers`, com corpo estrito
`{"employeeId":"employee-id"}`, remove somente a funcao de autorizador. Login,
perfil de solicitante e demais acessos corporativos sao preservados. O endpoint
retorna `409 EMPLOYEE_AUTHORIZER_PENDING_ASSIGNMENTS` se houver aprovacoes
pendentes que precisam ser reatribuidas ou delegadas.

## Representacao assistida da agencia

Os endpoints `/api/auth/impersonation/**` aceitam como ator somente papeis
internos elegiveis (`tenant_admin`, `supervisor`, `agent` ou `operator`) com
`gerenciar_personificacoes` e MFA confirmado nos ultimos 15 minutos.

Na sessao, `canStartRepresentation` informa a elegibilidade do ator e permanece
verdadeiro mesmo quando a confirmacao recente expirou.
`impersonationMfaRequired` informa que uma nova confirmacao deve ser feita antes
de listar alvos ou iniciar o acesso assistido.

- `GET /api/auth/impersonation/targets?q=...&limit=20`: lista usuarios
  corporativos compartilhados. Cada item contem `companyScopes` com
  `companyId`, rotulo e `allowedActions` calculadas para aquela empresa.
- `POST /api/auth/mfa/step-up`: confirma TOTP ou codigo de recuperacao e eleva
  somente a sessao autenticada para o acesso assistido. Exige CSRF, permissao,
  papel interno elegivel e limita as tentativas.
- `POST /api/auth/impersonation/start`: inicia uma representacao.
- `GET /api/auth/impersonation/current`: retorna ator, representacao atual e
  os indicadores `canStartRepresentation` e `impersonationMfaRequired`.
- `POST /api/auth/impersonation/stop`: encerra a representacao; e permitido
  mesmo durante o contexto representado.

Corpo estrito de inicio:

```json
{
  "targetMembershipId": "membership-uuid",
  "companyId": "company-id",
  "mode": "operate",
  "reason": "Atendimento solicitado pelo canal corporativo",
  "reference": "chamado-8452"
}
```

`companyId` e obrigatorio e precisa pertencer a intersecao de empresas do ator e
do alvo. A representacao persistida contem exatamente uma empresa. `reason`
possui de 10 a 500 caracteres. `reference` possui ate 160 caracteres e e
obrigatoria no modo `operate`.

Modos:

- `test`: somente leitura; mutacoes sao negadas;
- `operate`: permite apenas rotas que declaram uma `representationAction`
  presente em `allowedActions`.

As acoes controladas sao `demand.create`, `demand.correct`, `quote.select` e
`approval.decide`. Elas sao calculadas pela intersecao de permissoes do ator real
e do alvo na empresa selecionada. A decisao ainda exige que o alvo seja o
autorizador atribuido, com vinculo de funcionario e alcada validos. A
representacao expira em 15 minutos ou antes se escopo/permissoes mudarem.

O registro da representacao guarda ator real, usuario representado, empresa,
modo, motivo e referencia. As mutacoes assistidas registram o ator real, o alvo e
o ID da representacao, permitindo correlacionar todo esse contexto na auditoria.
Uma rota mutavel que nao optou explicitamente pelo acesso assistido permanece
bloqueada.

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
