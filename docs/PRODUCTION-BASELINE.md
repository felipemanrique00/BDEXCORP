# Linha de base de producao

Data da coleta: 2026-07-24 21:30 BRT
Dominio: `https://bdextravel.com.br`
Servidor: Ubuntu 22.04.5 LTS, Docker 29.1.3, PostgreSQL 16.8

Este documento registra o estado observado antes da estabilizacao. Nenhum valor
secreto e reproduzido aqui.

## Repositorio local

- Branch de origem: `codex/bdex-final-gap-closure`
- Branch da estabilizacao: `codex/bdex-production-stabilization`
- Commit base: `1b169942d72771262f2e4385a16e8f772f9cc6b5`
- Estado: arvore de trabalho com alteracoes locais preexistentes
- Regra adotada: preservar todas as alteracoes locais e nao executar limpeza,
  reset ou descarte de arquivos

O artefato implantado nao possui metadado imutavel de commit Git na imagem.
Portanto, a correspondencia entre imagem e commit nao pode ser comprovada apenas
pelos metadados do container. A imagem, o codigo do servidor e as configuracoes
foram preservados no backup pre-alteracao.

## Producao implantada

- Imagem: `bbt-corporativo:2026.07.24-5`
- Image ID: `sha256:872a95ecd503b06861b2e4541a1a13aadab8f7b640a925b824379fabd0d8e40b`
- Container da aplicacao: `bbt-corporativo-app-1`
- Inicio do container: `2026-07-25T00:05:42Z`
- Reinicios observados: `0`
- Health do container: `healthy`
- Schema atual: `0052_reconcile_corporate_directory_deletions.sql`
- Migrations aplicadas: `52`

Containers:

| Container | Imagem | Estado inicial |
| --- | --- | --- |
| `bbt-corporativo-app-1` | `bbt-corporativo:2026.07.24-5` | Saudavel |
| `bbt-corporativo-postgres-1` | `postgres:16.8-alpine3.21` | Saudavel |
| `bbt-corporativo-caddy-1` | `caddy:2.8.4-alpine` | Em execucao |

Volumes de producao:

- `bbt-corporativo_postgres_data`
- `bbt-corporativo_app_files`
- `bbt-corporativo_backup_data`
- `bbt-corporativo_caddy_data`
- `bbt-corporativo_caddy_config`
- `bbt-corporativo_restore_validation_files`

## Capacidade e sistema operacional

- Memoria: 23 GiB total, aproximadamente 21 GiB disponiveis na coleta
- Swap: 2 GiB, sem uso na coleta
- Disco raiz: 291 GiB, 7% utilizado
- Inodes: 2% utilizados
- Timezone: `America/Sao_Paulo`
- NTP: ativo e sincronizado
- UFW: ativo, entrada negada por padrao

Foram observadas portas administrativas e de hospedagem adicionais abertas no
servidor. A necessidade de cada regra deve ser revisada com o responsavel pela
infraestrutura antes de qualquer fechamento, pois o VPS tambem executa servicos
de e-mail, DNS e administracao.

## Banco restaurado para verificacao

Contagens obtidas da restauracao isolada do backup:

| Entidade | Quantidade |
| --- | ---: |
| Tenants | 1 |
| Usuarios | 2 |
| Memberships | 2 |
| Empresas, incluindo inativas | 5 |
| Grupos, incluindo inativos | 1 |
| Funcionarios | 149 |
| Demandas | 254 |
| Reservas relacionais | 0 |
| Vouchers | 254 |
| Lancamentos financeiros | 480 |
| Logs de auditoria | 150 |
| Politicas | 2 |
| Workflows de aprovacao | 0 |
| Workflows empresariais | 0 |
| Automacoes | 0 |

As contagens nao sao uma autorizacao para alterar dados e nao substituem a
validacao funcional por tenant e por permissao.

## Verificacoes externas

- `http://bdextravel.com.br/`: redireciona para HTTPS
- `https://bdextravel.com.br/`: redireciona para `/login`
- `/api/health`: HTTP 200
- `/api/ready`: HTTP 200
- `manifest.webmanifest`: HTTP 200
- `sw.js`: HTTP 200
- CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, COOP e
  `Permissions-Policy`: presentes
- Segredos de servidor no bundle publico: nenhum dos segredos configurados foi
  encontrado

## Staging encontrado

O staging inicial nao estava apto para homologacao:

- Imagem `bbt-corporativo-staging:1.0.0`
- Apenas 4 migrations aplicadas
- `APP_URL` e `NEXT_PUBLIC_APP_URL` apontavam para producao
- SMTP estava habilitado
- MFA nao possuia chave configurada
- Caddy retornava HTTP 502 porque nao compartilhava rede com o app de staging
- Banco continha somente um tenant e um usuario de teste, sem empresas ou demandas

O staging deve ser atualizado e isolado antes de qualquer teste que modifique
dados.

## Erros observados antes das correcoes

1. Staging indisponivel via HTTPS com HTTP 502.
2. Evento de governanca rejeitado por ausencia de comando e chave de
   idempotencia.
3. Divergencia entre `OPENAI_TRANSCRIBE_MODEL`, documentada, e
   `OPENAI_TRANSCRIPTION_MODEL`, lida por parte do gateway de IA.
4. A imagem implantada nao registra o commit Git de origem.
5. O Caddy em execucao utiliza configuracao manual diferente do arquivo de
   referencia do repositorio.

Esses itens sao hipoteses confirmadas por observacao tecnica, mas cada correcao
funcional ainda deve ser reproduzida e protegida por teste antes de publicacao.
