import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

import {
  GROUND_APPROVAL_ROUTES,
  GROUND_APPROVAL_TEMPLATE,
  assertSafeGroundApprovalWorkflow,
  buildGroundApprovalWorkflow,
  canonicalJson,
  groundSelectionApprovalActions,
  groundSelectionCondition,
  sha256Canonical,
} from './lib/company-portal-offline-approval-fixture.mjs'

const FIXTURE_KEY = 'company_portal_offline_local_v1'
const REQUIRED_CONFIRMATION = 'local:company-portal-offline'
const REQUIRED_MIGRATIONS = Object.freeze([
  '0078_company_portal_ground_offline_catalog.sql',
  '0081_hotel_catalog_media.sql',
  '0086_company_portal_company_enablement.sql',
])
const LOCAL_DATABASE_NAME = 'bdex_gap_closure'
const LOCAL_DATABASE_PORT = '55433'
const DEFAULT_TENANT_SLUG = 'cost-centers-local'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const APPROVAL_FIXTURE_EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z'
const HOTEL_FIXTURE_MEDIA_MAX_BYTES = 5 * 1024 * 1024

const COMPANY = Object.freeze({
  groupId: 'grp-company-portal-offline-local-v1',
  groupName: '[TESTE] Grupo Portal Empresa Offline',
  companyId: 'emp-company-portal-offline-local-v1',
  companyName: '[TESTE] Empresa Portal Offline',
  employeeId: 'func-company-portal-offline-local-v1',
  requesterId: 'sol-company-portal-offline-local-v1',
})

const DIRECTORY_STORAGE_KEY = 'bbt-data-v4'
const DIRECTORY_FIXTURE_TIMESTAMP = '2026-08-17T12:00:00-03:00'

export const COMPANY_PORTAL_DIRECTORY_IDS = Object.freeze({
  groupId: COMPANY.groupId,
  companyId: COMPANY.companyId,
  employeeId: COMPANY.employeeId,
})

const DIRECTORY_FIXTURE_ENTITIES = Object.freeze({
  group: Object.freeze({
    id: COMPANY.groupId,
    nome: COMPANY.groupName,
    codigo: 'PORTAL-OFFLINE-TESTE',
    descricao: `Fixture local ${FIXTURE_KEY}. Nao representa cliente real.`,
    ativo: true,
    empresa_ids: Object.freeze([COMPANY.companyId]),
    created_at: DIRECTORY_FIXTURE_TIMESTAMP,
    updated_at: DIRECTORY_FIXTURE_TIMESTAMP,
    fixture: FIXTURE_KEY,
    synthetic: true,
    localOnly: true,
  }),
  company: Object.freeze({
    id: COMPANY.companyId,
    nome: COMPANY.companyName,
    cnpj: '',
    grupo_id: COMPANY.groupId,
    codigo_cliente: 'PORTAL-OFFLINE-TESTE',
    endereco: '',
    responsavel: '',
    email_responsavel: '',
    telefone: '',
    centro_custo_padrao: 'CC-PORTAL-TESTE',
    ativa: true,
    portal_empresa_habilitado: true,
    config_cobranca: Object.freeze({
      aplicar_markup: true,
      markup_padrao_pct: 10,
      aplicar_taxa: true,
      taxa_padrao_pct: 10,
      taxa_fixa_ativa: false,
      taxa_valor_fixo: 0,
      observacoes: '',
      sla_horas: 24,
      testEnvironment: true,
      currency: 'BRL',
    }),
    created_at: DIRECTORY_FIXTURE_TIMESTAMP,
    updated_at: DIRECTORY_FIXTURE_TIMESTAMP,
    fixture: FIXTURE_KEY,
    synthetic: true,
    localOnly: true,
  }),
  employee: Object.freeze({
    id: COMPANY.employeeId,
    company_id: COMPANY.companyId,
    codigo_identificacao: 'PORTAL-OFFLINE-TRAVELER-01',
    nome: '[TESTE] Viajante Portal Offline',
    cpf: '',
    data_nascimento: '',
    telefone: '',
    email: 'viajante.portal.offline@test.invalid',
    passaporte: '',
    passaporte_validade: '',
    milhagem: '',
    preferencias: '',
    cargo: 'Colaborador',
    cargo_original: 'Viajante de teste',
    centro_custo: 'CC-PORTAL-TESTE',
    lotacao: 'Homologacao local',
    ativo: true,
    created_at: DIRECTORY_FIXTURE_TIMESTAMP,
    updated_at: DIRECTORY_FIXTURE_TIMESTAMP,
    fixture: FIXTURE_KEY,
    synthetic: true,
    localOnly: true,
  }),
})

// `viewer` intentionally carries a broad read-only baseline. The fixture approver
// must not inherit that directory, voucher, report or intelligence visibility: it
// only needs the demand subject plus the approval queue and decision action.
const APPROVER_PERMISSION_OVERRIDES = Object.freeze({
  ver_empresas: false,
  ver_centros_custo: false,
  ver_funcionarios: false,
  ver_solicitantes: false,
  ver_demandas: true,
  ver_reservas: false,
  ver_emissoes: false,
  ver_vouchers: false,
  ver_relatorios: false,
  ver_politicas: false,
  ver_aprovacoes: true,
  decidir_aprovacoes: true,
  ver_workflows: false,
  usar_ia: false,
  ver_arquivos: false,
  ver_inteligencia: false,
  usar_busca_global: false,
  ver_orcamentos: false,
})

