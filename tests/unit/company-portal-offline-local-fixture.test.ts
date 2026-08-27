import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  GROUND_APPROVAL_ROUTES,
  assertSafeGroundApprovalWorkflow,
  buildGroundApprovalWorkflow,
  canonicalJson,
  groundSelectionApprovalActions,
  groundSelectionCondition,
} from '../../scripts/lib/company-portal-offline-approval-fixture.mjs'
import {
  COMPANY_PORTAL_DIRECTORY_IDS,
  assertCorporateDirectoryStorageCoversRelationalIds,
  assertFixtureCorporateDirectoryStorageValue,
  mergeFixtureCorporateDirectoryStorageValue,
} from '../../scripts/seed-local-company-portal-offline.mjs'
import { CORPORATE_PROFILE_PERMISSIONS } from '../../types'

const source = readFileSync(
  resolve(process.cwd(), 'scripts/seed-local-company-portal-offline.mjs'),
  'utf8',
)
const fixtureGuide = readFileSync(
  resolve(process.cwd(), 'docs/COMPANY-PORTAL-OFFLINE-GROUND-CATALOG.md'),
  'utf8',
)
const hotelMediaDirectory = resolve(
  process.cwd(),
  'scripts/fixtures/company-portal-hotels',
)
const hotelMediaManifest = readFileSync(resolve(hotelMediaDirectory, 'README.md'), 'utf8')
const hotelMediaAssets = [
  {
    file: 'jw-marriott-rio-de-janeiro.webp',
    sha256: '81be81706f2ade23498951f3cadab03b331f3de25204ac8b59f1f1bbe8c7a178',
  },
  {
    file: 'copacabana-palace-rio-de-janeiro.webp',
    sha256: 'a3964575d49521be02cab4cf0e3de8ed7085b5ded53efba89b16b99b30a8328e',
  },
  {
    file: 'brasilia-palace-hotel.webp',
    sha256: 'b0e4d4169fdd9e35bd5606d289bff9ea9a66cfc29f83cc46be002ff3f79d3b61',
  },
] as const

