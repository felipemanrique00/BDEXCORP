import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const headerSource = readFileSync(resolve(process.cwd(), 'components/header.tsx'), 'utf8')
const transfersSource = readFileSync(
  resolve(process.cwd(), 'components/ui/transferencias-pendentes-painel.tsx'),
  'utf8',
)

describe('header hydration', () => {
  it('uses the server-provided user for the pending-transfers trigger', () => {
    expect(headerSource).toContain('<TransferenciasPendentesPainel userId={user.id} />')
    expect(transfersSource).toContain('userId: string')
    expect(transfersSource).not.toContain("typeof window !== 'undefined'")
    expect(transfersSource).not.toContain('getCurrentUser')
  })

  it('keeps the trigger in the initial render tree', () => {
    expect(transfersSource).not.toMatch(/if\s*\(!user(?:Id)?\)\s*return\s+null/)
    expect(transfersSource).toContain('aria-label="Transferências pendentes"')
  })
})
