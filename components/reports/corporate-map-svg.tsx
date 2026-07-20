'use client'

import type { DashboardMapPoint } from '@/lib/reporting/corporate-dashboard'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface Props {
  pontos: DashboardMapPoint[]
  selected?: string
  onSelect?: (cidade: string) => void
  height?: number
}

export function CorporateMapSvg({ pontos, selected, onSelect, height = 300 }: Props) {
  const max = Math.max(1, ...pontos.map((ponto) => ponto.total))
  const selectedNorm = normalize(selected || '')

  return (
    <div className="rounded-md border border-slate-200 bg-[#a9c3e9] p-2 dark:border-slate-700">
      <svg viewBox="0 0 840 520" role="img" aria-label="Mapa de cidades e aeroportos do relatório" className="w-full" style={{ height }}>
        <rect x="0" y="0" width="840" height="520" fill="#a9c3e9" />
        <path fill="#d4d0c7" stroke="#8b918e" strokeWidth="1.2" d="M73,9 L213,16 L256,75 L239,128 L280,174 L271,222 L312,282 L308,333 L352,382 L335,455 L275,512 L151,503 L118,447 L93,378 L54,324 L38,248 L55,177 L35,116 Z" />
        <path fill="#d8d5ca" stroke="#7e8782" strokeWidth="1.1" d="M270,42 L383,41 L508,78 L600,133 L660,219 L635,312 L573,390 L486,476 L374,497 L296,454 L247,356 L223,258 L189,187 L208,109 Z" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M274,92 L360,117 L421,96 L506,128 L575,191" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M232,221 L323,215 L408,245 L506,232 L617,270" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M282,348 L382,322 L467,348 L565,327" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M346,54 L331,160 L348,247 L340,358 L372,486" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M466,84 L448,178 L458,278 L441,378 L408,474" />
        <path fill="none" stroke="rgba(112,122,120,.38)" strokeWidth=".7" d="M562,132 L526,209 L541,295 L511,398" />
        <text x="430" y="255" fill="rgba(50,61,65,.35)" fontSize="52" fontWeight="800" textAnchor="middle">BRASIL</text>

        {pontos.slice(0, 25).map((ponto, index) => {
          const p = project(ponto.lng, ponto.lat)
          const radius = 6 + Math.sqrt(ponto.total / max) * 15
          const label = shortLabel(ponto.codigo || ponto.cidade, 14)
          const lx = Math.min(790, p.x + radius + 5)
          const ly = Math.max(16, p.y - radius - 2)
          const active = selectedNorm === normalize(ponto.cidade) || selectedNorm === normalize(ponto.codigo || '') || selectedNorm === normalize(ponto.nome)
          return (
            <g
              key={ponto.chave}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(ponto.cidade)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect?.(ponto.cidade)
              }}
            >
              <title>{`${ponto.nome} - ${formatCurrency(ponto.total)} - ${ponto.quantidade} demanda(s)`}</title>
              <circle
                cx={p.x}
                cy={p.y}
                r={radius}
                fill={active ? '#11175f' : index < 5 ? '#df4053' : '#10beb3'}
                stroke="#fff"
                strokeWidth={active ? 4 : 2}
                opacity=".93"
              />
              {index < 13 && (
                <>
                  <rect x={lx} y={ly - 12} width={Math.max(42, label.length * 6.4)} height="16" rx="3" fill="rgba(58,63,70,.72)" />
                  <text x={lx + 4} y={ly} fill="#fff" fontSize="10" fontWeight="850">{label}</text>
                </>
              )}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <span>Mapa SVG interativo por cidade/aeroporto</span>
        <span className={cn('font-semibold', pontos.length ? 'text-bbt-primary dark:text-white' : 'text-slate-400')}>
          {pontos.length ? `${pontos.length} ponto(s) georreferenciado(s)` : 'Sem coordenadas para o filtro atual'}
        </span>
      </div>
    </div>
  )
}

function project(lng: number, lat: number): { x: number; y: number } {
  const minLng = -74
  const maxLng = -34
  const minLat = -34
  const maxLat = 6
  const x = ((lng - minLng) / (maxLng - minLng)) * 840
  const y = ((maxLat - lat) / (maxLat - minLat)) * 520
  return { x: Math.max(10, Math.min(830, x)), y: Math.max(10, Math.min(510, y)) }
}

function shortLabel(value: string, max: number): string {
  const text = String(value || '-')
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function normalize(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
