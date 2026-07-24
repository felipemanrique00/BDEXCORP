# Parecer final de prontidao

Data: 2026-07-24.

Branch validada: `codex/bdex-final-gap-closure`.

## Decisao executiva

| Escopo | Decisao | Condicao |
| --- | --- | --- |
| Codigo para staging controlado | **GO** | Usar PostgreSQL descartavel ou staging isolado |
| Piloto com dados reais | **NO-GO** | Falta homologar infraestrutura, backup/restore, SMTP e fornecedores usados |
| Producao publica | **NO-GO** | Falta executar container, rollback, observabilidade e seguranca externa |
| Comercializacao SaaS | **NO-GO** | Falta operacao multi-instancia, DR, capacidade, suporte e compliance |

O codigo, o banco relacional e os fluxos E2E selecionados passaram localmente.
O `NO-GO` para producao nao decorre de falha escondida de compilacao: decorre
de evidencias que dependem do servidor e de terceiros e nao podem ser simuladas.

## Revalidacao das hipoteses iniciais

| # | Hipotese | Resultado em 24/07/2026 |
| ---: | --- | --- |
| 1 | `/api/storage` permite escrita sensivel | **Confirmado e corrigido**: deny-by-default, inventario e APIs de dominio |
| 2 | Colecoes sem permissao de escrita | **Confirmado e corrigido** por permissao funcional e dominio |
| 3 | IA possui caminhos de execucao diferentes | **Confirmado e consolidado** no servico governado |
| 4 | IA grava primeiro no navegador | **Confirmado e corrigido** para PostgreSQL relacional |
| 5 | Confirmacao de IA pode ficar desativada | **Confirmado e corrigido** para acoes sensiveis |
| 6 | Rollout ainda usa shadow/dual | **Parcial**: novos tenants usam relacional; legado exige cutover comprovado |
| 7 | Dominios criticos dependem de `app_kv` | **Corrigido nos dominios governados**; diretorio legado ainda compativel |
| 8 | Matriz do PDF nao concluida | **Corrigido**: 149 de 150 referencias mapeadas; uma recusada por seguranca |
| 9 | Policy Engine sem construtor completo | **Corrigido** com edicao, simulacao, versao e publicacao |
| 10 | Workflow geral incompleto | **Corrigido** com editor, runtime, versao, simulacao e historico |
| 11 | IA sem contexto nas paginas | **Corrigido nas superficies governadas** |
| 12 | RAG empresarial incompleto | **Corrigido** com base de conhecimento relacional |
| 13 | Centro de Inteligencia inicial | **Corrigido** com insights persistentes e API |
| 14 | Eventos sem Central de Automacoes | **Corrigido** com definicoes, versoes, simulacao e execucoes |
| 15 | Busca universal incompleta | **Corrigido** com API e comando global autorizados |
| 16 | PWA do viajante incompleta | **Ampliado e testado**; homologacao de dispositivos continua necessaria |
| 17 | Playwright limitado | **Ampliado** para autenticacao, MFA, SaaS, arquivo, relatorio e viajante |
| 18 | PostgreSQL pode ser ignorado | **Corrigido**: gate exige `TEST_DATABASE_URL` descartavel |
| 19 | Sem DAST/matriz de seguranca | **Parcial**: smoke interno e inventario passam; DAST amplo externo pendente |
| 20 | MFA administrativo incompleto | **Corrigido** com TOTP, recovery, anti-replay e pre-sessao |
| 21 | Integracoes nao homologadas | **Bloqueado externamente**: codigo nao equivale a homologacao |
| 22 | Servicos e paginas muito grandes | **Parcial**: limites criticos separados; refatoracao ampla nao foi forcada |

## Correcoes de seguranca e dados

- Migration `0049_identity_plane_rls.sql` habilita e forca RLS em:
  `tenant_memberships`, `roles`, `tenant_subscriptions`, `user_invites` e
  `user_sessions`.
- Login, reset, convite e sessao usam contextos transacionais restritos por
  tenant, identidade, hash opaco ou administrador verificado.
- Migration `0050_password_reset_tenant_binding.sql` preserva no token o tenant
  que originou a recuperacao de senha.
- Administracao de tenant altera somente seu membership e revoga somente suas
  sessoes; identidade compartilhada exige administracao da plataforma para
  mudancas globais.
- O papel web testado nao possui `SUPERUSER` nem `BYPASSRLS`.
- `/api/ready` exige as 50 migrations, compara checksums, rejeita migrations
  extras e recusa papel inseguro.
- APIs de arquivos e snapshots revalidam entidade, usuario e empresa no
  servidor.
- Testes jamais reutilizam `DATABASE_URL`; somente `TEST_DATABASE_URL`
  explicitamente descartavel.
- MFA e segredos obrigatorios foram alinhados no Compose e no CI.
- Next.js foi atualizado para `15.5.21`; PostCSS para `8.5.21`; Sharp foi
  fixado em `0.35.0`.
- As auditorias npm completa e de producao retornaram zero vulnerabilidades.

## Entrega funcional consolidada

