import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { airPassengerProfileIssueMessage } from '@/lib/air-demand/passenger-selection'

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('traveler profile issue copy', () => {
  it('distinguishes a missing or invalid CPF without changing other issue messages', () => {
    expect(airPassengerProfileIssueMessage('cpf')).toBe('CPF ausente ou inválido')
    expect(airPassengerProfileIssueMessage('birth_date')).toBe('Falta data de nascimento')

    const selectors = [
      read('components/travel/air-demand-passengers.tsx'),
      read('components/travel/hotel-traveler-slot-picker.tsx'),
    ]

    for (const source of selectors) {
      expect(source).toContain('airPassengerProfileIssueMessage(issue)')
    }
  })

  it('explains that the completion dialog also corrects invalid information', () => {
    const dialog = read('components/travel/traveler-profile-dialog.tsx')

    expect(dialog).toContain(
      'Somente as informações ausentes ou inválidas podem ser corrigidas por este formulário.',
    )
  })
})
