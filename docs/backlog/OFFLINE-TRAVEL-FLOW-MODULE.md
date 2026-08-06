# Demanda — fluxo offline multisserviço

Status: `DIAGNÓSTICO / IMPLEMENTAÇÃO LOCAL PENDENTE`
Registrada em: `2026-08-03`
Regra de publicação: `local > Git staging > VPS staging > aprovação > produção Git > produção VPS`.

## Objetivo

Implementar um fluxo operacional offline completo para reservas e emissões feitas
fora de integrações automáticas, sem restringi-lo à hotelaria. O registro manual
deve utilizar o mesmo domínio relacional, lifecycle, auditoria e governança das
operações integradas.

## Serviços abrangidos

- aéreo;
- hotelaria;
- locação de veículos;
- rodoviário;
- ferroviário;
- transfer;
- seguro viagem;
- pacotes e lazer;
- marítimo e demais serviços futuros cadastrados no catálogo.

O núcleo não deve possuir regras fechadas apenas para os serviços atuais. Novos
tipos devem entrar por contratos/adaptadores de serviço e schemas específicos.

## Fluxo comum obrigatório

`demanda aprovada > reserva offline iniciada > reserva confirmada > emissão
offline registrada > voucher/documento > financeiro > notificações`

Quando determinado produto não possuir uma separação operacional entre reserva
e emissão, a interface poderá concluir ambas em uma única ação, mas o backend
deverá registrar as duas transições e suas evidências de forma consistente.

## Núcleo relacional

- criar registros em `reservations` e `travel_emissions` também para canal
  `manual/offline`;
- vincular sempre tenant, empresa, demanda, viajante/funcionário e operador;
- avançar o `lifecycle_status` pela mesma máquina de estados governada;
- registrar confirmação humana, data/hora, origem, observação e evidências;
- usar idempotência, controle de versão e auditoria em todas as transições;
- gerar voucher como consequência da emissão, por evento/outbox, mantendo vínculo
  com demanda, reserva e emissão;
- sincronizar financeiro e notificações sem depender do armazenamento legado;
- suportar emissão parcial, múltiplos passageiros/itens, cancelamento, reemissão e
  remarcação.

## Evidências por serviço

- **Aéreo:** companhia, localizador, bilhete, trechos, voos, classe e datas.
- **Hotel:** fornecedor, número de confirmação, período, acomodação e regime.
- **Carro:** locadora, confirmação, categoria, retirada e devolução.
- **Rodoviário/ferroviário:** transportadora, bilhete/localizador, rota, horário e
  assento quando aplicável.
- **Transfer:** fornecedor, confirmação, origem, destino, data e passageiros.
- **Seguro:** seguradora, apólice/certificado, vigência e segurados.
- **Pacotes/outros:** componentes contratados, fornecedor, confirmação, período e
  documentação configurável.

## Isolamento arquitetural

- implementar como módulo de domínio próprio, por exemplo `offline-travel`, com
  fachada pública e contratos tipados;
- compartilhar a máquina de estados do domínio de viagens, sem duplicá-la;
- isolar campos específicos em schemas/adaptadores por serviço;
- proibir gravações diretas em `app_kv`/storage legado;
- proteger a ativação por feature flag e tenant;
- não alterar conectores online existentes fora dos contratos compartilhados.

## Critérios mínimos de aceite

1. Teste integrado para cada família de serviço suportada.
2. Teste ponta a ponta `demanda > reserva offline > emissão offline > voucher`.
3. Coerência transacional entre demanda, reserva, emissão, voucher e financeiro.
4. Retentativa idempotente sem duplicar reserva, emissão ou voucher.
5. Escopo multitenant/RLS e permissões `operar_reservas` e `operar_emissoes`.
6. Evidências e trilha de auditoria disponíveis na ficha da demanda.
7. Nenhuma publicação em staging antes da validação funcional local.
