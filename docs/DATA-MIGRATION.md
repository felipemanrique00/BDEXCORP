# Migracao de dados

## Principio

Dados de negocio nao sofrem corte imediato. O processo e por tenant e dominio:

1. inventario;
2. backup verificavel;
3. dry-run;
4. shadow write;
5. comparacao;
6. piloto por empresa;
7. leitura relacional;
8. escrita relacional;
9. observacao;
10. retirada posterior do legado.

O estado de rollout nao apaga o `app_kv`; rollback de leitura continua possivel.

## Registro de dominios

`config/storage-domain-registry.json` documenta para cada chave:

- dominio;
- alvo relacional;
- estado de migracao;
- risco;
- estrategia de rollout.

Estados aceitos no inventario:

- `legacy`: ainda depende do armazenamento compativel;
- `shadow`: compara legado e relacional;
- `relational`: fonte autoritativa relacional.

Novas funcionalidades criticas nao devem usar `/api/storage`.

## Controle no banco

Migration `0020_domain_migration_rollout.sql` cria:

- `tenant_domain_rollouts`;
- `tenant_domain_rollout_companies`;
- `data_migration_runs`;
- `data_migration_discrepancies`.

Migration `0039_seed_domain_rollouts.sql` inicia os dominios `approvals`,
`demands`, `emissions`, `finance`, `requesters` e `vouchers` em:

- leitura `shadow`;
- escrita `dual`;
- `automaticCutover: false`.

Ausencia de configuracao e fail-closed: o registro de dominio define o modo
seguro, sem ativar leitura relacional automaticamente.

## Modos

### Leitura

- `legacy`: apenas fonte compativel;
- `shadow`: resposta legada, com comparacao relacional;
- `relational`: tabela relacional autoritativa.

### Escrita

- `legacy`: apenas fonte compativel;
- `dual`: persiste relacional e compativel conforme o adapter do dominio;
- `relational`: somente banco relacional.

Leitura relacional com escrita apenas legada e escrita relacional com leitura
nao relacional sao recusadas pelo schema de administracao.

## Pre-condicao de cutover

`lib/server/domain-rollout-service.ts` so permite leitura relacional quando
existe uma execucao shadow concluida para o tenant/dominio, sem discrepancias
abertas. A alteracao exige:

- permissao administrativa;
- versao esperada;
- justificativa;
- confirmacao explicita;
- empresas piloto validas, quando informadas;
- auditoria.

Nao existe cutover automatico.

## Ferramenta de migracao

`scripts/data-migration.mjs` suporta atualmente:

```bash
node scripts/data-migration.mjs inventory --tenant=<slug-ou-uuid> --output=inventory.json
node scripts/data-migration.mjs demands-dry-run --tenant=<slug-ou-uuid> --output=demands-dry-run.json
```

O shadow de demandas exige backup existente e ator administrativo:

```bash
node scripts/data-migration.mjs demands-shadow \
  --tenant=<slug-ou-uuid> \
  --actor-email=<email-admin> \
  --backup-reference=<manifesto-ou-backup> \
  --confirm=SHADOW_DEMANDS \
  --output=demands-shadow.json
```

Rollback do shadow:

```bash
node scripts/data-migration.mjs demands-rollback-shadow \
  --tenant=<slug-ou-uuid> \
  --run-id=<uuid-do-shadow> \
  --actor-email=<email-admin> \
  --backup-reference=<manifesto-ou-backup> \
  --confirm=ROLLBACK_SHADOW_DEMANDS \
  --output=demands-rollback.json
```

## Validacoes

O inventario registra:

- contagem por chave/tabela;
- bytes;
- versao e data;
- checksum da origem e do alvo;
- chave desconhecida;
- discrepancias.

Demandas preservam IDs e validam:

- empresa;
- funcionario;
- usuario responsavel;
- numero da OS;
- estado e valores;
- relacionamentos dependentes;
- checksum normalizado.

Uma execucao com divergencia termina `requires_review` e codigo de saida 2.
Falha termina com codigo 1. Somente zero divergencia termina `succeeded`.

## Rollback seguro

O rollback de shadow nao remove registro alterado depois da migracao e nao
remove demanda que ganhou cotacao, reserva, voucher, financeiro ou aprovacao.
Nesses casos registra discrepancia e exige intervencao.

Quando elegivel, o registro relacional e cancelado/soft-deleted, recebe evento
de rollback e a origem permanece preservada. Nao existe `DELETE` indiscriminado
do legado.

## Procedimento por dominio

1. Gere backup de banco e arquivos.
2. Execute inventario e arquive o JSON.
3. Corrija chaves desconhecidas e referencias invalidas.
4. Execute dry-run.
5. Execute shadow para um tenant de staging.
6. Analise discrepancias e totais financeiros.
7. Repita ate zero divergencia.
8. Ative piloto para empresas controladas.
9. Monitore logs, contagens e reconciliacao.
10. Promova leitura relacional.
11. Promova escrita relacional somente depois do periodo de observacao.
12. Retenha a fonte antiga ate aprovacao formal de retirada.

## Limite atual

O script automatiza migracao detalhada de demandas. Os demais dominios possuem
schema relacional, adapters e rollout, mas exigem um migrador especifico antes
de qualquer cutover de dados legados existentes. Eles nao devem ser marcados
como migrados apenas porque as tabelas existem.

## Evidencias

- `tests/unit/storage-domain-registry.test.ts`
- `tests/unit/storage-relational-guard.test.ts`
- `tests/unit/domain-rollout-service.test.ts`
- `tests/unit/legacy-demand-sync.test.ts`
- `tests/unit/system-reset-policy.test.ts`

Execucao contra dados reais permanece obrigatoria em staging.