const SOURCES = Object.freeze({
  fixture: {
    key: 'LOCAL-PORTAL-OFFLINE-FIXTURE',
    name: 'Fixture local do Portal Empresa offline',
    kind: 'local_fixture',
    refreshMode: 'manual',
    baseUrl: null,
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['synthetic_test_data'],
    reviewIntervalDays: null,
    observedAt: '2026-08-17T12:00:00-03:00',
  },
  jwMarriottOfficial: {
    key: 'JW-MARRIOTT-RIO-OFFICIAL',
    name: 'JW Marriott Hotel Rio de Janeiro - pagina oficial',
    kind: 'supplier_site',
    refreshMode: 'manual',
    baseUrl: 'https://www.marriott.com/pt-br/hotels/riomc-jw-marriott-hotel-rio-de-janeiro/overview/',
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['hotel_identity', 'hotel_public_address', 'hotel_public_phone'],
    reviewIntervalDays: 180,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  copacabanaPalaceOfficial: {
    key: 'COPACABANA-PALACE-OFFICIAL',
    name: 'Copacabana Palace - pagina oficial Belmond',
    kind: 'supplier_site',
    refreshMode: 'manual',
    baseUrl: 'https://www.belmond.com/pt-br/hotels/south-america/brazil/rio-de-janeiro/belmond-copacabana-palace/location',
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['hotel_identity', 'hotel_public_address', 'hotel_public_phone'],
    reviewIntervalDays: 180,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  brasiliaPalaceOfficial: {
    key: 'BRASILIA-PALACE-OFFICIAL',
    name: 'Brasília Palace Hotel - página oficial Plaza Brasília',
    kind: 'supplier_site',
    refreshMode: 'manual',
    baseUrl: 'https://www.plazabrasilia.com.br/contatos',
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['hotel_identity', 'hotel_public_address', 'hotel_public_phone'],
    reviewIntervalDays: 180,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  jwMarriottPhoto: {
    key: 'WIKIMEDIA-COMMONS-JW-MARRIOTT-RIO-2',
    name: 'Wikimedia Commons - JW Marriott Hotel Rio de Janeiro 2.jpg',
    kind: 'manual',
    refreshMode: 'manual',
    baseUrl: 'https://commons.wikimedia.org/wiki/File:JW_Marriott_Hotel_Rio_de_Janeiro_2.jpg',
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    authoritativeFor: ['hotel_reference_photo', 'media_license'],
    reviewIntervalDays: null,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  copacabanaPalacePhoto: {
    key: 'WIKIMEDIA-COMMONS-COPACABANA-PALACE-2023',
    name: 'Wikimedia Commons - Copacabana Palace Hotel, Rio de Janeiro, Brazil.jpg',
    kind: 'manual',
    refreshMode: 'manual',
    baseUrl: 'https://commons.wikimedia.org/wiki/File:Copacabana_Palace_Hotel,_Rio_de_Janeiro,_Brazil.jpg',
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    authoritativeFor: ['hotel_reference_photo', 'media_license'],
    reviewIntervalDays: null,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  brasiliaPalacePhoto: {
    key: 'WIKIMEDIA-COMMONS-BRASILIA-PALACE-ARQUIVO-NACIONAL',
    name: 'Wikimedia Commons - Brasília Palace Hotel, Acervo Arquivo Nacional',
    kind: 'manual',
    refreshMode: 'manual',
    baseUrl: 'https://commons.wikimedia.org/wiki/File:Bras%C3%ADlia_Palace_Hotel_-_BR_RJANRIO_PH_0_FOT_00743_0012,_Acervo_do_Arquivo_Nacional.jpg',
    licenseName: 'Dominio publico no Brasil (Acervo Arquivo Nacional)',
    licenseUrl: 'https://commons.wikimedia.org/wiki/Template:PD-BrazilGov',
    authoritativeFor: ['hotel_reference_photo', 'media_license'],
    reviewIntervalDays: null,
    observedAt: '2026-08-18T12:00:00-03:00',
  },
  movida: {
    key: 'MOVIDA-OFFICIAL-STORES',
    name: 'Movida - paginas oficiais de lojas',
    kind: 'supplier_site',
    refreshMode: 'manual',
    baseUrl: 'https://www.movida.com.br/lojas',
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['rental_store_identity', 'rental_store_public_address'],
    reviewIntervalDays: 90,
    observedAt: '2026-08-17T12:00:00-03:00',
  },
  antt: {
    key: 'ANTT-SIGMA-AUTHORIZATIONS',
    name: 'ANTT - Gerenciamento de Autorizacoes SIGMA',
    kind: 'government_open_data',
    refreshMode: 'file_import',
    baseUrl: 'https://dados.antt.gov.br/dataset/gerenciamento-de-autorizacoes',
    licenseName: 'Creative Commons Atribuicao',
    licenseUrl: 'https://opendefinition.org/licenses/cc-by/',
    authoritativeFor: ['bus_operator_authorization', 'bus_routes', 'bus_markets'],
    reviewIntervalDays: 45,
    observedAt: '2026-08-17T12:00:00-03:00',
  },
  agrGoias: {
    key: 'AGR-GO-BUS-TERMINALS',
    name: 'AGR Goias - Terminais Rodoviarios de Passageiros',
    kind: 'government_open_data',
    refreshMode: 'file_import',
    baseUrl: 'https://dadosabertos.go.gov.br/dataset/terminais-rodoviarios-de-passageiros',
    licenseName: 'Creative Commons Atribuicao 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    authoritativeFor: ['bus_terminals_goias'],
    reviewIntervalDays: 365,
    observedAt: '2026-08-17T12:00:00-03:00',
  },
  coderte: {
    key: 'CODERTE-RJ-BUS-TERMINALS',
    name: 'CODERTE - Terminais Rodoviarios',
    kind: 'official_directory',
    refreshMode: 'manual',
    baseUrl: 'https://www.rj.gov.br/coderte/Terminais_Rodoviarios',
    licenseName: null,
    licenseUrl: null,
    authoritativeFor: ['bus_terminals_rio_de_janeiro'],
    reviewIntervalDays: 180,
    observedAt: '2026-08-17T12:00:00-03:00',
  },
})

const GEOGRAPHIES = Object.freeze({
  saoPaulo: { uf: 'SP', city: 'sao paulo' },
  rioDeJaneiro: { uf: 'RJ', city: 'rio de janeiro' },
  brasilia: { uf: 'DF', city: 'brasilia' },
  goiania: { uf: 'GO', city: 'goiania' },
  belem: { uf: 'PA', city: 'belem' },
  recife: { uf: 'PE', city: 'recife' },
})

const HOTELS = Object.freeze([
  {
    id: 'hotel_local_portal_sp_v1',
    cityKey: 'saoPaulo',
    name: '[TESTE] Hotel Ficticio Portal Sao Paulo',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Sao Paulo/SP',
    propertyCode: 'TESTE-SP-CAPITAL',
    sgl: '320.00',
    dbl: '410.00',
  },
  {
    id: 'hotel_local_portal_rj_v1',
    cityKey: 'rioDeJaneiro',
    name: '[TESTE] Hotel Ficticio Portal Rio de Janeiro',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Rio de Janeiro/RJ',
    propertyCode: 'TESTE-RJ-CAPITAL',
    sgl: '350.00',
    dbl: '445.00',
  },
  {
    id: 'hotel_local_portal_df_v1',
    cityKey: 'brasilia',
    name: '[TESTE] Hotel Ficticio Portal Brasilia',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Brasilia/DF',
    propertyCode: 'TESTE-DF-CAPITAL',
    sgl: '300.00',
    dbl: '390.00',
  },
  {
    id: 'hotel_local_portal_go_v1',
    cityKey: 'goiania',
    name: '[TESTE] Hotel Ficticio Portal Goiania',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Goiania/GO',
    propertyCode: 'TESTE-GO-CAPITAL',
    sgl: '270.00',
    dbl: '345.00',
  },
  {
    id: 'hotel_local_reference_jw_marriott_rio_v1',
    cityKey: 'rioDeJaneiro',
    name: 'JW Marriott Hotel Rio de Janeiro',
    address: 'Avenida Atlântica, 2600 - Copacabana, Rio de Janeiro/RJ, CEP 22041-001',
    phone: '+55 21 2545-6500',
    website: 'https://www.marriott.com/pt-br/hotels/riomc-jw-marriott-hotel-rio-de-janeiro/overview/',
    identitySourceKey: 'jwMarriottOfficial',
    propertyCode: 'TESTE-REALREF-JW-RIO',
    sgl: '420.00',
    dbl: '520.00',
    syntheticIdentity: false,
    verifiedAmenities: { pool: true, gym: true, accessibility: true },
    photo: {
      assetFile: 'jw-marriott-rio-de-janeiro.webp',
      expectedSha256: '81be81706f2ade23498951f3cadab03b331f3de25204ac8b59f1f1bbe8c7a178',
      sourceKey: 'jwMarriottPhoto',
      author: 'Mx. Granger',
      altText: 'Entrada do JW Marriott Hotel Rio de Janeiro em Copacabana.',
      transformation: 'Recorte de enquadramento, redimensionamento e conversao para WebP.',
    },
  },
  {
    id: 'hotel_local_reference_copacabana_palace_rio_v1',
    cityKey: 'rioDeJaneiro',
    name: 'Copacabana Palace',
    address: 'Avenida Atlântica, 1702 - Copacabana, Rio de Janeiro/RJ, CEP 22021-001',
    phone: '+55 21 2548-7070',
    website: 'https://www.belmond.com/pt-br/hotels/south-america/brazil/rio-de-janeiro/belmond-copacabana-palace/',
    identitySourceKey: 'copacabanaPalaceOfficial',
    propertyCode: 'TESTE-REALREF-COPA-RIO',
    sgl: '450.00',
    dbl: '550.00',
    syntheticIdentity: false,
    verifiedAmenities: { pool: true, gym: true },
    photo: {
      assetFile: 'copacabana-palace-rio-de-janeiro.webp',
      expectedSha256: 'a3964575d49521be02cab4cf0e3de8ed7085b5ded53efba89b16b99b30a8328e',
      sourceKey: 'copacabanaPalacePhoto',
      author: 'Wilfredor',
      altText: 'Fachada do Copacabana Palace no Rio de Janeiro.',
      transformation: 'Redimensionamento e conversao para WebP.',
    },
  },
  {
    id: 'hotel_local_reference_brasilia_palace_df_v1',
    cityKey: 'brasilia',
    name: 'Brasília Palace Hotel',
    address: 'SHTN Trecho 01, Conjunto 01 - Brasília/DF, CEP 70800-200',
    phone: '+55 61 3306-9000',
    website: 'https://www.plazabrasilia.com.br/',
    identitySourceKey: 'brasiliaPalaceOfficial',
    propertyCode: 'TESTE-REALREF-BRASILIA-PALACE',
    sgl: '360.00',
    dbl: '450.00',
    syntheticIdentity: false,
    verifiedAmenities: {},
    photo: {
      assetFile: 'brasilia-palace-hotel.webp',
      expectedSha256: 'b0e4d4169fdd9e35bd5606d289bff9ea9a66cfc29f83cc46be002ff3f79d3b61',
      sourceKey: 'brasiliaPalacePhoto',
      author: 'Autor desconhecido / Acervo Arquivo Nacional',
      altText: 'Fotografia histórica do Brasília Palace Hotel, Acervo Arquivo Nacional.',
      transformation: 'Redimensionamento e conversao para WebP.',
    },
  },
])

const ROOM_TYPES = Object.freeze([
  {
    code: 'SGL-TESTE',
    name: '[TESTE] Single com cafe da manha',
    occupancyType: 'single',
    maxGuests: 1,
    maxAdults: 1,
    maxChildren: 0,
    bedConfiguration: 'Configuracao ficticia para testes',
    amountKey: 'sgl',
  },
  {
    code: 'DBL-TESTE',
    name: '[TESTE] Duplo com cafe da manha',
    occupancyType: 'double',
    maxGuests: 2,
    maxAdults: 2,
    maxChildren: 0,
    bedConfiguration: 'Configuracao ficticia para testes',
    amountKey: 'dbl',
  },
])

const MOVIDA_LOCATIONS = Object.freeze([
  {
    code: 'MOVIDA-GIG-REFERENCE',
    cityKey: 'rioDeJaneiro',
    name: 'Movida Rio de Janeiro - Galeao Aeroporto [REFERENCIA DE TESTE]',
    address: 'Avenida Vinte de Janeiro - 0 - Setor de Locadoras - Area Externa, Galeao, Rio de Janeiro/RJ, CEP 21941-570',
    sourceRecordKey: 'rio-de-janeiro-galeao-aeroporto',
    sourceUrl: 'https://www.movida.com.br/loja/rio-de-janeiro-galeao-aeroporto',
  },
  {
    code: 'MOVIDA-GRU-REFERENCE',
    cityKey: 'saoPaulo',
    name: 'Movida Sao Paulo - Guarulhos Aeroporto [REFERENCIA DE TESTE]',
    address: 'Rodovia Helio Smidt - 0 - Patio das Locadoras (Box no TPS 2 e 3), Aeroporto, Guarulhos/SP, CEP 07190-100',
    sourceRecordKey: 'sao-paulo-guarulhos-aeroporto',
    sourceUrl: 'https://www.movida.com.br/loja/sao-paulo-guarulhos-aeroporto',
  },
  {
    code: 'MOVIDA-BSB-REFERENCE',
    cityKey: 'brasilia',
    name: 'Movida Brasilia Aeroporto [REFERENCIA DE TESTE]',
    address: 'Aeroporto Internacional de Brasilia - 0 - AE S/N UC 4105 S/N, Brasilia/DF, CEP 71608-900',
    sourceRecordKey: 'brasilia-aeroporto',
    sourceUrl: 'https://www.movida.com.br/loja/brasilia-aeroporto',
  },
  {
    code: 'MOVIDA-GYN-REFERENCE',
    cityKey: 'goiania',
    name: 'Movida Goiania Aeroporto [REFERENCIA DE TESTE]',
    address: 'Alameda Aeroporto - 1160 - Aeroporto Internacional Santa Genoveva, Goiania/GO, CEP 74672-839',
    sourceRecordKey: 'goiania-aeroporto',
    sourceUrl: 'https://www.movida.com.br/loja/goiania-aeroporto',
  },
])

const TEST_RENTAL_LOCATIONS = Object.freeze([
  {
    code: 'TEST-RENTAL-GYN-AIRPORT',
    cityKey: 'goiania',
    name: '[TESTE] Movida Goiania - simulacao offline sem vinculo comercial',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Goiania/GO',
  },
  {
    code: 'TEST-RENTAL-GRU-AIRPORT',
    cityKey: 'saoPaulo',
    name: '[TESTE] Movida Sao Paulo - simulacao offline sem vinculo comercial',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Sao Paulo/SP',
  },
])

const BUS_TERMINALS = Object.freeze([
  {
    code: 'TERMINAL-GOIANIA-REFERENCE',
    cityKey: 'goiania',
    name: 'Terminal Rodoviario de Goiania [REFERENCIA DE TESTE]',
    sourceKey: 'agrGoias',
    sourceRecordKey: 'terminal-rodoviario-de-goiania',
    sourceUrl: 'https://dadosabertos.go.gov.br/dataset/terminais-rodoviarios-de-passageiros',
  },
  {
    code: 'RODOVIARIA-RIO-REFERENCE',
    cityKey: 'rioDeJaneiro',
    name: 'Rodoviaria do Rio [REFERENCIA DE TESTE]',
    sourceKey: 'coderte',
    sourceRecordKey: 'rodoviaria-do-rio',
    sourceUrl: 'https://www.rj.gov.br/coderte/Terminais_Rodoviarios',
  },
])

const TEST_BUS_TERMINALS = Object.freeze([
  {
    code: 'TEST-BUS-TERMINAL-GOIANIA',
    cityKey: 'goiania',
    name: '[TESTE] Terminal Rodoviario Portal Goiania',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Goiania/GO',
  },
  {
    code: 'TEST-BUS-TERMINAL-RIO',
    cityKey: 'rioDeJaneiro',
    name: '[TESTE] Terminal Rodoviario Portal Rio de Janeiro',
    address: 'ENDERECO FICTICIO EXCLUSIVO PARA TESTES - Rio de Janeiro/RJ',
  },
])

const SUPPLIERS = Object.freeze({
  hotel: {
    code: 'PORTAL-HOTEL-FICTICIO',
    legalName: '[TESTE] Fornecedor Hoteleiro Ficticio do Portal',
    tradeName: '[TESTE] Hotelaria Offline',
    serviceTypes: ['hotel'],
    sourceKey: 'fixture',
    synthetic: true,
  },
  movida: {
    code: 'PORTAL-MOVIDA-REFERENCE',
    legalName: 'Movida [REFERENCIA PUBLICA PARA TESTES]',
    tradeName: 'Movida [REFERENCIA DE TESTE]',
    serviceTypes: ['car'],
    sourceKey: 'movida',
    synthetic: false,
  },
  carFixture: {
    code: 'PORTAL-LOCADORA-FICTICIA',
    legalName: '[TESTE] Movida - simulacao offline sem vinculo comercial',
    tradeName: '[TESTE] Movida - simulacao offline',
    serviceTypes: ['car'],
    sourceKey: 'fixture',
    synthetic: true,
  },
  busFixture: {
    code: 'PORTAL-RODOVIARIO-FICTICIO',
    legalName: '[TESTE] Viacao Ficticia Portal Offline',
    tradeName: '[TESTE] Viacao Portal Offline',
    serviceTypes: ['bus'],
    sourceKey: 'fixture',
    synthetic: true,
  },
  guanabara: {
    code: 'PORTAL-GUANABARA-REFERENCE',
    legalName: 'EXPRESSO GUANABARA LTDA. [REFERENCIA PUBLICA PARA TESTES]',
    tradeName: 'Expresso Guanabara [REFERENCIA DE TESTE]',
    serviceTypes: ['bus'],
    sourceKey: 'antt',
    synthetic: false,
  },
})

async function main() {
  const target = requireLocalTarget()
  const storage = requireLocalFixtureStorage()
  const pool = new pg.Pool({
    ...target.poolConfig,
    max: 1,
    application_name: 'bdex-local-company-portal-offline-fixture',
  })
  const client = await pool.connect()
  let fixtureStage = 'validar conexao local'
  let committed = false

  try {
    await requireConnectedLocalTarget(client, target)
    await client.query('begin')
    await client.query("set local lock_timeout = '10s'")
    await client.query("set local statement_timeout = '90s'")
    await requireMigrations(client)
    const tenant = await requireTenant(client)
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenant.id])
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `${FIXTURE_KEY}:${tenant.id}`,
    ])
    fixtureStage = 'carregar ator da fixture'
    const actor = await requireActor(client, tenant.id)
    fixtureStage = 'carregar geografia da fixture'
    const geography = await requireGeography(client)

    fixtureStage = 'cadastrar empresa e viajante de teste'
    await upsertTestCompany(client, { tenant, actor })
    fixtureStage = 'integrar empresa e viajante ao diretorio gerencial'
    const directoryStorage = await upsertFixtureCorporateDirectoryStorage(client, { tenant, actor })
    fixtureStage = 'publicar roteamento de aprovacao'
    const approvalRouting = await ensureGroundApprovalRouting(client, { tenant, actor })
    fixtureStage = 'cadastrar fontes de catalogo'
    const sources = await upsertSources(client, { tenant, actor })
    fixtureStage = 'cadastrar fornecedores de teste'
    const suppliers = await upsertSuppliers(client, { tenant, actor, sources })
    fixtureStage = 'cadastrar hoteis e tarifas de teste'
    const hotels = await upsertHotels(client, {
      tenant,
      actor,
      geography,
      supplier: suppliers.hotel,
      sources,
      storage,
    })
    fixtureStage = 'cadastrar referencias de lojas'
    const rentalLocationReferences = await upsertRentalLocations(client, {
      tenant,
      actor,
      geography,
      source: sources.movida,
      supplier: suppliers.movida,
    })
    fixtureStage = 'cadastrar lojas sinteticas verificadas'
    const verifiedRentalLocations = await upsertVerifiedTestRentalLocations(client, {
      tenant,
      actor,
      geography,
      source: sources.fixture,
      supplier: suppliers.carFixture,
    })
    const rentalLocations = [...rentalLocationReferences, ...verifiedRentalLocations]
    fixtureStage = 'cadastrar referencias de terminais'
    const terminalReferences = await upsertBusTerminals(client, { tenant, actor, geography, sources })
    fixtureStage = 'cadastrar terminais sinteticos verificados'
    const verifiedTestTerminals = await upsertVerifiedTestBusTerminals(client, {
      tenant,
      actor,
      geography,
      source: sources.fixture,
    })
    const terminals = { ...terminalReferences, ...verifiedTestTerminals }
    fixtureStage = 'cadastrar rotas rodoviarias de teste'
    const busRoutes = await upsertBusRoutes(client, {
      tenant,
      actor,
      geography,
      sources,
      suppliers,
      terminals,
    })
    fixtureStage = 'conceder acessos corporativos de teste'
    const access = await maybeGrantFixtureCompanyAccess(client, { tenant, actor })
    fixtureStage = 'cadastrar alcadas de aprovacao de teste'
    const approvalAuthorities = await ensureGroundApprovalAuthorities(client, {
      tenant,
      actor,
      approver: access.approver,
    })

    fixtureStage = 'validar pos-condicoes da fixture'
    await client.query('set constraints all immediate')
    const validation = await validateFixture(client, tenant.id)
    const directoryValidation = await validateFixtureCorporateDirectoryStorage(client, tenant.id)
    const approvalValidation = await validateGroundApprovalFixture(client, {
      tenant,
      approver: access.approver,
      approvalRouting,
    })
    await client.query('commit')
    committed = true

    console.log(JSON.stringify({
      ok: true,
      localOnly: true,
      fixture: FIXTURE_KEY,
      database: { host: target.host, port: target.port, name: target.databaseName },
      tenant,
      company: COMPANY,
      directory: {
        storage: directoryStorage,
        validation: directoryValidation,
      },
      access,
      approvals: {
        routing: approvalRouting.map(({ service, policyCode, workflowCode, created }) => ({
          service,
          policyCode,
          workflowCode,
          created,
        })),
        authorities: approvalAuthorities,
        validation: approvalValidation,
        e2eAvailable: Boolean(access.requester.granted && access.approver.granted
          && approvalValidation.authorities === GROUND_APPROVAL_ROUTES.length),
      },
      counts: validation,
      hotels,
      rentalLocations,
      busTerminals: terminals,
      busRoutes,
      notices: [
        'JW Marriott Rio, Copacabana Palace e Brasilia Palace usam identidade/endereco reais e foto licenciada; nao ha vinculo comercial.',
        'Quartos, fornecedor hoteleiro e todas as tarifas sao sinteticos, marcados [TESTE] e exclusivos do QA local.',
        'Os quatro hoteis com prefixo [TESTE] continuam inteiramente sinteticos.',
        'Movida, Expresso Guanabara e terminais reais sao referencias publicas sem vinculo comercial.',
        'Lojas e terminais com prefixo [TESTE] sao sinteticos, verificados apenas para o QA local.',
        'Nenhuma tarifa de carro ou onibus foi criada.',
        'Registros publicos permanecem pending ate revisao humana antes de qualquer uso produtivo.',
      ],
    }, null, 2))
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Preserva a falha original.
    }
    if (!committed) {
      await cleanupCreatedFixtureMedia(storage).catch((cleanupError) => {
        console.error(`fixture local nao removeu uma midia criada antes do rollback: ${String(cleanupError)}`)
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`fixture local falhou em "${fixtureStage}": ${message}`, { cause: error })
  } finally {
    client.release()
    await pool.end()
  }
}

function requireLocalTarget() {
  const nodeEnvironment = String(process.env.NODE_ENV || 'development').trim().toLowerCase()
  if (nodeEnvironment === 'production' || nodeEnvironment === 'staging') {
    throw new Error(`fixture local recusada: NODE_ENV=${nodeEnvironment}`)
  }
  if (String(process.env.COMPANY_PORTAL_FIXTURE_CONFIRM || '').trim() !== REQUIRED_CONFIRMATION) {
    throw new Error(`fixture local exige COMPANY_PORTAL_FIXTURE_CONFIRM=${REQUIRED_CONFIRMATION}`)
  }

  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim()
  if (appUrl) {
    const appHost = new URL(appUrl).hostname.toLowerCase()
    if (!LOCAL_HOSTS.has(appHost)) {
      throw new Error(`fixture local recusada: APP_URL remota (${appHost})`)
    }
  }

  const connectionString = String(
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '',
  ).trim()
  if (!connectionString) {
    throw new Error('fixture local exige MIGRATION_DATABASE_URL ou DATABASE_URL')
  }
  const protocol = new URL(connectionString).protocol
  if (!['postgres:', 'postgresql:'].includes(protocol)) {
    throw new Error('fixture local exige PostgreSQL')
  }
  const parsed = new pg.Client({ connectionString }).connectionParameters
  const host = String(parsed.host || '').trim().toLowerCase()
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`fixture local recusada: host remoto (${host})`)
  }
  const port = String(parsed.port || 5432)
  if (port !== LOCAL_DATABASE_PORT) {
    throw new Error(`fixture local recusada: porta deve ser ${LOCAL_DATABASE_PORT}`)
  }
  const databaseName = String(parsed.database || '').trim()
  if (databaseName !== LOCAL_DATABASE_NAME) {
    throw new Error(`fixture local recusada: banco deve ser ${LOCAL_DATABASE_NAME}`)
  }
  return {
    host,
    port,
    databaseName,
    poolConfig: {
      host,
      port: Number(port),
      database: databaseName,
      user: parsed.user,
      password: parsed.password,
      ssl: parsed.ssl,
    },
  }
}

function requireLocalFixtureStorage() {
  const projectRoot = resolve(process.cwd())
  const storageRoot = resolve(process.env.STORAGE_ROOT || '.bbt-storage/files')
  const scoped = relative(projectRoot, storageRoot)
  if (!scoped || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || isAbsolute(scoped)) {
    throw new Error('fixture local exige STORAGE_ROOT dentro do diretorio da aplicacao')
  }
  return { root: storageRoot, createdFiles: new Set() }
}

async function cleanupCreatedFixtureMedia(storage) {
  for (const filePath of [...storage.createdFiles].reverse()) {
    const scoped = relative(storage.root, filePath)
    if (!scoped || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        || isAbsolute(scoped)) {
      throw new Error(`cleanup de midia recusado fora do storage local: ${filePath}`)
    }
    await rm(filePath, { force: true })
  }
  storage.createdFiles.clear()
}

async function requireConnectedLocalTarget(client, target) {
  const result = await client.query(
    `select current_database()::text as database_name,
            host(inet_server_addr())::text as server_address,
            inet_server_port()::integer as server_port`,
  )
  const connected = result.rows[0]
  const databaseName = String(connected?.database_name || '').trim()
  const serverAddress = String(connected?.server_address || '').trim().toLowerCase()
  const serverPort = String(connected?.server_port || '')
  if (databaseName !== target.databaseName) {
    throw new Error(`fixture local recusada apos conexao: banco ${databaseName || 'desconhecido'}`)
  }
  if (!isLoopbackAddress(serverAddress)) {
    throw new Error(`fixture local recusada apos conexao: servidor remoto (${serverAddress || 'desconhecido'})`)
  }
  if (serverPort !== target.port) {
    throw new Error(`fixture local recusada apos conexao: porta ${serverPort || 'desconhecida'}`)
  }
}

function isLoopbackAddress(value) {
  return value === '127.0.0.1'
    || value === '::1'
    || value === '0:0:0:0:0:0:0:1'
    || value.startsWith('::ffff:127.')
}

async function requireMigrations(client) {
  const result = await client.query(
    'select name from schema_migrations where name = any($1::text[])',
    [REQUIRED_MIGRATIONS],
  )
  const applied = new Set(result.rows.map((row) => row.name))
  const missing = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name))
  if (missing.length) {
    throw new Error(`fixture local exige as migrations: ${missing.join(', ')}`)
  }
}

async function requireTenant(client) {
  const tenantSlug = String(process.env.COMPANY_PORTAL_FIXTURE_TENANT_SLUG || DEFAULT_TENANT_SLUG)
    .trim().toLowerCase()
  const result = await client.query(
    `select id, slug::text, name from tenants where slug = $1 and status = 'active'`,
    [tenantSlug],
  )
  if (result.rowCount !== 1) {
    throw new Error(`tenant local ativo nao encontrado: ${tenantSlug}`)
  }
  return result.rows[0]
}

