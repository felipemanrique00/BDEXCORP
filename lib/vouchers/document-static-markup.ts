import {
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

const UNITLESS_CSS_PROPERTIES = new Set([
  'animationIterationCount', 'borderImageOutset', 'borderImageSlice',
  'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup',
  'columnCount', 'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink',
  'flexNegative', 'flexOrder', 'gridArea', 'gridColumn', 'gridColumnEnd',
  'gridColumnSpan', 'gridColumnStart', 'gridRow', 'gridRowEnd', 'gridRowSpan',
  'gridRowStart', 'fontWeight', 'lineClamp', 'lineHeight', 'opacity', 'order',
  'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom',
])

/**
 * Serializa a árvore pura do VoucherDocument sem depender de react-dom/server,
 * que o Next.js bloqueia dentro das rotas do App Router. Componentes funcionais
 * sem hooks são resolvidos recursivamente; nenhuma string HTML paralela existe.
 */
export function renderDocumentStaticMarkup(node: ReactNode): string {
  return renderNode(node)
}

function renderNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    return escapeHtml(String(node))
  }
  if (Array.isArray(node)) return node.map(renderNode).join('')
  if (!isValidElement(node)) return ''
  return renderElement(node)
}

function renderElement(element: ReactElement): string {
  if (element.type === Fragment) return renderNode(readProps(element).children as ReactNode)
  if (typeof element.type === 'function') {
    const component = element.type as (props: Record<string, unknown>) => ReactNode
    return renderNode(component(readProps(element)))
  }
  if (typeof element.type !== 'string') {
    throw new Error('O documento do voucher contem um elemento nao serializavel.')
  }

  const tag = element.type
  const props = readProps(element)
  const attributes = renderAttributes(props)
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attributes}/>`
  return `<${tag}${attributes}>${renderNode(props.children as ReactNode)}</${tag}>`
}

function readProps(element: ReactElement): Record<string, unknown> {
  return (element.props || {}) as Record<string, unknown>
}

function renderAttributes(props: Record<string, unknown>): string {
  const values: string[] = []
  for (const [rawName, rawValue] of Object.entries(props)) {
    if (
      rawName === 'children'
      || rawName === 'key'
      || rawName === 'ref'
      || rawName === 'dangerouslySetInnerHTML'
      || rawValue === undefined
      || rawValue === null
      || rawValue === false
      || typeof rawValue === 'function'
    ) continue

    const name = rawName === 'className'
      ? 'class'
      : rawName === 'htmlFor'
        ? 'for'
        : rawName
    if (rawName === 'style' && typeof rawValue === 'object') {
      const style = renderStyle(rawValue as CSSProperties)
      if (style) values.push(`style="${escapeHtml(style)}"`)
      continue
    }
    if (rawValue === true) {
      values.push(name)
      continue
    }
    values.push(`${name}="${escapeHtml(String(rawValue))}"`)
  }
  return values.length ? ` ${values.join(' ')}` : ''
}

function renderStyle(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${cssPropertyName(name)}:${cssPropertyValue(name, value as string | number)}`)
    .join(';')
}

function cssPropertyName(value: string): string {
  return value
    .replace(/^ms-/, '-ms-')
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function cssPropertyValue(name: string, value: string | number): string {
  if (typeof value !== 'number' || value === 0 || UNITLESS_CSS_PROPERTIES.has(name) || name.startsWith('--')) {
    return String(value)
  }
  return `${value}px`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
