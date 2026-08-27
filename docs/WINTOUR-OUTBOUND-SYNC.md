# Sincronizacao de vendas Wintour

## Objetivo

O conector preserva o importador Wintour → BDEX existente e acrescenta um
fluxo separado BDEX → Wintour para vendas emitidas e alteracoes pos-emissao.
Ele foi desenhado para operar de forma assincrona, auditavel e fail-closed.

## Contratos externos

Referencias usadas nesta implementacao e que devem permanecer no dossie de
homologacao:

- `InterfaceAutomFornecedores_Opcao1.pdf`;
- `Dgr-021-I-Layout_ImportacaoVendasWI.pdf`;
- `InterfaceAutomAlteracaoVS.pdf`;
- `Dgr-046_Layout_AlteracaoVendasWI.pdf`;
- WSDL `IHubInterfaces` e `IHubInterfacesUpd`, consultados diretamente nos
  endpoints oficiais Digirotas.

Criacao de vendas:

- SOAP 1.1 RPC/encoded;
- endpoint HTTPS fixo `https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces`;
- operacao `importaArquivo2`;
- XML de vendas layout v4, raiz `bilhetes`, ate 100 vendas por arquivo;
- `idv_externo` numerico e estavel por venda BDEX;
- consulta detalhada por `consultaProtocoloDet`, dependente de liberacao
  Digirotas e potencialmente tarifada.

Alteracao de vendas:

- endpoint HTTPS fixo `https://www.digirotas.com/HubInterfacesSoapUpd/soap/IHubInterfacesUpd`;
- operacao `alteraVendas`;
- XML com raiz `raiz` e numero interno da venda Wintour;
- apenas os campos publicados no DGR-046;
- protocolo consultado por `consultaProtocolo`;
- a mesa de alteracoes do Wintour ainda exige processamento humano.

## Estados e idempotencia

Cada emissao possui um vinculo estavel, mas pode ter varias tentativas e
protocolos. Os principais estados sao:

- `blocked`: dados ou de-para obrigatorios ausentes;
- `ready`: XML validado e ainda nao enviado;
- `sending`: lease exclusivo durante a chamada externa;
- `ambiguous`: houve timeout/interrupcao e nao se sabe se o Wintour recebeu;
- `received` / `processing`: protocolo recebido ou ainda em fila;
- `manual_review`: requer conciliacao ou acao na mesa Wintour;
- `completed`: confirmacao externa reconciliada;
- `rejected` / `failed` / `cancelled`: termino explicito com historico.

Nao existe retry automatico de `ambiguous`. O reenvio exige acao humana,
confirmacao e motivo, gerando nova tentativa. O protocolo nunca e confundido
com o numero da venda Wintour.

Como a consulta detalhada pode ser tarifada, cada job faz no maximo 12
consultas automaticas de protocolo e nunca ultrapassa uma janela de 24 horas.
Ao atingir qualquer limite, o job vai para `manual_review` e novas consultas
dependem de conciliacao humana.

## Parametrizacao obrigatoria

Antes de habilitar o envio, o administrador da agencia deve confirmar:

- PIN por canal seguro;
- nome da agencia e posto/filial;
- codigos de produto por servico;
- de-para das formas de pagamento para FOP Wintour;
- regra de tarifa net;
- contas exigidas para cartao, taxas, fee e emissao;
- prestadores/fornecedores e numero de documento dos produtos sem bilhete;
- regra homologada para Rodoviario (`Outros` ou `Outros Servicos`);
- uso de `aLivre` e politica de cancelamento `xxmanter`;
- responsavel pelas mesas de importacao, pendencias e alteracoes.

Registro incompleto permanece bloqueado e nunca e transmitido parcialmente.

## Cobertura inicial de exportacao

A descoberta automatica inicial aceita somente emissoes aereas do fluxo
`manual-offline`, com uma venda Wintour por bilhete. O registro so fica
`ready` quando bilhete, passageiro, documento, trechos, valores em BRL,
companhia emissora e todos os de-para obrigatorios puderem ser reconstruidos
das tabelas relacionais do BDEX sem truncamento ou estimativa.

Nesta homologacao da agencia brasileira, os campos civis de geracao,
lancamento e requisicao usam `America/Sao_Paulo`; cada trecho aereo usa o fuso
IANA inequivoco do respectivo aeroporto. Aeroporto sem fuso unico bloqueia a
venda em vez de assumir UTC.

Emissoes de Hotel, Locacao e Rodoviario permanecem `blocked` nesta primeira
versao. Elas so podem ser promovidas depois que cada dominio fornecer snapshots
canonicos suficientes e passar pela homologacao de layout. O mesmo ocorre com
emissoes aereas de outro provedor, rateio ambiguo entre varios bilhetes, moeda
estrangeira, RAV/RAC sem regra explicita ou forma de pagamento fracionada sem
componentes financeiros separados.

## Seguranca

- PIN somente em secret/env do servidor; ele entra apenas no envelope SOAP em
  memoria exigido pelo Wintour e nunca no arquivo de vendas, na interface ou
  nos logs;
- cada PIN deste runtime fica vinculado a exatamente um tenant por
  `WINTOUR_TENANT_ID`, impedindo uso cruzado da credencial;
- endpoint externo allowlisted e HTTPS;
- XML e snapshots nao aparecem nas listagens ou logs;
- download de XML exige autenticacao e permissao administrativa;
- parser SOAP limita tamanho e rejeita DTD/entidades externas;
- tenant e permissao sempre derivados da sessao;
- envio e consulta automatica desligados por padrao.

## Ativacao

1. Aplicar a migration da fila Wintour.
2. Configurar os de-para no painel administrativo.
3. Validar XMLs de cada servico com a Digirotas.
4. Cadastrar o `WINTOUR_PIN` no secret store e vinculá-lo ao tenant da agência com `WINTOUR_TENANT_ID`.
5. Habilitar `WINTOUR_SYNC_ENABLED=true` mantendo autoenvio desligado. O worker recusa qualquer tenant diferente daquele vinculado à credencial.
6. Validar o download do XML e, em homologacao controlada, envio, erro, timeout
   e conciliacao de protocolo.
7. Confirmar custos/liberacao de consulta detalhada.
8. Somente apos aceite, habilitar autoenvio e/ou consulta automatica.
