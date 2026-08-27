import { describe, expect, it } from 'vitest'

import {
  buildWintourCreationXml,
  buildWintourUpdateXml,
  type WintourCreationFile,
  type WintourCreationSale,
  WintourXmlValidationError,
} from '@/lib/integrations/wintour/wintour-xml'

function hotelSale(overrides: Partial<WintourCreationSale> = {}): WintourCreationSale {
  return {
    idv_externo: 12345,
    dt_interna_cadastro: '20/08/2026',
    data_lancamento: '20/08/2026',
    codigo_produto: 'HOTEL',
    prestador_svc: 'JW Marriott',
    num_bilhete: 'HTL0000001',
    forma_de_pagamento: 'IV',
    moeda: 'BRL',
    passageiro: 'João da Silva',
    tipo_passageiro: 'A',
    tipo_domest_inter: 'D',
    tipo_roteiro: 2,
    tarifa_net: 0,
    valores: [{ codigo: 'tarifa', valor: '1250.00' }],
    roteiro: {
      hotel: {
        nr_apts: 1,
        tipo_apt: 'DBL',
        dt_check_in: '21/08/2026',
        dt_check_out: '24/08/2026',
      },
    },
    ...overrides,
  }
}

function creationFile(sales: WintourCreationSale[] = [hotelSale()]): WintourCreationFile {
  return {
    nr_arquivo: 77,
    data_geracao: '20/08/2026',
    hora_geracao: '14:35',
    nome_agencia: 'BBT Corporação',
    vendas: sales,
  }
}

