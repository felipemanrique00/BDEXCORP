import Link from 'next/link'
import type { ReactNode } from 'react'

import { BBTLogo } from '@/components/branding/bbt-logo'

export function AuthFormFrame({
  title,
  description,
  children,
  backHref = '/login',
  backLabel = 'Voltar ao login',
}: {
  title: string
  description: string
  children: ReactNode
  backHref?: string
  backLabel?: string
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6fa] px-5 py-10 dark:bg-[#10142b]">
      <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
        <BBTLogo variant="full" tone="color" size={52} className="mb-9 dark:hidden" />
        <BBTLogo variant="full" tone="white" size={52} className="mb-9 hidden dark:block" />
        <h1 className="text-2xl font-semibold text-bbt-primary dark:text-white">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
        <div className="mt-7">{children}</div>
        <Link href={backHref} className="mt-6 inline-flex text-sm font-semibold text-bbt-violet hover:underline dark:text-cyan-300">
          {backLabel}
        </Link>
      </section>
    </main>
  )
}
