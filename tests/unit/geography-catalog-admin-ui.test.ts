import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'components/suppliers/offline-supplier-catalog.tsx'),
  'utf8',
)

describe('geography catalog administration UI', () => {
  it('loads and presents independent status for locations and airports', () => {
    expect(source).toContain('getGeographySyncStatus')
    expect(source).toContain('getAirportCatalogSyncStatus')
    expect(source).toContain('Países, estados e cidades')
    expect(source).toContain('Aeroportos e códigos IATA')
  })

  it('allows authorized administrators to synchronize both catalogs', () => {
    expect(source).toContain("hasPermission(user, 'alterar_configuracoes')")
    expect(source).toContain('syncGeographyFromIbge')
    expect(source).toContain('syncAirportCatalog')
    expect(source).toContain('Sincronizar localidades')
    expect(source).toContain('Sincronizar aeroportos')
  })

  it('explains empty catalogs instead of presenting them as a search with no match', () => {
    expect(source).toContain('Estados e cidades ainda não foram carregados neste ambiente')
    expect(source).toContain('Nenhum aeroporto foi carregado neste ambiente')
  })
})