describe('Wintour outbound XML', () => {
  it('generates the Wintour v4 creation layout with ISO entities and valid nested records', () => {
    const xml = buildWintourCreationXml(creationFile([
      hotelSale({
        info_adicionais: 'Hóspede chegará após as 22h.',
        dados_cliente: {
          acao_cli: 'IU',
          razao_social: 'Empresa Coração',
          cpf_cnpj: '12.345.678/0001-90',
        },
      }),
    ]))

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="iso-8859-1"\?>/)
    expect(xml).toContain('<versao_xml>4</versao_xml>')
    expect(xml).toContain('<nome_agencia>BBT Corpora&#231;&#227;o</nome_agencia>')
    expect(xml).toContain('<passageiro>Jo&#227;o da Silva</passageiro>')
    expect(xml).toContain('<valor>1250.00</valor>')
    expect(xml).toContain('<hotel>')
    expect(xml).toContain('<dt_check_in>21/08/2026</dt_check_in>')
    expect(xml).toContain('<info_adicionais><![CDATA[Hóspede chegará após as 22h.]]></info_adicionais>')
    expect(xml).toContain('<dados_cliente>')
    expect(xml).toContain('</dados_cliente>')
    expect(xml).not.toContain('<dados_cliente>\n  </bilhete>')
  })

  it('normalizes numeric amounts and enforces conditional payment/account fields', () => {
    const valid = hotelSale({
      forma_de_pagamento: 'EP',
      cartao_mp: 'MP-001',
      conta_taxas_adicionais: 'FEE-001',
      valores: [
        { codigo: 'tarifa', valor: 1000 },
        { codigo: 'fee', valor: 100, valor_mp: 40 },
        { codigo: 'cambio', valor: 5.25 },
      ],
    })
    const xml = buildWintourCreationXml(creationFile([valid]))

    expect(xml).toContain('<valor>1000.00</valor>')
    expect(xml).toContain('<valor_mp>40.00</valor_mp>')
    expect(xml).toContain('<valor>5.25000000</valor>')

    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({ forma_de_pagamento: 'CP' }),
    ]))).toThrow(/cartao_cp/)
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({ valores: [{ codigo: 'fee', valor: '10.00' }] }),
    ]))).toThrow(/conta_taxas_adicionais/)
  })

  it('enforces the documented valor_df/valor_mp matrix for each payment method', () => {
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'CA',
        valores: [{ codigo: 'tarifa', valor: '100.00', valor_df: '100.00' }],
      }),
    ]))).toThrow(/valor_df.*nao e permitido.*CA/)

    expect(buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'CE',
        valores: [{ codigo: 'tarifa', valor: '100.00', valor_df: '50.00' }],
      }),
    ]))).toContain('<valor_df>50.00</valor_df>')
    expect(buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'EP',
        cartao_mp: 'MP-001',
        valores: [{ codigo: 'tarifa', valor: '100.00', valor_mp: '50.00' }],
      }),
    ]))).toContain('<valor_mp>50.00</valor_mp>')

    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'DM',
        cartao_mp: 'MP-001',
        valores: [{ codigo: 'tarifa', valor: '100.00' }],
      }),
    ]))).toThrow(/valor_df.*obrigatorio.*DM/)
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'DM',
        cartao_mp: 'MP-001',
        valores: [{ codigo: 'tarifa', valor: '100.00', valor_df: '50.00' }],
      }),
    ]))).toThrow(/valor_mp.*obrigatorio.*DM/)
    expect(buildWintourCreationXml(creationFile([
      hotelSale({
        forma_de_pagamento: 'DM',
        cartao_mp: 'MP-001',
        valores: [{ codigo: 'tarifa', valor: '100.00', valor_df: '50.00', valor_mp: '50.00' }],
      }),
    ]))).toContain('<valor_mp>50.00</valor_mp>')
  })

  it('fails closed for unknown fields, invalid dates, unsupported characters, and files over 100 sales', () => {
    const unknown = creationFile() as WintourCreationFile & { extra?: string }
    unknown.extra = 'not-allowed'
    expect(() => buildWintourCreationXml(unknown)).toThrow(WintourXmlValidationError)
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({ data_lancamento: '31/02/2026' }),
    ]))).toThrow(/data invalida/)
    expect(() => buildWintourCreationXml({ ...creationFile(), nome_agencia: 'BBT 🚀' })).toThrow(/layout Wintour/)
    const euro = buildWintourCreationXml({ ...creationFile(), nome_agencia: 'Preço €' })
    expect(euro).toContain('<nome_agencia>Pre&#231;o &#8364;</nome_agencia>')
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({ info_adicionais: 'Preço €' }),
    ]))).toThrow(/ISO-8859-1/)
    expect(() => buildWintourCreationXml(creationFile(
      Array.from({ length: 101 }, (_, index) => hotelSale({ idv_externo: index + 1 })),
    ))).toThrow(/100 vendas/)
  })

  it('generates DGR-046 updates using only allowlisted fields and the documented special remarks', () => {
    const xml = buildWintourUpdateXml({
      recalculateCalculatedFields: 'S',
      sales: [{
        nr: 313792,
        changes: [
          { field: 'vl_tarifa_df', content: 4500 },
          { field: 'info_internas', content: 'Alteração do período de hospedagem', remark: 'append' },
          { field: 'dt_inicio_servicos', content: '10/05/2026' },
          { field: 'fop', content: 'XX', remark: 'xxmanter' },
        ],
      }],
    })

    expect(xml).toContain('<recalcula_campos_calculados>S</recalcula_campos_calculados>')
    expect(xml).toContain('<campo>vl_tarifa_df</campo>')
    expect(xml).toContain('<conteudo>4500.00</conteudo>')
    expect(xml).toContain('<conteudo><![CDATA[Alteração do período de hospedagem]]></conteudo>')
    expect(xml).toContain('<remark>append</remark>')
    expect(xml).toContain('<remark>xxmanter</remark>')
  })

  it('rejects unsafe DGR-046 remarks, non-allowlisted fields, and id_pa mixed with other changes', () => {
    expect(() => buildWintourUpdateXml({
      sales: [{ nr: 1, changes: [{ field: 'vl_tarifa', content: '10.00', remark: 'append' }] }],
    })).toThrow(/remark nao e permitido/)
    expect(() => buildWintourUpdateXml({
      sales: [{ nr: 1, changes: [{ field: 'fop', content: 'IV', remark: 'xxmanter' }] }],
    })).toThrow(/remark nao e permitido/)
    expect(() => buildWintourUpdateXml({
      sales: [{ nr: 1, changes: [
        { field: 'id_pa', content: 2 },
        { field: 'status', content: 'OK' },
      ] }],
    })).toThrow(/id_pa nao pode ser alterado/)
    expect(() => buildWintourUpdateXml({
      sales: [{ nr: 1, changes: [{ field: 'campo_inventado' as 'status', content: 'x' }] }],
    })).toThrow(/valor nao permitido/)
  })

  it('requires a single route matching tipo_roteiro and at least one sale/change', () => {
    expect(() => buildWintourCreationXml(creationFile([
      hotelSale({ tipo_roteiro: 1 }),
    ]))).toThrow(/roteiro aereo/)
    expect(() => buildWintourUpdateXml({ sales: [] })).toThrow(/ao menos uma venda/)
    expect(() => buildWintourUpdateXml({ sales: [{ nr: 1, changes: [] }] })).toThrow(/ao menos uma alteracao/)
  })
})
