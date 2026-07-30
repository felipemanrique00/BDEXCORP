# Checklist de go-live

Nenhum item pendente critico pode ser tratado como aprovado por existencia de
codigo ou CI configurado. Anexe evidencia, data e responsavel.

## Release

- [ ] Tag/`APP_VERSION` imutavel definida.
- [ ] Diff revisado sem segredo/arquivo gerado.
- [ ] `npm ci` executado a partir do lockfile.
- [ ] Migrations validadas e aplicadas em staging.
- [ ] Lint, tipos, unidade, integracao, E2E e build aprovados.
- [ ] Imagem Docker construida e executada como `nextjs`.
- [ ] Rollback de imagem ensaiado.

## Banco e isolamento

- [ ] Papel web sem `SUPERUSER` e sem `BYPASSRLS`.
- [ ] `FORCE ROW LEVEL SECURITY` confirmado.
- [ ] Ataques cruzados de leitura/escrita aprovados.
- [ ] FKs compostas/constraints aplicadas.
- [ ] Pool, timeout, conexoes e locks monitorados.
- [ ] Migration de dados executada por tenant com zero divergencia.
- [ ] Rollout permanece shadow/dual ate aprovacao.

## Autenticacao e acesso

- [ ] HTTPS e cookie seguro.
- [ ] `AUTH_SECRET` forte e exclusivo.
- [x] MFA administrativo TOTP, recuperacao de uso unico e anti-replay homologados.
- [ ] Login, logout, bloqueio, expiracao e revogacao.
- [ ] Convite e reset via SMTP real.
- [ ] Dono/CEO/secretaria/financeiro/gestor/visualizador testados.
- [ ] Uma, varias e todas as empresas testadas.
- [ ] Grupo consolidado limitado ao escopo.
- [ ] Revogacao tem efeito imediato.
- [ ] Tentativa de elevacao de privilegio negada/auditada.

## Fluxos de negocio

- [ ] Empresa, grupo, funcionario e alias.
- [ ] CRUD de empresa/grupo/diretorio executado pela API relacional, sem
  dependencia de escrita oficial em `/api/storage`.
- [ ] Importacao e reimportacao idempotente.
- [ ] Demanda/OS, transferencia e comunicacoes.
- [ ] Solicitacao com multiplos viajantes e acompanhantes, quando oferecida.
- [ ] Politica: rascunho, simulacao, aprovacao e publicacao.
- [ ] Aprovacao: resolucao, delegacao, quorum e SLA.
- [ ] Cotacao, reserva, emissao, cancelamento e reembolso.
- [ ] Remarcacao e prestacao de contas concluidas ou formalmente retiradas do
  escopo comercial antes da venda.
- [ ] Voucher e arquivo privado.
- [ ] Financeiro, fatura e reconciliacao.
- [ ] Reset de tenant testado sem ressincronizacao de legado.

## Relatorios

- [ ] Empresa e grupo com filtros.
- [ ] Usuario parcial ve somente empresas autorizadas.
- [ ] Cliente nao recebe markup interno.
- [ ] Economia usa referencia identificavel e auditavel.
- [ ] HTML interativo funciona offline/online conforme contrato.
- [ ] Mapa real e fallback validados.
- [ ] PDF/print em desktop e mobile sem sobreposicao.
- [ ] Totais conciliados com banco.

## Integracoes

- [ ] Tech Reports com chave rotacionada.
- [ ] Tech transacional homologada ou desabilitada.
- [ ] Timeout, erro, resposta invalida e idempotencia.
- [ ] Retry/backoff/circuit breaker definidos por operacao; nenhuma mutacao
  repetida sem contrato de idempotencia do fornecedor.
- [ ] Operacao ambigua reconciliada.
- [ ] Webhooks, se habilitados, com assinatura, timestamp, replay protection e
  idempotencia.
- [ ] GDS/NDC/ERP/contabilidade exibidos apenas quando houver adapter real e
  homologado.
- [ ] IA sem credencial falha explicitamente.
- [ ] WhatsApp confirma entrega real ou permanece desabilitado.
- [ ] Tiles/mapa possuem termos e capacidade adequados.

## Operacao

- [ ] DNS, TLS e firewall.
- [ ] Apenas 80/443 publicos; banco/3000 privados.
- [ ] Logs centralizados e sem segredos.
- [ ] Alertas de readiness, 5xx, latencia, disco e banco.
- [ ] Backup automatico e copia externa criptografada.
- [ ] Restore isolado executado e RTO/RPO medidos.
- [ ] Runbook e incident response acessiveis.
- [ ] Responsaveis e escalonamento definidos.
- [ ] Teste de carga no servidor alvo.

## Privacidade

- [ ] Inventario de dados e finalidade aprovados.
- [ ] Retencao e descarte definidos.
- [ ] Acesso e exportacao auditados.
- [ ] Contratos/suboperadores revisados.
- [ ] Procedimento de incidente LGPD aprovado.

## Decisao

- [ ] Piloto: GO aprovado por tecnologia e negocio.
- [ ] Producao: GO aprovado por tecnologia, seguranca e negocio.
- [ ] Pendencias aceitas possuem responsavel, prazo e risco formal.

Sem assinatura/evidencia dos itens criticos, o status e `NO-GO`.
