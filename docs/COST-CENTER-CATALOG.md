# Catálogo de centros de custo

## Objetivo e decisão arquitetural

O catálogo usa PostgreSQL e separa dois conceitos:

- **definição canônica**: um centro de custo cadastrado uma única vez dentro de um plano;
- **projeção por empresa**: a linha de `cost_centers` consumida pelos módulos legados e vinculada a uma empresa específica.

Essa separação permite compartilhar um plano entre empresas do mesmo grupo sem duplicar o cadastro funcional, enquanto preserva as FKs existentes de orçamento, alçada, funcionário, solicitante e demanda. Todas as tabelas novas carregam `tenant_id`, usam RLS e nunca inferem o tenant a partir de um identificador recebido pelo cliente.

A migration que introduz o catálogo é `deploy/postgres/migrations/0053_cost_center_catalog.sql`.

## Modelo de dados

```text
tenants
  └─ business_groups
       ├─ companies
       │    ├─ employees.cost_center_id ───────────────┐
       │    ├─ requesters.cost_center_id ──────────────┤
       │    ├─ demands.cost_center_id ─────────────────┤
       │    └─ companies.default_cost_center_id ───────┤
       │                                                │
       └─ cost_center_plans                              │
            ├─ cost_center_plan_companies                │
            └─ cost_center_definitions                   │
                 ├─ parent_id (até 3 níveis)             │
                 └─ cost_center_definition_companies     │
                                                          │
cost_center_definitions ── materialização ── cost_centers ◀┘
```

### Tabelas centrais

| Tabela | Responsabilidade |
| --- | --- |
| `business_groups` | Grupo econômico já existente. A FK composta inclui o tenant. |
| `companies` | Empresa/CNPJ já existente. Recebe `default_cost_center_id`. |
| `cost_center_plans` | Plano compartilhado pelo grupo (`group_shared`) ou exclusivo da empresa (`company_exclusive`). |
| `cost_center_plan_companies` | Ativação explícita de um plano em uma empresa e indicação do plano padrão. |
| `cost_center_definitions` | Cadastro canônico, hierárquico e versionado do centro de custo. |
| `cost_center_definition_companies` | Abrangência explícita quando o centro é restrito a algumas empresas do plano. |
| `cost_centers` | Projeção por empresa mantida para compatibilidade com consumidores existentes. |

### Escopo de plano

Um plano possui exatamente um tipo:

- `group_shared`: pertence a `business_group_id`, não possui `owner_company_id` e pode ser herdado pelas empresas do grupo quando for o plano padrão;
- `company_exclusive`: pertence a `owner_company_id` e só pode ser ativado para essa empresa.

Uma empresa pode ter ativações adicionais de planos. No máximo uma ativação ativa pode ter `is_default = true`. Marcar um novo plano como padrão deve encerrar o padrão anterior na mesma transação; ativações não padrão podem coexistir.

Empresas novas são provisionadas pela função idempotente:

```sql
select ensure_company_cost_center_plan(:tenant_id, :company_id, :actor_user_id);
```

Se houver um plano padrão ativo no grupo, a empresa o herda. Caso contrário, a função cria ou reutiliza um plano exclusivo. Uma atribuição anteriormente encerrada não é reativada automaticamente.

### Escopo de centro de custo

`cost_center_definitions.scope_type` possui dois valores:

- `plan`: disponível para todas as empresas que utilizam o plano; não aceita linhas ativas na tabela pivô;
- `selected_companies`: exige pelo menos uma empresa ativa na tabela pivô enquanto a definição estiver ativa.

O código é comparado após `trim` e sem diferenciar maiúsculas/minúsculas. A unicidade física é `(tenant_id, plan_id, normalized_code)`. Para um plano compartilhado, esse é o namespace central do grupo; um plano exclusivo mantém seu namespace independente para permitir um plano alternativo real.

### Hierarquia

A relação recursiva usa `cost_center_definitions.parent_id`:

| Nível | Valor | Exemplo |
| --- | ---: | --- |
| Macro | 1 | Administrativo |
| Intermediário | 2 | Tecnologia |
| Micro | 3 | Produto |

Triggers calculam `hierarchy_level`, rejeitam pai de outro tenant/plano, ciclos, quarto nível e movimentação de uma subárvore que passe a exceder três níveis. Um advisory lock por tenant/plano serializa mudanças concorrentes na árvore.

### Projeções e vínculos existentes

Cada definição aplicável a uma empresa é materializada em `cost_centers`, identificada por `(tenant_id, company_id, definition_id)`. A definição é a fonte canônica de `code`, `name`, `manager_user_id` e `hierarchy_level`.

