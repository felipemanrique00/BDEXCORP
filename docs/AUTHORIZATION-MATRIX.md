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
| approver | empresa vinculada | negado | leitura necessaria | somente por vinculo de funcionario, regra e atribuicao | negado por padrao | negado |

## Identidades internas e corporativas

| Identidade | Como recebe escopo | Operacao direta | Escolha/aprovacao do cliente |
| --- | --- | --- | --- |
| Funcionario autorizador | vinculo explicito `employee_portal_memberships` por empresa | conforme perfil corporativo | como a propria pessoa, dentro da regra, alçada e atribuicao |
| Solicitante corporativo | grant da empresa/grupo e cadastro de solicitante | cria e acompanha o que lhe e permitido | escolhe a cotacao quando responsavel |
| Consultor interno com preset **Consultor — atendimento completo** | todas as empresas atuais/futuras ou selecao explicita de empresas/grupos | demandas, cotacoes, reservas, emissoes, cancelamentos e vouchers | somente por representacao assistida de um solicitante/autorizador elegivel |
| Administrador da plataforma | autoridade SaaS | nao recebe dados de negocio automaticamente | nao se torna autorizador corporativo |

## Permissoes relevantes

- acesso: `ver_empresas`, `ver_consolidado_grupo`, `gerenciar_vinculos_acesso`;
- pessoas: `ver_funcionarios`, `gerenciar_funcionarios`, `ver_solicitantes`;
- operacao: `criar_demandas`, `ver_demandas`, `operar_cotacoes`,
  `operar_reservas`, `operar_emissoes`, `operar_cancelamentos`;
- aprovacao: `ver_aprovacoes`, `decidir_aprovacoes`, `gerenciar_workflows`;
- financeiro: `ver_financeiro`, `editar_financeiro`;
- relatorios: `ver_relatorios`, `gerar_relatorios`, `exportar_relatorios`;
- governanca: `gerenciar_usuarios`, `alterar_configuracoes`,
  `gerenciar_integracoes`, `gerenciar_politicas`, `publicar_politicas`,
  `gerenciar_personificacoes`;
- operacao interna: `ver_produtividade_todos`.

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
9. Uma conta interna da agencia nunca e candidata a autorizador corporativo.
10. Um autorizador gerenciado so decide na empresa em que funcionario ativo, membership ativa, e-mail validado, `approval_enabled` e grant decisorio continuam validos.
11. Remover a funcao de autorizador preserva os outros acessos da identidade e nao pode deixar atribuicoes pendentes sem responsavel.
12. Representacao assistida fica limitada a uma unica empresa e, no modo operacional, somente as acoes permitidas simultaneamente ao ator real e ao usuario representado ficam disponiveis.
13. Representacao exige MFA recente, motivo e auditoria; operacao exige referencia e expira em 15 minutos.
14. A pessoa representada precisa ser o solicitante responsavel pela escolha ou o autorizador que recebeu a atribuicao. Uma delegacao nao e decidida por representacao.
15. Segregacao de funcoes considera tambem o ator real: o mesmo consultor nao fornece N1 e N2 nem contorna conflitos do solicitante/viajante.

## Guardas

- `guardApiRequest`: autenticacao, tenant, rate limit e permissao.
- `requireCompanyAccess`: empresa e permissao efetiva.
- `requireGroupAccess`: grupo, empresas permitidas e consolidado.
- `resolveCorporateContext`: valida o contexto solicitado.
- servicos administrativos: validam autoridade de delegacao por origem.
- `corporate_user_can_decide_for_company` e o gate do vinculo funcionario-conta antes da decisao.
- `assertEmployeeAuthorizerDecisionLink`: revalida o autorizador gerenciado na empresa da aprovacao.
- `allowedImpersonationActions`: calcula a intersecao de acoes por empresa.
- `requireActiveOperateRepresentation`: confirma representacao, ator, alvo, empresa, acao e validade antes da mutacao assistida.

Detalhes de grants e compatibilidade estao em `CORPORATE-ACCESS.md`.
