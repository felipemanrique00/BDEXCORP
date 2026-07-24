# Apresentação profissional do sistema

## 1. Sumário

1. Visão geral do sistema
2. Objetivos do BDEX
3. Problemas que o sistema resolve
4. Benefícios para a operação
5. Módulos do sistema
6. Fluxo geral de funcionamento
7. Perfis de usuário e permissões
8. Telas e funcionalidades
9. Casos de uso
10. Indicadores e relatórios
11. Segurança e confiabilidade
12. Implantação
13. Suporte e manutenção
14. Pendências de confirmação
15. Conclusão

## 2. Visão geral do sistema

O **BDEX** é uma plataforma web de gestao inteligente para agências e operacoes de viagens corporativas. O sistema centraliza demandas, reservas, vouchers, importacoes do Wintour, integrações com fornecedores via Tech Travel, financeiro, alertas, relatórios, portal para empresas e uma camada de inteligencia artificial chamada **IA BIA**.

O objetivo é reduzir trabalho manual, organizar a operação em equipe, melhorar o controle financeiro e permitir que a agência tenha uma visão unificada de cada viagem: desde o pedido inicial até a emissão, voucher, acompanhamento, faturamento e auditoria.

O sistema foi criado para ambientes onde existem muitos pedidos por e-mail, WhatsApp, arquivos, planilhas, XMLs e fornecedores diferentes. Em vez de cada informação ficar espalhada, o BDEX transforma esses dados em uma fila operacional centralizada.

### 2.1 Para quem foi criado

| Publico | Uso principal |
|---|---|
| Agencia de viagens corporativas | Operar demandas, cotações, vouchers, financeiro e fornecedores em um único sistema. |
| Equipe interna BBT Corporate | Controlar produtividade, SLA, aprovações, importacoes e qualidade operacional. |
| Empresas clientes | Abrir pedidos, acompanhar viagens, consultar vouchers, alertas e faturas pelo portal. |
| Gestores e financeiro | Acompanhar custos, centro de custo, politica, faturamento e divergencias. |
| Solicitantes | Criar demandas e localizar informações de viagem com apoio da IA BIA. |

### 2.2 Diferenciais

- **IA BIA integrada ao sistema**, com acesso ao contexto operacional, demandas, vouchers, cadastros e integrações autorizadas.
- **Tech Travel como hub principal de fornecedores**, evitando conexoes isoladas com cada consolidadora ou operadora.
- **Importacao diaria do Wintour**, permitindo alimentar o BDEX com vendas/emissões realizadas no sistema atual.
- **Portal para empresas e solicitantes**, reduzindo dependencia de atendimento manual para consultas e pedidos.
- **Fluxo único entre demanda, reserva, voucher, financeiro e relatorio**.
- **Alertas operacionais**, incluindo check-in, check-out, aéreo, viagens em campo e pendências.
- **Controle financeiro corporativo**, incluindo faturas, carteira corporativa, Pix e cartoes como estrutura operacional.

## 3. Objetivos do BDEX

### 3.1 Objetivo principal

Centralizar a gestao de viagens corporativas em uma plataforma única, com automacao, inteligencia artificial, integração com fornecedores e controle financeiro.

### 3.2 Objetivos secundarios

- Diminuir retrabalho operacional.
- Padronizar a criacao de demandas e vouchers.
- Integrar vendas importadas do Wintour com o banco operacional.
- Dar visibilidade para empresas clientes.
- Acelerar localizacao de vouchers, pedidos, reservas e informações financeiras.
- Melhorar SLA e produtividade da equipe.
- Criar base de dados confiavel para relatórios e tomada de decisao.
- Preparar a operação para atendimento assistido por IA.

### 3.3 Ganhos para a empresa que utiliza

| Área | Ganho esperado |
|---|---|
| Operação | Menos controle por planilhas e menor risco de perda de demanda. |
| Financeiro | Melhor rastreabilidade entre venda, voucher, demanda e fatura. |
| Gestao | Indicadores consolidados por empresa, agente, período, serviço e status. |
| Atendimento | IA BIA ajuda a localizar dados, resumir demandas e orientar proximas ações. |
| Cliente final | Portal com acesso a pedidos, vouchers, viagens, alertas e faturas. |

