import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = path.join(projectRoot, 'app')
const outputPath = path.join(projectRoot, 'docs', 'FEATURE-INVENTORY.generated.md')
const checkOnly = process.argv.includes('--check')
const publicApiRoutes = new Set(['/api/health', '/api/ready', '/api/auth/session'])
const e2ePages = new Set(['/login', '/dashboard', '/dashboard/plataforma'])
const e2eApis = new Set(['/api/storage', '/api/files', '/api/files/[id]', '/api/files/[id]/download'])

const files = await walk(appRoot)
const pages = files.filter((file) => file.endsWith(`${path.sep}page.tsx`)).sort()
const apiRoutes = files.filter((file) => file.endsWith(`${path.sep}route.ts`) && file.includes(`${path.sep}api${path.sep}`)).sort()

const pageRows = pages.map((file) => {
  const route = routeFrom(file, 'page.tsx')
  return [route, relative(file), e2ePages.has(route) ? 'E2E no CI' : 'Build e inventario; fluxo individual pendente']
})

const apiRows = []
const unguarded = []
for (const file of apiRoutes) {
  const source = await readFile(file, 'utf8')
  const route = routeFrom(file, 'route.ts')
  const methods = Array.from(source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g))
    .map((match) => match[1])
    .join(', ')
  const guardKind = source.includes('guardApiRequest')
    ? 'Guard do servidor'
    : source.includes('guardFileEntityRequest')
      ? 'Guard do servidor + autorizacao por vinculo'
      : null
  const guarded = Boolean(guardKind)
  const expectedPublic = publicApiRoutes.has(route)
  if (!guarded && !expectedPublic) unguarded.push(route)
  const protection = guardKind || (expectedPublic ? 'Publica por contrato' : 'SEM GUARD')
  const evidence = e2eApis.has(route)
    ? 'E2E no CI'
    : route === '/api/health' || route === '/api/ready'
      ? 'Smoke test no CI'
      : 'Build e inventario; fluxo individual pendente'
  apiRows.push([route, methods || 'nao detectado', protection, evidence])
}

if (unguarded.length) {
  throw new Error(`Rotas de API sem guard: ${unguarded.join(', ')}`)
}

const markdown = [
  '# Inventario gerado de funcionalidades',
  '',
  '> Arquivo gerado por `npm run inventory:features`. Nao editar manualmente.',
  '',
  `Paginas encontradas: **${pageRows.length}**. Rotas de API encontradas: **${apiRows.length}**.`,
  '',
  '## Paginas',
  '',
  '| Rota | Arquivo | Evidencia atual |',
  '| --- | --- | --- |',
  ...pageRows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  '',
  '## APIs',
  '',
  '| Rota | Metodos | Protecao | Evidencia atual |',
  '| --- | --- | --- | --- |',
  ...apiRows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  '',
].join('\n')

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (normalize(current) !== normalize(markdown)) {
    throw new Error('Inventario de funcionalidades desatualizado. Execute npm run inventory:features.')
  }
  process.stdout.write('Inventario de funcionalidades atualizado.\n')
} else {
  await writeFile(outputPath, markdown, 'utf8')
  process.stdout.write(`Inventario gerado: ${relative(outputPath)}\n`)
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => {
      const resolved = path.join(directory, entry.name)
      return entry.isDirectory() ? walk(resolved) : [resolved]
    }))
  return nested.flat()
}

function routeFrom(file, leaf) {
  const relativePath = path.relative(appRoot, file).split(path.sep).join('/')
  const withoutLeaf = relativePath.slice(0, -(leaf.length + 1))
  const route = `/${withoutLeaf}`.replace(/\/\([^/]+\)/g, '').replace(/\/+$/, '')
  return route || '/'
}

function relative(file) {
  return path.relative(projectRoot, file).split(path.sep).join('/')
}

function cell(value) {
  return `\`${String(value).replace(/\|/g, '\\|')}\``
}

function normalize(value) {
  return value.replace(/\r\n/g, '\n').trimEnd()
}
