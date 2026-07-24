import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { authorizationForApiRequest } from '@/lib/server/authorization-service'

const PUBLIC_ROUTE_FILES = new Set([
  'app/api/auth/invite/accept/route.ts',
  'app/api/auth/login/route.ts',
  'app/api/auth/mfa/enroll/route.ts',
  'app/api/auth/mfa/verify/route.ts',
  'app/api/auth/password-reset/confirm/route.ts',
  'app/api/auth/password-reset/request/route.ts',
  'app/api/auth/session/route.ts',
  'app/api/health/route.ts',
  'app/api/ready/route.ts',
])

describe('API authorization inventory', () => {
  it('classifica toda rota autenticada em um recurso conhecido', async () => {
    const files = routeFiles(path.join(process.cwd(), 'app', 'api'))
    const unclassified: string[] = []

    for (const file of files) {
      const relative = path.relative(process.cwd(), file).replaceAll(path.sep, '/')
      if (PUBLIC_ROUTE_FILES.has(relative)) continue
      const source = fs.readFileSync(file, 'utf8')
      const methods = Array.from(source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g))
        .map((match) => match[1])
      for (const method of methods) {
        const route = routePath(relative)
        const authorization = await authorizationForApiRequest(new Request(`http://localhost${route}`, {
          method,
          headers: ['POST', 'PUT', 'PATCH'].includes(method)
            ? { 'content-type': 'application/json' }
            : undefined,
          body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
        }))
        if (authorization.resource === 'generic') unclassified.push(`${method} ${route}`)
      }
    }

    expect(unclassified).toEqual([])
  })
})

function routeFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return routeFiles(target)
    return entry.name === 'route.ts' ? [target] : []
  })
}

function routePath(relativeFile: string): string {
  return `/${relativeFile
    .replace(/^app\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000001')}`
}