## 4. Problemas que o sistema resolve

Operacoes de viagens corporativas normalmente dependem de diversos canais e ferramentas: e-mail, WhatsApp, Wintour, fornecedores, planilhas, PDFs, portais, financeiro e controles paralelos. Essa fragmentacao gera perda de informação, demora no atendimento, dificuldade de auditoria e pouca previsibilidade.

O BDEX resolve esse problema criando uma base única onde cada pedido passa a ter status, responsavel, empresa, viajante, datas, tipo de serviço, valores, anexos, voucher, financeiro e histórico.

## 5. Benefícios

### 5.1 Benefícios operacionais

- Fila única de demandas e vouchers.
- Entrada de demandas por texto, e-mail, audio, print, PDF e arquivo.
- Importacao do Wintour com conferencia antes de gravar.
- Alertas de check-in, check-out, aéreo e pendências.
- Vouchers vinculados a demandas e empresas.
- Localizacao rapida de informações por busca ou IA BIA.

### 5.2 Benefícios financeiros

- Lancamentos financeiros vinculados a demandas e vouchers.
- Controle de contas a pagar e receber.
- Faturas corporativas.
- Carteira digital corporativa como estrutura operacional.
- Pix e cartoes fisicos/virtuais como módulo financeiro preparado para integração futura.
- Reconciliacao e identificacao de divergencias.

### 5.3 Benefícios de gestao

- Dashboard executivo.
- Indicadores por período.
- Produtividade por agente.
- Base de empresas, viajantes, hotéis e politicas.
- Relatórios por empresa e agente.
- Auditoria de ações e integrações.

### 5.4 Benefícios para usuários finais

- Portal empresa.
- Acesso a vouchers e histórico.
- Pedidos mais organizados.
- Atendimento com IA BIA.
- Alertas e acompanhamento de viagens.

## 6. Módulos do sistema

| Módulo | Finalidade | Como funciona | Exemplo prático |
|---|---|---|---|
| Dashboard executivo | Apresentar a saude da operação. | Consolida demandas, financeiro, alertas, produtividade e mapas. | Gestor ve total de demandas abertas, faturamento e alertas do dia. |
| Entrada de demandas | Capturar pedidos recebidos. | Aceita texto, arquivo, audio, imagem, PDF e parser por IA. | Operador cola uma mensagem de hospedagem e a IA preenche a demanda. |
| Demandas e vouchers | Controlar fila operacional. | Cada demanda possui status, prioridade, empresa, viajante e serial/OS. | Uma hospedagem para Rio de Janeiro vira OS e depois voucher. |
| Wintour | Alimentar o BDEX com vendas externas. | Importa arquivo diario exportado do Wintour. | Vendas do dia sao sincronizadas com demandas e financeiro. |
| Reservas e cotações | Criar cotações e reservas. | Usa Tech Travel como hub de fornecedores. | Operador cria cotação de hotel ou aéreo vinculada a uma OS. |
| Central IA BIA | Assistente e cerebro operacional. | Responde, consulta dados, extrai demandas e apoia ações. | "Localize o voucher do Pedro para Brasilia em 15/08". |
| Portal empresa | Acesso para empresas clientes. | Solicitantes veem pedidos, vouchers, viagens e financeiro permitido. | Cliente acompanha vouchers emitidos da sua empresa. |
| Empresas | Cadastro de clientes. | Guarda dados, centro de custo, contatos, politicas e solicitantes. | Empresa recebe regras de cobrança e SLA. |
| Viajantes | Cadastro de funcionarios. | Armazena documentos, preferencias, cargo e centro de custo. | Viajante tem CPF, passaporte e preferencias salvos. |
| Hotéis | Base de fornecedores hoteleiros. | Mantem cidade, tarifas, telefone, faturamento e observacoes. | IA pode buscar ou sugerir cadastro de hotel. |
| Financeiro | Controle operacional financeiro. | Contas, faturas, carteira, Pix, cartoes e movimentos. | Financeiro emite fatura por empresa. |
| Reconciliacao | Conferir divergencias. | Cruza demandas, vouchers e financeiro. | Sistema alerta valor divergente entre venda e voucher. |
| Aprovações | Validar exceções. | Fluxo por politica, custo e permissão. | Viagem fora da politica vai para aprovador. |
| Risco/Duty of Care | Acompanhar viajantes em campo. | Monitora viagens ativas, alertas e mapa operacional. | Gestor ve quem está em viagem hoje. |
| Relatórios e BI | Apoiar decisao. | Gera analises por empresa, agente, período e serviço. | Relatorio mensal de gastos por empresa. |
| Auditoria | Rastrear ações. | Registra eventos, integrações e ações relevantes. | TI consulta log de importacao ou alteracao. |

