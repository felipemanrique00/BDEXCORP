export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'RequestBodyError'
  }
}

export function assertDeclaredBodySize(request: Request, maxBytes: number): void {
  const raw = request.headers.get('content-length')
  if (!raw) return
  const length = Number(raw)
  if (Number.isFinite(length) && length > maxBytes) {
    throw new RequestBodyError('Conteudo enviado excede o limite permitido.', 413)
  }
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  assertDeclaredBodySize(request, maxBytes)
  if (!request.body) throw new RequestBodyError('JSON invalido.', 400)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new RequestBodyError('Conteudo enviado excede o limite permitido.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as T
  } catch {
    throw new RequestBodyError('JSON invalido.', 400)
  }
}

export function requestBodyErrorResponse(error: unknown): { message: string; status: number } | null {
  if (!(error instanceof RequestBodyError)) return null
  return { message: error.message, status: error.status }
}

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; error: string; status: number }

export async function readJsonBodyResult<T>(
  request: Request,
  maxBytes: number,
  emptyFallback?: T,
): Promise<JsonBodyResult<T>> {
  try {
    if (!request.body && emptyFallback !== undefined) return { ok: true, body: emptyFallback }
    return { ok: true, body: await readJsonBody<T>(request, maxBytes) }
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return { ok: false, error: bodyError.message, status: bodyError.status }
    throw error
  }
}
