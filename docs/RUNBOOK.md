# Runbook operacional

## Aplicacao fora do ar

1. Verifique DNS, certificado e `docker compose ps`.
2. Consulte `/api/health` e `/api/ready` separadamente.
3. Leia logs de `caddy`, `app`, `migrate` e `postgres` pelo request ID.
4. Confirme disco, memoria e reinicios.
5. Se a release causou a falha, execute rollback de imagem versionada.
6. Nao reinicie em loop sem identificar banco, migration ou configuracao.

## Banco indisponivel

1. `/api/health` pode responder enquanto `/api/ready` retorna 503.
2. Verifique container/servico, volume, conexoes, disco e credenciais.
3. Nao execute bootstrap ou migration repetidamente para mascarar falha.
4. Se houver corrupcao, feche escrita e siga `BACKUP-RESTORE.md`.

## Disco cheio

1. Pare importacoes e uploads.
2. Identifique uso em volumes, logs, imagens e backups.
3. Preserve o backup valido mais recente.
4. Remova somente artefatos confirmadamente regeneraveis ou expirados.
5. Expanda disco e valide PostgreSQL antes de reiniciar.

## Certificado expirado

1. Confirme DNS, portas 80/443 e logs do Caddy.
2. Verifique horario do servidor e permissao do volume `caddy_data`.
3. Nao contorne com HTTP publico ou desative validacao TLS.
4. Repare ACME e confirme renovacao automatica.

## Integracao externa falhando

1. Consulte status sem exibir credenciais.
2. Verifique timeout, DNS, certificado, quota e contrato do fornecedor.
3. Desabilite a integracao se ela estiver retornando resultado inconsistente.
4. Mantenha a operacao pendente/erro; nunca registre sucesso manual automatico.
5. Para Tech transacional, nao repita emissao sem idempotencia e consulta de status.

## Erro apos deploy

1. Interrompa novas liberacoes.
2. Guarde logs, tag, horario e migrations aplicadas.
3. Se schema for retrocompativel, use `PREVIOUS_APP_VERSION` no rollback.
4. Se schema nao for retrocompativel, mantenha indisponibilidade controlada e restaure conforme plano aprovado.
5. Execute smoke, login e persistencia depois da recuperacao.

## Restauracao

Use somente backup previamente validado. Registre RPO real, RTO real, contagens e responsavel. Compare arquivos ativos com metadados antes de liberar.

## Credencial comprometida

1. Revogue/rotacione no fornecedor.
2. Atualize secret store sem registrar valor em ticket.
3. Reinicie somente os servicos consumidores.
4. Revogue sessoes quando `AUTH_SECRET`, senha ou cookie puder ter vazado.
5. Consulte auditoria e logs pelo periodo.
6. Avalie obrigacoes de notificacao com seguranca e juridico.

## SMTP indisponivel

Convites e recuperacao ficam bloqueados. Nao entregue senha por e-mail manual. Restaure SMTP, reenvie convite de uso unico e verifique auditoria.

## Backup atrasado

Se a idade exceder o RPO, suspenda mudancas de alto risco, corrija o job, gere novo backup, replique externamente e valide restore.

## Escalonamento minimo

Cada incidente deve registrar severidade, inicio, impacto, tenants afetados, request IDs, versao, decisao, responsavel, recuperacao e acao preventiva. Nunca inclua senha, token, documento pessoal completo ou corpo integral de arquivo.
