import { createHash } from 'node:crypto'

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex')
}

/**
 * Existing deployments may have recorded a checksum from a Windows CRLF
 * checkout while release artifacts use Git's LF blobs. Both byte sequences
 * represent the same SQL. No other content difference is accepted.
 */
export function compatibleMigrationChecksums(sql) {
  const lf = sql.replace(/\r\n?/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')
  return new Set([
    migrationChecksum(sql),
    migrationChecksum(lf),
    migrationChecksum(crlf),
  ])
}

export function isMigrationChecksumCompatible(sql, storedChecksum) {
  return compatibleMigrationChecksums(sql).has(storedChecksum)
}