As FKs compostas impedem associar um centro projetado à empresa errada:

- `companies.default_cost_center_id`;
- `employees.cost_center_id`;
- `requesters.cost_center_id`;
- `demands.cost_center_id`;
- `budgets.cost_center_id` em conjunto com `budgets.company_id`.

`approval_authorities.cost_center_id` já referencia `cost_centers`, permitindo alçada por centro. Workflows e políticas já tratam `cost_center` como dimensão; durante a avaliação, devem usar o identificador da projeção da empresa, nunca apenas o texto do código.

Os campos textuais legados (`default_cost_center` e `cost_center`) permanecem durante a fase de compatibilidade. Novas gravações devem persistir o ID e podem manter o texto apenas como snapshot de exibição.

## API

O contrato canônico usa nomes em camelCase. `tenantId` e identidade do ator não fazem parte do corpo: são obtidos da sessão autenticada.

### POST global ao plano

`POST /api/cost-centers`

```json
{
  "planId": "8d2554ca-2ef8-4e31-a065-c65b7bd3c70e",
  "parentId": null,
  "code": "ADM",
  "name": "Administrativo",
  "description": "Despesas administrativas do grupo",
  "scopeType": "plan",
  "companyIds": [],
  "managerUserId": "516f5a2c-b925-49e3-ac9f-6354b19c454a",
  "isActive": true,
  "metadata": {}
}
```

`companyIds` deve ser vazio porque a abrangência é derivada das empresas autorizadas a usar o plano.

### POST restrito a empresas selecionadas

`POST /api/cost-centers`

```json
{
  "planId": "8d2554ca-2ef8-4e31-a065-c65b7bd3c70e",
  "parentId": "a2262df6-d2e2-44c2-8e72-f4f6d5fb2678",
  "code": "TEC-PROD",
  "name": "Tecnologia / Produto",
  "description": "Centro disponível somente para as subsidiárias selecionadas",
  "scopeType": "selected_companies",
  "companyIds": [
    "empresa-brasil",
    "empresa-argentina"
  ],
  "managerUserId": null,
  "isActive": true,
  "metadata": {}
}
```

### Atualização e desativação

Atualizações são otimistas e exigem a versão observada pelo cliente:

```json
{
  "expectedVersion": 4,
  "name": "Tecnologia e Produto",
  "companyIds": ["empresa-brasil"]
}
```

`DELETE /api/cost-centers/:id` é uma desativação reversível nesta fase. A definição e suas projeções recebem estado inativo, mas a abrangência é preservada para permitir consulta com `includeInactive=true` e posterior reativação. Exclusão física não faz parte do contrato.

## Validações do backend

O fluxo abaixo deve executar dentro de uma única `withTenantTransaction`:

```text
input := validar_e_normalizar_json(request.body)
actor := exigir_sessao_ativa()
exigir_permissao(actor, "gerenciar_centros_custo")

plan := buscar_plano(input.planId, actor.tenantId, FOR UPDATE)
exigir(plan existe, ativo e não removido)
exigir(actor pode administrar o grupo/empresa do plano)

code := upper(trim(input.code))
exigir(code não vazio e formato/tamanho válidos)
exigir(não existe outro code normalizado no mesmo tenant/plano)

se input.parentId != null:
    parent := buscar_definicao(input.parentId, actor.tenantId, FOR KEY SHARE)
    exigir(parent.planId == plan.id)
    exigir(parent ativa e hierarchyLevel < 3)
    exigir(não cria ciclo)
    exigir(nível novo + profundidade da subárvore <= 3)
    exigir(abrangência do filho está contida na abrangência do pai)

se input.scopeType == "plan":
    exigir(input.companyIds está vazio)
    targetCompanies := empresas_ativas_que_usam(plan)
senão:
    companyIds := distinct(input.companyIds)
    exigir(companyIds não vazio)
    empresas := buscar_todas(companyIds, actor.tenantId)
    exigir(todas existem, estão ativas e utilizam plan)
    exigir(actor pode administrar todas)
    targetCompanies := empresas

se managerUserId != null:
    exigir(usuário pertence ao tenant e está em estado permitido)

em alteração/desativação:
    exigir(row.version == input.expectedVersion)
    exigir(regras de uso e dependências permitem a operação)

salvar definição e pivôs
materializar projeções por empresa em ordem pai -> filho
incrementar version e registrar updated_by/updated_at
registrar audit_log sem dados sensíveis
commit
```

Além das validações da aplicação, o banco aplica:

