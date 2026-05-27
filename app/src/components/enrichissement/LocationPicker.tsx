import 'leaflet/dist/leaflet.css'
import { useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { X, Check, RotateCcw } from 'lucide-react'

/* ─── tuiles IGN (mêmes URLs que pages/Map.tsx — duplication assumée car
       Map.tsx fait 4400 lignes, on ne va pas y toucher). ─── */
const IGN_AERIAL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg'

const IGN_PARCELS =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng'

const IGN_ATTR = '© <a href="https://www.ign.fr/" target="_blank">IGN</a>'
const FARM: [number, number] = [42.9375, 1.7452]

// Default Leaflet marker icons (sans ça les markers sont cassés sous Vite)
const PIN_ICON = new L.DivIcon({
  className: 'enr-pin-icon',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 1px #000;"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

export type LatLng = { lat: number; lng: number }
export type LocationPickerMode = 'pin' | 'polygon'

export interface LocationPickerProps {
  mode:        LocationPickerMode
  initialValue?: LatLng | LatLng[]
  /** Coordonnées sur lesquelles centrer la carte à l'ouverture (sinon : la ferme) */
  initialCenter?: LatLng
  onConfirm:   (value: LatLng | LatLng[]) => void
  onCancel:    () => void
}

function ClickCapture({ onClick }: { onClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

export default function LocationPicker({ mode, initialValue, initialCenter, onConfirm, onCancel }: LocationPickerProps) {
  const [pin, setPin] = useState<LatLng | null>(
    mode === 'pin' && initialValue && !Array.isArray(initialValue) ? initialValue : null,
  )
  const [polygon, setPolygon] = useState<LatLng[]>(
    mode === 'polygon' && Array.isArray(initialValue) ? initialValue : [],
  )

  const handleClick = (latlng: LatLng) => {
    if (mode === 'pin') setPin(latlng)
    else setPolygon(p => [...p, latlng])
  }

  const undo = () => {
    if (mode === 'polygon') setPolygon(p => p.slice(0, -1))
    else setPin(null)
  }

  const canConfirm = mode === 'pin' ? !!pin : polygon.length >= 2

  const handleConfirm = () => {
    if (mode === 'pin' && pin) onConfirm(pin)
    else if (mode === 'polygon') onConfirm(polygon)
  }

  const center: [number, number] = initialCenter
    ? [initialCenter.lat, initialCenter.lng]
    : pin ? [pin.lat, pin.lng]
    : polygon[0] ? [polygon[0].lat, polygon[0].lng]
    : FARM

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-card border-b border-border">
        <div className="text-sm">
          <div className="font-semibold">
            {mode === 'pin' ? 'Placer un point' : 'Dessiner un contour'}
          </div>
          <div className="text-muted text-xs">
            {mode === 'pin'
              ? 'Tape sur la carte pour placer le repère.'
              : `Tape pour ajouter des points (${polygon.length} placés). Au moins 2 points requis pour une ligne, 3 pour un polygone.`}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={undo}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-bg-muted text-sm">
            <RotateCcw size={14} /> Annuler le dernier
          </button>
          <button onClick={onCancel}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-bg-muted text-sm">
            <X size={14} /> Fermer
          </button>
          <button onClick={handleConfirm}
                  disabled={!canConfirm}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-white text-sm
                              ${canConfirm ? 'bg-forest' : 'bg-bg-muted text-muted'}`}>
            <Check size={14} /> Valider
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <style>{`.leaflet-container { cursor: crosshair !important; }`}</style>
        <MapContainer
          center={center}
          zoom={17}
          maxZoom={22}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url={IGN_AERIAL}
            attribution={IGN_ATTR}
            maxNativeZoom={19}
            maxZoom={22}
          />
          <TileLayer
            url={IGN_PARCELS}
            attribution=""
            maxNativeZoom={20}
            maxZoom={22}
            opacity={0.7}
            zIndex={400}
          />
          <ClickCapture onClick={handleClick} />
          {mode === 'pin' && pin && (
            <Marker position={[pin.lat, pin.lng]} icon={PIN_ICON} />
          )}
          {mode === 'polygon' && polygon.length > 0 && (
            <>
              <Polyline
                positions={polygon.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: '#dc2626', weight: 3 }}
              />
              {polygon.map((p, i) => (
                <Marker key={i}
                        position={[p.lat, p.lng]}
                        icon={new L.DivIcon({
                          className: 'enr-pin-num',
                          html: `<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-weight:700">${i + 1}</div>`,
                          iconSize: [18, 18],
                          iconAnchor: [9, 9],
                        })} />
              ))}
            </>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
