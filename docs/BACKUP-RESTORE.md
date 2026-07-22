# Backup e restauracao

## Escopo

Um backup completo exige os dois conjuntos no mesmo ciclo:

1. dump PostgreSQL em formato custom;
2. arquivos privados de `STORAGE_ROOT`.

O script inclui manifesto, contagem e SHA-256. Configuracoes/segredos devem ser mantidos em um secret store separado; nao dependem do backup de dados.

## Objetivos iniciais

- RPO: ate 24 horas com backup diario. Para operacao intensa, reduzir para 4 horas ou usar WAL/PITR.
- RTO: ate 4 horas no piloto, sujeito ao volume e ao servidor.
- Retencao local: 14 dias por padrao.
- Copia externa: obrigatoria, criptografada e em conta/destino diferente do servidor.

Esses objetivos precisam ser aprovados pelo negocio e medidos em teste real.

## Criar backup

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile ops run --rm backup
```

Ou, com cliente PostgreSQL instalado, defina `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `BACKUP_ROOT`, `STORAGE_ROOT` e execute `scripts/backup.sh`.

O script:

- usa `umask 077`;
- recusa diretorios inseguros;
- grava em pasta temporaria;
- valida dump e arquivo compactado;
- cria manifesto e checksums;
- publica por rename somente depois do sucesso;
- remove backups expirados somente dentro da raiz configurada.

## Copia externa

Depois do sucesso, replique a pasta datada para armazenamento criptografado com versionamento/immutability. Restrinja leitura a operadores de recuperacao. Nao envie `.env` junto aos dados.

## Restore isolado

Nunca comece restaurando sobre producao.

```bash
RESTORE_SOURCE=/backups/AAAAMMDDTHHMMSSZ \
RESTORE_DATABASE=bbt_restore_validation \
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile restore run --rm restore-validation
```

O script recusa o banco configurado de producao, exige banco vazio, valida hashes e caminhos do tar, restaura banco e arquivos e confirma tenants, memberships e referencias de arquivos ativos.

## Criterios de aprovacao

- checksums aprovados;
- migrations e tabelas presentes;
- contagem de tenants e memberships coerente;
- usuarios e escopos preservados;
- empresas, demandas e relatorios consultaveis;
- arquivos ativos encontrados;
- login em ambiente isolado;
- tempo total registrado;
- backup e evidencias removidos de forma controlada apos o teste.

O CI executa um restore isolado com dados exclusivos de teste. Isso valida o mecanismo, mas nao substitui um ensaio periodico com o volume real anonimizado ou protegido.

## Restore de producao

1. Declare incidente e janela.
2. Pare escrita da aplicacao.
3. Tire snapshot/backup do estado atual mesmo corrompido.
4. Valide o backup escolhido em ambiente isolado.
5. Registre ponto de restauracao, aprovacoes e impacto.
6. Restaure PostgreSQL e arquivos do mesmo backup.
7. Execute readiness, smoke, login e verificacao funcional.
8. Libere usuarios gradualmente e monitore.

O script Linux foi deliberadamente desenhado para validacao isolada. Restore sobre producao deve ser uma acao operacional separada e revisada, nao uma alteracao casual de variavel.

## Falhas

- Hash invalido: isole o backup e escolha outra copia.
- Dump falha: nao publique a pasta incompleta.
- Arquivo referenciado ausente: mantenha o sistema fechado e recupere a copia correspondente.
- Banco sem tenant/membership: restore invalido.
- Falta de espaco: nao apague o unico backup; expanda ou mova para destino seguro.