async function requireActor(client, tenantId) {
  const result = await client.query(
    `select user_row.id as user_id, membership.id as membership_id, user_row.email::text
       from tenant_memberships membership
       join roles role_row on role_row.id = membership.role_id
       join users user_row on user_row.id = membership.user_id
      where membership.tenant_id = $1
        and membership.status = 'active'
        and user_row.status = 'active'
        and (role_row.role_key = 'tenant_admin' or user_row.platform_admin)
      order by user_row.platform_admin desc, membership.created_at, user_row.id
      limit 1`,
    [tenantId],
  )
  if (!result.rows[0]) {
    throw new Error('fixture local exige um administrador ativo no tenant')
  }
  return result.rows[0]
}

async function requireGeography(client) {
  const result = {}
  for (const [key, expected] of Object.entries(GEOGRAPHIES)) {
    const row = await client.query(
      `select country.id as country_id,
              upper(country.iso_alpha2::text) as country_code,
              subdivision.id as subdivision_id,
              upper(subdivision.code::text) as subdivision_code,
              city.id as city_id,
              city.name as city_name
         from geo_countries country
         join geo_subdivisions subdivision
           on subdivision.country_id = country.id
          and upper(subdivision.code::text) = $1
          and subdivision.is_active
         join geo_cities city
           on city.country_id = country.id
          and city.subdivision_id = subdivision.id
          and city.normalized_name = $2
          and city.is_active
        where upper(country.iso_alpha2::text) = 'BR'
          and country.is_active`,
      [expected.uf, expected.city],
    )
    if (row.rowCount !== 1) {
      throw new Error(`geografia local ausente ou ambigua: ${expected.city}/${expected.uf}`)
    }
    result[key] = row.rows[0]
  }
  return result
}

async function upsertTestCompany(client, { tenant, actor }) {
  const groupExisting = await client.query(
    'select tenant_id, description from business_groups where id = $1 for update',
    [COMPANY.groupId],
  )
  if (groupExisting.rows[0]
      && (groupExisting.rows[0].tenant_id !== tenant.id
        || !String(groupExisting.rows[0].description || '').includes(FIXTURE_KEY))) {
    throw new Error(`colisao com grupo que nao pertence a fixture: ${COMPANY.groupId}`)
  }
  await client.query(
    `insert into business_groups (
       id, tenant_id, name, code, description, status
     ) values ($1, $2, $3, $4, $5, 'active')
     on conflict (id) do update set
       name = excluded.name,
       code = excluded.code,
       description = excluded.description,
       status = 'active',
       deleted_at = null,
       updated_at = now()
     where business_groups.tenant_id = excluded.tenant_id`,
    [
      COMPANY.groupId,
      tenant.id,
      COMPANY.groupName,
      'PORTAL-OFFLINE-TESTE',
      `Fixture local ${FIXTURE_KEY}. Nao representa cliente real.`,
    ],
  )

  await assertCompanyFixtureIdentity(client, tenant.id)
  await client.query(
    `insert into companies (
       id, tenant_id, group_id, legal_name, trade_name, customer_code,
       company_portal_enabled, status, billing_settings, metadata, created_by, updated_by
     ) values ($1, $2, $3, $4, $4, $5, true, 'active', $6::jsonb, $7::jsonb, $8, $8)
     on conflict (id) do update set
       group_id = excluded.group_id,
       legal_name = excluded.legal_name,
       trade_name = excluded.trade_name,
       customer_code = excluded.customer_code,
       company_portal_enabled = true,
       status = 'active',
       billing_settings = companies.billing_settings || excluded.billing_settings,
       metadata = companies.metadata || excluded.metadata,
       deleted_at = null,
       updated_by = excluded.updated_by,
       updated_at = now()
     where companies.tenant_id = excluded.tenant_id
       and companies.metadata->>'fixture' = $9`,
    [
      COMPANY.companyId,
      tenant.id,
      COMPANY.groupId,
      COMPANY.companyName,
      'PORTAL-OFFLINE-TESTE',
      JSON.stringify({ testEnvironment: true, currency: 'BRL' }),
      JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true, localOnly: true }),
      actor.user_id,
      FIXTURE_KEY,
    ],
  )
  await assertCompanyFixtureIdentity(client, tenant.id, true)

  await client.query(
    `insert into employees (
       id, tenant_id, company_id, identification_code, full_name, email,
       job_title, department, cost_center, status, metadata, created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6::citext, $7, $8, $9, 'active', $10::jsonb, $11, $11)
     on conflict (id) do update set
       company_id = excluded.company_id,
       full_name = excluded.full_name,
       email = excluded.email,
       job_title = excluded.job_title,
       department = excluded.department,
       cost_center = excluded.cost_center,
       status = 'active',
       metadata = employees.metadata || excluded.metadata,
       deleted_at = null,
       updated_by = excluded.updated_by,
       updated_at = now()
     where employees.tenant_id = excluded.tenant_id
       and employees.metadata->>'fixture' = $12`,
    [
      COMPANY.employeeId,
      tenant.id,
      COMPANY.companyId,
      'PORTAL-OFFLINE-TRAVELER-01',
      '[TESTE] Viajante Portal Offline',
      'viajante.portal.offline@test.invalid',
      'Viajante de teste',
      'Homologacao local',
      'CC-PORTAL-TESTE',
      JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true, localOnly: true }),
      actor.user_id,
      FIXTURE_KEY,
    ],
  )

  await client.query(
    `insert into requesters (
       id, tenant_id, company_id, employee_id, user_id, name, email,
       department, job_title, cost_center, status, permissions
     ) values ($1, $2, $3, $4, null, $5, $6::citext, $7, $8, $9, 'active', $10::jsonb)
     on conflict (id) do update set
       company_id = excluded.company_id,
       employee_id = excluded.employee_id,
       name = excluded.name,
       email = excluded.email,
       department = excluded.department,
       job_title = excluded.job_title,
       cost_center = excluded.cost_center,
       status = 'active',
       permissions = excluded.permissions,
       deleted_at = null,
       updated_at = now()
     where requesters.tenant_id = excluded.tenant_id
       and requesters.permissions->>'fixture' = $11`,
    [
      COMPANY.requesterId,
      tenant.id,
      COMPANY.companyId,
      COMPANY.employeeId,
      '[TESTE] Solicitante Portal Offline',
      'solicitante.portal.offline@test.invalid',
      'Homologacao local',
      'Solicitante de teste',
      'CC-PORTAL-TESTE',
      JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true, canRequest: true }),
      FIXTURE_KEY,
    ],
  )

  const brandingId = stableUuid(`${FIXTURE_KEY}:branding:${tenant.id}:${COMPANY.companyId}`)
  await client.query(
    `insert into corporate_branding_settings (
       id, tenant_id, scope_type, company_id, display_name,
       primary_color, accent_color, sidebar_color,
       document_legal_name, created_by, updated_by
     ) values ($1, $2, 'company', $3, $4, '#E85D2A', '#2F80ED', '#243B6B', $4, $5, $5)
     on conflict (tenant_id, company_id) where scope_type = 'company'
     do update set
       display_name = excluded.display_name,
       primary_color = excluded.primary_color,
       accent_color = excluded.accent_color,
       sidebar_color = excluded.sidebar_color,
       document_legal_name = excluded.document_legal_name,
       version = corporate_branding_settings.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [brandingId, tenant.id, COMPANY.companyId, COMPANY.companyName, actor.user_id],
  )

  const travelerSettingsId = stableUuid(`${FIXTURE_KEY}:traveler-settings:${tenant.id}:${COMPANY.companyId}`)
  await client.query(
    `insert into traveler_management_settings (
       id, tenant_id, scope_type, company_id,
       allow_requester_traveler_management, created_by, updated_by
     ) values ($1, $2, 'company', $3, true, $4, $4)
     on conflict (tenant_id, company_id) where scope_type = 'company'
     do update set
       allow_requester_traveler_management = true,
       version = traveler_management_settings.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [travelerSettingsId, tenant.id, COMPANY.companyId, actor.user_id],
  )
}

