export function createEntityId(prefix: string, separator: '-' | '_' = '-'): string {
  const normalizedPrefix = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, '')
  if (!normalizedPrefix) throw new Error('Prefixo de identificador invalido.')
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Gerador criptografico de identificadores indisponivel.')
  }
  return `${normalizedPrefix}${separator}${globalThis.crypto.randomUUID()}`
}
