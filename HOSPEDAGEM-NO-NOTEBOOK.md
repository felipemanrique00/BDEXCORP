# Hospedagem do BBT Corporativo no notebook

## Estado da implantação

- **Modo escolhido:** `INTERNET_RESTRITO`.
- **Sistema operacional:** Windows 11 Home Single Language, versão 25H2, build 26200.8875.
- **Aplicação:** Next.js 15.5.18, React 18, TypeScript e Node.js 24.15.0.
- **Servidor interno:** build de produção do Next.js, em `http://127.0.0.1:3004`.
- **URL HTTPS restrita:** `https://desktop-7v6b4l6.tailb77fa4.ts.net`, publicada somente dentro do tailnet pelo Tailscale Serve.
- **Banco/armazenamento atual:** arquivo local `.bbt-storage/app-kv.json`, com gravação atômica e fila de mutações no processo.
- **Inicialização automática:** Tarefa Agendada `BBT-Corporativo-Servidor`, no logon do usuário Felipe Manrique.
- **Backup automático:** Tarefa Agendada `BBT-Corporativo-Backup`, diariamente às 02:00, com execução posterior se o horário for perdido.
- **Firewall criado pelo projeto:** nenhum. A porta 3004 permanece vinculada somente ao localhost.

Nenhuma tela, rota, API, integração ou regra de negócio foi removida nesta implantação.

## 1. Arquitetura

```text
Usuário autorizado
  -> Tailscale (identidade + criptografia do tailnet)
  -> HTTPS do Tailscale Serve
  -> 127.0.0.1:3004
  -> Next.js em produção
  -> storage local privado .bbt-storage/app-kv.json
```

O serviço não escuta em `0.0.0.0`, não publica o IP residencial e não exige abertura de porta no roteador. O login interno do BBT continua obrigatório mesmo depois da autorização no tailnet.

## 2. Por que Tailscale Serve

O Tailscale já está instalado e autenticado neste notebook. O Serve fornece HTTPS dentro do tailnet, usa identidade e respeita as regras de acesso do Tailscale. A configuração persistente usa `--bg`, portanto volta após reinício do Tailscale ou do Windows.

Documentação oficial:

