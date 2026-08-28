'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Network,
  Search,
  X,
} from 'lucide-react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import {
  isCorporateCompanySelectionAllowed,
  matchesCorporateContextSearch,
} from '@/lib/corporate-context-selection'
import { cn } from '@/lib/utils'
import type { CorporateGroupAccessSummary } from '@/types'

export function CorporateContextSelector({ placement = 'header' }: { placement?: 'header' | 'mobile-menu' }) {
  const {
    access,
    selectedCompanyIds,
    selectionLabel,
    canSelectAll,
    allowArbitrarySelection,
    isChanging,
    selectCompanyIds,
  } = useCorporateContext()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [draftCompanyIds, setDraftCompanyIds] = useState<string[]>(selectedCompanyIds)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setDraftCompanyIds(selectedCompanyIds)
  }, [open, selectedCompanyIds])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const draftSet = useMemo(() => new Set(draftCompanyIds), [draftCompanyIds])
  const visibleGroups = useMemo(() => {
    if (!access) return []
    return access.groups.flatMap((group) => {
      const companies = access.companies.filter((company) => group.companyIds.includes(company.companyId))
      const groupMatches = matchesCorporateContextSearch(group.groupName, search)
      const filteredCompanies = groupMatches
        ? companies
        : companies.filter((company) => matchesCorporateContextSearch(company.companyName, search))
      return filteredCompanies.length > 0 ? [{ group, companies: filteredCompanies }] : []
    })
  }, [access, search])
  const groupedCompanyIds = useMemo(
    () => new Set(access?.groups.flatMap((group) => group.companyIds) || []),
    [access?.groups],
  )
  const visibleUngroupedCompanies = useMemo(
    () => (access?.companies || []).filter((company) => (
      !groupedCompanyIds.has(company.companyId)
      && matchesCorporateContextSearch(company.companyName, search)
    )),
    [access?.companies, groupedCompanyIds, search],
  )

  if (!access || access.companies.length <= 1) return null
  const resolvedAccess = access

  function openSelector() {
    setDraftCompanyIds(selectedCompanyIds)
    setSearch('')
    setOpen(true)
  }

  function toggleCompany(companyId: string) {
    const next = draftSet.has(companyId)
      ? draftCompanyIds.filter((id) => id !== companyId)
      : [...draftCompanyIds, companyId]
    if (
      next.length === 0
      || isCorporateCompanySelectionAllowed(resolvedAccess, next, { allowArbitrarySelection })
    ) {
      setDraftCompanyIds(next)
      return
    }
    setDraftCompanyIds([companyId])
  }

  function toggleGroup(group: CorporateGroupAccessSummary) {
    const canCombine = allowArbitrarySelection || group.canViewConsolidated
    if (!canCombine) return
    const groupIds = group.companyIds.filter((companyId) => resolvedAccess.companyIds.includes(companyId))
    const allSelected = groupIds.every((companyId) => draftSet.has(companyId))
    if (allSelected) {
      setDraftCompanyIds(draftCompanyIds.filter((companyId) => !groupIds.includes(companyId)))
      return
    }
    const combined = [...new Set([...draftCompanyIds, ...groupIds])]
    setDraftCompanyIds(isCorporateCompanySelectionAllowed(
      resolvedAccess,
      combined,
      { allowArbitrarySelection },
    )
      ? combined
      : groupIds)
  }

  function applySelection() {
    if (!selectCompanyIds(draftCompanyIds)) return
    setOpen(false)
    setSearch('')
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-w-0 items-center',
        placement === 'header' ? 'hidden max-w-[23rem] md:flex' : 'flex w-full md:hidden',
      )}
    >
      <button
        type="button"
        onClick={() => open ? setOpen(false) : openSelector()}
        disabled={isChanging}
        className={cn(
          'flex h-10 min-w-0 items-center gap-2 rounded-md border px-3 text-left text-xs font-semibold outline-none transition focus:ring-2 focus:ring-bbt-accent/20',
          placement === 'header'
            ? 'min-w-[14rem] max-w-[23rem] border-bbt-gray-100 bg-white text-bbt-primary hover:border-bbt-accent focus:border-bbt-accent dark:border-slate-700 dark:bg-slate-800 dark:text-white'
            : 'w-full border-white/15 bg-white/10 text-white hover:border-cyan-300/70 focus:border-cyan-300',
        )}
        aria-label="Selecionar empresas do contexto corporativo"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {selectedCompanyIds.length === 1
          ? <Building2 className="h-4 w-4 shrink-0 text-bbt-accent" />
          : <Network className="h-4 w-4 shrink-0 text-bbt-accent" />}
        <span className="min-w-0 flex-1 truncate">{selectionLabel}</span>
        {isChanging
          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-bbt-accent" />
          : <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filtro de empresas"
          className={cn(
            'absolute top-full z-[70] mt-2 overflow-hidden rounded-xl border border-bbt-gray-100 bg-white text-bbt-text shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
            placement === 'header'
              ? 'right-0 w-[min(28rem,calc(100vw-2rem))]'
              : 'left-0 w-full min-w-[16rem]',
          )}
        >
          <div className="border-b border-bbt-gray-100 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-bbt-primary dark:text-white">Empresas exibidas</p>
                <p className="text-[11px] text-slate-500">Pesquise e marque uma ou mais empresas.</p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); setSearch('') }}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Fechar filtro de empresas"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar empresa ou grupo..."
                className="h-10 w-full rounded-md border border-bbt-gray-100 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-bbt-accent focus:ring-2 focus:ring-bbt-accent/15 dark:border-slate-700 dark:bg-slate-800"
                aria-label="Buscar empresa ou grupo"
              />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setDraftCompanyIds(access.companyIds)}
                disabled={!canSelectAll}
                className="font-semibold text-cyan-700 transition hover:text-cyan-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-300"
              >
                Selecionar todas
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setDraftCompanyIds([])}
                className="font-semibold text-slate-500 transition hover:text-slate-800 dark:hover:text-slate-200"
              >
                Limpar seleção
              </button>
            </div>
          </div>

          <div className="max-h-[22rem] overflow-y-auto p-2">
            {visibleGroups.map(({ group, companies }) => (
              <div key={group.groupId} className="mb-2 overflow-hidden rounded-lg border border-bbt-gray-100 last:mb-0 dark:border-slate-700">
                <GroupSelectionRow
                  group={group}
                  selected={draftSet}
                  canCombine={allowArbitrarySelection || group.canViewConsolidated}
                  onToggle={() => toggleGroup(group)}
                />
                <div className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                  {companies.map((company) => (
                    <CompanySelectionRow
                      key={company.companyId}
                      companyId={company.companyId}
                      companyName={company.companyName}
                      checked={draftSet.has(company.companyId)}
                      onToggle={() => toggleCompany(company.companyId)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {visibleUngroupedCompanies.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-bbt-gray-100 dark:border-slate-700">
                <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800/80">
                  Empresas individuais
                </div>
                <div className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                  {visibleUngroupedCompanies.map((company) => (
                    <CompanySelectionRow
                      key={company.companyId}
                      companyId={company.companyId}
                      companyName={company.companyName}
                      checked={draftSet.has(company.companyId)}
                      onToggle={() => toggleCompany(company.companyId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {visibleGroups.length === 0 && visibleUngroupedCompanies.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma empresa encontrada para “{search}”.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-bbt-gray-100 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
            <span className={cn('text-xs font-semibold', draftCompanyIds.length === 0 ? 'text-amber-600' : 'text-slate-500')}>
              {draftCompanyIds.length === 0
                ? 'Selecione pelo menos uma empresa'
                : `${draftCompanyIds.length} de ${access.companyIds.length} selecionada${draftCompanyIds.length === 1 ? '' : 's'}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDraftCompanyIds(selectedCompanyIds); setOpen(false); setSearch('') }}
                className="h-9 rounded-md border border-bbt-gray-100 px-3 text-xs font-semibold text-slate-600 transition hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applySelection}
                disabled={draftCompanyIds.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-bbt-primary px-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Check className="h-3.5 w-3.5" />
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GroupSelectionRow({
  group,
  selected,
  canCombine,
  onToggle,
}: {
  group: CorporateGroupAccessSummary
  selected: ReadonlySet<string>
  canCombine: boolean
  onToggle: () => void
}) {
  const selectedCount = group.companyIds.filter((companyId) => selected.has(companyId)).length
  const checked = group.companyIds.length > 0 && selectedCount === group.companyIds.length
  const partial = selectedCount > 0 && !checked
  return (
    <label className={cn(
      'flex items-center gap-2 bg-slate-50 px-3 py-2 dark:bg-slate-800/80',
      canCombine ? 'cursor-pointer' : 'cursor-not-allowed',
    )}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!canCombine}
        ref={(node) => { if (node) node.indeterminate = partial }}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 accent-cyan-600"
        aria-label={`Selecionar grupo ${group.groupName}`}
      />
      <Network className="h-4 w-4 shrink-0 text-cyan-600" />
      <span className="min-w-0 flex-1 truncate text-xs font-bold text-bbt-primary dark:text-white">{group.groupName}</span>
      <span className="text-[10px] text-slate-500">
        {canCombine ? `${selectedCount}/${group.companyIds.length}` : 'Seleção individual'}
      </span>
    </label>
  )
}

function CompanySelectionRow({
  companyId,
  companyName,
  checked,
  onToggle,
}: {
  companyId: string
  companyName: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 transition hover:bg-cyan-50/60 dark:hover:bg-cyan-950/20">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 accent-cyan-600"
        aria-label={`Exibir ${companyName}`}
      />
      <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate text-sm">{companyName}</span>
      <span className="sr-only">{companyId}</span>
    </label>
  )
}
