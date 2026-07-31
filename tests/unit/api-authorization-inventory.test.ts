import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  authorizationForApiRequest,
  evaluateAuthorization,
  type AuthorizationAction,
  type AuthorizationResource,
} from '@/lib/server/authorization-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

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

  it('possui politica para toda combinacao inferida de recurso e acao', async () => {
    const files = routeFiles(path.join(process.cwd(), 'app', 'api'))
    const policyGaps: string[] = []
    const actor = inventoryPrincipal()

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
        const decision = evaluateAuthorization(actor, authorization)
        if (decision.code === 'AUTHORIZATION_POLICY_MISSING') {
          policyGaps.push(`${method} ${route} -> ${authorization.resource}/${authorization.action}`)
        }
      }
    }

    expect(policyGaps).toEqual([])
  })

  it('possui politica para toda autorizacao explicita declarada nas rotas', () => {
    const files = routeFiles(path.join(process.cwd(), 'app', 'api'))
    const policyGaps: string[] = []
    const actor = inventoryPrincipal()

    for (const file of files) {
      const relative = path.relative(process.cwd(), file).replaceAll(path.sep, '/')
      const source = fs.readFileSync(file, 'utf8')
      const authorizationBlocks = source.matchAll(/authorization:\s*\{([\s\S]*?)\}/g)

      for (const match of authorizationBlocks) {
        const body = match[1] || ''
        const resource = body.match(/resource:\s*'([^']+)'/)?.[1]
        const action = body.match(/action:\s*'([^']+)'/)?.[1]
        if (!resource || !action) continue

        const decision = evaluateAuthorization(actor, {
          resource: resource as AuthorizationResource,
          action: action as AuthorizationAction,
        })
        if (decision.code === 'AUTHORIZATION_POLICY_MISSING') {
          policyGaps.push(`${relative} -> ${resource}/${action}`)
        }
      }
    }

    expect(policyGaps).toEqual([])
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

function inventoryPrincipal(): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('group_finance', {})
  return {
    sessionId: 'session-inventory',
    tenantId: 'tenant-inventory',
    tenantSlug: 'tenant-inventory',
    tenantStatus: 'active',
    membershipId: 'membership-inventory',
    roleKey: 'tenant_admin',
    platformAdmin: true,
    planKey: 'enterprise',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    authorizationGrants: [],
    corporateAccess: {
      tenantWide: true,
      companyIds: ['company-inventory'],
      groupIds: [],
      companies: [{
        companyId: 'company-inventory',
        companyName: 'Empresa de inventario',
        groupId: null,
        groupName: null,
        sources: ['tenant_admin'],
        profiles: ['group_finance'],
        permissions,
      }],
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-inventory' },
      refreshedAt: new Date(0).toISOString(),
    },
    user: {
      id: 'user-inventory',
      email: 'inventory@example.test',
      name: 'Inventario',
      role: 'company_admin',
      company_id: 'company-inventory',
      ativo: true,
      permissoes: permissions,
    },
  }
}
