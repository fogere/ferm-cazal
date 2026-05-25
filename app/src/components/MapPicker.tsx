import 'leaflet/dist/leaflet.css'
import { useEffect, useState, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polygon } from 'react-leaflet'
import L from 'leaflet'
import { X, Droplets, Square } from 'lucide-react'
import { collection, onSnapshot, query, where } from '../services/firestoreMonitor'
import { db } from '../firebase'
import type { MapPin } from '../types'

/**
 * Picker plein écran pour choisir un point d'eau manuel ou un espace défini
 * sur la carte. Utilisé depuis Tasks.tsx quand on lie une tâche à un élément
 * carte (demande Nils 25/05/2026).
 *
 * Volontairement minimaliste — pas d'édition, pas de filtres, pas de couches
 * météo. Évite de réutiliser Map.tsx (4400 lignes, fragile).
 */

const FARM: [number, number] = [42.9375, 1.7452]
const ZOOM_DEFAULT = 16

const IGN_AERIAL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg'

const IGN_ATTR = '© <a href="https://www.ign.fr/" target="_blank">IGN</a>'

// Icône bleue mise en avant pour les pins cliquables (≠ icône Leaflet par défaut
// qui ne charge pas correctement sans config). On reste sur du divIcon HTML pour
// éviter les soucis de chemin d'asset Vite.
function makeWaterIcon(selected: boolean): L.DivIcon {
  const size = selected ? 44 : 38
  return L.divIcon({
    className: 'map-picker-water-icon',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:#0284C7;border:3px solid ${selected ? '#FBBF24' : '#fff'};
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:${selected ? 22 : 18}px;font-weight:bold;
      box-shadow:0 2px 8px rgba(0,0,0,.4);">💧</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

interface Props {
  kind:     'water_manual' | 'land_plot'
  onPick:   (id: string, name: string) => void
  onCancel: () => void
}

export default function MapPicker({ kind, onPick, onCancel }: Props) {
  const [pins, setPins] = useState<MapPin[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'map_pins'), where('type', '==', kind))
    const unsub = onSnapshot(q, snap =>
      setPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin)))
    )
    return unsub
  }, [kind])

  // Pour land_plot : ne montrer que les espaces actifs (pas les parents scindés).
  const visible = useMemo(
    () => kind === 'land_plot' ? pins.filter(p => !p.inactive) : pins,
    [kind, pins],
  )

  const selected = selectedId ? visible.find(p => p.id === selectedId) ?? null : null

  // Pour land_plot : centre = centroïde approximatif du premier point. Pour
  // water_manual : on garde la vue ferme par défaut.
  const center: [number, number] = useMemo(() => {
    if (visible.length === 0) return FARM
    if (kind === 'water_manual') return FARM
    const p = visible[0]
    if (p.points && p.points.length > 0) return [p.points[0].lat, p.points[0].lng]
    return FARM
  }, [visible, kind])

  function confirmSelection() {
    if (!selected) return
    onPick(selected.id, selected.name || (kind === 'water_manual' ? 'Point d\'eau' : 'Espace'))
  }

  return (
    <div className="fixed inset-0 z-[9500] flex flex-col bg-charcoal">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3 bg-card border-b border-border z-10">
        <div className="w-9 h-9 rounded-xl bg-sky/10 flex items-center justify-center flex-shrink-0">
          {kind === 'water_manual'
            ? <Droplets size={18} className="text-sky" />
            : <Square size={18} className="text-meadow" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-charcoal m-0">
            {kind === 'water_manual' ? 'Choisis un point d\'eau' : 'Choisis un espace'}
          </p>
          <p className="text-[11px] text-muted leading-tight">
            Touche un élément sur la carte, puis valide.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="p-2 rounded-xl text-muted active:bg-cream"
          aria-label="Annuler"
        >
          <X size={20} />
        </button>
      </div>

      {/* Carte */}
      <div className="flex-1 relative">
        <MapContainer
          center={center}
          zoom={ZOOM_DEFAULT}
          maxZoom={20}
          style={{ height: '100%', width: '100%' }}
          zoomControl
        >
          <TileLayer url={IGN_AERIAL} attribution={IGN_ATTR} maxZoom={20} maxNativeZoom={19} />

          {/* Pins water_manual */}
          {kind === 'water_manual' && visible.map(p => (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={makeWaterIcon(selectedId === p.id)}
              eventHandlers={{ click: () => setSelectedId(p.id) }}
            />
          ))}

          {/* Polygons land_plot */}
          {kind === 'land_plot' && visible.map(p => {
            if (!p.points || p.points.length < 3) return null
            const positions = p.points.map(pt => [pt.lat, pt.lng] as [number, number])
            const isSelected = selectedId === p.id
            return (
              <Polygon
                key={p.id}
                positions={positions}
                pathOptions={{
                  color:     isSelected ? '#FBBF24' : '#52B788',
                  fillColor: isSelected ? '#FBBF24' : '#52B788',
                  fillOpacity: isSelected ? 0.4 : 0.2,
                  weight:    isSelected ? 4 : 2,
                }}
                eventHandlers={{ click: () => setSelectedId(p.id) }}
              />
            )
          })}
        </MapContainer>

        {/* État vide */}
        {visible.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card/95 backdrop-blur rounded-2xl px-5 py-4 max-w-xs text-center shadow-xl">
              <p className="text-sm font-semibold text-charcoal mb-1">
                Aucun {kind === 'water_manual' ? 'point d\'eau manuel' : 'espace défini'} sur la carte
              </p>
              <p className="text-[11px] text-muted leading-tight">
                Crée-en un depuis la carte (onglet Map), puis reviens lier la tâche.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer — confirmation */}
      <div className="px-4 py-3 bg-card border-t border-border">
        {selected ? (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-meadow/10 border border-meadow/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-charcoal truncate">✓ {selected.name || 'Sans nom'}</p>
              <p className="text-[10px] text-muted">
                {kind === 'water_manual' ? 'Point d\'eau manuel' : 'Espace défini'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted text-center mb-2">
            Touche un {kind === 'water_manual' ? 'point d\'eau' : 'espace'} sur la carte
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-border text-muted text-sm font-semibold active:bg-cream"
          >
            Annuler
          </button>
          <button
            onClick={confirmSelection}
            disabled={!selected}
            className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold
                       active:scale-95 disabled:opacity-40 transition-all"
          >
            Valider
          </button>
        </div>
      </div>
    </div>
  )
}
