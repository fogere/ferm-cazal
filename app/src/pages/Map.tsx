import 'leaflet/dist/leaflet.css'
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Circle, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Plus, X, Layers, LocateFixed, Trash2, Droplets, Zap, Check, Pencil, Undo2, Scissors, MapPin as MapPinIcon, Camera, Image as ImageIcon, Search } from 'lucide-react'
import { compressImage } from '../services/image'
import type { PinPhoto, EnclosureMovement } from '../types'
import {
  collection, query, where, onSnapshot, addDoc, deleteDoc, getDocs,
  doc, updateDoc, getDoc, setDoc, writeBatch, deleteField,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useLiveLocation } from '../hooks/useLiveLocation'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo } from '../services/species'
import {
  pointInPolygon, insidePolygonCentroid, distToSegmentPx, isFenceClosed,
} from '../services/map/geometry'
import {
  dateInputToTs as dateInputToTsLocal,
  tsToDateInput as tsToDateInputLocal,
  formatAgo, timeAgo, timeUntil,
} from '../services/map/time'
import { healthFreshness, healthDotClass } from '../services/map/health'
import type { MapPin, PinType, UserProfile, FencePreset, Animal } from '../types'

/* ─── ferme ─── */

const FARM: [number, number] = [42.9375, 1.7452]
const ZOOM_DEFAULT = 15

/* ─── tuiles IGN (Géoportail public, sans clé) ─── */

const IGN_AERIAL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg'

const IGN_PLAN =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng'

// Overlay : parcelles cadastrales IGN (PNG transparent, ne montre que les contours)
// Posé en transparence par-dessus l'aérien pour voir les limites de terrain
const IGN_PARCELS =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng'

// Fond de secours OpenStreetMap si IGN ne répond pas
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

const IGN_ATTR = '© <a href="https://www.ign.fr/" target="_blank">IGN</a>'
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

/* ─── config épingles ─── */

const PIN_CFG: Record<PinType, { emoji: string; label: string; color: string }> = {
  water_natural: { emoji: '💧', label: 'Eau naturelle',    color: '#0EA5E9' },
  water_manual:  { emoji: '🪣', label: 'Eau manuelle',     color: '#0284C7' },
  battery:       { emoji: '⚡', label: 'Batterie clôture', color: '#F59E0B' },
  zone:          { emoji: '🐴', label: 'Zone animaux',     color: '#52B788' },
  fence:         { emoji: '🔌', label: 'Clôture',          color: '#EA580C' },
  note:          { emoji: '📍', label: 'Note',             color: '#8B5CF6' },
  alert:         { emoji: '⚠️', label: 'Alerte',           color: '#DC2626' },
}

// Types disponibles dans le formulaire standard (fence a son propre outil de dessin)
const PICKABLE_TYPES: PinType[] = ['water_natural', 'water_manual', 'battery', 'note', 'alert']

/* ─── batteries ─── */

const BATTERY_STATUS_CFG = {
  good:     { label: 'Bon',        color: 'text-meadow',     bg: 'bg-meadow/10   border-meadow/30'  },
  warning:  { label: 'Attention',  color: 'text-sun',        bg: 'bg-sun/10      border-sun/30'     },
  critical: { label: 'Critique',   color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/30' },
  replace:  { label: 'À changer', color: 'text-danger',     bg: 'bg-danger/10   border-danger/30'  },
  down:     { label: 'En panne',   color: 'text-danger',     bg: 'bg-danger/15   border-danger/40'  },
} as const

/* ─── eau naturelle ─── */

const WATER_STATUS_CFG = {
  functional: { label: 'Fonctionnel', color: 'text-sky',   bg: 'bg-sky/10    border-sky/30'   },
  problem:    { label: 'Problème',    color: 'text-sun',   bg: 'bg-sun/10    border-sun/30'   },
  dry:        { label: 'Asséché',     color: 'text-earth', bg: 'bg-earth/10  border-earth/30' },
  frozen:     { label: 'Gelé',        color: 'text-sky',   bg: 'bg-sky/5     border-sky/20'   },
} as const

const AVAIL_MODE_CFG = {
  always:      { label: 'Toujours disponible' },
  seasonal:    { label: 'Saisonnier'          },
  conditional: { label: 'Sur condition'       },
} as const

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc']

// Tri alphabétique des animaux par prénom (locale FR pour gérer accents/casse correctement)
function sortAnimalsByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
}

/* ─── icônes Leaflet ─── */

// Surcharge visuelle des points d'eau naturelle selon leur état.
// Fonctionnel = bleu (couleur de base), asséché = orange, problème = rouge, gelé = noir + glaçon.
// L'emoji goutte reste pour rester reconnaissable, sauf gelé (glaçon).
const WATER_STATUS_VISUAL: Record<
  NonNullable<MapPin['waterStatus']>,
  { bg: string; emoji?: string; badge?: string }
> = {
  functional: { bg: '#0EA5E9' },                       // bleu (PIN_CFG par défaut)
  dry:        { bg: '#EA580C' },                       // orange
  problem:    { bg: '#DC2626' },                       // rouge
  frozen:     { bg: '#111827', emoji: '💧', badge: '🧊' }, // fond noir, goutte + petit glaçon
}

