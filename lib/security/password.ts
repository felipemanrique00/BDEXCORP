import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const FORMAT = 'scrypt'
const VERSION = '1'
const KEY_LENGTH = 64
const N = 16_384
const R = 8
const P = 1

export function isPasswordHash(value: string): boolean {
  return value.startsWith(`${FORMAT}$${VERSION}$`)
}

export async function hashPassword(password: string): Promise<string> {
  if (isPasswordHash(password)) return password
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, N, R, P)
  return [FORMAT, VERSION, N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false

  const parts = stored.split('$')
  if (parts.length !== 7) return false
  const n = Number(parts[2])
  const r = Number(parts[3])
  const p = Number(parts[4])
  if (!validCost(n, r, p)) return false

  try {
    const salt = Buffer.from(parts[5], 'base64url')
    const expected = Buffer.from(parts[6], 'base64url')
    if (salt.length < 16 || expected.length < 32 || expected.length > 128) return false
    const actual = await scryptAsync(password, salt, expected.length, n, r, p)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function scryptAsync(password: string, salt: Buffer, keyLength: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

function validCost(n: number, r: number, p: number): boolean {
  return Number.isInteger(n) && n >= 16_384 && n <= 262_144 && Number.isInteger(r) && r >= 1 && r <= 16 && Number.isInteger(p) && p >= 1 && p <= 4
}
