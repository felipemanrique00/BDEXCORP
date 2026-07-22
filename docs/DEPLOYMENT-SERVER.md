# Implantacao em servidor

## Referencia

O piloto de referencia usa um unico servidor Linux com Docker Compose, Caddy, Next.js, PostgreSQL e volumes persistentes. O banco nao publica porta no host.

## Capacidade inicial

- Ubuntu Server 24.04 LTS atualizado.
- 4 vCPU, 8 GB RAM e 80 GB SSD como ponto inicial, ajustado por medicao.
- Espaco separado ou monitorado para banco, arquivos, backups e imagens.
- Docker Engine e Compose v2 suportados.
- Dominio e e-mail para ACME.
- Destino externo criptografado para backups.

## DNS e rede

1. Crie registro A/AAAA do dominio para o servidor.
2. Libere entrada somente em 22 (SSH restrito), 80 e 443.
3. Nao publique 3000 ou 5432.
4. Restrinja SSH por IP/VPN quando possivel.
5. Confirme sincronizacao NTP antes de emitir certificados.

## Hardening do host

- Crie usuario de deploy sem login direto como root.
- Use chave SSH; desative senha e root remoto depois de validar acesso alternativo.
- Habilite firewall e atualizacoes automaticas de seguranca.
- Use fail2ban ou controle equivalente para SSH.
- Restrinja `.env.production` a modo 600.
- Nao adicione o usuario da aplicacao ao grupo Docker sem entender o privilegio equivalente a root.
- Monitore disco, memoria, CPU, reinicios, certificado e disponibilidade externa.

Essas configuracoes dependem de acesso ao servidor e nao foram aplicadas por este repositorio.

## Preparar ambiente

```bash
git clone <repositorio> /opt/bbt-corporativo
cd /opt/bbt-corporativo
cp .env.example .env.production
chmod 600 .env.production
```

Preencha dominio, banco, segredo de sessao e credenciais necessarias. `MIGRATION_DATABASE_URL` usa a conta administrativa; `DATABASE_URL` usa `DATABASE_APP_ROLE`, sem superusuario e sem `BYPASSRLS`. Use uma tag imutavel em `APP_VERSION`, nunca apenas `latest`.

```bash
node scripts/validate-environment.mjs --env-file=.env.production
docker compose --env-file .env.production -f docker-compose.production.yml config >/dev/null
```

## Primeira implantacao

O script de release valida codigo, migrations, inventario, segredos, lint, tipos, testes e build antes de tocar nos containers. Depois cria backup, constroi imagem, aplica migrations e executa smoke tests.

```bash
ENV_FILE=.env.production ./scripts/release.sh
```

Crie o primeiro tenant uma unica vez:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile bootstrap run --rm bootstrap
```

Remova `BOOTSTRAP_ADMIN_PASSWORD` do arquivo e do historico operacional depois do sucesso. O comando recusa senha fraca e nao imprime o valor.

## Verificacao

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
node --env-file=.env.production scripts/smoke-test.mjs
curl --fail https://SEU_DOMINIO/api/health
curl --fail https://SEU_DOMINIO/api/ready
```

Teste manualmente com contas de papeis diferentes:

- login e logout;
- tenant correto;
- empresa/grupo permitido e negado;
- criacao e persistencia de registro;
- reinicio do `app` e nova consulta;
- upload, download e exclusao de PDF;
- convite e recuperacao por SMTP;
- relatorio cliente sem markup;
- integracoes realmente habilitadas.

## Volumes

- `postgres_data`: dados do PostgreSQL.
- `app_files`: PDFs privados.
- `backup_data`: backups locais.
- `caddy_data` e `caddy_config`: certificados e estado do proxy.
- `restore_validation_files`: destino isolado de testes de restore.

Inclua esses nomes no inventario operacional. Nao use `docker compose down -v` em producao.

## Atualizacao

1. Revise a release e migration.
2. Garanta que `APP_VERSION` identifica a nova imagem.
3. Confirme espaco e destino externo de backup.
4. Execute `scripts/release.sh`.
5. Monitore logs, readiness, erros e uso por pelo menos 30 minutos.

As migrations devem seguir expandir/contrair. O rollback de imagem nao desfaz schema automaticamente.

## Rollback

```bash
PREVIOUS_APP_VERSION=<tag-anterior> \
ENV_FILE=.env.production \
./scripts/rollback.sh
```

Se a imagem estiver apenas em registry, defina `ROLLBACK_PULL=true`. Se a migration nao for retrocompativel, interrompa o rollback de imagem e siga `BACKUP-RESTORE.md` durante uma janela aprovada.

## PostgreSQL gerenciado

O codigo aceita PostgreSQL gerenciado por `DATABASE_URL` e `DATABASE_SSL`. O Compose de referencia inclui PostgreSQL local para o piloto de servidor unico. Antes de remover o servico local, valide uma composicao de infraestrutura especifica que preserve migrations, backup, restore e dependencias; essa troca ainda nao foi executada neste ambiente.

## Logs e monitoramento

Os containers escrevem logs estruturados em stdout. Configure coleta externa, retencao e alertas para:

- `/api/ready` indisponivel;
- HTTP 5xx;
- latencia p95;
- falha de login anormal;
- conexoes e locks PostgreSQL;
- disco acima de 75%/85%;
- memoria e reinicios;
- idade do ultimo backup valido;
- expiracao do certificado;
- falha de SMTP/Tech/IA/WhatsApp.

Sem alertas externos e restauracao validada, a implantacao permanece NO-GO para dados reais.
