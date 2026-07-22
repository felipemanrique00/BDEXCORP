import { describe, expect, it } from 'vitest'

import {
  compararNomeFuncionario,
  encontrarFuncionarioPorNomeInteligente,
  normalizarNomePessoa,
} from '@/lib/funcionario-identidade'
import type { Funcionario } from '@/types'

const aldo = {
  id: 'func-1',
  company_id: 'empresa-1',
  codigo_identificacao: '1025',
  nome: 'ALDO FERNANDES JUNIOR',
  aliases_nome: ['ALDO JUNIOR'],
} as Funcionario

describe('employee identity matching', () => {
  it.each([
    'FERNANDES JUNIOR/ALDO',
    'ALDO JUNIOR',
    'ALDO FERNANDES',
    'ALDO FERNANDES JUNIOR',
  ])('vincula a variacao %s ao mesmo colaborador', (name) => {
    const match = encontrarFuncionarioPorNomeInteligente([aldo], name, 'empresa-1')
    expect(match?.funcionario.id).toBe('func-1')
    expect(match?.ambiguo).not.toBe(true)
  })

  it('prioriza alias confirmado e nao aceita apenas primeiro nome como match seguro', () => {
    expect(compararNomeFuncionario('ALDO JUNIOR', aldo)).toMatchObject({ score: 100, motivo: 'alias_manual' })
    expect(encontrarFuncionarioPorNomeInteligente([aldo], 'ALDO', 'empresa-1')).toBeNull()
  })

  it('normaliza formato sobrenome/nome sem perder o sufixo', () => {
    expect(normalizarNomePessoa('FERNANDES JUNIOR/ALDO').normalizados).toContain('aldo fernandes junior')
  })
})
