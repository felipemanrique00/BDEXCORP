import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const importModal = readFileSync(
  resolve(process.cwd(), 'components/ui/importar-funcionarios-modal.tsx'),
  'utf8',
)

describe('employee spreadsheet air profile validation', () => {
  it('uses the same air profile validator for every spreadsheet row', () => {
    expect(importModal).toContain("import { validateEmployeeAirProfileForm } from '@/lib/travelers/employee-air-profile-form'")
    expect(importModal).toContain('const airProfile = validateEmployeeAirProfileForm({')
    expect(importModal).toContain('nome: nome.valor')
    expect(importModal).toContain('cpf: cpfLimpo')
    expect(importModal).toContain('data_nascimento: dataFormatada')
    expect(importModal).not.toContain('.filter((l) => l.nome)')
  })

  it('imports only valid rows and explains why the remaining rows were skipped', () => {
    expect(importModal).toContain('const invalidas = selecionadas.filter((linha) => !linha.valido)')
    expect(importModal).toContain('const paraImportar = selecionadas.filter((linha) => linha.valido)')
    expect(importModal).toContain("l.valido ? 'Pronto para aéreo' : `Linha ${l.linha_numero}:")
    expect(importModal).toContain('Ver inconsistências por linha')
    expect(importModal).toContain('linha(s) inválida(s) serão ignoradas')
    expect(importModal).toContain('disabled={importing || validasNoFiltro === 0}')
    expect(importModal).toContain('await commitPendingRemoteStorage()')
  })
})
