'use client'

interface ClientFailureContext {
  component?: string
  operation?: string
}

export function reportClientFailure(
  event: string,
  error: unknown,
  context: ClientFailureContext = {},
): void {
  const errorName = error instanceof Error ? error.name : typeof error
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'warn',
    event,
    errorName,
    ...context,
  }))
}