async function assertCompanyFixtureIdentity(client, tenantId, mustExist = false) {
  const result = await client.query(
    `select tenant_id, metadata->>'fixture' as fixture from companies where id = $1 for update`,
    [COMPANY.companyId],
  )
  if (mustExist && !result.rows[0]) {
    throw new Error('empresa fixture nao foi criada')
  }
  if (result.rows[0]
      && (result.rows[0].tenant_id !== tenantId || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error(`colisao com empresa que nao pertence a fixture: ${COMPANY.companyId}`)
  }
}

async function upsertFixtureCorporateDirectoryStorage(client, { tenant, actor }) {
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [tenant.id, DIRECTORY_STORAGE_KEY],
  )
  const currentResult = await client.query(
    `select value
       from app_kv
      where tenant_id = $1 and key = $2
      for update`,
    [tenant.id, DIRECTORY_STORAGE_KEY],
  )
  const currentValue = currentResult.rows[0]?.value
  const mergedValue = mergeFixtureCorporateDirectoryStorageValue(currentValue)
  const coverage = await requireRelationalDirectoryCoverage(client, tenant.id, mergedValue)
  if (currentResult.rowCount === 1 && mergedValue === currentValue) {
    return {
      key: DIRECTORY_STORAGE_KEY,
      changed: false,
      ...assertFixtureCorporateDirectoryStorageValue(currentValue),
      coverage,
    }
  }

  const persisted = await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()
     where app_kv.value is distinct from excluded.value
     returning value`,
    [tenant.id, DIRECTORY_STORAGE_KEY, JSON.stringify(mergedValue), actor.user_id],
  )
  if (persisted.rowCount !== 1) {
    throw new Error('nao foi possivel persistir o diretorio gerencial da fixture')
  }
  return {
    key: DIRECTORY_STORAGE_KEY,
    changed: true,
    ...assertFixtureCorporateDirectoryStorageValue(persisted.rows[0].value),
    coverage,
  }
}

async function validateFixtureCorporateDirectoryStorage(client, tenantId) {
  const result = await client.query(
    `select value
       from app_kv
      where tenant_id = $1 and key = $2`,
    [tenantId, DIRECTORY_STORAGE_KEY],
  )
  if (result.rowCount !== 1) {
    throw new Error(`fixture local invalida: ${DIRECTORY_STORAGE_KEY} ausente`)
  }
  return {
    ...assertFixtureCorporateDirectoryStorageValue(result.rows[0].value),
    coverage: await requireRelationalDirectoryCoverage(client, tenantId, result.rows[0].value),
  }
}

export function mergeFixtureCorporateDirectoryStorageValue(storageValue) {
  const hasCurrentValue = storageValue !== undefined && storageValue !== null
  if (hasCurrentValue && !isDirectoryRecord(storageValue)) {
    throw new Error(`colisao no ${DIRECTORY_STORAGE_KEY}: valor persistido nao e um objeto`)
  }

  const container = hasCurrentValue
    ? storageValue
    : { state: {}, version: 1 }
  const wrapped = Object.prototype.hasOwnProperty.call(container, 'state')
  if (wrapped && !isDirectoryRecord(container.state)) {
    throw new Error(`colisao no ${DIRECTORY_STORAGE_KEY}: state persistido nao e um objeto`)
  }
  const state = wrapped ? container.state : container

  assertNoFixtureIdInWrongDirectoryArray(state)
  const gruposEmpresariais = mergeFixtureDirectoryEntity(
    readDirectoryArray(state, 'gruposEmpresariais'),
    DIRECTORY_FIXTURE_ENTITIES.group,
    {
      entityLabel: 'grupo',
      naturalKeys: ['codigo', 'nome'],
      enforce: (existing, expected) => ({
        id: expected.id,
        nome: expected.nome,
        codigo: expected.codigo,
        descricao: expected.descricao,
        ativo: true,
        fixture: FIXTURE_KEY,
        empresa_ids: uniqueDirectoryStrings([
          ...readOptionalDirectoryStringArray(existing, 'empresa_ids'),
          COMPANY.companyId,
        ]),
      }),
    },
  )
  const empresas = mergeFixtureDirectoryEntity(
    readDirectoryArray(state, 'empresas'),
    DIRECTORY_FIXTURE_ENTITIES.company,
    {
      entityLabel: 'empresa',
      naturalKeys: ['codigo_cliente', 'nome'],
      enforce: (_existing, expected) => ({
        id: expected.id,
        nome: expected.nome,
        grupo_id: COMPANY.groupId,
        codigo_cliente: expected.codigo_cliente,
        ativa: true,
        portal_empresa_habilitado: true,
        fixture: FIXTURE_KEY,
      }),
    },
  )
  const funcionarios = mergeFixtureDirectoryEntity(
    readDirectoryArray(state, 'funcionarios'),
    DIRECTORY_FIXTURE_ENTITIES.employee,
    {
      entityLabel: 'funcionario',
      naturalKeys: ['codigo_identificacao', 'email'],
      canAdoptUnmarked: (existing, expected) => (
        ['company_id', 'codigo_identificacao', 'nome', 'email']
          .every((key) => existing[key] === expected[key])
      ),
      enforce: (_existing, expected) => ({
        id: expected.id,
        company_id: COMPANY.companyId,
        codigo_identificacao: expected.codigo_identificacao,
        nome: expected.nome,
        email: expected.email,
        cargo_original: expected.cargo_original,
        lotacao: expected.lotacao,
        centro_custo: expected.centro_custo,
        ativo: true,
        fixture: FIXTURE_KEY,
      }),
    },
  )

  const nextState = {
    ...state,
    gruposEmpresariais,
    empresas,
    funcionarios,
  }
  const merged = wrapped ? { ...container, state: nextState } : nextState
  return hasCurrentValue && canonicalJson(merged) === canonicalJson(storageValue)
    ? storageValue
    : merged
}

export function assertFixtureCorporateDirectoryStorageValue(storageValue) {
  const merged = mergeFixtureCorporateDirectoryStorageValue(storageValue)
  if (merged !== storageValue) {
    throw new Error(`fixture local invalida: ${DIRECTORY_STORAGE_KEY} nao contem o diretorio completo`)
  }
  const container = storageValue
  const state = Object.prototype.hasOwnProperty.call(container, 'state')
    ? container.state
    : container
  const group = state.gruposEmpresariais.find((item) => item?.id === COMPANY.groupId)
  const company = state.empresas.find((item) => item?.id === COMPANY.companyId)
  const employee = state.funcionarios.find((item) => item?.id === COMPANY.employeeId)
  if (!group.empresa_ids.includes(COMPANY.companyId)
      || company.grupo_id !== COMPANY.groupId
      || company.portal_empresa_habilitado !== true
      || employee.company_id !== COMPANY.companyId) {
    throw new Error(`fixture local invalida: relacionamentos divergentes no ${DIRECTORY_STORAGE_KEY}`)
  }
  return {
    groupId: group.id,
    companyId: company.id,
    employeeId: employee.id,
  }
}

async function requireRelationalDirectoryCoverage(client, tenantId, storageValue) {
  const result = await client.query(
    `select
       coalesce(array(
         select id from business_groups
          where tenant_id = $1 and deleted_at is null
          order by id
       ), array[]::text[]) as group_ids,
       coalesce(array(
         select id from companies
          where tenant_id = $1 and deleted_at is null
          order by id
       ), array[]::text[]) as company_ids,
       coalesce(array(
         select id from employees
          where tenant_id = $1 and deleted_at is null
          order by id
       ), array[]::text[]) as employee_ids`,
    [tenantId],
  )
  return assertCorporateDirectoryStorageCoversRelationalIds(storageValue, {
    groups: result.rows[0].group_ids,
    companies: result.rows[0].company_ids,
    employees: result.rows[0].employee_ids,
  })
}

export function assertCorporateDirectoryStorageCoversRelationalIds(storageValue, relationalIds) {
  if (!isDirectoryRecord(storageValue)) {
    throw new Error(`diretorio parcial recusado: ${DIRECTORY_STORAGE_KEY} nao e um objeto`)
  }
  const state = Object.prototype.hasOwnProperty.call(storageValue, 'state')
    ? storageValue.state
    : storageValue
  if (!isDirectoryRecord(state)) {
    throw new Error(`diretorio parcial recusado: state de ${DIRECTORY_STORAGE_KEY} nao e um objeto`)
  }
  const stored = {
    groups: directoryIds(readDirectoryArray(state, 'gruposEmpresariais')),
    companies: directoryIds(readDirectoryArray(state, 'empresas')),
    employees: directoryIds(readDirectoryArray(state, 'funcionarios')),
  }
  if (!isDirectoryRecord(relationalIds)) {
    throw new Error('diretorio parcial recusado: cobertura relacional invalida')
  }
  const missing = ['groups', 'companies', 'employees'].flatMap((entity) => {
    const values = relationalIds[entity]
    if (!Array.isArray(values)) {
      throw new Error(`diretorio parcial recusado: ids relacionais de ${entity} invalidos`)
    }
    return values
      .map((value) => String(value || '').trim())
      .filter((id) => id && !stored[entity].has(id))
      .map((id) => `${entity}/${id}`)
  })
  if (missing.length > 0) {
    throw new Error(
      `diretorio parcial recusado: registros relacionais ausentes no ${DIRECTORY_STORAGE_KEY}: ${missing.join(', ')}`,
    )
  }
  return {
    groups: stored.groups.size,
    companies: stored.companies.size,
    employees: stored.employees.size,
  }
}

function mergeFixtureDirectoryEntity(items, expected, {
  entityLabel,
  naturalKeys,
  canAdoptUnmarked = () => false,
  enforce,
}) {
  const expectedId = String(expected.id)
  const exactMatches = items.filter((item) => isDirectoryRecord(item) && item.id === expectedId)
  if (exactMatches.length > 1) {
    throw new Error(`colisao no diretorio: ${entityLabel} duplicado ${expectedId}`)
  }

  for (const item of items) {
    if (!isDirectoryRecord(item) || item.id === expectedId) continue
    if (isFixtureDirectoryEntity(item)) {
      throw new Error(`colisao no diretorio: ${entityLabel} da fixture usa id divergente ${String(item.id || '')}`)
    }
    for (const key of naturalKeys) {
      const incoming = normalizeDirectoryCollisionValue(expected[key])
      const current = normalizeDirectoryCollisionValue(item[key])
      if (incoming && current === incoming) {
        throw new Error(`colisao no diretorio: ${entityLabel} ja usa ${key} com outro id`)
      }
    }
  }

  const existing = exactMatches[0]
  if (!existing) {
    return [...items, cloneDirectoryFixtureEntity(expected)]
  }
  if (!isFixtureDirectoryEntity(existing) && !canAdoptUnmarked(existing, expected)) {
    throw new Error(`colisao no diretorio: ${entityLabel} ${expectedId} nao pertence a fixture`)
  }
  const reconciled = {
    ...cloneDirectoryFixtureEntity(expected),
    ...existing,
    ...enforce(existing, expected),
    created_at: existing.created_at || expected.created_at,
  }
  if (canonicalJson(reconciled) === canonicalJson(existing)) return items
  return items.map((item) => item === existing ? reconciled : item)
}

function assertNoFixtureIdInWrongDirectoryArray(state) {
  const expected = new Map([
    [COMPANY.groupId, 'gruposEmpresariais'],
    [COMPANY.companyId, 'empresas'],
    [COMPANY.employeeId, 'funcionarios'],
  ])
  for (const key of ['gruposEmpresariais', 'empresas', 'funcionarios']) {
    for (const item of readDirectoryArray(state, key)) {
      if (!isDirectoryRecord(item)) continue
      const expectedArray = expected.get(String(item.id || ''))
      if (expectedArray && expectedArray !== key) {
        throw new Error(`colisao no diretorio: id da fixture ${String(item.id)} encontrado em ${key}`)
      }
    }
  }
}

function readDirectoryArray(state, key) {
  if (!Object.prototype.hasOwnProperty.call(state, key)) return []
  if (!Array.isArray(state[key])) {
    throw new Error(`colisao no ${DIRECTORY_STORAGE_KEY}: ${key} nao e uma lista`)
  }
  return state[key]
}

function readOptionalDirectoryStringArray(value, key) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return []
  if (!Array.isArray(value[key])) {
    throw new Error(`colisao no diretorio: ${key} nao e uma lista`)
  }
  return value[key].map((item) => String(item || '').trim()).filter(Boolean)
}

function isFixtureDirectoryEntity(value) {
  return value.fixture === FIXTURE_KEY
    || (isDirectoryRecord(value.metadata) && value.metadata.fixture === FIXTURE_KEY)
}

function cloneDirectoryFixtureEntity(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeDirectoryCollisionValue(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

function uniqueDirectoryStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function directoryIds(items) {
  return new Set(items
    .filter(isDirectoryRecord)
    .map((item) => String(item.id || '').trim())
    .filter(Boolean))
}

function isDirectoryRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function upsertSources(client, { tenant, actor }) {
  const result = {}
  for (const [key, source] of Object.entries(SOURCES)) {
    const sourceId = stableUuid(`${FIXTURE_KEY}:source:${source.key}`)
    await assertOwnedRow(client, {
      table: 'offline_catalog_sources',
      id: sourceId,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    await client.query(
      `insert into offline_catalog_sources (
         id, tenant_id, source_key, source_name, source_kind, refresh_mode,
         base_url, license_name, license_url, authoritative_for,
         review_interval_days, last_observed_at, status, metadata,
         created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[],
         $11, $12::timestamptz, 'active', $13::jsonb, $14, $14
       )
       on conflict (tenant_id, source_key) do update set
         source_name = excluded.source_name,
         source_kind = excluded.source_kind,
         refresh_mode = excluded.refresh_mode,
         base_url = excluded.base_url,
         license_name = excluded.license_name,
         license_url = excluded.license_url,
         authoritative_for = excluded.authoritative_for,
         review_interval_days = excluded.review_interval_days,
         last_observed_at = excluded.last_observed_at,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = offline_catalog_sources.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where offline_catalog_sources.metadata->>'fixture' = $15
         and (offline_catalog_sources.source_name is distinct from excluded.source_name
           or offline_catalog_sources.source_kind is distinct from excluded.source_kind
           or offline_catalog_sources.refresh_mode is distinct from excluded.refresh_mode
           or offline_catalog_sources.base_url is distinct from excluded.base_url
           or offline_catalog_sources.license_name is distinct from excluded.license_name
           or offline_catalog_sources.license_url is distinct from excluded.license_url
           or offline_catalog_sources.authoritative_for is distinct from excluded.authoritative_for
           or offline_catalog_sources.review_interval_days is distinct from excluded.review_interval_days
           or offline_catalog_sources.last_observed_at is distinct from excluded.last_observed_at
           or offline_catalog_sources.status is distinct from 'active'
           or offline_catalog_sources.metadata is distinct from excluded.metadata
           or offline_catalog_sources.deleted_at is not null)`,
      [
        sourceId,
        tenant.id,
        source.key,
        source.name,
        source.kind,
        source.refreshMode,
        source.baseUrl,
        source.licenseName,
        source.licenseUrl,
        source.authoritativeFor,
        source.reviewIntervalDays,
        source.observedAt,
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          referenceOnly: source.kind !== 'local_fixture',
        }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    const inserted = await client.query(
      `select id
         from offline_catalog_sources
        where id = $1 and tenant_id = $2 and source_key = $3
          and metadata->>'fixture' = $4
          and status = 'active' and deleted_at is null`,
      [sourceId, tenant.id, source.key, FIXTURE_KEY],
    )
    if (!inserted.rows[0]?.id) {
      throw new Error(`fonte nao pertence a fixture: ${source.key}`)
    }
    result[key] = { id: inserted.rows[0].id, ...source }
  }
  return result
}

async function upsertSuppliers(client, { tenant, actor, sources }) {
  const result = {}
  for (const [key, supplier] of Object.entries(SUPPLIERS)) {
    const supplierId = stableUuid(`${FIXTURE_KEY}:supplier:${supplier.code}`)
    await assertOwnedRow(client, {
      table: 'commercial_suppliers',
      id: supplierId,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const source = sources[supplier.sourceKey]
    const inserted = await client.query(
      `insert into commercial_suppliers (
         id, tenant_id, internal_code, legal_name, trade_name,
         document_type, document_number, service_types, reservation_system,
         website, notes, status, metadata, created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, 'other', null, $6::text[], 'manual',
         $7, $8, 'active', $9::jsonb, $10, $10
       )
       on conflict (tenant_id, internal_code) do update set
         legal_name = excluded.legal_name,
         trade_name = excluded.trade_name,
         service_types = excluded.service_types,
         reservation_system = excluded.reservation_system,
         website = excluded.website,
         notes = excluded.notes,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = commercial_suppliers.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where commercial_suppliers.metadata->>'fixture' = $11
       returning id`,
      [
        supplierId,
        tenant.id,
        supplier.code,
        supplier.legalName,
        supplier.tradeName,
        supplier.serviceTypes,
        source.baseUrl,
        supplier.synthetic
          ? 'Fornecedor sintetico exclusivo para teste local.'
          : 'Referencia publica sem contrato, tarifa ou disponibilidade comercial.',
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: supplier.synthetic,
          referenceOnly: !supplier.synthetic,
          sourceId: source.id,
          sourceUrl: source.baseUrl,
          sourceObservedAt: source.observedAt,
          reviewStatus: supplier.synthetic ? 'not_applicable' : 'pending',
          ...(key === 'guanabara' ? { officialDocumentNumberReference: '41.550.112/0001-01' } : {}),
        }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    if (!inserted.rows[0]?.id) {
      throw new Error(`fornecedor nao pertence a fixture: ${supplier.code}`)
    }
    result[key] = { id: inserted.rows[0].id, ...supplier }
  }
  return result
}

async function upsertHotels(client, { tenant, actor, geography, supplier, sources, storage }) {
  const results = []
  for (const hotel of HOTELS) {
    const geo = geography[hotel.cityKey]
    const syntheticIdentity = hotel.syntheticIdentity !== false
    const identitySource = sources[hotel.identitySourceKey || 'fixture']
    const photoSource = hotel.photo ? sources[hotel.photo.sourceKey] : null
    if (!identitySource || (hotel.photo && !photoSource)) {
      throw new Error(`fonte do hotel ausente na fixture: ${hotel.id}`)
    }
    const hotelMetadata = {
      ...(hotel.verifiedAmenities || {}),
      fixture: FIXTURE_KEY,
      localOnly: true,
      synthetic: syntheticIdentity,
      syntheticIdentity,
      referenceOnly: !syntheticIdentity,
      identitySourceId: identitySource.id,
      identitySourceUrl: identitySource.baseUrl,
      identitySourceObservedAt: identitySource.observedAt,
      syntheticRoomsAndRates: true,
      noCommercialAgreement: true,
      ...(hotel.photo ? {
        photoSourceId: photoSource.id,
        photoSourceUrl: photoSource.baseUrl,
        photoAuthor: hotel.photo.author,
        photoLicenseName: photoSource.licenseName,
        photoLicenseUrl: photoSource.licenseUrl,
        photoSha256: hotel.photo.expectedSha256,
        photoTransformation: hotel.photo.transformation,
      } : {}),
    }
    if (!syntheticIdentity) {
      const duplicateIdentity = await client.query(
        `select id
           from hotels
          where tenant_id = $1 and city_id = $2
            and normalized_name = $3 and id <> $4
            and deleted_at is null
          order by id
          limit 1
          for update`,
        [tenant.id, geo.city_id, normalizeName(hotel.name), hotel.id],
      )
      if (duplicateIdentity.rows[0]) {
        throw new Error(
          `hotel real ja cadastrado com outro id: ${hotel.name}/${duplicateIdentity.rows[0].id}`,
        )
      }
    }
    const existing = await client.query(
      'select tenant_id, source from hotels where id = $1 for update',
      [hotel.id],
    )
    if (existing.rows[0]
        && (existing.rows[0].tenant_id !== tenant.id || existing.rows[0].source !== 'local_fixture')) {
      throw new Error(`hotel nao pertence a fixture: ${hotel.id}`)
    }
    await client.query(
      `insert into hotels (
         id, tenant_id, name, normalized_name,
         country, state, city, country_id, subdivision_id, city_id,
         address, phone, website, category, star_rating, billing_enabled, amenities,
         status, source, created_by, updated_by
       ) values (
         $1, $2, $3, $4,
         'BR', $5, $6, $7::uuid, $8::uuid, $9::uuid,
         $10, $11, $12, $13, null, false, $14::jsonb,
         'active', 'local_fixture', $15, $15
       )
       on conflict (id) do update set
         name = excluded.name,
         normalized_name = excluded.normalized_name,
         country = excluded.country,
         state = excluded.state,
         city = excluded.city,
         country_id = excluded.country_id,
         subdivision_id = excluded.subdivision_id,
         city_id = excluded.city_id,
         address = excluded.address,
         phone = excluded.phone,
         website = excluded.website,
         category = excluded.category,
         star_rating = excluded.star_rating,
         billing_enabled = false,
         amenities = excluded.amenities,
         status = 'active',
         source = 'local_fixture',
         deleted_at = null,
         version = hotels.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where hotels.tenant_id = excluded.tenant_id
         and hotels.source = 'local_fixture'
         and (hotels.name is distinct from excluded.name
           or hotels.normalized_name is distinct from excluded.normalized_name
           or hotels.country is distinct from excluded.country
           or hotels.state is distinct from excluded.state
           or hotels.city is distinct from excluded.city
           or hotels.country_id is distinct from excluded.country_id
           or hotels.subdivision_id is distinct from excluded.subdivision_id
           or hotels.city_id is distinct from excluded.city_id
           or hotels.address is distinct from excluded.address
           or hotels.phone is distinct from excluded.phone
           or hotels.website is distinct from excluded.website
           or hotels.category is distinct from excluded.category
           or hotels.star_rating is distinct from excluded.star_rating
           or hotels.billing_enabled is distinct from false
           or hotels.amenities is distinct from excluded.amenities
           or hotels.status is distinct from 'active'
           or hotels.deleted_at is not null)`,
      [
        hotel.id,
        tenant.id,
        hotel.name,
        normalizeName(hotel.name),
        geo.subdivision_code,
        geo.city_name,
        geo.country_id,
        geo.subdivision_id,
        geo.city_id,
        hotel.address,
        hotel.phone || null,
        hotel.website || null,
        syntheticIdentity ? '[TESTE] Executivo' : '[TESTE] Categoria simulada',
        JSON.stringify(hotelMetadata),
        actor.user_id,
      ],
    )

    const roomIds = {}
    for (const room of ROOM_TYPES) {
      const roomId = stableUuid(`${FIXTURE_KEY}:room:${hotel.id}:${room.code}`)
      await assertOwnedRoom(client, { roomId, tenantId: tenant.id, hotelId: hotel.id })
      await client.query(
        `insert into hotel_room_types (
           id, tenant_id, hotel_id, code, name, occupancy_type,
           max_guests, max_adults, max_children, bed_configuration,
           amenities, is_active, created_by, updated_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, true, $12, $12)
         on conflict (tenant_id, hotel_id, code) do update set
           name = excluded.name,
           occupancy_type = excluded.occupancy_type,
           max_guests = excluded.max_guests,
           max_adults = excluded.max_adults,
           max_children = excluded.max_children,
           bed_configuration = excluded.bed_configuration,
           amenities = excluded.amenities,
           is_active = true,
           deleted_at = null,
           version = hotel_room_types.version + 1,
           updated_by = excluded.updated_by,
           updated_at = now()
         where hotel_room_types.amenities->>'fixture' = $13
           and (hotel_room_types.name is distinct from excluded.name
             or hotel_room_types.occupancy_type is distinct from excluded.occupancy_type
             or hotel_room_types.max_guests is distinct from excluded.max_guests
             or hotel_room_types.max_adults is distinct from excluded.max_adults
             or hotel_room_types.max_children is distinct from excluded.max_children
             or hotel_room_types.bed_configuration is distinct from excluded.bed_configuration
             or hotel_room_types.amenities is distinct from excluded.amenities
             or hotel_room_types.is_active is distinct from true
             or hotel_room_types.deleted_at is not null)`,
        [
          roomId,
          tenant.id,
          hotel.id,
          room.code,
          room.name,
          room.occupancyType,
          room.maxGuests,
          room.maxAdults,
          room.maxChildren,
          room.bedConfiguration,
          JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true }),
          actor.user_id,
          FIXTURE_KEY,
        ],
      )
      const roomResult = await client.query(
        `select id
           from hotel_room_types
          where id = $1 and tenant_id = $2 and hotel_id = $3
            and amenities->>'fixture' = $4
            and is_active and deleted_at is null`,
        [roomId, tenant.id, hotel.id, FIXTURE_KEY],
      )
      if (!roomResult.rows[0]?.id) throw new Error(`quarto nao pertence a fixture: ${hotel.id}/${room.code}`)
      roomIds[room.code] = roomResult.rows[0].id
    }

    const linkId = stableUuid(`${FIXTURE_KEY}:hotel-supplier:${hotel.id}:${supplier.id}`)
    await assertOwnedRow(client, {
      table: 'hotel_suppliers',
      id: linkId,
      tenantId: tenant.id,
      fixtureExpression: "commercial_terms->>'fixture'",
    })
    await client.query(
      `insert into hotel_suppliers (
         id, tenant_id, hotel_id, supplier_id, supplier_property_code,
         priority, commercial_terms, is_active, created_by, updated_by
       ) values ($1, $2, $3, $4, $5, 10, $6::jsonb, true, $7, $7)
       on conflict (tenant_id, hotel_id, supplier_id) do update set
         supplier_property_code = excluded.supplier_property_code,
         priority = excluded.priority,
         commercial_terms = excluded.commercial_terms,
         is_active = true,
         ended_at = null,
         version = hotel_suppliers.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where hotel_suppliers.commercial_terms->>'fixture' = $8
         and (hotel_suppliers.supplier_property_code is distinct from excluded.supplier_property_code
           or hotel_suppliers.priority is distinct from excluded.priority
           or hotel_suppliers.commercial_terms is distinct from excluded.commercial_terms
           or hotel_suppliers.is_active is distinct from true
           or hotel_suppliers.ended_at is not null)`,
      [
        linkId,
        tenant.id,
        hotel.id,
        supplier.id,
        hotel.propertyCode,
        JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true, localOnly: true }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    const linkResult = await client.query(
      `select id
         from hotel_suppliers
        where id = $1 and tenant_id = $2 and hotel_id = $3 and supplier_id = $4
          and commercial_terms->>'fixture' = $5
          and is_active and ended_at is null`,
      [linkId, tenant.id, hotel.id, supplier.id, FIXTURE_KEY],
    )
    if (!linkResult.rows[0]?.id) throw new Error(`vinculo hoteleiro nao pertence a fixture: ${hotel.id}`)

    for (const room of ROOM_TYPES) {
      const rateId = stableUuid(`${FIXTURE_KEY}:hotel-rate:${hotel.id}:${room.code}`)
      await assertOwnedRow(client, {
        table: 'hotel_supplier_rates',
        id: rateId,
        tenantId: tenant.id,
        fixtureExpression: "metadata->>'fixture'",
      })
      await client.query(
        `insert into hotel_supplier_rates (
           id, tenant_id, hotel_id, hotel_supplier_id, room_type_id,
           rate_code, valid_from, valid_until, nightly_amount, tax_amount,
           rack_amount, service_fee_amount, currency, refundable, meal_plan,
           cancellation_policy, metadata, is_active, is_net, is_suspended,
           scope_type, created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6, date '2026-01-01', date '2035-12-31',
           $7::numeric, 0, $7::numeric, 0, 'BRL', true,
           'Cafe da manha [TESTE]', 'Politica ficticia para testes locais.',
           $8::jsonb, true, false, false, 'global', $9, $9
         )
         on conflict (tenant_id, hotel_supplier_id, room_type_id, rate_code, valid_from)
         do update set
           valid_until = excluded.valid_until,
           nightly_amount = excluded.nightly_amount,
           tax_amount = excluded.tax_amount,
           rack_amount = excluded.rack_amount,
           service_fee_amount = excluded.service_fee_amount,
           currency = excluded.currency,
           refundable = excluded.refundable,
           meal_plan = excluded.meal_plan,
           cancellation_policy = excluded.cancellation_policy,
           metadata = excluded.metadata,
           is_active = true,
           is_net = false,
           is_suspended = false,
           scope_type = 'global',
           version = hotel_supplier_rates.version + 1,
           updated_by = excluded.updated_by,
           updated_at = now()
         where hotel_supplier_rates.metadata->>'fixture' = $10
           and (hotel_supplier_rates.valid_until is distinct from excluded.valid_until
             or hotel_supplier_rates.nightly_amount is distinct from excluded.nightly_amount
             or hotel_supplier_rates.tax_amount is distinct from excluded.tax_amount
             or hotel_supplier_rates.rack_amount is distinct from excluded.rack_amount
             or hotel_supplier_rates.service_fee_amount is distinct from excluded.service_fee_amount
             or hotel_supplier_rates.currency is distinct from excluded.currency
             or hotel_supplier_rates.refundable is distinct from excluded.refundable
             or hotel_supplier_rates.meal_plan is distinct from excluded.meal_plan
             or hotel_supplier_rates.cancellation_policy is distinct from excluded.cancellation_policy
             or hotel_supplier_rates.metadata is distinct from excluded.metadata
             or hotel_supplier_rates.is_active is distinct from true
             or hotel_supplier_rates.is_net is distinct from false
             or hotel_supplier_rates.is_suspended is distinct from false
             or hotel_supplier_rates.scope_type is distinct from 'global')`,
        [
          rateId,
          tenant.id,
          hotel.id,
          linkResult.rows[0].id,
          roomIds[room.code],
          `TESTE-${hotel.propertyCode}-${room.code}`,
          hotel[room.amountKey],
          JSON.stringify({ fixture: FIXTURE_KEY, synthetic: true, localOnly: true }),
          actor.user_id,
          FIXTURE_KEY,
        ],
      )
      const rateResult = await client.query(
        `select id
           from hotel_supplier_rates
          where id = $1 and tenant_id = $2 and hotel_id = $3
            and hotel_supplier_id = $4 and room_type_id = $5
            and rate_code = $6 and valid_from = date '2026-01-01'
            and metadata->>'fixture' = $7
            and is_active and not is_suspended`,
        [
          rateId,
          tenant.id,
          hotel.id,
          linkResult.rows[0].id,
          roomIds[room.code],
          `TESTE-${hotel.propertyCode}-${room.code}`,
          FIXTURE_KEY,
        ],
      )
      if (!rateResult.rows[0]?.id) {
        throw new Error(`tarifa nao pertence a fixture: ${hotel.id}/${room.code}`)
      }
    }
    const mediaId = hotel.photo
      ? await upsertHotelFixtureMedia(client, {
          tenant,
          actor,
          hotel,
          source: photoSource,
          storage,
        })
      : null
    results.push({
      id: hotel.id,
      name: hotel.name,
      city: geo.city_name,
      syntheticIdentity,
      syntheticRoomsAndRates: true,
      mediaId,
    })
  }
  return results
}

async function upsertHotelFixtureMedia(client, { tenant, actor, hotel, source, storage }) {
  const photo = hotel.photo
  if (!photo || !/^[a-z0-9][a-z0-9.-]+\.webp$/.test(photo.assetFile)) {
    throw new Error(`ativo WebP invalido para o hotel: ${hotel.id}`)
  }
  const bytes = await readFile(new URL(
    `./fixtures/company-portal-hotels/${photo.assetFile}`,
    import.meta.url,
  ))
  assertFixtureWebp(bytes, photo.assetFile)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== photo.expectedSha256) {
    throw new Error(`checksum inesperado para a foto ${photo.assetFile}`)
  }

  const fileId = hotelFixtureMediaFileId(hotel)
  const mediaId = hotelFixtureMediaId(hotel)
  const storageKey = `${tenant.id}/fixtures/${FIXTURE_KEY}/${fileId}.webp`
  const targetPath = fixtureMediaStoragePath(storage, storageKey)
  const description = [
    `Fixture local ${FIXTURE_KEY}.`,
    `source=${source.baseUrl}`,
    `author=${photo.author}`,
    `license=${source.licenseName}`,
    `licenseUrl=${source.licenseUrl}`,
    `sha256=${sha256}`,
    `transform=${photo.transformation}`,
  ].join(' | ')

  const fileRows = await client.query(
    `select id, tenant_id, purpose, entity_type, entity_id, storage_key,
            mime_type, size_bytes, sha256
       from stored_files
      where id = $1 or storage_key = $2
      for update`,
    [fileId, storageKey],
  )
  if (fileRows.rowCount > 1) {
    throw new Error(`colisao de arquivo da fixture para o hotel: ${hotel.id}`)
  }
  const existingFile = fileRows.rows[0]
  if (existingFile && (
    existingFile.id !== fileId
    || existingFile.tenant_id !== tenant.id
    || existingFile.purpose !== 'hotel_catalog_media'
    || existingFile.entity_type !== 'hotel'
    || existingFile.entity_id !== hotel.id
    || existingFile.storage_key !== storageKey
    || existingFile.mime_type !== 'image/webp'
    || Number(existingFile.size_bytes) !== bytes.length
    || existingFile.sha256 !== sha256
  )) {
    throw new Error(`arquivo existente nao pertence a fixture do hotel: ${hotel.id}`)
  }

  await materializeFixtureMedia(storage, targetPath, bytes, sha256)
  if (!existingFile) {
    await client.query(
      `insert into stored_files (
         id, tenant_id, uploaded_by, purpose, entity_type, entity_id,
         original_name, storage_key, mime_type, size_bytes, sha256,
         description, status
       ) values (
         $1, $2, $3, 'hotel_catalog_media', 'hotel', $4,
         $5, $6, 'image/webp', $7, $8, $9, 'active'
       )`,
      [
        fileId,
        tenant.id,
        actor.user_id,
        hotel.id,
        photo.assetFile,
        storageKey,
        bytes.length,
        sha256,
        description,
      ],
    )
  } else {
    await client.query(
      `update stored_files
          set original_name = $2,
              description = $3,
              status = 'active',
              deleted_at = null
        where id = $1
          and (original_name is distinct from $2
            or description is distinct from $3
            or status is distinct from 'active'
            or deleted_at is not null)`,
      [fileId, photo.assetFile, description],
    )
  }

  const mediaRows = await client.query(
    `select id, tenant_id, hotel_id, room_type_id, file_id
       from hotel_catalog_media
      where id = $1 or (tenant_id = $2 and file_id = $3)
      for update`,
    [mediaId, tenant.id, fileId],
  )
  if (mediaRows.rowCount > 1) {
    throw new Error(`colisao de midia da fixture para o hotel: ${hotel.id}`)
  }
  const existingMedia = mediaRows.rows[0]
  if (existingMedia && (
    existingMedia.id !== mediaId
    || existingMedia.tenant_id !== tenant.id
    || existingMedia.hotel_id !== hotel.id
    || existingMedia.room_type_id !== null
    || existingMedia.file_id !== fileId
  )) {
    throw new Error(`midia existente nao pertence a fixture do hotel: ${hotel.id}`)
  }

  if (!existingMedia) {
    await client.query(
      `insert into hotel_catalog_media (
         id, tenant_id, hotel_id, room_type_id, file_id, alt_text,
         sort_order, created_by, updated_by
       ) values ($1, $2, $3, null, $4, $5, 0, $6, $6)`,
      [mediaId, tenant.id, hotel.id, fileId, photo.altText, actor.user_id],
    )
  } else {
    await client.query(
      `update hotel_catalog_media
          set alt_text = $2,
              sort_order = 0,
              deleted_at = null,
              version = version + 1,
              updated_by = $3,
              updated_at = now()
        where id = $1
          and (alt_text is distinct from $2
            or sort_order is distinct from 0
            or deleted_at is not null)`,
      [mediaId, photo.altText, actor.user_id],
    )
  }
  return mediaId
}

function hotelFixtureMediaFileId(hotel) {
  return stableUuid(`${FIXTURE_KEY}:hotel-media-file:${hotel.id}:${hotel.photo.assetFile}`)
}

function hotelFixtureMediaId(hotel) {
  return stableUuid(`${FIXTURE_KEY}:hotel-media:${hotel.id}:${hotel.photo.assetFile}`)
}

function fixtureMediaStoragePath(storage, storageKey) {
  const target = resolve(storage.root, ...storageKey.split('/'))
  const scoped = relative(storage.root, target)
  if (!scoped || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || isAbsolute(scoped)) {
    throw new Error(`chave de armazenamento invalida para fixture: ${storageKey}`)
  }
  return target
}

async function materializeFixtureMedia(storage, targetPath, bytes, expectedSha256) {
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 })
    storage.createdFiles.add(targetPath)
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error
    const existingBytes = await readFile(targetPath)
    const existingSha256 = createHash('sha256').update(existingBytes).digest('hex')
    if (existingBytes.length !== bytes.length || existingSha256 !== expectedSha256) {
      throw new Error(`objeto privado existente diverge da fixture: ${targetPath}`)
    }
  }
}

function assertFixtureWebp(bytes, assetFile) {
  if (bytes.length < 12 || bytes.length > HOTEL_FIXTURE_MEDIA_MAX_BYTES
      || bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
      || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error(`foto da fixture nao e WebP valida: ${assetFile}`)
  }
}

async function upsertRentalLocations(client, { tenant, actor, geography, source, supplier }) {
  const results = []
  for (const location of MOVIDA_LOCATIONS) {
    const id = stableUuid(`${FIXTURE_KEY}:rental-location:${location.code}`)
    const geo = geography[location.cityKey]
    await assertOwnedRow(client, {
      table: 'rental_locations',
      id,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const row = await client.query(
      `insert into rental_locations (
         id, tenant_id, supplier_id, source_id, internal_code, external_code,
         name, location_type, country_id, subdivision_id, city_id,
         timezone, address_text, postal_code, opening_hours, reservation_channels,
         source_record_key, source_url, source_observed_at, review_status,
         status, metadata, created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'airport', $8, $9, $10,
         'America/Sao_Paulo', $11, null, '{}'::jsonb, '{}'::jsonb, $12, $13, $14::timestamptz,
         'pending', 'active', $15::jsonb, $16, $16
       )
       on conflict (tenant_id, supplier_id, internal_code) do update set
         source_id = excluded.source_id,
         external_code = excluded.external_code,
         name = excluded.name,
         location_type = excluded.location_type,
         country_id = excluded.country_id,
         subdivision_id = excluded.subdivision_id,
         city_id = excluded.city_id,
         timezone = excluded.timezone,
         address_text = excluded.address_text,
         source_record_key = excluded.source_record_key,
         source_url = excluded.source_url,
         source_observed_at = excluded.source_observed_at,
         review_status = 'pending',
         reviewed_at = null,
         reviewed_by = null,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = rental_locations.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where rental_locations.metadata->>'fixture' = $17
       returning id`,
      [
        id,
        tenant.id,
        supplier.id,
        source.id,
        location.code,
        location.sourceRecordKey,
        location.name,
        geo.country_id,
        geo.subdivision_id,
        geo.city_id,
        location.address,
        location.sourceRecordKey,
        location.sourceUrl,
        source.observedAt,
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: false,
          referenceOnly: true,
          noCommercialAgreement: true,
          noRates: true,
        }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    if (!row.rows[0]?.id) throw new Error(`loja nao pertence a fixture: ${location.code}`)
    results.push({ id: row.rows[0].id, code: location.code, sourceUrl: location.sourceUrl })
  }
  return results
}

async function upsertVerifiedTestRentalLocations(client, { tenant, actor, geography, source, supplier }) {
  const results = []
  for (const location of TEST_RENTAL_LOCATIONS) {
    const id = stableUuid(`${FIXTURE_KEY}:verified-rental-location:${location.code}`)
    const geo = geography[location.cityKey]
    await assertOwnedRow(client, {
      table: 'rental_locations',
      id,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const row = await client.query(
      `insert into rental_locations (
         id, tenant_id, supplier_id, source_id, internal_code, name,
         location_type, country_id, subdivision_id, city_id, timezone, address_text,
         opening_hours, reservation_channels, source_record_key, source_observed_at,
         review_status, reviewed_at, reviewed_by, status, metadata,
         created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5::text, $6, 'airport', $7, $8, $9, 'America/Sao_Paulo', $10,
         '{}'::jsonb, '{}'::jsonb, $5::text, now(),
         'verified', now(), $11, 'active', $12::jsonb, $11, $11
       )
       on conflict (tenant_id, supplier_id, internal_code) do update set
         source_id = excluded.source_id,
         name = excluded.name,
         location_type = excluded.location_type,
         country_id = excluded.country_id,
         subdivision_id = excluded.subdivision_id,
         city_id = excluded.city_id,
         timezone = excluded.timezone,
         address_text = excluded.address_text,
         source_record_key = excluded.source_record_key,
         source_observed_at = excluded.source_observed_at,
         review_status = 'verified',
         reviewed_at = now(),
         reviewed_by = excluded.reviewed_by,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = rental_locations.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where rental_locations.metadata->>'fixture' = $13
       returning id`,
      [
        id,
        tenant.id,
        supplier.id,
        source.id,
        location.code,
        location.name,
        geo.country_id,
        geo.subdivision_id,
        geo.city_id,
        location.address,
        actor.user_id,
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: true,
          verifiedForLocalTestingOnly: true,
          noCommercialAgreement: true,
          noRates: true,
        }),
        FIXTURE_KEY,
      ],
    )
    if (!row.rows[0]?.id) throw new Error(`loja sintetica nao pertence a fixture: ${location.code}`)
    results.push({ id: row.rows[0].id, code: location.code, synthetic: true, verified: true })
  }
  return results
}

async function upsertBusTerminals(client, { tenant, actor, geography, sources }) {
  const result = {}
  for (const terminal of BUS_TERMINALS) {
    const id = stableUuid(`${FIXTURE_KEY}:bus-terminal:${terminal.code}`)
    const geo = geography[terminal.cityKey]
    const source = sources[terminal.sourceKey]
    await assertOwnedRow(client, {
      table: 'bus_terminals',
      id,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const row = await client.query(
      `insert into bus_terminals (
         id, tenant_id, source_id, internal_code, external_code, name,
         terminal_type, country_id, subdivision_id, city_id,
         timezone, address_text, amenities, source_record_key, source_url,
         source_observed_at, review_status, status, metadata,
         created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, 'bus_terminal', $7, $8, $9,
         'America/Sao_Paulo', null, '{}'::jsonb, $10, $11, $12::timestamptz,
         'pending', 'active', $13::jsonb, $14, $14
       )
       on conflict (tenant_id, internal_code) do update set
         source_id = excluded.source_id,
         external_code = excluded.external_code,
         name = excluded.name,
         terminal_type = excluded.terminal_type,
         country_id = excluded.country_id,
         subdivision_id = excluded.subdivision_id,
         city_id = excluded.city_id,
         timezone = excluded.timezone,
         address_text = null,
         source_record_key = excluded.source_record_key,
         source_url = excluded.source_url,
         source_observed_at = excluded.source_observed_at,
         review_status = 'pending',
         reviewed_at = null,
         reviewed_by = null,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = bus_terminals.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where bus_terminals.metadata->>'fixture' = $15
       returning id`,
      [
        id,
        tenant.id,
        source.id,
        terminal.code,
        terminal.sourceRecordKey,
        terminal.name,
        geo.country_id,
        geo.subdivision_id,
        geo.city_id,
        terminal.sourceRecordKey,
        terminal.sourceUrl,
        source.observedAt,
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: false,
          referenceOnly: true,
          addressIntentionallyOmittedUntilReviewed: true,
        }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    if (!row.rows[0]?.id) throw new Error(`terminal nao pertence a fixture: ${terminal.code}`)
    result[terminal.code] = {
      id: row.rows[0].id,
      code: terminal.code,
      sourceUrl: terminal.sourceUrl,
    }
  }
  return result
}

async function upsertVerifiedTestBusTerminals(client, { tenant, actor, geography, source }) {
  const result = {}
  for (const terminal of TEST_BUS_TERMINALS) {
    const id = stableUuid(`${FIXTURE_KEY}:verified-bus-terminal:${terminal.code}`)
    const geo = geography[terminal.cityKey]
    await assertOwnedRow(client, {
      table: 'bus_terminals',
      id,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const row = await client.query(
      `insert into bus_terminals (
         id, tenant_id, source_id, internal_code, name, terminal_type,
         country_id, subdivision_id, city_id, timezone, address_text, amenities,
         source_record_key, source_observed_at, review_status, reviewed_at,
         reviewed_by, status, metadata, created_by, updated_by
       ) values (
         $1, $2, $3, $4::text, $5, 'bus_terminal', $6, $7, $8, 'America/Sao_Paulo', $9,
         '{}'::jsonb, $4::text, now(), 'verified', now(), $10,
         'active', $11::jsonb, $10, $10
       )
       on conflict (tenant_id, internal_code) do update set
         source_id = excluded.source_id,
         name = excluded.name,
         terminal_type = excluded.terminal_type,
         country_id = excluded.country_id,
         subdivision_id = excluded.subdivision_id,
         city_id = excluded.city_id,
         timezone = excluded.timezone,
         address_text = excluded.address_text,
         source_record_key = excluded.source_record_key,
         source_observed_at = excluded.source_observed_at,
         review_status = 'verified',
         reviewed_at = now(),
         reviewed_by = excluded.reviewed_by,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = bus_terminals.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where bus_terminals.metadata->>'fixture' = $12
       returning id`,
      [
        id,
        tenant.id,
        source.id,
        terminal.code,
        terminal.name,
        geo.country_id,
        geo.subdivision_id,
        geo.city_id,
        terminal.address,
        actor.user_id,
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: true,
          verifiedForLocalTestingOnly: true,
        }),
        FIXTURE_KEY,
      ],
    )
    if (!row.rows[0]?.id) throw new Error(`terminal sintetico nao pertence a fixture: ${terminal.code}`)
    result[terminal.code] = { id: row.rows[0].id, code: terminal.code, synthetic: true, verified: true }
  }
  return result
}

async function upsertBusRoutes(client, {
  tenant,
  actor,
  geography,
  sources,
  suppliers,
  terminals,
}) {
  const routes = [
    {
      code: 'TESTE-GOIANIA-RIO-V1',
      supplier: suppliers.busFixture,
      source: sources.fixture,
      origin: geography.goiania,
      destination: geography.rioDeJaneiro,
      originTerminalId: terminals['TEST-BUS-TERMINAL-GOIANIA'].id,
      destinationTerminalId: terminals['TEST-BUS-TERMINAL-RIO'].id,
      authorization: null,
      sourceRecordKey: 'synthetic-goiania-rio-v1',
      sourceUrl: null,
      synthetic: true,
    },
    {
      code: 'TESTE-RIO-GOIANIA-V1',
      supplier: suppliers.busFixture,
      source: sources.fixture,
      origin: geography.rioDeJaneiro,
      destination: geography.goiania,
      originTerminalId: terminals['TEST-BUS-TERMINAL-RIO'].id,
      destinationTerminalId: terminals['TEST-BUS-TERMINAL-GOIANIA'].id,
      authorization: null,
      sourceRecordKey: 'synthetic-rio-goiania-v1',
      sourceUrl: null,
      synthetic: true,
    },
    {
      code: 'PAPE0049095',
      supplier: suppliers.guanabara,
      source: sources.antt,
      origin: geography.belem,
      destination: geography.recife,
      originTerminalId: null,
      destinationTerminalId: null,
      authorization: 'TAR PAPE0049095',
      sourceRecordKey: 'decisao-supas-27-2026-pape0049095',
      sourceUrl: 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=9230&cod_modulo=623&numeroAto=00000027&orgao=SUPAS%2FANTT%2FMT&seqAto=000&tipo=DCS&valorAno=2026',
      synthetic: false,
    },
  ]

  const results = []
  for (const route of routes) {
    const id = stableUuid(`${FIXTURE_KEY}:bus-route:${route.code}`)
    await assertOwnedRow(client, {
      table: 'bus_routes',
      id,
      tenantId: tenant.id,
      fixtureExpression: "metadata->>'fixture'",
    })
    const row = await client.query(
      `insert into bus_routes (
         id, tenant_id, supplier_id, source_id, route_code,
         external_authorization_reference, service_kind,
         origin_city_id, destination_city_id,
         origin_terminal_id, destination_terminal_id,
         source_record_key, source_url, source_observed_at,
         review_status, reviewed_at, reviewed_by, status, metadata,
         created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, 'regular', $7, $8, $9, $10,
         $11, $12, $13::timestamptz, $14,
         case when $14 = 'verified' then now() else null end,
         case when $14 = 'verified' then $16::uuid else null end,
         'active', $15::jsonb, $16::uuid, $16::uuid
       )
       on conflict (tenant_id, supplier_id, route_code) do update set
         source_id = excluded.source_id,
         external_authorization_reference = excluded.external_authorization_reference,
         service_kind = excluded.service_kind,
         origin_city_id = excluded.origin_city_id,
         destination_city_id = excluded.destination_city_id,
         origin_terminal_id = excluded.origin_terminal_id,
         destination_terminal_id = excluded.destination_terminal_id,
         source_record_key = excluded.source_record_key,
         source_url = excluded.source_url,
         source_observed_at = excluded.source_observed_at,
         review_status = excluded.review_status,
         reviewed_at = excluded.reviewed_at,
         reviewed_by = excluded.reviewed_by,
         status = 'active',
         metadata = excluded.metadata,
         deleted_at = null,
         version = bus_routes.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where bus_routes.metadata->>'fixture' = $17
       returning id`,
      [
        id,
        tenant.id,
        route.supplier.id,
        route.source.id,
        route.code,
        route.authorization,
        route.origin.city_id,
        route.destination.city_id,
        route.originTerminalId,
        route.destinationTerminalId,
        route.sourceRecordKey,
        route.sourceUrl,
        route.source.observedAt,
        route.synthetic ? 'verified' : 'pending',
        JSON.stringify({
          fixture: FIXTURE_KEY,
          localOnly: true,
          synthetic: route.synthetic,
          referenceOnly: !route.synthetic,
          verifiedForLocalTestingOnly: route.synthetic,
          noFareData: true,
          noScheduleData: true,
        }),
        actor.user_id,
        FIXTURE_KEY,
      ],
    )
    if (!row.rows[0]?.id) throw new Error(`linha nao pertence a fixture: ${route.code}`)
    results.push({ id: row.rows[0].id, code: route.code, synthetic: route.synthetic })
  }
  return results
}

async function ensureGroundApprovalRouting(client, { tenant, actor }) {
  const template = await loadGroundApprovalTemplate(client, tenant.id)
  const results = []
  for (const route of GROUND_APPROVAL_ROUTES) {
    const workflowId = stableUuid(`${FIXTURE_KEY}:approval-workflow:${tenant.id}:${route.service}`)
    const workflowVersionId = stableUuid(`${FIXTURE_KEY}:approval-workflow-version:${tenant.id}:${route.service}:1`)
    const graph = buildGroundApprovalWorkflow({
      fixtureKey: `${FIXTURE_KEY}:${tenant.id}`,
      route,
      sourceGraph: template.graph,
      workflowId,
      workflowVersionId,
      stableId: stableUuid,
    })
    const workflowCreated = await ensureGroundApprovalWorkflow(client, {
      tenant,
      actor,
      route,
      workflowId,
      workflowVersionId,
      graph,
    })

    const policyId = stableUuid(`${FIXTURE_KEY}:approval-policy:${tenant.id}:${route.service}`)
    const policyVersionId = stableUuid(`${FIXTURE_KEY}:approval-policy-version:${tenant.id}:${route.service}:1`)
    const condition = groundSelectionCondition(route.service)
    const actions = groundSelectionApprovalActions(route)
    const policyCreated = await ensureGroundApprovalPolicy(client, {
      tenant,
      actor,
      route,
      template: template.policy,
      policyId,
      policyVersionId,
      condition,
      actions,
    })
    results.push({
      ...route,
      workflowId,
      workflowVersionId,
      graph,
      policyId,
      policyVersionId,
      condition,
      actions,
      created: { workflow: workflowCreated, policy: policyCreated },
    })
  }
  return results
}

async function loadGroundApprovalTemplate(client, tenantId) {
  const result = await client.query(
    `select policy_version.category, policy_version.priority, policy_version.severity,
            policy_version.inheritance_mode, policy_version.overridable,
            policy_version.timezone, policy_version.tags,
            workflow_version.graph_snapshot
       from policy_definitions policy
       join policy_versions policy_version
         on policy_version.tenant_id = policy.tenant_id
        and policy_version.policy_definition_id = policy.id
        and policy_version.version_number = policy.current_version
       join policy_publications publication
         on publication.tenant_id = policy.tenant_id
        and publication.policy_definition_id = policy.id
        and publication.policy_version_id = policy_version.id
        and publication.status = 'active'
        and publication.effective_from <= now()
        and (publication.effective_until is null or publication.effective_until > now())
       join approval_workflow_definitions workflow
         on workflow.tenant_id = policy.tenant_id
        and workflow.workflow_code = $3
       join approval_workflow_versions workflow_version
         on workflow_version.tenant_id = workflow.tenant_id
        and workflow_version.workflow_definition_id = workflow.id
        and workflow_version.version_number = workflow.current_version
      where policy.tenant_id = $1
        and policy.policy_code = $2
        and policy.status = 'published'
        and policy_version.status = 'published'
        and workflow.status = 'published'
        and workflow_version.status = 'published'`,
    [tenantId, GROUND_APPROVAL_TEMPLATE.policyCode, GROUND_APPROVAL_TEMPLATE.workflowCode],
  )
  if (result.rowCount !== 1) {
    throw new Error(
      `template publicado ${GROUND_APPROVAL_TEMPLATE.policyCode}/${GROUND_APPROVAL_TEMPLATE.workflowCode} ausente; execute db:seed:local-offline-approvals antes desta fixture`,
    )
  }
  const row = result.rows[0]
  return {
    graph: row.graph_snapshot,
    policy: {
      category: row.category,
      priority: Number(row.priority),
      severity: row.severity,
      inheritanceMode: row.inheritance_mode,
      overridable: row.overridable,
      timezone: row.timezone,
      tags: row.tags || [],
    },
  }
}

async function ensureGroundApprovalWorkflow(client, {
  tenant,
  actor,
  route,
  workflowId,
  workflowVersionId,
  graph,
}) {
  const existing = await client.query(
    `select definition.id, definition.description, definition.status,
            definition.current_version, version.id as version_id,
            version.status as version_status, version.graph_snapshot
       from approval_workflow_definitions definition
       left join approval_workflow_versions version
         on version.tenant_id = definition.tenant_id
        and version.workflow_definition_id = definition.id
        and version.version_number = definition.current_version
      where definition.tenant_id = $1 and definition.workflow_code = $2
      for update of definition`,
    [tenant.id, route.workflowCode],
  )
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.id !== workflowId
        || row.version_id !== workflowVersionId
        || !String(row.description || '').includes(FIXTURE_KEY)
        || row.status !== 'published'
        || Number(row.current_version) !== 1
        || row.version_status !== 'published'
        || canonicalJson(row.graph_snapshot) !== canonicalJson(graph)) {
      throw new Error(`colisao ou workflow publicado inconsistente: ${route.workflowCode}`)
    }
    await assertGroundWorkflowState(client, {
      tenantId: tenant.id,
      route,
      graph,
      workflowId,
      workflowVersionId,
    })
    return false
  }

  await client.query(
    `insert into approval_workflow_definitions (
       id, tenant_id, workflow_code, name, description, workflow_type,
       status, current_version, created_by
     ) values ($1, $2, $3, $4, $5, 'cost', 'draft', 1, $6)`,
    [
      workflowId,
      tenant.id,
      route.workflowCode,
      graph.name,
      `Workflow da fixture local ${FIXTURE_KEY}; clona a topologia publicada do hotel e resolve por alcada.`,
      actor.user_id,
    ],
  )
  await client.query(
    `insert into approval_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status,
       graph_snapshot, content_hash, change_summary, created_by
     ) values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, $6, $7)`,
    [
      workflowVersionId,
      tenant.id,
      workflowId,
      JSON.stringify(graph),
      graph.contentHash,
      `Fixture local deterministica de aprovacao para ${route.service}.`,
      actor.user_id,
    ],
  )
  await client.query(
    `insert into approval_workflow_scopes (
       id, tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, $3, 'company', $4, 'include', 100)`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-workflow-scope:${tenant.id}:${route.service}`),
      tenant.id,
      workflowVersionId,
      COMPANY.companyId,
    ],
  )
  for (const node of graph.nodes) {
    await client.query(
      `insert into approval_nodes (
         id, tenant_id, workflow_version_id, node_key, name, node_type,
         approval_kind, completion_mode, quorum, approver_resolution, configuration
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        node.id,
        tenant.id,
        workflowVersionId,
        node.key,
        node.name,
        node.type,
        node.approvalKind || null,
        node.completionMode || null,
        node.quorum || null,
        JSON.stringify(node.approverResolution || {}),
        JSON.stringify(node.configuration || {}),
      ],
    )
  }
  for (const edge of graph.edges) {
    await client.query(
      `insert into approval_edges (
         id, tenant_id, workflow_version_id, source_node_id, target_node_id,
         sequence, condition_ast, label
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        edge.id,
        tenant.id,
        workflowVersionId,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.sequence,
        edge.condition ? JSON.stringify(edge.condition) : null,
        edge.label ?? null,
      ],
    )
  }
  await client.query(
    `update approval_workflow_versions
        set status = 'published', approved_by = $3, approved_at = now(),
            published_by = $3, published_at = now()
      where tenant_id = $1 and id = $2`,
    [tenant.id, workflowVersionId, actor.user_id],
  )
  await client.query(
    `update approval_workflow_definitions
        set status = 'published', current_version = 1
      where tenant_id = $1 and id = $2`,
    [tenant.id, workflowId],
  )
  await assertGroundWorkflowState(client, {
    tenantId: tenant.id,
    route,
    graph,
    workflowId,
    workflowVersionId,
  })
  return true
}

