# Production Readiness

Data da avaliacao: 2026-07-21.

## Status executivo

- **Piloto da agencia: NO-GO neste momento.**
- **SaaS: NO-GO neste momento.**
- **Codigo: preparado para staging e para executar a validacao externa obrigatoria.**

O NO-GO nao decorre de falha local de lint, tipos, testes unitarios ou build. Ele existe porque este computador nao possui Docker, `psql` ou `sh`, e as credenciais externas nao foram homologadas. Portanto ainda nao ha evidencia local de migrations em PostgreSQL, isolamento RLS executado, browser E2E, container, reinicio, SMTP, backup/restore ou Tech transacional.

## Situacao inicial encontrada

- persistencia corporativa dependente de arquivo/localStorage;
- sessao e usuarios sem uma base multi-tenant autoritativa completa;
- hidratacao ampla de dezenas de megabytes no browser, com risco de OOM;
- operacoes que podiam exibir sucesso antes da confirmacao remota;
- uploads em base64 junto dos dados da aplicacao;
- integracoes e testes com caminhos de sucesso nao homologados;
- schemas SQL concorrentes e sem processo unico de migration;
- ausencia de imagem/Compose/release/restore de referencia;
- scripts Windows e documentos apontando para JSON e credencial mestre antiga;
- risco de executar a aplicacao com o superusuario inicial do container PostgreSQL, anulando a protecao RLS.

## Correcoes implementadas

### Persistencia e SaaS

- PostgreSQL obrigatorio em producao.
- Migrations versionadas com checksum e advisory lock.
- Tenants, planos, assinaturas, users, memberships, roles, permissions e auditoria.
- Tabelas relacionais de grupos, empresas, funcionarios, aliases, demandas, reservas, vouchers, financeiro e importacoes.
- RLS forcado em dados por tenant e chaves estrangeiras compostas.
- Papel web separado da conta de migrations, sem `SUPERUSER/BYPASSRLS`.
- Readiness retorna 503 para papel PostgreSQL inseguro.
- Sessoes, rate limit, idempotencia, uso e dados compartilhados no banco.
- Limites de usuarios, armazenamento e operacoes mensais aplicados no servidor.

### Autenticacao e autorizacao

- Senha com `scrypt` e politica forte.
- Sessao opaca revogavel no banco e cookie seguro.
- Bloqueio por falhas, logout, troca e reset de senha.
- Convite e recuperacao com token hash, expiracao e SMTP.
- Permissoes, papeis e escopo de empresa/grupo no servidor.
- Validacao de origem em mutacoes e rate limit por rota.
- Rotas administrativas e de plataforma protegidas.

### Arquivos e dados

- PDF privado fora de `public`, com tamanho, extensao, assinatura e SHA-256.
- Metadados/vinculos no PostgreSQL e download autorizado.
- Reset por tenant com senha, auditoria, staging e protecao contra ressincronizacao de dados apagados.
- Identidade permanente de funcionario, aliases e reconciliacao manual preservadas.
- Persistencia remota aguardada antes de mensagens de sucesso em fluxos criticos.

### Integracoes

- Respostas ficticias de hotel, IA, audio, cotacao e aprovacao removidas.
- Tech Reports preparado com segredo somente no servidor e normalizacao.
- Tech transacional retorna indisponibilidade enquanto nao homologado.
- Erros do fornecedor nao vazam detalhes internos ao cliente.
- Envio de voucher por WhatsApp nao confirma sucesso sem transporte real.
- Test routes retornam 404 em producao.

### Performance e frontend

- Hidratacao seletiva por rota e consulta de chaves especificas.
- Conjuntos grandes permanecem fora do localStorage.
- Sidebar usa resumo pequeno e intervalo controlado.
- Worker PDF local, sem CDN em runtime.
- Leaflet CSS e fontes sem injecao externa desnecessaria.
- CSP com nonce corrigida para os scripts internos do Next.js, com regressao E2E em desktop e mobile.
- Build final: dashboard 294 kB, portal 280 kB, relatorio de grupo 306 kB de First Load JS.

### Operacao