- FKs compostas com `tenant_id` para impedir referências entre tenants;
- RLS forçada nas quatro tabelas novas;
- unicidade normalizada de plano e código;
- apenas um plano padrão ativo por grupo/empresa, conforme o escopo;
- consistência entre `is_active` e `ended_at` nas tabelas de relacionamento;
- completude diferida do escopo `selected_companies` ao final da transação;
- contenção do escopo de cada filho no escopo do respectivo pai;
- limite, consistência e ausência de ciclos na hierarquia;
- correspondência entre definição, empresa, pai e projeção materializada;
- `version > 0`, limites de tamanho e auditoria temporal.

As permissões padrão são:

- `tenant_admin`, `supervisor` e `company_admin`: visualizar e gerenciar;
- `agent`, `operator`, `financial_manager`, `requester` e `readonly`: visualizar.

A autorização corporativa por grupo/empresa continua obrigatória além da permissão de papel.

## Preparação para rateio e vínculo de usuários

Os IDs canônicos e as projeções por empresa permitem adicionar rateio sem alterar o catálogo. Uma evolução recomendada é:

```text
cost_center_allocation_rules
  id, tenant_id, company_id, name, valid_from, valid_until, version, is_active

cost_center_allocation_lines
  tenant_id, rule_id, cost_center_id (projeção), percentage numeric(7,4)

cost_center_user_bindings
  tenant_id, company_id, user_id, cost_center_id (projeção), binding_type,
  valid_from, valid_until, is_active
```

Para cada regra, `sum(percentage) = 100.0000` deve ser validado por constraint trigger diferida, permitindo inserir todas as linhas na mesma transação. Vigência não pode se sobrepor para a mesma finalidade sem uma regra explícita de prioridade. O rateio efetivamente usado em uma despesa deve ser copiado para linhas imutáveis de snapshot, para que mudanças futuras no cadastro não alterem o histórico financeiro.

## Rollout expand/contract

### 0. Pré-implantação

1. Fazer backup e confirmar restauração em ambiente descartável.
2. Executar inventário de centros com código vazio, código duplicado sem diferenciar caixa, ciclo e profundidade acima de três.
3. Verificar orçamentos que apontem para centro de outra empresa.
4. Registrar contagens por tenant de `companies`, `cost_centers`, `employees`, `requesters`, `demands` e `budgets`.

A migration aborta e faz rollback completo ao encontrar essas inconsistências; não trunca código, não achata árvore e não troca referências silenciosamente.

### 1. Expand

1. Aplicar a migration `0053` com o runner oficial e lock de migrations.
2. Criar planos/definições/pivôs e as colunas de referência.
3. Provisionar plano exclusivo para empresas legadas e converter cada linha legada em definição canônica.
4. Backfill de IDs por comparação normalizada de código/nome, sem remover os campos textuais.
5. Habilitar RLS, constraints, índices e o trigger de provisionamento de empresa.

O par `cost_centers.plan_id`/`definition_id` permanece anulável durante a janela de compatibilidade. Uma imagem anterior ainda consegue inserir uma projeção sem catálogo; a observabilidade deve tratar qualquer nova linha assim como dívida de reconciliação.

### 2. Dual read/write

1. Publicar a API nova e a aba da ficha da empresa.
2. Gravar a definição canônica e todas as projeções na mesma transação.
3. Fazer os seletores de funcionário, solicitante, demanda, orçamento, autorizador e workflow consumirem IDs de projeção.
4. Manter fallback textual somente para dados ainda não reconciliados.
5. Monitorar conflitos de versão, falhas de materialização e linhas com o par de catálogo nulo.

### 3. Validação

Critérios mínimos antes do contract:

```sql
select count(*) as projections_without_catalog
from cost_centers
where plan_id is null or definition_id is null;

select count(*) as invalid_projection_scope
from cost_centers center
where center.status = 'active'
  and center.deleted_at is null
  and not cost_center_plan_applies_to_company(
    center.tenant_id,
    center.plan_id,
    center.company_id
  );
```

O primeiro resultado deve permanecer zero depois que todas as imagens antigas forem retiradas. O segundo também deve ser zero.

### 4. Contract em migration futura

Somente após uma janela operacional estável:

1. eliminar o fallback textual dos serviços;
2. reconciliar qualquer linha criada por imagem antiga;
3. tornar `plan_id` e `definition_id` obrigatórios;
4. decidir, com retenção e auditoria aprovadas, quando remover campos textuais legados;
5. manter `cost_centers` como projeção enquanto existirem FKs de módulos consumidores.

Não se deve remover tabelas ou colunas no rollback imediato. Se for necessário voltar a imagem da aplicação, as projeções preservam os consumidores legados; dados novos do catálogo permanecem no banco até a retomada do rollout.
