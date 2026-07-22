# Controles tecnicos de privacidade

Este documento nao declara conformidade juridica. Ele mapeia controles tecnicos que precisam ser combinados com base legal, contratos, politicas e orientacao juridica.

## Dados tratados

| Categoria | Exemplos | Local |
| --- | --- | --- |
| Identidade | nome, e-mail, telefone, documento, matricula | PostgreSQL |
| Viagem | rota, hotel, datas, preferencia, reserva | PostgreSQL |
| Financeiro | valor final, custo interno, fatura, centro de custo | PostgreSQL |
| Documentos | vouchers e PDFs importados | volume privado + metadados PostgreSQL |
| Seguranca | sessao, IP, user agent, eventos | PostgreSQL e logs |
| Integracoes | identificadores e payload minimo | fornecedor configurado |

Documentos, preferencias e historico de viagem podem elevar o risco de privacidade. Evite importar campos sem finalidade definida.

## Controles implementados

- tenant e escopo de empresa/grupo;
- RLS e chaves compostas;
- RBAC no servidor;
- arquivos privados;
- redacao de logs;
- auditoria;
- sessao revogavel;
- reset administrativo com confirmacao e auditoria;
- exclusao logica em entidades relacionais;
- backups protegidos e restore controlado.

## Processos que exigem definicao

- finalidade e base legal por categoria;
- prazo de retencao por contrato/tenant;
- politica de anonimização versus exclusao;
- resposta a solicitacao do titular;
- exportacao estruturada por tenant/pessoa;
- descarte seguro de backups expirados;
- operadores/suboperadores externos;
- transferencia internacional em IA, e-mail e viagens;
- processo de incidente e notificacao.

## Recomendacoes antes do piloto

1. Aprovar inventario e matriz de acesso.
2. Definir retencao e descarte.
3. Assinar contratos com operadores.
4. Configurar canal de solicitacao do titular.
5. Testar exportacao, correcao e exclusao em ambiente isolado.
6. Treinar operadores para nao copiar documentos em logs/chats.
7. Definir encarregado e resposta a incidente.

O reset de tenant nao substitui um fluxo juridicamente validado de exclusao de titular, especialmente quando existem obrigacoes fiscais, auditoria ou backups.
