/**
 * BR city geo lookup — V16
 *
 * Lat/lng (WGS84) das principais cidades brasileiras + capitais para
 * desenhar o mapa do dashboard executivo. Usado pelo OperationalMap.
 *
 * Não usa API externa: tudo offline, zero latência.
 */
export interface CityGeo {
  nome: string
  lat: number
  lng: number
  uf: string
}

export const CIDADES_BR_GEO: Record<string, CityGeo> = {
  goiania:        { nome: 'Goiânia', lat: -16.6864, lng: -49.2643, uf: 'GO' },
  trindade:       { nome: 'Trindade', lat: -16.6492, lng: -49.4923, uf: 'GO' },
  anapolis:       { nome: 'Anápolis', lat: -16.3267, lng: -48.9528, uf: 'GO' },
  brasilia:       { nome: 'Brasília', lat: -15.7942, lng: -47.8822, uf: 'DF' },

  'sao paulo':       { nome: 'São Paulo', lat: -23.5505, lng: -46.6333, uf: 'SP' },
  campinas:          { nome: 'Campinas', lat: -22.9099, lng: -47.0626, uf: 'SP' },
  santos:            { nome: 'Santos', lat: -23.9608, lng: -46.3331, uf: 'SP' },
  'sao jose dos campos': { nome: 'São José dos Campos', lat: -23.2237, lng: -45.9009, uf: 'SP' },
  ribeirao_preto:    { nome: 'Ribeirão Preto', lat: -21.1775, lng: -47.8103, uf: 'SP' },

  'rio de janeiro':  { nome: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729, uf: 'RJ' },
  niteroi:           { nome: 'Niterói', lat: -22.8833, lng: -43.1036, uf: 'RJ' },
  petropolis:        { nome: 'Petrópolis', lat: -22.5050, lng: -43.1786, uf: 'RJ' },

  'belo horizonte':  { nome: 'Belo Horizonte', lat: -19.9167, lng: -43.9345, uf: 'MG' },
  uberlandia:        { nome: 'Uberlândia', lat: -18.9186, lng: -48.2772, uf: 'MG' },
  contagem:          { nome: 'Contagem', lat: -19.9320, lng: -44.0537, uf: 'MG' },
  juiz_de_fora:      { nome: 'Juiz de Fora', lat: -21.7642, lng: -43.3503, uf: 'MG' },
  betim:             { nome: 'Betim', lat: -19.9678, lng: -44.1981, uf: 'MG' },

  vitoria:           { nome: 'Vitória', lat: -20.3155, lng: -40.3128, uf: 'ES' },

  salvador:          { nome: 'Salvador', lat: -12.9747, lng: -38.4767, uf: 'BA' },
  feira_de_santana:  { nome: 'Feira de Santana', lat: -12.2667, lng: -38.9667, uf: 'BA' },

  recife:            { nome: 'Recife', lat: -8.0476, lng: -34.8770, uf: 'PE' },
  jaboatao:          { nome: 'Jaboatão dos Guararapes', lat: -8.1130, lng: -35.0148, uf: 'PE' },

  maceio:            { nome: 'Maceió', lat: -9.6658, lng: -35.7350, uf: 'AL' },
  aracaju:           { nome: 'Aracaju', lat: -10.9472, lng: -37.0731, uf: 'SE' },
  joao_pessoa:       { nome: 'João Pessoa', lat: -7.1150, lng: -34.8631, uf: 'PB' },
  natal:             { nome: 'Natal', lat: -5.7945, lng: -35.2110, uf: 'RN' },
  fortaleza:         { nome: 'Fortaleza', lat: -3.7172, lng: -38.5434, uf: 'CE' },
  teresina:          { nome: 'Teresina', lat: -5.0892, lng: -42.8016, uf: 'PI' },
  'sao luis':        { nome: 'São Luís', lat: -2.5391, lng: -44.2829, uf: 'MA' },

  belem:             { nome: 'Belém', lat: -1.4558, lng: -48.5039, uf: 'PA' },
  santarem:          { nome: 'Santarém', lat: -2.4431, lng: -54.7081, uf: 'PA' },
  manaus:            { nome: 'Manaus', lat: -3.1190, lng: -60.0217, uf: 'AM' },
  porto_velho:       { nome: 'Porto Velho', lat: -8.7619, lng: -63.9039, uf: 'RO' },
  rio_branco:        { nome: 'Rio Branco', lat: -9.9750, lng: -67.8243, uf: 'AC' },
  boa_vista:         { nome: 'Boa Vista', lat: 2.8235, lng: -60.6758, uf: 'RR' },
  macapa:            { nome: 'Macapá', lat: 0.0349, lng: -51.0664, uf: 'AP' },
  palmas:            { nome: 'Palmas', lat: -10.1689, lng: -48.3318, uf: 'TO' },

  cuiaba:            { nome: 'Cuiabá', lat: -15.6014, lng: -56.0979, uf: 'MT' },
  'campo grande':    { nome: 'Campo Grande', lat: -20.4486, lng: -54.6295, uf: 'MS' },

  curitiba:          { nome: 'Curitiba', lat: -25.4284, lng: -49.2733, uf: 'PR' },
  londrina:          { nome: 'Londrina', lat: -23.3045, lng: -51.1696, uf: 'PR' },
  maringa:           { nome: 'Maringá', lat: -23.4205, lng: -51.9333, uf: 'PR' },
  'foz do iguacu':   { nome: 'Foz do Iguaçu', lat: -25.5478, lng: -54.5882, uf: 'PR' },

  florianopolis:     { nome: 'Florianópolis', lat: -27.5954, lng: -48.5480, uf: 'SC' },
  joinville:         { nome: 'Joinville', lat: -26.3045, lng: -48.8487, uf: 'SC' },
  blumenau:          { nome: 'Blumenau', lat: -26.9194, lng: -49.0660, uf: 'SC' },

  'porto alegre':    { nome: 'Porto Alegre', lat: -30.0277, lng: -51.2287, uf: 'RS' },
  caxias_do_sul:     { nome: 'Caxias do Sul', lat: -29.1684, lng: -51.1794, uf: 'RS' },
  pelotas:           { nome: 'Pelotas', lat: -31.7654, lng: -52.3376, uf: 'RS' },
  santa_maria:       { nome: 'Santa Maria', lat: -29.6842, lng: -53.8069, uf: 'RS' },
}

function normalizarChave(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

/**
 * Busca uma cidade pelo nome (com normalização de acento/case).
 * Tenta também com underline (ex: 'sao_paulo') além de espaço.
 */
export function findCityGeo(name: string): CityGeo | null {
  if (!name) return null
  const k = normalizarChave(name)
  if (CIDADES_BR_GEO[k]) return CIDADES_BR_GEO[k]
  const kUnder = k.replace(/\s+/g, '_')
  if (CIDADES_BR_GEO[kUnder]) return CIDADES_BR_GEO[kUnder]
  // Fallback: procura por inclusão parcial
  for (const [key, geo] of Object.entries(CIDADES_BR_GEO)) {
    if (k.includes(key) || key.includes(k)) return geo
  }
  return null
}
