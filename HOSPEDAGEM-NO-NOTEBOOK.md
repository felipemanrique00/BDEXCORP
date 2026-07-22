# Hospedagem restrita no Windows com Tailscale

Este caminho preserva o acesso restrito ja projetado para o notebook, mas agora exige PostgreSQL real. Ele nao usa JSON local, senha mestre fixa ou usuario de demonstracao.

Para producao publica e crescimento SaaS, prefira o caminho Linux/Docker documentado em `docs/DEPLOYMENT-SERVER.md`.

## Arquitetura

```text
Usuario autorizado
  -> Tailscale (identidade do tailnet)
  -> Tailscale Serve HTTPS
  -> 127.0.0.1:3004
  -> Next.js em modo production
  -> PostgreSQL privado
  -> .bbt-storage/files (PDFs privados)
```

O Tailscale Funnel nao deve ser habilitado. A porta 3004 permanece vinculada ao loopback e nao deve ser aberta no roteador ou firewall da LAN.

## Pre-requisitos

- Node.js 22 LTS.
- PostgreSQL 16 local privado ou gerenciado com TLS.
- Cliente PostgreSQL com `pg_dump.exe` e `pg_restore.exe` no PATH.
- `tar.exe` no PATH.
- Tailscale instalado e autenticado.
- Build e testes aprovados.

## Configuracao

Crie `.env.production.local` sem versionar e configure ao menos:

```dotenv
APP_URL=http://127.0.0.1:3004
APP_VERSION=windows-managed
ALLOW_INSECURE_LOCALHOST=true
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/BANCO
MIGRATION_DATABASE_URL=postgresql://USUARIO_ADMIN:SENHA@HOST:5432/BANCO
DATABASE_APP_ROLE=USUARIO
DATABASE_APP_PASSWORD=SENHA_ALEATORIA_DO_USUARIO_DA_APLICACAO
DATABASE_SSL=false
AUTH_SECRET=SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
STORAGE_ROOT=C:\CAMINHO_DO_PROJETO\.bbt-storage\files
```

Nao reutilize os valores ilustrativos. Proteja o arquivo com ACL do usuario do servico.

O script abaixo valida PostgreSQL e gera `AUTH_SECRET` sem exibi-lo quando necessario:

```powershell
.\deploy\windows\configure-production-env.ps1 -DatabaseUrl 'postgresql://...' -SkipRestart
```

Depois execute:

```powershell
node --env-file=.env.production.local scripts\validate-environment.mjs
node --env-file=.env.production.local scripts\migrate.mjs up
```

Para o primeiro tenant, preencha temporariamente `BOOTSTRAP_*` no arquivo privado e execute:

```powershell
node --env-file=.env.production.local scripts\bootstrap.mjs
```

Apague `BOOTSTRAP_ADMIN_PASSWORD` do arquivo depois do sucesso.

## Build e servico

```powershell
npm.cmd run validate
.\deploy\windows\test-deployment.ps1
.\deploy\windows\install-autostart.ps1
.\deploy\windows\server.cmd start
.\deploy\windows\server.cmd health
```

O supervisor usa `/api/ready`; ele considera a aplicacao pronta apenas quando o banco responde e todas as migrations obrigatorias estao aplicadas.

## Tailscale Serve

Com a aplicacao pronta:

```powershell
.\deploy\windows\configure-tailscale.ps1
tailscale serve status
```

O resultado precisa indicar acesso apenas pelo tailnet. Depois de receber a URL HTTPS, execute novamente `configure-production-env.ps1` com `-AppUrl` para retirar a excecao HTTP local.

O acesso exige duas camadas independentes:

1. identidade e politica do Tailscale;
2. usuario, membership e permissao no BDEX.

Revogar uma camada nao substitui a revogacao da outra.

## Operacao

No diretorio `deploy\windows`:

```bat
server.cmd status
server.cmd start
server.cmd stop
server.cmd restart
server.cmd health
server.cmd logs
server.cmd backup
server.cmd test
```

Logs ficam em `.server-runtime\logs` e backups em `.server-backups`. Ambos sao ignorados pelo Git e recebem ACL restrita.

## Backup

```powershell
.\deploy\windows\backup-server.ps1 -Reason manual
.\deploy\windows\restore-server.ps1 `
  -BackupPath '.server-backups\backup-AAAAMMDD-HHMMSS-manual' `
  -VerifyOnly
```

O backup inclui dump PostgreSQL, arquivos privados, manifesto e hashes SHA-256. A copia no mesmo notebook nao protege contra perda fisica; replique o diretorio de forma criptografada para outro destino.

## Restore

Primeiro valide uma copia em PostgreSQL isolado. O comando de restauracao operacional substitui o banco configurado e os arquivos privados, exige `-ConfirmRestore` e cria um backup `pre_restore` antes de agir:

```powershell
.\deploy\windows\restore-server.ps1 `
  -BackupPath '.server-backups\backup-AAAAMMDD-HHMMSS-manual' `
  -ConfirmRestore
```

Nao execute restore sobre dados reais sem janela de manutencao, validacao do backup e plano de retorno.

## Estado de liberacao

Esta alternativa recebe GO somente depois de existirem evidencias locais de:

- PostgreSQL e migrations;
- bootstrap sem credencial padrao;
- readiness;
- login e permissao;
- persistencia apos reinicio;
- upload e download;
- backup e restore isolado;
- Tailscale Serve sem Funnel.

Sem essas evidencias, o status permanece NO-GO para uso com dados reais.
