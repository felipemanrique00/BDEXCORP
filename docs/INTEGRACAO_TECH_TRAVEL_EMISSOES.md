# Integração Tech Travel - Relatório de Emissões

## Escopo

Esta integração consulta o relatório oficial de emissões da Tech Travel por período e transforma os registros em atendimentos do BDEX. Ela é independente do conector de cotações e reservas.

- Provedor: Tech Travel / TTravel.
- Recurso externo: `POST /ttravelapi/relatorio/Emissao`.
- Rota interna: `POST /api/integrations/tech/emissions`.
- Interface: **Integrações > Emissões e importações**.
- Formato de entrada da interface: datas ISO `YYYY-MM-DD`.
- Limite por consulta: 366 dias.

## Configuração

Defina somente no ambiente do servidor:

```dotenv
TECH_REPORTS_ENABLED=true
TECH_REPORTS_BASE_URL=https://www.ttravel.com.br/ttravelapi/relatorio
TECH_REPORTS_KEY=
```

Não reutilize `TECH_REPORTS_KEY` no frontend e não a grave em código, documentação, logs ou arquivos versionados. As variáveis `TECH_API_LOGIN`, `TECH_API_PASSWORD` e `TECH_API_KEY` pertencem ao conector de reservas e não são substituídas pela chave de relatórios.

## Segurança

- A chave é lida apenas no servidor.
- A rota exige sessão de usuário interno com papel `master` e permissão `importar_planilhas`.
- O corpo da requisição é limitado a 32 KB.
- A rota aplica limite de 20 consultas por minuto.
- Campos `Key`, `chave`, tokens, senhas e dados de cartão são mascarados em erros e logs.
- A resposta enviada ao navegador contém somente o modelo normalizado necessário à revisão e importação.

## Mapeamento dos dados

| Tech Travel | BDEX |
| --- | --- |
| `NumeroOS` | Número da solicitação |
| `NOMEPAX` + `SOBRENOMEPAX` | Nome informado na emissão |
| `NOMECLIENTE` | Cliente externo a vincular com uma empresa local |
| `TIPO` | Tipo de serviço |
| `BILHETE` / `LOCALIZADOR` | Bilhete e localizador |
| `TOTALCLIENTE` | Valor final do cliente |
| `TOTALFORNECEDOR` | Custo interno |
| `SOLICITANTE` / `APROVADOR` | Solicitante e autorizador |
| `CENTROCUSTO` | Centro de custo |
| `EMISSOR` | Emissor/agente |
| `TRECHOS` e segmentos 1 a 6 | Rota, cidade e datas do serviço |
| Políticas e justificativas | Metadados operacionais internos |

Quando os campos totais não são informados, o normalizador soma tarifa e taxas da respectiva visão. O resultado bruto é armazenado como dado interno; ele não é usado como base de economia.

## Vínculo e deduplicação

1. A consulta apenas carrega e apresenta os registros; não grava atendimentos automaticamente.
2. Cada nome de cliente externo deve ser vinculado a uma empresa local ou marcado como não importado. O vínculo confirmado é salvo no cadastro compartilhado da empresa e reutilizado por outros usuários.
3. Passageiros são procurados somente entre os funcionários da empresa vinculada, usando o mecanismo de identidade e aliases já existente.
4. Correspondências ambíguas não recebem `funcionario_id` automaticamente; o nome original permanece para reconciliação.
5. Bilhetes usam uma chave de venda estável. Registros sem bilhete recebem uma identidade derivada de OS, localizador, passageiro, serviço e rota.
6. Uma reimportação atualiza o atendimento existente e preserva vínculos e metadados que não foram substituídos pela Tech Travel.
7. Toda a lista é persistida uma única vez por lote, evitando múltiplas regravações durante importações grandes.

## Operação

1. Abra **Emissões e importações**.
2. Informe início e fim e selecione **Consultar**.
3. Confira totais, clientes, emissores e as primeiras linhas.
4. Vincule todos os clientes externos às empresas locais.
5. Selecione **Importar**.
6. Confira as quantidades criadas, atualizadas e ignoradas.

Registros são ignorados quando não têm venda/passageiro, quando o cliente foi marcado para não importar ou quando nenhuma empresa válida foi vinculada.

## Diagnóstico

`GET /api/integrations/tech/status` informa separadamente:

- `health`: configuração do conector de reservas/cotações;
- `reports`: configuração do relatório de emissões.

O status nunca retorna a chave. A consulta externa não é executada pelo endpoint de status para evitar tráfego e processamento desnecessários.

## Validação

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes cobrem validação do período, mascaramento de segredo, normalização de aéreo e hotel, totais de fallback e estabilidade da identidade em reimportações.
