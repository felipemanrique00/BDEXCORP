# Manual completo de hospedagem e logins

Este manual descreve o caminho oficial para colocar o **BDEX / BBT Corporativo** em produção em um servidor Linux, criar o primeiro administrador e liberar acessos individuais para equipe, empresas e grupos.

O procedimento foi escrito para a versão localizada em:

```text
C:\Users\Felipe Manrique\Documents\New project\BDEX_PRODUCAO_SAAS
```

No servidor, o diretório sugerido é:

```text
/opt/bbt-corporativo
```

## 1. O que será instalado

A implantação oficial usa:

- Ubuntu Server 24.04 LTS;
- Docker Engine e Docker Compose v2;
- aplicação Next.js em container;
- PostgreSQL 16 em rede privada;
- Caddy como proxy HTTPS;
- volumes persistentes para banco, arquivos e certificados;
- migrations versionadas;
- backup do banco e dos arquivos privados.

Fluxo de acesso:

```text
Internet
  -> domínio HTTPS
  -> Caddy nas portas 80/443
  -> aplicação Next.js na rede privada
  -> PostgreSQL na rede privada
```

As portas `3000` e `5432` não devem ser publicadas na internet.

> Não misture esta implantação com os arquivos antigos de Nginx/systemd existentes em `deploy/nginx` e `deploy/systemd`. Para esta versão, o caminho oficial é `docker-compose.production.yml` com Caddy.

## 2. O que precisa estar pronto antes

Providencie:

1. Um VPS com Ubuntu Server 24.04 LTS.
2. Recomendação inicial: 4 vCPU, 8 GB de RAM e 80 GB SSD.
3. Um domínio ou subdomínio, por exemplo `corporativo.suaempresa.com.br`.
4. Acesso SSH administrativo ao servidor.
5. A URL do repositório Git e o nome da branch que será publicada, ou o ZIP final.
6. Um e-mail administrativo para emissão do certificado HTTPS.
7. Um serviço SMTP para convites e recuperação de senha.
8. Um destino externo para cópia criptografada dos backups.
9. Um gerenciador de senhas para guardar as credenciais de produção.

Antes de começar, defina estes dados:

| Informação | Exemplo de formato |
| --- | --- |
| Domínio | `corporativo.suaempresa.com.br` |
| URL completa | `https://corporativo.suaempresa.com.br` |
| Nome do tenant inicial | Nome da organização operadora |
| Identificador do tenant | Letras minúsculas, números e hífens |
| Administrador inicial | Nome e e-mail individual |
| Branch de produção | Branch que contém esta versão |
| Plano inicial | Nome e chave interna do plano |

Não use nomes genéricos como `admin`, `diretoria` ou `secretaria` como conta compartilhada. Cada pessoa deve ter seu próprio e-mail, senha, sessão e trilha de auditoria.

## 3. Configurar o DNS

No provedor do domínio, crie:

- registro `A` apontando o domínio para o IPv4 público do VPS;
- registro `AAAA` somente se o VPS tiver IPv6 configurado e acessível.

Exemplo conceitual:

```text
Tipo: A
Nome: corporativo
Valor: IP_PUBLICO_DO_SERVIDOR
TTL: 300 ou automático
```

Confirme a resolução antes da primeira publicação:

```bash
dig +short corporativo.suaempresa.com.br
```

O resultado deve ser o IP do servidor. Um registro `AAAA` incorreto pode impedir a emissão do certificado HTTPS.

## 4. Acessar e preparar o servidor

Todos os comandos desta seção são executados no servidor Linux.

Entre por SSH:

```bash
ssh USUARIO@IP_DO_SERVIDOR
```

Atualize o sistema e instale as ferramentas básicas:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg git unzip openssl ufw
sudo timedatectl set-timezone America/Sao_Paulo
```

Configure o firewall:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
sudo ufw status
```

Não libere `3000/tcp` nem `5432/tcp`.

Recomendações mínimas de segurança:

- use chave SSH;
- depois de validar a chave, desative login remoto do root e autenticação SSH por senha;
- ative MFA no provedor do VPS, GitHub e e-mail;
- use um usuário de implantação dedicado;
- mantenha atualizações de segurança do Ubuntu ativas.

## 5. Instalar Docker Engine e Compose

