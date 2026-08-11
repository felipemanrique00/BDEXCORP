import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  clampDecimalInputNumber,
  decimalInputToCanonical,
  decimalInputToNumber,
  formatDecimalInput,
  numberToDecimalInput,
  sanitizeDecimalInput,
} from '@/lib/decimal-input'

describe('decimal input', () => {
  it('accepts comma, dot and pasted Brazilian currency without browser number controls', () => {
    expect(sanitizeDecimalInput('1234.5')).toBe('1234,5')
    expect(sanitizeDecimalInput('R$ 1.234,56')).toBe('1234,56')
    expect(sanitizeDecimalInput('1,234.56')).toBe('1234,56')
    expect(sanitizeDecimalInput(',5')).toBe('0,5')
  })

  it('limits and completes decimal places deterministically', () => {
    expect(formatDecimalInput('')).toBe('')
    expect(sanitizeDecimalInput('12,3456')).toBe('12,34')
    expect(formatDecimalInput('12')).toBe('12,00')
    expect(formatDecimalInput('12,3')).toBe('12,30')
    expect(formatDecimalInput('400.00')).toBe('400,00')
    expect(formatDecimalInput('1,2', 4)).toBe('1,2000')
    expect(decimalInputToCanonical('0012,3')).toBe('12.30')
  })

  it('keeps localized drafts separate from numeric API values', () => {
    expect(decimalInputToNumber('')).toBeNull()
    expect(decimalInputToNumber('1.234,56')).toBe(1234.56)
    expect(decimalInputToNumber('12,')).toBe(12)
    expect(numberToDecimalInput(null)).toBe('')
    expect(numberToDecimalInput(0)).toBe('0,00')
    expect(numberToDecimalInput(1234.5)).toBe('1234,50')
    expect(clampDecimalInputNumber(125, 0, 100)).toBe(100)
    expect(clampDecimalInputNumber(-1, 0, 100)).toBe(0)
    expect(clampDecimalInputNumber(null, 0, 100)).toBeNull()
  })

  it('uses text plus decimal input mode so native spinner artifacts cannot appear', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/ui/decimal-input.tsx'), 'utf8')
    expect(source).toContain('type="text"')
    expect(source).toContain('inputMode="decimal"')
    expect(source).toContain('formatDecimalInput(event.currentTarget.value, scale)')
    expect(source).toContain('export const NumericDecimalInput')
    expect(source).toContain('onNumberChange(clampDecimalInputNumber(')
    expect(source).not.toContain('type="number"')
  })

  it('forbids native fractional-step number inputs throughout app and components', () => {
    const violations: string[] = []

    for (const root of ['app', 'components']) {
      for (const filePath of tsxFiles(resolve(process.cwd(), root))) {
        const source = readFileSync(filePath, 'utf8')
        const sourceFile = ts.createSourceFile(
          filePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        )

        const visit = (node: ts.Node) => {
          if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
            && node.tagName.getText(sourceFile) === 'input'
          ) {
            const type = staticJsxAttribute(node.attributes, 'type')
            const step = staticJsxAttribute(node.attributes, 'step')
            const numericStep = step === null ? null : Number(step)
            if (
              type === 'number'
              && numericStep !== null
              && Number.isFinite(numericStep)
              && numericStep > 0
              && !Number.isInteger(numericStep)
            ) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              violations.push(`${relative(process.cwd(), filePath)}:${line + 1}`)
            }
          }
          ts.forEachChild(node, visit)
        }

        visit(sourceFile)
      }
    }

    expect(violations, 'Use DecimalInput/NumericDecimalInput for fractional values').toEqual([])
  })

  it('keeps known corporate monetary bindings on the numeric decimal adapter', () => {
    const portalSource = readFileSync(
      resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
      'utf8',
    )
    for (const binding of [
      'limiteCredito',
      'limitePix',
      'limiteCartao',
      'valorAporte',
      'pixValor',
      'cardForm.limite',
    ]) {
      expect(portalSource).toContain(`<NumericDecimalInput value={${binding}}`)
    }

    const requesterSource = readFileSync(
      resolve(process.cwd(), 'components/empresas/solicitantes-empresa-tab.tsx'),
      'utf8',
    )
    expect(requesterSource).toMatch(/<NumericDecimalInput\s+value=\{limite\}/)
  })
})

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })
}

function staticJsxAttribute(attributes: ts.JsxAttributes, name: string): string | null {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property)
      && property.name.getText() === name,
  )
  if (!attribute?.initializer) return null
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return null

  const expression = attribute.initializer.expression
  return ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)
    ? expression.text
    : null
}
