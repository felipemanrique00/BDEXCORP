# Verificacao de funcionalidades

## Escopo rastreavel

O arquivo `FEATURE-INVENTORY.generated.md` lista individualmente todas as paginas e APIs encontradas pelo App Router. Ele e regenerado por `npm run inventory:features` e validado por `npm run inventory:check`.

Inventario atual:

- 55 paginas;
- 66 APIs;
- APIs publicas por contrato: health, readiness e consulta de sessao;
- demais APIs com guard do servidor.

Esse inventario e a lista canonica exigida para cada pagina/API. Nao interprete `Build e inventario` como teste funcional completo.

## Legenda

- **Verificado localmente**: comando executado nesta copia e aprovado.
- **Coberto no CI**: teste automatizado configurado com PostgreSQL/build real, ainda dependente da execucao do workflow.
- **Pendente externo**: exige credencial, servidor ou fornecedor.
- **Nao verificado ponta a ponta**: compila e possui guard, mas precisa roteiro no navegador.

## Matriz funcional

| Area | Implementacao | Evidencia | Status |
| --- | --- | --- | --- |
| Login/sessao | Sessao DB, cookie seguro, bloqueio e revogacao | Dominio, unidade e E2E | Local parcial; E2E no CI |
| Convite/reset | Token hash, expiracao, SMTP | Build e rotas guardadas | Pendente SMTP real |
| Tenant/RBAC | Membership, papeis, escopo e guard | Migrations, dominio e integracao | Integracao no CI |
| Isolamento | RLS forcado e FK composta | `tenant-isolation.test.ts` | Integracao no CI |
| Empresas/grupos | Cadastros e portal com escopo | Build/inventario | Nao verificado ponta a ponta |
| Funcionarios | ID permanente, aliases e vinculacao manual | Testes de dominio | Verificado localmente |
| Demandas/OS | Persistencia remota confirmada antes do sucesso | Dominio/build | Nao verificado ponta a ponta |
| Reservas/cotacoes | APIs reais ou erro explicito | Build/inventario | Tech transacional bloqueada |
| Vouchers | CRUD, PDF privado e vinculos | Unitario de PDF + E2E | E2E no CI |
| Importacoes | Wintour/CSV/PDF, idempotencia e conciliacao | Dominio/build | Arquivos reais adicionais pendentes |
| Financeiro | Validacao e persistencia confirmada | Unitario/build | Nao verificado ponta a ponta |
| Relatorios | Empresa, grupo, pessoa, centro, agente, dashboard e HTML | Dominio/build | Revisao visual pendente |
| IA/BIA | APIs guardadas, erro sem provedor | Dominio/build | Pendente credenciais reais |
| Tech Relatorios | Proxy servidor e normalizacao | Unitario/contrato | Pendente credencial/fornecedor |
| WhatsApp | Configuracao protegida | Build | Envio nao homologado |
| Plataforma SaaS | Tenants, planos, limites e convite | Build/E2E | E2E no CI + SMTP externo |
| Reset | Escopo de tenant, senha e arquivos em staging | Dominio/build | Restore operacional pendente |
| Backup/restore | Scripts com hash e restore isolado | CI configurado | Nao executado localmente |

## Testes automatizados

- `scripts/domain-tests.cjs`: regressao de regras, seguranca, importacao, identificacao, storage e relatorios.
- `tests/unit`: senha, merge, financeiro, fornecedores, quota, PDF e demais funcoes puras.
- `tests/integration/tenant-isolation.test.ts`: PostgreSQL real e ataques cruzados.
- `tests/e2e/auth.spec.ts`: redirect, login invalido/valido, admin SaaS, persistencia e arquivos privados.
- `scripts/load-test.mjs`: leitura autenticada, throughput, media, p95 e erros.
- `.github/workflows/quality.yml`: migrations, bootstrap, testes, build, browser, imagem, backup e restore.

## Dependencias externas

| Dependencia | Necessaria para | Criterio de aceite |
| --- | --- | --- |
| SMTP | convite e reset | entrega, link, expiracao e auditoria |
| Tech Reports | importacao de emissoes | resposta oficial e idempotencia |
| Tech transacional | cotar/reservar/emitir/cancelar | sandbox, contrato, idempotencia e reconciliacao |
| OpenAI/Gemini | IA | resposta real, timeout, quota e privacidade |
| WhatsApp | envio | provedor homologado, entrega e erro real |
| Tiles/mapa | mapas online | rede, termos e fallback visual |

## Roteiro manual minimo antes do piloto

1. Criar contas de administrador, agente, financeiro e empresa.
2. Confirmar acessos permitidos e negados.
3. Cadastrar grupo, empresa, funcionario e alias.
4. Criar demanda, localizar OS, aprovar, reservar e gerar voucher.
5. Reiniciar aplicacao e confirmar persistencia.
6. Importar arquivos reais, reimportar e verificar idempotencia.
7. Gerar relatorios cliente/agencia e exportar HTML.
8. Confirmar que markup interno nao chega ao cliente.
9. Testar upload/download/exclusao.
10. Executar backup e restore isolado.

Sem esse roteiro e a execucao do CI, funcionalidades marcadas como pendentes nao recebem status de validadas.
