# Auditoria senior do sistema - 2026-06-30

## Escopo revisado

- Projeto analisado: `BDEXFINAL`.
- Fontes varridas: `app`, `components`, `lib`, `scripts` e `types`.
- Total de arquivos fonte encontrados na varredura: 227.
- Rotas e dominios priorizados: importacoes, caixa de entrada, vouchers, emissoes, relatorios, portal empresa/grupos, funcionarios, storage de atendimentos e identificacao de pessoas.

## Diagnostico principal

1. O sistema concentra muita regra de negocio dentro de paginas React grandes. Os maiores arquivos passam de 40 KB e misturam UI, persistencia, calculos, permissoes e agregacoes. Isso aumenta risco de quebrar uma tela ao ajustar outra.
2. A identificacao de pessoas ja tinha um motor central em `lib/funcionario-identidade.ts`, mas alguns fluxos ainda chamavam wrappers antigos ou aplicavam confianca propria. Isso podia fazer Wintour, emissoes, voucher e caixa de entrada divergirem.
3. O storage de atendimentos era chamado repetidamente em paginas densas. A cache adicionada anteriormente estava correta, mas ainda havia uma leitura/parse duplicado no carregamento.
4. A tela de importacoes tinha textos com mojibake e logs de debug em fluxo normal. Isso prejudica apresentacao e dificulta suporte.
5. O projeto ainda tem arquivos grandes que devem ser quebrados em modulos por dominio antes de qualquer expansao maior: `portal-empresa`, `dashboard`, `corporate-report`, `export-html`, `wintour`, `importar`, `relatorios`, `financeiro`.

## Correcoes aplicadas nesta revisao

### Identificacao de pessoas

- `components/ui/importar-voucher-modal.tsx`
  - Passou a usar `buscarFuncionariosPorNomeInteligente` do motor central.
  - O match agora respeita aliases manuais, ID unico, score centralizado e filtro por empresa.
  - Corrigido uso de empresa detectada no mesmo ciclo de importacao, evitando match com empresa ainda desatualizada no state.

- `app/dashboard/emissoes/page.tsx`
  - Importador legado de emissoes passou a usar `encontrarFuncionarioPorNomeInteligente`.
  - Vínculo automatico agora rejeita matches ambiguos.

- `app/dashboard/caixa-entrada/page.tsx`
  - Caixa de entrada passou a usar `buscarFuncionariosPorNomeInteligente` e `encontrarFuncionarioPorNomeInteligente`.
  - Removida regra local de confianca que podia vincular pessoa errada por score baixo.
  - Corrigido uso imediato da empresa detectada antes do state React atualizar.

### Performance e armazenamento

- `lib/atendimentos-storage.ts`
  - Removido parse duplicado no `loadAtendimentos`.
  - A funcao agora usa o texto bruto ja lido por `safeGetRaw`, reduzindo custo em telas que chamam `getAllAtendimentos()` varias vezes.

### Qualidade visual e manutencao

- `app/dashboard/importar/page.tsx`
  - Removidos logs de debug de arquivo/deteccao.
  - Corrigidos textos quebrados por encoding na UI de importacao.

- `lib/detector-arquivo.ts`
  - Corrigidos titulos, descricoes, motivos e labels quebrados por encoding.
  - Substituidos icones em string corrompidos por codigos estaveis (`PDF`, `HTL`, `RH`, `HOT`, `AIR`, `XML`).

- `components/ui/importar-voucher-modal.tsx`
  - Corrigidos textos quebrados por encoding no fluxo de voucher.

## Riscos restantes mapeados

1. Arquivos grandes ainda devem ser quebrados em componentes/hooks/servicos menores. Esta revisao evitou uma reestruturacao agressiva para nao quebrar fluxos em producao.
2. O sistema ainda depende muito de `localStorage`/storage local para dados sensiveis e volumosos. Para escala real, o caminho correto e migrar atendimentos, vouchers, funcionarios, grupos e relatorios para banco transacional com indices.
3. Relatorios e portal empresa ainda fazem muitas agregacoes no cliente. O proximo passo tecnico correto e criar uma camada unica de agregacao memoizada por periodo/empresa/grupo.
4. Ainda ha uso relevante de `any` nos parsers e integracoes. Em parsers isso e aceitavel parcialmente, mas os contratos de saida devem ficar tipados e testados.
5. O export HTML do relatorio e grande e deve ser separado em: modelo de dados, renderizador, interacoes e estilos.

## Proxima etapa recomendada

1. Extrair servicos de agregacao de relatorios para `lib/reporting`.
2. Quebrar `portal-empresa/page.tsx` em abas isoladas com hooks memoizados.
3. Criar testes de regressao para:
   - ALDO FERNANDES JUNIOR e aliases.
   - Voucher importado com empresa detectada.
   - Emissao Wintour/legado com nome invertido.
   - Relatorio por funcionario_id.
   - Grupo/holding com empresas vinculadas.
4. Migrar listas grandes para IndexedDB ou API/banco, mantendo cache local apenas como fallback.
