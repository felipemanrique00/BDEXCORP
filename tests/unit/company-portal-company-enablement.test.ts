import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  calculateCorporateAccess,
  type CorporateAccessCompanyGrantRow,
  type CorporateAccessCompanyRow,
  type ResolveCorporateAccessInput,
} from '@/lib/server/corporate-access-service'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const migration = read('deploy/postgres/migrations/0086_company_portal_company_enablement.sql')
const typesSource = read('types/index.ts')
const companiesPageSource = read('app/dashboard/empresas/page.tsx')
const portalContextSource = read('lib/company-portal-lab/portal-context.ts')
const portalContextHookSource = read('components/company-portal-lab/use-company-portal-context.ts')
const portalLabSource = read('components/company-portal-lab/company-portal-lab.tsx')
const travelerPortalSource = read('lib/server/traveler-portal-service.ts')
const directorySyncSource = read('lib/server/corporate-directory-sync.ts')
const corporateAccessSource = read('lib/server/corporate-access-service.ts')
const portalScopeSource = read('lib/server/company-portal-scope-service.ts')

describe('company Portal Empresa enablement contract', () => {
  it('backfills only existing active companies before enforcing opt-in by default', () => {
    expect(migration).toMatch(
      /alter table companies\s+add column if not exists company_portal_enabled boolean/i,
    )
    expect(migration).toMatch(
      /update companies\s+set company_portal_enabled = \(\s*status = 'active'\s+and deleted_at is null\s*\)\s+where company_portal_enabled is null/i,
    )
    expect(migration).toMatch(
      /alter table companies\s+alter column company_portal_enabled set default false/i,
    )
    expect(migration).toMatch(
      /alter table companies\s+alter column company_portal_enabled set not null/i,
    )

    const addColumnAt = migration.indexOf('add column if not exists company_portal_enabled boolean')
    const backfillAt = migration.indexOf('update companies')
    const defaultAt = migration.indexOf('alter column company_portal_enabled set default false')
    const notNullAt = migration.indexOf('alter column company_portal_enabled set not null')
    expect(addColumnAt).toBeGreaterThanOrEqual(0)
    expect(backfillAt).toBeGreaterThan(addColumnAt)
    expect(defaultAt).toBeGreaterThan(backfillAt)
    expect(notNullAt).toBeGreaterThan(defaultAt)
  })

  it('keeps the company form an explicit opt-in persisted in the directory model', () => {
    expect(typesSource).toMatch(/portal_empresa_habilitado\??:\s*boolean/)
    expect(companiesPageSource).toMatch(/portal_empresa_habilitado:\s*false/)
    expect(companiesPageSource).toContain('ativa: data.ativa !== false')
    expect(companiesPageSource).not.toContain('addEmpresa({ ...data, ativa: true }')
    expect(companiesPageSource).toContain('type="checkbox"')
    expect(companiesPageSource).toMatch(/checked=\{[^}]*form\.portal_empresa_habilitado/)
    expect(companiesPageSource).toMatch(/Portal Empresa/i)
    expect(companiesPageSource).toContain(
      'portal_empresa_habilitado: company.portal_empresa_habilitado ?? company.ativa',
    )
  })

  it('distinguishes explicit true and false while preserving the database value when omitted', () => {
    expect(directorySyncSource).toMatch(
      /typeof value\.portal_empresa_habilitado === 'boolean'[\s\S]*?\? value\.portal_empresa_habilitado[\s\S]*?: null/,
    )
    expect(directorySyncSource).toContain('default_cost_center, company_portal_enabled, status')
    expect(directorySyncSource).toContain('coalesce($11::boolean, false)')
    expect(directorySyncSource).toContain(
      'company_portal_enabled = coalesce($11::boolean, companies.company_portal_enabled)',
    )
  })

  it('projects the flag without shrinking global corporate access and enforces it in the portal scope', () => {
    expect(corporateAccessSource).toContain('company_row.company_portal_enabled')
    expect(corporateAccessSource).not.toMatch(
      /companies\.filter\(\(company\) => company\.company_portal_enabled !== false\)/,
    )
    expect(portalScopeSource).toContain('company.companyPortalEnabled !== false')
    expect(portalContextSource).toContain('company.companyPortalEnabled !== false')
    expect(portalContextHookSource).toContain(
      'hasCompanyScopeAccess(state.user, state.access, portalCompanyIds, companyId, permission)',
    )
    expect(portalLabSource).toContain('() => (access?.companies || [])')
    expect(portalLabSource).toContain("portalIncludesCompany(company.id, 'criar_demandas')")
  })

  it('keeps a disabled company in corporate access for Portal Viajante and preserves agency tenant-wide access', () => {
    const companies: CorporateAccessCompanyRow[] = [
      company('company-enabled', true),
      company('company-disabled', false),
    ]
    const grants: CorporateAccessCompanyGrantRow[] = companies.map((item) => ({
      id: `grant-${item.id}`,
      company_id: item.id,
      corporate_profile: 'company_admin',
      permission_overrides: {},
    }))

    const corporate = calculateCorporateAccess(
      input('company_admin'),
      companies,
      [],
      [],
      grants,
      null,
      true,
    )
    expect(corporate.summary.companyIds).toEqual(['company-disabled', 'company-enabled'])
    expect(corporate.summary.companies.find((item) => item.companyId === 'company-disabled'))
      .toMatchObject({ companyPortalEnabled: false })
    expect(corporate.effectivePermissions.acessar_portal_viajante).toBe(true)
    expect(travelerPortalSource).toContain('const companyIds = getAccessibleCompanyIds(principal)')
    expect(travelerPortalSource).not.toMatch(/companyPortalEnabled|company_portal_enabled/)

    const agency = calculateCorporateAccess(
      input('agent'),
      companies,
      [],
      [],
      [],
      null,
      false,
    )
    expect(agency.summary.tenantWide).toBe(true)
    expect(agency.summary.companyIds).toEqual(['company-disabled', 'company-enabled'])
  })
})

function company(id: string, companyPortalEnabled: boolean): CorporateAccessCompanyRow {
  return {
    id,
    name: id,
    group_id: null,
    group_name: null,
    company_portal_enabled: companyPortalEnabled,
  }
}

function input(roleKey: string): ResolveCorporateAccessInput {
  return {
    tenantId: 'tenant-a',
    membershipId: 'membership-a',
    roleKey,
    platformAdmin: false,
    membershipPermissions: permissionsForCorporateProfile('company_admin', {}),
    legacyCompanyId: null,
    legacyCompanyIds: [],
    legacyGroupIds: [],
  }
}
