# DSL de politicas

## Formato

A DSL e uma estrutura JSON validada por Zod, nao codigo JavaScript executavel.
Isso reduz superficie de injecao e permite versionamento, hash e explicacao.

```json
{
  "condition": {
    "all": [
      { "fact": "trip.type", "operator": "eq", "value": "international" },
      { "fact": "finance.totalAmount", "operator": "gt", "value": 10000 }
    ]
  },
  "actions": [
    {
      "type": "request_approval",
      "message": "Aprovacao executiva obrigatoria.",
      "configuration": { "workflow": "executive-authority" }
    }
  ]
}
```

`fact` usa caminho pontuado em um objeto de fatos fornecido pelo servidor.
`valueFrom` compara com outro fato. `value` e `valueFrom` sao mutuamente
exclusivos.

## Expressoes

| Forma | Semantica |
| --- | --- |
| `{ "all": [...] }` | Todas as expressoes devem corresponder |
| `{ "any": [...] }` | Ao menos uma expressao deve corresponder |
| `{ "not": {...} }` | Inverte a expressao filha |
| `{ "fact", "operator", "value" }` | Avalia uma condicao |

Listas vazias, profundidade excessiva e estruturas fora do schema sao recusadas.

## Operadores

### Comparacao e existencia

- `eq`, `neq`;
- `in`, `not_in`;
- `gt`, `gte`, `lt`, `lte`;
- `between`;
- `exists`, `not_exists`.

### Texto e colecao

- `contains`, `not_contains`;
- `starts_with`, `ends_with`;
- `matches_safe_pattern`.

Padroes possuem limite de tamanho e rejeitam recursos de regex com risco de
backtracking ou comportamento nao permitido.

### Data e horario

- `before`, `after`;
- `date_between`;
- `time_between`, inclusive intervalo que atravessa meia-noite;
- `day_of_week`, com timezone explicita.

### Dominio corporativo

- `within_percentage`, `outside_percentage`;
- `distance_greater_than`;
- `duration_greater_than`;
- `currency_compare`.

`currency_compare` exige moedas ISO de tres letras e taxa presente nos fatos ou
nas opcoes. Ausencia de taxa gera erro explicavel; nao existe conversao inventada.

## Acoes

As acoes suportadas sao agrupadas abaixo. O tipo e a configuracao sao validados
antes da persistencia.

### Decisao

- `allow`, `warn`, `block`;
- `require_justification`, `require_predefined_justification`;
- `require_manual_review`.

### Evidencias e cadastro

- `require_attachment`, `require_acceptance`, `require_document`;
- `require_insurance`, `require_budget`;
- `require_cost_allocation`, `require_cost_center`;
- `require_project`, `require_account`.

### Aprovacao

- `auto_approve`, `request_approval`, `add_approval_level`;
- `replace_approver`;
- `require_parallel_approval`, `require_sequential_approval`;
- `set_approval_quorum`;
- `route_to_merit_approval`, `route_to_cost_approval`;
- `escalate`.

### Operacao

- `notify`, `create_task`, `register_occurrence`;
- `restrict_search`, `hide_offer`, `rank_offer`;
- `force_preferred_supplier`, `block_supplier`;
- `enforce_class`, `enforce_value_limit`, `enforce_advance_notice`;
- `enforce_payment_method`, `require_reapproval`;
- `hold_booking`, `prevent_issuance`, `cancel_on_expiration`;
- `release_budget`, `commit_budget`.

Declarar uma acao nao executa automaticamente uma integracao externa. O
orquestrador do dominio deve aplicar a acao com idempotencia e confirmar o
resultado.

## Escopos

Escopos reconhecidos:

- tenant, grupo e empresa;
- filial e unidade;
- departamento e centro de custo;
- projeto e cargo;
- viajante e solicitante.

Cada escopo possui:

- `type`;
- `id`, quando aplicavel;
- `mode`: `include` ou `exclude`;
- `specificity`.

Escopos de grupo/empresa sao autorizados no servidor. Escopos de diretorios
organizacionais ainda nao vinculados a guards especificos exigem administrador
do tenant.

## Excecoes

`exceptions` usa a mesma DSL de expressoes. Quando uma excecao corresponde, a
politica registra `exceptionApplied` e nao produz suas acoes. A explicacao inclui
a arvore da condicao principal e das excecoes.

Excecao nao substitui RBAC, RLS nem requisito legal configurado como
nao sobrescrevivel.

## Dependencias

Uma politica pode declarar dependencias:

- workflow;
- feature;
- directory;
- integration;
- budget;
- outra politica.

Dependencia obrigatoria ausente e ciclo de dependencia sao conflitos
bloqueantes de publicacao.

## Checkpoints

Exemplos presentes no catalogo:

- `profile`, `request`, `submission`;
- `search`, `quotation`, `selection`;
- `merit_approval`, `cost_approval`;
- `reservation`, `issuance`, `post_issuance`;
- `cancellation`, `expense`.

Uma politica somente participa quando declara o checkpoint atual ou `*`.

## Exemplo com `valueFrom`

```json
{
  "fact": "air.selectedFare",
  "operator": "outside_percentage",
  "valueFrom": "air.lowestFare",
  "options": { "tolerancePct": 12 }
}
```

## Exemplo monetario

```json
{
  "fact": "finance.selectedAmount",
  "operator": "currency_compare",
  "value": { "amount": 5000, "currency": "BRL" },
  "options": {
    "observedCurrency": "USD",
    "targetCurrency": "BRL",
    "comparison": "lte",
    "ratesFact": "finance.exchangeRates"
  }
}
```

## Versionamento

Conteudo semantico recebe SHA-256 por serializacao estavel. A publicacao aponta
para uma versao, nunca reescreve uma decisao historica. Alteracoes criam nova
versao e registram resumo, autor e horario.

## Limites de seguranca

- nenhuma funcao arbitraria e aceita no JSON;
- propriedades desconhecidas sao recusadas nos schemas administrativos;
- profundidade, quantidade e tamanho possuem limites;
- regex perigosa e recusada;
- numeros devem ser finitos;
- datas e horarios invalidos geram erro;
- o tenant e os escopos sao recalculados pelo servidor;
- simulacao nao equivale a publicacao.

As definicoes TypeScript canonicas estao em `lib/policy/types.ts` e a validacao
canonica em `lib/policy/schema.ts`.
