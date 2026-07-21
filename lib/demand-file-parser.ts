export type DemandFileKind = 'audio' | 'image' | 'email' | 'text' | 'unknown'

export function identificarArquivoDemanda(file: File): DemandFileKind {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()

  if (mime.startsWith('audio/') || /\.(opus|ogg|mp3|m4a|wav|aac|webm)$/i.test(name)) return 'audio'
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image'
  if (
    mime.includes('message') ||
    mime.includes('rfc822') ||
    mime.includes('outlook') ||
    mime.includes('vnd.ms-outlook') ||
    /\.(eml|msg|oft)$/i.test(name)
  ) {
    return 'email'
  }
  if (mime.startsWith('text/') || /\.(txt|csv|log|html?)$/i.test(name)) return 'text'
  return 'unknown'
}

export async function arquivoParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function arquivoParaTextoDemanda(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  if (name.endsWith('.msg') || name.endsWith('.oft') || mime.includes('outlook') || mime.includes('vnd.ms-outlook')) {
    return extrairTextoMsg(await file.arrayBuffer())
  }
  const text = await file.text()
  if (name.endsWith('.eml') || file.type.toLowerCase().includes('message')) return extrairTextoEml(text)
  if (name.endsWith('.html') || name.endsWith('.htm') || mime.includes('html')) return textoHtmlParaTextoDemanda(text)
  return text
}

export function textoHtmlParaTextoDemanda(html: string): string {
  return limparHtml(html)
}

function extrairTextoEml(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n')
  const [headersRaw, ...bodyParts] = normalized.split(/\n\n/)
  const headers = parseHeaders(headersRaw)
  let body = bodyParts.join('\n\n')

  const contentType = headers['content-type'] || ''
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1]
  if (boundary) {
    const parts = body.split(`--${boundary}`)
    const preferred =
      parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ||
      parts.find((p) => /content-type:\s*text\/html/i.test(p)) ||
      body
    body = preferred
      .replace(/^[\s\S]*?\n\n/, '')
      .replace(new RegExp(`--${escapeRegExp(boundary)}--`, 'g'), '')
  }

  body = decodeTransferEncoding(body)
  body = limparHtml(body)

  return [
    headers.from ? `De: ${headers.from}` : '',
    headers.to ? `Para: ${headers.to}` : '',
    headers.subject ? `Assunto: ${headers.subject}` : '',
    headers.date ? `Data do e-mail: ${headers.date}` : '',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseHeaders(raw: string): Record<string, string> {
  const unfolded = raw.replace(/\n[ \t]+/g, ' ')
  const headers: Record<string, string> = {}
  unfolded.split('\n').forEach((line) => {
    const idx = line.indexOf(':')
    if (idx <= 0) return
    headers[line.slice(0, idx).trim().toLowerCase()] = decodeMimeWords(line.slice(idx + 1).trim())
  })
  return headers
}

function decodeTransferEncoding(value: string): string {
  let text = value
  if (/content-transfer-encoding:\s*quoted-printable/i.test(text)) {
    text = text
      .replace(/content-transfer-encoding:\s*quoted-printable/gi, '')
      .replace(/=\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }
  if (/content-transfer-encoding:\s*base64/i.test(text)) {
    const payload = text
      .replace(/^[\s\S]*?\n\n/, '')
      .replace(/[^A-Za-z0-9+/=]/g, '')
    try {
      text = decodeURIComponent(
        escape(atob(payload)),
      )
    } catch (error) {
      console.warn('[demand-file-parser] Conteudo base64 invalido.', {
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }
  return text.replace(/^content-[^\n]+$/gim, '').trim()
}

function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_, charset, enc, payload) => {
    try {
      const bytes =
        enc.toUpperCase() === 'B'
          ? atob(payload)
          : payload.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      if (/utf-?8/i.test(charset)) return decodeURIComponent(escape(bytes))
      return bytes
    } catch {
      return payload
    }
  })
}

function limparHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extrairTextoMsg(buffer: ArrayBuffer): string {
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const joined = `${utf16}\n${utf8}`

  const chunks = joined
    .replace(/\0/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/[^\p{L}\p{N}@.,;:!?()[\]\/+\-\s]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4 && /[a-zA-ZÀ-ÿ0-9]/.test(line))

  const unique: string[] = []
  chunks.forEach((line) => {
    const key = line.toLowerCase()
    if (!unique.some((item) => item.toLowerCase() === key || item.includes(line))) unique.push(line)
  })

  return unique.slice(0, 160).join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