async function ensureGroundApprovalPolicy(client, {
  tenant,
  actor,
  route,
  template,
  policyId,
  policyVersionId,
  condition,
  actions,
}) {
  const existing = await client.query(
    `select definition.id, definition.description, definition.status,
            definition.current_version, version.id as version_id,
            version.status as version_status, version.condition_ast,
            version.actions_ast, version.checkpoints
       from policy_definitions definition
       left join policy_versions version
         on version.tenant_id = definition.tenant_id
        and version.policy_definition_id = definition.id
        and version.version_number = definition.current_version
      where definition.tenant_id = $1 and definition.policy_code = $2
      for update of definition`,
    [tenant.id, route.policyCode],
  )
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.id !== policyId
        || row.version_id !== policyVersionId
        || !String(row.description || '').includes(FIXTURE_KEY)
        || row.status !== 'published'
        || Number(row.current_version) !== 1
        || row.version_status !== 'published'
        || canonicalJson(row.condition_ast) !== canonicalJson(condition)
        || canonicalJson(row.actions_ast) !== canonicalJson(actions)
        || canonicalJson(row.checkpoints) !== canonicalJson(['selection'])) {
      throw new Error(`colisao ou politica publicada inconsistente: ${route.policyCode}`)
    }
    await assertGroundPolicyState(client, {
      tenantId: tenant.id,
      route,
      policyId,
      policyVersionId,
      condition,
      actions,
    })
    return false
  }

  const name = `Aprovacao da escolha offline - ${route.label}`
  const description = `Politica da fixture local ${FIXTURE_KEY}, restrita a empresa e ao servico ${route.service}.`
  const businessJustification = `Garante autorizacao humana antes da reserva offline de ${route.label}.`
  const contentHash = sha256Canonical({ condition, actions, checkpoints: ['selection'], version: 1 })
  await client.query(
    `insert into policy_definitions (
       id, tenant_id, policy_code, name, description, category, status,
       priority, severity, inheritance_mode, overridable,
       business_justification, tags, current_version, created_by
     ) values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, $12::text[], 1, $13)`,
    [
      policyId,
      tenant.id,
      route.policyCode,
      name,
      description,
      template.category,
      template.priority,
      template.severity,
      template.inheritanceMode,
      template.overridable,
      businessJustification,
      template.tags,
      actor.user_id,
    ],
  )
  await client.query(
    `insert into policy_versions (
       id, tenant_id, policy_definition_id, version_number, status,
       name, description, category, priority, severity, inheritance_mode,
       overridable, condition_ast, actions_ast, exception_ast, timezone,
       tags, business_justification, content_hash, change_summary, created_by, checkpoints
     ) values (
       $1, $2, $3, 1, 'draft', $4, $5, $6, $7, $8, $9,
       $10, $11::jsonb, $12::jsonb, '[]'::jsonb, $13,
       $14::text[], $15, $16, $17, $18, array['selection']::text[]
     )`,
    [
      policyVersionId,
      tenant.id,
      policyId,
      name,
      description,
      template.category,
      template.priority,
      template.severity,
      template.inheritanceMode,
      template.overridable,
      JSON.stringify(condition),
      JSON.stringify(actions),
      template.timezone,
      template.tags,
      businessJustification,
      contentHash,
      `Fixture local deterministica para ${route.service}.`,
      actor.user_id,
    ],
  )
  await client.query(
    `insert into policy_scopes (
       id, tenant_id, policy_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, $3, 'company', $4, 'include', 100)`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-policy-scope:${tenant.id}:${route.service}`),
      tenant.id,
      policyVersionId,
      COMPANY.companyId,
    ],
  )
  const ruleSetId = stableUuid(`${FIXTURE_KEY}:approval-policy-rule-set:${tenant.id}:${route.service}`)
  await client.query(
    `insert into policy_rule_sets (
       id, tenant_id, policy_version_id, name, logical_operator, sequence, enabled
     ) values ($1, $2, $3, 'Selecao e servico terrestre', 'all', 0, true)`,
    [ruleSetId, tenant.id, policyVersionId],
  )
  await client.query(
    `insert into policy_conditions (
       id, tenant_id, rule_set_id, sequence, condition_ast
     ) values ($1, $2, $3, 0, $4::jsonb)`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-policy-condition:${tenant.id}:${route.service}`),
      tenant.id,
      ruleSetId,
      JSON.stringify(condition),
    ],
  )
  await client.query(
    `insert into policy_actions (
       id, tenant_id, policy_version_id, action_type, sequence, configuration, idempotency_scope
     ) values ($1, $2, $3, 'request_approval', 0, $4::jsonb, 'offline-ground-selection')`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-policy-action:${tenant.id}:${route.service}`),
      tenant.id,
      policyVersionId,
      JSON.stringify({ message: actions[0].message, ...actions[0].configuration }),
    ],
  )
  await client.query(
    `insert into policy_dependencies (
       id, tenant_id, policy_version_id, dependency_type, dependency_key, required, configuration
     ) values ($1, $2, $3, 'workflow', $4, true, '{}'::jsonb)`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-policy-dependency:${tenant.id}:${route.service}`),
      tenant.id,
      policyVersionId,
      route.workflowCode,
    ],
  )
  await client.query(
    `update policy_versions
        set status = 'published', approved_by = $3, approved_at = now(),
            published_by = $3, published_at = now()
      where tenant_id = $1 and id = $2`,
    [tenant.id, policyVersionId, actor.user_id],
  )
  await client.query(
    `update policy_definitions
        set status = 'published', current_version = 1
      where tenant_id = $1 and id = $2`,
    [tenant.id, policyId],
  )
  await client.query(
    `insert into policy_publications (
       id, tenant_id, policy_definition_id, policy_version_id, status,
       effective_from, published_by, approved_by, publication_reason
     ) values ($1, $2, $3, $4, 'active', $5::timestamptz, $6, $6, $7)`,
    [
      stableUuid(`${FIXTURE_KEY}:approval-policy-publication:${tenant.id}:${route.service}:1`),
      tenant.id,
      policyId,
      policyVersionId,
      APPROVAL_FIXTURE_EFFECTIVE_FROM,
      actor.user_id,
      `Publicacao local deterministica da fixture ${FIXTURE_KEY}.`,
    ],
  )
  await assertGroundPolicyState(client, {
    tenantId: tenant.id,
    route,
    policyId,
    policyVersionId,
    condition,
    actions,
  })
  return true
}

