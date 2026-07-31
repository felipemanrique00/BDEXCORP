# Evidencia de backup pre-alteracao

Data UTC: `2026-07-25T00:30:59Z`

O backup foi criado antes de qualquer alteracao de aplicacao, banco ou proxy em
producao.

## Backup de dados

Local protegido no volume de backup:

`/backups/20260725T003059Z`

Arquivos validados:

- `database.dump`
- `files.tar.gz`
- `manifest.json`
- `SHA256SUMS`

Resultado dos checksums:

- `database.dump`: OK
- `files.tar.gz`: OK
- `manifest.json`: OK

## Restauracao isolada

A restauracao foi executada em um container PostgreSQL 16.8 temporario, com
armazenamento `tmpfs` e volume de arquivos exclusivo. O banco de producao nao foi
usado como destino.

Resultado:

- Restore PostgreSQL: concluido
- Restore de arquivos: concluido
- Tenants: 1
- Memberships: 2
- Arquivos ativos referenciados: 0
- Migrations: 52
- Migration mais recente:
  `0052_reconcile_corporate_directory_deletions.sql`

Foram verificadas tambem as tabelas de usuarios, empresas, grupos, funcionarios,
demandas, reservas, vouchers, financeiro, auditoria, politicas, workflows e
automacoes.

O container, o banco temporario e o volume temporario foram removidos ao final
da validacao.

## Backup de codigo, configuracao e imagem

Local protegido:

`/root/bdex-stabilization-backups/20260725T003059Z`

Itens preservados:

- ambiente de producao, com permissao restrita;
- Docker Compose;
- Dockerfile;
- Caddyfile;
- snapshot do codigo do servidor;
- imagem Docker `bbt-corporativo:2026.07.24-5`;
- metadados da imagem;
- checksums SHA-256.

Todos os checksums foram validados com sucesso.

Nenhum segredo foi copiado para este documento.

## Procedimento de rollback disponivel

Em caso de falha futura, o rollback deve:

1. interromper a publicacao;
2. reativar a imagem `bbt-corporativo:2026.07.24-5`;
3. restaurar Compose, Caddyfile e ambiente deste backup;
4. restaurar o banco somente se uma migration ou escrita posterior exigir;
5. executar health, readiness e smoke tests;
6. registrar a decisao e o horario no incidente.

O rollback de banco nao deve ser executado automaticamente quando a aplicacao
anterior for compativel com o schema aditivo.
