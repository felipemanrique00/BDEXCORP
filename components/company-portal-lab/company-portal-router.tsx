'use client'

import { useSearchParams } from 'next/navigation'

import { CompanyPortalLab } from '@/components/company-portal-lab/company-portal-lab'
import { CorporateApprovalsSection } from '@/components/company-portal-lab/corporate-approvals-section'
import { CorporateReportsSection } from '@/components/company-portal-lab/corporate-reports-section'
import { CorporateVouchersSection } from '@/components/company-portal-lab/corporate-vouchers-section'
import type { CompanyPortalSection } from '@/components/company-portal-lab/company-portal-chrome'

const COMPANY_PORTAL_SECTIONS = new Set<CompanyPortalSection>([
  'demands',
  'approvals',
  'vouchers',
  'reports',
])

export function CompanyPortalRouter() {
  const searchParams = useSearchParams()
  const section = resolveCompanyPortalSection(searchParams.get('section'))

  if (section === 'approvals') return <CorporateApprovalsSection />
  if (section === 'vouchers') return <CorporateVouchersSection />
  if (section === 'reports') return <CorporateReportsSection />
  return <CompanyPortalLab />
}

export function resolveCompanyPortalSection(value: string | null): CompanyPortalSection {
  return value && COMPANY_PORTAL_SECTIONS.has(value as CompanyPortalSection)
    ? value as CompanyPortalSection
    : 'demands'
}