async function assertGroundWorkflowState(client, {
  tenantId,
  route,
  graph,
  workflowId,
  workflowVersionId,
}) {
  assertSafeGroundApprovalWorkflow(graph)
  const state = await client.query(
    `select definition.id, definition.status, definition.current_version,
            version.id as version_id, version.status as version_status,
            version.graph_snapshot, version.content_hash,
            (select count(*)::integer from approval_workflow_scopes scope
              where scope.tenant_id = version.tenant_id
                and scope.workflow_version_id = version.id
                and scope.scope_type = 'company' and scope.scope_id = $3
                and scope.mode = 'include' and scope.specificity = 100
                and scope.id = $4) as company_scopes,
            (select count(*)::integer from approval_workflow_scopes scope
              where scope.tenant_id = version.tenant_id
                and scope.workflow_version_id = version.id) as total_scopes,
            (select count(*)::integer from approval_nodes node
              where node.tenant_id = version.tenant_id
                and node.workflow_version_id = version.id) as nodes,
            (select count(*)::integer from approval_edges edge
              where edge.tenant_id = version.tenant_id
                and edge.workflow_version_id = version.id) as edges,
            (select count(*)::integer from approval_rules rule
              where rule.tenant_id = version.tenant_id
                and rule.workflow_version_id = version.id) as rules,
            (select count(*)::integer from approval_slas sla
              where sla.tenant_id = version.tenant_id
                and sla.workflow_version_id = version.id) as slas
       from approval_workflow_definitions definition
       join approval_workflow_versions version
         on version.tenant_id = definition.tenant_id
        and version.workflow_definition_id = definition.id
        and version.version_number = definition.current_version
      where definition.tenant_id = $1 and definition.workflow_code = $2`,
    [
      tenantId,
      route.workflowCode,
      COMPANY.companyId,
      stableUuid(`${FIXTURE_KEY}:approval-workflow-scope:${tenantId}:${route.service}`),
    ],
  )
  const row = state.rows[0]
  if (!row
      || row.id !== workflowId
      || row.version_id !== workflowVersionId
      || row.status !== 'published'
      || row.version_status !== 'published'
      || Number(row.current_version) !== 1
      || canonicalJson(row.graph_snapshot) !== canonicalJson(graph)
      || String(row.content_hash).trim() !== graph.contentHash
      || Number(row.company_scopes) !== 1
      || Number(row.total_scopes) !== 1
      || Number(row.nodes) !== graph.nodes.length
      || Number(row.edges) !== graph.edges.length
      || Number(row.rules) !== 0
      || Number(row.slas) !== 0) {
    throw new Error(`pos-condicao invalida para workflow ${route.workflowCode}`)
  }
  const relational = await loadRelationalGroundWorkflow(client, tenantId, workflowVersionId)
  const expectedNodes = [...graph.nodes].sort((left, right) => left.key.localeCompare(right.key))
  const expectedEdges = [...graph.edges].sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(relational.nodes) !== canonicalJson(expectedNodes)
      || canonicalJson(relational.edges) !== canonicalJson(expectedEdges)) {
    throw new Error(`snapshot e filhos relacionais divergem no workflow ${route.workflowCode}`)
  }
}