Use o repositório oficial do Docker:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

O script de release também executa validações Node.js no host. Instale Node.js 22 LTS e confirme npm 10 ou compatível. O instalador usado pelo projeto é:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

O resultado de `node --version` deve começar com `v22`.

Para executar Docker sem `sudo`, é possível adicionar somente o usuário dedicado de implantação ao grupo `docker`:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

> O grupo `docker` concede privilégios equivalentes a root. Use apenas em uma conta de implantação protegida por chave SSH. Caso não aceite esse modelo, execute o processo sob uma conta administrativa controlada.

Documentação oficial: [Docker Engine no Ubuntu](https://docs.docker.com/engine/install/ubuntu/) e [Docker Compose no Linux](https://docs.docker.com/compose/install/linux/).

## 6. Enviar o projeto ao servidor

### Opção A: GitHub, recomendada

Crie o diretório:

```bash
sudo mkdir -p /opt/bbt-corporativo
sudo chown -R "$USER":"$USER" /opt/bbt-corporativo
```

Clone exatamente a branch aprovada:

```bash
git clone --branch NOME_DA_BRANCH --single-branch URL_DO_REPOSITORIO /opt/bbt-corporativo
cd /opt/bbt-corporativo
```

Confirme a versão:

```bash
git status
git branch --show-current
git log -1 --oneline
```

### Opção B: arquivo ZIP

No Windows PowerShell:

```powershell
scp "C:\CAMINHO\BDEX_PRODUCAO_SAAS_SERVIDOR.zip" USUARIO@IP_DO_SERVIDOR:/tmp/
```

No servidor:

```bash
sudo mkdir -p /opt/bbt-corporativo
sudo unzip /tmp/BDEX_PRODUCAO_SAAS_SERVIDOR.zip -d /opt/bbt-corporativo
sudo chown -R "$USER":"$USER" /opt/bbt-corporativo
cd /opt/bbt-corporativo
```

Confirme que estes arquivos estão diretamente no diretório atual:

```bash
ls package.json Dockerfile docker-compose.production.yml scripts/release.sh
```

Se os arquivos estiverem dentro de outra subpasta, entre nela antes de continuar. Não execute o release em um diretório acima do `package.json`.

## 7. Preparar dependências e permissões

```bash
cd /opt/bbt-corporativo
npm ci
chmod +x scripts/*.sh
```

Não envie nem reaproveite do computador local:

- `.env.local`;
- `.env.production` de teste;
- `node_modules`;
- `.next`;
- `.runtime`;
- banco local;
- arquivos de demonstração;
- credenciais de teste.

## 8. Gerar segredos de produção

Gere três valores diferentes e salve cada um no gerenciador de senhas:

```bash
openssl rand -hex 32
```

Use o primeiro para `POSTGRES_PASSWORD`.

```bash
openssl rand -hex 32
```

Use o segundo para `DATABASE_APP_PASSWORD`.

```bash
openssl rand -hex 48
```

Use o terceiro para `AUTH_SECRET`.

Não reutilize senha de e-mail, GitHub, servidor ou administrador do sistema. Valores hexadecimais evitam problemas de codificação dentro das URLs PostgreSQL.

Qualquer token de integração que já tenha sido compartilhado em conversa, e-mail ou captura de tela deve ser rotacionado no fornecedor antes do uso real.

## 9. Criar `.env.production`

```bash
cd /opt/bbt-corporativo
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

Use o modelo abaixo como referência. Substitua todos os valores em maiúsculas. Não digite os sinais `<` e `>`.

```dotenv
# Aplicação
PORT=3000
HOSTNAME=0.0.0.0
APP_URL=https://corporativo.suaempresa.com.br
NEXT_PUBLIC_APP_URL=https://corporativo.suaempresa.com.br
APP_VERSION=2026.07.22-1
ALLOW_INSECURE_LOCALHOST=false
LOG_LEVEL=info

# HTTPS / Caddy
APP_DOMAIN=corporativo.suaempresa.com.br
ACME_EMAIL=seu-email-administrativo@suaempresa.com.br
MAX_UPLOAD_SIZE=64MB
BBT_IMAGE=bbt-corporativo
BACKUP_RETENTION_DAYS=14

# PostgreSQL administrativo
POSTGRES_DB=bbt_corporativo
POSTGRES_USER=bbt_admin
POSTGRES_PASSWORD=SENHA_HEXADECIMAL_DO_POSTGRES

# PostgreSQL da aplicação
DATABASE_APP_ROLE=bbt_app
DATABASE_APP_PASSWORD=SENHA_HEXADECIMAL_DO_BBT_APP
DATABASE_URL=postgresql://bbt_app:SENHA_HEXADECIMAL_DO_BBT_APP@postgres:5432/bbt_corporativo
MIGRATION_DATABASE_URL=postgresql://bbt_admin:SENHA_HEXADECIMAL_DO_POSTGRES@postgres:5432/bbt_corporativo
DATABASE_SSL=false
POSTGRES_POOL_MAX=10
POSTGRES_CONNECT_TIMEOUT_MS=5000
POSTGRES_STATEMENT_TIMEOUT_MS=30000

# Sessão
AUTH_SECRET=SEGREDO_HEXADECIMAL_DE_48_BYTES
AUTH_SESSION_HOURS=12
AUTH_COOKIE_NAME=bbt_session

# Arquivos e importações
STORAGE_ROOT=/var/lib/bbt/files
MAX_UPLOAD_BYTES=52428800

# SMTP - recomendado antes de criar usuários
SMTP_ENABLED=true
SMTP_HOST=HOST_SMTP
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=USUARIO_SMTP
SMTP_PASSWORD=SENHA_SMTP
SMTP_FROM=remetente@suaempresa.com.br
SMTP_FROM_NAME=BBT Corporativo
PASSWORD_RESET_MINUTES=30

# Primeiro tenant e primeiro administrador
BOOTSTRAP_TENANT_NAME=NOME_DA_ORGANIZACAO
BOOTSTRAP_TENANT_SLUG=identificador-da-organizacao
BOOTSTRAP_ADMIN_NAME=NOME_COMPLETO_DO_ADMINISTRADOR
BOOTSTRAP_ADMIN_EMAIL=EMAIL_INDIVIDUAL_DO_ADMINISTRADOR
BOOTSTRAP_ADMIN_PASSWORD=SENHA_FORTE_INICIAL
BOOTSTRAP_PLATFORM_ADMIN=true
BOOTSTRAP_PLAN_KEY=corporativo
BOOTSTRAP_PLAN_NAME=Plano Corporativo
BOOTSTRAP_MAX_USERS=
BOOTSTRAP_MAX_STORAGE_BYTES=
BOOTSTRAP_MAX_MONTHLY_OPERATIONS=
BOOTSTRAP_ENTITLEMENTS={}

# Integrações: mantenha desabilitadas até configurar e homologar
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.2
OPENAI_PRO_MODEL=gpt-5.2-pro
OPENAI_SEARCH_MODEL=gpt-5.2
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=nova
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
AI_HOTEL_PROVIDER=openai

TECH_API_ENABLED=false
TECH_API_MODE=production
TECH_API_BASE_URL=https://www.ttravel.com.br/ttravelapi/reservas
TECH_API_LOGIN=
TECH_API_PASSWORD=
TECH_API_KEY=
TECH_API_TIMEOUT_MS=30000
TECH_API_DEFAULT_COMPANY_ID=
TECH_API_DEFAULT_SYSTEMS=
TECH_API_HOTEL_SUPPLIERS=
TECH_API_TOKEN_CACHE_TTL_SECONDS=900
TECH_REPORTS_ENABLED=false
TECH_REPORTS_BASE_URL=https://www.ttravel.com.br/ttravelapi/relatorio
TECH_REPORTS_KEY=

WHATSAPP_ENABLED=false
WHATSAPP_PROVIDER=evolution_api
WHATSAPP_API_BASE_URL=
WHATSAPP_API_KEY=
WHATSAPP_INSTANCE_ID=
```

Observações:

- `APP_DOMAIN` não contém `https://`.
- `APP_URL` e `NEXT_PUBLIC_APP_URL` contêm `https://`.
- `DATABASE_URL` usa `bbt_app`.
- `MIGRATION_DATABASE_URL` usa `bbt_admin`.
- As senhas das URLs devem ser exatamente iguais às variáveis correspondentes.
- `MAX_UPLOAD_BYTES=52428800` permite até 50 MiB na aplicação; `MAX_UPLOAD_SIZE=64MB` deixa margem no Caddy.
- Para SMTP na porta 587, use `SMTP_SECURE=false`. Para um provedor que exija TLS direto na porta 465, use `SMTP_SECURE=true`.
- O token Tech Travel transacional não deve ser ativado antes da homologação de cotação, reserva, emissão e cancelamento.

Proteja novamente o arquivo:

```bash
chmod 600 .env.production
```

## 10. Validar a configuração antes de publicar

```bash
cd /opt/bbt-corporativo
node scripts/validate-environment.mjs --env-file=.env.production
node scripts/validate-environment.mjs --env-file=.env.production --bootstrap
docker compose --env-file .env.production -f docker-compose.production.yml config > /dev/null
```

Todos devem terminar sem erro. A validação não imprime os segredos.

Execute também a validação completa do código:

```bash
npm run validate
```

Esse comando verifica migrations, inventário, segredos, lint, TypeScript, testes e build de produção.

## 11. Fazer a primeira implantação

Com o DNS já apontado:

```bash
cd /opt/bbt-corporativo
ENV_FILE=.env.production ./scripts/release.sh
```

O release:

1. valida o ambiente e o código;
2. verifica espaço em disco;
3. valida o Compose;
4. cria backup;
5. constrói as imagens;
6. inicia PostgreSQL;
7. aplica migrations;
8. inicia a aplicação;
9. inicia o Caddy e o HTTPS;
10. executa smoke tests.

Verifique os containers:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Verifique a aplicação:

```bash
curl --fail https://corporativo.suaempresa.com.br/api/health
curl --fail https://corporativo.suaempresa.com.br/api/ready
curl --fail -I https://corporativo.suaempresa.com.br/login
```

`/api/health` e `/api/ready` devem responder com HTTP 200 e `ok: true`.

## 12. Criar o primeiro administrador

O bootstrap é executado uma única vez:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile bootstrap run --rm bootstrap
```

Resultado esperado:

```text
Tenant inicial e administrador criados com sucesso.
```

O bootstrap cria:

- tenant inicial;
- plano e assinatura;
- papéis e permissões;
- administrador individual;
- credencial segura;
- trilha de auditoria.

Depois do sucesso:

1. Entre em `https://SEU_DOMINIO/login`.
2. Use o e-mail e a senha definidos em `BOOTSTRAP_ADMIN_*`.
3. Confirme que o dashboard abre.
4. Altere a senha em `https://SEU_DOMINIO/alterar-senha` caso ela tenha sido compartilhada durante a instalação.
5. Remova a senha utilizada do arquivo:

```dotenv
BOOTSTRAP_ADMIN_PASSWORD=
```

6. Mantenha `.env.production` com permissão `600`.

O Compose aceita os campos de bootstrap vazios nas atualizações normais. Se alguém tentar executar o perfil `bootstrap` novamente sem preencher os campos, o próprio script recusará a operação.

## 13. Diferença entre tenant, grupo, empresa, usuário e viajante

| Conceito | Significado |
| --- | --- |
| Tenant | Limite SaaS e de isolamento de uma organização cliente. |
| Grupo / holding | Conjunto de empresas relacionadas dentro do mesmo tenant. |
| Empresa | Entidade individual usada em demandas, reservas e relatórios. |
| Usuário | Pessoa que entra no sistema com e-mail e senha próprios. |
| Viajante / funcionário | Pessoa cadastrada para reservas e relatórios; não recebe login automaticamente. |

Não crie um novo tenant para cada empresa de uma mesma holding. Nesse caso, crie um tenant e organize as empresas em grupos.

## 14. Ordem recomendada dos primeiros cadastros

Depois de entrar como administrador:

1. Acesse **Cadastros > Grupos / holdings** e crie os grupos necessários.
2. Acesse **Cadastros > Empresas** e crie as empresas.
3. Vincule cada empresa ao grupo correto.
4. Acesse **Cadastros > Viajantes** e importe ou cadastre funcionários.
5. Acesse **Administração > Usuários e permissões** para criar os logins.

Cadastre grupos e empresas antes dos usuários corporativos. Assim o escopo de acesso poderá ser escolhido corretamente no primeiro convite.

## 15. Criar logins para outras pessoas

A forma recomendada é convite individual por e-mail.

### Pré-requisito

O SMTP precisa estar configurado e testado. Sem SMTP:

- convites não são enviados;
- recuperação de senha não funciona;
- criação de novos tenants pela Administração SaaS fica bloqueada.

### Criar um usuário por convite

1. Entre com uma conta que possua `gerenciar_usuarios`.
2. Abra **Administração > Usuários e permissões**.
3. Clique em **Novo Usuário**.
4. Informe nome completo e e-mail individual.
5. Escolha o tipo de acesso:
   - **Portal corporativo** para empresas, grupos, donos, diretoria, secretárias, financeiro e solicitantes;
   - **Equipe interna** para operadores e gestores internos da agência.
6. Se for portal corporativo, selecione o perfil adequado.
7. Configure grupos e empresas permitidos.
8. Defina o contexto padrão após o login.
9. Revise o resumo do acesso.
10. Em **Forma de acesso**, escolha **Enviar convite**.
11. Clique em **Enviar convite**.

O usuário receberá um link individual, de uso único, válido por 72 horas. Ele próprio definirá a senha.

Senha aceita pelo sistema:

- mínimo de 12 caracteres;
- ao menos uma letra maiúscula;
- ao menos uma letra minúscula;
- ao menos um número;
- ao menos um símbolo.

Se o convite expirar, abra **Usuários e permissões** e use **Reenviar convite**.

### Criar com senha temporária

Use apenas quando o SMTP ainda não estiver disponível ou houver necessidade operacional controlada:

1. No formulário do novo usuário, escolha **Senha temporária**.
2. Crie uma senha forte e exclusiva.
3. Entregue-a por um canal seguro e separado do e-mail de identificação.
4. No primeiro login, o sistema obrigará a troca da senha.

Nunca use a mesma senha temporária para duas pessoas e nunca crie contas compartilhadas.

### Quando o e-mail já existe

Se o e-mail já estiver associado ao mesmo tenant, o sistema preserva a identidade e atualiza os vínculos corporativos, em vez de criar uma conta duplicada.

Se a mesma pessoa participar de mais de um tenant, a tela de login solicitará o **Ambiente da organização**. O valor é o slug do tenant, por exemplo `grupo-alfa`.

## 16. Perfis corporativos

| Perfil | Uso recomendado |
| --- | --- |
| Proprietário do grupo | Acesso completo; use somente para o dono responsável. |
| CEO / Diretoria | Visão consolidada, financeiro, aprovações e relatórios; sem administração de usuários por padrão. |
| Administrador do grupo | Gestão de empresas, pessoas, demandas, acessos e configurações do grupo; financeiro não é concedido automaticamente. |
| Secretaria executiva | Criação e acompanhamento de demandas, reservas, vouchers e relatórios; sem financeiro por padrão. |
| Financeiro do grupo | Financeiro, reservas, emissões, vouchers e relatórios das empresas autorizadas. |
| Gestor | Demandas, aprovações e relatórios; sem financeiro por padrão. |
| Visualizador | Consulta sem edição e sem exportação por padrão. |
| Administrador de empresa | Gestão limitada às empresas permitidas. |
| Solicitante | Criação e acompanhamento de solicitações e documentos relacionados. |

Os perfis são modelos de permissões. Use **Personalizar permissões** somente quando existir uma necessidade clara e revise o resumo antes de salvar.

## 17. Escolher quais empresas cada login acessa

No editor de acesso corporativo existem três formas:

### Todas as empresas atuais e futuras do grupo

Use para dono, CEO ou administrador que realmente deva acompanhar todo o grupo.

- empresas atuais entram imediatamente;
- novas empresas criadas no grupo entram automaticamente;
- a visão consolidada pode ser habilitada.

### Somente empresas selecionadas

Use para secretária, gestor regional ou financeiro parcial.

- marque somente as empresas necessárias;
- novas empresas do grupo não entram automaticamente;
- é possível revogar uma empresa sem excluir a conta.

### Acesso direto a empresas

Use para:

- empresa sem grupo;
- empresas de grupos diferentes;
- consultor ou gestor com escopo específico.

A visão consolidada soma apenas as empresas realmente autorizadas. O navegador não consegue ampliar esse escopo alterando a URL.

## 18. Contexto de empresa e grupo no portal

Quando o usuário possui mais de uma opção, o seletor de contexto permite alternar entre:

- visão consolidada de um grupo autorizado;
- uma empresa específica;
- outro grupo permitido;
- empresa concedida diretamente.

O contexto padrão pode ser escolhido no cadastro do usuário. A última escolha do navegador é apenas uma preferência; o servidor recalcula a autorização em todas as requisições.

## 19. Criar outros tenants SaaS

Use esta função somente para organizações realmente separadas. Grupo e empresa não são novos tenants.

Pré-requisitos:

- conta com `platform_admin`;
- SMTP funcionando;
- plano ativo criado.

Passos:

1. Abra **Administração > Administração SaaS**.
2. Na aba **Planos e limites**, crie ou revise um plano.
3. Volte para **Tenants**.
4. Clique em **Novo tenant**.
5. Informe organização, slug, plano, nome e e-mail do administrador individual.
6. Salve.

O novo administrador recebe convite para definir a própria senha. Não é criada senha padrão.

## 20. Desativar ou alterar um acesso

Em **Administração > Usuários e permissões**:

- **Editar** altera perfil, permissões, grupos, empresas e contexto padrão;
- **Suspender/Inativar** bloqueia a conta e revoga o acesso;
- **Reativar** libera novamente uma conta já configurada;
- **Reenviar convite** cria um novo link para convite pendente;
- retirar uma empresa não exige recriar o usuário;
- retirar um grupo não apaga a identidade nem o histórico.

Não exclua registros diretamente no PostgreSQL.

## 21. Configurar backup

Um backup completo contém:

1. dump do PostgreSQL;
2. arquivos privados do volume de armazenamento;
3. manifesto e hashes SHA-256.

Backup manual:

```bash
cd /opt/bbt-corporativo
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile ops run --rm backup
```

Para agendar diariamente às 02:15, abra o cron da conta operacional:

```bash
crontab -e
```

Adicione uma única linha, ajustando o caminho do Docker se necessário:

```cron
15 2 * * * cd /opt/bbt-corporativo && /usr/bin/docker compose --env-file .env.production -f docker-compose.production.yml --profile ops run --rm backup >> /var/log/bbt-backup.log 2>&1
```

Confirme o caminho com:

```bash
command -v docker
```

O backup local não protege contra perda do servidor. Copie-o de forma criptografada para outro provedor ou conta, com versionamento e acesso restrito.

Nunca inclua `.env.production` dentro do backup de dados.

## 22. Validar restauração

Nunca teste restore sobre produção.

Use o perfil isolado:

```bash
RESTORE_SOURCE=/backups/AAAAMMDDTHHMMSSZ \
RESTORE_DATABASE=bbt_restore_validation \
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  --profile restore run --rm restore-validation
```

O teste precisa confirmar banco, tenants, usuários, empresas e arquivos. Consulte `docs/BACKUP-RESTORE.md` antes de qualquer restauração real.

## 23. Atualizar o sistema

Antes da atualização:

- confirme backup recente e cópia externa;
- confira espaço em disco;
- leia as migrations da versão;
- escolha uma nova tag imutável para `APP_VERSION`.

Se usa Git:

```bash
cd /opt/bbt-corporativo
git fetch --all --prune
git switch NOME_DA_BRANCH
git pull --ff-only
npm ci
nano .env.production
```

Altere, por exemplo:

```dotenv
APP_VERSION=2026.07.30-1
```

Execute:

```bash
ENV_FILE=.env.production ./scripts/release.sh
```

Monitore por pelo menos 30 minutos:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 app caddy postgres
```

Não use `git reset --hard`, não apague volumes e não substitua `.env.production` durante uma atualização.

## 24. Rollback de aplicação

Se o schema continuar compatível e a imagem anterior existir:

```bash
PREVIOUS_APP_VERSION=TAG_ANTERIOR \
ENV_FILE=.env.production \
./scripts/rollback.sh
```

O rollback da imagem não desfaz migrations automaticamente. Se a migration não for retrocompatível, pare e siga o plano de restore aprovado.

## 25. Comandos operacionais úteis

Status:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Logs da aplicação:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 -f app
```

Logs do HTTPS:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 -f caddy
```

Logs do banco:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 postgres
```

Reiniciar somente a aplicação:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml restart app
```

Executar smoke test:

```bash
node --env-file=.env.production scripts/smoke-test.mjs
```

Status das migrations:

```bash
node --env-file=.env.production scripts/migrate.mjs status
```

## 26. Problemas comuns

### Certificado HTTPS não é emitido

Confira:

- DNS apontando para o IP correto;
- portas 80 e 443 liberadas;
- ausência de registro `AAAA` incorreto;
- horário do servidor;
- logs do Caddy.

### `/api/ready` retorna 503

Confira:

- PostgreSQL saudável;
- migrations aplicadas;
- `DATABASE_URL` usando `bbt_app`;
- `MIGRATION_DATABASE_URL` usando `bbt_admin`;
- senhas idênticas às URLs;
- papel da aplicação sem `SUPERUSER` e sem `BYPASSRLS`.

### Login informa credenciais ou ambiente incorretos

Confira:

- e-mail em minúsculas ou sem espaços;
- senha correta;
- usuário, membership, tenant e plano ativos;
- slug correto quando a tela pedir o ambiente;
- convite aceito ou senha temporária já ativada;
- bloqueio temporário após tentativas inválidas.

### Convite não chega

Confira:

- `SMTP_ENABLED=true`;
- host, porta, usuário, senha e remetente;
- regra TLS da porta utilizada;
- pasta de spam;
- logs do container `app`;
- autorização do remetente no provedor SMTP.

Depois de corrigir, use **Reenviar convite**.

### Upload retorna HTTP 413

O limite do Caddy e o da aplicação precisam ser compatíveis:

```dotenv
MAX_UPLOAD_SIZE=64MB
MAX_UPLOAD_BYTES=52428800
```

Depois de alterar, execute uma nova release. Não aumente acima de 100 MB sem revisar memória, tempo de processamento e regras do aplicativo.

### Script sem permissão

```bash
chmod +x scripts/*.sh
```

### Disco cheio

Pare importações, preserve o último backup válido, verifique volumes e expanda o disco. Não apague o volume PostgreSQL.

## 27. Comandos proibidos em produção

Não execute:

```bash
docker compose down -v
docker volume rm
git reset --hard
git clean -fd
```

Esses comandos podem apagar dados, arquivos ou trabalho ainda não publicado.

Também não:

- publique PostgreSQL na internet;
- deixe `.env.production` no Git;
- use senha compartilhada;
- crie empresas ou reservas fictícias em produção;
- ative uma integração sem credenciais e homologação;
- execute restore diretamente sobre produção sem validação isolada.

## 28. Checklist antes de liberar usuários

- [ ] DNS aponta para o servidor.
- [ ] HTTPS válido e renovação automática funcionando.
- [ ] Somente portas 22, 80 e 443 estão acessíveis.
- [ ] `.env.production` está com permissão `600`.
- [ ] Segredos são exclusivos de produção.
- [ ] `npm run validate` passou.
- [ ] Containers estão saudáveis.
- [ ] `/api/health` responde 200.
- [ ] `/api/ready` responde 200.
- [ ] Migrations estão aplicadas.
- [ ] Primeiro administrador consegue entrar.
- [ ] Senha real de bootstrap foi removida do ambiente.
- [ ] SMTP enviou convite e recuperação em teste real.
- [ ] Conta cliente enxerga somente empresas autorizadas.
- [ ] Relatório cliente não mostra markup interno.
- [ ] Upload e download de PDF funcionam.
- [ ] Dados continuam após reiniciar o container `app`.
- [ ] Backup foi criado.
- [ ] Cópia externa foi realizada.
- [ ] Restore isolado foi validado.
- [ ] Monitoramento de disponibilidade, disco e backup está ativo.

## 29. Documentos técnicos relacionados

- `docs/DEPLOYMENT-SERVER.md`
- `docs/ENVIRONMENT-VARIABLES.md`
- `docs/BACKUP-RESTORE.md`
- `docs/RUNBOOK.md`
- `docs/SECURITY.md`
- `docs/CORPORATE-ACCESS.md`

Use este manual como roteiro de implantação. Em caso de divergência operacional, interrompa a publicação antes de tentar contornar validações de segurança.
