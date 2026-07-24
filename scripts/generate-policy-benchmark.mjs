import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const catalogPath = resolve(root, 'lib', 'policy', 'templates', 'catalog.ts')
const outputPath = resolve(root, 'docs', 'POLICY-BENCHMARK-MATRIX.csv')
const source = readFileSync(catalogPath, 'utf8')

const families = []
for (const match of source.matchAll(
  /simple\(\{\s*key:\s*'([^']+)',\s*category:\s*'([^']+)',\s*title:\s*'([^']+)',\s*description:\s*'([^']+)'/g,
)) {
  families.push({
    familyKey: match[1],
    category: match[2],
    title: match[3],
    description: match[4],
  })
}
for (const match of source.matchAll(
  /percentageRule\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g,
)) {
  families.push({
    familyKey: match[1],
    category: match[2],
    title: match[3],
    description: match[4],
  })
}

const references = new Map()
const mapSource = source.slice(source.indexOf('const ARGO_REFERENCES_BY_FAMILY'))
for (const match of mapSource.matchAll(/\s*'([^']+)':\s*\[([^\]]*)\]/g)) {
  references.set(match[1], [...match[2].matchAll(/'([^']+)'/g)].map((item) => item[1]))
}

const rows = families
  .sort((left, right) => left.familyKey.localeCompare(right.familyKey))
  .map((family) => {
    const externalReferences = references.get(family.familyKey) || []
    const requiresExternalIntegration = family.category === 'integrations'
      || family.familyKey === 'emission.online-authorized'
      || family.familyKey === 'quotation.online-fallback'
    return {
      family_key: family.familyKey,
      category: family.category,
      bdex_status: 'IMPLEMENTADO',
      bdex_source: 'lib/policy/templates/catalog.ts',
      automated_evidence: 'tests/unit/policy-template-catalog.test.ts',
      external_reference: externalReferences.join(' | ') || 'BDEX nativo',
      external_page: '',
      benchmark_status: requiresExternalIntegration
        ? 'IMPLEMENTADO_DEPENDENCIA_EXTERNA'
        : 'IMPLEMENTADO',
      notes: `${family.title}: ${family.description}`,
    }
  })

rows.push({
  family_key: 'approval.without-authentication',
  category: 'security',
  bdex_status: 'REJEITADO_SEGURANCA',
  bdex_source: 'lib/policy/templates/argo-benchmark.ts',
  automated_evidence: 'tests/unit/policy-template-catalog.test.ts',
  external_reference: 'ARGO:APROUT',
  external_page: '7 | 10 | 19',
  benchmark_status: 'NAO_IMPLEMENTADO_POR_SEGURANCA',
  notes: 'Substituido por link individual, autenticado, expirable e de uso unico.',
})

const headers = [
  'family_key',
  'category',
  'bdex_status',
  'bdex_source',
  'automated_evidence',
  'external_reference',
  'external_page',
  'benchmark_status',
  'notes',
]
const csv = [
  headers.join(','),
  ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(',')),
].join('\n')

writeFileSync(outputPath, `${csv}\n`, 'utf8')
console.log(`Matriz atualizada: ${rows.length} linhas em ${outputPath}`)

function csvValue(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
