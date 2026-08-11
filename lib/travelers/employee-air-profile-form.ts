import { assessAirTravelerProfile } from '@/lib/travelers/air-profile'

export interface EmployeeAirProfileFormInput {
  nome: unknown
  cpf: unknown
  data_nascimento: unknown
}

export interface EmployeeAirProfileFormErrors {
  nome?: string
  cpf?: string
  data_nascimento?: string
}

export interface EmployeeAirProfileFormValidation {
  ok: boolean
  errors: EmployeeAirProfileFormErrors
  normalized: {
    nome: string
    cpf: string
    data_nascimento: string
  }
}

/**
 * Valida os dados mínimos que permitem usar um funcionário como passageiro
 * aéreo. A validação só acontece ao criar/alterar o cadastro, portanto os
 * registros legados continuam preservados até serem editados.
 */
export function validateEmployeeAirProfileForm(
  input: EmployeeAirProfileFormInput,
): EmployeeAirProfileFormValidation {
  const assessment = assessAirTravelerProfile({
    name: input.nome,
    documentNumber: input.cpf,
    birthDate: input.data_nascimento,
  })
  const errors: EmployeeAirProfileFormErrors = {}
  const rawName = typeof input.nome === 'string' ? input.nome.trim() : ''
  const rawCpf = typeof input.cpf === 'string' ? input.cpf.trim() : ''
  const rawBirthDate = typeof input.data_nascimento === 'string'
    ? input.data_nascimento.trim()
    : ''

  if (
    assessment.profileIssues.includes('first_name')
    || assessment.profileIssues.includes('last_name')
  ) {
    errors.nome = rawName
      ? 'Informe o primeiro nome e pelo menos um sobrenome do passageiro.'
      : 'Informe o nome completo do passageiro.'
  }

  if (assessment.profileIssues.includes('cpf')) {
    errors.cpf = rawCpf
      ? 'Informe um CPF válido, com 11 dígitos e verificadores corretos.'
      : 'Informe o CPF do passageiro.'
  }

  if (assessment.profileIssues.includes('birth_date')) {
    errors.data_nascimento = rawBirthDate
      ? 'Informe uma data de nascimento real e que não esteja no futuro.'
      : 'Informe a data de nascimento do passageiro.'
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    normalized: {
      nome: assessment.name,
      cpf: assessment.cpf || '',
      data_nascimento: assessment.birthDate || '',
    },
  }
}
