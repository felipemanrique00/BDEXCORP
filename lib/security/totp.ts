import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export interface TotpOptions {
  digits?: number
  periodSeconds?: number
  timestampMs?: number
}

export function generateTotpSecret(bytes = 20): string {
  if (!Number.isInteger(bytes) || bytes < 20 || bytes > 64) {
    throw new Error('O segredo TOTP deve conter entre 20 e 64 bytes.')
  }
  return encodeBase32(randomBytes(bytes))
}

export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? 6
  const periodSeconds = options.periodSeconds ?? 30
  const timestampMs = options.timestampMs ?? Date.now()
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('Quantidade de digitos TOTP invalida.')
  if (!Number.isInteger(periodSeconds) || periodSeconds < 15 || periodSeconds > 120) {
    throw new Error('Periodo TOTP invalido.')
  }

  const counter = Math.floor(timestampMs / 1_000 / periodSeconds)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  )
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

export function verifyTotp(
  secret: string,
  codeInput: string,
  options: TotpOptions & { window?: number } = {},
): number | null {
  const code = normalizeTotpCode(codeInput)
  const digits = options.digits ?? 6
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null

  const periodSeconds = options.periodSeconds ?? 30
  const timestampMs = options.timestampMs ?? Date.now()
  const currentStep = Math.floor(timestampMs / 1_000 / periodSeconds)
  const window = options.window ?? 1
  if (!Number.isInteger(window) || window < 0 || window > 5) throw new Error('Janela TOTP invalida.')

  const provided = Buffer.from(code)
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset
    if (step < 0) continue
    const expected = Buffer.from(generateTotp(secret, {
      digits,
      periodSeconds,
      timestampMs: step * periodSeconds * 1_000,
    }))
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) return step
  }
  return null
}

export function buildTotpUri(input: {
  issuer: string
  accountName: string
  secret: string
  digits?: number
  periodSeconds?: number
}): string {
  const issuer = input.issuer.trim()
  const accountName = input.accountName.trim()
  if (!issuer || !accountName) throw new Error('Emissor e conta sao obrigatorios para o TOTP.')
  const label = encodeURIComponent(`${issuer}:${accountName}`)
  const query = new URLSearchParams({
    secret: normalizeBase32(input.secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? 6),
    period: String(input.periodSeconds ?? 30),
  })
  return `otpauth://totp/${label}?${query.toString()}`
}

export function generateRecoveryCodes(count = 10): string[] {
  if (!Number.isInteger(count) || count < 6 || count > 20) {
    throw new Error('Quantidade de codigos de recuperacao invalida.')
  }
  const codes = new Set<string>()
  while (codes.size < count) {
    const raw = Array.from({ length: 16 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('')
    codes.add(raw.match(/.{1,4}/g)?.join('-') || raw)
  }
  return [...codes]
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\s/g, '')
}

export function formatTotpSecret(secret: string): string {
  return normalizeBase32(secret).match(/.{1,4}/g)?.join(' ') || secret
}

export function encodeBase32(input: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function decodeBase32(input: string): Buffer {
  const normalized = normalizeBase32(input)
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('Segredo TOTP em Base32 invalido.')

  let bits = 0
  let value = 0
  const output: number[] = []
  for (const character of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character)
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/[\s=-]/g, '')
}
