# Acesso corporativo por grupo e empresa

## Principios

- `tenant` e o limite SaaS. Nenhum ID enviado pelo cliente define ou troca o tenant.
- `business_group` organiza empresas do mesmo tenant.
- `user` e a identidade individual; senha e sessao nunca sao compartilhadas.
- `tenant_membership` associa a identidade ao tenant.
- `employee` e a pessoa do quadro da empresa; o vinculo entre funcionario e login corporativo e explicito e especifico por empresa.
- Grants relacionais definem o perfil, as permissoes e as empresas cobertas.
- O contexto escolhido no navegador e apenas uma preferencia. Toda autorizacao e recalculada no servidor.
- Usuario interno da agencia e usuario corporativo sao dominios distintos. Uma conta interna nao pode ser usada como identidade de funcionario autorizador.

## Modelo relacional

A migration `0005_corporate_access.sql` adiciona:

- `corporate_group_access_grants`: acesso ao grupo em modo `all_companies` ou `selected_companies`;
- `corporate_group_access_companies`: empresas de um grant parcial;
- `corporate_company_access_grants`: acesso direto a uma empresa;
- `membership_corporate_preferences`: contexto padrao do usuario.

As tabelas possuem `tenant_id`, chaves estrangeiras compostas, unicidade para grants correntes, datas de validade, status, criador, timestamps e RLS forçada. Triggers impedem selecionar empresa de outro grupo, usar selecoes no modo `all_companies`, deixar grant parcial ativo vazio e persistir contexto padrao sem acesso efetivo.

A migration `0087_employee_portal_memberships.sql` adiciona `employee_portal_memberships`, que relaciona, no mesmo tenant e empresa:

- o funcionario (`employee_id`);
- a identidade corporativa (`membership_id`);
- o convite que originou um acesso pendente, quando houver;
- o snapshot de e-mail validado;
- o estado do vinculo (`pending`, `active` ou `revoked`);
- a habilitacao independente da funcao de autorizador (`approval_enabled`).

O estado da identidade e a funcao de autorizador sao independentes. Remover a funcao desativa a decisao e as autoridades daquela empresa, mas preserva login, perfil de solicitante e outros acessos. O desligamento/inativacao do funcionario revoga o vinculo gerenciado e o acesso direto daquela empresa sem atingir empresas nao relacionadas.

O vinculo exige funcionario e empresa ativos, portal habilitado, e-mail valido e nao ambiguo, identidade corporativa ativa/convidada e correspondencia do e-mail corrente com o snapshot. Alteracoes que quebrem essas invariantes falham de forma segura.

## Resolucao no servidor

`lib/server/corporate-access-service.ts` calcula a uniao de:

1. grants diretos de empresa ativos e validos;
2. empresas selecionadas em grants de grupo;
3. todas as empresas atuais do grupo em grants `all_companies`.

Uma empresa criada futuramente entra automaticamente somente no terceiro caso. Permissoes sao calculadas por empresa e nunca pela lista enviada pelo navegador.

Guardas principais:

- `requireCompanyAccess(principal, companyId, permission)`;
- `requireGroupAccess(principal, groupId, permission)`;
- `resolveCorporateContext(principal, requestedContext)`;
- `getAccessibleCompanyIds(principal)`;
- `getAccessibleGroupIds(principal)`;
- `canViewConsolidatedGroup(principal, groupId)`.

A visao consolidada exige grant de grupo, flag `can_view_consolidated`, permissao `ver_consolidado_grupo` e ao menos uma empresa autorizada. O conjunto consolidado e a intersecao das empresas do grant com a permissao exigida pelo modulo.

## Administracao delegada

`lib/server/corporate-access-admin-service.ts` valida delegacao e impede:

- concessao fora do tenant ou do grupo administrado;
- concessao de permissao superior a do administrador na mesma empresa;
- composicao de `gerenciar_usuarios` em uma empresa com `gerenciar_vinculos_acesso` em outra;
- concessao de empresas futuras sem grant proprio `all_companies`;
- alteracao ou remocao de grants invisiveis ao administrador parcial;
- alteracao de identidade, senha ou estado global por administrador parcial.

Ao editar uma pessoa com acessos em varios grupos, a API retorna e substitui somente os grants administraveis pelo ator. Grants dos demais grupos permanecem intactos. Apenas administrador do tenant ou da plataforma pode alterar a configuracao completa da identidade.

## Perfis

Os perfis corporativos sao templates, nao atalhos de autorizacao:

- `owner`;
- `ceo`;
- `group_admin`;
- `executive_assistant`;
- `group_finance`;
- `manager`;
- `viewer`;
- `company_admin`;
- `requester`;
- `approver`.

Overrides booleanos podem restringir ou ampliar o template somente ate o limite que o administrador pode delegar. Nenhum perfil corporativo vira `tenant_admin` ou administrador da plataforma.

`approver` e o template tecnico usado no grant da empresa. Ele nao basta sozinho: para decidir, a pessoa precisa manter o vinculo ativo com o funcionario, `approval_enabled`, permissao efetiva `decidir_aprovacoes` e uma atribuicao valida no workflow.

