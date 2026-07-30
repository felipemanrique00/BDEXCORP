# Catalogo de templates de politicas

## Estado atual

O catalogo interno contem:

- 12 perfis de segmento;
- 112 familias de politica;
- 1.344 configuracoes geradas;
- 38 categorias.

Cada configuracao combina uma familia com um segmento e possui chave unica,
parametros, fatos de teste, dependencias, riscos, checkpoints e SHA-256.

Os numeros sao derivados de `lib/policy/templates/catalog.ts` e protegidos por
`tests/unit/policy-template-catalog.test.ts`.

## Segmentos

| Chave | Segmento |
| --- | --- |
| `industry` | Industria |
| `pharmaceutical` | Farmaceutica |
| `construction` | Construcao |
| `agribusiness` | Agronegocio |
| `technology` | Tecnologia |
| `healthcare` | Saude |
| `consulting` | Consultoria |
| `education` | Educacao |
| `logistics` | Logistica |
| `holding` | Holding |
| `financial` | Setor financeiro |
| `multinational` | Empresa multinacional |

Os valores sao configuracoes iniciais, nao recomendacoes juridicas ou
financeiras. A empresa deve revisar limites, dependencias e vigencias antes de
publicar.

## Familias por area

### Aprovacao e autoridade

- `approval.amount`, `approval.international`;
- `authority.executive`, `authority.fare-percentage`;
- `delegation.expired`.

### Orcamento e classificacao

- `budget.warning`, `budget.block`;
- `finance.commit-budget`, `finance.release-budget`;
- `cost-center.required`, `cost-center.active`;
- `project.required`, `account.required`, `allocation.total`;
- `reports.allocation`.

### Aereo

- `air.advance`;
- `air.lowest-fare`;
- `air.class`;
- `air.direct`.

### Hotel, carro, rodoviario e servicos

- `hotel.daily`, `hotel.preferred`, `hotel.distance`;
- `car.daily`, `car.insurance`;
- `bus.advance`;
- `services.limit`;
- `insurance.international`.

### Adiantamento, despesa e reembolso

- `advance.pending`, `advance.limit`;
- `reimbursement.deadline`, `reimbursement.receipt`;
- `expense.deadline`, `expense.duplicate`;
- `cards.payment`, `cards.limit`;
- `billing.data`;
- `reconciliation.mismatch`.

### Selecao, reserva e emissao

- `justification.fare`;
- `search.preferred`, `search.blocked-supplier`;
- `reservation.validity`;
- `issuance.authorization`, `issuance.deadline`;
- `expiration.hold`, `cancellation.penalty`;
- `communication.issued`.

### Perfil, risco e conformidade

- `profile.complete`;
- `security.destination`;
- `documents.passport`;
- `risk.duty-of-care`;
- `sustainability.co2`;
- `integration.homologated`;
- `sla.quote`.

## Instalacao

`GET /api/policies/templates` lista templates visiveis e permite filtros.
`POST /api/policies/templates/:templateKey/instantiate` cria uma politica em
rascunho no escopo autorizado. A instalacao:

1. valida o template e o segmento;
2. valida o escopo contra o acesso corporativo;
3. gera codigo estavel para o escopo;
4. cria definicao e primeira versao;
5. persiste condicao, acoes, dependencias e checkpoints;
6. registra auditoria;
7. nao publica automaticamente.

## Governanca

- templates sao ponto de partida, nao politica vigente;
- somente versoes publicadas sao avaliadas em operacao;
- dependencias obrigatorias precisam existir;
- conflitos bloqueantes impedem publicacao;
- mudanca de parametro cria nova versao;
- decisoes historicas preservam a versao utilizada;
- administradores de grupo/empresa nao podem instalar fora do proprio escopo.

## Benchmark externo ARGO

O documento `__. ARGO .__ politicas.pdf`, com 49 paginas, foi analisado e
registrado por hash SHA-256. A cobertura possui:

- 150 referencias de politica detectadas;
- 149 referencias associadas a familias BDEX executaveis;
- 1 referencia recusada por seguranca (`ARGO:APROUT`);
- matriz por area e intervalo de paginas;
- rastreabilidade automatizada em cada template.

Consulte `ARGO-POLICY-COVERAGE.md` para o criterio de cobertura e
`POLICY-BENCHMARK-MATRIX.csv` para a matriz gerada. Execute
`npm run policy:benchmark` depois de alterar o catalogo.
