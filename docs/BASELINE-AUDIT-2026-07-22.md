# Linha de base tecnica - 22/07/2026

## Escopo e metodo

Esta linha de base foi levantada antes da implantacao dos motores de politicas e aprovacoes. Arquivos gerados, `node_modules`, `.next`, binarios, pacotes de entrega e copias historicas ficaram fora da leitura de codigo-fonte.

O projeto `BDEX_PRODUCAO_SAAS` nao possui um repositorio Git proprio. Ele esta dentro do repositorio pai `C:\Users\Felipe Manrique\Documents\New project`, no qual toda a pasta aparece como nao rastreada. Por isso, criar uma branch neste momento nao isolaria com seguranca as alteracoes deste produto.

## Inventario inicial

| Item | Quantidade/estado |
| --- | --- |
| Arquivos de projeto analisaveis | 422 |
| Arquivos TypeScript/TSX | 331 |
| Paginas Next.js | 55 |
| Rotas de API | 68 |
| Componentes | 43 |
| Testes e arquivos de suporte | 16 |
| Migrations antes desta frente | 5 |
| Banco oficial previsto | PostgreSQL 16 com RLS |
| Autenticacao | Sessao individual em PostgreSQL, cookie HttpOnly e RBAC |
| Isolamento SaaS | Tenant + RLS + contexto corporativo |
| Integracoes implementadas | Tech Travel/TTravel; importacoes Wintour/legado em modulos do produto |
| Integracoes homologadas neste ambiente | Nenhuma, por ausencia de credenciais e ambiente externo de homologacao |

Arquivos com maior concentracao de responsabilidades incluem `app/dashboard/page.tsx`, `app/dashboard/portal-empresa/page.tsx` e `app/relatorios/_components/corporate-report.tsx`, todos acima de 1.600 linhas. A decomposicao deve ocorrer por dominio e com testes de caracterizacao, sem reescrita ampla.

## Linha de base executavel

Uma copia limpa foi criada em `.analysis/bdex-policy-clean-baseline` e recebeu instalacao por `npm ci`.

Resultados antes das alteracoes:

- `npm ci`: concluido; 548 pacotes instalados; npm informou 5 vulnerabilidades (1 moderada e 4 altas).
- `npm run db:validate-migrations`: passou para as migrations `0001` a `0005`.
- `npm run inventory:check`: passou.
- `npm run security:scan`: passou sem achado de segredo de alta confianca.
- `npm run lint`: passou sem erro ou aviso do projeto; o Next.js informa que `next lint` esta depreciado.
- `npm run typecheck`: passou.
- `npm run test:domain`: passou.
- `npm run test:unit`: 12 arquivos e 55 testes passaram.
- `npm run build`: passou.
- `npm run test:integration`: 8 testes foram ignorados por ausencia de `TEST_DATABASE_URL`/`DATABASE_URL`.
- `npm run test:e2e`: a cobertura autenticada depende de credenciais E2E e de servidor iniciado; nao foi aceita como evidencia de producao.
- `npm audit --omit=dev --json`: o detalhamento exigiria transmitir o inventario ao registro publico e foi bloqueado pela politica do ambiente. A contagem do `npm ci` permanece registrada; as CVEs exatas continuam pendentes.

Limitacoes do equipamento:

- `psql` nao esta instalado.
- Docker nao esta instalado/disponivel.
- Nao foi possivel executar migrations, RLS, concorrencia, backup ou restore contra PostgreSQL real.

## Riscos confirmados

### Criticos

1. O workflow legado de aprovacao persiste `bbt-aprovacoes` no navegador. Ele nao pode ser a fonte oficial de decisao, auditoria ou concorrencia.
2. Rotas de cotacao, reserva, emissao, cancelamento e consultas Tech autorizavam pelo papel visual legado `master`. Perfis internos distintos eram normalizados para esse mesmo valor.
3. A autoridade corporativa efetiva era mesclada por empresa. Essa representacao permitia combinar fontes diferentes durante uma tentativa de delegacao.
4. Politicas existentes sao regras `if/else` sem versao publicada imutavel, persistencia de avaliacao, DSL ou explicacao estrutural.

### Altos

1. `/api/storage` e `app_kv` ainda atendem dominios criticos e aceitam gravacao em lote.
2. Empresas, funcionarios, demandas, reservas e financeiro possuem estruturas relacionais, mas varios consumidores continuam no armazenamento generico.
3. A sincronizacao de diretorio e estruturas legadas nao cobre integralmente exclusao, transferencia e invalidacao de todos os vinculos derivados.
4. Integracoes usam armazenamento legado para parte de cotacoes e reservas, sem checkpoint relacional completo de politica/aprovacao.

### Moderados

1. Ha logica de negocio e autorizacao visual em componentes React extensos.
2. Existem referencias restantes a `master` no frontend; elas precisam ser substituidas gradualmente por permissoes e contexto, sem quebrar a navegacao legada.
3. Nao ha pipeline GitHub Actions ativo dentro desta pasta.
4. O detalhamento das vulnerabilidades npm e os testes de banco permanecem bloqueados pelo ambiente atual.

## Armazenamento legado

Foram catalogadas 52 chaves compartilhadas. Classificacao inicial:

- Criticas: `bbt-data-v4`, `bbt-aprovacoes`, `bbt-financeiro`, `bbt-corporate-finance`, `bbt-emissoes`, `bbt-vouchers-emitidos`, `bbt-auditoria`.
- Operacionais: atendimentos, reservas de fornecedor, transferencias, transacoes, caixa de entrada, fila de importacao e mensagens.
- Integracoes: Tech Travel, Wintour, fornecedores e logs de integracao.
- IA/assistente: configuracoes, conversas, tarefas, aprovacoes humanas, documentos e logs.
- Preferencias/cache: somente itens comprovadamente visuais poderao permanecer fora do PostgreSQL.

Novos dominios de politica, aprovacao e ciclo de viagem ficam proibidos de utilizar `/api/storage`.

## Dependencia documental

O arquivo `__. ARGO .__ politicas.pdf` citado no escopo nao foi anexado e nao foi localizado no workspace, Desktop, Downloads ou pasta de anexos desta tarefa. A matriz `docs/POLICY-BENCHMARK-MATRIX.csv` podera registrar requisitos do prompt, mas a rastreabilidade por pagina e a declaracao de cobertura integral do PDF permanecem bloqueadas ate o recebimento do documento.

## Ordem de correcao

1. Autoridade de delegacao por origem e autorizacao server-side sem `master` irrestrito.
2. Depreciacao controlada do storage generico.
3. Banco relacional para politicas, aprovacoes e ciclo de viagem.
4. Motores deterministas e seus testes.
5. Integracao por checkpoints nos fluxos criticos.
6. Interfaces administrativas e simuladores conectados as APIs.
7. PostgreSQL/RLS/E2E/backup/restore em infraestrutura adequada.

Este documento e uma linha de base, nao uma aprovacao de producao.