- [Instalar no Windows](https://tailscale.com/docs/install/windows)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Comando `tailscale serve`](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Controles de acesso](https://tailscale.com/docs/features/access-control)

O Tailscale Funnel não é usado, porque ele tornaria o serviço público.

## 3. URLs e portas

| Item | Valor |
|---|---|
| Aplicação interna | `http://127.0.0.1:3004` |
| Health check | `http://127.0.0.1:3004/api/health` |
| URL HTTPS restrita | `https://desktop-7v6b4l6.tailb77fa4.ts.net` |
| PostgreSQL | não configurado nesta implantação |
| Redis/filas | não existem |

Somente a porta HTTPS do Tailscale será acessível no tailnet. A porta 3004 não é aberta na LAN ou na internet.

## 4. Comandos de operação

Execute no diretório `deploy\windows`:

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

Os scripts PowerShell também podem ser chamados diretamente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\status-server.ps1
```

O `ExecutionPolicy Bypass` vale somente para aquele processo. A política global do Windows não foi alterada.

## 5. Inicialização e recuperação automática

O supervisor está em `deploy\windows\run-server.ps1` e garante:

- apenas uma instância por vez, por mutex local;
- diretório de trabalho correto;
- `NODE_ENV=production`;
- binding exclusivo em `127.0.0.1:3004`;
- health check durante a inicialização;
- reinício automático com espera progressiva, limitada a 60 segundos;
- reinício após três falhas consecutivas do health check;
- recusa em encerrar um PID que não corresponda ao estado gravado;
- parada controlada por arquivo-sinal;
- retorno automático no próximo logon do Windows.

O Task Scheduler também tenta reiniciar o supervisor se o próprio PowerShell falhar.

Para reinstalar as tarefas de forma idempotente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\install-autostart.ps1
```

## 6. Logs

Diretório: `.server-runtime\logs`

- `application-out.log`: saída normal do Next.js;
- `application-error.log`: erros da aplicação;
- `supervisor.log`: início, parada, falhas de saúde e reinícios;
- `tailscale-install.log`: somente quando o instalador MSI é executado.

Cada fluxo gira ao atingir 10 MB. São mantidos até 10 arquivos antigos por fluxo. Os logs não devem receber senhas, cookies, tokens ou corpos de requisição.

Uso:

```powershell
.\deploy\windows\server.cmd logs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\logs-server.ps1 -Stream error -Tail 200
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\logs-server.ps1 -Stream supervisor -Follow
```

## 7. Saúde e diagnóstico

```bat
server.cmd health
server.cmd status
```

O health check público informa somente estado da aplicação e do armazenamento. Versão do Node, ambiente e mensagens internas do banco não são devolvidos ao cliente.

O status mostra PID, memória aproximada, tarefa automática, URL interna, URL restrita quando configurada, diretórios de logs e backups.

## 8. Dados persistentes

Arquivo atual:

```text
.bbt-storage\app-kv.json
```

A variável `BBT_STORAGE_FILE` aponta explicitamente para esse arquivo em `.env.production.local`. O arquivo não fica em `public`, não é servido pelo Next.js e está ignorado pelo Git.

O storage local usa escrita em arquivo temporário, `fsync`, troca atômica e serialização de mutações dentro de um processo. Isso protege contra gravação parcial, mas não transforma JSON em banco multiusuário. Para concorrência elevada, a migração planejada é PostgreSQL, com teste e backup prévios; ela não foi feita automaticamente.

## 9. Backups

Diretório privado:

```text
.server-backups\
```

Política atual:

- backup diário às 02:00;
- retenção padrão de 14 dias para backups `backup-*`;
- nomes com data, hora e motivo;
- cópia estável com hash SHA-256 antes/depois;
- manifesto JSON com tamanho e hash de cada arquivo;
- ACL limitada ao proprietário do projeto e `SYSTEM` nos backups criados pela tarefa;
- `.env` permanece somente em backup local privado e nunca é versionado.

Backup manual:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\backup-server.ps1 -Reason manual
```

Validar um backup sem restaurar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\restore-server.ps1 `
  -BackupPath ".server-backups\backup-AAAAMMDD-HHMMSS-manual" `
  -VerifyOnly
```

O backup local protege contra erro de aplicação, mas não contra perda física do notebook. Uma segunda cópia criptografada em outro dispositivo deve ser adotada depois de escolher o destino e a política de acesso.

## 10. Restauração

Uma restauração real exige confirmação explícita:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\restore-server.ps1 `
  -BackupPath ".server-backups\backup-AAAAMMDD-HHMMSS-manual" `
  -ConfirmRestore
```

O script:

1. valida todos os hashes;
2. cria um novo backup `pre_restore`;
3. para o servidor, se necessário;
4. restaura somente destinos permitidos;
5. verifica a cópia;
6. reinicia e testa a aplicação.

O teste executado nesta implantação usou `-VerifyOnly`; nenhum dado foi sobrescrito.

## 11. Usuários autorizados

Existem duas camadas independentes.

### Tailscale

1. Adicione a pessoa no painel administrativo do tailnet.
2. Mescle e revise `deploy\windows\tailscale-grants-snippet.hujson` na política existente.
3. Substitua os e-mails de exemplo.
4. Aplique a tag `tag:bbt-servidor` a este notebook.
5. Permita somente `tcp:443` para `group:bbt-usuarios`.

Para remover ou revogar acesso, retire a pessoa do grupo/política ou do tailnet. A revogação no Tailscale impede chegar à tela de login.

### BBT Corporativo

Cadastre, inative e ajuste permissões em **Administração > Usuários e permissões**. Remover alguém do Tailscale não substitui a inativação da conta no sistema, e vice-versa.

## 12. URL HTTPS restrita

O Tailscale Serve está ativo e encaminha somente o tráfego HTTPS do tailnet para `http://127.0.0.1:3004`. O Tailscale informa o serviço como `tailnet only`; Funnel permanece desligado.

O comando abaixo é idempotente e pode ser executado novamente para reparar ou reaplicar a configuração:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\configure-tailscale.ps1
```

O script verifica a saúde local, executa somente:

```text
tailscale serve --bg --yes http://127.0.0.1:3004
```

Em seguida grava a URL em `.server-runtime\tailscale.json`, atualiza `APP_URL`, cria backup da configuração e reinicia a aplicação. Ele não usa Funnel e não compartilha arquivos do notebook.

Para conferir a publicação:

```powershell
tailscale serve status
```

O resultado esperado contém `tailnet only` e o proxy `http://127.0.0.1:3004`.

Para alterar a URL, altere o nome do dispositivo/DNS no Tailscale, execute novamente o script e valide os callbacks externos que dependam da URL.

## 13. Credencial administrativa

A senha curta encontrada na configuração de produção foi rotacionada para uma credencial aleatória forte. Ela não está na documentação nem nos logs.

Entrega local temporária:

```text
.server-runtime\private\LEIA-SENHA-INICIAL-SUPER-MASTER.txt
```

O proprietário deve guardar essa senha em um gerenciador e apagar o arquivo de entrega. `NEXT_PUBLIC_BBT_DEV_MASTER_PASSWORD` foi removida do ambiente de produção.

## 14. Segurança HTTP e sessão

- sessão assinada por HMAC SHA-256, com `AUTH_SECRET` obrigatório em produção;
- cookie `HttpOnly`, `SameSite=Lax` e `Secure` quando acessado por HTTPS;
- sessão com duração máxima de 12 horas;
- senhas operacionais persistidas com `scrypt`;
- APIs sensíveis protegidas por sessão, perfil/permissão e limites de requisição;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: SAMEORIGIN`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- HSTS por 180 dias no acesso HTTPS;
- `X-Powered-By` desativado;
- health check com `Cache-Control: no-store`.

## 15. Atualização segura do sistema

1. Faça backup.
2. Pare o serviço.
3. Preserve `.env.production.local`, `.bbt-storage` e `.server-backups`.
4. Aplique somente as mudanças revisadas de código.
5. Execute `npm install` apenas se `package.json` ou o lockfile tiverem mudado.
6. Execute `npm run validate` e aguarde o `next build` terminar de verdade.
7. Inicie o serviço.
8. Rode `server.cmd health` e teste login, relatórios e integrações.

Comandos:

```bat
server.cmd backup
server.cmd stop
npm.cmd run validate
server.cmd start
server.cmd health
```

## 16. Rollback

Teste não destrutivo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\rollback-server.ps1 -WhatIf
```

Rollback operacional:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\rollback-server.ps1 -DisableTunnel
```

Para também restaurar os arquivos de configuração anteriores à implantação:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\rollback-server.ps1 `
  -DisableTunnel `
  -RestorePreDeployConfiguration
```

O rollback para o servidor, remove somente as duas tarefas registradas pelo projeto e reseta o Serve somente quando existir o marcador do projeto. Código, dados, logs e backups são preservados.

## 17. Configurações do Windows

Alterações realizadas:

- criação de `BBT-Corporativo-Servidor` no Task Scheduler;
- criação de `BBT-Corporativo-Backup` no Task Scheduler;
- ACL restrita em `.server-runtime` e `.server-backups`;
- nenhuma regra de firewall;
- nenhuma porta no roteador;
- nenhuma alteração permanente no ExecutionPolicy;
- nenhuma alteração no antivírus, bloqueio de tela ou Windows Update;
- nenhuma alteração de plano de energia.

O notebook já estava configurado para não suspender nem hibernar em energia AC ou bateria. O comportamento ao fechar a tampa não foi alterado; mantenha a tampa aberta ou valide essa opção manualmente antes de depender do serviço.

## 18. Disponibilidade e limitações

O sistema ficará indisponível quando:

- o notebook estiver desligado ou sem usuário logado;
- o Windows estiver suspenso;
- faltar energia e a bateria acabar;
- a internet ou o Wi-Fi cair;
- o Tailscale for desconectado;
- o processo for parado pelo operador.

Limitações desta hospedagem:

- não há redundância de máquina, energia ou internet;
- a tarefa do servidor inicia após o logon, não antes dele;
- o storage JSON é adequado a baixa concorrência, não a alta carga multiusuário;
- o backup permanece no mesmo disco até ser aprovado um destino externo;
- acesso por Tailscale exige cliente Tailscale nos dispositivos autorizados;
- a validação de bloqueio de uma identidade não autorizada exige um segundo dispositivo ou usuário de teste fora do grupo permitido.

## 19. Validações executadas

- testes de domínio: aprovado;
- ESLint: aprovado, sem warnings de código;
- TypeScript: aprovado;
- build de produção: aprovado;
- health check: aprovado;
- bind somente em `127.0.0.1`: aprovado;
- API de storage sem sessão: `401`;
- login administrativo: `200`;
- sessão autenticada e leitura do storage: aprovado;
- logout e invalidação da sessão: aprovado;
- headers de segurança: aprovado;
- reinício automático após encerrar o Node: aprovado, com novo PID;
- stop/start operacional: aprovado;
- backup manual e agendado: aprovado;
- manifesto e hashes de backup: aprovado;
- restauração `-VerifyOnly`: aprovado;
- dashboard, empresas, grupos e relatórios no navegador: aprovados;
- layout mobile de 390 px sem overflow horizontal: aprovado;
- console do navegador: sem erros nas rotas testadas;
- HTTPS pelo Tailscale Serve: aprovado (`200` em health e login);
- proxy restrito ao tailnet e Funnel desligado: aprovado;
- cookie de sessão por HTTPS com `Secure`, `HttpOnly` e `SameSite=Lax`: aprovado;
- acesso ao storage sem sessão pela URL HTTPS: `401`;
- login, sessão autenticada, storage e logout pela URL HTTPS: aprovados;
- sessão HTTPS preservada após reinício controlado do servidor: aprovado;
- negação por identidade em um segundo dispositivo fora do grupo: pendente de usuário/dispositivo de teste.

## 20. Auditoria de dependências

O `npm audit --audit-level=moderate` encontrou quatro avisos moderados transitivos em ferramentas de build (`brace-expansion`, `js-yaml` e o `postcss` empacotado pelo Next.js). A correção total sugerida pelo npm exige `--force` e mudança incompatível de Next.js; ela não foi aplicada automaticamente. Não foram encontradas vulnerabilidades classificadas como altas ou críticas nesse comando.

## 21. Checklist após reiniciar o notebook

1. Entre no Windows com o usuário Felipe Manrique.
2. Aguarde até 60 segundos.
3. Execute `deploy\windows\server.cmd status`.
4. Confirme `Saude: OK`.
5. Abra a URL HTTPS do Tailscale em outro dispositivo autorizado.
6. Confirme que um usuário fora do grupo não acessa.
7. Faça login e logout no BBT.
8. Abra um relatório e confirme os assets, gráficos e mapa.

Esse teste de reboot não foi forçado durante a implantação para não interromper o trabalho do notebook.
