# Cobertura de politicas ARGO

## Fonte analisada

- Documento: `__. ARGO .__ politicas.pdf`
- Paginas: 49
- SHA-256: `f84c67292fa47ef800b10ed24d662d6100002488164c04d8c7c03fc83b1b54ac`
- Data da revisao: 23/07/2026
- Referencias de politica detectadas: 150
- Referencias mapeadas para familias BDEX: 149
- Referencias recusadas por seguranca: 1

O PDF e uma impressao expandida da listagem ARGO. Varias descricoes nao exibem o
codigo da politica que as originou. Por isso a rastreabilidade combina:

1. codigos citados explicitamente no texto;
2. area funcional e intervalo de paginas;
3. familia executavel equivalente no BDEX;
4. teste automatizado do comportamento da familia.

O arquivo `POLICY-BENCHMARK-MATRIX.csv` e gerado pelo comando:

```powershell
npm run policy:benchmark
```

Ele nao deve ser alterado manualmente.

## Resultado por area

| Area | Paginas | Estado |
| --- | ---: | --- |
| Adiantamento e prestacao de contas | 2-3 | Implementado |
| Alocacao de custos | 3-5 | Implementado |
| Aprovacao, alcadas e delegacoes | 5-12 | Implementado |
| Comunicacao | 11-14 | Implementado |
| Cotacao e distribuicao | 15-17 | Implementado; provedores exigem homologacao |
| Emissao | 17-19 | Implementado; provedores exigem homologacao |
| Escolha, faturamento e justificativas | 19-21 | Implementado |
| Modulos corporativos | 21-23 | Implementado |
| Orcamento | 23-25 | Implementado |
| Controles administrativos | 25-27 | Implementado; consulta externa exige homologacao |
| Perfil do viajante | 27-29 | Implementado |
| Pesquisa | 29-34 | Implementado; disponibilidade exige provedor |
| Prazos e reservas | 34-37 | Implementado; efetivacao exige provedor |
| Seguranca | 37-38 | Implementado com endurecimento |
| Solicitacao e jornada | 39-49 | Implementado; reserva e emissao exigem provedor |

## Excecao deliberada de seguranca

`ARGO:APROUT` descreve aprovacao sem autenticacao. Esse comportamento nao e
implementado no BDEX porque viola identidade individual, nao repudio e auditoria.

A alternativa BDEX e `approval.secure-email-link`: token individual, expirable,
de uso unico, associado a uma sessao e a uma decisao auditada.

## O que "implementado" significa

Uma familia marcada como implementada possui:

- condicao estruturada e validada;
- acao deterministica;
- checkpoints declarados;
- dependencias declaradas;
- fatos de simulacao;
- execucao automatizada em todos os 12 perfis de segmento;
- hash de conteudo;
- teste de schema e avaliacao.

O estado nao significa que um provedor externo foi homologado. Integracoes
continuam bloqueadas para operacao automatica enquanto a homologacao nao for
comprovada.

## Evidencias

- Catalogo: `lib/policy/templates/catalog.ts`
- Matriz por area: `lib/policy/templates/argo-benchmark.ts`
- Avaliador: `lib/policy/evaluator.ts`
- Validacao: `lib/policy/schema.ts`
- Testes: `tests/unit/policy-template-catalog.test.ts`
- CSV: `docs/POLICY-BENCHMARK-MATRIX.csv`
