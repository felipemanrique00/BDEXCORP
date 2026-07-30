import { describe, expect, it } from 'vitest'

import { resolveEmployeeIdentity, type EmployeeIdentityCandidate } from '@/lib/employee-identity/matching'

const employees: EmployeeIdentityCandidate[] = [
  {
    id: 'employee-aldo',
    companyId: 'company-a',
    identificationCode: '1025',
    fullName: 'ALDO FERNANDES JUNIOR',
    documentNumber: '12345678900',
    email: 'aldo@empresa.com.br',
    registrationCode: 'MAT-99',
    aliases: ['FERNANDES JUNIOR/ALDO'],
  },
  {
    id: 'employee-aldo-souza',
    companyId: 'company-a',
    identificationCode: '1026',
    fullName: 'ALDO SOUZA',
    documentNumber: '98765432100',
    email: 'aldo.souza@empresa.com.br',
    registrationCode: 'MAT-100',
    aliases: [],
  },
]

describe('employee identity matching', () => {
  it.each([
    'FERNANDES JUNIOR/ALDO',
    'ALDO JUNIOR',
    'ALDO FERNANDES',
    'ALDO FERNANDES JUNIOR',
  ])('consolida a variacao %s no mesmo ID', (name) => {
    const result = resolveEmployeeIdentity(employees, 'company-a', { name })
    expect(result.employeeId).toBe('employee-aldo')
    expect(result.confidence).toBeGreaterThanOrEqual(0.84)
  })

  it('prioriza o ID unico e os identificadores confiaveis', () => {
    expect(resolveEmployeeIdentity(employees, 'company-a', {
      identificationCode: '1025',
      name: 'Nome incorreto',
    }).employeeId).toBe('employee-aldo')
    expect(resolveEmployeeIdentity(employees, 'company-a', {
      documentNumber: '123.456.789-00',
      name: 'Outro nome',
    }).employeeId).toBe('employee-aldo')
  })

  it('nao vincula automaticamente apenas pelo primeiro nome ambiguo', () => {
    const result = resolveEmployeeIdentity(employees, 'company-a', { name: 'ALDO' })
    expect(result.employeeId).toBeNull()
    expect(['ambiguous', 'unresolved']).toContain(result.status)
  })

  it('nunca cruza empresas durante a deteccao', () => {
    const result = resolveEmployeeIdentity(employees, 'company-b', {
      identificationCode: '1025',
      name: 'ALDO FERNANDES JUNIOR',
    })
    expect(result.employeeId).toBeNull()
  })
})
