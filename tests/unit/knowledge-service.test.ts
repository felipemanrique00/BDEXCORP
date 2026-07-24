import { describe, expect, it } from 'vitest'

import { splitKnowledgeContent } from '@/lib/server/knowledge-service'

describe('enterprise knowledge chunking', () => {
  it('keeps paragraphs readable and bounded', () => {
    const chunks = splitKnowledgeContent([
      'Politica de viagens corporativas com antecedencia minima de sete dias.',
      'A aprovacao do gestor deve ocorrer antes da emissao.',
      'Tarifas fora da politica exigem justificativa formal.',
    ].join('\n\n'))

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('antecedencia minima')
    expect(chunks[0]).toContain('justificativa formal')
    expect(chunks[0].length).toBeLessThanOrEqual(2_200)
  })

  it('splits long unbroken input without exceeding database limits', () => {
    const chunks = splitKnowledgeContent('A'.repeat(12_000))

    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(2_200)
    expect(chunks.join('')).toHaveLength(12_000)
  })
})
