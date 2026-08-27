import fs from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const envFileArgument = process.argv.find((value) => value.startsWith('--env-file='))
const values = {
  ...readEnvironmentFile(envFileArgument?.slice('--env-file='.length)),
  ...process.env,
}
const errors = []

required('APP_URL')
required('APP_VERSION')
required('DATABASE_URL')
required('MIGRATION_DATABASE_URL')
required('DATABASE_APP_ROLE')
required('DATABASE_APP_PASSWORD')
required('AUTH_SECRET')
required('MFA_ENCRYPTION_KEY')
validateHttpsUrl('APP_URL')
validatePostgresUrl('DATABASE_URL')
validatePostgresUrl('MIGRATION_DATABASE_URL')

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(String(values.DATABASE_APP_ROLE || ''))) {
  errors.push('DATABASE_APP_ROLE possui formato invalido.')
}
if (String(values.DATABASE_APP_PASSWORD || '').length < 20 || /change|default|example/i.test(String(values.DATABASE_APP_PASSWORD || ''))) {
  errors.push('DATABASE_APP_PASSWORD deve ter ao menos 20 caracteres aleatorios.')
}
try {
  const appUser = decodeURIComponent(new URL(String(values.DATABASE_URL || '')).username)
  const migrationUser = decodeURIComponent(new URL(String(values.MIGRATION_DATABASE_URL || '')).username)
  if (appUser !== String(values.DATABASE_APP_ROLE || '')) errors.push('DATABASE_URL deve usar DATABASE_APP_ROLE.')
  if (appUser && appUser === migrationUser) errors.push('Usuario da aplicacao deve ser diferente do usuario de migrations.')
} catch {
  // Os erros de URL sao registrados pelas validacoes especificas.
}

if (String(values.AUTH_SECRET || '').length < 32 || /change[_-]?me|example|default|secret/i.test(String(values.AUTH_SECRET || ''))) {
  errors.push('AUTH_SECRET deve ter ao menos 32 caracteres aleatorios e nao pode ser um valor padrao.')
}
if (!validMfaEncryptionKey(String(values.MFA_ENCRYPTION_KEY || ''))) {
  errors.push('MFA_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64.')
}
if (String(values.MFA_ADMIN_REQUIRED || 'true').trim().toLowerCase() !== 'true') {
  errors.push('MFA_ADMIN_REQUIRED deve permanecer habilitado.')
}
if (booleanValue('SMTP_ENABLED')) {
  required('SMTP_HOST')
  required('SMTP_USER')
  required('SMTP_PASSWORD')
  required('SMTP_FROM')
}
if (booleanValue('WHATSAPP_ENABLED')) {
  required('WHATSAPP_API_BASE_URL')
  required('WHATSAPP_API_KEY')
  required('WHATSAPP_INSTANCE_ID')
  validateUrl('WHATSAPP_API_BASE_URL')
}
if (booleanValue('TECH_API_ENABLED')) {
  required('TECH_API_BASE_URL')
  required('TECH_API_LOGIN')
  required('TECH_API_PASSWORD')
  required('TECH_API_KEY')
  validateUrl('TECH_API_BASE_URL')
}
if (booleanValue('TECH_REPORTS_ENABLED')) {
  required('TECH_REPORTS_BASE_URL')
  required('TECH_REPORTS_KEY')
  validateUrl('TECH_REPORTS_BASE_URL')
}
if (booleanValue('WINTOUR_AUTO_SEND') || booleanValue('WINTOUR_PROTOCOL_POLL_ENABLED')) {
  if (!booleanValue('WINTOUR_SYNC_ENABLED')) {
    errors.push('WINTOUR_SYNC_ENABLED deve estar habilitado antes do envio ou consulta automatica.')
  }
}
if (booleanValue('WINTOUR_SYNC_ENABLED')) {
  required('WINTOUR_PIN')
  required('WINTOUR_TENANT_ID')
  if (!/^[\x21-\x7E]{1,128}$/.test(String(values.WINTOUR_PIN || '').trim())) {
    errors.push('WINTOUR_PIN deve conter de 1 a 128 caracteres ASCII imprimiveis.')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(values.WINTOUR_TENANT_ID || '').trim())) {
    errors.push('WINTOUR_TENANT_ID deve ser um UUID canonico do tenant vinculado ao PIN.')
  }
}
if (args.has('--bootstrap')) {
  for (const key of [
    'BOOTSTRAP_TENANT_NAME',
    'BOOTSTRAP_TENANT_SLUG',
    'BOOTSTRAP_ADMIN_NAME',
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'BOOTSTRAP_PLAN_KEY',
    'BOOTSTRAP_PLAN_NAME',
  ]) required(key)
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(String(values.BOOTSTRAP_ADMIN_PASSWORD || ''))) {
    errors.push('BOOTSTRAP_ADMIN_PASSWORD nao atende a politica minima.')
  }
}

if (errors.length) {
  console.error('Configuracao invalida:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log('Configuracao validada sem exibir segredos.')

function required(key) {
  if (!String(values[key] || '').trim()) errors.push(`${key} e obrigatoria.`)
}

function booleanValue(key) {
  return String(values[key] || '').trim().toLowerCase() === 'true'
}

function validateHttpsUrl(key) {
  if (booleanValue('ALLOW_INSECURE_LOCALHOST')) {
    try {
      const url = new URL(String(values[key] || ''))
      if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return
    } catch {
      // O erro de formato sera registrado por validateUrl.
    }
  }
  validateUrl(key, true)
}

function validatePostgresUrl(key) {
  try {
    const url = new URL(String(values[key] || ''))
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error()
    if (!url.hostname || !url.pathname.slice(1)) throw new Error()
    if (/change[_-]?me|example|default/i.test(url.password)) errors.push(`${key} ainda contem senha padrao.`)
  } catch {
    errors.push(`${key} deve ser uma URL PostgreSQL valida.`)
  }
}

function validateUrl(key, httpsOnly = false) {
  if (!values[key]) return
  try {
    const url = new URL(String(values[key]))
    if (httpsOnly && url.protocol !== 'https:') throw new Error()
    if (httpsOnly && ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) throw new Error()
  } catch {
    errors.push(`${key} deve ser uma URL ${httpsOnly ? 'HTTPS publica' : 'valida'}.`)
  }
}

function validMfaEncryptionKey(value) {
  if (!value) return false
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').length === 32
  } catch {
    return false
  }
}

function readEnvironmentFile(file) {
  if (!file) return {}
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) {
    console.error(`Arquivo de ambiente nao encontrado: ${resolved}`)
    process.exit(1)
  }
  const result = {}
  for (const rawLine of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}