## 7. Fluxo geral de funcionamento

1. O pedido chega por portal, e-mail, WhatsApp, texto, audio, arquivo ou importacao.
2. O BDEX interpreta os dados e cria uma demanda com serial/OS.
3. A demanda e vinculada a empresa, solicitante, viajante, centro de custo, datas, tipo de serviço e prioridade.
4. A operação pode cotar pelo módulo de reservas/Tech Travel ou registrar manualmente.
5. Quando a reserva e concluida, o voucher e criado ou importado.
6. O financeiro e alimentado com valores, forma de pagamento, fatura ou carteira.
7. O sistema gera alertas de prazos, check-in, check-out, viagens em campo e pendências.
8. Empresas e solicitantes podem acompanhar informações permitidas pelo portal.
9. Gestores acompanham tudo pelo dashboard, relatórios e auditoria.

## 8. Perfis de usuário e permissões

| Perfil | Funcao | Acesso esperado |
|---|---|---|
| Master/Lider | Administracao geral | Acesso total ao sistema, usuários, configuracoes, financeiro e relatórios. |
| Gestor financeiro | Controle financeiro | Financeiro, relatórios, faturas, conciliacao e produtividade. |
| Supervisor | Gestao operacional | Demandas, aprovações, produtividade e cadastros operacionais. |
| Agente | Operação diaria | Criacao e atendimento de demandas, vouchers e consultas permitidas. |
| Operacional | Acesso restrito | Leitura e tarefas operacionais básicas. |
| Empresa/Solicitante | Portal cliente | Pedidos, vouchers, viagens e financeiro conforme permissão. |

## 9. Telas e funcionalidades

### Dashboard

Apresenta indicadores gerais, filtros por período, gráficos, mapa operacional, alertas, produtividade, financeiro e resumo executivo.

### Entrada de demandas

Central para receber pedidos. Permite colar texto, importar arquivo, processar audio, imagem, print ou documento. A IA BIA pode extrair campos e preparar a demanda para confirmação.

### Demandas e vouchers

Tela principal da operação. Organiza fila, status, alertas, serial/OS, responsavel, empresa, serviço, datas e vinculo com voucher.

### Wintour

Módulo para sincronizar vendas/emissões exportadas do Wintour. O operador confere a previa antes de gravar, evitando duplicidade e erro de alimentacao.

### Reservas e cotações

Módulo operacional para cotações e reservas via Tech Travel, permitindo a conexao com fornecedores habilitados na conta.

### Central IA BIA

Área única da inteligencia artificial. Reune chat, agente operacional, permissão, configuracoes, canais, audio, WhatsApp, ferramentas, logs e testes.

### Portal empresa

Área para empresas e solicitantes acompanharem viagens, vouchers, pedidos, alertas, faturas e informações liberadas.

### Financeiro

Controle de contas, faturas, carteira corporativa, Pix, cartoes, movimentos e conciliacao.

### Relatórios

Relatórios executivos, por empresa, por agente, produtividade, financeiro, operacional e BI.

### Configuracoes

Parametros gerais, IA, integrações, ambiente, usuários, reset controlado e dados operacionais.

## 10. Casos de uso

### Caso 1 - Pedido de hospedagem por e-mail

Um solicitante envia um e-mail pedindo hospedagem para um funcionario. O operador cola o texto ou importa o arquivo. A IA BIA extrai empresa, hospede, cidade, período, hotel desejado e observacoes. O sistema cria a demanda com serial/OS e deixa pronta para cotação.

### Caso 2 - Importacao diaria Wintour

