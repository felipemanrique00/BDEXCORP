'use client'
/**
 * OperationalMap — V17
 *
 * Mapa Leaflet do Brasil com:
 *  - Cluster automático (leaflet.markercluster) — agrupa pinos próximos
 *    e expande ao dar zoom. Threshold: acima de 50 cidades simultaneas.
 *  - Tema claro/escuro sincronizado via `bbt-theme` (CARTO Voyager / DarkMatter)
 *  - Pinos custom com pulse animado, halo colorido, badge de contagem
 *  - Tooltip rich, click → callback
 *  - SSR-safe (acesso a window/leaflet só em useEffect)
 *  - Auto-fit bounds ao mudar pontos
 *  - Bounds limitados ao Brasil
 */
import { useEffect, useRef, useState } from 'react'
import { findCityGeo } from '@/lib/br-cities-geo'
import type { TipoServico } from '@/types'

export interface MapPoint {
  city: string
  count: number
  tipo: TipoServico
  highlighted?: boolean
}

interface Props {
  points: MapPoint[]
  selectedCity?: string
  onSelectCity?: (city: string) => void
  height?: number
  /** Liga clustering automatico (default: true acima de 50 pontos) */
  enableClusters?: boolean
}

const BRAZIL_CENTER: [number, number] = [-15.0, -52.0]
const INITIAL_ZOOM = 4

const TIPO_COR: Record<string, string> = {
  'Aéreo': '#0EA5E9',
  'Hotel': '#10B981',
  'Carro': '#F59E0B',
  'Pacote': '#8B5CF6',
  'Outro': '#64748b',
}

// Tile providers — CARTO (sem API key)
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

function getStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return (localStorage.getItem('bbt-theme') === 'dark' ? 'dark' : 'light')
}

