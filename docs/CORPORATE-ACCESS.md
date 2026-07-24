# Acesso corporativo por grupo e empresa

## Principios

- `tenant` e o limite SaaS. Nenhum ID enviado pelo cliente define ou troca o tenant.
- `business_group` organiza empresas do mesmo tenant.
- `user` e a identidade individual; senha e sessao nunca sao compartilhadas.
- `tenant_membership` associa a identidade ao tenant.
- Grants relacionais definem o perfil, as permissoes e as empresas cobertas.
- O contexto escolhido no navegador e apenas uma preferencia. Toda autorizacao e recalculada no servidor.

## Modelo relacional

A migration `0005_corporate_access.sql` adiciona:

- `corporate_group_access_grants`: acesso ao grupo em modo `all_companies` ou `selected_companies`;
- `corporate_group_access_companies`: empresas de um grant parcial;
- `corporate_company_access_grants`: acesso direto a uma empresa;
- `membership_corporate_preferences`: contexto padrao do usuario.

As tabelas possuem `tenant_id`, chaves estrangeiras compostas, unicidade para grants correntes, datas de validade, status, criador, timestamps e RLS forçada. Triggers impedem selecionar empresa de outro grupo, usar selecoes no modo `all_companies`, deixar grant parcial ativo vazio e persistir contexto padrao sem acesso efetivo.

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
- `requester`.

Overrides booleanos podem restringir ou ampliar o template somente ate o limite que o administrador pode delegar. Nenhum perfil corporativo vira `tenant_admin` ou administrador da plataforma.

## APIs e interface

- `GET/PATCH /api/me/corporate-contexts`: lista o acesso efetivo e salva a preferencia validada;
- `GET/PUT /api/users/:id/access`: consulta e substitui grants no escopo administravel;
- `GET/POST /api/users`: lista, convida ou associa uma identidade existente;
- `PATCH/DELETE /api/users/:id`: atualiza ou desativa com protecao de escopo.

Todas usam sessao opaca, tenant da sessao, Zod, rate limit, auditoria e transacoes. O seletor do header permite alternar entre empresa e grupo sem novo login. O `localStorage` guarda somente a ultima escolha visual.

## Compatibilidade

Memberships antigos continuam usando `company_id`, `allowed_company_ids` e `allowed_group_ids` enquanto nao possuem configuracao relacional. A migration converte esses vinculos para grants. Depois que existir qualquer grant relacional, arrays legados nao reativam acesso suspenso, expirado ou revogado.

## Implantacao e reversao

1. Gere backup validado do PostgreSQL.
2. Execute `npm run db:validate-migrations`.
3. Execute `npm run db:migrate` com o papel de migrations.
4. Execute testes e `npm run build`.
5. Publique a aplicacao somente depois da migration `0005` estar aplicada.

Nao remova as tabelas para reverter a aplicacao. Uma reversao segura consiste em voltar o binario, manter os dados relacionais e restaurar o backup apenas se houver necessidade comprovada de reversao do banco. Grants podem ser suspensos ou revogados sem excluir a identidade e sem apagar historico.
