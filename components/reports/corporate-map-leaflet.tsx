'use client'

import { useEffect, useRef, useState } from 'react'
import { reportClientFailure } from '@/lib/client-observability'
import type { DashboardMapPoint } from '@/lib/reporting/corporate-dashboard'

interface Props {
  pontos: DashboardMapPoint[]
  selected?: string
  onSelect?: (cidade: string) => void
  height?: number
}

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const BRAZIL_CENTER: [number, number] = [-15.5, -52.5]

export function CorporateMapLeaflet({ pontos, selected, onSelect, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
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

        L.tileLayer(dark ? TILE_DARK : TILE_LIGHT, {
          maxZoom: 18,
          subdomains: 'abcd',
          attribution: 'OSM | CARTO',
        }).addTo(map)
        L.control.attribution({ position: 'bottomright', prefix: false }).addAttribution('OSM | CARTO').addTo(map)

        mapRef.current = map
        setReady(true)
      } catch (err) {
        console.error('[CorporateMapLeaflet] erro:', err)
        setError('Não foi possível carregar o mapa.')
      }
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch (error) {
          reportClientFailure('map_cleanup_failed', error, { component: 'corporate-map' })
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
        try {
          layerRef.current.clearLayers()
          layerRef.current.remove()
        } catch (error) {
          reportClientFailure('map_layer_cleanup_failed', error, { component: 'corporate-map' })
        }
      }

      const layer = L.layerGroup()
      layerRef.current = layer
      const maxTotal = Math.max(1, ...pontos.map((ponto) => ponto.total))
      const markers: any[] = []

      pontos.forEach((ponto) => {
        const isSelected = selected && normalizeForCompare(ponto.cidade) === normalizeForCompare(selected)
        const radius = Math.max(8, Math.min(24, 8 + Math.sqrt(ponto.total / maxTotal) * 18))
        const marker = L.circleMarker([ponto.lat, ponto.lng], {
          radius,
          color: '#ffffff',
          weight: isSelected ? 4 : 2,
          fillColor: isSelected ? '#11175f' : '#10beb3',
          fillOpacity: isSelected ? 0.95 : 0.82,
          opacity: 1,
        })

        marker.bindTooltip(
          `<strong>${escapeHtml(ponto.nome)}</strong><br>${money(ponto.total)}<br>${ponto.quantidade} demanda(s)`,
          { direction: 'top', offset: [0, -8], opacity: 1, sticky: true },
        )
        marker.on('click', () => onSelect?.(ponto.cidade))
        markers.push(marker)
        layer.addLayer(marker)
      })

      layer.addTo(mapRef.current)

      try {
        if (markers.length) {
          const group = L.featureGroup(markers)
          mapRef.current.fitBounds(group.getBounds(), { padding: [28, 28], maxZoom: 6 })
        } else {
          mapRef.current.setView(BRAZIL_CENTER, 4)
        }
      } catch (error) {
        reportClientFailure('map_render_failed', error, { component: 'corporate-map' })
      }
    })()
  }, [onSelect, pontos, ready, selected])

  return (
    <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
      <div ref={containerRef} style={{ height }} className="w-full" />
      {!ready && !error && (
        <div className="absolute inset-0 z-[401] flex items-center justify-center bg-white/85 text-sm text-slate-500 dark:bg-slate-950/85">
          Carregando mapa real...
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

function normalizeForCompare(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
