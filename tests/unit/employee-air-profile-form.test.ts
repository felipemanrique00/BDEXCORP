import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateEmployeeAirProfileForm } from '@/lib/travelers/employee-air-profile-form'

const employeePage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/funcionarios/page.tsx'),
  'utf8',
)

describe('employee air profile form', () => {
  it('accepts and normalizes the minimum identity required for air travel', () => {
    const result = validateEmployeeAirProfileForm({
      nome: '  Maria   da Silva  ',
      cpf: '529.982.247-25',
      data_nascimento: '1990-05-20',
    })

    expect(result).toEqual({
      ok: true,
      errors: {},
      normalized: {
        nome: 'Maria da Silva',
        cpf: '52998224725',
        data_nascimento: '1990-05-20',
      },
    })
  })

  it('requires first name, last name, a valid CPF and a real non-future birth date', () => {
    const invalidCalendarDate = validateEmployeeAirProfileForm({
      nome: 'Maria',
      cpf: '111.111.111-11',
      data_nascimento: '2024-02-30',
    })
    const futureDate = validateEmployeeAirProfileForm({
      nome: 'Maria da Silva',
      cpf: '529.982.247-25',
      data_nascimento: '2999-01-01',
    })

    expect(invalidCalendarDate.ok).toBe(false)
    expect(invalidCalendarDate.errors.nome).toContain('sobrenome')
    expect(invalidCalendarDate.errors.cpf).toContain('CPF válido')
    expect(invalidCalendarDate.errors.data_nascimento).toContain('não esteja no futuro')
    expect(futureDate.ok).toBe(false)
    expect(futureDate.errors).toEqual({
      data_nascimento: 'Informe uma data de nascimento real e que não esteja no futuro.',
    })
  })

  it('marks the three air identity fields as required in the employee modal', () => {
    expect(employeePage).toContain('label="Nome completo *"')
    expect(employeePage).toContain('id="employee-cpf"')
    expect(employeePage).toContain('label="Data de Nascimento *"')
    expect(employeePage).toContain('validateEmployeeAirProfileForm({')
    expect(employeePage).toContain('max={todayISODate()}')
  })

  it('separates view, create and manage company scopes in the employee UI', () => {
    expect(employeePage).toContain('const [user, setUser] = useState<ReturnType<typeof getCurrentUser>>(null)')
    expect(employeePage).toContain('setUser(getCurrentUser())')
    expect(employeePage).toContain('if (!user) return')
    expect(employeePage).toContain('const empresasDoEscopo = getEmpresasPermitidas(')
    expect(employeePage).toContain("includesCompany(empresa.id, 'cadastrar_funcionarios')")
    expect(employeePage).toContain("|| includesCompany(empresa.id, 'gerenciar_funcionarios')")
    expect(employeePage).toContain('const empresasPermitidasParaGerenciamento = empresasDoEscopo')
    expect(employeePage).toContain('empresas={editing ? empresasPermitidasParaGerenciamento : empresasPermitidasParaCadastro}')
  })

  it('keeps validation and row actions accessible', () => {
    expect(employeePage).toContain('ref={formRef}')
    expect(employeePage).toContain('noValidate aria-busy={saving}')
    expect(employeePage).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')")
    expect(employeePage).toContain('<caption className="sr-only">')
    expect(employeePage).toContain('<th scope="col"')
    expect(employeePage).toContain('aria-label={`Editar ${f.nome}`}')
    expect(employeePage).toContain("value={form.cpf ? maskCPF(onlyDigits(form.cpf).slice(0, 11)) : ''}")
  })

  it('reports every missing mandatory air identity field', () => {
    const result = validateEmployeeAirProfileForm({
      nome: '',
      cpf: '',
      data_nascimento: '',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual({
      nome: 'Informe o nome completo do passageiro.',
      cpf: 'Informe o CPF do passageiro.',
      data_nascimento: 'Informe a data de nascimento do passageiro.',
    })
  })

  it('waits for the remote commit and keeps the modal in a saving state', () => {
    const commitCall = employeePage.indexOf('await commitPendingRemoteStorage()')
    const successToast = employeePage.indexOf("toast.success('Funcionário atualizado!')")

    expect(employeePage).toContain('onSave={async (data) => {')
    expect(employeePage).toContain('onSave: (data: Partial<Funcionario>) => Promise<void>')
    expect(employeePage).toContain('const [saving, setSaving] = useState(false)')
    expect(employeePage).toContain("saving ? 'Salvando...' : editing ? 'Salvar' : 'Cadastrar'")
    expect(employeePage).toContain('updateFuncionario(editing.id, editing)')
    expect(employeePage).toContain('deleteFuncionario(created.id)')
    expect(commitCall).toBeGreaterThan(-1)
    expect(successToast).toBeGreaterThan(commitCall)
  })
})