No fim do dia, a equipe exporta as vendas do Wintour. O BDEX importa o arquivo, mostra uma previa, identifica duplicidades, vincula empresas/viajantes quando possivel e cria demandas finalizadas, vouchers e lancamentos financeiros.

### Caso 3 - Cliente acessa portal empresa

Um solicitante entra no portal, consulta os vouchers emitidos, acompanha pedidos em aberto, ve viagens proximas e usa a IA BIA para localizar informações.

### Caso 4 - Cotação pela Tech Travel

O operador abre uma OS, acessa reservas e cotações, seleciona o serviço, informa destino/datas e consulta fornecedores por meio da Tech Travel. A cotação fica vinculada ao fluxo operacional.

### Caso 5 - Financeiro emite fatura

As demandas e vouchers geram informações financeiras. O financeiro filtra por empresa, confere valores, identifica divergencias e prepara a fatura.

## 11. Indicadores e relatórios

O BDEX pode gerar:

- Total de demandas abertas, finalizadas e pendentes.
- Demandas por agente.
- SLA operacional.
- Faturamento por período.
- Custos, margem e saldo previsto.
- Contas a pagar e receber.
- Vouchers emitidos por empresa.
- Viagens em campo.
- Alertas de check-in/check-out.
- Ranking de empresas.
- Relatórios por agente e por empresa.
- Indicadores ESG/pegada de carbono.
- Logs de auditoria e integração.

## 12. Segurança e confiabilidade

O sistema possui controle de acesso por usuário, perfil e permissão. As APIs internas podem exigir sessao autenticada. A estrutura tambem inclui logs de auditoria, logs de integração, controle de permissões da IA BIA e separacao de acessos entre usuário interno e empresa/solicitante.

Boas praticas previstas:

- Uso de HTTPS em produção.
- Variaveis de ambiente para segredos.
- PostgreSQL para armazenamento centralizado.
- Backup diario automatico.
- Snapshot semanal do servidor.
- Firewall e Nginx.
- Controle de acesso por perfil.
- Auditoria de eventos.
- Politica LGPD a confirmar.

## 13. Implantação

A implantação recomendada usa:

| Recurso | Recomendacao |
|---|---|
| Sistema operacional | Ubuntu Server 24.04 LTS 64-bit |
| Memoria | 16 GB RAM |
| CPU | 6 a 8 vCPU |
| Disco | 250 GB NVMe SSD |
| Banco | PostgreSQL |
| Web server | Nginx |
| Runtime | Node.js LTS, minimo 20.9+ |
| Extras | SSL/HTTPS, firewall, backup diario e snapshot semanal |

Etapas de implantação:

1. Preparar servidor.
2. Instalar Node.js, PostgreSQL, Nginx e Certbot.
3. Configurar banco de dados.
4. Configurar variaveis de ambiente.
5. Executar build do sistema.
6. Configurar serviço systemd.
7. Ativar Nginx e SSL.
8. Criar usuário administrador.
9. Testar login, dashboards, IA, Wintour, Tech Travel e financeiro.
10. Liberar acesso para equipe piloto.

## 14. Suporte e manutenção

Contato informado:

| Canal | Informação |
|---|---|
| WhatsApp/telefone | 62-994330797 |
| E-mail | BDEXTECNOLOGIA@GMAIL.COM |

O modelo de suporte final, SLA formal, horarios e plano de manutenção devem ser confirmados antes da publicação comercial definitiva.

## 15. Pendências de confirmação

- Dominio de produção.
- Provedor financeiro real de Pix, carteira e cartoes.
- Credenciais e escopo contratado da Tech Travel.
- Webhook e credenciais Evolution API.
- Politica final de permissões da IA BIA.
- Retenção LGPD e politica de backup.
- Logo oficial em alta resolução.

## 16. Conclusão

O BDEX posiciona a BBT Corporate para operar viagens corporativas com mais controle, rastreabilidade e inteligencia. A proposta central é transformar demandas dispersas em uma operação integrada, conectando solicitações, reservas, vouchers, Wintour, financeiro, relatórios e IA em um único ambiente.

Com a Tech Travel como hub de fornecedores e a IA BIA como camada inteligente de apoio operacional, o sistema cria uma base solida para uma operação escalavel, organizada e preparada para evoluir para um SaaS corporativo.
