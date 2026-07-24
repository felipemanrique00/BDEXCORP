import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'

import pg from 'pg'

const { Pool } = pg
const scryptAsync = promisify(scrypt)

const required = [
  'DATABASE_URL',
  'BOOTSTRAP_TENANT_NAME',
  'BOOTSTRAP_TENANT_SLUG',
  'BOOTSTRAP_ADMIN_NAME',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'BOOTSTRAP_PLAN_KEY',
  'BOOTSTRAP_PLAN_NAME',
]

const missing = required.filter((key) => !String(process.env[key] || '').trim())
if (missing.length) {
  console.error(`Variaveis obrigatorias ausentes: ${missing.join(', ')}`)
  process.exit(1)
}

const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD)
if (!isStrongPassword(password)) {
  console.error('BOOTSTRAP_ADMIN_PASSWORD deve ter ao menos 12 caracteres, com maiuscula, minuscula, numero e simbolo.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 5_000),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  application_name: 'bbt-bootstrap',
})

try {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('bbt-initial-bootstrap'))")
    await assertMigrationsApplied(client)

    const tenantSlug = String(process.env.BOOTSTRAP_TENANT_SLUG).trim().toLowerCase()
    const existing = await client.query('select id from tenants where slug = $1', [tenantSlug])
    if (existing.rowCount) {
      await client.query('rollback')
      console.log('Bootstrap ja executado para este tenant. Nenhuma alteracao realizada.')
      process.exitCode = 0
    } else {
      const plan = await upsertPlan(client)
      const tenant = await client.query(
        `insert into tenants (name, slug, status)
         values ($1, $2, 'active') returning id`,
        [String(process.env.BOOTSTRAP_TENANT_NAME).trim(), tenantSlug],
      )
      const tenantId = tenant.rows[0].id
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId])

      await client.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status, billing_mode)
         values ($1, $2, 'active', 'manual')`,
        [tenantId, plan.id],
      )
      await client.query(
        `insert into tenant_domain_rollouts (
           tenant_id, domain_key, read_mode, write_mode, status, metadata
         )
         select
           $1,
           domain_key,
           'relational',
           'relational',
           'active',
           '{"source":"bootstrap","automaticCutover":false,"legacyDataPresent":false}'::jsonb
         from unnest($2::text[]) domain_key`,
        [tenantId, ['approvals', 'demands', 'emissions', 'finance', 'requesters', 'vouchers']],
      )

      const roles = await createRoles(client, tenantId)
      const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL).trim().toLowerCase()
      const duplicateUser = await client.query('select id from users where email = $1', [email])
      if (duplicateUser.rowCount) throw new Error('O e-mail do administrador ja pertence a outro usuario.')

      const user = await client.query(
        `insert into users (email, name, status, platform_admin, email_verified_at)
         values ($1, $2, 'active', $3, now()) returning id`,
        [
          email,
          String(process.env.BOOTSTRAP_ADMIN_NAME).trim(),
          process.env.BOOTSTRAP_PLATFORM_ADMIN !== 'false',
        ],
      )
      const userId = user.rows[0].id

      await client.query(
        `insert into user_credentials (user_id, password_hash, must_change_password)
         values ($1, $2, false)`,
        [userId, await hashPassword(password)],
      )
      await client.query(
        `insert into tenant_memberships (tenant_id, user_id, role_id, status, profile_key)
         values ($1, $2, $3, 'active', 'lider')`,
        [tenantId, userId, roles.tenant_admin],
      )
      await client.query(
        `insert into audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata)
         values (
           $1::uuid, $2::uuid, 'platform.bootstrap', 'tenant',
           $1::uuid::text, 'success', jsonb_build_object('source', 'bootstrap')
         )`,
        [tenantId, userId],
      )

      await client.query('commit')
      console.log('Tenant inicial e administrador criados com sucesso.')
    }
  } catch (error) {
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      console.error(`Falha ao reverter bootstrap: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    }
    throw error
  } finally {
    client.release()
  }
} catch (error) {
  console.error(`Falha no bootstrap: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

async function assertMigrationsApplied(client) {
  const result = await client.query("select to_regclass('public.tenant_memberships') as memberships, to_regclass('public.app_kv') as storage")
  if (!result.rows[0]?.memberships || !result.rows[0]?.storage) {
    throw new Error('Execute npm run db:migrate antes do bootstrap.')
  }
}

async function upsertPlan(client) {
  const values = {
    key: String(process.env.BOOTSTRAP_PLAN_KEY).trim().toLowerCase(),
    name: String(process.env.BOOTSTRAP_PLAN_NAME).trim(),
    maxUsers: optionalPositiveInteger(process.env.BOOTSTRAP_MAX_USERS),
    maxStorage: optionalPositiveInteger(process.env.BOOTSTRAP_MAX_STORAGE_BYTES),
    maxOperations: optionalPositiveInteger(process.env.BOOTSTRAP_MAX_MONTHLY_OPERATIONS),
  }
  const result = await client.query(
    `insert into plans (plan_key, name, max_users, max_storage_bytes, max_monthly_operations, entitlements)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (plan_key) do update set
       name = excluded.name,
       max_users = excluded.max_users,
       max_storage_bytes = excluded.max_storage_bytes,
       max_monthly_operations = excluded.max_monthly_operations,
       entitlements = excluded.entitlements
     returning id`,
    [values.key, values.name, values.maxUsers, values.maxStorage, values.maxOperations, JSON.stringify(readEntitlements())],
  )
  return result.rows[0]
}

async function createRoles(client, tenantId) {
  const definitions = roleDefinitions()
  const ids = {}
  for (const definition of definitions) {
    const role = await client.query(
      `insert into roles (tenant_id, role_key, name, description, system_role)
       values ($1, $2, $3, $4, true) returning id`,
      [tenantId, definition.key, definition.name, definition.description],
    )
    ids[definition.key] = role.rows[0].id
    if (definition.key === 'tenant_admin') {
      await client.query(
        `insert into role_permissions (role_id, permission_key, allowed)
         select $1, permission_key, true from permissions`,
        [role.rows[0].id],
      )
      continue
    }
    for (const permission of definition.permissions) {
      await client.query(
        `insert into role_permissions (role_id, permission_key, allowed)
         values ($1, $2, true)`,
        [role.rows[0].id, permission],
      )
    }
  }
  return ids
}

function roleDefinitions() {
  return [
    {
      key: 'tenant_admin',
      name: 'Administrador do tenant',
      description: 'Administracao integral do ambiente',
      permissions: [],
    },
    {
      key: 'agent',
      name: 'Agente',
      description: 'Operacao de viagens',
      permissions: [
        'ver_empresas', 'ver_funcionarios', 'cadastrar_funcionarios', 'gerenciar_funcionarios',
        'ver_solicitantes', 'criar_demandas', 'ver_demandas', 'ver_reservas', 'ver_emissoes',
        'ver_vouchers', 'operar_cotacoes', 'operar_reservas', 'operar_emissoes',
        'operar_cancelamentos', 'gerenciar_integracoes', 'ver_politicas', 'ver_aprovacoes',
        'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
        'gerenciar_arquivos', 'usar_busca_global', 'acessar_portal_viajante',
      ],
    },
    {
      key: 'financial_manager',
      name: 'Gestor financeiro',
      description: 'Gestao financeira e relatorios',
      permissions: [
        'ver_financeiro', 'editar_financeiro', 'gerar_relatorios', 'ver_relatorios',
        'exportar_relatorios', 'importar_planilhas', 'ver_produtividade_todos',
        'aprovar_demandas', 'ver_empresas', 'ver_consolidado_grupo', 'ver_funcionarios',
        'ver_solicitantes', 'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
        'operar_cotacoes', 'ver_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
        'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos', 'ver_auditoria',
        'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos', 'gerenciar_orcamentos',
      ],
    },
    {
      key: 'supervisor',
      name: 'Supervisor',
      description: 'Supervisao operacional',
      permissions: [
        'ver_financeiro', 'cadastrar_empresas', 'cadastrar_funcionarios', 'cadastrar_hoteis',
        'editar_politicas', 'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios',
        'importar_planilhas', 'ver_produtividade_todos', 'aprovar_demandas', 'ver_empresas',
        'ver_consolidado_grupo', 'ver_funcionarios', 'gerenciar_funcionarios',
        'ver_solicitantes', 'gerenciar_solicitantes', 'criar_demandas', 'ver_demandas',
        'ver_reservas', 'ver_emissoes', 'ver_vouchers', 'operar_cotacoes',
        'operar_reservas', 'operar_emissoes', 'operar_cancelamentos',
        'gerenciar_integracoes', 'ver_politicas', 'gerenciar_politicas',
        'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes', 'ver_workflows',
        'gerenciar_workflows', 'executar_workflows', 'usar_ia', 'gerenciar_ia',
        'ver_arquivos', 'gerenciar_arquivos', 'ver_auditoria', 'ver_inteligencia',
        'usar_busca_global', 'ver_orcamentos', 'gerenciar_orcamentos',
        'executar_automacoes', 'gerenciar_automacoes', 'acessar_portal_viajante',
      ],
    },
    {
      key: 'operator',
      name: 'Operacional',
      description: 'Operacao com acesso controlado',
      permissions: [
        'ver_empresas', 'ver_funcionarios', 'ver_solicitantes', 'criar_demandas',
        'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
        'operar_cotacoes', 'operar_reservas', 'operar_emissoes',
        'operar_cancelamentos', 'gerenciar_integracoes', 'ver_workflows',
        'executar_workflows', 'usar_ia', 'ver_arquivos', 'gerenciar_arquivos',
        'usar_busca_global', 'acessar_portal_viajante',
      ],
    },
    {
      key: 'company_admin',
      name: 'Administrador de empresa',
      description: 'Administracao restrita as empresas vinculadas',
      permissions: [
        'ver_empresas', 'ver_funcionarios', 'cadastrar_funcionarios', 'gerenciar_funcionarios',
        'ver_solicitantes', 'gerenciar_solicitantes', 'criar_demandas', 'ver_demandas',
        'aprovar_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
        'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios', 'editar_politicas',
        'alterar_configuracoes', 'ver_politicas', 'gerenciar_politicas',
        'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes', 'ver_workflows',
        'gerenciar_workflows', 'executar_workflows', 'gerenciar_delegacoes',
        'usar_ia', 'gerenciar_ia', 'ver_arquivos', 'gerenciar_arquivos', 'ver_auditoria',
        'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos', 'gerenciar_orcamentos',
        'executar_automacoes', 'gerenciar_automacoes', 'acessar_portal_viajante',
      ],
    },
    {
      key: 'requester',
      name: 'Solicitante',
      description: 'Criacao e acompanhamento de demandas',
      permissions: [
        'ver_empresas', 'ver_funcionarios', 'ver_solicitantes', 'criar_demandas',
        'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
        'ver_politicas', 'ver_aprovacoes', 'ver_workflows', 'usar_ia',
        'ver_arquivos', 'usar_busca_global', 'acessar_portal_viajante',
      ],
    },
    {
      key: 'readonly',
      name: 'Somente leitura',
      description: 'Consulta sem alteracoes',
      permissions: [
        'ver_empresas', 'ver_funcionarios', 'ver_solicitantes', 'ver_demandas',
        'ver_reservas', 'ver_emissoes', 'ver_vouchers', 'ver_relatorios',
        'ver_politicas', 'ver_workflows', 'usar_ia', 'ver_arquivos',
        'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos',
      ],
    },
  ]
}

function readEntitlements() {
  const raw = String(process.env.BOOTSTRAP_ENTITLEMENTS || '').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BOOTSTRAP_ENTITLEMENTS deve ser um objeto JSON.')
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value === true]))
}

async function hashPassword(value) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(value, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', '1', 16_384, 8, 1, salt.toString('base64url'), Buffer.from(derived).toString('base64url')].join('$')
}

function isStrongPassword(value) {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
}

function optionalPositiveInteger(value) {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('Limites do plano devem ser inteiros positivos.')
  return parsed
}
