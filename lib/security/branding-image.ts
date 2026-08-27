import { extname } from 'node:path'
import { TextDecoder } from 'node:util'

export const BRANDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const BRANDING_IMAGE_MAX_PIXELS = 25_000_000
export const BRANDING_SVG_MAX_BYTES = 1024 * 1024
export const BRANDING_SVG_MAX_PIXELS = 4_000_000

export type BrandingImageFormat = 'png' | 'jpeg' | 'webp'
export type BrandingImageInputFormat = BrandingImageFormat | 'svg'

const SVG_MAX_ELEMENTS = 1_000
const SVG_MAX_ATTRIBUTES = 6_000
const SVG_MAX_DEPTH = 64
const SVG_MAX_ATTRIBUTE_VALUE_CHARS = 256 * 1024
const SVG_MAX_PATH_DATA_CHARS = 256 * 1024
const SVG_MAX_STYLE_CHARS = 32 * 1024
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

const BLOCKED_SVG_ELEMENTS = new Set([
  'a',
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'canvas',
  'discard',
  'embed',
  'feimage',
  'foreignobject',
  'frame',
  'frameset',
  'filter',
  'font',
  'font-face',
  'font-face-format',
  'font-face-name',
  'font-face-src',
  'font-face-uri',
  'glyph',
  'glyphref',
  'handler',
  'hatch',
  'hatchpath',
  'html',
  'hkern',
  'iframe',
  'image',
  'link',
  'listener',
  'marker',
  'mask',
  'meta',
  'mesh',
  'meshgradient',
  'meshpatch',
  'meshrow',
  'missing-glyph',
  'object',
  'pattern',
  'script',
  'set',
  'symbol',
  'use',
  'video',
  'vkern',
])

export class BrandingImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrandingImageValidationError'
  }
}

export function validateBrandingImageEnvelope(
  bytes: Buffer,
  originalName: string,
  declaredMimeType?: string | null,
  options: { allowSvg?: boolean } = {},
): BrandingImageInputFormat {
  if (!bytes.length) throw new BrandingImageValidationError('Arquivo de logomarca vazio.')
  if (bytes.length > BRANDING_IMAGE_MAX_BYTES) {
    throw new BrandingImageValidationError('A logomarca deve ter no maximo 5 MB.')
  }

  const extension = extname(originalName).toLowerCase()
  const allowedExtensions = options.allowSvg
    ? ['.png', '.jpg', '.jpeg', '.webp', '.svg']
    : ['.png', '.jpg', '.jpeg', '.webp']
  if (!allowedExtensions.includes(extension)) {
    throw new BrandingImageValidationError(
      options.allowSvg ? 'Use uma imagem PNG, JPEG, WebP ou SVG.' : 'Use uma imagem PNG, JPEG ou WebP.',
    )
  }

  if (extension === '.svg') {
    if (declaredMimeType && declaredMimeType !== 'image/svg+xml') {
      throw new BrandingImageValidationError('O tipo informado nao corresponde ao conteudo da imagem.')
    }
    validateBrandingSvg(bytes)
    return 'svg'
  }

  const format = detectBrandingImageFormat(bytes)
  if (!format) {
    throw new BrandingImageValidationError('O conteudo enviado nao e uma imagem PNG, JPEG ou WebP valida.')
  }
  const expectedExtensions: Record<BrandingImageFormat, string[]> = {
    png: ['.png'],
    jpeg: ['.jpg', '.jpeg'],
    webp: ['.webp'],
  }
  if (!expectedExtensions[format].includes(extension)) {
    throw new BrandingImageValidationError('A extensao do arquivo nao corresponde ao conteudo da imagem.')
  }

  const expectedMime: Record<BrandingImageFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  if (declaredMimeType && declaredMimeType !== expectedMime[format]) {
    throw new BrandingImageValidationError('O tipo informado nao corresponde ao conteudo da imagem.')
  }
  return format
}