describe('company portal offline local fixture', () => {
  it('documents only the dedicated portal requester and approver accounts', () => {
    expect(fixtureGuide).toContain('solicitante.portal.local@bdextravel.test')
    expect(fixtureGuide).toContain('autorizador.portal.local@bdextravel.test')
    expect(fixtureGuide).not.toContain('solicitante.cc.local@bdextravel.test')
    expect(fixtureGuide).not.toContain('aprovadora.fluxo.local@bdextravel.test')
  })

  it('is guarded against production, remote hosts, wrong port/database and accidental execution', () => {
    expect(source).toContain("nodeEnvironment === 'production' || nodeEnvironment === 'staging'")
    expect(source).toContain("const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])")
    expect(source).toContain("const LOCAL_DATABASE_PORT = '55433'")
    expect(source).toContain("const LOCAL_DATABASE_NAME = 'bdex_gap_closure'")
    expect(source).toContain('COMPANY_PORTAL_FIXTURE_CONFIRM')
    expect(source).toContain("const REQUIRED_CONFIRMATION = 'local:company-portal-offline'")
    expect(source).toContain('const REQUIRED_MIGRATIONS = Object.freeze([')
    expect(source).toContain("'0078_company_portal_ground_offline_catalog.sql'")
    expect(source).toContain("'0081_hotel_catalog_media.sql'")
    expect(source).toContain("'0086_company_portal_company_enablement.sql'")
    expect(source).toContain("'0087_employee_portal_memberships.sql'")
    expect(source).toContain('new pg.Client({ connectionString }).connectionParameters')
    expect(source).toContain('...target.poolConfig')
    expect(source).toContain('await requireConnectedLocalTarget(client, target)')
    expect(source.indexOf('await requireConnectedLocalTarget(client, target)'))
      .toBeLessThan(source.indexOf("await client.query('begin')"))
    expect(source).toContain('current_database()::text as database_name')
    expect(source).toContain('host(inet_server_addr())::text as server_address')
    expect(source).toContain('inet_server_port()::integer as server_port')
  })

  it('rejects a pg query-parameter host override before attempting a connection', () => {
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), 'scripts/seed-local-company-portal-offline.mjs'),
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3010',
        COMPANY_PORTAL_FIXTURE_CONFIRM: 'local:company-portal-offline',
        MIGRATION_DATABASE_URL: 'postgresql://fixture:fixture@localhost:55433/bdex_gap_closure?host=remote.invalid',
        DATABASE_URL: '',
      },
    })

    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('fixture local recusada: host remoto (remote.invalid)')
  })

  it('uses ownership markers and additive upserts without destructive fixture cleanup', () => {
    expect(source).toContain("const FIXTURE_KEY = 'company_portal_offline_local_v1'")
    expect(source).toContain('pg_advisory_xact_lock')
    expect(source).toContain('on conflict')
    expect(source).toContain("metadata->>'fixture'")
    expect(source).not.toMatch(/\bdelete\s+from\b/i)
    expect(source).not.toMatch(/\btruncate\b/i)
    expect(source).toMatch(/insert into companies[\s\S]*?company_portal_enabled[\s\S]*?values[\s\S]*?true/i)
    expect(source).toContain('company_portal_enabled = true')
    expect(source).toContain('ensureFixtureApproverEmployeeLink')
    expect(source).toContain('insert into employee_portal_memberships')
    expect(source).toContain("'active', true, 'not_required'")
    expect(source).toContain("set approval_enabled = true")
    expect(source).toContain("link.status = 'active'")
    expect(source).toContain('link.approval_enabled = true')
    expect(source).toContain('approver_links: approver?.granted ? 1 : 0')
  })

  it('additively merges the relational fixture IDs into a wrapped Zustand directory without replacing state', () => {
    const existingGroup = {
      id: 'group-existing',
      nome: 'Grupo existente',
      ativo: true,
      empresa_ids: ['company-existing'],
    }
    const existingCompany = {
      id: 'company-existing',
      nome: 'Empresa existente',
      codigo_cliente: 'CLIENTE-EXISTENTE',
    }
    const existingEmployee = {
      id: 'employee-existing',
      company_id: 'company-existing',
      nome: 'Pessoa existente',
    }
    const hotels = [{ id: 91, nome: 'Hotel preservado' }]
    const policies = [{ id: 'policy-existing', metadata: { keep: true } }]
    const wrapped = {
      state: {
        gruposEmpresariais: [existingGroup],
        empresas: [existingCompany],
        funcionarios: [existingEmployee],
        hoteis: hotels,
        politicas: policies,
        stateMetadata: { keep: 'state' },
      },
      version: 17,
      persistMetadata: { keep: 'wrapper' },
    }

    const merged = mergeFixtureCorporateDirectoryStorageValue(wrapped) as any
    expect(merged).not.toBe(wrapped)
    expect(merged.version).toBe(17)
    expect(merged.persistMetadata).toEqual({ keep: 'wrapper' })
    expect(merged.state.stateMetadata).toEqual({ keep: 'state' })
    expect(merged.state.hoteis).toBe(hotels)
    expect(merged.state.politicas).toBe(policies)
    expect(merged.state.gruposEmpresariais[0]).toBe(existingGroup)
    expect(merged.state.empresas[0]).toBe(existingCompany)
    expect(merged.state.funcionarios[0]).toBe(existingEmployee)

    const fixtureGroup = merged.state.gruposEmpresariais.find(
      (item: any) => item.id === COMPANY_PORTAL_DIRECTORY_IDS.groupId,
    )
    const fixtureCompany = merged.state.empresas.find(
      (item: any) => item.id === COMPANY_PORTAL_DIRECTORY_IDS.companyId,
    )
    const fixtureEmployee = merged.state.funcionarios.find(
      (item: any) => item.id === COMPANY_PORTAL_DIRECTORY_IDS.employeeId,
    )
    expect(fixtureGroup.empresa_ids).toContain(COMPANY_PORTAL_DIRECTORY_IDS.companyId)
    expect(fixtureCompany.grupo_id).toBe(COMPANY_PORTAL_DIRECTORY_IDS.groupId)
    expect(fixtureCompany.portal_empresa_habilitado).toBe(true)
    expect(fixtureEmployee.company_id).toBe(COMPANY_PORTAL_DIRECTORY_IDS.companyId)
    expect(assertFixtureCorporateDirectoryStorageValue(merged)).toEqual(
      COMPANY_PORTAL_DIRECTORY_IDS,
    )

    const replayed = mergeFixtureCorporateDirectoryStorageValue(merged)
    expect(replayed).toBe(merged)

    const customized = structuredClone(merged)
    const customizedGroup = customized.state.gruposEmpresariais.find(
      (item: any) => item.id === COMPANY_PORTAL_DIRECTORY_IDS.groupId,
    )
    const customizedCompany = customized.state.empresas.find(
      (item: any) => item.id === COMPANY_PORTAL_DIRECTORY_IDS.companyId,
    )
    customizedGroup.empresa_ids.push('company-added-by-agency')
    customizedCompany.config_cobranca = { markup_padrao_pct: 7.5 }
    customizedCompany.agencyMetadata = { keep: true }
    expect(mergeFixtureCorporateDirectoryStorageValue(customized)).toBe(customized)
    expect(customizedGroup.empresa_ids).toContain('company-added-by-agency')
    expect(customizedCompany.config_cobranca).toEqual({ markup_padrao_pct: 7.5 })
    expect(customizedCompany.agencyMetadata).toEqual({ keep: true })
  })

  it('creates a wrapped Zustand directory when storage is absent and fails closed on collisions', () => {
    const created = mergeFixtureCorporateDirectoryStorageValue(undefined) as any
    expect(created).toMatchObject({
      version: 1,
      state: {
        gruposEmpresariais: [{ id: COMPANY_PORTAL_DIRECTORY_IDS.groupId }],
        empresas: [{ id: COMPANY_PORTAL_DIRECTORY_IDS.companyId }],
        funcionarios: [{ id: COMPANY_PORTAL_DIRECTORY_IDS.employeeId }],
      },
    })

    expect(() => mergeFixtureCorporateDirectoryStorageValue({
      state: {
        gruposEmpresariais: [],
        empresas: [{
          id: COMPANY_PORTAL_DIRECTORY_IDS.companyId,
          nome: 'Registro alheio',
        }],
        funcionarios: [],
      },
      version: 1,
    })).toThrow(/nao pertence a fixture/)

    expect(() => mergeFixtureCorporateDirectoryStorageValue({
      state: {
        gruposEmpresariais: [],
        empresas: [{
          id: 'company-collision',
          nome: 'Outra empresa',
          codigo_cliente: 'PORTAL-OFFLINE-TESTE',
        }],
        funcionarios: [],
      },
      version: 1,
    })).toThrow(/codigo_cliente com outro id/)

    expect(() => mergeFixtureCorporateDirectoryStorageValue({
      state: {
        gruposEmpresariais: [],
        empresas: [],
        funcionarios: { corrupted: true },
      },
      version: 1,
    })).toThrow(/funcionarios nao e uma lista/)
  })

  it('keeps canonical fixture identity aligned while preserving agency parameters and metadata', () => {
    const initial = mergeFixtureCorporateDirectoryStorageValue(undefined) as any
    const customized = structuredClone(initial)
    const group = customized.state.gruposEmpresariais[0]
    const company = customized.state.empresas[0]
    const employee = customized.state.funcionarios[0]
    group.nome = 'Nome divergente'
    group.codigo = 'CODIGO-DIVERGENTE'
    group.ativo = false
    group.empresa_ids.push('company-agency-managed')
    company.nome = 'Empresa divergente'
    company.codigo_cliente = 'CLIENTE-DIVERGENTE'
    company.grupo_id = null
    company.ativa = false
    company.portal_empresa_habilitado = false
    company.config_cobranca = { markup_padrao_pct: 6 }
    company.metadata = { agencyParameter: true }
    employee.nome = 'Pessoa divergente'
    employee.codigo_identificacao = '999999'
    employee.company_id = 'company-divergent'
    employee.ativo = false

    const reconciled = mergeFixtureCorporateDirectoryStorageValue(customized) as any
    expect(reconciled.state.gruposEmpresariais[0]).toMatchObject({
      id: COMPANY_PORTAL_DIRECTORY_IDS.groupId,
      nome: '[TESTE] Grupo Portal Empresa Offline',
      codigo: 'PORTAL-OFFLINE-TESTE',
      ativo: true,
      empresa_ids: expect.arrayContaining([
        COMPANY_PORTAL_DIRECTORY_IDS.companyId,
        'company-agency-managed',
      ]),
    })
    expect(reconciled.state.empresas[0]).toMatchObject({
      id: COMPANY_PORTAL_DIRECTORY_IDS.companyId,
      nome: '[TESTE] Empresa Portal Offline',
      codigo_cliente: 'PORTAL-OFFLINE-TESTE',
      grupo_id: COMPANY_PORTAL_DIRECTORY_IDS.groupId,
      ativa: true,
      portal_empresa_habilitado: true,
      config_cobranca: { markup_padrao_pct: 6 },
      metadata: { agencyParameter: true },
    })
    expect(reconciled.state.funcionarios[0]).toMatchObject({
      id: COMPANY_PORTAL_DIRECTORY_IDS.employeeId,
      nome: '[TESTE] Viajante Portal Offline',
      codigo_identificacao: 'PORTAL-OFFLINE-TRAVELER-01',
      company_id: COMPANY_PORTAL_DIRECTORY_IDS.companyId,
      ativo: true,
    })
    expect(mergeFixtureCorporateDirectoryStorageValue(reconciled)).toBe(reconciled)
  })

  it('safely adopts only the exact legacy employee projection that predates fixture markers', () => {
    const legacy = mergeFixtureCorporateDirectoryStorageValue(undefined) as any
    const employee = legacy.state.funcionarios[0]
    delete employee.fixture
    employee.metadata = { source: 'traveler_profile_service', keep: true }

    const adopted = mergeFixtureCorporateDirectoryStorageValue(legacy) as any
    expect(adopted.state.funcionarios[0]).toMatchObject({
      id: COMPANY_PORTAL_DIRECTORY_IDS.employeeId,
      company_id: COMPANY_PORTAL_DIRECTORY_IDS.companyId,
      codigo_identificacao: 'PORTAL-OFFLINE-TRAVELER-01',
      nome: '[TESTE] Viajante Portal Offline',
      email: 'viajante.portal.offline@test.invalid',
      fixture: 'company_portal_offline_local_v1',
      metadata: { source: 'traveler_profile_service', keep: true },
    })

    for (const [field, divergentValue] of [
      ['company_id', 'company-divergent'],
      ['codigo_identificacao', '999999'],
      ['nome', 'Pessoa divergente'],
      ['email', 'divergent@test.invalid'],
    ]) {
      const collision = structuredClone(legacy)
      collision.state.funcionarios[0][field] = divergentValue
      expect(() => mergeFixtureCorporateDirectoryStorageValue(collision))
        .toThrow(/funcionario.*nao pertence a fixture/)
    }
  })

  it('rejects a partial blob before a future directory sync could tombstone relational rows', () => {
    const storage = mergeFixtureCorporateDirectoryStorageValue({
      state: {
        gruposEmpresariais: [{ id: 'group-existing', nome: 'Grupo existente' }],
        empresas: [{ id: 'company-existing', nome: 'Empresa existente' }],
        funcionarios: [{ id: 'employee-existing', company_id: 'company-existing', nome: 'Pessoa existente' }],
      },
      version: 5,
    })
    const completeIds = {
      groups: ['group-existing', COMPANY_PORTAL_DIRECTORY_IDS.groupId],
      companies: ['company-existing', COMPANY_PORTAL_DIRECTORY_IDS.companyId],
      employees: ['employee-existing', COMPANY_PORTAL_DIRECTORY_IDS.employeeId],
    }
    expect(assertCorporateDirectoryStorageCoversRelationalIds(storage, completeIds)).toEqual({
      groups: 2,
      companies: 2,
      employees: 2,
    })
    expect(() => assertCorporateDirectoryStorageCoversRelationalIds(storage, {
      ...completeIds,
      companies: [...completeIds.companies, 'company-missing-from-storage'],
    })).toThrow(/diretorio parcial recusado.*company-missing-from-storage/)
  })

  it('persists only changed directory blobs under the fixture transaction and actor', () => {
    expect(source).toContain("const DIRECTORY_STORAGE_KEY = 'bbt-data-v4'")
    expect(source).toContain("select pg_advisory_xact_lock(hashtext($1), hashtext($2))")
    expect(source).toContain('for update`')
    expect(source).toContain('where app_kv.value is distinct from excluded.value')
    expect(source).toContain('[tenant.id, DIRECTORY_STORAGE_KEY, JSON.stringify(mergedValue), actor.user_id]')
    expect(source).toContain('requireRelationalDirectoryCoverage(client, tenant.id, mergedValue)')
    expect(source).toContain('where tenant_id = $1 and deleted_at is null')
    expect(source).toContain('validateFixtureCorporateDirectoryStorage(client, tenant.id)')
    expect(source).not.toContain("nome: 'BBT Corporativo'")
  })

  it('keeps synthetic hotels/rates and public references visibly distinct', () => {
    expect(source).toContain('[TESTE] Hotel Ficticio Portal Sao Paulo')
    expect(source).toContain('ENDERECO FICTICIO EXCLUSIVO PARA TESTES')
    expect(source).toContain('synthetic: true')
    expect(source).toContain('referenceOnly: true')
    expect(source).toContain('noCommercialAgreement: true')
    expect(source).toContain('noRates: true')
    expect(source).toContain("review_status = 'pending'")
    expect(source).toContain('[TESTE] Movida Goiania - simulacao offline sem vinculo comercial')
    expect(source).toContain("tradeName: '[TESTE] Movida - simulacao offline'")
    expect(source).toContain('[TESTE] Terminal Rodoviario Portal Goiania')
    expect(source).toContain("terminals['TEST-BUS-TERMINAL-GOIANIA'].id")
    expect(source).toContain("code: 'TESTE-RIO-GOIANIA-V1'")
    expect(source).toContain("'America/Sao_Paulo'")
    expect(source).toContain("terminals['TEST-BUS-TERMINAL-RIO'].id")
    expect(source).toContain("route.synthetic ? 'verified' : 'pending'")
    expect(source).toContain("'{}'::jsonb, '{}'::jsonb, $5::text, now()")
    expect(source).toContain("'{}'::jsonb, $4::text, now(), 'verified'")
    expect(source).toContain("then $16::uuid else null end")
    expect(source).toContain('verified_bus_routes: 2')
    expect(source).toContain('verifiedForLocalTestingOnly: true')
    expect(source).toContain("'verified', now()")
  })

  it('adds three real hotel identities while keeping supplier, rooms and rates synthetic', () => {
    expect(source).toContain("name: 'JW Marriott Hotel Rio de Janeiro'")
    expect(source).toContain('Avenida Atlântica, 2600 - Copacabana, Rio de Janeiro/RJ, CEP 22041-001')
    expect(source).toContain("name: 'Copacabana Palace'")
    expect(source).toContain('Avenida Atlântica, 1702 - Copacabana, Rio de Janeiro/RJ, CEP 22021-001')
    expect(source).toContain("name: 'Brasília Palace Hotel'")
    expect(source).toContain('SHTN Trecho 01, Conjunto 01 - Brasília/DF, CEP 70800-200')
    expect(source).toContain("phone: '+55 61 3306-9000'")
    expect(source.match(/syntheticIdentity: false/g)).toHaveLength(3)
    expect(source).toContain("syntheticIdentity ? '[TESTE] Executivo' : '[TESTE] Categoria simulada'")
    expect(source).toContain('syntheticRoomsAndRates: true')
    expect(source).toContain('noCommercialAgreement: true')
    expect(source).toContain("name: '[TESTE] Single com cafe da manha'")
    expect(source).toContain("'Cafe da manha [TESTE]'")
    expect(source).toContain('Politica ficticia para testes locais.')
    expect(source).toContain('https://www.marriott.com/pt-br/hotels/riomc-jw-marriott-hotel-rio-de-janeiro/overview/')
    expect(source).toContain('https://www.belmond.com/pt-br/hotels/south-america/brazil/rio-de-janeiro/belmond-copacabana-palace/location')
    expect(source).toContain('https://www.plazabrasilia.com.br/contatos')

    const copacabanaBlock = source.slice(
      source.indexOf("id: 'hotel_local_reference_copacabana_palace_rio_v1'"),
      source.indexOf("id: 'hotel_local_reference_brasilia_palace_df_v1'"),
    )
    expect(copacabanaBlock).toContain('verifiedAmenities: { pool: true, gym: true }')
    expect(copacabanaBlock).not.toContain('parking')
  })

  it('ships exactly three provenance-tracked CC0/public-domain WebP hotel photos', () => {
    expect(readdirSync(hotelMediaDirectory).sort()).toEqual([
      'README.md',
      'brasilia-palace-hotel.webp',
      'copacabana-palace-rio-de-janeiro.webp',
      'jw-marriott-rio-de-janeiro.webp',
    ])
    for (const asset of hotelMediaAssets) {
      const bytes = readFileSync(resolve(hotelMediaDirectory, asset.file))
      expect(bytes.length).toBeGreaterThan(0)
      expect(bytes.length).toBeLessThanOrEqual(5 * 1024 * 1024)
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
      expect(hotelMediaManifest).toContain(asset.file)
      expect(hotelMediaManifest).toContain(asset.sha256)
      expect(source).toContain(`assetFile: '${asset.file}'`)
      expect(source).toContain(`expectedSha256: '${asset.sha256}'`)
    }
    expect(hotelMediaManifest).toContain('https://commons.wikimedia.org/wiki/File:JW_Marriott_Hotel_Rio_de_Janeiro_2.jpg')
    expect(hotelMediaManifest).toContain('https://commons.wikimedia.org/wiki/File:Copacabana_Palace_Hotel,_Rio_de_Janeiro,_Brazil.jpg')
    expect(hotelMediaManifest).toContain('Acervo Arquivo Nacional')
    expect(hotelMediaManifest).toContain('CC0 1.0 Universal')
    expect(hotelMediaManifest).toContain('domínio público no Brasil')
    expect(hotelMediaManifest).toContain('Os quartos e preços associados pelo seed são dados sintéticos')
    expect(`${source}\n${hotelMediaManifest}`).not.toMatch(/Hotel Unique/i)
  })

  it('persists fixture photos privately with fail-closed replay and rollback cleanup', () => {
    expect(source).toContain("'hotel_catalog_media'")
    expect(source).toContain('insert into stored_files')
    expect(source).toContain('insert into hotel_catalog_media')
    expect(source).toContain("const storageKey = `${tenant.id}/fixtures/${FIXTURE_KEY}/${fileId}.webp`")
    expect(source).toContain("writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 })")
    expect(source).toContain('storage.createdFiles.add(targetPath)')
    expect(source).toContain('await cleanupCreatedFixtureMedia(storage)')
    expect(source).toContain('checksum inesperado para a foto')
    expect(source).toContain('arquivo existente nao pertence a fixture do hotel')
    expect(source).toContain('midia existente nao pertence a fixture do hotel')
    expect(source).toContain('hotelFixtureMediaFileId(hotel)')
    expect(source).toContain('hotelFixtureMediaId(hotel)')
    expect(source).toContain('and (alt_text is distinct from $2')
    expect(source).toContain('and (hotels.name is distinct from excluded.name')
    expect(source).toContain('and normalized_name = $3 and id <> $4')
    expect(source).toContain('hotel real ja cadastrado com outro id')
    expect(source).toContain('and (hotel_room_types.name is distinct from excluded.name')
    expect(source).toContain('and (hotel_supplier_rates.valid_until is distinct from excluded.valid_until')
    expect(source).toContain('hotel_media: expectedHotelMediaIds.length')
  })

  it('records official source URLs for Movida, ANTT and terminal references', () => {
    expect(source).toContain('https://www.movida.com.br/lojas')
    expect(source).toContain('https://dados.antt.gov.br/dataset/gerenciamento-de-autorizacoes')
    expect(source).toContain('https://dadosabertos.go.gov.br/dataset/terminais-rodoviarios-de-passageiros')
    expect(source).toContain('https://www.rj.gov.br/coderte/Terminais_Rodoviarios')
    expect(source).toContain('PAPE0049095')
  })

  it('does not silently attach a real user and only grants access when explicitly requested', () => {
    expect(source).toContain('COMPANY_PORTAL_FIXTURE_ACCESS_EMAIL')
    expect(source).toContain('COMPANY_PORTAL_FIXTURE_REQUESTER_EMAIL')
    expect(source).toContain('COMPANY_PORTAL_FIXTURE_APPROVER_EMAIL')
    expect(source).toContain('solicitante e aprovador da fixture precisam ser usuarios diferentes')
    expect(source).toContain("requiredRole: 'requester'")
    expect(source).toContain("forbiddenRole: 'requester'")
    expect(source).toContain("profile: 'viewer'")
    expect(source).toContain('requireDecisionPermission: true')
    expect(source).toContain("membership.custom_permissions ? 'decidir_aprovacoes'")
    expect(source).toContain('member.can_decide_approvals !== true')
    expect(source).toContain("throw new Error(`aprovador da fixture nao pode ter role_key=${forbiddenRole}")
    expect(source).toContain('permissionOverrides: APPROVER_PERMISSION_OVERRIDES')
    const approverOverrides = fixturePermissionOverrides('APPROVER_PERMISSION_OVERRIDES')
    expect(Object.entries(approverOverrides)
      .filter(([, enabled]) => enabled)
      .map(([permission]) => permission)
      .sort()).toEqual([
        'decidir_aprovacoes',
        'ver_aprovacoes',
        'ver_demandas',
      ])
    for (const [permission, inherited] of Object.entries(CORPORATE_PROFILE_PERMISSIONS.viewer)) {
      if (!inherited) continue
      expect(approverOverrides[permission]).toBe(permission === 'ver_demandas')
    }
    expect(source).toContain('set user_id = $1')
    expect(source).toContain("user_id, name, email")
    expect(source).toContain("values ($1, $2, $3, $4, null")
  })

  it('publishes separate company-scoped selection policies for all four portal services', () => {
    const air = GROUND_APPROVAL_ROUTES.find((route) => route.service === 'aereo')
    const hotel = GROUND_APPROVAL_ROUTES.find((route) => route.service === 'hotelaria')
    const car = GROUND_APPROVAL_ROUTES.find((route) => route.service === 'locacao')
    const bus = GROUND_APPROVAL_ROUTES.find((route) => route.service === 'rodoviario')
    if (!air || !hotel || !car || !bus) throw new Error('Rotas de aprovacao da fixture ausentes.')

    expect(GROUND_APPROVAL_ROUTES.map((route) => route.service)).toEqual([
      'aereo', 'hotelaria', 'locacao', 'rodoviario',
    ])

    expect(groundSelectionCondition(car.service)).toEqual({
      all: [
        { fact: 'operation.checkpoint', operator: 'eq', value: 'selection' },
        { fact: 'request.service', operator: 'eq', value: 'locacao' },
      ],
    })
    expect(groundSelectionCondition(bus.service)).toEqual({
      all: [
        { fact: 'operation.checkpoint', operator: 'eq', value: 'selection' },
        { fact: 'request.service', operator: 'eq', value: 'rodoviario' },
      ],
    })
    expect(car.policyCode).not.toBe(bus.policyCode)
    expect(car.workflowCode).not.toBe(bus.workflowCode)
    expect(new Set(GROUND_APPROVAL_ROUTES.map((route) => route.policyCode)).size).toBe(4)
    expect(new Set(GROUND_APPROVAL_ROUTES.map((route) => route.workflowCode)).size).toBe(4)
    expect(groundSelectionApprovalActions(car)).toEqual([
      expect.objectContaining({
        type: 'request_approval',
        configuration: { workflow: car.workflowCode },
      }),
    ])
    expect(source).toContain("scope_type = 'company' and scope.scope_id = $3")
    expect(source).toContain("and action.action_type = 'auto_approve'")
    expect(source).toContain('Number(row.auto_approve_actions) !== 0')
    expect(source).toContain('Number(row.total_scopes) !== 1')
  })

  it('derives a fail-closed authority workflow from the published template', () => {
    const route = GROUND_APPROVAL_ROUTES[0]
    const graph = buildGroundApprovalWorkflow({
      fixtureKey: 'fixture-test',
      route,
      workflowId: '11111111-1111-4111-8111-111111111111',
      workflowVersionId: '22222222-2222-4222-8222-222222222222',
      stableId: deterministicUuid,
      sourceGraph: {
        nodes: [
          { id: 'source-start', key: 'start', name: 'Inicio', type: 'start' },
          {
            id: 'source-approval',
            key: 'cost',
            name: 'Aprovacao-base',
            type: 'approval',
            approvalKind: 'cost',
            completionMode: 'any',
            approverResolution: {
              selectors: [{ type: 'person', value: 'legacy-user' }],
              combination: 'all',
              minimumApprovers: 1,
              maximumApprovers: 1,
              allowSelfApproval: true,
            },
          },
          { id: 'source-end', key: 'end', name: 'Fim', type: 'end' },
        ],
        edges: [
          { id: 'source-edge-1', sourceNodeId: 'source-start', targetNodeId: 'source-approval', sequence: 0 },
          { id: 'source-edge-2', sourceNodeId: 'source-approval', targetNodeId: 'source-end', sequence: 1 },
        ],
      },
    })
    const approval = graph.nodes.find((node: { type: string }) => node.type === 'approval')

    expect(() => assertSafeGroundApprovalWorkflow(graph)).not.toThrow()
    expect(approval?.approverResolution).toEqual({
      selectors: [{ type: 'authority', configuration: { currency: 'BRL' } }],
      combination: 'all',
      minimumApprovers: 1,
      maximumApprovers: 1,
      allowSelfApproval: false,
      separationOfDuties: ['requester'],
    })
    expect(canonicalJson(graph)).not.toContain('legacy-user')
  })

  it('rejects approval bypasses and passive approval markers', () => {
    const bypass = workflowForSafetyTest()
    bypass.edges.push({
      id: '33333333-3333-4333-8333-333333333333',
      sourceNodeId: bypass.nodes[0].id,
      targetNodeId: bypass.nodes[2].id,
      sequence: 2,
    })
    expect(() => assertSafeGroundApprovalWorkflow(bypass)).toThrow(/contorna a aprovacao/)

    const passive = workflowForSafetyTest()
    passive.nodes[1].configuration = { expirationAction: 'passive_approve' }
    expect(() => assertSafeGroundApprovalWorkflow(passive)).toThrow(/aprovacao passiva/)
  })

  it('builds byte-stable workflow snapshots for idempotent reruns', () => {
    const input = {
      fixtureKey: 'fixture-test:tenant-test',
      route: GROUND_APPROVAL_ROUTES[1],
      sourceGraph: workflowForSafetyTest(),
      workflowId: '44444444-4444-4444-8444-444444444444',
      workflowVersionId: '55555555-5555-4555-8555-555555555555',
      stableId: deterministicUuid,
    }
    expect(canonicalJson(buildGroundApprovalWorkflow(input)))
      .toBe(canonicalJson(buildGroundApprovalWorkflow(input)))
    expect(source).toContain('canonicalJson(row.graph_snapshot) !== canonicalJson(graph)')
    expect(source).toContain('canonicalJson(row.condition_ast) !== canonicalJson(condition)')
    expect(source).toContain('colisao ou workflow publicado inconsistente')
    expect(source).toContain('colisao ou politica publicada inconsistente')
  })

  it('owns product-specific authorities and proves all routing postconditions before commit', () => {
    expect(source).toContain("approval_kind = 'cost'")
    expect(source).toContain('products = $4::text[]')
    expect(source).toContain('conditions?.fixture !== FIXTURE_KEY')
    expect(source).toContain('requires_budget_available = false')
    expect(source).toContain('urgent_allowed = false')
    expect(source).toContain('await revokeStaleGroundApprovalAuthorities')
    expect(source).toContain("set status = 'revoked', revoked_by_membership_id = $3")
    expect(source).toContain("conditions->>'fixture' = $3")
    expect(source).toContain('existem alcadas terrestres ativas fora do aprovador configurado')
    expect(source).toContain('await validateGroundApprovalFixture')
    expect(source.indexOf('await validateGroundApprovalFixture'))
      .toBeLessThan(source.indexOf("await client.query('commit')"))
    expect(source).toContain('access.requester.granted && access.approver.granted')
    expect(source).toContain('approvalValidation.authorities === GROUND_APPROVAL_ROUTES.length')
  })
})

