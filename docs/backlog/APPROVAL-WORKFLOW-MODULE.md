# Demanda futura — modulo de fluxos de aprovacao

Status: `BACKLOG`
Registrada em: `2026-08-03`
Regra: nao iniciar implementacao sem aprovacao explicita.

## Objetivo

Disponibilizar a parametrizacao completa de fluxos de aprovacao para tenant,
grupos e empresas por uma interface administrativa, sem depender de chamadas
manuais de API.

## Isolamento arquitetural obrigatorio

- implementar como modulo funcional isolado, com fachada publica e contratos
  explicitos;
- impedir que telas externas acessem diretamente tabelas ou detalhes internos
  do modulo;
- integrar politicas, demandas, centros de custo, usuarios e processos
  empresariais por servicos, eventos/outbox ou APIs tipadas;
- manter migrations aditivas e reversiveis sempre que possivel;
- proteger a ativacao por feature flag e escopo de tenant;
- preservar os fluxos e instancias ja publicados por snapshot/versionamento.

## Escopo funcional futuro

1. Assistente visual `Aprovacoes e alcadas > Novo fluxo`.
2. Abrangencia por tenant, grupo ou empresa, com inclusoes e exclusoes.
3. Etapas, condicoes, quorum, fallback, autoaprovacao e segregacao de funcoes.
4. Cadastro de aprovadores, alcadas, delegacoes, vigencia e SLA.
5. Vinculo explicito entre politicas e o codigo do workflow publicado.
6. Simulacao com empresa, grupo, usuario, centro de custo, valor e moeda.
7. Ciclo `Rascunho > Em revisao > Aprovado > Publicado` com auditoria.
8. Consumidor interno para ligar o no de aprovacao dos processos empresariais
   ao motor relacional de instancias de aprovacao.

## Regras de entrega

- sequencia obrigatoria: local > Git staging > VPS staging > aprovacao >
  producao Git > producao VPS;
- testes unitarios, integracao PostgreSQL, RLS, concorrencia e regressao;
- nenhuma alteracao de producao antes da homologacao explicita no staging;
- implementacao deve evitar mudancas transversais fora dos contratos do modulo.