function validateBrandingSvg(bytes: Buffer): void {
  if (bytes.length > BRANDING_SVG_MAX_BYTES) {
    throw new BrandingImageValidationError('A logomarca SVG deve ter no maximo 1 MB.')
  }

  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    throw new BrandingImageValidationError('A logomarca SVG deve usar codificacao UTF-8 valida.')
  }
  if (!source.trim()) throw new BrandingImageValidationError('Arquivo de logomarca vazio.')
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source)) {
    throw invalidSvg()
  }

  let cursor = skipWhitespace(source, 0)
  if (source.startsWith('<?xml', cursor)) {
    const declarationEnd = source.indexOf('?>', cursor + 5)
    if (declarationEnd < 0) throw invalidSvg()
    const declaration = source.slice(cursor, declarationEnd + 2)
    if (!/^<\?xml\s+version=(['"])1\.[01]\1(?:\s+encoding=(['"])UTF-8\2)?(?:\s+standalone=(['"])(?:yes|no)\3)?\s*\?>$/i.test(declaration)) {
      throw invalidSvg()
    }
    cursor = declarationEnd + 2
  }

  const stack: Array<{ rawName: string; localName: string }> = []
  let rootClosed = false
  let elementCount = 0
  let attributeCount = 0
  let pathDataChars = 0
  let styleChars = 0

  while (cursor < source.length) {
    const nextTag = source.indexOf('<', cursor)
    const textEnd = nextTag < 0 ? source.length : nextTag
    const text = source.slice(cursor, textEnd)
    const decodedText = decodeXmlReferences(text)
    if (!stack.length && decodedText.trim()) throw invalidSvg()
    if (stack.at(-1)?.localName === 'style') {
      styleChars += decodedText.length
      if (styleChars > SVG_MAX_STYLE_CHARS) throw svgTooComplex()
      validateSvgCss(decodedText)
    }
    if (nextTag < 0) {
      cursor = source.length
      break
    }
    cursor = nextTag

    if (source.startsWith('<!--', cursor)) {
      if (stack.at(-1)?.localName === 'style') {
        throw new BrandingImageValidationError('Comentarios nao sao permitidos dentro de estilos SVG.')
      }
      const commentEnd = source.indexOf('-->', cursor + 4)
      if (commentEnd < 0 || source.slice(cursor + 4, commentEnd).includes('--')) throw invalidSvg()
      cursor = commentEnd + 3
      continue
    }
    if (source.startsWith('<?', cursor) || /^<\s*!/i.test(source.slice(cursor, cursor + 16))) {
      throw new BrandingImageValidationError('A logomarca SVG contem declaracoes ou instrucoes nao permitidas.')
    }

    const tagEnd = findSvgTagEnd(source, cursor)
    if (tagEnd < 0) throw invalidSvg()
    const token = source.slice(cursor, tagEnd + 1)
    cursor = tagEnd + 1

    if (/^<\s*\//.test(token)) {
      const closing = token.match(/^<\s*\/\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*>$/)
      const expected = stack.pop()
      if (!closing || !expected || closing[1] !== expected.rawName) throw invalidSvg()
      if (!stack.length) rootClosed = true
      continue
    }

    if (rootClosed || stack.at(-1)?.localName === 'style') throw invalidSvg()
    const body = token.slice(1, -1).trim()
    const selfClosing = /\/\s*$/.test(body)
    const elementBody = selfClosing ? body.replace(/\/\s*$/, '').trimEnd() : body
    const nameMatch = elementBody.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)(?=\s|$)/)
    if (!nameMatch) throw invalidSvg()

    const rawName = nameMatch[1]
    const localName = xmlLocalName(rawName)
    if (!elementCount && rawName !== 'svg') {
      throw new BrandingImageValidationError('A raiz do arquivo deve ser um elemento SVG.')
    }
    if (elementCount && !stack.length) throw invalidSvg()
    if (BLOCKED_SVG_ELEMENTS.has(localName) || localName.startsWith('fe')) {
      throw new BrandingImageValidationError(`O elemento SVG <${localName}> nao e permitido.`)
    }

    elementCount += 1
    if (elementCount > SVG_MAX_ELEMENTS) throw svgTooComplex()
    const attributes = parseSvgAttributes(elementBody.slice(rawName.length))
    attributeCount += attributes.length
    if (attributeCount > SVG_MAX_ATTRIBUTES) throw svgTooComplex()

    let rootNamespace: string | null = null
    for (const attribute of attributes) {
      const fullName = attribute.name.toLowerCase()
      const localAttributeName = xmlLocalName(fullName)
      const value = decodeXmlReferences(attribute.value)
      if (value.length > SVG_MAX_ATTRIBUTE_VALUE_CHARS) throw svgTooComplex()
      if (
        fullName === 'xml:base'
        || localAttributeName.startsWith('on')
        || localAttributeName === 'filter'
        || localAttributeName === 'mask'
        || localAttributeName === 'marker'
        || localAttributeName.startsWith('marker-')
      ) {
        throw new BrandingImageValidationError(`O atributo SVG ${attribute.name} nao e permitido.`)
      }
      if (localAttributeName === 'href' || localAttributeName === 'src') {
        const reference = value.trim()
        if (reference && !isSafeSvgFragment(reference)) {
          throw new BrandingImageValidationError('A logomarca SVG nao pode carregar recursos externos ou incorporados.')
        }
      }
      if (fullName === 'xmlns') rootNamespace = value
      if (fullName === 'xmlns:xml' && value !== XML_NAMESPACE) throw invalidSvg()
      if (fullName === 'xmlns:xlink' && value !== XLINK_NAMESPACE) throw invalidSvg()
      validateSvgCss(value)
      if (localAttributeName === 'd') {
        pathDataChars += value.length
        if (pathDataChars > SVG_MAX_PATH_DATA_CHARS) throw svgTooComplex()
      }
      if (localAttributeName === 'style') {
        styleChars += value.length
        if (styleChars > SVG_MAX_STYLE_CHARS) throw svgTooComplex()
      }
    }
    if (elementCount === 1 && rootNamespace !== SVG_NAMESPACE) {
      throw new BrandingImageValidationError('A raiz SVG deve declarar o namespace padrao oficial.')
    }

    if (!selfClosing) {
      stack.push({ rawName, localName })
      if (stack.length > SVG_MAX_DEPTH) throw svgTooComplex()
    } else if (elementCount === 1) {
      rootClosed = true
    }
  }

  if (!elementCount || stack.length || !rootClosed) throw invalidSvg()
}

