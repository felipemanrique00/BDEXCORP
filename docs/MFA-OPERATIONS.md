# MFA administrativo

## Escopo

O BDEX exige TOTP antes de criar a sessao de usuarios administrativos. A
politica abrange administrador da plataforma, administrador do tenant e perfis
com permissoes sensiveis de usuarios, acessos, configuracoes, politicas,
workflows, integracoes, IA ou automacoes.

Usuarios operacionais sem essas permissoes continuam autenticando com senha.
Uma conta que ja ativou TOTP sempre precisa do segundo fator, mesmo se o perfil
for alterado posteriormente.

## Configuracao de producao

Defina:

```dotenv
MFA_ADMIN_REQUIRED=true
MFA_ENCRYPTION_KEY=<32 bytes em Base64>
MFA_ISSUER=BBT Corporativo
MFA_CHALLENGE_MINUTES=10
MFA_MAX_ATTEMPTS=6
```

Gere a chave fora do repositorio:

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

Ou em Linux:

```bash
openssl rand -base64 32
```

Armazene a chave no cofre de segredos da infraestrutura. Nao a grave em Git,
imagem Docker, log, documento ou backup sem criptografia.

## Implantacao

1. Salve `MFA_ENCRYPTION_KEY` no ambiente.
2. Execute `npm run db:migrate` com a conta de migration.
3. Confirme que `0048_administrative_mfa.sql` foi aplicada.
4. Reinicie a aplicacao.
5. Entre com uma conta administrativa de homologacao.
6. Escaneie o QR Code e confirme um codigo TOTP.
7. Guarde os codigos de recuperacao.
8. Saia e entre novamente para confirmar o segundo fator.
9. Teste um codigo de recuperacao e confirme que ele nao pode ser reutilizado.

Sessoes administrativas antigas, criadas apenas com senha, sao revogadas na
proxima resolucao. O usuario volta ao login e configura o autenticador. Isso e
intencional.

## Recuperacao

Cada codigo de recuperacao funciona uma unica vez. O usuario autenticado pode
renovar o conjunto em **Configuracoes > Autenticacao em duas etapas**, mediante
senha atual e TOTP ou codigo de recuperacao. A renovacao invalida todo o
conjunto anterior.

Se o usuario perder autenticador e todos os codigos, a recuperacao deve ser
executada por procedimento administrativo auditado. Nao remova registros
manualmente sem validar identidade e autorizacao. Revogue sessoes ativas,
registre o incidente e force um novo cadastro.

## Backup e restore

O backup PostgreSQL contem apenas o segredo TOTP criptografado. O restore exige
a mesma `MFA_ENCRYPTION_KEY`. Teste o restore com a chave recuperada do cofre.
Se a chave for perdida, os segredos nao podem ser descriptografados e todos os
metodos MFA afetados precisam ser recadastrados.

## Evidencias automatizadas

- `tests/unit/totp.test.ts`: vetores oficiais RFC 6238 e codigos de recuperacao.
- `tests/integration/mfa-authentication.test.ts`: PostgreSQL, RLS, constraints,
  ativacao, anti-replay e uso unico.
- `tests/e2e/auth.spec.ts`: QR Code, confirmacao e recuperacao em desktop/mobile.
