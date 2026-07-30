import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('assistant API request context', () => {
  it('executa toda rota autenticada da assistente dentro do contexto do guard', () => {
    const routes = routeFiles(path.join(process.cwd(), 'app', 'api', 'assistant'))
    const missingContext = routes
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return source.includes('guardApiRequest(') && !source.includes('runInApiGuardContext(')
      })
      .map((file) => path.relative(process.cwd(), file).replaceAll(path.sep, '/'))

    expect(missingContext).toEqual([])
  })

  it('protege rotas externas que usam armazenamento dependente do contexto', () => {
    const routes = routeFiles(path.join(process.cwd(), 'app', 'api'))
    const missingContext = routes
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        const usesContextStorage = source.includes('@/lib/assistant/')
          || source.includes('@/lib/server-db')
        return usesContextStorage
          && source.includes('guardApiRequest(')
          && !source.includes('runInApiGuardContext(')
      })
      .map((file) => path.relative(process.cwd(), file).replaceAll(path.sep, '/'))

    expect(missingContext).toEqual([])
  })
})

function routeFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return routeFiles(target)
    return entry.name === 'route.ts' ? [target] : []
  })
}
