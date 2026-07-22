'use client'

import { useEffect, useRef, useState } from 'react'
import { reportClientFailure } from '@/lib/client-observability'
import type { PontoMapaAereo, RotaMapaAereo } from '@/lib/reporting/aereo-executivo'

interface Props {
  pontos: PontoMapaAereo[]
  rotas: RotaMapaAereo[]
  selected?: string
  onSelect?: (codigoOuCidade: string) => void
  height?: number
}

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const BRAZIL_CENTER: [number, number] = [-15.5, -52.5]

export function AereoMap({ pontos, rotas, selected, onSelect, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const tileRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return
    let cancelled = false

    ;(async () => {
      try {
        const L: any = await import('leaflet')
        if (cancelled || !containerRef.current || mapRef.current) return

        const dark = document.documentElement.classList.contains('dark')
        const map = L.map(containerRef.current, {
          center: BRAZIL_CENTER,
          zoom: 4,
          zoomControl: true,
          attributionControl: false,
          scrollWheelZoom: false,
        })
        tileRef.current = L.tileLayer(dark ? TILE_DARK : TILE_LIGHT, {
          maxZoom: 18,
          subdomains: 'abcd',
          attribution: 'OSM | CARTO',
        }).addTo(map)
        L.control.attribution({ position: 'bottomright', prefix: false }).addAttribution('OSM | CARTO').addTo(map)

        mapRef.current = map
        setReady(true)
      } catch (err) {
        console.error('[AereoMap] erro:', err)
        setError('Nao foi possivel carregar o mapa.')
      }
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        try { mapRef.current.remove() } catch (error) {
          reportClientFailure('map_cleanup_failed', error, { component: 'aereo-map' })
        }
        mapRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!ready || !mapRef.current) return
    ;(async () => {
      const L: any = await import('leaflet')
      if (layerRef.current) {
        try { layerRef.current.clearLayers(); layerRef.current.remove() } catch (error) {
          reportClientFailure('map_layer_cleanup_failed', error, { component: 'aereo-map' })
        }
      }
      const layer = L.layerGroup()
      layerRef.current = layer

      const maxTotal = Math.max(1, ...pontos.map((ponto) => ponto.total))
      const maxRota = Math.max(1, ...rotas.map((rota) => rota.total))
      const markerRefs: any[] = []

      rotas.slice(0, 40).forEach((rota) => {
        const weight = 1.5 + (rota.total / maxRota) * 7
        const line = L.polyline(
          [
            [rota.origemLat, rota.origemLng],
            [rota.destinoLat, rota.destinoLng],
          ],
          {
            color: '#14b8a6',
            weight,
            opacity: 0.42,
            dashArray: rota.transacoes > 1 ? undefined : '6 8',
          },
        )
        line.bindTooltip(
          `<strong>${escapeHtml(rota.chave)}</strong><br>${money(rota.total)}<br>${rota.transacoes} transacao(oes)`,
          { sticky: true },
        )
        layer.addLayer(line)
      })

      pontos.forEach((ponto) => {
        const isSelected = selected && [ponto.codigo, ponto.cidade].some((item) => item.toLowerCase() === selected.toLowerCase())
        const size = Math.max(24, Math.min(58, 24 + (ponto.total / maxTotal) * 34))
        const html = `
          <button type="button" aria-label="${escapeHtml(ponto.codigo)}" style="
            width:${size}px;height:${size}px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            border:${isSelected ? '4px' : '2px'} solid white;
            background:${isSelected ? '#0f172a' : '#11175f'};
            color:white;font-weight:800;font-size:11px;
            box-shadow:0 8px 22px rgba(17,23,95,.35), 0 0 0 3px rgba(20,184,166,.42);
            cursor:pointer;
          ">${escapeHtml(ponto.codigo)}</button>
        `
        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        })
        const marker = L.marker([ponto.lat, ponto.lng], { icon })
        marker.bindTooltip(
          `<strong>${escapeHtml(ponto.codigo)} - ${escapeHtml(ponto.cidade)}</strong><br>${money(ponto.total)}<br>${ponto.transacoes} passagem(ns)`,
          { direction: 'top', offset: [0, -8], opacity: 1 },
        )
        marker.on('click', () => onSelect?.(ponto.codigo))
        markerRefs.push(marker)
        layer.addLayer(marker)
      })

      layer.addTo(mapRef.current)
      try {
        if (markerRefs.length > 0) {
          const group = L.featureGroup(markerRefs)
          mapRef.current.fitBounds(group.getBounds(), { padding: [28, 28], maxZoom: 6 })
        } else {
          mapRef.current.setView(BRAZIL_CENTER, 4)
        }
      } catch (error) {
        reportClientFailure('map_render_failed', error, { component: 'aereo-map' })
      }
    })()
  }, [onSelect, pontos, ready, rotas, selected])

  return (
    <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
      <div ref={containerRef} style={{ height }} className="w-full" />
      {!ready && !error && (
        <div className="absolute inset-0 z-[401] flex items-center justify-center bg-white/85 text-sm text-slate-500 dark:bg-slate-950/85">
          Carregando mapa aéreo...
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-[401] flex items-center justify-center bg-white/85 text-sm text-slate-500 dark:bg-slate-950/85">
          {error}
        </div>
      )}
    </div>
  )
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
