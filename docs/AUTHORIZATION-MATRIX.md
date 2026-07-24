# Matriz de autorizacao

Perfis sao templates. A decisao real combina tenant, membership, grants ativos, empresa,
grupo, permissao, estado do recurso e origem da autoridade.

| Perfil corporativo | Empresas | Consolidado | Demandas | Aprovacoes | Financeiro | Usuarios/acessos |
| --- | --- | --- | --- | --- | --- | --- |
| owner | grupo autorizado | permitido | amplo | conforme permissao | conforme permissao | grupo autorizado |
| ceo | atuais/futuras autorizadas | permitido | leitura/gestao | conforme workflow | leitura se concedida | nao e admin SaaS |
| group_admin | grupo administrado | configuravel | gestao | configuravel | nao automatico | grants dentro da autoridade |
| executive_assistant | selecionadas | opcional e parcial | criar/acompanhar | nao automatico | negado por padrao | negado |
| group_finance | selecionadas ou grupo | opcional | leitura necessaria | financeira se concedida | permitido | negado |
| manager | selecionadas | opcional | criar/acompanhar | conforme alcada | nao automatico | negado |
| viewer | selecionadas | somente leitura | leitura | leitura se concedida | negado por padrao | negado |
| company_admin | empresa(s) | sem grupo automatico | gestao da empresa | configuravel | configuravel | empresa dentro da autoridade |
| requester | empresa(s) | negado | criar e acompanhar proprias | negado | negado | negado |

## Permissoes relevantes

- acesso: `ver_empresas`, `ver_consolidado_grupo`, `gerenciar_vinculos_acesso`;
- pessoas: `ver_funcionarios`, `gerenciar_funcionarios`, `ver_solicitantes`;
- operacao: `criar_demandas`, `ver_demandas`, `operar_cotacoes`,
  `operar_reservas`, `operar_emissoes`, `operar_cancelamentos`;
- aprovacao: `ver_aprovacoes`, `decidir_aprovacoes`, `gerenciar_workflows`;
- financeiro: `ver_financeiro`, `editar_financeiro`;
- relatorios: `ver_relatorios`, `gerar_relatorios`, `exportar_relatorios`;
- governanca: `gerenciar_usuarios`, `alterar_configuracoes`,
  `gerenciar_integracoes`, `gerenciar_politicas`, `publicar_politicas`.

## Regras invariantes

1. `tenantId`, `companyId`, `groupId`, `userId` e listas enviadas pelo cliente nao
   autorizam uma operacao.
2. Acesso direto a uma empresa nao concede grupo, consolidado ou empresas futuras.
3. `all_companies` inclui empresas futuras; `selected_companies` nao inclui.
4. Consolidado agrega somente empresas autorizadas para a permissao do modulo.
5. Autoridades de fontes diferentes nao podem ser combinadas para delegar privilegio maior.
6. Administrador de grupo nao concede acesso fora do grupo ou tenant.
7. Perfil legado `master` nao substitui a verificacao de permissao no servidor.
8. Plataforma SaaS nao recebe acesso automatico aos dados de negocio do tenant.

## Guardas

- `guardApiRequest`: autenticacao, tenant, rate limit e permissao.
- `requireCompanyAccess`: empresa e permissao efetiva.
- `requireGroupAccess`: grupo, empresas permitidas e consolidado.
- `resolveCorporateContext`: valida o contexto solicitado.
- servicos administrativos: validam autoridade de delegacao por origem.

Detalhes de grants e compatibilidade estao em `CORPORATE-ACCESS.md`.
