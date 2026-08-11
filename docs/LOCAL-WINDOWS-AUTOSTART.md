# Ambiente local automatico no Windows

O autostart local usa PostgreSQL embarcado e publica o Next.js em `http://127.0.0.1:3010`.

## Modo padrao: otimizado

A tarefa do Windows inicia o sistema em modo `production`. Na primeira execucao, ou quando algum arquivo relevante muda, o supervisor executa um build do Next.js em `.runtime/next-local-3010`. Nos reinicios seguintes, o build e reutilizado enquanto a assinatura das fontes permanecer igual.

Isso evita a compilacao de paginas sob demanda e o crescimento de memoria observado com um processo `next dev` mantido durante todo o dia.

Instalacao ou atualizacao da tarefa:

```powershell
.\deploy\windows\local\install-autostart.ps1
```

Operacao normal:

```powershell
.\deploy\windows\local\start-local.ps1
.\deploy\windows\local\status-local.ps1
.\deploy\windows\local\logs-local.ps1
.\deploy\windows\local\stop-local.ps1
```

O primeiro start depois de uma alteracao pode levar alguns minutos para concluir o build. O instalador e o comando de start aguardam ate dez minutos. Se o build falhar, o marcador de reutilizacao nao e atualizado e o servidor nao inicia uma versao incompleta.

## Desenvolvimento com hot reload

Use o modo de desenvolvimento apenas quando precisar editar e acompanhar as mudancas imediatamente:

```powershell
.\deploy\windows\local\stop-local.ps1
.\deploy\windows\local\start-local.ps1 -Development
```

Esse modo usa o cache separado `.runtime/next-dev-3010` e executa `next dev`. Antes de retornar ao modo otimizado:

```powershell
.\deploy\windows\local\stop-local.ps1
.\deploy\windows\local\start-local.ps1
```

O comando `status-local.ps1` informa o modo e o diretorio de build em uso.

## Quando o build e renovado

A assinatura considera os diretorios `app`, `components`, `config`, `lib`, `public` e `types`, alem das configuracoes do Next, TypeScript, Tailwind, PostCSS, dependencias, `.env.local` e preparacao de ativos. Alterar um desses arquivos provoca um novo build no proximo start otimizado. O cache interno do mesmo diretorio e preservado para tornar builds posteriores incrementais.

Para diagnosticar uma inicializacao:

```powershell
.\deploy\windows\local\status-local.ps1
.\deploy\windows\local\logs-local.ps1 -Lines 200
```

Os arquivos de runtime e logs permanecem fora do Git.

## Segredos exigidos pelo modo otimizado

O modo `production` valida `AUTH_SECRET`, `MFA_ENCRYPTION_KEY` e `APP_VERSION` antes de servir a aplicacao. O supervisor local atende a esses requisitos sem gravar segredos no `.env.local`:

- na primeira inicializacao, gera `AUTH_SECRET` com 48 bytes aleatorios e `MFA_ENCRYPTION_KEY` com 32 bytes aleatorios;
- protege ambos preferencialmente com DPAPI no escopo do usuario atual do Windows;
- em hosts automatizados que bloqueiam DPAPI por impersonacao, usa como contingencia o cofre protegido pela ACL do Windows, limitada ao usuario atual e ao `SYSTEM`;
- persiste os valores em `.runtime/local-autostart/application-secrets.dpapi.json`, arquivo ignorado pelo Git e sempre protegido pela ACL restrita;
- deriva `APP_VERSION` da versao do pacote e da assinatura atual das fontes;
- injeta os tres valores somente no ambiente dos subprocessos de build e execucao do Next.js, restaurando o ambiente do supervisor imediatamente depois;
- nunca inclui chaves, valores protegidos ou valores descriptografados nos logs ou no arquivo de estado.

O cofre e local a esta estacao e, quando DPAPI esta disponivel, tambem fica vinculado ao perfil que instalou a tarefa agendada. Nao copie esse arquivo para outro computador ou usuario. Cada estacao de desenvolvimento gera seu proprio cofre automaticamente.

Se o perfil do Windows mudar ou o cofre ficar corrompido, o start falha de forma segura. Com o sistema parado, remova somente `.runtime/local-autostart/application-secrets.dpapi.json` e execute `start-local.ps1` para gerar novas chaves. Essa regeneracao encerra sessoes locais existentes e pode tornar segredos MFA locais anteriores ilegiveis; por isso nao apague o cofre durante a operacao normal.
