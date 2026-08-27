import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  categoriaColor,
  categoriaLabel,
  montarCorporateDashboardReportDeLinhas,
} from '@/lib/reporting/corporate-dashboard'
import type { LinhaDetalheRelatorio } from '@/lib/relatorios'
import type { TipoServico } from '@/types'

function linha(id: string, tipo: TipoServico, total: number): LinhaDetalheRelatorio {
  return {
    id,
    data: '2026-08-15',
    passageiro: `Viajante ${id}`,
    empresa: 'Empresa Portal Teste',
    tipo,
    localizador: `LOC-${id}`,
    fornecedor: tipo === 'Rodoviário' ? 'Operadora Rodoviária Teste' : 'Fornecedor Teste',
    destino: 'Brasília',
    status: 'finalizado',
    custo: total,
    venda: total,
    markup: 0,
    taxa: 0,
    total,
    valorReferencia: total,
    referenciaFonte: 'contrato',
    economia: 0,
    oportunidadeEconomia: 0,
    antecedenciaDias: 10,
    co2Kg: 0,
    pendencias: [],
    servicoResumo: tipo,
    servicoDetalhes: [],
  }
}

describe('categoria rodoviária do dashboard corporativo', () => {
  it('normaliza Rodoviário, Ônibus e Transporte rodoviário na mesma categoria própria', () => {
    expect(categoriaLabel('Rodoviário')).toBe('Rodoviário / Ônibus')
    expect(categoriaLabel('Ônibus')).toBe('Rodoviário / Ônibus')
    expect(categoriaLabel('Transporte rodoviário')).toBe('Rodoviário / Ônibus')
    expect(categoriaColor('Rodoviário')).not.toBe(categoriaColor('Outro'))
  })

  it('não soma despesas rodoviárias em Outros e permite filtrá-las isoladamente', () => {
    const linhas = [
      linha('bus-1', 'Rodoviário', 180),
      linha('bus-2', 'Rodoviário', 120),
      linha('other-1', 'Outro', 50),
    ]
    const periodo = { inicio: '2026-08-01', fim: '2026-08-31' }

    const consolidado = montarCorporateDashboardReportDeLinhas(linhas, periodo)
    const rodoviario = consolidado.categorias.find((categoria) => categoria.tipo === 'Rodoviário')
    const outros = consolidado.categorias.find((categoria) => categoria.tipo === 'Outro')

    expect(rodoviario).toMatchObject({
      label: 'Rodoviário / Ônibus',
      quantidade: 2,
      total: 300,
    })
    expect(outros).toMatchObject({ quantidade: 1, total: 50 })

    const filtrado = montarCorporateDashboardReportDeLinhas(linhas, periodo, { categoria: 'Rodoviário' })
    expect(filtrado.linhas.map((item) => item.id)).toEqual(['bus-1', 'bus-2'])
    expect(filtrado.kpis.total).toBe(300)
    expect(filtrado.filtrosAtivos).toContain('Categoria: Rodoviário / Ônibus')
  })

  it('mantém a categoria rodoviária também no relatório HTML exportável', () => {
    const htmlSource = readFileSync(resolve(process.cwd(), 'lib/reporting/corporate-dashboard-html.ts'), 'utf8')
    expect(htmlSource).toContain("['todos','Aéreo','Hotel','Carro','Rodoviário','Pacote','Outro']")
    expect(htmlSource).toContain("return 'RODOVIARIO'")
    expect(htmlSource).toContain("k === 'RODOVIARIO' ? 'Rodoviário / Ônibus'")
  })
})
