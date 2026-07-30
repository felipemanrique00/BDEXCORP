# Seguranca

## Autenticacao

- Senhas usam `scrypt` com salt individual.
- Politica: minimo de 12 caracteres, maiuscula, minuscula, numero e simbolo.
- Falhas consecutivas geram bloqueio temporario no banco.
- Login usa comparacao de hash ficticio quando o usuario nao existe para reduzir diferenca temporal.
- Sessoes usam token aleatorio de 256 bits; apenas o hash fica no PostgreSQL.
- Cookies sao `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS, com expiracao e revogacao.
- Convites e recuperacao usam token de uso unico, hash no banco e prazo de expiracao.
- Troca ou redefinicao de senha revoga sessoes.

## Autorizacao

- Pages protegidas resolvem sessao no servidor.
- APIs usam `guardApiRequest` com sessao, papel, permissao, escopo e rate limit.
- Operacoes mutaveis validam `Origin` contra `APP_URL`.
- O tenant vem da sessao; valores enviados pelo browser nao alteram o contexto.
- RLS forcado e chaves compostas fornecem uma segunda barreira no banco.
- A camada de identidade usa contextos restritos por tenant, usuario, hash de
  sessao, hash de convite ou administrador de plataforma verificado.
- Migrations usam uma credencial administrativa separada; o processo web usa papel sem `SUPERUSER/BYPASSRLS`.
- `/api/ready` bloqueia producao se o papel da aplicacao puder ignorar RLS ou
  se qualquer migration versionada estiver ausente.
- Rotas da plataforma exigem `platformAdmin`.

## Segredos

- Segredos existem somente em `.env` privado, secret store do CI ou gerenciador externo.
- `.env.example` nao possui valor real.
- O scanner `scripts/scan-secrets.mjs` faz parte de `npm run validate` e CI.
- Logs removem chaves com nomes como password, token, cookie, authorization, secret e api key.
- Nunca grave `BOOTSTRAP_ADMIN_PASSWORD` depois do bootstrap.

Rotacione imediatamente qualquer credencial compartilhada em conversa, ticket, e-mail ou log. A rotacao deve ocorrer no fornecedor e no servidor.

## Rate limiting e corpos

- Buckets ficam no PostgreSQL e funcionam com varias instancias.
- Login, reset, IA, uploads e administracao possuem politicas proprias.
- JSON e multipart possuem limites antes da desserializacao completa.
- O job operacional deve executar `pruneExpiredRateLimits` periodicamente ou remover buckets expirados por tarefa SQL.

## Uploads

- Somente PDF.
- Validacao por extensao, limite e assinatura `%PDF-`.
- Nome e normalizado; o caminho fisico e gerado no servidor.
- Escrita usa criacao exclusiva e permissoes privadas.
- Metadados possuem SHA-256.
- Download, listagem e exclusao verificam entidade e permissao.
- Arquivos nunca ficam em `public`.

## HTTP

- Caddy redireciona HTTP para HTTPS e administra certificados.
- HSTS, CSP, `nosniff`, `frame-ancestors`, politica de referrer e politicas cross-domain estao configuradas.
- `X-Powered-By` e desativado.
- Caddy bloqueia caminhos internos e limita upload.
- A CSP usa um nonce exclusivo por resposta e nao libera scripts com `unsafe-inline` em producao.
- O layout raiz permanece dinamico para que os scripts internos do Next.js recebam esse nonce. O E2E bloqueia regressoes que voltem a impedir a renderizacao.

## Integracoes

- Credenciais Tech, SMTP, WhatsApp e IA permanecem somente no servidor.
- Mensagens do provedor sao convertidas para erro seguro; detalhes ficam no log estruturado.
- Integracao desabilitada retorna indisponibilidade explicita.
- Tech transacional nao deve ser habilitada antes da homologacao de contratos e idempotencia.
- Testes internos de mensagem/audio retornam 404 em producao.

## Auditoria

Eventos do servidor cobrem autenticacao, acesso negado, usuarios, tenants, armazenamento, arquivos e reset. Novas operacoes financeiras ou de fornecedor devem adicionar auditoria na mesma transacao ou registrar falha explicitamente.

## Resposta a incidente

1. Suspenda o tenant ou pare a aplicacao quando houver risco ativo.
2. Preserve logs, request IDs e snapshots sem copiar segredos.
3. Rotacione credenciais afetadas.
4. Revogue sessoes.
5. Restaure somente de backup verificado se houver corrupcao.
6. Registre impacto, periodo, tenants e acao corretiva.
7. Siga o processo juridico e de notificacao definido pela empresa.

## Riscos residuais

- Auditoria externa de penetracao ainda nao foi executada.
- As auditorias npm completa e de producao passaram em 24/07/2026; o gate deve
  continuar no CI para detectar novas vulnerabilidades.
- DAST autenticado amplo, SAST dedicado, SBOM e scanner da imagem Docker ainda
  dependem do ambiente de staging.
- Volume local de arquivos limita escala horizontal.
- O rate limiting no banco protege a aplicacao, mas nao substitui protecao DDoS na borda.
- Politicas de retencao e base legal exigem decisao organizacional/juridica.