function deterministicUuid(seed: string): string {
  const value = Array.from(seed).reduce((total, character) => (
    (total * 31 + character.charCodeAt(0)) >>> 0
  ), 0).toString(16).padStart(8, '0')
  return `${value}-0000-4000-8000-000000000000`
}

function fixturePermissionOverrides(constantName: string): Record<string, boolean> {
  const match = source.match(new RegExp(
    `const ${constantName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\)`,
  ))
  if (!match) throw new Error(`Bloco ${constantName} nao encontrado.`)
  return Object.fromEntries([...match[1].matchAll(/^\s+([a-z_]+): (true|false),$/gm)]
    .map((entry) => [entry[1], entry[2] === 'true']))
}

function workflowForSafetyTest() {
  return {
    workflowId: '11111111-1111-4111-8111-111111111111',
    workflowVersionId: '22222222-2222-4222-8222-222222222222',
    version: 1,
    code: 'safe-test',
    name: 'Safe test',
    nodes: [
      {
        id: '11111111-1111-4111-8111-111111111112',
        key: 'start',
        name: 'Inicio',
        type: 'start',
        configuration: {},
      },
      {
        id: '11111111-1111-4111-8111-111111111113',
        key: 'approval',
        name: 'Aprovacao',
        type: 'approval',
        approvalKind: 'cost',
        completionMode: 'any',
        approverResolution: {
          selectors: [{ type: 'authority', configuration: { currency: 'BRL' } }],
          combination: 'all',
          minimumApprovers: 1,
          maximumApprovers: 1,
          allowSelfApproval: false,
          separationOfDuties: ['requester'],
        },
        configuration: {},
      },
      {
        id: '11111111-1111-4111-8111-111111111114',
        key: 'end',
        name: 'Fim',
        type: 'end',
        configuration: {},
      },
    ],
    edges: [
      {
        id: '22222222-2222-4222-8222-222222222223',
        sourceNodeId: '11111111-1111-4111-8111-111111111112',
        targetNodeId: '11111111-1111-4111-8111-111111111113',
        sequence: 0,
      },
      {
        id: '22222222-2222-4222-8222-222222222224',
        sourceNodeId: '11111111-1111-4111-8111-111111111113',
        targetNodeId: '11111111-1111-4111-8111-111111111114',
        sequence: 1,
      },
    ],
    validFrom: null,
    validUntil: null,
    contentHash: 'a'.repeat(64),
  }
}