async function loadRelationalGroundWorkflow(client, tenantId, workflowVersionId) {
  const nodes = await client.query(
    `select id, node_key as key, name, node_type as type,
            approval_kind as "approvalKind", completion_mode as "completionMode",
            quorum, approver_resolution as "approverResolution", configuration
       from approval_nodes
      where tenant_id = $1 and workflow_version_id = $2
      order by node_key`,
    [tenantId, workflowVersionId],
  )
  const edges = await client.query(
    `select id, source_node_id as "sourceNodeId", target_node_id as "targetNodeId",
            sequence, condition_ast as condition, label
       from approval_edges
      where tenant_id = $1 and workflow_version_id = $2
      order by id`,
    [tenantId, workflowVersionId],
  )
  const normalize = (value) => Object.fromEntries(Object.entries(value).filter(([key, child]) => (
    child !== null && !(key === 'approverResolution' && canonicalJson(child) === canonicalJson({}))
  )))
  return {
    nodes: nodes.rows.map(normalize).sort((left, right) => left.key.localeCompare(right.key)),
    edges: edges.rows.map(normalize).sort((left, right) => left.id.localeCompare(right.id)),
  }
}

async function assertGroundPolicyState(client, {
  tenantId,
  route,
  policyId,
  policyVersionId,
  condition,
  actions,
}) {
  const expectedIds = {
    scope: stableUuid(`${FIXTURE_KEY}:approval-policy-scope:${tenantId}:${route.service}`),
    ruleSet: stableUuid(`${FIXTURE_KEY}:approval-policy-rule-set:${tenantId}:${route.service}`),
    condition: stableUuid(`${FIXTURE_KEY}:approval-policy-condition:${tenantId}:${route.service}`),
    action: stableUuid(`${FIXTURE_KEY}:approval-policy-action:${tenantId}:${route.service}`),
    dependency: stableUuid(`${FIXTURE_KEY}:approval-policy-dependency:${tenantId}:${route.service}`),
    publication: stableUuid(`${FIXTURE_KEY}:approval-policy-publication:${tenantId}:${route.service}:1`),
  }
  const expectedContentHash = sha256Canonical({ condition, actions, checkpoints: ['selection'], version: 1 })
  const state = await client.query(
    `select definition.id, definition.status, definition.current_version,
            version.id as version_id, version.status as version_status,
            version.condition_ast, version.actions_ast, version.checkpoints,
            version.content_hash,
            (select count(*)::integer from policy_scopes scope
              where scope.tenant_id = version.tenant_id
                and scope.policy_version_id = version.id
                and scope.scope_type = 'company' and scope.scope_id = $3
                and scope.mode = 'include' and scope.specificity = 100
                and scope.id = $7) as company_scopes,
            (select count(*)::integer from policy_scopes scope
              where scope.tenant_id = version.tenant_id
                and scope.policy_version_id = version.id) as total_scopes,
            (select count(*)::integer from policy_rule_sets rule_set
              where rule_set.tenant_id = version.tenant_id
                and rule_set.policy_version_id = version.id
                and rule_set.logical_operator = 'all' and rule_set.enabled
                and rule_set.id = $8) as rule_sets,
            (select count(*)::integer from policy_rule_sets rule_set
              where rule_set.tenant_id = version.tenant_id
                and rule_set.policy_version_id = version.id) as total_rule_sets,
            (select count(*)::integer from policy_conditions condition_row
              join policy_rule_sets rule_set
                on rule_set.tenant_id = condition_row.tenant_id
               and rule_set.id = condition_row.rule_set_id
              where rule_set.tenant_id = version.tenant_id
                and rule_set.policy_version_id = version.id
                and condition_row.condition_ast = $5::jsonb
                and condition_row.id = $9) as exact_conditions,
            (select count(*)::integer from policy_conditions condition_row
              join policy_rule_sets rule_set
                on rule_set.tenant_id = condition_row.tenant_id
               and rule_set.id = condition_row.rule_set_id
              where rule_set.tenant_id = version.tenant_id
                and rule_set.policy_version_id = version.id) as total_conditions,
            (select count(*)::integer from policy_actions action
              where action.tenant_id = version.tenant_id
                and action.policy_version_id = version.id
                and action.action_type = 'request_approval'
                and action.configuration->>'workflow' = $4
                and action.configuration->>'message' = $6
                and action.idempotency_scope = 'offline-ground-selection'
                and action.id = $10) as approval_actions,
            (select count(*)::integer from policy_actions action
              where action.tenant_id = version.tenant_id
                and action.policy_version_id = version.id) as total_actions,
            (select count(*)::integer from policy_actions action
              where action.tenant_id = version.tenant_id
                and action.policy_version_id = version.id
                and action.action_type = 'auto_approve') as auto_approve_actions,
            (select count(*)::integer from policy_dependencies dependency
              where dependency.tenant_id = version.tenant_id
                and dependency.policy_version_id = version.id
                and dependency.dependency_type = 'workflow'
                and dependency.dependency_key = $4 and dependency.required
                and dependency.minimum_version is null
                and dependency.configuration = '{}'::jsonb
                and dependency.id = $11) as workflow_dependencies,
            (select count(*)::integer from policy_dependencies dependency
              where dependency.tenant_id = version.tenant_id
                and dependency.policy_version_id = version.id) as total_dependencies,
            (select count(*)::integer from policy_exceptions exception_row
              where exception_row.tenant_id = version.tenant_id
                and exception_row.policy_version_id = version.id) as exceptions,
            (select count(*)::integer from policy_publications publication
              where publication.tenant_id = definition.tenant_id
                and publication.policy_definition_id = definition.id
                and publication.policy_version_id = version.id
                and publication.status = 'active'
                and publication.effective_from = $13::timestamptz
                and publication.effective_until is null
                and publication.id = $12) as active_publications
       from policy_definitions definition
       join policy_versions version
         on version.tenant_id = definition.tenant_id
        and version.policy_definition_id = definition.id
        and version.version_number = definition.current_version
      where definition.tenant_id = $1 and definition.policy_code = $2`,
    [
      tenantId,
      route.policyCode,
      COMPANY.companyId,
      route.workflowCode,
      JSON.stringify(condition),
      actions[0].message,
      expectedIds.scope,
      expectedIds.ruleSet,
      expectedIds.condition,
      expectedIds.action,
      expectedIds.dependency,
      expectedIds.publication,
      APPROVAL_FIXTURE_EFFECTIVE_FROM,
    ],
  )
  const row = state.rows[0]
  if (!row
      || row.id !== policyId
      || row.version_id !== policyVersionId
      || row.status !== 'published'
      || row.version_status !== 'published'
      || Number(row.current_version) !== 1
      || canonicalJson(row.condition_ast) !== canonicalJson(condition)
      || canonicalJson(row.actions_ast) !== canonicalJson(actions)
      || canonicalJson(row.checkpoints) !== canonicalJson(['selection'])
      || String(row.content_hash).trim() !== expectedContentHash
      || Number(row.company_scopes) !== 1
      || Number(row.total_scopes) !== 1
      || Number(row.rule_sets) !== 1
      || Number(row.total_rule_sets) !== 1
      || Number(row.exact_conditions) !== 1
      || Number(row.total_conditions) !== 1
      || Number(row.approval_actions) !== 1
      || Number(row.total_actions) !== 1
      || Number(row.auto_approve_actions) !== 0
      || Number(row.workflow_dependencies) !== 1
      || Number(row.total_dependencies) !== 1
      || Number(row.exceptions) !== 0
      || Number(row.active_publications) !== 1) {
    throw new Error(`pos-condicao invalida para politica ${route.policyCode}`)
  }
}

async function ensureGroundApprovalAuthorities(client, { tenant, actor, approver }) {
  const revoked = await revokeStaleGroundApprovalAuthorities(client, { tenant, actor, approver })
  if (!approver.granted) {
    return {
      created: 0,
      existing: 0,
      revoked,
      items: [],
      reason: 'aprovador da fixture nao configurado',
    }
  }
  const results = []
  for (const route of GROUND_APPROVAL_ROUTES) {
    const authorityId = stableUuid(
      `${FIXTURE_KEY}:approval-authority:${tenant.id}:${approver.membershipId}:${route.service}`,
    )
    const expected = {
      id: authorityId,
      tenantId: tenant.id,
      membershipId: approver.membershipId,
      service: route.service,
    }
    const byId = await client.query(
      `select * from approval_authorities where tenant_id = $1 and id = $2 for update`,
      [tenant.id, authorityId],
    )
    if (byId.rowCount) {
      if (byId.rows[0].status === 'revoked'
          && String(byId.rows[0].revocation_reason || '').startsWith(`${FIXTURE_KEY}:stale:`)) {
        await client.query(
          `update approval_authorities
              set status = 'active', valid_from = $3::timestamptz, valid_until = null,
                  revoked_by_membership_id = null, revoked_at = null, revocation_reason = null,
                  updated_at = now()
            where tenant_id = $1 and id = $2`,
          [tenant.id, authorityId, APPROVAL_FIXTURE_EFFECTIVE_FROM],
        )
        const reactivated = await client.query(
          `select * from approval_authorities where tenant_id = $1 and id = $2`,
          [tenant.id, authorityId],
        )
        assertGroundAuthorityRow(reactivated.rows[0], expected)
        results.push({ service: route.service, id: authorityId, created: false, reactivated: true })
        continue
      }
      assertGroundAuthorityRow(byId.rows[0], expected)
      results.push({ service: route.service, id: authorityId, created: false })
      continue
    }
    const collision = await client.query(
      `select id from approval_authorities
        where tenant_id = $1 and membership_id = $2 and approval_kind = 'cost'
          and company_id = $3 and group_id is null and cost_center_id is null and project_id is null
          and currency = 'BRL' and max_amount is null
          and accumulated_amount_limit is null and accumulation_period_days is null
          and max_percentage_above_lowest is null and max_percentage_above_average is null
          and requires_budget_available = false and urgent_allowed = false
          and products = $4::text[] and destinations = '{}'::text[] and risk_levels = '{}'::text[]
          and status in ('active', 'scheduled')
        for update`,
      [tenant.id, approver.membershipId, COMPANY.companyId, [route.service]],
    )
    if (collision.rowCount) {
      throw new Error(`colisao com alcada nao pertencente a fixture: ${route.service}`)
    }
    await client.query(
      `insert into approval_authorities (
         id, tenant_id, membership_id, approval_kind, company_id,
         max_amount, currency, products, destinations, risk_levels, conditions,
         status, valid_from, justification, created_by_membership_id,
         requires_budget_available, urgent_allowed
       ) values (
         $1, $2, $3, 'cost', $4,
         null, 'BRL', $5::text[], '{}'::text[], '{}'::text[], $6::jsonb,
         'active', $7::timestamptz, $8, $9, false, false
       )`,
      [
        authorityId,
        tenant.id,
        approver.membershipId,
        COMPANY.companyId,
        [route.service],
        JSON.stringify({ fixture: FIXTURE_KEY, localOnly: true, service: route.service }),
        APPROVAL_FIXTURE_EFFECTIVE_FROM,
        `Alcada local exclusiva da fixture ${FIXTURE_KEY} para ${route.service}.`,
        actor.membership_id,
      ],
    )
    const inserted = await client.query(
      `select * from approval_authorities where tenant_id = $1 and id = $2`,
      [tenant.id, authorityId],
    )
    assertGroundAuthorityRow(inserted.rows[0], expected)
    results.push({ service: route.service, id: authorityId, created: true })
  }
  return {
    created: results.filter((item) => item.created).length,
    existing: results.filter((item) => !item.created).length,
    revoked,
    items: results,
  }
}

