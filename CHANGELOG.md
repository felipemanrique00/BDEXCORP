# Changelog

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
