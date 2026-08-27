# Limitacoes conhecidas

Data de referencia: 2026-07-24.

## Ambiente de validacao

- As 50 migrations foram aplicadas em PostgreSQL descartavel local.
- O papel web validado nao possui `SUPERUSER` nem `BYPASSRLS`.
- Os 50 testes PostgreSQL, o E2E e o smoke de seguranca foram executados.
- Docker, `psql`, `pg_dump` e shell POSIX nao estao instalados nesta maquina.
- Imagem Docker, Compose, scripts Linux, backup e restore ainda precisam ser
  executados na infraestrutura de staging.
- As auditorias npm de producao e completa passaram sem vulnerabilidades.

Essas limitacoes impedem aprovar a infraestrutura de producao, mas nao anulam
as evidencias locais de aplicacao, PostgreSQL e navegador.

## Migracao e compatibilidade

- PostgreSQL relacional e a fonte oficial para novos tenants e dominios
  governados.
- `app_kv` e `/api/storage` permanecem somente como compatibilidade de legado.
- O endpoint generico rejeita chaves desconhecidas, auditoria, dominios
  exclusivamente relacionais e escritas sem permissao funcional.
- Tenants com dados historicos devem concluir inventario, shadow e reconciliacao
  antes de promover cada dominio; o sistema nao faz cutover destrutivo.
- Diretorio historico de empresas, grupos, hoteis e alguns cadastros ainda
  possui consumidores compativeis que precisam de retirada incremental.

## Integracoes

- Tech Reports depende de chave rotacionada e teste controlado.
- Tech transacional possui adapter, idempotencia e reconciliacao, mas nao foi
  homologada com sandbox e contrato oficial do fornecedor.
- Retry automatico de mutacoes Tech continua desabilitado sem garantia formal
  de idempotencia; resultado ambiguo deve ser reconciliado, nao repetido.
- A tabela `integration_webhook_events` existe, mas nao ha webhook de entrada
  homologado com assinatura, timestamp e protecao contra replay.
- Wintour possui parser e importacao relacional de demandas, mas a criacao
  compativel de empresas/funcionarios/hoteis e o lote de demandas ainda nao
  formam uma unica transacao PostgreSQL ponta a ponta.
- A sincronizacao BDEX → Wintour permanece desabilitada ate a Digirotas liberar
  o PIN, homologar os de-para de produto/FOP e, se contratada, a consulta
  detalhada DGR-034. Receber um protocolo SOAP nao confirma importacao; a
  alteracao ainda exige processamento humano na mesa do Wintour.
- A exportacao automatica inicial cobre somente Aereo `manual-offline`, em BRL
  e uma venda por bilhete com dados relacionais completos. Hotel, Locacao,
  Rodoviario, moeda estrangeira e rateios financeiros ambiguos permanecem
  bloqueados deliberadamente, sem payload aproximado.
- Nao existem adapters homologados para GDS, NDC, locadoras, contabilidade ou
  ERP. Cadastro no catalogo nao equivale a integracao real.
- IA, WhatsApp e SMTP dependem de credenciais externas e aceite de privacidade.
- Mapas dependem de tiles, rede, capacidade e termos do provedor.

## Operacao

- Nao ha evidencia local de runtime Docker read-only nem persistencia apos
  reinicio do container.
- Backup, restore isolado, rollback N-1 e copia externa imutavel nao foram
  executados nesta maquina.
- A carga local de sessao executou 100 requisicoes, concorrencia 10, sem erro e
  p95 de 247,76 ms. Isso e uma linha de base, nao dimensionamento do servidor.
- Observabilidade externa, alertas, SLO, RPO e RTO dependem da infraestrutura.
- Object storage compartilhado e fila duravel continuam necessarios para varias
  instancias e alto volume.

## Politicas

- O PDF ARGO de 49 paginas foi analisado e possui hash registrado em
  `ARGO-POLICY-COVERAGE.md`.
- Das 150 referencias, 149 foram mapeadas e uma foi recusada deliberadamente
  por exigir aprovacao sem autenticacao.
- Cobertura de politica nao significa homologacao dos fornecedores externos.
- Templates exigem revisao do cliente antes da publicacao.

## Produto

- As 61 paginas e 166 arquivos de rotas de API compilam e estao inventariados.
- O E2E cobre autenticacao, MFA, administracao SaaS, arquivo privado, snapshot
  de relatorio e portal do viajante; nao substitui um roteiro individual para
  cada pagina e perfil.
- Solicitacao com multiplos viajantes, remarcacao e prestacao de contas devem
  ser homologadas com regras reais do cliente antes de venda contratual.
- Filiais, departamentos, projetos, moedas e calendarios possuem modelo
  relacional, mas nem todos possuem CRUD administrativo completo.
- HTML interativo deve ser enviado como arquivo ou link. Clientes de e-mail nao
  executam JavaScript de forma confiavel.

## Seguranca residual

- O smoke interno validou CSP, anti-clickjacking, sessao anonima sem identidade,
  negacao de APIs, tentativa de IDOR, storage legado e login sem cookie.
- RLS da camada de identidade cobre memberships, roles, subscriptions, invites
  e sessions com contextos restritos.
- Teste de penetracao independente, DAST autenticado amplo, SAST dedicado, SBOM
  e scanner de imagem ainda devem compor a homologacao de staging.
- Segredos compartilhados fora do secret store precisam ser rotacionados.
- Compliance juridico/LGPD exige validacao organizacional, nao apenas codigo.
