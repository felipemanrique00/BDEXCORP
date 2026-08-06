# Fixture do catalogo offline no staging

O script `scripts/seed-staging-offline-catalog.mjs` cria somente dados ficticios para homologar o fluxo offline:

- um fornecedor comercial de hotel, sem documento, endereco, contato ou credencial real;
- dois hoteis ficticios no Rio de Janeiro/RJ;
- as referencias canonicas IBGE de RJ (`33`) e Rio de Janeiro (`3304557`),
  somente quando ainda nao existirem no catalogo geografico do staging;
- dois tipos de quarto por hotel;
- um vinculo ativo por hotel;
- uma tarifa global;
- uma tarifa restrita simultaneamente a `QA EMPRESA HOMOLOGACAO` e `QA GRUPO HOMOLOGACAO`.

O script nao copia usuarios, viajantes, demandas, reservas ou vouchers. Ele usa IDs e codigos estaveis, transacao, advisory lock e `ON CONFLICT`; nao usa `DELETE`, `TRUNCATE` ou `DROP`.
O lock geografico e o mesmo utilizado pelo sincronizador IBGE, evitando disputa
concorrente com uma carga oficial.

## Protecoes obrigatorias

A execucao e recusada se qualquer condicao abaixo nao for atendida:

- `NODE_ENV=production`;
- `APP_ENVIRONMENT=staging`;
- `APP_URL=https://staging.bdextravel.com.br`;
- `STAGING_OFFLINE_CATALOG_SEED_CONFIRM=bdex-homologacao:offline-catalog`;
- `MIGRATION_DATABASE_URL` configurada explicitamente para
  `bbt_staging_admin@staging_postgres:5432/bbt_corporativo_staging`;
- migration `0068_commercial_supplier_offline_catalog.sql` aplicada;
- Brasil ativo e univoco no catalogo geografico; o seed recusa qualquer colisao
  ou referencia incompativel antes de criar RJ/Rio de Janeiro;
- tenant, empresa e grupo QA correspondendo exatamente a allowlist versionada;
- ao menos um administrador de tenant ativo que tambem seja administrador da plataforma;
  quando houver mais de um, o menor ID ativo e escolhido de forma deterministica.

## Execucao na release de staging

Antes da execucao, gere e valide o backup PostgreSQL do staging. Em seguida, no diretorio da release ativa:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm \
  -e STAGING_OFFLINE_CATALOG_SEED_CONFIRM=bdex-homologacao:offline-catalog \
  staging_migrate node scripts/seed-staging-offline-catalog.mjs
```

Nao informe a URL administrativa do banco na linha de comando. Ela deve vir do `.env.staging`, que nao e versionado.

Em caso de sucesso, o `stdout` possui uma unica linha JSON, sem IDs ou segredos:

```json
{"ok":true,"fixtureCounts":{"hotels":2,"suppliers":1,"rates":2,"roomTypes":4}}
```

Qualquer outra saida, contagem ou codigo diferente de zero deve interromper o deploy. O script executa validacoes relacionais antes do commit e faz rollback em caso de falha.

As duas tarifas de exemplo usam ocupacao `Single`, uma em cada hotel, para que uma
mesma solicitacao consiga comparar as duas opcoes durante a homologacao.