function parseSvgAttributes(source: string): Array<{ name: string; value: string }> {
  const attributes: Array<{ name: string; value: string }> = []
  const names = new Set<string>()
  const attributeName = /[A-Za-z_][A-Za-z0-9_.:-]*/y
  let cursor = 0
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor)
    if (cursor >= source.length) break
    attributeName.lastIndex = cursor
    const nameMatch = attributeName.exec(source)
    if (!nameMatch) throw invalidSvg()
    const name = nameMatch[0]
    cursor += name.length
    cursor = skipWhitespace(source, cursor)
    if (source[cursor] !== '=') throw invalidSvg()
    cursor = skipWhitespace(source, cursor + 1)
    const quote = source[cursor]
    if (quote !== '"' && quote !== "'") throw invalidSvg()
    const valueEnd = source.indexOf(quote, cursor + 1)
    if (valueEnd < 0) throw invalidSvg()
    const value = source.slice(cursor + 1, valueEnd)
    if (value.includes('<')) throw invalidSvg()
    const normalizedName = name.toLowerCase()
    if (names.has(normalizedName)) throw invalidSvg()
    names.add(normalizedName)
    attributes.push({ name, value })
    cursor = valueEnd + 1
  }
  return attributes
}

function decodeXmlReferences(value: string): string {
  let output = ''
  let cursor = 0
  const entity = /&([^;]{1,32});/g
  for (let match = entity.exec(value); match; match = entity.exec(value)) {
    const plain = value.slice(cursor, match.index)
    if (plain.includes('&')) throw invalidSvg()
    output += plain + decodeXmlEntity(match[1])
    cursor = match.index + match[0].length
  }
  const tail = value.slice(cursor)
  if (tail.includes('&')) throw invalidSvg()
  return output + tail
}

function decodeXmlEntity(entity: string): string {
  const predefined: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  }
  if (Object.prototype.hasOwnProperty.call(predefined, entity)) return predefined[entity]
  const numeric = entity.match(/^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/)
  if (!numeric) throw invalidSvg()
  const codePoint = Number.parseInt(numeric[1] || numeric[2], numeric[1] ? 16 : 10)
  if (
    !Number.isSafeInteger(codePoint)
    || codePoint <= 0
    || codePoint > 0x10FFFF
    || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
    || (codePoint < 0x20 && ![0x09, 0x0A, 0x0D].includes(codePoint))
    || codePoint === 0x7F
  ) throw invalidSvg()
  return String.fromCodePoint(codePoint)
}

function validateSvgCss(value: string): void {
  if (!value) return
  if (
    /\\|\/\*|\*\/|@\s*import|java\s*script\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)
  ) {
    throw new BrandingImageValidationError('A logomarca SVG contem CSS ativo ou ofuscado.')
  }
  const withoutSafeUrls = value.replace(
    /url\s*\(\s*(?:#[A-Za-z0-9_.:-]{1,256}|'#[A-Za-z0-9_.:-]{1,256}'|"#[A-Za-z0-9_.:-]{1,256}")\s*\)/gi,
    '',
  )
  if (/url\s*\(/i.test(withoutSafeUrls)) {
    throw new BrandingImageValidationError('A logomarca SVG nao pode carregar recursos externos ou incorporados.')
  }
  if (
    /(?:^|[;{])\s*(?:-webkit-)?(?:backdrop-)?filter\s*:/i.test(value)
    || /(?:^|[;{])\s*(?:mask(?:-image)?|marker(?:-start|-mid|-end)?)\s*:/i.test(value)
  ) {
    throw new BrandingImageValidationError('A logomarca SVG contem efeitos vetoriais nao permitidos.')
  }
}

function isSafeSvgFragment(value: string): boolean {
  return /^#[A-Za-z_][A-Za-z0-9_.:-]{0,255}$/.test(value)
}

function findSvgTagEnd(source: string, start: number): number {
  let quote = ''
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return cursor
    } else if (character === '<') {
      return -1
    }
  }
  return -1
}

function skipWhitespace(value: string, start: number): number {
  let cursor = start
  while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1
  return cursor
}

function xmlLocalName(value: string): string {
  return value.toLowerCase().split(':').at(-1) || ''
}

function invalidSvg(): BrandingImageValidationError {
  return new BrandingImageValidationError('O conteudo enviado nao e um SVG estatico valido.')
}

function svgTooComplex(): BrandingImageValidationError {
  return new BrandingImageValidationError('A logomarca SVG excede a complexidade permitida.')
}

export function detectBrandingImageFormat(bytes: Buffer): BrandingImageFormat | null {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
  ) return 'png'
  if (
    bytes.length >= 3
    && bytes[0] === 0xFF
    && bytes[1] === 0xD8
    && bytes[2] === 0xFF
  ) return 'jpeg'
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp'
  return null
}