async function revokeStaleGroundApprovalAuthorities(client, { tenant, actor, approver }) {
  const expectedIds = new Set(approver.granted
    ? GROUND_APPROVAL_ROUTES.map((route) => stableUuid(
        `${FIXTURE_KEY}:approval-authority:${tenant.id}:${approver.membershipId}:${route.service}`,
      ))
    : [])
  const current = await client.query(
    `select id, membership_id, products
       from approval_authorities
      where tenant_id = $1 and company_id = $2 and approval_kind = 'cost'
        and conditions->>'fixture' = $3
        and status in ('active', 'scheduled')
      for update`,
    [tenant.id, COMPANY.companyId, FIXTURE_KEY],
  )
  let revoked = 0
  for (const row of current.rows) {
    if (expectedIds.has(row.id)) continue
    const service = Array.isArray(row.products) && row.products.length === 1
      ? String(row.products[0])
      : 'unknown'
    await client.query(
      `update approval_authorities
          set status = 'revoked', revoked_by_membership_id = $3,
              revoked_at = now(), revocation_reason = $4, updated_at = now()
        where tenant_id = $1 and id = $2 and status in ('active', 'scheduled')`,
      [
        tenant.id,
        row.id,
        actor.membership_id,
        `${FIXTURE_KEY}:stale:${service}:${row.membership_id}`,
      ],
    )
    revoked += 1
  }
  return revoked
}

function assertGroundAuthorityRow(row, expected) {
  if (!row
      || row.id !== expected.id
      || row.tenant_id !== expected.tenantId
      || row.membership_id !== expected.membershipId
      || row.approval_kind !== 'cost'
      || row.company_id !== COMPANY.companyId
      || row.group_id !== null
      || row.cost_center_id !== null
      || row.project_id !== null
      || row.max_amount !== null
      || row.accumulated_amount_limit !== null
      || row.accumulation_period_days !== null
      || row.max_percentage_above_lowest !== null
      || row.max_percentage_above_average !== null
      || String(row.currency).trim() !== 'BRL'
      || canonicalJson(row.products) !== canonicalJson([expected.service])
      || canonicalJson(row.destinations) !== canonicalJson([])
      || canonicalJson(row.risk_levels) !== canonicalJson([])
      || row.conditions?.fixture !== FIXTURE_KEY
      || row.conditions?.localOnly !== true
      || row.conditions?.service !== expected.service
      || row.status !== 'active'
      || asIsoDateTime(row.valid_from) !== APPROVAL_FIXTURE_EFFECTIVE_FROM
      || row.valid_until !== null
      || row.requires_budget_available !== false
      || row.urgent_allowed !== false
      || row.revoked_by_membership_id !== null
      || row.revoked_at !== null
      || row.revocation_reason !== null
      || !String(row.justification || '').includes(FIXTURE_KEY)) {
    throw new Error(`alcada da fixture inconsistente: ${expected.service}`)
  }
}

async function validateGroundApprovalFixture(client, { tenant, approver, approvalRouting }) {
  for (const item of approvalRouting) {
    await assertGroundWorkflowState(client, {
      tenantId: tenant.id,
      route: item,
      graph: item.graph,
      workflowId: item.workflowId,
      workflowVersionId: item.workflowVersionId,
    })
    await assertGroundPolicyState(client, {
      tenantId: tenant.id,
      route: item,
      policyId: item.policyId,
      policyVersionId: item.policyVersionId,
      condition: item.condition,
      actions: item.actions,
    })
  }
  let authorityCount = 0
  if (approver.granted) {
    for (const route of GROUND_APPROVAL_ROUTES) {
      const authorityId = stableUuid(
        `${FIXTURE_KEY}:approval-authority:${tenant.id}:${approver.membershipId}:${route.service}`,
      )
      const authority = await client.query(
        `select * from approval_authorities where tenant_id = $1 and id = $2`,
        [tenant.id, authorityId],
      )
      assertGroundAuthorityRow(authority.rows[0], {
        id: authorityId,
        tenantId: tenant.id,
        membershipId: approver.membershipId,
        service: route.service,
      })
      authorityCount += 1
    }
  }
  const activeFixtureAuthorities = await client.query(
    `select count(*)::integer as total
       from approval_authorities
      where tenant_id = $1 and company_id = $2 and approval_kind = 'cost'
        and conditions->>'fixture' = $3
        and status in ('active', 'scheduled')`,
    [tenant.id, COMPANY.companyId, FIXTURE_KEY],
  )
  if (Number(activeFixtureAuthorities.rows[0]?.total || 0) !== authorityCount) {
    throw new Error('pos-condicao invalida: existem alcadas terrestres ativas fora do aprovador configurado')
  }
  return {
    policies: approvalRouting.length,
    workflows: approvalRouting.length,
    authorities: authorityCount,
    companyScoped: true,
    automaticApproval: false,
  }
}

function asIsoDateTime(value) {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function maybeGrantFixtureCompanyAccess(client, { tenant, actor }) {
  const requesterEmail = String(
    process.env.COMPANY_PORTAL_FIXTURE_REQUESTER_EMAIL
      || process.env.COMPANY_PORTAL_FIXTURE_ACCESS_EMAIL
      || '',
  ).trim().toLowerCase()
  const approverEmail = String(process.env.COMPANY_PORTAL_FIXTURE_APPROVER_EMAIL || '').trim().toLowerCase()
  if (requesterEmail && approverEmail && requesterEmail === approverEmail) {
    throw new Error('solicitante e aprovador da fixture precisam ser usuarios diferentes')
  }
  const requester = requesterEmail
    ? await grantFixtureUser(client, {
      tenant,
      actor,
      email: requesterEmail,
      profile: 'requester',
      requiredRole: 'requester',
      grantIdentity: 'requester',
      permissionOverrides: {
        ver_empresas: true,
        ver_funcionarios: true,
        ver_solicitantes: true,
        criar_demandas: true,
        ver_demandas: true,
        ver_reservas: true,
        ver_emissoes: true,
        ver_vouchers: true,
        ver_aprovacoes: true,
      },
    })
    : { granted: false, reason: 'COMPANY_PORTAL_FIXTURE_REQUESTER_EMAIL nao informado' }
  if (requester.granted) {
    const linked = await client.query(
      `update requesters
          set user_id = $1, updated_at = now()
        where tenant_id = $2 and id = $3
          and permissions->>'fixture' = $4
        returning id`,
      [requester.userId, tenant.id, COMPANY.requesterId, FIXTURE_KEY],
    )
    if (linked.rowCount !== 1) throw new Error('nao foi possivel vincular o solicitante da fixture')
  }
  const approver = approverEmail
    ? await grantFixtureUser(client, {
      tenant,
      actor,
      email: approverEmail,
      profile: 'viewer',
      forbiddenRole: 'requester',
      requireDecisionPermission: true,
      // Mantem o UUID da versao anterior da fixture para migrar apenas a linha que ela possui.
      grantIdentity: 'company_admin',
      permissionOverrides: APPROVER_PERMISSION_OVERRIDES,
    })
    : { granted: false, reason: 'COMPANY_PORTAL_FIXTURE_APPROVER_EMAIL nao informado' }
  return { requester, approver }
}

async function grantFixtureUser(client, {
  tenant,
  actor,
  email,
  profile,
  requiredRole,
  forbiddenRole,
  requireDecisionPermission = false,
  grantIdentity,
  permissionOverrides,
}) {
  const membership = await client.query(
    `select membership.id, membership.user_id, user_row.email::text, role_row.role_key,
            user_row.platform_admin,
            case
              when membership.custom_permissions ? 'decidir_aprovacoes'
                then (membership.custom_permissions->>'decidir_aprovacoes')::boolean
              else coalesce((
                select role_permission.allowed
                  from role_permissions role_permission
                 where role_permission.role_id = role_row.id
                   and role_permission.permission_key = 'decidir_aprovacoes'
              ), false)
            end as can_decide_approvals
       from tenant_memberships membership
       join users user_row on user_row.id = membership.user_id
       join roles role_row on role_row.id = membership.role_id
      where membership.tenant_id = $1
        and membership.status = 'active'
        and user_row.status = 'active'
        and user_row.deleted_at is null
        and lower(user_row.email::text) = $2`,
    [tenant.id, email],
  )
  if (membership.rowCount !== 1) {
    throw new Error(`usuario para acesso da fixture nao encontrado de forma univoca: ${email}`)
  }
  const member = membership.rows[0]
  if (member.platform_admin) {
    throw new Error(`usuario da fixture nao pode ser administrador da plataforma: ${email}`)
  }
  if (requiredRole && member.role_key !== requiredRole) {
    throw new Error(`solicitante da fixture precisa ter role_key=${requiredRole}: ${email}`)
  }
  if (forbiddenRole && member.role_key === forbiddenRole) {
    throw new Error(`aprovador da fixture nao pode ter role_key=${forbiddenRole}: ${email}`)
  }
  if (requireDecisionPermission && member.can_decide_approvals !== true) {
    throw new Error(`aprovador da fixture precisa da permissao-base decidir_aprovacoes: ${email}`)
  }
  const grantId = stableUuid(`${FIXTURE_KEY}:company-access:${member.id}:${grantIdentity}`)
  const owned = await client.query(
    `select id, membership_id, company_id, status from corporate_company_access_grants
      where tenant_id = $1
        and (id = $2 or (membership_id = $3 and company_id = $4 and status <> 'revoked'))
      for update`,
    [tenant.id, grantId, member.id, COMPANY.companyId],
  )
  if (owned.rows.some((row) => row.id !== grantId)) {
    throw new Error(`colisao com acesso corporativo nao pertencente a fixture: ${email}`)
  }
  if (owned.rows.some((row) => row.id === grantId
      && (row.membership_id !== member.id || row.company_id !== COMPANY.companyId))) {
    throw new Error(`id de acesso corporativo da fixture pertence a outro escopo: ${email}`)
  }
  if (owned.rows.some((row) => row.id === grantId && row.status === 'revoked')) {
    throw new Error(`acesso corporativo da fixture foi revogado explicitamente: ${email}`)
  }
  const granted = await client.query(
    `insert into corporate_company_access_grants (
       id, tenant_id, membership_id, company_id, corporate_profile,
       permission_overrides, status, valid_from, created_by_membership_id
     ) values (
       $1, $2, $3, $4, $5,
       $6::jsonb, 'active', now(), $7
     )
     on conflict (tenant_id, membership_id, company_id) where status <> 'revoked'
     do update set
       corporate_profile = excluded.corporate_profile,
       permission_overrides = excluded.permission_overrides,
       status = 'active',
       valid_until = null,
       updated_at = now()
     where corporate_company_access_grants.id = excluded.id
     returning id`,
    [
      grantId,
      tenant.id,
      member.id,
      COMPANY.companyId,
      profile,
      JSON.stringify(permissionOverrides),
      actor.membership_id,
    ],
  )
  if (granted.rowCount !== 1 || granted.rows[0].id !== grantId) {
    throw new Error(`nao foi possivel garantir acesso corporativo da fixture: ${email}`)
  }
  return {
    granted: true,
    email,
    userId: member.user_id,
    membershipId: member.id,
    roleKey: member.role_key,
    profile,
    companyId: COMPANY.companyId,
  }
}

async function validateFixture(client, tenantId) {
  const expectedHotelMediaIds = HOTELS
    .filter((hotel) => hotel.photo)
    .map((hotel) => hotelFixtureMediaId(hotel))
  const result = await client.query(
    `select
       (select count(*)::integer from companies
         where tenant_id = $1 and id = $2 and metadata->>'fixture' = $3
           and status = 'active' and deleted_at is null) as companies,
       (select count(*)::integer from hotels
         where tenant_id = $1 and source = 'local_fixture'
           and id = any($4::text[]) and status = 'active' and deleted_at is null) as hotels,
       (select count(*)::integer from rental_locations
         where tenant_id = $1 and metadata->>'fixture' = $3
           and status = 'active' and deleted_at is null) as rental_locations,
       (select count(*)::integer from rental_locations
         where tenant_id = $1 and metadata->>'fixture' = $3
           and metadata->>'verifiedForLocalTestingOnly' = 'true'
           and review_status = 'verified' and status = 'active' and deleted_at is null)
         as verified_rental_locations,
       (select count(*)::integer from bus_terminals
         where tenant_id = $1 and metadata->>'fixture' = $3
           and status = 'active' and deleted_at is null) as bus_terminals,
       (select count(*)::integer from bus_terminals
         where tenant_id = $1 and metadata->>'fixture' = $3
           and metadata->>'verifiedForLocalTestingOnly' = 'true'
           and review_status = 'verified' and status = 'active' and deleted_at is null)
         as verified_bus_terminals,
       (select count(*)::integer from bus_routes
         where tenant_id = $1 and metadata->>'fixture' = $3
           and status = 'active' and deleted_at is null) as bus_routes,
       (select count(*)::integer from bus_routes
         where tenant_id = $1 and metadata->>'fixture' = $3
           and metadata->>'verifiedForLocalTestingOnly' = 'true'
           and review_status = 'verified' and status = 'active' and deleted_at is null)
         as verified_bus_routes,
       (select count(*)::integer from commercial_suppliers
         where tenant_id = $1 and metadata->>'fixture' = $3
           and status = 'active' and deleted_at is null) as suppliers,
       (select count(*)::integer from hotel_supplier_rates
         where tenant_id = $1 and metadata->>'fixture' = $3
           and is_active and not is_suspended) as hotel_rates,
       (select count(*)::integer
          from hotel_catalog_media media
          join stored_files file
            on file.tenant_id = media.tenant_id and file.id = media.file_id
         where media.tenant_id = $1
           and media.id = any($5::uuid[])
           and media.hotel_id = any($4::text[])
           and media.room_type_id is null
           and media.deleted_at is null
           and file.status = 'active'
           and file.purpose = 'hotel_catalog_media'
           and file.entity_type = 'hotel'
           and file.entity_id = media.hotel_id
           and file.mime_type = 'image/webp'
           and file.size_bytes between 1 and 5242880) as hotel_media`,
    [
      tenantId,
      COMPANY.companyId,
      FIXTURE_KEY,
      HOTELS.map((hotel) => hotel.id),
      expectedHotelMediaIds,
    ],
  )
  const counts = result.rows[0]
  const expected = {
    companies: 1,
    hotels: HOTELS.length,
    rental_locations: MOVIDA_LOCATIONS.length + TEST_RENTAL_LOCATIONS.length,
    verified_rental_locations: TEST_RENTAL_LOCATIONS.length,
    bus_terminals: BUS_TERMINALS.length + TEST_BUS_TERMINALS.length,
    verified_bus_terminals: TEST_BUS_TERMINALS.length,
    bus_routes: 3,
    verified_bus_routes: 2,
    suppliers: Object.keys(SUPPLIERS).length,
    hotel_rates: HOTELS.length * ROOM_TYPES.length,
    hotel_media: expectedHotelMediaIds.length,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (Number(counts[key]) !== value) {
      throw new Error(`fixture local invalida: ${key}=${counts[key]} (esperado ${value})`)
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]))
}

async function assertOwnedRow(client, {
  table,
  id,
  tenantId,
  fixtureExpression,
}) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('tabela de fixture invalida')
  const result = await client.query(
    `select tenant_id, ${fixtureExpression} as fixture from ${table} where id = $1 for update`,
    [id],
  )
  if (result.rows[0]
      && (result.rows[0].tenant_id !== tenantId || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error(`colisao com registro que nao pertence a fixture: ${table}/${id}`)
  }
}

async function assertOwnedRoom(client, { roomId, tenantId, hotelId }) {
  const result = await client.query(
    `select tenant_id, hotel_id, amenities->>'fixture' as fixture
       from hotel_room_types where id = $1 for update`,
    [roomId],
  )
  if (result.rows[0]
      && (result.rows[0].tenant_id !== tenantId
        || result.rows[0].hotel_id !== hotelId
        || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error(`colisao com quarto que nao pertence a fixture: ${roomId}`)
  }
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function stableUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

const directInvocationPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (directInvocationPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