function makeDivIcon(
  type: PinType,
  overdue = false,
  hasPhotos = false,
  waterStatus?: MapPin['waterStatus'],
): L.DivIcon {
  let { emoji, color } = PIN_CFG[type]
  let statusBadge = ''
  if (type === 'water_natural' && waterStatus) {
    const v = WATER_STATUS_VISUAL[waterStatus]
    color = v.bg
    if (v.emoji) emoji = v.emoji
    if (v.badge) {
      // Petit badge en bas à droite (le slot top-right est pris par 📷)
      statusBadge = `<div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;
        background:white;border:2px solid #111827;display:flex;align-items:center;justify-content:center;
        font-size:10px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${v.badge}</div>`
    }
  }
  const border = overdue ? '3px solid #DC2626' : '2.5px solid white'
  const photoBadge = hasPhotos
    ? `<div style="position:absolute;top:-3px;right:-3px;width:16px;height:16px;border-radius:50%;
        background:#1A4731;border:2px solid white;display:flex;align-items:center;justify-content:center;
        font-size:9px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">📷</div>`
    : ''
  return L.divIcon({
    html: `<div style="position:relative;width:38px;height:38px;">
      <div style="background:${color};width:38px;height:38px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;font-size:20px;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);border:${border};">${emoji}</div>
      ${photoBadge}
      ${statusBadge}
    </div>`,
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

// Icône fantôme semi-transparente qui suit le curseur
function makeDivIconGhost(type: PinType): L.DivIcon {
  const { emoji, color } = PIN_CFG[type]
  return L.divIcon({
    html: `<div style="background:${color};width:38px;height:38px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:20px;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);border:2.5px dashed rgba(255,255,255,0.8);
      opacity:0.6;pointer-events:none;">${emoji}</div>`,
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

// Marqueurs de points ciseau (A et B)
const SCISSOR_POINT_ICON = L.divIcon({
  html: `<div style="background:#DC2626;width:16px;height:16px;border-radius:50%;
    border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.55);"></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

// Anneau visuel autour de l'épingle sélectionnée
const SELECTION_RING_ICON = L.divIcon({
  html: `<div class="selection-ring" style="width:54px;height:54px;border-radius:50%;
    border:3px solid #2D6A4F;box-shadow:0 0 0 3px rgba(45,106,79,0.25);
    background:transparent;pointer-events:none;"></div>`,
  className: '',
  iconSize: [54, 54],
  iconAnchor: [27, 27],
})

// Marqueur position GPS d'un membre (cercle coloré avec l'initiale)
function makeUserLocationIcon(color: string, initial: string): L.DivIcon {
  return L.divIcon({
    html: `<div class="user-loc-pulse" style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:${color}30;animation:user-loc-ping 2s ease-out infinite;"></div>
      <div style="position:absolute;inset:6px;border-radius:50%;background:${color};border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;
        color:white;font-weight:bold;font-size:11px;">${initial}</div>
    </div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

// Pointeur temps réel partagé d'un membre (anneau qui converge)
function makePointerIcon(color: string, name: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="position:relative;width:60px;height:60px;pointer-events:none;">
      <div style="position:absolute;inset:0;border-radius:50%;border:3px solid ${color};
        background:${color}15;animation:pointer-pulse 1s ease-out infinite;"></div>
      <div style="position:absolute;left:50%;top:-22px;transform:translateX(-50%);
        background:${color};color:white;font-size:10px;font-weight:bold;padding:2px 8px;
        border-radius:10px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);">
        👆 ${name}
      </div>
    </div>`,
    className: '',
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  })
}

// Petits points sur la clôture en cours de dessin
const FENCE_DOT_ICON = L.divIcon({
  html: `<div style="background:#EA580C;width:10px;height:10px;border-radius:50%;
    border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
  className: '',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
})

// Premier point de la clôture (cible de fermeture)
const FENCE_FIRST_DOT_ICON = L.divIcon({
  html: `<div style="background:#22C55E;width:14px;height:14px;border-radius:50%;
    border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

function makeSnapIcon(isClose: boolean): L.DivIcon {
  const color = isClose ? '#22C55E' : '#F59E0B'
  return L.divIcon({
    html: `<div class="snap-ring" style="width:24px;height:24px;border-radius:50%;
      background:${color};border:3px solid white;
      box-shadow:0 0 0 4px ${color}55;"></div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

const LABEL_ZOOM = 17

function makeEnclosureLabelIcon(
  enclosureAnimals: Animal[],
  zoom: number,
  customSpecies: import('../types').CustomSpecies[] = [],
): L.DivIcon {
  // Couleurs depuis CSS vars → s'adaptent automatiquement light/dark
  let inner: string
  if (enclosureAnimals.length === 0) {
    inner = '<em style="color:var(--color-muted);font-size:10px">Vide</em>'
  } else if (zoom >= LABEL_ZOOM) {
    inner = enclosureAnimals.map(a => {
      const { emoji } = getSpeciesInfo(a.species, customSpecies)
      return `<div style="font-size:10px;font-weight:600;white-space:nowrap;line-height:1.6;color:var(--color-charcoal)">${emoji} ${a.name}</div>`
    }).join('')
  } else {
    // Regroupement par espèce pour le mode zoom-out
    const counts = new Map<string, number>()
    for (const a of enclosureAnimals) counts.set(a.species, (counts.get(a.species) ?? 0) + 1)
    const parts: string[] = []
    for (const [sp, n] of counts) {
      const { emoji } = getSpeciesInfo(sp, customSpecies)
      parts.push(`${n} ${emoji}`)
    }
    inner = `<strong style="font-size:13px;white-space:nowrap;color:var(--color-charcoal)">${parts.join(' · ')}</strong>`
  }
  return L.divIcon({
    html: `<div class="enclosure-label" style="border-radius:10px;padding:5px 9px;
      box-shadow:0 2px 10px rgba(0,0,0,0.35);
      transform:translate(-50%,-50%);display:inline-block;text-align:center;">${inner}</div>`,
    className: '',
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

function isWaterOverdue(pin: MapPin): boolean {
  if (pin.type !== 'water_manual') return false
  const deadline = pin.dueAt ?? pin.nextReminderAt
  return !!(deadline && deadline <= Date.now())
}

function isBatteryDue(pin: MapPin): boolean {
  if (pin.type !== 'battery') return false
  return !!(pin.nextCheckAt && pin.nextCheckAt <= Date.now())
}

/* ─── sous-composants Leaflet ─── */

// Rayon de tolérance en pixels — adapté doigt sur mobile
const SNAP_RADIUS_PX = 44

function MapClickCapture({
  addActive, fenceActive, scissorActive, scissorFenceId, scissorOverridePoints,
  pointerActive, onPointer,
  onPin, onFencePoint, onFenceClose, onSelect, onScissorSnap, onSnapHover,
  fencePins, allPins, fenceFirstPoint,
}: {
  addActive: boolean
  fenceActive: boolean
  scissorActive: boolean
  scissorFenceId: string | null
  scissorOverridePoints: { lat: number; lng: number }[]
  pointerActive: boolean
  onPointer: (lat: number, lng: number) => void
  onPin: (lat: number, lng: number) => void
  onFencePoint: (lat: number, lng: number) => void
  onFenceClose: () => void
  onSelect: (pin: MapPin) => void
  onScissorSnap: (pinId: string, newPoints: { lat: number; lng: number }[], snapIndex: number) => void
  onSnapHover: (target: { lat: number; lng: number; isClose: boolean } | null) => void
  fencePins: MapPin[]
  allPins: MapPin[]
  fenceFirstPoint: { lat: number; lng: number } | null
}) {
  const map = useMap()

  useMapEvents({
    mousemove(e) {
      if (!fenceActive) return
      const movePx = map.latLngToContainerPoint(e.latlng)
      let best: { lat: number; lng: number; isClose: boolean } | null = null
      let bestDist = SNAP_RADIUS_PX

      // Premier point de la clôture courante (fermeture)
      if (fenceFirstPoint) {
        const fp = map.latLngToContainerPoint(L.latLng(fenceFirstPoint.lat, fenceFirstPoint.lng))
        const d  = Math.hypot(movePx.x - fp.x, movePx.y - fp.y)
        if (d < bestDist) { bestDist = d; best = { ...fenceFirstPoint, isClose: true } }
      }
      // Points existants des clôtures sauvegardées
      for (const pin of fencePins) {
        for (const v of pin.points ?? []) {
          const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
          const d  = Math.hypot(movePx.x - vp.x, movePx.y - vp.y)
          if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
        }
      }
      onSnapHover(best)
    },
    mouseout() {
      if (fenceActive) onSnapHover(null)
    },
    click(e) {
      // ── Mode pointer (curseur partagé) : envoie la position aux autres ──
      if (pointerActive) {
        onPointer(e.latlng.lat, e.latlng.lng)
        return
      }
      // ── Mode ciseau : snap sur le fil le plus proche ──
      if (scissorActive) {
        const clickPx  = map.latLngToContainerPoint(e.latlng)
        // On exclut les enclos fillOnly : leur contour visible est déjà géré par des segments enfants
        const targets  = scissorFenceId
          ? fencePins.filter(p => p.id === scissorFenceId)
          : fencePins.filter(p => !p.fillOnly)
        let bestPinId  = ''
        let bestDist   = SNAP_RADIUS_PX
        let bestSeg    = -1
        let bestT      = 0
        let bestPts: { lat: number; lng: number }[] = []

        for (const pin of targets) {
          const pts = (pin.id === scissorFenceId && scissorOverridePoints.length > 0)
            ? scissorOverridePoints : (pin.points ?? [])
          if (pts.length < 2) continue
          for (let i = 0; i < pts.length - 1; i++) {
            const a  = map.latLngToContainerPoint(L.latLng(pts[i].lat, pts[i].lng))
            const b  = map.latLngToContainerPoint(L.latLng(pts[i+1].lat, pts[i+1].lng))
            const dx = b.x - a.x, dy = b.y - a.y
            const len2 = dx*dx + dy*dy
            const t  = len2 > 0
              ? Math.max(0, Math.min(1, ((clickPx.x-a.x)*dx + (clickPx.y-a.y)*dy) / len2))
              : 0
            const d = Math.hypot(clickPx.x - (a.x+t*dx), clickPx.y - (a.y+t*dy))
            if (d < bestDist) { bestDist = d; bestPinId = pin.id; bestSeg = i; bestT = t; bestPts = pts }
          }
        }
        if (!bestPinId || bestSeg < 0) return

        // Interpolation en latlng
        const snapLat = bestPts[bestSeg].lat + bestT * (bestPts[bestSeg+1].lat - bestPts[bestSeg].lat)
        const snapLng = bestPts[bestSeg].lng + bestT * (bestPts[bestSeg+1].lng - bestPts[bestSeg].lng)
        // Vérifier si le snap coïncide avec un point existant (< 5px)
        const snapPx = map.latLngToContainerPoint(L.latLng(snapLat, snapLng))
        const dA = Math.hypot(snapPx.x - map.latLngToContainerPoint(L.latLng(bestPts[bestSeg].lat,   bestPts[bestSeg].lng)).x,
                              snapPx.y - map.latLngToContainerPoint(L.latLng(bestPts[bestSeg].lat,   bestPts[bestSeg].lng)).y)
        const dB = Math.hypot(snapPx.x - map.latLngToContainerPoint(L.latLng(bestPts[bestSeg+1].lat, bestPts[bestSeg+1].lng)).x,
                              snapPx.y - map.latLngToContainerPoint(L.latLng(bestPts[bestSeg+1].lat, bestPts[bestSeg+1].lng)).y)
        const newPoints = [...bestPts]
        let snapIndex: number
        if (dA < 5)      { snapIndex = bestSeg }
        else if (dB < 5) { snapIndex = bestSeg + 1 }
        else             { newPoints.splice(bestSeg + 1, 0, { lat: snapLat, lng: snapLng }); snapIndex = bestSeg + 1 }

        onScissorSnap(bestPinId, newPoints, snapIndex)
        return
      }

      if (fenceActive) {
        // ── Snap vers point existant ou fermeture ──
        const clickPx = map.latLngToContainerPoint(e.latlng)
        let best: { lat: number; lng: number; isClose: boolean } | null = null
        let bestDist = SNAP_RADIUS_PX
        if (fenceFirstPoint) {
          const fp = map.latLngToContainerPoint(L.latLng(fenceFirstPoint.lat, fenceFirstPoint.lng))
          const d  = Math.hypot(clickPx.x - fp.x, clickPx.y - fp.y)
          if (d < bestDist) { bestDist = d; best = { ...fenceFirstPoint, isClose: true } }
        }
        for (const pin of fencePins) {
          for (const v of pin.points ?? []) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
            if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
          }
        }
        if (best) {
          if (best.isClose) { onFenceClose(); return }
          onFencePoint(best.lat, best.lng)
        } else {
          onFencePoint(e.latlng.lat, e.latlng.lng)
        }
        return
      }
      if (addActive)   { onPin(e.latlng.lat, e.latlng.lng);        return }

      // ── Sélection par proximité style Blender ──
      const clickPx = map.latLngToContainerPoint(e.latlng)
      let bestPin: MapPin | null = null
      let bestDist = SNAP_RADIUS_PX

      // 1. Intérieur des polygones fermés (priorité la plus haute)
      for (const pin of fencePins) {
        if (!pin.points || !isFenceClosed(pin)) continue
        if (pointInPolygon(e.latlng.lat, e.latlng.lng, pin.points)) {
          bestPin = pin
          bestDist = -1  // priorité absolue
          break
        }
      }

      if (bestDist >= 0) {
        // 2. Fil de clôture (proximité segment)
        for (const pin of fencePins) {
          if (!pin.points || pin.points.length < 2) continue
          for (let i = 0; i < pin.points.length - 1; i++) {
            const a = map.latLngToContainerPoint(L.latLng(pin.points[i].lat,   pin.points[i].lng))
            const b = map.latLngToContainerPoint(L.latLng(pin.points[i+1].lat, pin.points[i+1].lng))
            const d = distToSegmentPx(clickPx.x, clickPx.y, a.x, a.y, b.x, b.y)
            if (d < bestDist) { bestDist = d; bestPin = pin }
          }
        }
        // 3. Épingles standard
        for (const pin of allPins) {
          if (pin.type === 'fence') continue
          const pos = map.latLngToContainerPoint(L.latLng(pin.lat, pin.lng))
          const d   = Math.hypot(clickPx.x - pos.x, clickPx.y - pos.y)
          if (d < bestDist) { bestDist = d; bestPin = pin }
        }
      }

      if (bestPin) onSelect(bestPin)
    },
  })
  return null
}

// Curseur fantôme : suit la souris en mode ajout
function CursorMarker({ active, type }: { active: boolean; type: PinType }) {
  const [pos, setPos] = useState<[number, number] | null>(null)
  useMapEvents({
    mousemove(e) { if (active) setPos([e.latlng.lat, e.latlng.lng]) },
    mouseout()   { setPos(null) },
  })
  if (!active || !pos) return null
  return <Marker position={pos} icon={makeDivIconGhost(type)} interactive={false} />
}

function FlyHome({ trigger }: { trigger: number }) {
  const map = useMap()
  useEffect(() => {
    if (trigger > 0) map.flyTo(FARM, ZOOM_DEFAULT, { duration: 1 })
  }, [trigger, map])
  return null
}

function FlyToTarget({ target }: { target: { lat: number; lng: number; zoom?: number; key: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], target.zoom ?? 18, { duration: 1 })
  }, [target?.key, map]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend(e) { onZoom((e.target as L.Map).getZoom()) } })
  return null
}

/* ─── formulaire ─── */

interface FormState {
  name: string
  type: PinType
  note: string
  // water_manual
  intervalHours: number
  alertBeforeHours: number
  waterAssignedTo: string
  // water_natural
  availabilityMode: 'always' | 'seasonal' | 'conditional'
  activeMonths: number[]
  waterStatus: 'functional' | 'problem' | 'dry' | 'frozen'
  waterAnimals: string[]
  // battery
  batteryStatus: 'good' | 'warning' | 'critical' | 'replace' | 'down'
  checkIntervalDays: number
  zoneCovered: string
  // zone
  currentOccupants: string[]
}

function blankForm(defaultUid: string): FormState {
  return {
    name: '', type: 'note', note: '',
    intervalHours: 24, alertBeforeHours: 3, waterAssignedTo: defaultUid,
    availabilityMode: 'always', activeMonths: [], waterStatus: 'functional', waterAnimals: [],
    batteryStatus: 'good', checkIntervalDays: 7, zoneCovered: '',
    currentOccupants: [],
  }
}

/* ─── page ─── */

export default function MapPage() {
  const navigate = useNavigate()
  const { user, profile, isTemp } = useAuth()
  // Géoloc partagée : ne s'active QUE pendant que cette page est montée.
  // Évite de pinger Firestore en arrière-plan toute la journée — la position
  // n'est utile qu'aux utilisateurs qui ont la carte ouverte.
  useLiveLocation()

  /* Signal "carte ouverte" : pose `mapOpenAt` + heartbeat 60 s tant que
     cette page est montée. Sert aux autres clients pour décider de publier
     leur position en pull-on-demand (cf. useOnDemandLocationPublish dans App). */
  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid)
    updateDoc(ref, { mapOpenAt: Date.now() }).catch(() => {})
    const beat = setInterval(() => {
      updateDoc(ref, { mapOpenAt: Date.now() }).catch(() => {})
    }, 60_000)
    return () => {
      clearInterval(beat)
      // Nettoie le flag : on n'est plus sur la map.
      updateDoc(ref, { mapOpenAt: deleteField() }).catch(() => {})
    }
  }, [user?.uid])

  // Races personnalisées (chat, mouton…) ajoutées par un admin dans Admin → Animaux.
  const customSpecies = useCustomSpecies()

  const [pins,         setPins]         = useState<MapPin[]>([])
  const [users,        setUsers]        = useState<UserProfile[]>([])
  const [animalGroups, setAnimalGroups] = useState<{ name: string; count: number }[]>([])
  const [layer,        setLayer]        = useState<'aerial' | 'plan' | 'osm'>('aerial')
  // Overlay parcelles cadastrales — persisté dans localStorage, utile pour voir
  // les limites de terrain par-dessus la photo aérienne (demandé par Eugénie pour la PAC)
  const [showParcels, setShowParcels] = useState<boolean>(() => {
    try { return localStorage.getItem('fm_map_parcels') === '1' }
    catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('fm_map_parcels', showParcels ? '1' : '0') }
    catch { /* ignoré */ }
  }, [showParcels])
  const [tileError,    setTileError]    = useState<string | null>(null)
  const [addMode,      setAddMode]      = useState(false)
  const [pendingPos,   setPendingPos]   = useState<{ lat: number; lng: number } | null>(null)
  const [selected,     setSelected]     = useState<MapPin | null>(null)
  const [form,         setForm]         = useState<FormState>(() => blankForm(user?.uid ?? ''))
  const [saving,       setSaving]       = useState(false)
  const [actionBusy,   setActionBusy]   = useState(false)
  const [savingHealth, setSavingHealth] = useState(false)
  const [flyTrigger,   setFlyTrigger]   = useState(0)
  const [editOccupants, setEditOccupants] = useState(false)
  const [pendingOccupants, setPendingOccupants] = useState<string[]>([])

  // États mode clôture
  const [fenceMode,        setFenceMode]        = useState(false)
  const [fencePoints,      setFencePoints]      = useState<{ lat: number; lng: number }[]>([])
  const [fenceFormVisible, setFenceFormVisible] = useState(false)
  const [fenceName,        setFenceName]        = useState('')
  const [fenceNote,        setFenceNote]        = useState('')

  /* Édition d'une clôture existante : drag des poteaux pour corriger le tracé.
     fenceEditPin = pin en cours d'édition (null = hors mode).
     fenceEditPoints = copie de travail des points (commit Firestore au "Valider"). */
  const [fenceEditPin,    setFenceEditPin]    = useState<MapPin | null>(null)
  const [fenceEditPoints, setFenceEditPoints] = useState<{ lat: number; lng: number }[]>([])
  const [fenceEditSaving, setFenceEditSaving] = useState(false)

  // Mode auto (placement poteau-par-poteau via GPS haute précision).
  // 'idle'       : en attente d'un clic "Capturer"
  // 'capturing'  : sampling GPS en cours (avec cercle d'incertitude live)
  // 'adjust'     : capture terminée, l'utilisateur peut affiner par drag sur la photo aérienne
  // 'snap-prompt': demande de lier à un poteau d'une autre clôture
  // 'close-prompt': proposer la fermeture du parc (retour au 1ᵉʳ poteau)
  const [fenceMethod,    setFenceMethod]    = useState<'manual' | 'auto'>('manual')
  const [autoState,      setAutoState]      = useState<'idle' | 'capturing' | 'adjust' | 'snap-prompt' | 'close-prompt'>('idle')
  const [autoSecondsLeft, setAutoSecondsLeft] = useState(0)
  const [autoBestAccuracy, setAutoBestAccuracy] = useState<number | null>(null)
  const [autoSampleCount, setAutoSampleCount] = useState(0)
  const [autoPendingPoint, setAutoPendingPoint] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  // Position live (médiane glissante) pendant le sampling — utilisée pour le cercle d'incertitude.
  const [autoLiveCenter, setAutoLiveCenter] = useState<{ lat: number; lng: number } | null>(null)
  // En mode 'adjust', point modifiable par drag du marqueur sur la carte.
  const [autoAdjustPoint, setAutoAdjustPoint] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  // Si le poteau capturé tombe sur un poteau d'une autre clôture, on stocke la cible et on demande à l'utilisateur
  const [autoSnapCandidate, setAutoSnapCandidate] = useState<{ lat: number; lng: number; sourceName: string } | null>(null)

  // États mode ciseau
  const [scissorMode,         setScissorMode]         = useState(false)
  const [scissorFenceId,      setScissorFenceId]      = useState<string | null>(null)
  const [scissorPoints,       setScissorPoints]       = useState<{ lat: number; lng: number }[]>([])
  const [scissorIndexA,       setScissorIndexA]       = useState<number | null>(null)
  const [scissorIndexB,       setScissorIndexB]       = useState<number | null>(null)
  const [scissorPreset,       setScissorPreset]       = useState<FencePreset | null>(null)
  const [scissorFormVisible,  setScissorFormVisible]  = useState(false)

  // États presets de fil
  const [fencePresets,          setFencePresets]          = useState<FencePreset[]>([])
  const [presetSelectorVisible, setPresetSelectorVisible] = useState(false)
  const [selectedPreset,        setSelectedPreset]        = useState<FencePreset | null>(null)
  const [newPresetForm,         setNewPresetForm]         = useState(false)
  const [newPresetName,         setNewPresetName]         = useState('')
  const [newPresetColor,        setNewPresetColor]        = useState('#EA580C')
  const [newPresetDesc,         setNewPresetDesc]         = useState('')
  const [newPresetStyle,        setNewPresetStyle]        = useState<FencePreset['wireStyle']>('electric')

  // Animaux + zoom + snap
  const [animals,                 setAnimals]                 = useState<Animal[]>([])
  const [mapZoom,                 setMapZoom]                 = useState(ZOOM_DEFAULT)
  const [fenceIsClosed,           setFenceIsClosed]           = useState(false)
  const [fenceSnapTarget,         setFenceSnapTarget]         = useState<{ lat: number; lng: number; isClose: boolean } | null>(null)
  const [editEnclosureAnimals,    setEditEnclosureAnimals]    = useState(false)
  const [pendingEnclosureAnimals, setPendingEnclosureAnimals] = useState<string[]>([])
  // Date + note du mouvement (saisie rétroactive pour calendrier PAC)
  const [pendingMoveDate,         setPendingMoveDate]         = useState<string>('')
  const [pendingMoveNote,         setPendingMoveNote]         = useState<string>('')

  // Suppression preset avec délai
  const [deletingPreset,   setDeletingPreset]   = useState<FencePreset | null>(null)
  const [deleteCountdown,  setDeleteCountdown]  = useState(0)

  // Panneau placement animaux direct
  const [animalPanelOpen,    setAnimalPanelOpen]    = useState(false)
  const [animalPanelEditing, setAnimalPanelEditing] = useState<string | null>(null) // animalId en cours de déplacement

  // Confirmation suppression épingle
  const [confirmDeletePin, setConfirmDeletePin] = useState(false)

  // Recherche d'épingles
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [flyTarget,   setFlyTarget]   = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null)

  // Pointeur temps réel partagé
  const [pointerMode, setPointerMode] = useState(false)
  // Pointeur local immédiat de l'expéditeur (sans round-trip Firestore).
  const [localPointer, setLocalPointer] = useState<{ lat: number; lng: number; at: number } | null>(null)
  const [pointerToast, setPointerToast] = useState(false)

  // Photos attachées aux épingles
  const [pinPhotos,      setPinPhotos]      = useState<PinPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoViewer,    setPhotoViewer]    = useState<PinPhoto | null>(null)

  // Historique mouvements d'animaux (pour enclos sélectionné)
  const [enclosureHistory, setEnclosureHistory] = useState<EnclosureMovement[]>([])
  const [historyVisible,   setHistoryVisible]   = useState(false)
  // Tick interne (1Hz) pour faire disparaître les pointeurs expirés sans nouveau snapshot Firestore
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Vibration mobile quand un autre membre te pointe (Android Chrome)
  // — pas au montage initial : on capture l'état initial sans vibrer
  const lastSeenPointers = useRef<Record<string, number> | null>(null)
  useEffect(() => {
    const fresh: Record<string, number> = {}
    for (const u of users) {
      if (u.uid !== user?.uid && u.livePointer && (Date.now() - u.livePointer.updatedAt) < 60_000) {
        fresh[u.uid] = u.livePointer.updatedAt
      }
    }
    if (lastSeenPointers.current === null) {
      // Premier passage : on enregistre sans vibrer
      lastSeenPointers.current = fresh
      return
    }
    for (const [uid, ts] of Object.entries(fresh)) {
      if (lastSeenPointers.current[uid] !== ts) {
        if ('vibrate' in navigator) {
          try { navigator.vibrate([100, 60, 100]) } catch { /* ignoré */ }
        }
      }
    }
    lastSeenPointers.current = fresh
  }, [users, user?.uid])

  useEffect(() => {
    if (deleteCountdown <= 0) return
    const t = setInterval(() => setDeleteCountdown(n => Math.max(0, n - 1)), 1000)
    return () => clearInterval(t)
  }, [deleteCountdown])

  // Auto-découpage : dès que A, B et preset sont prêts, on coupe (1 seule fois)
  const splittingRef = useRef(false)
  useEffect(() => {
    if (splittingRef.current) return
    if (scissorMode && scissorPreset && scissorIndexA !== null && scissorIndexB !== null && !saving) {
      splittingRef.current = true
      splitFence().finally(() => { splittingRef.current = false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scissorIndexB])

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'map_pins')),
      snap => setPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))),
      err => console.error('[Map] map_pins subscription error:', err.code, err.message)
    )
    const u2 = onSnapshot(
      query(collection(db, 'users')),
      snap => setUsers(snap.docs.map(d => d.data() as UserProfile)),
      err => console.error('[Map] users subscription error:', err.code, err.message)
    )
    getDoc(doc(db, 'config', 'farm')).then(snap => {
      if (snap.exists() && Array.isArray(snap.data().animalGroups)) {
        setAnimalGroups(snap.data().animalGroups)
      }
    }).catch(err => console.warn('[Map] config/farm load:', err?.code ?? err))
    getDoc(doc(db, 'config', 'fencePresets')).then(snap => {
      const saved = snap.exists() && Array.isArray(snap.data().presets)
        ? (snap.data().presets as FencePreset[])
        : []
      if (saved.length > 0) {
        setFencePresets(saved)
      } else {
        const defaults: FencePreset[] = [
          { id: 'preset_electric', name: 'Fil électrique',   color: '#EA580C', description: 'Fil conducteur électrifié', wireStyle: 'electric', createdBy: 'system', createdAt: 0 },
          { id: 'preset_barbed',   name: 'Barbelé',          color: '#6B7280', description: 'Fil barbelé galvanisé',     wireStyle: 'barbed',   createdBy: 'system', createdAt: 0 },
          { id: 'preset_ribbon',   name: 'Ruban électrique', color: '#EAB308', description: 'Ruban polyéthylène 40mm',  wireStyle: 'ribbon',   createdBy: 'system', createdAt: 0 },
          { id: 'preset_plain',    name: 'Fil lisse',        color: '#9CA3AF', description: 'Fil galvanisé simple',     wireStyle: 'plain',    createdBy: 'system', createdAt: 0 },
        ]
        setFencePresets(defaults)
        // Init des presets : réservé aux réguliers. Les rules refuseront sinon.
        if (!isTemp) {
          setDoc(doc(db, 'config', 'fencePresets'), { presets: defaults }).catch(() => {})
        }
      }
    }).catch(err => console.warn('[Map] config/fencePresets load:', err?.code ?? err))
    const u3 = onSnapshot(
      query(collection(db, 'animals')),
      snap => setAnimals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal))),
      err => console.error('[Map] animals subscription error:', err.code, err.message)
    )
    return () => { u1(); u2(); u3() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync selected pin avec Firestore temps réel
  useEffect(() => {
    if (!selected) return
    const updated = pins.find(p => p.id === selected.id)
    if (updated) setSelected(updated)
  }, [pins]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset confirmation suppression + historique quand on change d'épingle
  useEffect(() => {
    setConfirmDeletePin(false)
    setHistoryVisible(false)
    setEnclosureHistory([])
  }, [selected?.id])

  // Historique : abonnement lazy uniquement quand un enclos est sélectionné ET le panneau ouvert
  useEffect(() => {
    if (!selected || !historyVisible) return
    const q = query(
      collection(db, 'enclosure_movements'),
      where('toEnclosureId', '==', selected.id)
    )
    const q2 = query(
      collection(db, 'enclosure_movements'),
      where('fromEnclosureId', '==', selected.id)
    )
    const merged = new Map<string, EnclosureMovement>()
    const u1 = onSnapshot(
      q,
      snap => {
        snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() } as EnclosureMovement))
        setEnclosureHistory(Array.from(merged.values()).sort((a, b) => b.movedAt - a.movedAt))
      },
      err => console.warn('[Map] enclosure_movements(to):', err.code)
    )
    const u2 = onSnapshot(
      q2,
      snap => {
        snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() } as EnclosureMovement))
        setEnclosureHistory(Array.from(merged.values()).sort((a, b) => b.movedAt - a.movedAt))
      },
      err => console.warn('[Map] enclosure_movements(from):', err.code)
    )
    return () => { u1(); u2() }
  }, [selected?.id, historyVisible])

  // Subscription aux photos de l'épingle sélectionnée (lazy : uniquement quand panneau ouvert)
  useEffect(() => {
    if (!selected) { setPinPhotos([]); return }
    const q = query(collection(db, 'pin_photos'), where('pinId', '==', selected.id))
    const unsub = onSnapshot(
      q,
      snap => {
        const photos = snap.docs.map(d => ({ id: d.id, ...d.data() } as PinPhoto))
        photos.sort((a, b) => b.uploadedAt - a.uploadedAt)
        setPinPhotos(photos)
      },
      err => console.warn('[Map] pin_photos subscription:', err.code)
    )
    return unsub
  }, [selected?.id])

  async function uploadPinPhoto(file: File) {
    if (!user || !selected) return
    setPhotoUploading(true)
    try {
      const dataUrl = await compressImage(file, 1280, 0.75)
      // Vérifier la taille (Firestore : 1 MiB par doc, base64 inflate de ~33%)
      if (dataUrl.length > 900_000) {
        alert('Photo trop lourde après compression. Réessayez avec une photo plus petite.')
        return
      }
      await addDoc(collection(db, 'pin_photos'), {
        pinId:      selected.id,
        uploadedBy: user.uid,
        uploadedAt: Date.now(),
        dataUrl,
      })
      // Maintenir le compteur sur le pin pour le badge caméra
      await updateDoc(doc(db, 'map_pins', selected.id), {
        photoCount: (selected.photoCount ?? 0) + 1,
      })
    } catch (err) {
      console.error('[photo]', err)
      alert("Échec de l'envoi de la photo.")
    } finally {
      setPhotoUploading(false)
    }
  }

  async function deletePinPhoto(photoId: string) {
    const photo = pinPhotos.find(p => p.id === photoId)
    await deleteDoc(doc(db, 'pin_photos', photoId))
    if (photoViewer?.id === photoId) setPhotoViewer(null)
    // Décrémenter le compteur sur le pin associé
    if (photo) {
      const parent = pins.find(p => p.id === photo.pinId)
      if (parent) {
        const next = Math.max(0, (parent.photoCount ?? 1) - 1)
        await updateDoc(doc(db, 'map_pins', photo.pinId), { photoCount: next })
      }
    }
  }

  /* ─── actions pin standard ─── */

  function handleMapClick(lat: number, lng: number) {
    setPendingPos({ lat, lng })
    setAddMode(false)
  }

  function cancelAdd() {
    setPendingPos(null)
    setAddMode(false)
    setForm(blankForm(user?.uid ?? ''))
  }

  /* ─── actions clôture ─── */

  function handleFencePoint(lat: number, lng: number) {
    setFencePoints(pts => [...pts, { lat, lng }])
  }

  function undoFencePoint() {
    setFencePoints(pts => pts.slice(0, -1))
  }

  function cancelFence() {
    // Stop tout watcher GPS auto en cours
    autoCancelCapture()
    setFenceMode(false)
    setFencePoints([])
    setFenceFormVisible(false)
    setFenceName('')
    setFenceNote('')
    setSelectedPreset(null)
    setFenceIsClosed(false)
    setFenceSnapTarget(null)
    setFenceMethod('manual')
    setAutoState('idle')
    setAutoPendingPoint(null)
    setAutoSnapCandidate(null)
    setAutoAdjustPoint(null)
    setAutoLiveCenter(null)
  }

  /* ─── Édition d'une clôture existante (déplacement des poteaux) ─── */

  function startEditFence(pin: MapPin) {
    if (!pin.points || pin.points.length < 2) return
    if (isTemp) {
      alert("L'édition de clôture est réservée aux utilisateurs réguliers.")
      return
    }
    setFenceEditPin(pin)
    setFenceEditPoints(pin.points.map(p => ({ ...p })))
    // Ferme les autres panneaux pour libérer la carte
    setSelected(null)
    setEditOccupants(false)
    setEditEnclosureAnimals(false)
  }

  function cancelEditFence() {
    setFenceEditPin(null)
    setFenceEditPoints([])
  }

  // Déplace le point #idx vers (lat, lng). Si le polygone est fermé
  // (dernier === premier), on synchronise les 2 pour garder la fermeture.
  function dragEditPoint(idx: number, lat: number, lng: number) {
    setFenceEditPoints(prev => {
      const next = prev.map((p, i) => i === idx ? { lat, lng } : p)
      // Maintien de la fermeture : si le pin est un enclos fermé, le dernier
      // point doit rester égal au premier après n'importe quel drag.
      if (fenceEditPin && isFenceClosed(fenceEditPin) && next.length >= 2) {
        if (idx === 0) next[next.length - 1] = { lat, lng }
        else if (idx === next.length - 1) next[0] = { lat, lng }
      }
      return next
    })
  }

  // Supprime le point #idx. Refuse si ça casse la géométrie (< 2 pts ouvert, < 3 pts polygone).
  function removeEditPoint(idx: number) {
    if (!fenceEditPin) return
    const closed = isFenceClosed(fenceEditPin)
    setFenceEditPoints(prev => {
      const minPts = closed ? 4 : 2  // polygone fermé doit garder 3 sommets distincts + retour
      if (prev.length <= minPts) {
        alert(closed
          ? "Un enclos fermé doit garder au moins 3 poteaux."
          : "Une clôture doit garder au moins 2 poteaux.")
        return prev
      }
      // Si on supprime le 1ᵉʳ et que le polygone est fermé, le nouveau 1ᵉʳ doit devenir le dernier
      let next = prev.filter((_, i) => i !== idx)
      if (closed && idx === 0 && next.length >= 1) {
        next = [...next, { ...next[0] }]
        next.splice(prev.length - 1, 1) // retire l'ancien dernier
      }
      return next
    })
  }

  async function saveEditFence() {
    if (!fenceEditPin || !user) return
    setFenceEditSaving(true)
    try {
      // Recalcule lat/lng du pin = centroïde des points (utile pour la sélection clic)
      const centerLat = fenceEditPoints.reduce((s, p) => s + p.lat, 0) / fenceEditPoints.length
      const centerLng = fenceEditPoints.reduce((s, p) => s + p.lng, 0) / fenceEditPoints.length
      await updateDoc(doc(db, 'map_pins', fenceEditPin.id), {
        points:    fenceEditPoints,
        lat:       centerLat,
        lng:       centerLng,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      setFenceEditPin(null)
      setFenceEditPoints([])
    } catch (err) {
      console.error('[saveEditFence]', err)
      alert("Échec enregistrement. Réessaye dans un instant.")
    } finally {
      setFenceEditSaving(false)
    }
  }

  /* ─── mode auto : capture poteau via GPS haute précision ─── */

  // Refs pour le watcher GPS — pas dans le state pour éviter de re-render à chaque sample
  const autoWatchIdRef = useRef<number | null>(null)
  const autoSamplesRef = useRef<{ lat: number; lng: number; acc: number }[]>([])
  const autoTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // Distances : seuil de snap sur un poteau existant et seuil de fermeture du parc.
  // 8 m couvre l'imprécision GPS typique en pleine nature (jusqu'à 10-15 m).
  const AUTO_SNAP_M  = 8
  const AUTO_CLOSE_M = 8
  // Durée du sampling pour un poteau (s). Le GPS d'un smartphone met 10-30 s
  // à converger : passer de 5 à 20 s améliore drastiquement la précision réelle.
  const AUTO_SAMPLE_SECONDS = 20
  // On jette les N premières mesures : elles viennent du cache (dernière position
  // connue, souvent obsolète d'avant la marche) avant que le GPS reverrouille.
  const AUTO_WARMUP_SAMPLES = 3
  // Seuil de rejet des outliers en multiples de MAD (median absolute deviation).
  // 2.5 est le standard statistique pour "fortement aberrant".
  const AUTO_MAD_THRESHOLD = 2.5

  function autoCancelCapture() {
    if (autoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(autoWatchIdRef.current)
      autoWatchIdRef.current = null
    }
    if (autoTimerRef.current !== null) {
      clearInterval(autoTimerRef.current)
      autoTimerRef.current = null
    }
    autoSamplesRef.current = []
    setAutoState('idle')
    setAutoSecondsLeft(0)
    setAutoBestAccuracy(null)
    setAutoSampleCount(0)
    setAutoLiveCenter(null)
  }

  // Médiane robuste sur un tableau de nombres (modifie une copie).
  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const n = sorted.length
    if (n === 0) return 0
    return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2]
  }

  function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6_371_000
    const toRad = (d: number) => (d * Math.PI) / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
    return 2 * R * Math.asin(Math.sqrt(x))
  }

  // Cherche un poteau existant (sur n'importe quelle clôture ENREGISTRÉE) à moins
  // de AUTO_SNAP_M de la position. Retourne le premier match avec nom de la clôture parente.
  function findNearbyExistingPost(p: { lat: number; lng: number }): { lat: number; lng: number; sourceName: string } | null {
    for (const pin of pins) {
      if (pin.type !== 'fence' || !pin.points) continue
      for (const pt of pin.points) {
        if (distMeters(pt, p) <= AUTO_SNAP_M) {
          return { lat: pt.lat, lng: pt.lng, sourceName: pin.name }
        }
      }
    }
    return null
  }

  function autoStartCapture() {
    if (!('geolocation' in navigator)) {
      alert('Géolocalisation non disponible sur cet appareil.')
      return
    }
    autoSamplesRef.current = []
    setAutoState('capturing')
    setAutoSecondsLeft(AUTO_SAMPLE_SECONDS)
    setAutoBestAccuracy(null)
    setAutoSampleCount(0)
    setAutoLiveCenter(null)

    const startedAt = Date.now()

    // watchPosition pour collecter plusieurs samples pendant N secondes
    autoWatchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const acc = pos.coords.accuracy
        autoSamplesRef.current.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc,
        })
        const n = autoSamplesRef.current.length
        setAutoSampleCount(n)
        setAutoBestAccuracy(prev => prev === null || acc < prev ? acc : prev)
        // Cercle d'incertitude live : médiane des samples utiles (= après warm-up).
        // Avant que le warm-up soit complet, on affiche la position courante brute
        // pour donner un repère, mais c'est marqué "en cours de calage" dans l'UI.
        const usable = n > AUTO_WARMUP_SAMPLES
          ? autoSamplesRef.current.slice(AUTO_WARMUP_SAMPLES)
          : autoSamplesRef.current
        setAutoLiveCenter({
          lat: median(usable.map(s => s.lat)),
          lng: median(usable.map(s => s.lng)),
        })
      },
      err => {
        console.warn('[autoFence]', err.message)
        autoCancelCapture()
        alert(`GPS indisponible : ${err.message}`)
      },
      // maximumAge: 0 force une nouvelle fix (pas de cache). Plus lent au début
      // mais évite la position "fantôme" d'avant que tu marches.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25_000 },
    )

    // Compteur visuel + arrêt automatique après N secondes
    autoTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      const left = Math.max(0, AUTO_SAMPLE_SECONDS - elapsed)
      setAutoSecondsLeft(left)
      if (elapsed >= AUTO_SAMPLE_SECONDS) {
        if (autoTimerRef.current) clearInterval(autoTimerRef.current)
        autoTimerRef.current = null
        if (autoWatchIdRef.current !== null) navigator.geolocation.clearWatch(autoWatchIdRef.current)
        autoWatchIdRef.current = null
        autoFinalizeCapture()
      }
    }, 200)
  }

  // Termine immédiatement (l'utilisateur trouve la précision déjà bonne)
  function autoFinishEarly() {
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null }
    if (autoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(autoWatchIdRef.current)
      autoWatchIdRef.current = null
    }
    autoFinalizeCapture()
  }

  /* Calcule la position finale via :
     1. Warm-up : on jette les N premières mesures (cache GPS, valeurs obsolètes).
     2. Médiane robuste lat/lng sur les samples restants.
     3. Outlier rejection MAD : on rejette tout sample dont la distance à la médiane
        dépasse 2.5× la déviation absolue médiane (en mètres).
     4. Médiane finale sur le pool nettoyé → position du poteau.
     Beaucoup plus robuste qu'une moyenne pondérée : un seul GPS-jump à 50 m ne
     biaisera plus le résultat. */
  function autoFinalizeCapture() {
    setAutoLiveCenter(null)
    const all = autoSamplesRef.current
    if (all.length === 0) {
      setAutoState('idle')
      alert('Aucun signal GPS reçu. Vérifie : a) Localisation Android = "Précise", b) tu es à découvert (pas sous arbres), c) tiens le téléphone à 1,5 m au-dessus du poteau (pas en contact si poteau métallique → multipath).')
      return
    }
    // 1. Warm-up : on jette les N premières mesures
    let pool = all.length > AUTO_WARMUP_SAMPLES ? all.slice(AUTO_WARMUP_SAMPLES) : all
    // 2. Médiane provisoire
    let medLat = median(pool.map(s => s.lat))
    let medLng = median(pool.map(s => s.lng))
    // 3. MAD (en mètres) + rejet outliers
    const dists = pool.map(s => distMeters({ lat: medLat, lng: medLng }, s))
    const mad = median(dists)
    // Si MAD = 0 (tous samples identiques, rare), on garde tout
    const threshold = mad > 0 ? AUTO_MAD_THRESHOLD * mad : Infinity
    const cleaned = pool.filter((_s, i) => dists[i] <= threshold)
    const finalPool = cleaned.length >= 3 ? cleaned : pool   // garde-fou : minimum 3 samples
    // 4. Médiane finale sur le pool nettoyé
    const finalLat = median(finalPool.map(s => s.lat))
    const finalLng = median(finalPool.map(s => s.lng))
    // Précision = médiane des accuracy des samples gardés
    const finalAcc = Math.round(median(finalPool.map(s => s.acc)))
    const rejected = pool.length - cleaned.length

    console.log('[autoFence] samples=%d warmup=%d kept=%d rejected=%d acc=%dm mad=%.1fm',
      all.length, AUTO_WARMUP_SAMPLES, finalPool.length, rejected, finalAcc, mad)

    const point = { lat: finalLat, lng: finalLng, accuracy: finalAcc }
    setAutoPendingPoint(point)
    setAutoAdjustPoint(point)
    // Étape 1 : on bascule en mode "ajuster" — l'utilisateur peut affiner le point
    // sur la photo aérienne (drag du marqueur) avant validation. Ça compense le
    // décalage éventuel de l'orthophoto IGN (jusqu'à 5-10 m en zone rurale).
    setAutoState('adjust')
  }

  // Mise à jour du point quand l'utilisateur drag le marqueur "adjust"
  function autoOnAdjustDrag(lat: number, lng: number) {
    setAutoAdjustPoint(prev => prev ? { ...prev, lat, lng } : prev)
  }

  // Valide le point ajusté → on déclenche ensuite les prompts snap/close si besoin
  function autoValidateAdjusted() {
    const point = autoAdjustPoint
    if (!point) return
    setAutoPendingPoint(point)

    // 1. Retour près du PREMIER poteau → proposer fermeture
    if (fencePoints.length >= 3) {
      const first = fencePoints[0]
      if (distMeters(first, point) <= AUTO_CLOSE_M) {
        setAutoAdjustPoint(null)
        setAutoState('close-prompt')
        return
      }
    }
    // 2. Sur un poteau existant d'une AUTRE clôture
    const nearby = findNearbyExistingPost(point)
    if (nearby) {
      setAutoSnapCandidate(nearby)
      setAutoAdjustPoint(null)
      setAutoState('snap-prompt')
      return
    }
    // 3. Cas standard
    handleFencePoint(point.lat, point.lng)
    setAutoAdjustPoint(null)
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // Annule le poteau en cours d'ajustement
  function autoCancelAdjust() {
    setAutoAdjustPoint(null)
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // L'utilisateur accepte de lier au poteau existant : on utilise la position exacte du poteau partagé
  function autoLinkToExisting() {
    if (!autoSnapCandidate) return
    handleFencePoint(autoSnapCandidate.lat, autoSnapCandidate.lng)
    setAutoSnapCandidate(null)
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // L'utilisateur préfère un poteau indépendant : on garde la position GPS captée
  function autoCreateIndependentPost() {
    if (!autoPendingPoint) return
    handleFencePoint(autoPendingPoint.lat, autoPendingPoint.lng)
    setAutoSnapCandidate(null)
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // Confirme la fermeture du parc (retour au premier poteau)
  function autoConfirmClose() {
    handleFenceClose()
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // L'utilisateur dit que ce n'est pas la fermeture → on ajoute quand même le point comme nouveau poteau
  function autoDeclineClose() {
    if (!autoPendingPoint) return
    handleFencePoint(autoPendingPoint.lat, autoPendingPoint.lng)
    setAutoPendingPoint(null)
    setAutoState('idle')
  }

  // Cleanup forcé au démontage du composant pour éviter un watchPosition orphelin
  useEffect(() => {
    return () => { autoCancelCapture() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFenceClose() {
    setFencePoints(pts => {
      if (pts.length < 2) return pts
      return [...pts, { ...pts[0] }]
    })
    setFenceIsClosed(true)
    setFenceSnapTarget(null)
    setFenceFormVisible(true)
  }

  async function saveNewPreset() {
    if (!user || !newPresetName.trim()) return
    setSaving(true)
    try {
      const preset: FencePreset = {
        id:          `preset_${Date.now()}`,
        name:        newPresetName.trim(),
        color:       newPresetColor,
        description: newPresetDesc.trim(),
        wireStyle:   newPresetStyle,
        createdBy:   user.uid,
        createdAt:   Date.now(),
      }
      const updated = [...fencePresets, preset]
      await setDoc(doc(db, 'config', 'fencePresets'), { presets: updated })
      setFencePresets(updated)
      setSelectedPreset(preset)
      setNewPresetForm(false)
      setNewPresetName('')
      setNewPresetDesc('')
    } finally {
      setSaving(false)
    }
  }

  function startFenceWithPreset(preset: FencePreset, method: 'manual' | 'auto' = 'manual') {
    setSelectedPreset(preset)
    setPresetSelectorVisible(false)
    setNewPresetForm(false)
    setFenceMethod(method)
    setFenceMode(true)
    setAutoState('idle')
  }

  function askDeletePreset(preset: FencePreset) {
    setDeletingPreset(preset)
    setDeleteCountdown(3)
  }

  async function confirmDeletePreset() {
    if (!deletingPreset) return
    setSaving(true)
    try {
      const updated = fencePresets.filter(p => p.id !== deletingPreset.id)
      await setDoc(doc(db, 'config', 'fencePresets'), { presets: updated })
      setFencePresets(updated)
      if (selectedPreset?.id === deletingPreset.id) setSelectedPreset(null)
    } finally {
      setSaving(false)
      setDeletingPreset(null)
      setDeleteCountdown(0)
    }
  }

  async function updateFenceWireCount(pin: MapPin, delta: number) {
    if (!user) return
    const next = Math.max(1, Math.min(8, (pin.wireCount ?? 1) + delta))
    setActionBusy(true)
    try {
      await updateDoc(doc(db, 'map_pins', pin.id), {
        wireCount: next, updatedAt: Date.now(), updatedBy: user.uid,
      })
    } finally { setActionBusy(false) }
  }

  function handleScissorSnap(pinId: string, newPoints: { lat: number; lng: number }[], snapIndex: number) {
    // Garde anti-réentrée : si la coupe est déjà déclenchée (B posé) ou en cours d'écriture, on ignore
    if (scissorIndexB !== null || saving) return

    if (scissorIndexA === null) {
      // Phase 1 : point A
      setScissorFenceId(pinId)
      setScissorPoints(newPoints)
      setScissorIndexA(snapIndex)
    } else {
      // Phase 2 : point B (même clôture, n'importe où sauf même point)
      if (pinId !== scissorFenceId) return
      if (snapIndex === scissorIndexA) return
      // Si un nouveau point a été inséré AVANT le point A, l'index de A se décale de +1
      const inserted = newPoints.length > scissorPoints.length && snapIndex < scissorIndexA
      const adjustedA = inserted ? scissorIndexA + 1 : scissorIndexA
      setScissorPoints(newPoints)
      setScissorIndexA(Math.min(snapIndex, adjustedA))
      setScissorIndexB(Math.max(snapIndex, adjustedA))
    }
  }

  function cancelScissor() {
    setScissorMode(false)
    setScissorFenceId(null)
    setScissorPoints([])
    setScissorIndexA(null)
    setScissorIndexB(null)
    setScissorPreset(null)
    setScissorFormVisible(false)
  }

  async function splitFence() {
    if (!user || !scissorFenceId || scissorIndexA === null || scissorIndexB === null || !scissorPreset) return
    const originalFence = pins.find(p => p.id === scissorFenceId)
    if (!originalFence) return
    setSaving(true)
    try {
      const now = Date.now()
      const pts = scissorPoints
      const iA  = Math.min(scissorIndexA, scissorIndexB)
      const iB  = Math.max(scissorIndexA, scissorIndexB)

      if (isFenceClosed(originalFence)) {
        // ── Enclos fermé : l'original devient "fill only" (polygon + animaux), le contour est remplacé par de vrais segments ──
        await updateDoc(doc(db, 'map_pins', scissorFenceId), {
          fillOnly: true,
          updatedAt: now,
          updatedBy: user.uid,
        })

        // Créer les segments de contour couvrant tout le périmètre
        type Seg = { points: { lat: number; lng: number }[]; useNewPreset: boolean }
        const enclosureSegs: Seg[] = []
        if (iA > 0)              enclosureSegs.push({ points: pts.slice(0, iA + 1), useNewPreset: false })
                                 enclosureSegs.push({ points: pts.slice(iA, iB + 1), useNewPreset: true  })
        if (iB < pts.length - 1) enclosureSegs.push({ points: pts.slice(iB),        useNewPreset: false })

        for (const seg of enclosureSegs) {
          if (seg.points.length < 2) continue
          const cLat = seg.points.reduce((s, p) => s + p.lat, 0) / seg.points.length
          const cLng = seg.points.reduce((s, p) => s + p.lng, 0) / seg.points.length
          await addDoc(collection(db, 'map_pins'), {
            name:        originalFence.name,
            type:        'fence',
            note:        '',
            lat:         cLat,
            lng:         cLng,
            points:      seg.points,
            presetId:    seg.useNewPreset ? scissorPreset.id    : (originalFence.presetId    ?? null),
            presetColor: seg.useNewPreset ? scissorPreset.color : (originalFence.presetColor ?? '#EA580C'),
            wireCount:   originalFence.wireCount ?? 1,
            cutFromId:   scissorFenceId,
            status:      'ok',
            createdAt:   now,
            createdBy:   user.uid,
            updatedAt:   now,
          })
        }
      } else {
        // ── Clôture ouverte (ou segment-enfant) : découpage classique en 2-3 segments ──
        // Si c'est un segment-enfant d'un enclos, on propage le cutFromId
        const inheritedParent = originalFence.cutFromId ?? null
        type Seg = { points: { lat: number; lng: number }[]; useNewPreset: boolean }
        const segments: Seg[] = []
        if (iA > 0)              segments.push({ points: pts.slice(0, iA + 1), useNewPreset: false })
                                 segments.push({ points: pts.slice(iA, iB + 1), useNewPreset: true  })
        if (iB < pts.length - 1) segments.push({ points: pts.slice(iB),        useNewPreset: false })

        await deleteDoc(doc(db, 'map_pins', scissorFenceId))

        for (const seg of segments) {
          if (seg.points.length < 2) continue
          const cLat = seg.points.reduce((s, p) => s + p.lat, 0) / seg.points.length
          const cLng = seg.points.reduce((s, p) => s + p.lng, 0) / seg.points.length
          const docData: Record<string, unknown> = {
            name:        originalFence.name,
            type:        'fence',
            note:        originalFence.note ?? '',
            lat:         cLat,
            lng:         cLng,
            points:      seg.points,
            presetId:    seg.useNewPreset ? scissorPreset.id    : (originalFence.presetId    ?? null),
            presetColor: seg.useNewPreset ? scissorPreset.color : (originalFence.presetColor ?? '#EA580C'),
            wireCount:   originalFence.wireCount ?? 1,
            status:      'ok',
            createdAt:   now,
            createdBy:   user.uid,
            updatedAt:   now,
          }
          if (inheritedParent) docData.cutFromId = inheritedParent
          await addDoc(collection(db, 'map_pins'), docData)
        }
      }
      cancelScissor()
    } finally { setSaving(false) }
  }

  async function updateFenceVoltage(pin: MapPin, voltage: number | null) {
    if (!user) return
    await updateDoc(doc(db, 'map_pins', pin.id), {
      wireVoltage: voltage ?? null, updatedAt: Date.now(), updatedBy: user.uid,
    })
  }

  async function saveFence() {
    if (!user || !fenceName.trim() || fencePoints.length < 2) return
    // Snapshot des données + fermeture UI immédiate
    const now = Date.now()
    const centerLat = fencePoints.reduce((s, p) => s + p.lat, 0) / fencePoints.length
    const centerLng = fencePoints.reduce((s, p) => s + p.lng, 0) / fencePoints.length
    const payload = {
      name:        fenceName.trim(),
      type:        'fence',
      note:        fenceNote.trim(),
      lat:         centerLat,
      lng:         centerLng,
      points:      fencePoints,
      closed:      fenceIsClosed,
      presetId:    selectedPreset?.id    ?? null,
      presetColor: selectedPreset?.color ?? '#EA580C',
      wireCount:   1,
      status:      'ok',
      createdAt:   now,
      createdBy:   user.uid,
      updatedAt:   now,
    }
    cancelFence()  // ferme tout de suite
    setSaving(true)
    try {
      await addDoc(collection(db, 'map_pins'), payload)
    } catch (err) {
      console.error('[save fence]', err)
      alert('Erreur de sauvegarde clôture. Vérifiez la connexion.')
    } finally {
      setSaving(false)
    }
  }

  /* ─── enregistrer pin standard ─── */

  async function savePin(e: React.FormEvent) {
    e.preventDefault()
    if (!pendingPos || !form.name.trim() || !user) return
    setSaving(true)
    try {
      const now = Date.now()
      const base: Record<string, unknown> = {
        name: form.name.trim(), type: form.type, note: form.note.trim(),
        lat: pendingPos.lat, lng: pendingPos.lng,
        status: 'ok', createdAt: now, createdBy: user.uid, updatedAt: now,
      }

      if (form.type === 'water_manual') {
        const dueAt = now + form.intervalHours * 3_600_000
        Object.assign(base, {
          intervalHours:      form.intervalHours,
          alertBeforeHours:   form.alertBeforeHours,
          assignedTo:         form.waterAssignedTo,
          escalateAfterHours: 4,
          dueAt,
          nextReminderAt:     Math.max(now, dueAt - form.alertBeforeHours * 3_600_000),
          reminderSent:       false,
          lastFilled:         null,
        })
      }

      if (form.type === 'water_natural') {
        Object.assign(base, {
          availabilityMode: form.availabilityMode,
          activeMonths:     form.availabilityMode === 'seasonal' ? form.activeMonths : [],
          waterStatus:      form.waterStatus,
          waterAnimals:     form.waterAnimals,
        })
      }

      if (form.type === 'battery') {
        const nextCheckAt = now + form.checkIntervalDays * 86_400_000
        Object.assign(base, {
          batteryStatus:     form.batteryStatus,
          checkIntervalDays: form.checkIntervalDays,
          zoneCovered:       form.zoneCovered.trim(),
          lastChecked:       null,
          lastCheckedBy:     null,
          nextCheckAt,
        })
      }

      if (form.type === 'zone') {
        Object.assign(base, {
          currentOccupants: form.currentOccupants,
          occupiedSince:    now,
          rotationHistory:  [],
        })
      }

      await addDoc(collection(db, 'map_pins'), base)
      cancelAdd()
    } finally {
      setSaving(false)
    }
  }

  /* ─── eau manuelle : remplir ─── */

  async function fillWaterPoint(pin: MapPin) {
    if (!user) return
    setActionBusy(true)
    try {
      const interval    = pin.intervalHours    ?? 24
      const alertBefore = pin.alertBeforeHours ?? 3
      const now   = Date.now()
      const dueAt = now + interval * 3_600_000
      await updateDoc(doc(db, 'map_pins', pin.id), {
        lastFilled:     now,
        dueAt,
        nextReminderAt: Math.max(now, dueAt - alertBefore * 3_600_000),
        reminderSent:   false,
        status:         'ok',
        updatedAt:      now,
        updatedBy:      user.uid,
      })
    } finally { setActionBusy(false) }
  }

  /* ─── eau naturelle : changer statut ─── */

  async function setWaterNaturalStatus(pin: MapPin, waterStatus: string) {
    if (!user) return
    setActionBusy(true)
    try {
      await updateDoc(doc(db, 'map_pins', pin.id), {
        waterStatus,
        status:    waterStatus === 'functional' ? 'ok' : waterStatus === 'problem' ? 'problem' : 'warning',
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
    } finally { setActionBusy(false) }
  }

  /* ─── batterie : vérifier ─── */

  async function checkBattery(pin: MapPin) {
    if (!user) return
    setActionBusy(true)
    try {
      const now  = Date.now()
      const days = pin.checkIntervalDays ?? 7
      await updateDoc(doc(db, 'map_pins', pin.id), {
        lastChecked:   now,
        lastCheckedBy: user.uid,
        nextCheckAt:   now + days * 86_400_000,
        updatedAt:     now,
        updatedBy:     user.uid,
      })
    } finally { setActionBusy(false) }
  }

  /* ─── batterie : changer statut ─── */

  async function setBatteryStatus(pin: MapPin, status: string) {
    if (!user) return
    setActionBusy(true)
    try {
      const now = Date.now()
      await updateDoc(doc(db, 'map_pins', pin.id), {
        batteryStatus: status,
        status:        status === 'good' ? 'ok' : status === 'down' || status === 'replace' ? 'problem' : 'warning',
        lastChecked:   now,
        lastCheckedBy: user.uid,
        nextCheckAt:   now + (pin.checkIntervalDays ?? 7) * 86_400_000,
        updatedAt:     now,
        updatedBy:     user.uid,
      })
    } finally { setActionBusy(false) }
  }

  /* ─── zone : changer occupants ─── */

  async function saveOccupants(pin: MapPin) {
    if (!user) return
    setActionBusy(true)
    try {
      const now          = Date.now()
      const oldHistory   = pin.rotationHistory ?? []
      const historyEntry = {
        occupants: pin.currentOccupants ?? [],
        from:      pin.occupiedSince ?? pin.createdAt,
        to:        now,
      }
      await updateDoc(doc(db, 'map_pins', pin.id), {
        currentOccupants: pendingOccupants,
        occupiedSince:    now,
        rotationHistory:  [...oldHistory, historyEntry],
        updatedAt:        now,
        updatedBy:        user.uid,
      })
      setEditOccupants(false)
    } finally { setActionBusy(false) }
  }

  // Envoie un pointeur partagé. L'expéditeur voit IMMÉDIATEMENT son pointeur en
  // local (state séparé) sans attendre Firestore : ainsi même si le réseau est
  // lent ou si le snapshot de /users prend du temps à propager, on a un retour
  // visuel instantané et la fonctionnalité reste utilisable.
  // Le Firestore write part en parallèle pour propager aux autres membres.
  async function sendPointer(lat: number, lng: number) {
    if (!user) return
    setPointerMode(false)
    const at = Date.now()
    // 1) Affichage local immédiat (ne dépend pas du round-trip Firestore)
    setLocalPointer({ lat, lng, at })
    setPointerToast(true)
    setTimeout(() => setPointerToast(false), 2000)
    // 2) Propagation aux autres clients via Firestore (fire-and-forget)
    try {
      console.log('[sendPointer] write', { lat, lng, uid: user.uid })
      await updateDoc(doc(db, 'users', user.uid), {
        livePointer: { lat, lng, updatedAt: at },
      })
      console.log('[sendPointer] write OK')
    } catch (err) {
      console.warn('[sendPointer] write FAILED', err)
      const code = (err as { code?: string })?.code
      if (code === 'permission-denied') {
        alert("Pointer envoyé localement, mais ta session a expiré côté serveur. Reconnecte-toi pour que les autres le voient.")
      }
    }
  }

  /* Marque tous les animaux passés en argument comme "vus en bonne santé" maintenant.
     Un seul writeBatch = 1 round-trip réseau. Les rules autorisent les aides à
     mettre à jour ces 2 champs spécifiques (lastCheckedHealthy / lastCheckedHealthyBy). */
  async function markAllHealthy(list: Animal[]) {
    if (!user || list.length === 0) return
    setSavingHealth(true)
    const now = Date.now()
    const batch = writeBatch(db)
    for (const a of list) {
      batch.update(doc(db, 'animals', a.id), {
        lastCheckedHealthy:   now,
        lastCheckedHealthyBy: user.uid,
      })
    }
    try {
      await batch.commit()
    } catch (err) {
      console.error('[markAllHealthy]', err)
      const code = (err as { code?: string })?.code
      alert(code === 'permission-denied'
        ? 'Permissions insuffisantes : ta session a peut-être expiré.'
        : 'Impossible d\'enregistrer le check. Réessayez.')
    } finally {
      setSavingHealth(false)
    }
  }

  async function deletePin(pinId: string) {
    // Gardefou : les utilisateurs temporaires n'ont pas le droit (rules Firestore).
    // On bloque ici aussi pour éviter de lancer un batch qui échouera et générera
    // une erreur "Missing or insufficient permissions" remontée à l'utilisateur.
    if (isTemp) {
      alert("Suppression réservée aux utilisateurs réguliers.")
      return
    }
    // 1. Fermer immédiatement le panneau (UX : pas d'attente perçue)
    setSelected(null)
    setConfirmDeletePin(false)
    // 2. Collecter TOUS les orphelins potentiels avant le batch
    const toFree     = animals.filter(a => a.enclosureId === pinId)
    const childSegs  = pins.filter(p => p.cutFromId === pinId)
    // Photos liées à ce pin (en mémoire si c'était le pin sélectionné, sinon on requête)
    let attachedPhotos: { id: string }[] = pinPhotos.filter(p => p.pinId === pinId)
    if (attachedPhotos.length === 0) {
      try {
        const photoSnap = await getDocs(query(collection(db, 'pin_photos'), where('pinId', '==', pinId)))
        attachedPhotos = photoSnap.docs.map(d => ({ id: d.id }))
      } catch { /* on continue sans les photos */ }
    }
    // 3. Tout dans UN seul batch atomique (1 round-trip réseau)
    const batch = writeBatch(db)
    for (const a of toFree)    batch.update(doc(db, 'animals',    a.id), { enclosureId: null })
    for (const s of childSegs) batch.delete(doc(db, 'map_pins',   s.id))
    for (const p of attachedPhotos) batch.delete(doc(db, 'pin_photos', p.id))
    batch.delete(doc(db, 'map_pins', pinId))
    try {
      await batch.commit()
    } catch (err) {
      console.error('[delete pin]', err)
      const code = (err as { code?: string })?.code
      if (code === 'permission-denied') {
        alert("Permissions insuffisantes : ta session a peut-être expiré. Reconnecte-toi.")
      } else {
        alert('Erreur lors de la suppression. Réessayez quand la connexion est meilleure.')
      }
    }
  }

  async function restoreSingleWire(enclosurePin: MapPin) {
    if (!user) return
    setActionBusy(true)
    try {
      // Supprime tous les segments-enfants de cet enclos
      const childSegs = pins.filter(p => p.cutFromId === enclosurePin.id)
      await Promise.all(childSegs.map(s => deleteDoc(doc(db, 'map_pins', s.id))))
      // Restaure le contour de l'enclos
      await updateDoc(doc(db, 'map_pins', enclosurePin.id), {
        fillOnly: false,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
    } finally { setActionBusy(false) }
  }

  async function saveEnclosureAnimals(fenceId: string) {
    if (!user) return
    // Fermeture UI immédiate — pas d'attente perçue
    setEditEnclosureAnimals(false)

    const now = Date.now()
    const targetEnclosure = pins.find(p => p.id === fenceId)
    // 1 seul writeBatch = 1 round-trip réseau pour tous les changements
    const batch = writeBatch(db)
    let hasChanges = false

    // Date du déplacement : par défaut maintenant, mais l'utilisateur peut
    // l'avoir saisie via le sélecteur "date du mouvement" (rétroactif).
    const movedAtTs = pendingMoveDate ? dateInputToTsLocal(pendingMoveDate) : now

    for (const a of animals) {
      const shouldBe = pendingEnclosureAnimals.includes(a.id)
      const isCurrent = a.enclosureId === fenceId
      if (shouldBe && !isCurrent) {
        batch.update(doc(db, 'animals', a.id), { enclosureId: fenceId })
        const fromEnc = a.enclosureId ? pins.find(p => p.id === a.enclosureId) : null
        const moveRef = doc(collection(db, 'enclosure_movements'))
        batch.set(moveRef, {
          animalId: a.id, animalName: a.name, species: a.species,
          fromEnclosureId: a.enclosureId, fromEnclosureName: fromEnc?.name ?? null,
          toEnclosureId: fenceId,         toEnclosureName: targetEnclosure?.name ?? null,
          movedAt: movedAtTs, movedBy: user.uid,
          recordedAt: now,
          ...(pendingMoveNote.trim() && { note: pendingMoveNote.trim() }),
        })
        hasChanges = true
      }
      if (!shouldBe && isCurrent) {
        batch.update(doc(db, 'animals', a.id), { enclosureId: null })
        const moveRef = doc(collection(db, 'enclosure_movements'))
        batch.set(moveRef, {
          animalId: a.id, animalName: a.name, species: a.species,
          fromEnclosureId: fenceId, fromEnclosureName: targetEnclosure?.name ?? null,
          toEnclosureId: null,      toEnclosureName: null,
          movedAt: movedAtTs, movedBy: user.uid,
          recordedAt: now,
          ...(pendingMoveNote.trim() && { note: pendingMoveNote.trim() }),
        })
        hasChanges = true
      }
    }
    if (!hasChanges) return
    try {
      await batch.commit()
    } catch (err) {
      console.error('[save enclosure animals]', err)
      alert('Erreur lors de l\'enregistrement. Vérifiez la connexion et réessayez.')
    }
  }

  /* ─── helpers render ─── */

  const overduePins  = new Set(pins.filter(p => isWaterOverdue(p) || isBatteryDue(p)).map(p => p.id))
  const fencePins    = pins.filter(p => p.type === 'fence' && (p.points?.length ?? 0) >= 2)
  const nonFencePins = pins.filter(p => p.type !== 'fence' || (p.points?.length ?? 0) < 2)
  const anyModeActive = addMode || fenceMode || scissorMode || pointerMode

  function toggleMonth(m: number) {
    setForm(f => ({
      ...f,
      activeMonths: f.activeMonths.includes(m)
        ? f.activeMonths.filter(x => x !== m)
        : [...f.activeMonths, m],
    }))
  }

  function toggleAnimal(name: string, field: 'waterAnimals' | 'currentOccupants') {
    setForm(f => {
      const arr = f[field] as string[]
      return { ...f, [field]: arr.includes(name) ? arr.filter(x => x !== name) : [...arr, name] }
    })
  }

  function togglePendingOccupant(name: string) {
    setPendingOccupants(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]
    )
  }

  function getFencePathOptions(pin: MapPin): L.PolylineOptions {
    const color   = pin.presetColor ?? '#EA580C'
    const count   = pin.wireCount   ?? 1
    const baseW   = Math.max(2, 1.5 + count * 1.5)
    // Segments issus d'une coupe : un peu plus épais pour bien les voir
    const weight  = pin.cutFromId ? baseW + 1 : baseW
    const preset  = fencePresets.find(p => p.id === pin.presetId)
    const dashArray = preset?.wireStyle === 'barbed' ? '2 6'
                    : preset?.wireStyle === 'ribbon' ? '14 4'
                    : preset?.wireStyle === 'plain'  ? '8 6'
                    : undefined  // electric : ligne continue
    return { color, weight, opacity: 0.9, dashArray }
  }

  /* ─── render ─── */

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>

      {/* Styles globaux carte (curseur, animations snap + sélection + position live + pointeur) */}
      <style>{`
        @keyframes snap-pulse { 0%,100%{transform:scale(1);opacity:0.85} 50%{transform:scale(1.5);opacity:1} }
        .snap-ring { animation: snap-pulse 0.7s ease-in-out infinite; }
        @keyframes selection-pulse {
          0%,100% { transform:scale(1); box-shadow: 0 0 0 3px rgba(45,106,79,0.25); }
          50%     { transform:scale(1.08); box-shadow: 0 0 0 6px rgba(45,106,79,0.12); }
        }
        .selection-ring { animation: selection-pulse 1.4s ease-in-out infinite; }
        @keyframes user-loc-ping {
          0%   { transform: scale(0.8); opacity: 0.6; }
          80%  { transform: scale(2.4); opacity: 0;   }
          100% { transform: scale(2.4); opacity: 0;   }
        }
        @keyframes pointer-pulse {
          0%   { transform: scale(0.7); opacity: 1;   }
          100% { transform: scale(1.4); opacity: 0.2; }
        }
      `}</style>
      {anyModeActive && (
        <style>{`.leaflet-container { cursor: crosshair !important; }`}</style>
      )}

      <MapContainer
        center={FARM}
        zoom={ZOOM_DEFAULT}
        maxZoom={22}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          key={layer}
          url={layer === 'osm' ? OSM_TILES : layer === 'plan' ? IGN_PLAN : IGN_AERIAL}
          attribution={layer === 'osm' ? OSM_ATTR : IGN_ATTR}
          maxNativeZoom={layer === 'osm' ? 19 : 19}
          maxZoom={22}
          eventHandlers={{
            tileloadstart: () => { if (tileError) setTileError(null) },
            tileerror: (e) => {
              const url = (e as unknown as { tile?: HTMLImageElement }).tile?.src ?? ''
              console.warn('[Map] tile error', url)
              setTileError(layer)
            },
          }}
        />

        {/* Overlay parcelles cadastrales IGN — affichage à la demande
            (voir limites officielles de terrain par-dessus l'aérien). */}
        {showParcels && (
          <TileLayer
            key="parcels-overlay"
            url={IGN_PARCELS}
            attribution=""
            maxNativeZoom={20}
            maxZoom={22}
            opacity={0.7}
            zIndex={400}
          />
        )}

        <MapClickCapture
          addActive={addMode}
          // En mode auto, on désactive le tap-pour-ajouter : les points viennent du GPS,
          // pas du toucher. Le toolbar bascule en bouton "Capturer ce poteau".
          fenceActive={fenceMode && fenceMethod === 'manual' && !fenceFormVisible}
          scissorActive={scissorMode && !scissorFormVisible}
          scissorFenceId={scissorFenceId}
          scissorOverridePoints={scissorPoints}
          pointerActive={pointerMode}
          onPointer={sendPointer}
          onPin={handleMapClick}
          onFencePoint={handleFencePoint}
          onFenceClose={handleFenceClose}
          onSelect={pin => { setSelected(pin); setAddMode(false); setFenceMode(false); setEditOccupants(false); setEditEnclosureAnimals(false) }}
          onScissorSnap={handleScissorSnap}
          onSnapHover={setFenceSnapTarget}
          fencePins={fencePins}
          allPins={pins}
          fenceFirstPoint={fenceMode && fenceMethod === 'manual' && fencePoints.length >= 2 ? fencePoints[0] : null}
        />
        <FlyHome trigger={flyTrigger} />
        <FlyToTarget target={flyTarget} />
        <ZoomTracker onZoom={setMapZoom} />

        {/* Curseur fantôme qui suit la souris */}
        {anyModeActive && !fenceFormVisible && (
          <CursorMarker active={true} type={fenceMode ? 'fence' : form.type} />
        )}

        {/* ── Clôtures ── */}
        {/* Passe 1 : remplissage enclos fermés (fill uniquement, zéro stroke) */}
        {fencePins
          .filter(pin => isFenceClosed(pin) && !(scissorMode && pin.id === scissorFenceId))
          .map(pin => (
            <Polygon
              key={pin.id + '-fill'}
              positions={pin.points!.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ stroke: false, weight: 0, opacity: 0, fill: true, fillColor: pin.presetColor ?? '#EA580C', fillOpacity: 0.12 }}
              interactive={false}
            />
          ))}
        {/* Passe 2 : contour des enclos fermés (sauf fillOnly — leur contour est dans des segments séparés) */}
        {fencePins
          .filter(pin => isFenceClosed(pin) && !pin.fillOnly && !(scissorMode && pin.id === scissorFenceId))
          .map(pin => (
            <Polyline
              key={pin.id + '-stroke'}
              positions={pin.points!.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={getFencePathOptions(pin)}
              interactive={false}
            />
          ))}
        {/* Passe 3 : clôtures ouvertes + segments de coupe — toujours par-dessus */}
        {fencePins
          .filter(pin => !isFenceClosed(pin) && !(scissorMode && pin.id === scissorFenceId))
          .map(pin => (
            <Polyline
              key={pin.id}
              positions={pin.points!.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={getFencePathOptions(pin)}
              interactive={false}
            />
          ))}

        {/* Labels animaux dans les enclos fermés — position GARANTIE à l'intérieur du polygone */}
        {fencePins
          .filter(pin => isFenceClosed(pin) && !(scissorMode && pin.id === scissorFenceId))
          .map(pin => {
            const enc = sortAnimalsByName(animals.filter(a => a.enclosureId === pin.id))
            const labelPos = pin.points ? insidePolygonCentroid(pin.points) : { lat: pin.lat, lng: pin.lng }
            return (
              <Marker
                key={`label-${pin.id}`}
                position={[labelPos.lat, labelPos.lng]}
                icon={makeEnclosureLabelIcon(enc, mapZoom, customSpecies)}
                interactive={false}
              />
            )
          })}

        {/* Aperçu ciseau : visualisation du tronçon découpé */}
        {scissorMode && scissorFenceId && scissorPoints.length > 0 && scissorIndexA !== null && (() => {
          const origColor = fencePins.find(p => p.id === scissorFenceId)?.presetColor ?? '#EA580C'
          // Couleur du tronçon découpé : preset choisi sinon jaune vif pour ressortir
          const previewColor = scissorPreset?.color ?? '#FBBF24'
          return (
            <>
              {/* Tronçon avant A — atténué */}
              {scissorIndexA > 0 && (
                <Polyline
                  positions={scissorPoints.slice(0, scissorIndexA + 1).map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: origColor, weight: 2, opacity: 0.4, dashArray: '4 4' }}
                  interactive={false}
                />
              )}
              {/* Tronçon A→B — bien visible avec couleur du futur fil */}
              {scissorIndexB !== null
                ? <Polyline
                    positions={scissorPoints.slice(scissorIndexA, scissorIndexB + 1).map(p => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: previewColor, weight: 6, opacity: 1 }}
                    interactive={false}
                  />
                : /* Clôture entière en attendant le 2e point */
                  <Polyline
                    positions={scissorPoints.map(p => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: origColor, weight: 2, opacity: 0.55 }}
                    interactive={false}
                  />
              }
              {/* Tronçon après B — atténué */}
              {scissorIndexB !== null && scissorIndexB < scissorPoints.length - 1 && (
                <Polyline
                  positions={scissorPoints.slice(scissorIndexB).map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: origColor, weight: 2, opacity: 0.4, dashArray: '4 4' }}
                  interactive={false}
                />
              )}
              {/* Marqueurs A et B */}
              <Marker position={[scissorPoints[scissorIndexA].lat, scissorPoints[scissorIndexA].lng]}
                      icon={SCISSOR_POINT_ICON} interactive={false} />
              {scissorIndexB !== null && (
                <Marker position={[scissorPoints[scissorIndexB].lat, scissorPoints[scissorIndexB].lng]}
                        icon={SCISSOR_POINT_ICON} interactive={false} />
              )}
            </>
          )
        })()}

        {/* Clôture en cours de dessin */}
        {fenceMode && fencePoints.length > 0 && (
          <>
            {fenceIsClosed ? (
              <Polygon
                positions={fencePoints.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: selectedPreset?.color ?? '#EA580C', weight: 3, dashArray: '9 5', opacity: 0.85, fillOpacity: 0.15 }}
              />
            ) : (
              <Polyline
                positions={fencePoints.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: selectedPreset?.color ?? '#EA580C', weight: 3, dashArray: '9 5', opacity: 0.7 }}
              />
            )}
            {fencePoints.map((p, i) => (
              <Marker
                key={i}
                position={[p.lat, p.lng]}
                icon={i === 0 && fencePoints.length >= 2 ? FENCE_FIRST_DOT_ICON : FENCE_DOT_ICON}
                interactive={false}
              />
            ))}
          </>
        )}

        {/* ── Édition d'une clôture existante : aperçu live + markers draggables ── */}
        {fenceEditPin && fenceEditPoints.length > 0 && (
          <>
            {isFenceClosed(fenceEditPin) ? (
              <Polygon
                positions={fenceEditPoints.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{
                  color: fenceEditPin.presetColor ?? '#EA580C',
                  weight: 3,
                  dashArray: '6 4',
                  opacity: 0.9,
                  fillColor: fenceEditPin.presetColor ?? '#EA580C',
                  fillOpacity: 0.1,
                }}
                interactive={false}
              />
            ) : (
              <Polyline
                positions={fenceEditPoints.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{
                  color: fenceEditPin.presetColor ?? '#EA580C',
                  weight: 3,
                  dashArray: '6 4',
                  opacity: 0.9,
                }}
                interactive={false}
              />
            )}
            {fenceEditPoints.map((p, i) => {
              // Si fermé : on cache le doublon final (qui colle au 1er)
              const closed = isFenceClosed(fenceEditPin)
              if (closed && i === fenceEditPoints.length - 1) return null
              return (
                <Marker
                  key={`edit-${i}`}
                  position={[p.lat, p.lng]}
                  icon={i === 0 ? FENCE_FIRST_DOT_ICON : FENCE_DOT_ICON}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => {
                      const ll = e.target.getLatLng()
                      dragEditPoint(i, ll.lat, ll.lng)
                    },
                    dblclick: () => removeEditPoint(i),
                  }}
                />
              )
            })}
          </>
        )}

        {/* Indicateur snap (point magnétique) */}
        {fenceMode && fenceSnapTarget && (
          <Marker
            position={[fenceSnapTarget.lat, fenceSnapTarget.lng]}
            icon={makeSnapIcon(fenceSnapTarget.isClose)}
            interactive={false}
          />
        )}

        {/* Cercle d'incertitude pendant la capture GPS auto */}
        {fenceMode && fenceMethod === 'auto' && autoState === 'capturing' && autoLiveCenter && (
          <>
            <Circle
              center={[autoLiveCenter.lat, autoLiveCenter.lng]}
              radius={Math.max(2, autoBestAccuracy ?? 15)}
              pathOptions={{
                color: '#1A4731', weight: 2, opacity: 0.7,
                fillColor: '#1A4731', fillOpacity: 0.10,
              }}
              interactive={false}
            />
            <Marker
              position={[autoLiveCenter.lat, autoLiveCenter.lng]}
              icon={FENCE_DOT_ICON}
              interactive={false}
            />
          </>
        )}

        {/* Marqueur draggable pendant la phase d'ajustement post-capture */}
        {fenceMode && fenceMethod === 'auto' && autoState === 'adjust' && autoAdjustPoint && (
          <>
            <Circle
              center={[autoAdjustPoint.lat, autoAdjustPoint.lng]}
              radius={Math.max(2, autoAdjustPoint.accuracy)}
              pathOptions={{
                color: '#EA580C', weight: 2, opacity: 0.6, dashArray: '5 4',
                fillColor: '#EA580C', fillOpacity: 0.08,
              }}
              interactive={false}
            />
            <Marker
              position={[autoAdjustPoint.lat, autoAdjustPoint.lng]}
              icon={FENCE_FIRST_DOT_ICON}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng()
                  autoOnAdjustDrag(ll.lat, ll.lng)
                },
              }}
            />
          </>
        )}

        {/* Épingles standard — non-interactives, sélection via proximité */}
        {nonFencePins.map(pin => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makeDivIcon(pin.type, overduePins.has(pin.id), (pin.photoCount ?? 0) > 0, pin.waterStatus)}
            interactive={false}
          />
        ))}

        {/* Anneau de sélection autour de l'épingle/clôture sélectionnée */}
        {selected && (
          <Marker
            position={[selected.lat, selected.lng]}
            icon={SELECTION_RING_ICON}
            interactive={false}
            zIndexOffset={500}
          />
        )}

        {/* Position en attente de confirmation */}
        {pendingPos && (
          <Marker position={[pendingPos.lat, pendingPos.lng]} icon={makeDivIcon(form.type)} />
        )}

        {/* Positions GPS partagées des membres (incluant soi-même) */}
        {users
          .filter(u => u.liveLocation && (now - (u.liveLocation.updatedAt ?? 0)) < 10 * 60_000)
          .map(u => (
            <Marker
              key={`live-${u.uid}`}
              position={[u.liveLocation!.lat, u.liveLocation!.lng]}
              icon={makeUserLocationIcon(u.color || '#2D6A4F', (u.displayName || '?').charAt(0).toUpperCase())}
              interactive={false}
              zIndexOffset={300}
            />
          ))}

        {/* Pointeurs partagés des AUTRES utilisateurs (depuis Firestore).
            Le sien à soi est rendu séparément via localPointer (cf. en dessous)
            pour avoir un retour visuel IMMÉDIAT sans attendre le round-trip Firestore. */}
        {users
          .filter(u => u.uid !== user?.uid
            && u.livePointer
            && (now - (u.livePointer.updatedAt ?? 0)) < 60_000)
          .map(u => (
            <Marker
              key={`ptr-${u.uid}-${u.livePointer!.updatedAt}`}
              position={[u.livePointer!.lat, u.livePointer!.lng]}
              icon={makePointerIcon(u.color || '#2D6A4F', u.displayName || '?')}
              interactive={false}
              zIndexOffset={600}
            />
          ))}

        {/* Pointeur LOCAL de l'expéditeur (affichage immédiat, indépendant de Firestore) */}
        {localPointer && (now - localPointer.at) < 60_000 && (
          <Marker
            key={`ptr-local-${localPointer.at}`}
            position={[localPointer.lat, localPointer.lng]}
            icon={makePointerIcon(profile?.color || '#2D6A4F', `${profile?.displayName ?? 'toi'} (toi)`)}
            interactive={false}
            zIndexOffset={600}
          />
        )}
      </MapContainer>

      {/* ── Bandeau mode pointer (curseur partagé) ── */}
      {pointerMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]
                        bg-sky text-white text-sm font-semibold px-4 py-2.5 rounded-2xl
                        shadow-lg flex items-center gap-2">
          <MapPinIcon size={16} /> Touchez la carte pour pointer
          <button onClick={() => setPointerMode(false)} className="ml-1 opacity-70 active:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Toast confirmation envoi pointer (2s) ── */}
      {pointerToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001]
                        bg-meadow text-white text-sm font-semibold px-4 py-2 rounded-2xl
                        shadow-lg flex items-center gap-2 animate-fade-in">
          <Check size={14} /> Pointer envoyé à la famille
        </div>
      )}

      {/* ── Bandeau mode ajout ── */}
      {addMode && !pendingPos && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]
                        bg-forest text-white text-sm font-semibold px-4 py-2.5 rounded-2xl
                        shadow-lg flex items-center gap-2">
          <Plus size={16} /> Appuyez sur la carte
          <button onClick={cancelAdd} className="ml-1 opacity-70 active:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Bandeau d'erreur tuiles (auto-affiché si tuiles ne chargent pas) ── */}
      {tileError && !fenceMode && !pointerMode && !scissorMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]
                        bg-sun text-earth text-xs font-semibold px-3 py-2 rounded-2xl
                        shadow-lg flex items-center gap-2 max-w-[92vw]">
          <span>⚠ Fond de carte indisponible</span>
          <button
            onClick={() => { setLayer('osm'); setTileError(null) }}
            className="px-2 py-0.5 rounded-lg bg-white text-earth text-xs font-bold active:scale-95"
          >
            Passer à OSM
          </button>
          <button onClick={() => setTileError(null)} className="opacity-60 active:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Barre d'outils clôture (mode manuel) ── */}
      {fenceMode && fenceMethod === 'manual' && !fenceFormVisible && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]
                        text-white rounded-2xl shadow-xl
                        px-3 py-2.5 flex items-center gap-2 max-w-[92vw]"
             style={{ backgroundColor: selectedPreset?.color ?? '#EA580C' }}>
          <span className="text-sm font-semibold whitespace-nowrap">
            {fenceSnapTarget?.isClose
              ? '🟢 Relâcher pour fermer'
              : fenceSnapTarget
              ? '🟡 Snap vers un pilier'
              : selectedPreset ? `${selectedPreset.name} · ` : '🔌 '}
            {!fenceSnapTarget && (fencePoints.length === 0
              ? 'Appuyez pour ajouter un point'
              : `${fencePoints.length} pt${fencePoints.length > 1 ? 's' : ''}`)}
          </span>
          {fencePoints.length > 0 && (
            <button
              onClick={undoFencePoint}
              className="p-1.5 rounded-lg bg-white/20 active:bg-white/40 transition-colors"
              title="Annuler dernier point"
            >
              <Undo2 size={14} />
            </button>
          )}
          {fencePoints.length >= 2 && (
            <button
              onClick={() => setFenceFormVisible(true)}
              className="px-3 py-1.5 rounded-lg bg-white text-orange-600 text-xs font-bold
                         active:scale-95 transition-all whitespace-nowrap"
            >
              Nommer →
            </button>
          )}
          <button
            onClick={cancelFence}
            className="p-1.5 rounded-lg bg-white/20 active:bg-white/40 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Barre d'outils clôture (mode auto GPS) ── */}
      {fenceMode && fenceMethod === 'auto' && !fenceFormVisible && autoState !== 'snap-prompt' && autoState !== 'close-prompt' && autoState !== 'adjust' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                        text-white rounded-2xl shadow-xl px-4 py-3"
             style={{ backgroundColor: selectedPreset?.color ?? '#1A4731' }}>
          {autoState === 'idle' ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold leading-tight">
                  📍 Mode auto
                  {fencePoints.length > 0 && (
                    <span className="ml-1 text-xs font-semibold opacity-90">· {fencePoints.length} poteau{fencePoints.length > 1 ? 'x' : ''}</span>
                  )}
                </p>
                <button onClick={cancelFence} className="p-1.5 rounded-lg bg-white/20 active:bg-white/40">
                  <X size={14} />
                </button>
              </div>
              <p className="text-[11px] opacity-90 leading-snug">
                {fencePoints.length === 0
                  ? 'Place le téléphone sur le 1ᵉʳ poteau, puis capture.'
                  : 'Déplace-toi au poteau suivant, puis capture. Si tu reviens au 1ᵉʳ, on te proposera de fermer le parc.'}
              </p>
              <button
                onClick={autoStartCapture}
                className="w-full py-3 rounded-xl bg-white text-charcoal text-sm font-bold
                           active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                📍 Capturer ce poteau ({AUTO_SAMPLE_SECONDS}s)
              </button>
              {fencePoints.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={undoFencePoint}
                    className="flex-1 py-2 rounded-lg bg-white/20 text-xs font-semibold active:bg-white/30
                               flex items-center justify-center gap-1"
                    title="Signaler une erreur sur le dernier poteau"
                  >
                    <Undo2 size={12} /> Signaler erreur
                  </button>
                  {fencePoints.length >= 3 && (
                    <button
                      onClick={() => { handleFenceClose() }}
                      className="flex-1 py-2 rounded-lg bg-white text-charcoal text-xs font-bold active:scale-95"
                    >
                      Fermer le parc
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : autoState === 'capturing' ? (
            <div className="space-y-2.5 text-center">
              <p className="text-sm font-bold">📡 Capture GPS en cours…</p>
              <div className="text-4xl font-bold tabular-nums">{autoSecondsLeft.toFixed(1)}s</div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-200"
                  style={{ width: `${100 * (1 - autoSecondsLeft / AUTO_SAMPLE_SECONDS)}%` }}
                />
              </div>
              <p className="text-[11px] opacity-90">
                {autoSampleCount} mesure{autoSampleCount > 1 ? 's' : ''}
                {autoBestAccuracy !== null && ` · meilleure précision : ${Math.round(autoBestAccuracy)} m`}
              </p>
              {autoSampleCount > AUTO_WARMUP_SAMPLES && (
                <p className="text-[10px] opacity-80 italic">
                  Cercle vert sur la carte = position estimée live
                </p>
              )}
              {autoSampleCount <= AUTO_WARMUP_SAMPLES && (
                <p className="text-[10px] opacity-80 italic">
                  ⏳ Warm-up… (on jette les {AUTO_WARMUP_SAMPLES} 1ères mesures, souvent en cache)
                </p>
              )}
              <div className="flex gap-2">
                {/* Permet à l'utilisateur de finir tôt si la précision est déjà excellente */}
                {autoBestAccuracy !== null && autoBestAccuracy < 5 && autoSampleCount > AUTO_WARMUP_SAMPLES + 3 && (
                  <button
                    onClick={autoFinishEarly}
                    className="flex-1 py-2 rounded-lg bg-white text-charcoal text-xs font-bold active:scale-95"
                  >
                    ✓ Stop, précision OK
                  </button>
                )}
                <button
                  onClick={autoCancelCapture}
                  className="flex-1 py-2 rounded-lg bg-white/20 text-xs font-semibold active:bg-white/30"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Phase d'ajustement (drag du marqueur sur la photo aérienne) ── */}
      {fenceMode && fenceMethod === 'auto' && autoState === 'adjust' && autoAdjustPoint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                        text-white rounded-2xl shadow-xl px-4 py-3 space-y-2.5"
             style={{ backgroundColor: '#1A4731' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">🎯 Ajuste si nécessaire</p>
            <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">
              ±{autoAdjustPoint.accuracy} m
            </span>
          </div>
          <p className="text-[11px] opacity-90 leading-snug">
            Position GPS captée. Si elle ne tombe pas pile sur le poteau réel sur la photo aérienne
            (décalage IGN possible en zone rurale), <strong>glisse le point orange</strong> sur la carte
            pour le caler. Sinon valide directement.
          </p>
          <div className="flex gap-2">
            <button
              onClick={autoValidateAdjusted}
              className="flex-1 py-2.5 rounded-xl bg-white text-charcoal text-sm font-bold active:scale-95"
            >
              ✓ Valider ce poteau
            </button>
            <button
              onClick={autoCancelAdjust}
              className="px-3 py-2.5 rounded-xl bg-white/20 text-xs font-semibold active:bg-white/30"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Barre d'outils édition d'une clôture existante ── */}
      {fenceEditPin && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                        text-white rounded-2xl shadow-xl px-4 py-3 space-y-2.5"
             style={{ backgroundColor: fenceEditPin.presetColor ?? '#EA580C' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold leading-tight">
              ✏️ Édition — {fenceEditPin.name}
              <span className="ml-1 text-xs font-semibold opacity-90">
                · {fenceEditPoints.length} poteau{fenceEditPoints.length > 1 ? 'x' : ''}
              </span>
            </p>
            <button
              onClick={cancelEditFence}
              className="p-1.5 rounded-lg bg-white/20 active:bg-white/40"
              aria-label="Annuler l'édition"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-[11px] opacity-90 leading-snug">
            <strong>Glisse un poteau</strong> pour le repositionner.
            <strong> Double-tap</strong> sur un poteau pour le supprimer.
            Les changements ne sont pris en compte qu'au «&nbsp;Valider&nbsp;».
          </p>
          <div className="flex gap-2">
            <button
              onClick={saveEditFence}
              disabled={fenceEditSaving}
              className="flex-1 py-2.5 rounded-xl bg-white text-charcoal text-sm font-bold
                         active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Check size={14} /> {fenceEditSaving ? '…' : 'Valider le nouveau tracé'}
            </button>
            <button
              onClick={cancelEditFence}
              className="px-3 py-2.5 rounded-xl bg-white/20 text-xs font-semibold active:bg-white/30"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Prompt : snap vers un poteau existant ── */}
      {autoState === 'snap-prompt' && autoSnapCandidate && autoPendingPoint && (
        <div className="fixed inset-0 z-[1500] bg-charcoal/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-2xl">🔗</span>
              <div>
                <p className="text-sm font-bold text-charcoal">Poteau déjà présent à proximité</p>
                <p className="text-xs text-muted mt-1">
                  Tu es à moins de {AUTO_SNAP_M} m d'un poteau de «&nbsp;{autoSnapCandidate.sourceName}&nbsp;».
                  Veux-tu relier les deux clôtures à ce poteau, ou créer un poteau indépendant&nbsp;?
                </p>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <button
                onClick={autoLinkToExisting}
                className="w-full py-3 rounded-xl bg-forest text-white text-sm font-bold active:scale-95
                           flex items-center justify-center gap-2"
              >
                🔗 Relier au poteau existant (recommandé)
              </button>
              <button
                onClick={autoCreateIndependentPost}
                className="w-full py-3 rounded-xl border border-border bg-cream text-charcoal text-sm font-semibold active:bg-card"
              >
                Créer un poteau indépendant ici
              </button>
              <button
                onClick={() => { setAutoSnapCandidate(null); setAutoPendingPoint(null); setAutoState('idle') }}
                className="w-full py-2 rounded-xl text-xs text-muted active:bg-cream"
              >
                Annuler ce poteau
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Prompt : retour au premier poteau, proposer la fermeture ── */}
      {autoState === 'close-prompt' && autoPendingPoint && (
        <div className="fixed inset-0 z-[1500] bg-charcoal/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-2xl">🎯</span>
              <div>
                <p className="text-sm font-bold text-charcoal">Retour au premier poteau ?</p>
                <p className="text-xs text-muted mt-1">
                  Tu es à moins de {AUTO_CLOSE_M} m du poteau de départ. Si tu as fait le tour du parc,
                  on peut le fermer maintenant.
                </p>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <button
                onClick={autoConfirmClose}
                className="w-full py-3 rounded-xl bg-forest text-white text-sm font-bold active:scale-95
                           flex items-center justify-center gap-2"
              >
                ✓ Oui, fermer le parc
              </button>
              <button
                onClick={autoDeclineClose}
                className="w-full py-3 rounded-xl border border-border bg-cream text-charcoal text-sm font-semibold active:bg-card"
              >
                Non, ajouter un poteau ici quand même
              </button>
              <button
                onClick={() => { setAutoPendingPoint(null); setAutoState('idle') }}
                className="w-full py-2 rounded-xl text-xs text-muted active:bg-cream"
              >
                Annuler ce poteau
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Contrôles (couches + parcelles + recentrage + recherche) ── */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
        <button
          onClick={() => setLayer(l => l === 'aerial' ? 'plan' : l === 'plan' ? 'osm' : 'aerial')}
          title="Changer de fond de carte (Aérien IGN → Plan IGN → OSM)"
          className="bg-card/95 backdrop-blur-sm shadow-lg rounded-xl p-3 active:scale-95 transition-all"
        >
          <Layers size={20} className="text-forest" />
        </button>
        <button
          onClick={() => setShowParcels(v => !v)}
          title={showParcels ? 'Masquer les parcelles cadastrales' : 'Afficher les parcelles cadastrales IGN'}
          aria-pressed={showParcels}
          className={`backdrop-blur-sm shadow-lg rounded-xl p-3 active:scale-95 transition-all
            ${showParcels ? 'bg-forest text-white' : 'bg-card/95 text-forest'}`}
        >
          {/* Picto "parcelles" : carré quadrillé. On utilise un SVG inline plutôt
              qu'une icône Lucide pour rester compact et lisible. */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </button>
        <button
          onClick={() => setFlyTrigger(n => n + 1)}
          className="bg-card/95 backdrop-blur-sm shadow-lg rounded-xl p-3 active:scale-95 transition-all"
          title="Recentrer sur la ferme"
        >
          <LocateFixed size={20} className="text-forest" />
        </button>
        <button
          onClick={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery('') }}
          className={`backdrop-blur-sm shadow-lg rounded-xl p-3 active:scale-95 transition-all ${
            searchOpen ? 'bg-forest text-white' : 'bg-card/95'
          }`}
          title="Rechercher une épingle par nom"
        >
          <Search size={20} className={searchOpen ? 'text-white' : 'text-forest'} />
        </button>
      </div>

      {/* ── Panneau recherche (déroulant au top-center) ── */}
      {searchOpen && (
        <div className="absolute top-4 left-4 right-20 z-[1000] flex flex-col gap-1.5 max-w-md">
          <div className="flex items-center gap-2 bg-card/95 backdrop-blur-sm shadow-lg rounded-xl px-3 py-2.5">
            <Search size={16} className="text-muted flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher : bac, batterie, enclos…"
              className="flex-1 bg-transparent outline-none text-sm text-charcoal min-w-0"
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted p-1 active:text-charcoal">
                <X size={14} />
              </button>
            )}
          </div>
          {searchQuery.trim().length > 0 && (() => {
            const q = searchQuery.trim().toLowerCase()
            const results = pins
              .filter(p => p.name && p.name.toLowerCase().includes(q))
              .slice(0, 8)
            return (
              <div className="bg-card/95 backdrop-blur-sm shadow-lg rounded-xl max-h-[50vh] overflow-y-auto">
                {results.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted italic">Aucune épingle trouvée pour « {searchQuery.trim()} »</p>
                ) : (
                  <ul>
                    {results.map(p => {
                      const cfg = PIN_CFG[p.type]
                      return (
                        <li key={p.id}>
                          <button
                            onClick={() => {
                              setFlyTarget({ lat: p.lat, lng: p.lng, zoom: p.type === 'fence' ? 17 : 19, key: Date.now() })
                              setSelected(p)
                              setSearchOpen(false)
                              setSearchQuery('')
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-cream transition-colors border-b border-border/40 last:border-0"
                          >
                            <span className="text-base flex-shrink-0">{cfg.emoji}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-charcoal truncate">{p.name}</p>
                              <p className="text-xs text-muted">{cfg.label}</p>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })()}
        </div>
      )}


      {/* ── Boutons flottants (FAB) ── */}
      {!addMode && !pendingPos && !selected && !fenceMode && !scissorMode && !pointerMode && (
        <div className="absolute bottom-6 right-4 z-[1000] flex flex-col gap-3 items-end">
          <button
            onClick={() => setPointerMode(true)}
            className="bg-sky text-white rounded-2xl px-4 py-3 shadow-lg
                       active:scale-95 transition-all flex items-center gap-2"
            title="Pointer un endroit pour les autres"
          >
            <MapPinIcon size={18} />
            <span className="text-sm font-semibold">Pointer</span>
          </button>
          <button
            onClick={() => setPresetSelectorVisible(true)}
            className="bg-orange-500 text-white rounded-2xl px-4 py-3 shadow-lg
                       active:scale-95 transition-all flex items-center gap-2"
          >
            <Pencil size={18} />
            <span className="text-sm font-semibold">Clôture</span>
          </button>
          <button
            onClick={() => {
              setScissorMode(true)
              setScissorPreset(null)
              setScissorFormVisible(true)
            }}
            className="bg-rose-600 text-white rounded-2xl px-4 py-3 shadow-lg
                       active:scale-95 transition-all flex items-center gap-2"
          >
            <Scissors size={18} />
            <span className="text-sm font-semibold">Couper</span>
          </button>
          <button
            onClick={() => setAddMode(true)}
            className="bg-forest text-white rounded-2xl p-4 shadow-xl active:scale-95 transition-all"
          >
            <Plus size={24} />
          </button>
        </div>
      )}

      {/* ── Bas gauche : bouton animaux + indicateur couche ── */}
      <div className="absolute bottom-6 left-4 z-[1001] flex flex-col items-start gap-2">
        {/* Bouton 🐾 — toujours en premier (le plus haut dans la colonne) */}
        {animals.length > 0 && !fenceMode && !addMode && !pendingPos && (
          <button
            onClick={() => { setAnimalPanelOpen(true); setAnimalPanelEditing(null) }}
            className="text-white rounded-2xl px-4 py-3 shadow-xl active:scale-95 transition-all flex items-center gap-2"
            style={{ backgroundColor: '#15803d' }}
          >
            <span className="text-base leading-none">🐾</span>
            <span className="text-sm font-semibold">
              Animaux
              {animals.filter(a => a.enclosureId === null).length > 0 && (
                <span className="ml-1.5 bg-sun text-earth text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {animals.filter(a => a.enclosureId === null).length}
                </span>
              )}
            </span>
          </button>
        )}
        {/* Badge animaux non placés — couleurs explicites + bordure pour rester
            lisible aussi en dark mode au-dessus d'une photo aérienne sombre. */}
        {animals.filter(a => a.enclosureId === null).length > 0 && !addMode && !fenceMode && !scissorMode && (
          <div
            className="rounded-xl px-3 py-1.5 shadow-md border"
            style={{ backgroundColor: '#FACC15', borderColor: '#92400E' }}
          >
            <span className="text-xs font-bold" style={{ color: '#3B2106' }}>
              ⚠ {animals.filter(a => a.enclosureId === null).length} non placé{animals.filter(a => a.enclosureId === null).length > 1 ? 's' : ''}
            </span>
          </div>
        )}
        {/* Indicateur couche — tout en bas */}
        <div className="bg-card/90 backdrop-blur-sm rounded-xl px-3 py-1.5 shadow-md">
          <span className="text-xs font-semibold text-muted">
            {layer === 'aerial' ? '📷 Aérien IGN' : layer === 'plan' ? '🗺 Plan IGN' : '🌍 OSM'}
            {showParcels && <span className="ml-1 text-forest">+ parcelles</span>}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          Sheet : placement direct des animaux
      ══════════════════════════════════════════ */}
      {animalPanelOpen && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => setAnimalPanelOpen(false)} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[85vh] overflow-y-auto">

            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-charcoal text-lg font-bold m-0">🐾 Placement des animaux</h2>
                <p className="text-xs text-muted mt-0.5">
                  {animals.filter(a => a.enclosureId === null).length > 0
                    ? `${animals.filter(a => a.enclosureId === null).length} animal(aux) non placé(s)`
                    : 'Tous les animaux sont placés ✓'}
                </p>
              </div>
              <button onClick={() => setAnimalPanelOpen(false)}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>

            {/* Liste des enclos disponibles */}
            {(() => {
              const closedFences = fencePins.filter(p => isFenceClosed(p))
              return (
                <>
                  {closedFences.length === 0 && (
                    <div className="bg-sun/10 border border-sun/30 rounded-xl p-4 mb-4 text-center">
                      <p className="text-sm font-semibold text-earth mb-1">Aucun enclos fermé sur la carte</p>
                      <p className="text-xs text-muted">
                        Dessinez une clôture et fermez-la en rapprochant le dernier point
                        du premier point vert — un enclos apparaîtra automatiquement.
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {animals.map(animal => {
                      const currentFence = fencePins.find(p => p.id === animal.enclosureId)
                      const isEditing = animalPanelEditing === animal.id

                      return (
                        <div key={animal.id} className="rounded-xl border border-border bg-cream overflow-hidden">
                          {/* En-tête animal — clic sur le nom = fiche complète */}
                          <div className="flex items-center gap-3 px-4 py-3">
                            <button
                              onClick={() => { setAnimalPanelOpen(false); navigate(`/animal/${animal.id}`) }}
                              className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
                              title="Voir la fiche complète"
                            >
                              <span className="text-2xl flex-shrink-0">
                                {getSpeciesInfo(animal.species, customSpecies).emoji}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-charcoal">{animal.name}</p>
                                <p className="text-xs text-muted">
                                  {currentFence
                                    ? <span className="text-forest font-semibold">📍 {currentFence.name}</span>
                                    : <span className="text-sun font-semibold">⚠ Non placé</span>}
                                </p>
                              </div>
                            </button>
                            <button
                              onClick={() => setAnimalPanelEditing(isEditing ? null : animal.id)}
                              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                                isEditing
                                  ? 'bg-forest/20 text-forest'
                                  : 'bg-forest text-white active:opacity-80'
                              }`}
                            >
                              {isEditing ? '✕ Fermer' : 'Déplacer'}
                            </button>
                          </div>

                          {/* Sélecteur d'enclos */}
                          {isEditing && (
                            <div className="border-t border-border px-4 py-3 bg-white space-y-2">
                              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                                Choisir un enclos
                              </p>
                              {closedFences.length === 0 ? (
                                <p className="text-xs text-muted italic">Aucun enclos fermé disponible.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {closedFences.map(fence => (
                                    <button
                                      key={fence.id}
                                      disabled={actionBusy}
                                      onClick={async () => {
                                        setActionBusy(true)
                                        try {
                                          await updateDoc(doc(db, 'animals', animal.id), { enclosureId: fence.id })
                                          setAnimalPanelEditing(null)
                                        } finally { setActionBusy(false) }
                                      }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-95 ${
                                        animal.enclosureId === fence.id
                                          ? 'border-forest bg-forest/10'
                                          : 'border-border bg-cream'
                                      }`}
                                    >
                                      <div className="w-3 h-3 rounded-full flex-shrink-0"
                                           style={{ background: fence.presetColor ?? '#52B788' }} />
                                      <span className="text-sm font-semibold text-charcoal flex-1">{fence.name}</span>
                                      <span className="text-xs text-muted">
                                        {animals.filter(a => a.enclosureId === fence.id).length} animaux
                                      </span>
                                      {animal.enclosureId === fence.id && (
                                        <span className="text-forest text-xs font-bold">✓ Ici</span>
                                      )}
                                    </button>
                                  ))}
                                  {/* Option : libérer l'animal */}
                                  {animal.enclosureId && (
                                    <button
                                      disabled={actionBusy}
                                      onClick={async () => {
                                        setActionBusy(true)
                                        try {
                                          await updateDoc(doc(db, 'animals', animal.id), { enclosureId: null })
                                          setAnimalPanelEditing(null)
                                        } finally { setActionBusy(false) }
                                      }}
                                      className="w-full px-3 py-2 rounded-xl border border-dashed border-danger/40 text-danger/70 text-xs font-semibold active:bg-danger/5 transition-colors"
                                    >
                                      Retirer de l'enclos
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Sheet : formulaire nouvelle épingle standard
      ══════════════════════════════════════════ */}
      {pendingPos && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={cancelAdd} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-charcoal text-lg font-bold m-0">Nouvelle épingle</h2>
              <button onClick={cancelAdd} className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              {pendingPos.lat.toFixed(5)}, {pendingPos.lng.toFixed(5)}
            </p>

            <form onSubmit={savePin} className="space-y-4">

              {/* Nom */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Nom *</label>
                <input
                  type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Ruisseau du bas, Batterie nord…"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent"
                  autoFocus required disabled={saving}
                />
              </div>

              {/* Type (sans fence) */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {PICKABLE_TYPES.map(t => (
                    <button key={t} type="button"
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        form.type === t ? 'border-forest bg-forest/10 text-forest' : 'border-border bg-cream text-muted'
                      }`} disabled={saving}>
                      <span>{PIN_CFG[t].emoji}</span>
                      <span className="text-xs leading-tight">{PIN_CFG[t].label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Champs eau manuelle ── */}
              {form.type === 'water_manual' && (
                <>
                  <FormSection label="Intervalle de remplissage">
                    <div className="flex gap-2">
                      {[12, 24, 48, 72].map(h => (
                        <button key={h} type="button"
                          onClick={() => setForm(f => ({ ...f, intervalHours: h }))}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                            form.intervalHours === h ? 'border-sky text-sky bg-sky/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{h}h</button>
                      ))}
                    </div>
                  </FormSection>

                  <FormSection label="Rappel avant l'échéance">
                    <div className="flex gap-2">
                      {[1, 2, 3, 6].map(h => (
                        <button key={h} type="button"
                          onClick={() => setForm(f => ({ ...f, alertBeforeHours: h }))}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                            form.alertBeforeHours === h ? 'border-meadow text-meadow bg-meadow/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{h}h avant</button>
                      ))}
                    </div>
                  </FormSection>

                  <FormSection label="Responsable">
                    <div className="flex gap-2 flex-wrap">
                      {users.map(u => (
                        <button key={u.uid} type="button"
                          onClick={() => setForm(f => ({ ...f, waterAssignedTo: u.uid }))}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                            form.waterAssignedTo === u.uid ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                style={{ backgroundColor: u.color }}>{u.displayName.charAt(0)}</span>
                          {u.displayName}
                        </button>
                      ))}
                    </div>
                  </FormSection>
                </>
              )}

              {/* ── Champs eau naturelle ── */}
              {form.type === 'water_natural' && (
                <>
                  <FormSection label="Disponibilité">
                    <div className="flex flex-col gap-1.5">
                      {(Object.entries(AVAIL_MODE_CFG) as [string, { label: string }][]).map(([k, v]) => (
                        <button key={k} type="button"
                          onClick={() => setForm(f => ({ ...f, availabilityMode: k as FormState['availabilityMode'] }))}
                          className={`py-2.5 px-3 rounded-xl border text-sm font-semibold text-left transition-all ${
                            form.availabilityMode === k ? 'border-sky text-sky bg-sky/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{v.label}</button>
                      ))}
                    </div>
                  </FormSection>

                  {form.availabilityMode === 'seasonal' && (
                    <FormSection label="Mois actifs">
                      <div className="grid grid-cols-4 gap-1.5">
                        {MONTHS_FR.map((m, i) => (
                          <button key={i} type="button"
                            onClick={() => toggleMonth(i)}
                            className={`py-2 rounded-xl border text-xs font-semibold transition-all ${
                              form.activeMonths.includes(i) ? 'border-sky text-sky bg-sky/10' : 'border-border text-muted bg-cream'
                            }`} disabled={saving}>{m}</button>
                        ))}
                      </div>
                    </FormSection>
                  )}

                  <FormSection label="Statut actuel">
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.entries(WATER_STATUS_CFG) as [string, { label: string }][]).map(([k, v]) => (
                        <button key={k} type="button"
                          onClick={() => setForm(f => ({ ...f, waterStatus: k as FormState['waterStatus'] }))}
                          className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                            form.waterStatus === k ? 'border-sky text-sky bg-sky/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{v.label}</button>
                      ))}
                    </div>
                  </FormSection>

                  {animalGroups.length > 0 && (
                    <FormSection label="Animaux concernés">
                      <div className="flex flex-wrap gap-1.5">
                        {animalGroups.filter(g => g.name !== 'Tout le troupeau').map(g => (
                          <button key={g.name} type="button"
                            onClick={() => toggleAnimal(g.name, 'waterAnimals')}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                              form.waterAnimals.includes(g.name) ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                            }`} disabled={saving}>{g.name} ({g.count})</button>
                        ))}
                      </div>
                    </FormSection>
                  )}
                </>
              )}

              {/* ── Champs batterie ── */}
              {form.type === 'battery' && (
                <>
                  <FormSection label="Statut actuel">
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.entries(BATTERY_STATUS_CFG) as [string, { label: string }][]).map(([k, v]) => (
                        <button key={k} type="button"
                          onClick={() => setForm(f => ({ ...f, batteryStatus: k as FormState['batteryStatus'] }))}
                          className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                            form.batteryStatus === k ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{v.label}</button>
                      ))}
                    </div>
                  </FormSection>

                  <FormSection label="Zone couverte">
                    <input type="text" value={form.zoneCovered}
                      onChange={e => setForm(f => ({ ...f, zoneCovered: e.target.value }))}
                      placeholder="ex: Pré nord, Clôture est…"
                      className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                                 placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent"
                      disabled={saving} />
                  </FormSection>

                  <FormSection label="Vérification tous les X jours">
                    <div className="flex gap-2">
                      {[7, 14, 30].map(d => (
                        <button key={d} type="button"
                          onClick={() => setForm(f => ({ ...f, checkIntervalDays: d }))}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                            form.checkIntervalDays === d ? 'border-sun text-earth bg-sun/10' : 'border-border text-muted bg-cream'
                          }`} disabled={saving}>{d}j</button>
                      ))}
                    </div>
                  </FormSection>
                </>
              )}

              {/* ── Champs zone animaux ── */}
              {form.type === 'zone' && animalGroups.length > 0 && (
                <FormSection label="Occupants actuels">
                  <div className="flex flex-wrap gap-1.5">
                    {animalGroups.map(g => (
                      <button key={g.name} type="button"
                        onClick={() => toggleAnimal(g.name, 'currentOccupants')}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                          form.currentOccupants.includes(g.name) ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                        }`} disabled={saving}>{g.name} ({g.count})</button>
                    ))}
                  </div>
                  {form.currentOccupants.length > 0 && (
                    <p className="text-xs text-forest font-medium mt-2">
                      ✓ {form.currentOccupants.join(', ')}
                    </p>
                  )}
                </FormSection>
              )}

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Note (optionnel)</label>
                <textarea value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="Informations supplémentaires…"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent resize-none"
                  disabled={saving} />
              </div>

              <button type="submit" disabled={saving || !form.name.trim()}
                className="w-full py-4 rounded-xl font-semibold text-white text-base bg-forest
                           active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-lg">
                {saving ? 'Enregistrement…' : "Placer l'épingle"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Barre d'outils ciseau ── */}
      {scissorMode && !scissorFormVisible && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]
                        bg-rose-600 text-white rounded-2xl shadow-xl
                        px-3 py-2.5 flex items-center gap-2 max-w-[94vw]">
          <Scissors size={15} className="flex-shrink-0" />
          {/* Preset chip cliquable pour changer */}
          {scissorPreset && (
            <button
              onClick={() => setScissorFormVisible(true)}
              className="flex items-center gap-1.5 bg-white/15 active:bg-white/30 rounded-lg px-2 py-1 transition-colors"
              title="Changer le type de fil"
            >
              <div className="w-3 h-3 rounded-full" style={{ background: scissorPreset.color }} />
              <span className="text-xs font-semibold whitespace-nowrap">{scissorPreset.name}</span>
            </button>
          )}
          <span className="text-sm font-semibold whitespace-nowrap">
            {!scissorPreset
              ? 'Choisir un fil...'
              : scissorIndexA === null
                ? '→ Tapez le 1er point'
                : scissorIndexB === null
                  ? '→ Tapez le 2e point'
                  : 'Découpage…'}
          </span>
          {scissorIndexA !== null && scissorIndexB === null && (
            <button
              onClick={() => { setScissorFenceId(null); setScissorPoints([]); setScissorIndexA(null); setScissorIndexB(null) }}
              className="p-1.5 rounded-lg bg-white/20 active:bg-white/40 text-sm font-bold"
              title="Recommencer"
            >↺</button>
          )}
          <button onClick={cancelScissor} className="p-1.5 rounded-lg bg-white/20 active:bg-white/40">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Sheet : choix du type de fil pour la coupe
      ══════════════════════════════════════════ */}
      {scissorMode && scissorFormVisible && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => { if (scissorPreset) setScissorFormVisible(false); else cancelScissor() }} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[75vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-charcoal text-lg font-bold m-0 flex items-center gap-2">
                <Scissors size={20} className="text-rose-600" /> Type de fil pour la coupe
              </h2>
              <button onClick={cancelScissor}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-muted mb-4 leading-relaxed">
              Choisissez le fil à appliquer sur le tronçon découpé. Ensuite, tapez deux fois sur la clôture pour marquer le début et la fin.
            </p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {fencePresets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setScissorPreset(preset)
                    setScissorFormVisible(false)
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-95"
                  style={{ borderColor: preset.color + '40', background: preset.color + '10' }}
                >
                  <div className="w-6 h-6 rounded-full flex-shrink-0 shadow-md" style={{ background: preset.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-charcoal truncate">{preset.name}</p>
                    {preset.description && <p className="text-xs text-muted truncate">{preset.description}</p>}
                  </div>
                  <span className="text-xs font-semibold text-muted/70">Choisir →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Sheet : sélecteur de type de fil
      ══════════════════════════════════════════ */}
      {presetSelectorVisible && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => { setPresetSelectorVisible(false); setNewPresetForm(false) }} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-charcoal text-lg font-bold m-0">🔌 Type de fil</h2>
              <button onClick={() => { setPresetSelectorVisible(false); setNewPresetForm(false) }}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>

            {!newPresetForm ? (
              <>
                <div className="space-y-2 mb-4">
                  {fencePresets.map(preset => (
                    <div key={preset.id} className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedPreset(prev => prev?.id === preset.id ? null : preset)}
                        className="flex-1 flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                        style={selectedPreset?.id === preset.id ? {
                          borderColor: preset.color,
                          borderWidth: 2,
                          background: preset.color + '18',
                        } : { borderColor: 'var(--color-border)', background: 'var(--color-cream)' }}
                      >
                        <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: preset.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-charcoal truncate">{preset.name}</p>
                          {preset.description && (
                            <p className="text-xs text-muted truncate">{preset.description}</p>
                          )}
                        </div>
                        {selectedPreset?.id === preset.id && (
                          <Check size={18} style={{ color: preset.color }} className="flex-shrink-0" />
                        )}
                      </button>
                      <button
                        onClick={() => askDeletePreset(preset)}
                        className="p-2.5 rounded-xl border border-border bg-cream text-danger/40 active:text-danger active:border-danger/30 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}

                  {/* ── Panneau avertissement suppression ── */}
                  {deletingPreset && (
                    <div className="rounded-2xl border-2 border-danger/40 bg-danger/5 p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-lg flex-shrink-0">⚠️</span>
                        <div>
                          <p className="text-sm font-bold text-danger">Supprimer "{deletingPreset.name}" ?</p>
                          <p className="text-xs text-muted mt-1 leading-relaxed">
                            Les clôtures existantes <strong>conserveront couleur et style</strong> mais
                            ne seront plus liées au preset. Irréversible.
                          </p>
                          {fencePins.filter(p => p.presetId === deletingPreset.id).length > 0 && (
                            <p className="text-xs font-semibold text-danger mt-1.5">
                              ⚠ {fencePins.filter(p => p.presetId === deletingPreset.id).length} clôture(s) utilisent ce type actuellement.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={confirmDeletePreset}
                          disabled={deleteCountdown > 0 || saving}
                          className="flex-1 py-2.5 rounded-xl bg-danger text-white text-sm font-bold
                                     active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {deleteCountdown > 0 ? `Attendre ${deleteCountdown}s…` : 'Confirmer la suppression'}
                        </button>
                        <button
                          onClick={() => { setDeletingPreset(null); setDeleteCountdown(0) }}
                          className="px-4 py-2.5 rounded-xl border border-border text-muted text-sm active:bg-cream"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setNewPresetForm(true)}
                  className="w-full py-3 rounded-xl border border-dashed border-orange-400 text-orange-600
                             text-sm font-semibold active:bg-orange-50 transition-colors mb-4
                             flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Nouveau type de fil
                </button>

                <div className="space-y-2">
                  <button
                    onClick={() => selectedPreset && startFenceWithPreset(selectedPreset, 'manual')}
                    disabled={!selectedPreset}
                    className="w-full py-3.5 rounded-xl font-semibold text-white text-base bg-orange-500
                               active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg
                               flex items-center justify-center gap-2"
                  >
                    🖐️ Mode manuel · placer sur la carte
                  </button>
                  <button
                    onClick={() => selectedPreset && startFenceWithPreset(selectedPreset, 'auto')}
                    disabled={!selectedPreset}
                    className="w-full py-3.5 rounded-xl font-semibold text-white text-base bg-forest
                               active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg
                               flex items-center justify-center gap-2"
                  >
                    📍 Mode auto · poteau-par-poteau (GPS)
                  </button>
                  <p className="text-[11px] text-muted/80 text-center pt-1 leading-relaxed">
                    En auto, marche jusqu'à chaque poteau, pose le téléphone dessus,
                    et appuie sur «&nbsp;Capturer&nbsp;». L'app utilise le GPS haute précision
                    pendant {AUTO_SAMPLE_SECONDS}s pour fixer le poteau au mètre près.
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <button onClick={() => setNewPresetForm(false)}
                        className="flex items-center gap-1 text-sm text-muted active:opacity-70 mb-1">
                  ← Retour
                </button>

                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Nom *</label>
                  <input
                    type="text" value={newPresetName}
                    onChange={e => setNewPresetName(e.target.value)}
                    placeholder="ex : Fil électrique 3 fils, Barbelé ancien…"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                               placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Style</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['electric', 'barbed', 'ribbon', 'plain'] as FencePreset['wireStyle'][]).map(k => {
                      const cfg: Record<FencePreset['wireStyle'], [string, string]> = {
                        electric: ['⚡', 'Électrique'],
                        barbed:   ['✕✕', 'Barbelé'],
                        ribbon:   ['▬', 'Ruban'],
                        plain:    ['—', 'Lisse'],
                      }
                      const [icon, label] = cfg[k]
                      return (
                        <button key={k} type="button"
                          onClick={() => setNewPresetStyle(k)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            newPresetStyle === k
                              ? 'border-orange-500 bg-orange-50 text-orange-700'
                              : 'border-border bg-cream text-muted'
                          }`}>
                          <span className="font-mono">{icon}</span> {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Couleur</label>
                  <div className="flex items-center gap-4">
                    <label className="relative cursor-pointer flex-shrink-0">
                      <input
                        type="color"
                        value={newPresetColor}
                        onChange={e => setNewPresetColor(e.target.value)}
                        className="sr-only"
                      />
                      <div
                        className="w-14 h-14 rounded-2xl border-4 border-white shadow-lg transition-transform active:scale-95"
                        style={{ background: newPresetColor }}
                      />
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center text-xs">🎨</div>
                    </label>
                    <div>
                      <p className="text-sm font-mono font-semibold text-charcoal">{newPresetColor.toUpperCase()}</p>
                      <p className="text-xs text-muted mt-0.5">Appuyez pour choisir</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Description (optionnel)</label>
                  <input
                    type="text" value={newPresetDesc}
                    onChange={e => setNewPresetDesc(e.target.value)}
                    placeholder="ex : 4 000 V, galvanisé, 2.5 mm…"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                               placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <button
                  onClick={saveNewPreset}
                  disabled={saving || !newPresetName.trim()}
                  className="w-full py-4 rounded-xl font-semibold text-white text-base bg-orange-500
                             active:scale-95 disabled:opacity-40 transition-all shadow-lg"
                >
                  {saving ? 'Création…' : 'Créer ce type de fil'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Sheet : formulaire clôture (après "Terminer")
      ══════════════════════════════════════════ */}
      {fenceMode && fenceFormVisible && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => setFenceFormVisible(false)} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-charcoal text-lg font-bold m-0">🔌 Nommer la clôture</h2>
              <button onClick={() => setFenceFormVisible(false)}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>
            {selectedPreset && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
                   style={{ background: selectedPreset.color + '20', border: `1px solid ${selectedPreset.color}50` }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: selectedPreset.color }} />
                <span className="text-sm font-semibold" style={{ color: selectedPreset.color }}>
                  {selectedPreset.name}
                </span>
              </div>
            )}
            <p className="text-xs text-muted mb-4">
              {fencePoints.length} points dessinés
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Nom *</label>
                <input
                  type="text" value={fenceName}
                  onChange={e => setFenceName(e.target.value)}
                  placeholder="ex: Clôture nord, Enclos pré bas…"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Note (optionnel)</label>
                <textarea
                  value={fenceNote}
                  onChange={e => setFenceNote(e.target.value)}
                  placeholder="Informations supplémentaires…"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                />
              </div>
              <button
                onClick={saveFence}
                disabled={saving || !fenceName.trim()}
                className="w-full py-4 rounded-xl font-semibold text-white text-base bg-orange-500
                           active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg"
              >
                {saving ? 'Enregistrement…' : `Enregistrer (${fencePoints.length} pts)`}
              </button>
              <button
                onClick={() => setFenceFormVisible(false)}
                className="w-full py-3 rounded-xl border border-border text-muted text-sm font-medium active:bg-cream"
              >
                ← Continuer à dessiner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Sheet : détail épingle
      ══════════════════════════════════════════ */}
      {selected && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => { setSelected(null); setEditOccupants(false) }} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[80vh] overflow-y-auto">

            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{PIN_CFG[selected.type]?.emoji}</span>
                <div>
                  <h2 className="text-charcoal text-lg font-bold m-0">{selected.name}</h2>
                  <p className="text-muted text-xs mt-0.5">{PIN_CFG[selected.type]?.label}</p>
                </div>
              </div>
              <button onClick={() => { setSelected(null); setEditOccupants(false) }}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>

            {/* ── Bloc clôture ── */}
            {selected.type === 'fence' && (
              <div className="mb-4 space-y-3">
                {/* Badge preset */}
                <div className="rounded-xl p-3 flex items-center gap-3"
                     style={{
                       background: (selected.presetColor ?? '#EA580C') + '20',
                       border: `1px solid ${selected.presetColor ?? '#EA580C'}40`,
                     }}>
                  <div className="w-4 h-4 rounded-full flex-shrink-0"
                       style={{ background: selected.presetColor ?? '#EA580C' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate"
                       style={{ color: selected.presetColor ?? '#EA580C' }}>
                      {fencePresets.find(p => p.id === selected.presetId)?.name ?? 'Clôture'}
                    </p>
                    {fencePresets.find(p => p.id === selected.presetId)?.description && (
                      <p className="text-xs text-muted truncate">
                        {fencePresets.find(p => p.id === selected.presetId)!.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Compteur de fils */}
                <div className="rounded-xl p-3 bg-cream border border-border">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Fils électriques</p>
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      onClick={() => updateFenceWireCount(selected, -1)}
                      disabled={actionBusy || (selected.wireCount ?? 1) <= 1}
                      className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 font-bold text-xl
                                 flex items-center justify-center active:scale-95 disabled:opacity-30 transition-all">
                      −
                    </button>
                    <div className="flex-1 text-center">
                      <span className="text-3xl font-bold text-charcoal">{selected.wireCount ?? 1}</span>
                      <span className="text-sm text-muted ml-1">
                        fil{(selected.wireCount ?? 1) > 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => updateFenceWireCount(selected, 1)}
                      disabled={actionBusy || (selected.wireCount ?? 1) >= 8}
                      className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 font-bold text-xl
                                 flex items-center justify-center active:scale-95 disabled:opacity-30 transition-all">
                      +
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      key={`volt-${selected.id}`}
                      type="number"
                      placeholder="Tension (ex : 6000)"
                      defaultValue={selected.wireVoltage ?? ''}
                      onBlur={e => {
                        const v = e.target.value ? Number(e.target.value) : null
                        if (v !== (selected.wireVoltage ?? null)) updateFenceVoltage(selected, v)
                      }}
                      className="flex-1 px-3 py-2 rounded-xl border border-border bg-white text-sm text-charcoal
                                 placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                    <span className="text-xs text-muted font-semibold">V</span>
                  </div>
                </div>

                {/* Infos tracé */}
                <div className="rounded-xl p-3 bg-orange-500/10 border border-orange-500/20 flex items-center gap-2">
                  <Pencil size={16} className="text-orange-600" />
                  <span className="text-sm font-semibold text-orange-700">
                    {selected.points?.length ?? 0} points ·{' '}
                    {isFenceClosed(selected) ? '🏠 Enclos fermé' : 'Clôture ouverte'}
                    {selected.cutFromId && ' · ✂ segment'}
                    {selected.fillOnly && ' · ✂ découpé'}
                  </span>
                </div>

                {/* Bouton : passer en mode édition du tracé (drag des poteaux) */}
                {!isTemp && (
                  <button
                    onClick={() => startEditFence(selected)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                               bg-forest/10 border border-forest/30 text-forest text-sm font-bold
                               active:bg-forest/20 transition-colors"
                  >
                    <Pencil size={14} /> Modifier le tracé (drag des poteaux)
                  </button>
                )}

                {/* Bouton restaurer fil unique (uniquement pour enclos découpé) */}
                {selected.fillOnly && isFenceClosed(selected) && (
                  <button
                    onClick={() => restoreSingleWire(selected)}
                    disabled={actionBusy}
                    className="w-full py-3 rounded-xl border-2 border-orange-400 text-orange-700 bg-orange-50
                               text-sm font-bold active:scale-95 disabled:opacity-50 transition-all
                               flex items-center justify-center gap-2"
                  >
                    <Undo2 size={15} />
                    {actionBusy ? 'Restauration…' : 'Restaurer fil unique (supprime les coupes)'}
                  </button>
                )}

                {/* ── Animaux (enclos fermé → assignation, ouvert → conseil) ── */}
                {isFenceClosed(selected) ? (
                  <div className="rounded-xl border-2 border-forest/30 bg-forest/5 overflow-hidden">
                    {/* En-tête */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-forest/20">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🐾</span>
                        <p className="text-sm font-bold text-forest">Animaux dans l'enclos</p>
                        <span className="text-xs font-bold text-forest/60 bg-forest/10 rounded-full px-2 py-0.5">
                          {animals.filter(a => a.enclosureId === selected.id).length}
                        </span>
                      </div>
                      {!editEnclosureAnimals && (
                        <button
                          onClick={() => {
                            setPendingEnclosureAnimals(animals.filter(a => a.enclosureId === selected.id).map(a => a.id))
                            setPendingMoveDate(tsToDateInputLocal())
                            setPendingMoveNote('')
                            setEditEnclosureAnimals(true)
                          }}
                          className="text-xs text-forest font-bold px-3 py-1.5 rounded-lg bg-forest/10 active:bg-forest/20 transition-colors"
                        >
                          ✏️ Modifier
                        </button>
                      )}
                    </div>

                    <div className="p-3">
                      {!editEnclosureAnimals ? (
                        (() => {
                          const enc = sortAnimalsByName(animals.filter(a => a.enclosureId === selected.id))
                          return enc.length === 0 ? (
                            <div className="text-center py-3">
                              <p className="text-sm text-muted italic mb-2">Aucun animal placé ici</p>
                              <button
                                onClick={() => {
                                  setPendingEnclosureAnimals([])
                                  setPendingMoveDate(tsToDateInputLocal())
                                  setPendingMoveNote('')
                                  setEditEnclosureAnimals(true)
                                }}
                                className="px-4 py-2 rounded-xl bg-forest text-white text-sm font-bold active:opacity-80 transition-opacity"
                              >
                                + Placer des animaux
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1.5">
                                {enc.map(a => {
                                  const f = healthFreshness(a.lastCheckedHealthy)
                                  const seenBy = a.lastCheckedHealthyBy
                                    ? (users.find(u => u.uid === a.lastCheckedHealthyBy)?.displayName ?? '?')
                                    : null
                                  const title = seenBy
                                    ? `${formatAgo(a.lastCheckedHealthy)} (par ${seenBy}) — touchez pour la fiche`
                                    : `${formatAgo(a.lastCheckedHealthy)} — touchez pour la fiche`
                                  return (
                                    <button key={a.id}
                                          title={title}
                                          onClick={() => navigate(`/animal/${a.id}`)}
                                          className="px-2.5 py-1.5 rounded-xl bg-forest/10 border border-forest/30 text-forest text-xs font-semibold flex items-center gap-1.5 active:bg-forest/20 transition-colors">
                                      <span className={`w-2 h-2 rounded-full ${healthDotClass(f)}`} aria-hidden />
                                      {getSpeciesInfo(a.species, customSpecies).emoji} {a.name}
                                    </button>
                                  )
                                })}
                              </div>
                              <button
                                onClick={() => markAllHealthy(enc)}
                                disabled={savingHealth || !user}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl
                                           bg-meadow/15 border border-meadow/40 text-meadow text-xs font-bold
                                           active:bg-meadow/25 transition-colors disabled:opacity-50"
                              >
                                <Check size={13} />
                                {savingHealth ? 'Enregistrement…' : `Tous vus en bonne santé (${enc.length})`}
                              </button>
                              {enc.some(a => a.lastCheckedHealthy) && (
                                <p className="text-[10px] text-muted/70 text-center">
                                  Dernier check : {(() => {
                                    const ts = Math.max(...enc.map(a => a.lastCheckedHealthy ?? 0))
                                    return ts ? formatAgo(ts) : '—'
                                  })()}
                                </p>
                              )}
                            </div>
                          )
                        })()
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted font-medium">
                            Touchez un animal pour l'ajouter ou le retirer.
                            Un animal déplacé depuis un autre enclos sera libéré automatiquement.
                          </p>
                          {animals.length === 0 ? (
                            <p className="text-xs text-muted italic text-center py-2">
                              Aucun animal enregistré — ajoutez-en depuis Admin.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                              {sortAnimalsByName(animals).map(a => {
                                const isSelected = pendingEnclosureAnimals.includes(a.id)
                                const isElsewhere = a.enclosureId && a.enclosureId !== selected.id
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => setPendingEnclosureAnimals(prev =>
                                      prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]
                                    )}
                                    className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1 ${
                                      isSelected
                                        ? 'border-forest text-forest bg-forest/10'
                                        : 'border-border text-muted bg-white'
                                    }`}
                                  >
                                    {getSpeciesInfo(a.species, customSpecies).emoji} {a.name}
                                    {isElsewhere && !isSelected && (
                                      <span className="text-muted/50 text-[10px]">↗ autre enclos</span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          {/* Date + note du mouvement — utile pour reconstituer un calendrier
                              de pâturage PAC (déclaration des dates réelles de présence). */}
                          <div className="bg-cream/60 rounded-xl p-2.5 space-y-2 border border-border/50">
                            <div>
                              <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
                                Date du mouvement
                              </label>
                              <input
                                type="date"
                                value={pendingMoveDate || tsToDateInputLocal()}
                                onChange={e => setPendingMoveDate(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                              />
                              <p className="text-[9px] text-muted mt-0.5 leading-tight">
                                Par défaut aujourd'hui. Mettre une date passée pour saisir
                                un mouvement rétroactif (calendrier PAC).
                              </p>
                            </div>
                            <input
                              type="text"
                              value={pendingMoveNote}
                              onChange={e => setPendingMoveNote(e.target.value)}
                              placeholder="Note (optionnelle) — ex: rotation, transhumance…"
                              className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                            />
                          </div>

                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => saveEnclosureAnimals(selected.id)}
                              disabled={actionBusy}
                              className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold active:opacity-80 disabled:opacity-50 transition-opacity"
                            >
                              {actionBusy ? 'Enregistrement…' : '✓ Confirmer'}
                            </button>
                            <button
                              onClick={() => setEditEnclosureAnimals(false)}
                              className="px-4 py-3 rounded-xl border border-border text-muted text-sm active:bg-cream"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl p-3 bg-cream border border-dashed border-border flex items-center gap-2">
                    <span className="text-base">💡</span>
                    <p className="text-xs text-muted leading-relaxed">
                      <strong>Clôture ouverte.</strong> Fermez-la en rapprochant le dernier point
                      du point vert de départ pour créer un enclos et y placer des animaux.
                    </p>
                  </div>
                )}

                {/* Historique des rotations (uniquement pour enclos fermés) */}
                {isFenceClosed(selected) && (
                  <div className="rounded-xl bg-cream border border-border/40 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
                      <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                        🌿 Pâturage
                      </span>
                      <button onClick={() => navigate('/grazing')}
                              className="text-[10px] font-bold text-forest bg-forest/10 px-2 py-1 rounded-md active:bg-forest/20">
                        Calendrier complet →
                      </button>
                    </div>
                    <button
                      onClick={() => setHistoryVisible(v => !v)}
                      className="w-full px-3 py-2.5 flex items-center justify-between active:bg-border/30 transition-colors"
                    >
                      <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                        🔄 Historique des mouvements
                      </span>
                      {historyVisible ? <Undo2 size={14} className="text-muted" /> : <Pencil size={14} className="text-muted" />}
                    </button>
                    {historyVisible && (
                      <div className="px-3 pb-3 pt-1">
                        {enclosureHistory.length === 0 ? (
                          <p className="text-xs text-muted italic text-center py-3">
                            Aucun mouvement enregistré pour cet enclos.
                          </p>
                        ) : (
                          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                            {enclosureHistory.slice(0, 30).map(m => {
                              const cameIn = m.toEnclosureId === selected.id
                              const author = users.find(u => u.uid === m.movedBy)?.displayName ?? '—'
                              const date   = new Date(m.movedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                              return (
                                <li key={m.id}
                                    className={`text-xs leading-snug px-2.5 py-1.5 rounded-lg ${cameIn ? 'bg-meadow/10' : 'bg-danger/5'}`}>
                                  <span className="font-bold">
                                    {getSpeciesInfo(m.species, customSpecies).emoji} {m.animalName}
                                  </span>
                                  {' '}
                                  {cameIn
                                    ? <span className="text-meadow">↘ entré{m.fromEnclosureName ? ` (depuis « ${m.fromEnclosureName} »)` : ' (libre)'}</span>
                                    : <span className="text-danger">↗ sorti{m.toEnclosureName ? ` (vers « ${m.toEnclosureName} »)` : ' (libéré)'}</span>
                                  }
                                  <div className="text-muted/80 text-[11px] mt-0.5">{date} · par {author}</div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selected.note && (
                  <div className="bg-cream rounded-xl p-3 border border-border">
                    <p className="text-charcoal text-sm">{selected.note}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Bloc eau manuelle ── */}
            {selected.type === 'water_manual' && (
              <div className="mb-4 space-y-3">
                <div className={`rounded-xl p-3 flex items-center gap-3 ${
                  isWaterOverdue(selected) ? 'bg-danger/10 border border-danger/20' : 'bg-sky/5 border border-sky/20'
                }`}>
                  <Droplets size={20} className={isWaterOverdue(selected) ? 'text-danger' : 'text-sky'} />
                  <div>
                    <p className="text-xs font-semibold text-charcoal">
                      {isWaterOverdue(selected) ? '⚠ Échéance dépassée !' : 'Prochaine échéance'}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {selected.dueAt
                        ? isWaterOverdue(selected) ? `Dépassée ${timeAgo(selected.dueAt)}` : timeUntil(selected.dueAt)
                        : selected.nextReminderAt ? timeUntil(selected.nextReminderAt) : 'Non planifié'
                      }
                    </p>
                  </div>
                </div>
                <DetailRow label="Dernier remplissage" value={selected.lastFilled ? timeAgo(selected.lastFilled) : 'Jamais'} />
                <DetailRow label="Intervalle" value={`Toutes les ${selected.intervalHours ?? 24}h`} />
                {selected.alertBeforeHours && (
                  <DetailRow label="Rappel" value={`${selected.alertBeforeHours}h avant`} />
                )}
                <button onClick={() => fillWaterPoint(selected)} disabled={actionBusy}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl
                             bg-sky text-white font-bold text-base shadow-lg
                             active:scale-95 disabled:opacity-50 transition-all">
                  <Droplets size={20} />
                  {actionBusy ? 'Enregistrement…' : 'Remplir maintenant 💧'}
                </button>
              </div>
            )}

            {/* ── Bloc eau naturelle ── */}
            {selected.type === 'water_natural' && (
              <div className="mb-4 space-y-3">
                {selected.waterStatus && (() => {
                  const cfg = WATER_STATUS_CFG[selected.waterStatus as keyof typeof WATER_STATUS_CFG]
                  return cfg ? (
                    <div className={`rounded-xl p-3 border ${cfg.bg} flex items-center gap-2`}>
                      <Droplets size={18} className={cfg.color} />
                      <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                    </div>
                  ) : null
                })()}
                {selected.availabilityMode && (
                  <DetailRow
                    label="Disponibilité"
                    value={AVAIL_MODE_CFG[selected.availabilityMode as keyof typeof AVAIL_MODE_CFG]?.label ?? ''}
                  />
                )}
                {selected.availabilityMode === 'seasonal' && selected.activeMonths && selected.activeMonths.length > 0 && (
                  <DetailRow label="Mois actifs" value={selected.activeMonths.map(m => MONTHS_FR[m]).join(', ')} />
                )}
                {selected.waterAnimals && selected.waterAnimals.length > 0 && (
                  <DetailRow label="Animaux" value={selected.waterAnimals.join(', ')} />
                )}
                <p className="text-xs font-semibold text-muted uppercase tracking-wider pt-1">Mettre à jour le statut</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(WATER_STATUS_CFG) as [string, { label: string; color: string }][]).map(([k, v]) => (
                    <button key={k}
                      onClick={() => setWaterNaturalStatus(selected, k)}
                      disabled={actionBusy}
                      className={`py-2.5 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
                        selected.waterStatus === k
                          ? `border-sky bg-sky/10 ${v.color}`
                          : 'border-border text-muted bg-cream'
                      }`}>{v.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Bloc batterie ── */}
            {selected.type === 'battery' && (
              <div className="mb-4 space-y-3">
                {selected.batteryStatus && (() => {
                  const cfg = BATTERY_STATUS_CFG[selected.batteryStatus as keyof typeof BATTERY_STATUS_CFG]
                  return cfg ? (
                    <div className={`rounded-xl p-3 border ${cfg.bg} flex items-center gap-2`}>
                      <Zap size={18} className={cfg.color} />
                      <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                      {isBatteryDue(selected) && (
                        <span className="ml-auto text-xs text-danger font-semibold">Vérification due !</span>
                      )}
                    </div>
                  ) : null
                })()}
                <DetailRow label="Dernière vérif." value={selected.lastChecked ? timeAgo(selected.lastChecked) : 'Jamais'} />
                {selected.nextCheckAt && (
                  <DetailRow
                    label="Prochaine vérif."
                    value={isBatteryDue(selected) ? `Dépassée ${timeAgo(selected.nextCheckAt)}` : timeUntil(selected.nextCheckAt)}
                  />
                )}
                {selected.zoneCovered && <DetailRow label="Zone couverte" value={selected.zoneCovered} />}
                <DetailRow label="Intervalle vérif." value={`Tous les ${selected.checkIntervalDays ?? 7} jours`} />
                <p className="text-xs font-semibold text-muted uppercase tracking-wider pt-1">Statut de la batterie</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.entries(BATTERY_STATUS_CFG) as [string, { label: string; color: string }][]).map(([k, v]) => (
                    <button key={k}
                      onClick={() => setBatteryStatus(selected, k)}
                      disabled={actionBusy}
                      className={`py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                        selected.batteryStatus === k
                          ? `border-forest bg-forest/10 ${v.color}`
                          : 'border-border text-muted bg-cream'
                      }`}>{v.label}</button>
                  ))}
                </div>
                <button onClick={() => checkBattery(selected)} disabled={actionBusy}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl
                             bg-sun/90 text-charcoal font-bold text-sm shadow
                             active:scale-95 disabled:opacity-50 transition-all">
                  <Check size={18} />
                  {actionBusy ? 'Enregistrement…' : "J'ai vérifié ✓"}
                </button>
              </div>
            )}

            {/* ── Bloc zone animaux ── */}
            {selected.type === 'zone' && (
              <div className="mb-4 space-y-3">
                {(selected.currentOccupants?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.currentOccupants!.map(o => (
                      <span key={o}
                            className="px-3 py-1.5 rounded-xl bg-forest/10 border border-forest/30 text-forest text-xs font-semibold">
                        {o}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted text-sm italic">Aucun occupant enregistré</p>
                )}
                {selected.occupiedSince && (
                  <DetailRow label="Depuis" value={timeAgo(selected.occupiedSince)} />
                )}
                {!editOccupants ? (
                  <button
                    onClick={() => { setPendingOccupants(selected.currentOccupants ?? []); setEditOccupants(true) }}
                    className="w-full py-3 rounded-xl border border-forest/30 text-forest text-sm font-semibold active:bg-forest/10 transition-colors"
                  >
                    Modifier les occupants
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider">Sélectionner les groupes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {animalGroups.map(g => (
                        <button key={g.name} type="button"
                          onClick={() => togglePendingOccupant(g.name)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                            pendingOccupants.includes(g.name) ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                          }`}>{g.name} ({g.count})</button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveOccupants(selected)} disabled={actionBusy}
                        className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold active:opacity-80 disabled:opacity-50">
                        {actionBusy ? '…' : 'Confirmer'}
                      </button>
                      <button onClick={() => setEditOccupants(false)}
                        className="px-4 py-3 rounded-xl border border-border text-muted text-sm active:bg-cream">
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
                {(selected.rotationHistory?.length ?? 0) > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Historique des rotations</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {[...selected.rotationHistory!].reverse().map((r, i) => (
                        <div key={i} className="text-xs text-muted bg-cream rounded-lg px-3 py-2 flex justify-between">
                          <span>{r.occupants.length > 0 ? r.occupants.join(', ') : 'Vide'}</span>
                          <span className="text-muted/60">
                            {new Date(r.from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Note générale */}
            {selected.note && selected.type !== 'fence' && (
              <div className="bg-cream rounded-xl p-3 mb-4 border border-border">
                <p className="text-charcoal text-sm leading-relaxed">{selected.note}</p>
              </div>
            )}

            {/* ── Photos attachées ── */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <ImageIcon size={13} /> Photos ({pinPhotos.length})
                </p>
                <label className="flex items-center gap-1.5 text-xs font-bold text-forest px-3 py-1.5 rounded-lg
                                  bg-forest/10 active:bg-forest/20 cursor-pointer transition-colors">
                  <Camera size={14} />
                  {photoUploading ? 'Envoi…' : 'Ajouter'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={photoUploading}
                    onChange={async e => {
                      const f = e.target.files?.[0]
                      if (f) await uploadPinPhoto(f)
                      e.target.value = '' // permet de re-choisir la même photo
                    }}
                  />
                </label>
              </div>
              {pinPhotos.length === 0 ? (
                <div className="bg-cream rounded-xl p-4 text-center border border-dashed border-border">
                  <p className="text-xs text-muted">Aucune photo pour cette épingle.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {pinPhotos.map(photo => (
                    <button
                      key={photo.id}
                      onClick={() => setPhotoViewer(photo)}
                      className="relative aspect-square rounded-xl overflow-hidden bg-cream border border-border active:scale-95 transition-transform"
                    >
                      <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-muted mb-4">
              GPS : {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
            </p>

            {isTemp ? null : !confirmDeletePin ? (
              <button onClick={() => setConfirmDeletePin(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                           border border-danger/30 text-danger text-sm font-semibold
                           active:bg-danger/10 transition-colors">
                <Trash2 size={16} /> Supprimer l'épingle
              </button>
            ) : (() => {
              const linkedAnimals = animals.filter(a => a.enclosureId === selected.id).length
              const childSegs     = pins.filter(p => p.cutFromId === selected.id).length
              return (
                <div className="rounded-xl border-2 border-danger/40 bg-danger/5 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-lg flex-shrink-0">⚠️</span>
                    <div>
                      <p className="text-sm font-bold text-danger">Supprimer « {selected.name} » ?</p>
                      {(linkedAnimals > 0 || childSegs > 0) && (
                        <ul className="text-xs text-charcoal mt-1.5 space-y-0.5">
                          {linkedAnimals > 0 && (
                            <li>• <strong>{linkedAnimals}</strong> animal{linkedAnimals > 1 ? 'aux' : ''} sera{linkedAnimals > 1 ? 'ont' : ''} libéré{linkedAnimals > 1 ? 's' : ''}</li>
                          )}
                          {childSegs > 0 && (
                            <li>• <strong>{childSegs}</strong> segment{childSegs > 1 ? 's' : ''} de coupe sera{childSegs > 1 ? 'ont' : ''} supprimé{childSegs > 1 ? 's' : ''}</li>
                          )}
                        </ul>
                      )}
                      <p className="text-xs text-muted mt-1">Action irréversible.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setConfirmDeletePin(false); deletePin(selected.id) }}
                      className="flex-1 py-2.5 rounded-xl bg-danger text-white text-sm font-bold
                                 active:opacity-80 transition-all flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={14} /> Oui, supprimer
                    </button>
                    <button
                      onClick={() => setConfirmDeletePin(false)}
                      className="px-4 py-2.5 rounded-xl border border-border text-muted text-sm active:bg-cream"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Viewer fullscreen photo
      ══════════════════════════════════════════ */}
      {photoViewer && (
        <div className="fixed inset-0 z-[3000] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <div className="text-xs">
              <p className="font-semibold">
                {users.find(u => u.uid === photoViewer.uploadedBy)?.displayName ?? 'Inconnu'}
              </p>
              <p className="opacity-60">
                {new Date(photoViewer.uploadedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(photoViewer.uploadedBy === user?.uid || !isTemp) && (
                <button
                  onClick={() => deletePinPhoto(photoViewer.id)}
                  className="p-2 rounded-xl text-white/80 active:bg-white/15"
                  title="Supprimer cette photo"
                >
                  <Trash2 size={20} />
                </button>
              )}
              <button
                onClick={() => setPhotoViewer(null)}
                className="p-2 rounded-xl text-white/80 active:bg-white/15"
              >
                <X size={22} />
              </button>
            </div>
          </div>
          <div
            className="flex-1 flex items-center justify-center px-2 pb-4 overflow-hidden"
            onClick={() => setPhotoViewer(null)}
          >
            <img
              src={photoViewer.dataUrl}
              alt=""
              className="max-w-full max-h-full object-contain"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Fiche détaillée : ouverte via navigate('/animal/:id') depuis chip
          enclos / panneau placement. Voir AnimalDetail.tsx. */}
    </div>
  )
}

/* ─── Petits composants helpers ─── */

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">{label}</label>
      {children}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-charcoal font-medium">{value}</span>
    </div>
  )
}
