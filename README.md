# BDEX - BBT Corporativo

Plataforma de gestão de viagens corporativas da BBT Corporativo. Reúne operação, empresas e grupos, viajantes, vouchers, integrações Wintour e Tech Travel, financeiro, relatórios interativos e a assistente BIA.

## Stack

- Next.js 15 com React 18 e TypeScript.
- Tailwind CSS, Lucide, Recharts e Leaflet.
- Zustand para estado da aplicação e Zod para validação.
- PostgreSQL (`pg`) na implantação de produção.
- Testes de domínio em Node.js e verificações de ESLint/TypeScript.

## Preparação

Requisitos: Node.js 20.9 ou superior e npm. O guia completo de implantação está em `INSTALAR.txt`.

```bash
npm install
copy .env.example .env.local
npm run dev
```

A aplicação local fica normalmente em `http://localhost:3000`.

Nunca envie `.env.local`, `.env.production.local`, `.bbt-storage` ou logs para o repositório. As integrações opcionais devem ser configuradas apenas pelas variáveis documentadas em `.env.example`.

## Validação

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Para executar toda a linha de qualidade em sequência:

```bash
npm run validate
```

## Dados e armazenamento

- Em desenvolvimento, o storage compartilhado usa `.bbt-storage`, ignorado pelo Git.
- O cliente hidrata os dados compartilhados e reidrata o store antes de liberar os fluxos autenticados.
- Importações são consolidadas por chaves estáveis, preservam exclusões e não devem substituir registros de outra empresa.
- Viajantes usam identificação permanente; aliases e reconciliação manual tratam variações de nomes.
- O sistema inicia sem empresas, funcionários ou demandas de demonstração.
- O reset completo é confirmado no servidor, limpa anexos locais e registra marcadores que impedem sessões antigas de restaurar dados apagados.
- Produção deve usar PostgreSQL com `DATABASE_URL`, backups testados e política de retenção definida.

Inicialização do banco de produção:

```bash
npm run db:init
```

Os artefatos de implantação ficam em `deploy/postgres`, `deploy/scripts`, `deploy/systemd` e `deploy/nginx`.

## Segurança e acesso

- APIs sensíveis exigem sessão, permissão e limites de requisição/corpo.
- Usuários de empresa recebem apenas dados do seu escopo.
- Custos internos, markup, observações internas e informações de pagamento não são expostos na visão do cliente.
- Alterações de vouchers, hotéis, usuários e configurações administrativas são restritas à equipe autorizada.

## Relatórios

Os relatórios por empresa, grupo, viajante, centro de custo e agente compartilham filtros e regras de acesso. O dashboard corporativo possui gráficos interativos, evolução mensal, rankings e mapa Leaflet. A exportação HTML gera um arquivo autônomo com filtros e interações; os mapas e tiles dependem de conexão com a internet ao abrir o arquivo.

## Tech Travel

O relatório oficial de emissões pode ser consultado em **Emissões e importações**, sem enviar a credencial ao navegador. Configure `TECH_REPORTS_ENABLED`, `TECH_REPORTS_BASE_URL` e `TECH_REPORTS_KEY` apenas no ambiente do servidor. Esse acesso é independente do conector de cotações e reservas, que usa as variáveis `TECH_API_*`.

Antes de importar, cada cliente retornado pela Tech Travel deve ser vinculado explicitamente a uma empresa local. Reimportações usam identificação estável e atualizam a emissão existente sem transformar margem em economia.

## Documentação

- `docs/AUDITORIA_PRE_DOCUMENTACAO.md`: inventário funcional e técnico.
- `docs/AUDITORIA_SENIOR_2026_07_14.md`: auditoria e validação mais recente.
- `docs/RELATORIO_DASHBOARD_INTERATIVO.md`: arquitetura do relatório interativo.
- `docs/INTEGRACAO_TECH_TRAVEL_EMISSOES.md`: configuração e operação da importação de emissões.
- `docs/finais`: apresentação, documentação técnica e pendências de implantação.

## Produção

Use HTTPS, Nginx, Node.js LTS, PostgreSQL, firewall, monitoramento, backup diário e teste periódico de restauração. O armazenamento local em JSON é adequado ao desenvolvimento e à migração, mas não substitui o banco transacional em operação concorrente de produção.

Para a hospedagem restrita neste notebook Windows, consulte `HOSPEDAGEM-NO-NOTEBOOK.md`. Essa implantação usa o build de produção do Next.js em `127.0.0.1`, Tarefa Agendada do Windows, backup diário e Tailscale Serve, sem abrir portas no roteador.