- autorizacao fina por tenant, grupo, empresa, recurso, acao, estado e campo;
- acesso corporativo multiempresa e visao consolidada;
- Policy Engine rastreavel contra o PDF ARGO;
- Approval Engine e workflow empresarial versionado;
- ciclo de viagem, comandos de dominio, idempotencia e reconciliacao;
- IA governada, base de conhecimento e acoes com confirmacao;
- Centro de Inteligencia e Central de Automacoes;
- busca universal;
- portal/PWA do viajante;
- relatorios, snapshots e arquivos privados;
- MFA administrativo;
- readiness, test guards e pipeline de qualidade.

Nenhuma pagina, API ou funcionalidade foi intencionalmente removida.

## Evidencias executadas

| Validacao | Resultado |
| --- | --- |
| `npm ci` | 548 pacotes instalados; zero vulnerabilidades |
| `npm run db:validate-migrations` | 50 migrations validas |
| Aplicacao das migrations | `0001` a `0050` em PostgreSQL descartavel |
| `npm run inventory:check` | 61 paginas e 166 arquivos de rotas atualizados |
| `npm run security:scan` | sem segredo de alta confianca |
| `npm audit --omit=dev --audit-level=high` | zero vulnerabilidades |
| `npm audit --audit-level=high` | zero vulnerabilidades |
| `npm run lint` | sem warnings ou erros de ESLint |
| `npm run typecheck` | aprovado |
| `npm run test:domain` | aprovado |
| `npm run test:unit` | 68 arquivos e 344 testes aprovados |
| `npm run test:integration` | 15 arquivos e 50 testes PostgreSQL aprovados |
| `npm run build` | aprovado com Next.js 15.5.21 |
| `npm run test:e2e` | 10 aprovados e 2 mobile deliberadamente ignorados |
| `npm run security:smoke` | cabecalhos, negacao, IDOR, storage, login e readiness aprovados |
| `npm run test:load` | 100 requisicoes, concorrencia 10, 0 erros, p95 247,76 ms |
| `/api/ready` | validacao exata de nomes e checksums; schema `0050_password_reset_tenant_binding.sql` |

O E2E validou login invalido, MFA antes da sessao, administracao SaaS,
persistencia de relatorio, arquivo privado e isolamento do portal do viajante.
Os dois skips evitam repetir no projeto mobile os cenarios administrativos
marcados exclusivamente para desktop; nao representam falha.

## Integracoes

| Integracao | Estado do codigo | Homologacao |
| --- | --- | --- |
| Tech Reports | proxy, schema e normalizacao | Pendente de chave rotacionada/sandbox |
| Tech transacional | adapter, idempotencia, estado ambiguo e reconciliacao | Pendente do fornecedor |
| Wintour | parser, identidade e importacao relacional de demandas | Validar arquivos reais por cliente |
| SMTP | convite e reset | Pendente de credencial e entrega real |
| IA externa | adapters opcionais | Pendente de credencial, privacidade e custo |
| WhatsApp | adapter opcional | Pendente de homologacao |
| Mapas | Leaflet e dados geograficos | Pendente de rede, tiles e termos |

Nenhuma integracao desabilitada retorna sucesso ficticio.

## Limites ainda abertos

- Docker e Compose nao estao instalados nesta maquina.
- A imagem, runtime read-only, reinicio e persistencia do volume nao foram
  executados localmente.
- `pg_dump`, backup, restore isolado, rollback N-1 e copia externa nao foram
  executados.
- Tech, SMTP, IA, WhatsApp e tiles nao foram homologados em sandbox.
- A importacao Wintour ainda nao e uma unica transacao entre cadastros
  compativeis e o lote relacional de demandas.
- Nao houve pentest independente, DAST autenticado amplo, SAST dedicado, SBOM
  nem scanner da imagem.
- Object storage compartilhado, fila duravel, tracing, PITR e DR continuam
  necessarios para escala horizontal.

Detalhes operacionais: `KNOWN-LIMITATIONS.md`, `GO-LIVE-CHECKLIST.md`,
`DEPLOYMENT.md`, `BACKUP-RESTORE.md` e `RUNBOOK.md`.

## Gate para mudar o parecer

Antes de piloto real:

1. Aplicar `0001` a `0050` em staging com papeis separados.
2. Repetir integracao, E2E e smoke no dominio HTTPS de staging.
3. Construir e executar a imagem Docker como usuario nao root.
4. Validar backup, restore, rollback e persistencia apos reinicio.
5. Configurar logs, metricas, alertas, SLO, RPO e RTO.
6. Homologar SMTP e somente os fornecedores usados no piloto.
7. Executar roteiro de privacidade e autorizacao com perfis reais.

Antes de producao/SaaS, acrescentar teste de capacidade no servidor alvo,
pentest, DAST/SAST/SBOM/imagem, DR, operacao multi-instancia e processo formal
de suporte e incidentes.

## Conclusao

Esta versao esta tecnicamente apta para staging controlado. Nao esta aprovada
para producao publica nem para venda como SaaS enquanto os gates externos e de
infraestrutura acima nao produzirem evidencias reproduziveis.
