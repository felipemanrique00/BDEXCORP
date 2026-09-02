# Changelog

## 1.3.2 - 2026-09-02

### Correções

- A pendência de CPF do viajante passa a informar `CPF ausente ou inválido`, evitando classificar um documento preenchido com dígitos verificadores inválidos como ausente.
- O formulário de complementação esclarece que pode corrigir informações ausentes ou inválidas, mantendo a validação estrita do CPF no backend.
- A mesma orientação é exibida nos seletores de viajantes dos fluxos aéreo e hoteleiro.

### Implantação

- Versão do pacote: `1.3.2`.
- Release somente de aplicação; não adiciona migration e mantém o schema em `0087_employee_portal_memberships.sql`.

## 1.3.1 - 2026-08-28

### Correções

- Restaurada a seleção `Global` no Portal empresas/Grupos para usuários internos da agência, incluindo empresas de grupos diferentes dentro do escopo efetivamente autorizado.
- Preservados os contextos explícitos de empresa e grupo, sem ampliar a seleção dos usuários corporativos nem a representação assistida.
- A visão global usa identidade visual neutra, respeita permissões por empresa e não infere uma empresa para criação de pedidos, carteira ou geração de relatórios externos.
- A IA rápida passa a usar somente empresas, funcionários, políticas, demandas e vouchers pertencentes à seleção corporativa atual.
- A seleção global fica restrita à rota do Portal empresas/Grupos e é descartada ao sair dela, evitando que outras telas criem registros em uma empresa ou escopo implícito.

### Implantação

- Versão do pacote: `1.3.1`.
- Release somente de aplicação; não adiciona migration e mantém o schema em `0087_employee_portal_memberships.sql`.

## 1.3.0 - 2026-08-27

### Destaques

- Atribuição de autorizadores exclusivamente a partir do cadastro de funcionários da empresa, com vínculo explícito entre funcionário e conta corporativa.
- Confirmação segura de identidade, convite, reenvio, cancelamento e reatribuição; a remoção da função de autorizador preserva login, perfil de solicitante e demais acessos.
- Decisão de aprovação condicionada a vínculo ativo, empresa habilitada no Portal Empresa e permissão efetiva; identidades internas da agência não podem ser autorizadores corporativos.
- Preset `Consultor — atendimento completo` para a equipe da agência, com escopo global ou por empresas/grupos e operação direta do pedido à emissão.
- Escolha de cotação e autorização assistidas com empresa única por sessão, MFA, ator real, usuário representado, auditoria e segregação de funções.
- Fronteira do Portal Empresa aplicada também às consultas, catálogos e seleções de cotações offline, sem restringir a operação interna da agência.
- Tutorial e documentação de acessos, APIs e matriz de autorização atualizados para o fluxo por funcionário.

### Segurança e ciclo de vida

- Desligamento, mudança de empresa, expiração/revogação de delegação e alteração de acessos não deixam atribuições pendentes sem recuperação.
- Grants decisórios genéricos são normalizados para escopos diretos vinculados ao funcionário; o cadastro genérico de usuários não concede mais `decidir_aprovacoes`.
- Grupos empresariais exigem cobertura explícita em cada empresa habilitada, evitando expansão automática para empresas futuras sem autorizador.

### Implantação

- Versão do pacote: `1.3.0`.
- A release adiciona `0087_employee_portal_memberships.sql` e exige que a role de migration tenha `SUPERUSER` ou `BYPASSRLS` para executar os preflights sob RLS forçado.
- A migration falha de forma integral quando encontra atribuições ou configurações decisórias legadas sem vínculo verificável; o inventário deve ser revisado antes da aplicação.

## 1.2.0 - 2026-08-27

### Destaques

- Cadastro de autorizadores corporativos dentro da empresa, com regras por empresa, grupo empresarial, centro de custo, departamento e grupo de usuários.
- Fluxos de aprovação com primeiro e segundo níveis, incluindo escalonamento por violação de política ou estouro de alçada.
- Habilitação explícita do Portal Empresa no cadastro da empresa. Novas empresas são opt-in; empresas ativas preexistentes permanecem habilitadas.
- Reforços de integridade, segregação de funções e versionamento para matrizes, políticas e workflows de aprovação.
- Evoluções dos fluxos offline, do portal corporativo e das integrações operacionais incluídas nas migrations 0074 a 0086.

### Implantação

- Versão do pacote: `1.2.0`.
- A release exige a aplicação sequencial das migrations `0074` a `0086`.
- `0086_company_portal_company_enablement.sql` preserva o acesso das empresas ativas existentes e define novas empresas como não habilitadas até a seleção explícita no cadastro.