- Dockerfile multi-stage, usuario nao root, read-only e readiness.
- Compose com rede privada, PostgreSQL, Caddy, volumes, migrations, bootstrap, backup e restore isolado.
- Scripts de release, rollback, backup, restore, smoke e carga.
- CI com PostgreSQL, app role seguro, migrations, bootstrap, integracao, E2E, imagem, backup e restore.
- Scripts Windows/Tailscale atualizados para PostgreSQL; JSON e senha mestre removidos do caminho ativo.
- Documentacao operacional e historico separados.

## Evidencias locais

| Validacao | Resultado |
| --- | --- |
| Node/npm | Node 24.15.0; npm 11.12.1 |
| Instalacao limpa | `npm ci --no-audit --no-fund`: 548 pacotes instalados conforme lockfile |
| Migrations estaticas | 4 aprovadas com SHA-256 |
| Inventario | 55 paginas, 66 APIs, nenhuma API inesperadamente aberta |
| Scanner de segredos | aprovado, sem achado de alta confianca |
| Ambiente ficticio seguro | validacao aprovada sem imprimir segredo |
| PowerShell | todos os scripts parseados sem erro |
| ESLint | aprovado, sem warning/erro de codigo; aviso de depreciacao do `next lint` |
| TypeScript | aprovado com `--incremental false` |
| Dominio | aprovado |
| Unitarios | 9 arquivos, 32 testes aprovados |
| Build | aprovado; rotas da aplicacao renderizadas dinamicamente para suportar nonce CSP |
| Runtime HTTP | `/api/health` 200; `/login` 200; `/api/ready` 503 sem PostgreSQL, conforme esperado |
| Browser publico | login renderizado e inspecionado em Chrome desktop/mobile |
| E2E de acesso | 2 cenarios aprovados: rota protegida, redirect, tela visivel e CSP |
| Webpack cache | tres avisos de snapshot no Windows; compilacao concluida |

## Nao verificado neste ambiente

- `npm audit` contra registry; a tentativa local foi bloqueada pela politica do ambiente para nao enviar metadados deste projeto privado ao registro externo;
- `sh -n` dos scripts Linux;
- migrations e bootstrap em PostgreSQL real;
- teste de isolamento com papel nao privilegiado;
- Playwright autenticado e fluxos internos completos;
- Docker build, Compose e usuario/volume em runtime;
- persistencia depois de reinicio;
- teste de carga contra app executando;
- backup e restore isolado;
- SMTP e entrega de convite/reset;
- Tech Reports com credencial real;
- Tech cotacao/reserva/emissao/cancelamento;
- OpenAI/Gemini e WhatsApp reais;
- auditoria de penetracao e observabilidade externa.

Esses itens estao automatizados ou documentados, mas nao recebem status de aprovados sem execucao.

## Bloqueadores para piloto

1. Executar o workflow completo ou ambiente equivalente com PostgreSQL e Docker.
2. Aprovar isolamento RLS com papel web nao privilegiado.
3. Validar backup e restore com copia isolada.
4. Configurar e testar SMTP real.
5. Definir quais integracoes sao essenciais; homologar as essenciais.
6. Executar roteiro manual das telas principais e dos relatorios em desktop/mobile.
7. Configurar HTTPS, monitoramento, alerta e copia externa de backup.
8. Rotacionar qualquer credencial que tenha sido compartilhada fora do secret store.

## Bloqueadores adicionais para SaaS

- armazenamento de objetos compartilhado para varias instancias;
- politica de fila para tarefas longas;
- metricas/tracing centralizados e SLOs;
- teste de carga no servidor alvo;
- processo juridico e operacional de privacidade/retencao;
- validacao de PostgreSQL gerenciado e recuperacao de desastre;
- reducao incremental do legado tipado com `any` e da camada `app_kv` de compatibilidade.

## Dependencias

Adicionadas para necessidades concretas: `pg` (PostgreSQL), `nodemailer` (SMTP), `pdfjs-dist` (PDF local), Vitest (unidade) e Playwright (E2E). Nao houve atualizacao indiscriminada de versoes principais.

## Garantia de preservacao

Nenhuma pagina, rota, filtro, relatorio ou fluxo foi intencionalmente removido. Operacoes sem backend real foram mantidas visiveis, mas agora falham de forma explicita em vez de inventar resultado. O projeto original permanece intacto fora desta pasta.