## Autorizadores a partir do diretorio de funcionarios

Em **Empresas > Pessoas e acessos > Autorizadores**, a lista nasce do diretorio de funcionarios da empresa. A busca da interface usa somente nome, matricula, departamento e centro de custo; nao existe convite livre de uma pessoa fora desse diretorio.

O fluxo de atribuicao:

1. valida empresa, portal, funcionario e e-mail;
2. reutiliza o vinculo canonico de solicitante quando ele for inequivoco;
3. se localizar outra conta corporativa compativel pelo e-mail, exige confirmacao explicita do `membershipId`;
4. se nao houver identidade, cria uma identidade convidada e envia convite de 72 horas;
5. ativa o vinculo somente apos aceitar o convite e revalidar todas as invariantes;
6. concede `ver_aprovacoes` e `decidir_aprovacoes` somente na empresa vinculada.

Convites pendentes podem ser reenviados. Cada reenvio expira o token anterior e associa o novo convite ao vinculo pendente. Falha de entrega fica visivel como `delivery_pending`; nao ha sucesso externo presumido.

Remover ou cancelar a atribuicao preserva a identidade e os demais grants, mas:

- bloqueia a remocao enquanto houver aprovacoes pendentes atribuidas;
- desabilita `decidir_aprovacoes` no grant direto da empresa;
- revoga autoridades de aprovacao e participacao em grupos de autorizadores daquela empresa;
- exige uma nova configuracao de regra para voltar a aprovar.

## Equipe interna da agencia

Usuarios internos sao administrados em **Usuarios** e nunca entram na lista de autorizadores corporativos. O preset **Consultor — atendimento completo** usa o perfil interno `agente`, habilita as permissoes operacionais necessarias e exige um escopo explicito:

- arrays de empresas/grupos vazios representam **Todas as empresas atuais e futuras** do tenant;
- selecoes representam **Somente empresas e grupos selecionados** e precisam conter ao menos um item.

O consultor opera diretamente demandas, cotacoes, reservas, emissoes, cancelamentos e vouchers conforme suas permissoes. Atos do cliente — escolha da cotacao e decisao de aprovacao — usam representacao auditada. A sessao assistida exige MFA recente, motivo, uma empresa compartilhada selecionada e, no modo `operate`, referencia do atendimento. Ela dura 15 minutos e fica restrita a uma unica empresa.

As acoes permitidas sao a intersecao por empresa entre ator real e usuario representado. A representacao nao ignora atribuicao de aprovacao, alçada, politica ou segregacao de funcoes, e os registros guardam ambos os usuarios.

## APIs e interface

- `GET/PATCH /api/me/corporate-contexts`: lista o acesso efetivo e salva a preferencia validada;
- `GET/PUT /api/users/:id/access`: consulta e substitui grants no escopo administravel;
- `GET/POST /api/users`: lista, convida ou associa uma identidade existente;
- `PATCH/DELETE /api/users/:id`: atualiza ou desativa com protecao de escopo;
- `GET/POST/DELETE /api/companies/:companyId/approvers`: lista o diretorio, atribui/reenvia e remove a funcao de autorizador;
- `/api/auth/impersonation/**`: lista alvos, inicia, consulta e encerra representacao assistida;
- `POST /api/auth/mfa/step-up`: renova a confirmacao de MFA somente na sessao atual antes do acesso assistido.

Todas usam sessao opaca, tenant da sessao, Zod, rate limit, auditoria e transacoes. O seletor do header permite alternar entre empresa e grupo sem novo login. O `localStorage` guarda somente a ultima escolha visual.

## Compatibilidade

Memberships antigos continuam usando `company_id`, `allowed_company_ids` e `allowed_group_ids` enquanto nao possuem configuracao relacional. A migration converte esses vinculos para grants. Depois que existir qualquer grant relacional, arrays legados nao reativam acesso suspenso, expirado ou revogado.

O gate de `employee_portal_memberships` e aplicado por empresa. Um vinculo gerenciado e revogado na empresa A nao remove, por efeito colateral, um grant legado independente nas empresas B ou C. O backfill so cria vinculos quando a identidade funcionario-conta e inequivoca; configuracoes de aprovacao que perderiam um autorizador verificavel bloqueiam a migration em vez de receber associacao por suposicao.

## Implantacao e reversao

1. Gere backup validado do PostgreSQL.
2. Execute `npm run db:validate-migrations`.
3. Execute `npm run db:migrate` com o papel de migrations.
4. Execute testes e `npm run build`.
5. Para o fluxo de funcionario-autorizador, publique a aplicacao somente depois da migration `0087` estar aplicada.

Nao remova as tabelas para reverter a aplicacao. Uma reversao segura consiste em voltar o binario, manter os dados relacionais e restaurar o backup apenas se houver necessidade comprovada de reversao do banco. Grants podem ser suspensos ou revogados sem excluir a identidade e sem apagar historico.
