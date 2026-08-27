import { Suspense } from 'react'

import { CompanyPortalRouter } from '@/components/company-portal-lab/company-portal-router'

export default function CompanyPortalLabPage() {
  return (
    <Suspense fallback={<CompanyPortalLabLoading />}>
      <CompanyPortalRouter />
    </Suspense>
  )
}

function CompanyPortalLabLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] animate-pulse space-y-4 p-4 sm:p-6">
      <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800" />
      <div className="grid gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-80 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  )
}