export default function OperationalMap({
  points,
  selectedCity,
  onSelectCity,
  height = 360,
  enableClusters,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const clusterGroupRef = useRef<any>(null)
  const fallbackLayerRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getStoredTheme())

  // Sincroniza tema com header
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onThemeChange(e: any) {
      const dark = !!e?.detail?.dark
      setTheme(dark ? 'dark' : 'light')
    }
    function onStorage(e: StorageEvent) {
      if (e.key === 'bbt-theme') setTheme(e.newValue === 'dark' ? 'dark' : 'light')
    }
    // Observer no <html class="dark"> caso o tema mude por outro caminho
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark')
      setTheme(isDark ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    window.addEventListener('bbt-theme-change', onThemeChange as EventListener)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('bbt-theme-change', onThemeChange as EventListener)
      window.removeEventListener('storage', onStorage)
      observer.disconnect()
    }
  }, [])

  // Inicialização do mapa (uma vez)
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return
    let cancelled = false

    ;(async () => {
      try {
        const L: any = await import('leaflet')
        // markercluster registra plugins direto em L.markerClusterGroup
        await import('leaflet.markercluster')

        if (cancelled || !containerRef.current) return
        if (mapRef.current) return

        const map = L.map(containerRef.current, {
          center: BRAZIL_CENTER,
          zoom: INITIAL_ZOOM,
          zoomControl: true,
          attributionControl: false,
          scrollWheelZoom: false,
        })

        // Tile inicial conforme tema
        const initialTile = theme === 'dark' ? TILE_DARK : TILE_LIGHT
        const tile = L.tileLayer(initialTile, {
          maxZoom: 19,
          subdomains: 'abcd',
          attribution: '© OpenStreetMap, © CARTO',
        }).addTo(map)
        tileLayerRef.current = tile

        L.control.attribution({ position: 'bottomright', prefix: false })
          .addAttribution('© OSM | CARTO')
          .addTo(map)

        const brBounds = L.latLngBounds(L.latLng(-34.0, -74.0), L.latLng(6.5, -33.0))
        map.setMaxBounds(brBounds.pad(0.3))

        mapRef.current = map
        setReady(true)
      } catch (e: any) {
        console.error('[OperationalMap] erro init:', e)
        setError('Não foi possível carregar o mapa. Recarregue a página.')
      }
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        try { mapRef.current.remove() } catch {}
        mapRef.current = null
      }
      tileLayerRef.current = null
      clusterGroupRef.current = null
      fallbackLayerRef.current = null
      markersRef.current = []
    }
    // theme não causa reinit aqui — outro effect troca a tile sem reconstruir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || !mapRef.current || !containerRef.current || typeof ResizeObserver === 'undefined') return

    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        mapRef.current?.invalidateSize({ pan: false })
      })
    })

    observer.observe(containerRef.current)
    mapRef.current.invalidateSize({ pan: false })

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ready])

  // Trocar tile quando tema muda
  useEffect(() => {
    if (!ready || !mapRef.current || typeof window === 'undefined') return
    const map = mapRef.current
    let cancelled = false

    ;(async () => {
      const L: any = await import('leaflet')
      if (cancelled || mapRef.current !== map) return

      // remove anterior
      if (tileLayerRef.current) {
        try { tileLayerRef.current.remove() } catch {}
      }
      const url = theme === 'dark' ? TILE_DARK : TILE_LIGHT
      const tile = L.tileLayer(url, {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap, © CARTO',
      })
      if (cancelled || mapRef.current !== map) return
      tile.addTo(map)
      tileLayerRef.current = tile
    })()

    return () => {
      cancelled = true
    }
  }, [theme, ready])

  // Atualizar pinos quando points/selected/onSelect mudam
  useEffect(() => {
    if (!ready || typeof window === 'undefined' || !mapRef.current) return
    const map = mapRef.current
    let cancelled = false

    ;(async () => {
      const L: any = await import('leaflet')
      if (cancelled || mapRef.current !== map) return
      // markercluster já registrado no init

      // Limpa anterior
      if (clusterGroupRef.current) {
        try { clusterGroupRef.current.clearLayers(); clusterGroupRef.current.remove() } catch {}
        clusterGroupRef.current = null
      }
      if (fallbackLayerRef.current) {
        try { fallbackLayerRef.current.clearLayers(); fallbackLayerRef.current.remove() } catch {}
        fallbackLayerRef.current = null
      }
      markersRef.current = []

      const validPoints = points
        .map((p) => ({ p, geo: findCityGeo(p.city) }))
        .filter((x): x is { p: MapPoint; geo: NonNullable<ReturnType<typeof findCityGeo>> } => !!x.geo)

      if (validPoints.length === 0) return

      const useCluster =
        typeof enableClusters === 'boolean' ? enableClusters : validPoints.length > 50

      // Container: cluster ou layerGroup simples
      const container = useCluster
        ? L.markerClusterGroup({
            chunkedLoading: true,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            maxClusterRadius: 60,
            disableClusteringAtZoom: 7,
            iconCreateFunction: (cluster: any) => {
              const total = cluster.getAllChildMarkers().reduce(
                (sum: number, m: any) => sum + (m.options.bbtCount || 1),
                0,
              )
              const childCount = cluster.getChildCount()
              const size = Math.min(64, 36 + childCount * 2.5)
              const isDark = theme === 'dark'
              const html = `
                <div style="
                  position: relative;
                  width: ${size}px; height: ${size}px;
                  display: flex; align-items: center; justify-content: center;
                  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                ">
                  <span style="
                    position: absolute; inset: 0;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(14,165,233,.55) 0%, rgba(14,165,233,.18) 60%, transparent 80%);
                    animation: bbtClusterPulse 2.4s ease-out infinite;
                  "></span>
                  <div style="
                    position: relative;
                    width: ${size - 12}px; height: ${size - 12}px;
                    border-radius: 50%;
                    background: ${isDark
                      ? 'linear-gradient(135deg,#0EA5E9,#0369A1)'
                      : 'linear-gradient(135deg,#06B6D4,#0EA5E9)'};
                    box-shadow: 0 6px 20px rgba(14,165,233,.45),
                                0 0 0 3px ${isDark ? 'rgba(15,23,42,.9)' : 'rgba(255,255,255,.95)'},
                                0 0 0 5px rgba(14,165,233,.6);
                    display: flex; align-items: center; justify-content: center;
                    color: white; font-weight: 800;
                    font-size: ${size > 48 ? '13px' : '12px'};
                  ">${total}</div>
                </div>
              `
              return L.divIcon({
                html,
                className: '',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
              })
            },
          })
        : L.layerGroup()

      validPoints.forEach(({ p, geo }) => {
        const cor = TIPO_COR[p.tipo] || TIPO_COR.Outro
        const tamanho = Math.min(46, 22 + p.count * 2.5)
        const isSelected = p.city.toLowerCase() === (selectedCity || '').toLowerCase()
        const pulse = p.highlighted || p.count >= 5
        const isDark = theme === 'dark'

        const html = `
          <div class="bbt-map-pin" style="
            position: relative;
            width: ${tamanho}px;
            height: ${tamanho}px;
            transform: translate(-50%, -100%);
          ">
            ${pulse ? `<span style="
              position: absolute;
              left: 50%; top: 50%;
              width: ${tamanho}px; height: ${tamanho}px;
              transform: translate(-50%, -50%);
              border-radius: 50%;
              background: ${cor};
              opacity: 0.45;
              animation: bbtMapPulse 2s ease-out infinite;
            "></span>` : ''}
            <div style="
              position: relative;
              width: ${tamanho}px;
              height: ${tamanho}px;
              border-radius: 50%;
              background: ${cor};
              box-shadow: 0 4px 16px ${cor}66,
                          0 0 0 ${isSelected ? '4px' : '2px'} ${isDark ? 'rgba(15,23,42,.95)' : 'rgba(255,255,255,.95)'},
                          0 0 0 ${isSelected ? '6px' : '3px'} ${cor}aa;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: 800;
              font-size: ${tamanho > 32 ? '12px' : '11px'};
              font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
              cursor: pointer;
              transform: ${isSelected ? 'scale(1.1)' : 'scale(1)'};
              transition: transform 180ms ease;
            ">${p.count}</div>
            <div style="
              position: absolute;
              left: 50%;
              top: ${tamanho - 6}px;
              transform: translate(-50%, 0);
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 8px solid ${cor};
            "></div>
          </div>
        `

        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [tamanho, tamanho + 8],
          iconAnchor: [tamanho / 2, tamanho + 8],
        })

        const marker = L.marker([geo.lat, geo.lng], { icon, bbtCount: p.count } as any)

        const tooltipBg = isDark ? '#0f172a' : 'white'
        const tooltipText = isDark ? '#e2e8f0' : '#475569'
        marker.bindTooltip(
          `<div style="font-family: ui-sans-serif, system-ui; font-size:12px; background:${tooltipBg}; color:${tooltipText}; padding:6px 8px; border-radius:6px;">
            <strong style="color:${isDark ? '#67e8f9' : '#071747'}">${geo.nome} (${geo.uf})</strong><br/>
            <span>${p.count} ${p.tipo === 'Hotel' ? 'serviço(s) de hotel' : p.tipo === 'Aéreo' ? 'voo(s)' : p.tipo === 'Carro' ? 'locação(ões)' : 'item(ns)'}</span>
          </div>`,
          { direction: 'top', offset: [0, -8], opacity: 1, sticky: false },
        )

        marker.on('click', () => {
          if (onSelectCity) onSelectCity(p.city)
        })

        container.addLayer(marker)
        markersRef.current.push(marker)
      })

      if (cancelled || mapRef.current !== map) {
        try { container.clearLayers() } catch {}
        return
      }

      if (useCluster) clusterGroupRef.current = container
      else fallbackLayerRef.current = container
      container.addTo(map)

      // Auto fit
      try {
        const group = L.featureGroup(markersRef.current)
        map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 6 })
      } catch {}
    })()

    return () => {
      cancelled = true
    }
  }, [points, ready, selectedCity, onSelectCity, theme, enableClusters])

  return (
    <div className="relative">
      <style>{`
        @keyframes bbtMapPulse {
          0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
        }
        @keyframes bbtClusterPulse {
          0%   { transform: scale(0.92); opacity: 0.7; }
          70%  { opacity: 0.2; }
          100% { transform: scale(1.4);  opacity: 0; }
        }
        .bbt-map-pin { will-change: transform; }
        .leaflet-container { background: #e8f0f7; font-family: inherit; border-radius: inherit; }
        .leaflet-control-attribution { font-size: 10px; padding: 2px 6px; background: rgba(255,255,255,.8); }
        .dark .leaflet-container { background: #0b1220; }
        .dark .leaflet-control-attribution { background: rgba(15,23,42,.8); color: #cbd5e1; }
        .dark .leaflet-control-attribution a { color: #67e8f9 !important; }
        /* MarkerCluster sem o estilo padrão (substituído pelo nosso divIcon) */
        .leaflet-cluster-anim .leaflet-marker-icon, .leaflet-cluster-anim .leaflet-marker-shadow { transition: transform 0.3s ease-out, opacity 0.3s ease-in; }
      `}</style>
      <div
        ref={containerRef}
        style={{ height: `${height}px`, borderRadius: 'inherit' }}
        className="w-full"
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/85 dark:bg-slate-950/85 text-sm text-slate-500 z-[401]">
          {error}
        </div>
      )}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bbt-gray-50 dark:bg-slate-900 text-sm text-slate-500 z-[401]">
          Carregando mapa...
        </div>
      )}
    </div>
  )
}
