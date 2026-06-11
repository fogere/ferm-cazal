import 'leaflet/dist/leaflet.css'
import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Circle, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Plus, X, Layers, LocateFixed, Trash2, Droplets, Check, Pencil, Undo2, MapPin as MapPinIcon, Camera, Image as ImageIcon, Search, SlidersHorizontal } from 'lucide-react'
import { compressImage } from '../services/image'
import type { PinPhoto, EnclosureMovement } from '../types'
import {
  collection, query, where, onSnapshot, addDoc, deleteDoc, getDocs,
  doc, updateDoc, getDoc, setDoc, writeBatch, deleteField,
} from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useUsers } from '../hooks/useUsers'
import { useLiveLocation } from '../hooks/useLiveLocation'
import { useLocationCore } from '../hooks/useLocationCore'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo } from '../services/species'
import {
  insidePolygonCentroid, distToSegmentPx, isFenceClosed,
} from '../services/map/geometry'
import {
  dateInputToTs as dateInputToTsLocal,
  timeAgo,
} from '../services/map/time'
import { getFenceVisualState } from '../services/map/fence-visual'
import { getStreamSegments } from '../services/map/stream-visual'
import { isWaterOverdue } from '../services/map/water'
import { isBatteryDue } from '../services/map/battery'
import { enclosureQueryIds, effectiveEnclosureId } from '../services/map/enclosure'
import { detectPlotSplit, diagnoseSplitFailure, type SplitResult } from '../services/map/polygon-split'
import { healthFreshness } from '../services/map/health'
import { completeLinkedTasks } from '../services/taskAutoComplete'
import { WaterManualPanel } from './map/panels/WaterManualPanel'
import { WaterStreamPanel } from './map/panels/WaterStreamPanel'
import { BatteryPanel } from './map/panels/BatteryPanel'
import { FencePanel } from './map/panels/FencePanel'
import { EnclosurePlacementPanel } from './map/panels/EnclosurePlacementPanel'
import { LandPlotPanel } from './map/panels/LandPlotPanel'
import { ScindageModal, type ScindageChoice } from './map/panels/ScindageModal'
import { GeofenceCheckSheet } from '../components/GeofenceCheckSheet'
import { BATTERY_STATUS_CFG } from './map/panels/shared'
import type { MapPin, PinType, FencePreset, Animal } from '../types'

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
  water_natural: { emoji: '💧', label: 'Source naturelle', color: '#0EA5E9' },
  water_manual:  { emoji: '🪣', label: 'Eau manuelle',     color: '#0284C7' },
  battery:       { emoji: '⚡', label: 'Batterie clôture', color: '#F59E0B' },
  zone:          { emoji: '🐴', label: 'Zone animaux',     color: '#52B788' },
  fence:         { emoji: '🔌', label: 'Clôture',          color: '#EA580C' },
  note:          { emoji: '📍', label: 'Note',             color: '#8B5CF6' },
  alert:         { emoji: '⚠️', label: 'Alerte',           color: '#DC2626' },
  todo:          { emoji: '🪓', label: 'À faire',          color: '#A16207' },
  water_stream:  { emoji: '🏞️', label: 'Cours d\'eau',     color: '#0284C7' },
  // land_plot ajouté en S2 — pas encore d'UI dédiée (vient en S4).
  // Visuel par défaut : vert clair (terrain qui nous appartient).
  land_plot:     { emoji: '⛰',  label: 'Espace défini',  color: '#52B788' },
  // custom : pin perso indicatif (Nils 03/06/2026). L'emoji/couleur réels viennent
  // du pin (customEmoji/customColor) ; ces valeurs sont les défauts du sélecteur.
  custom:        { emoji: '📌', label: 'Pin perso',       color: '#8B5CF6' },
}

// Palettes proposées dans le formulaire de pin perso.
const CUSTOM_EMOJIS = ['📌','⭐','❗','🚧','🪨','🌳','🏚️','🕳️','🐍','🍄','🔥','💀','🚪','🧭','⚓','🎯']
const CUSTOM_COLORS = ['#8B5CF6','#DC2626','#EA580C','#F59E0B','#16A34A','#0284C7','#DB2777','#475569']

// Catégories du filtre d'affichage carte (Nils 03/06/2026 : menu déroulant pour
// montrer/masquer des familles de pins). Chaque catégorie regroupe un ou plusieurs
// PinType. La clé sert d'identifiant stable dans le Set des catégories masquées.
const PIN_CATEGORIES: { key: string; label: string; emoji: string; types: PinType[] }[] = [
  { key: 'water',   label: 'Points d\'eau', emoji: '💧', types: ['water_manual', 'water_natural', 'water_stream'] },
  { key: 'battery', label: 'Batteries',     emoji: '⚡', types: ['battery'] },
  { key: 'fence',   label: 'Clôtures',      emoji: '🔌', types: ['fence'] },
  { key: 'space',   label: 'Espaces',       emoji: '⛰', types: ['land_plot'] },
  { key: 'todo',    label: 'À faire',       emoji: '🪓', types: ['todo'] },
  { key: 'alert',   label: 'Alertes',       emoji: '⚠️', types: ['alert'] },
  { key: 'note',    label: 'Notes',         emoji: '📍', types: ['note'] },
  { key: 'custom',  label: 'Mes pins',      emoji: '📌', types: ['custom'] },
]
const TYPE_TO_CAT: Partial<Record<PinType, string>> = (() => {
  const m: Partial<Record<PinType, string>> = {}
  for (const c of PIN_CATEGORIES) for (const t of c.types) m[t] = c.key
  return m
})()

// Types disponibles dans le formulaire de pin ponctuel (fence + water_stream ont leurs outils dédiés).
// Demande Eugénie 21/05/2026 V2 : water_stream (polyline) pour les cours d'eau linéaires.
// Demande Nils 03/06/2026 : ré-introduire water_natural (pin PONCTUEL) pour les sources
// naturelles non permanentes qui reviennent selon les mois (≠ ruisseau tracé). Le type, le
// formulaire saisonnier (availabilityMode/activeMonths) et le rendu existaient déjà — il
// suffisait de le ré-exposer dans le sélecteur.
const PICKABLE_TYPES: PinType[] = ['water_manual', 'water_natural', 'battery', 'note', 'alert', 'todo', 'custom']

/* ─── batteries ─── */

// BATTERY_STATUS_CFG importé depuis pages/map/panels/shared (S1 refacto)

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

// Vrai si une source naturelle saisonnière est "à sec" ce mois-ci. Attention :
// activeMonths (water_natural) est indexé 0-11 (janvier=0), contrairement à
// streamActiveMonths (water_stream) qui est 1-12. On compare donc avec getMonth()
// brut (0-11). Sert au rendu grisé + au panneau. Nils 03/06/2026.
function isSeasonalDry(pin: MapPin, currentMonth0to11: number): boolean {
  if (pin.type !== 'water_natural') return false
  if (pin.availabilityMode !== 'seasonal') return false
  const months = pin.activeMonths ?? []
  if (months.length === 0) return false
  return !months.includes(currentMonth0to11)
}

// Prochain mois actif (0-11) à partir du mois courant exclu, en bouclant sur l'année.
// null si activeMonths est vide. Nils 03/06/2026.
function nextActiveMonth(activeMonths: number[], currentMonth0to11: number): number | null {
  if (activeMonths.length === 0) return null
  for (let i = 1; i <= 12; i++) {
    const m = (currentMonth0to11 + i) % 12
    if (activeMonths.includes(m)) return m
  }
  return null
}

function makeDivIcon(
  type: PinType,
  overdue = false,
  hasPhotos = false,
  waterStatus?: MapPin['waterStatus'],
  todoDone = false,
  batteryOff = false,
  seasonalDry = false,
  customEmoji?: string,
  customColor?: string,
): L.DivIcon {
  let { emoji, color } = PIN_CFG[type]
  // Pin perso : emoji + couleur viennent du pin lui-même (Nils 03/06/2026).
  if (type === 'custom') {
    if (customEmoji) emoji = customEmoji
    if (customColor) color = customColor
  }
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
  // Source naturelle hors saison (Nils 03/06/2026) : grisée + badge 💤 pour signaler
  // qu'elle est à sec ce mois-ci. La date de retour est lisible dans le panneau.
  if (type === 'water_natural' && seasonalDry) {
    color = '#94A3B8'
    statusBadge = `<div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;
      background:white;border:2px solid #475569;display:flex;align-items:center;justify-content:center;
      font-size:10px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">💤</div>`
  }
  // Todo "fait" : on grise le pin et on ajoute un badge ✓ pour qu'il reste visible
  // sur la carte (Eugénie peut revoir l'historique) sans crier comme un todo ouvert.
  if (type === 'todo' && todoDone) {
    color = '#6B7280'   // gris
    statusBadge = `<div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;
      background:#16A34A;border:2px solid white;display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:bold;color:white;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">✓</div>`
  }
  // Batterie éteinte (bug Nils 21/05/2026) : grise + voyant ⊘ rouge
  if (type === 'battery' && batteryOff) {
    color = '#6B7280'
    statusBadge = `<div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;
      background:#DC2626;border:2px solid white;display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:bold;color:white;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">⊘</div>`
  }
  const border = overdue ? '3px solid #DC2626' : '2.5px solid white'
  const opacity = (type === 'todo' && todoDone) || (type === 'battery' && batteryOff) || (type === 'water_natural' && seasonalDry) ? '0.7' : '1'
  const photoBadge = hasPhotos
    ? `<div style="position:absolute;top:-3px;right:-3px;width:16px;height:16px;border-radius:50%;
        background:#1A4731;border:2px solid white;display:flex;align-items:center;justify-content:center;
        font-size:9px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">📷</div>`
    : ''
  return L.divIcon({
    html: `<div style="position:relative;width:38px;height:38px;opacity:${opacity};">
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
function makeDivIconGhost(type: PinType, customEmoji?: string, customColor?: string): L.DivIcon {
  let { emoji, color } = PIN_CFG[type]
  if (type === 'custom') {
    if (customEmoji) emoji = customEmoji
    if (customColor) color = customColor
  }
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

// P1/P2 (22/05/2026, bugs Nils) : taille de hitbox tactile.
// Visuel inchangé (point 10/14 px) ; hitbox invisible autour = cible
// doigt confortable. La priorité de clic entre "+" ghost et poteau réel est
// résolue côté map par FenceEditHitDetector (le plus proche gagne, style
// Blender) — donc on peut se permettre des hitbox larges sans conflit.
const EDIT_HITBOX_PX = 60
const HITBOX_WRAP_STYLE = `width:${EDIT_HITBOX_PX}px;height:${EDIT_HITBOX_PX}px;display:flex;align-items:center;justify-content:center;`

// Petits points sur la clôture en cours de dessin
const FENCE_DOT_ICON = L.divIcon({
  html: `<div style="${HITBOX_WRAP_STYLE}"><div style="background:#EA580C;width:10px;height:10px;border-radius:50%;
    border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div></div>`,
  className: '',
  iconSize:   [EDIT_HITBOX_PX, EDIT_HITBOX_PX],
  iconAnchor: [EDIT_HITBOX_PX / 2, EDIT_HITBOX_PX / 2],
})

// Premier point de la clôture (cible de fermeture)
const FENCE_FIRST_DOT_ICON = L.divIcon({
  html: `<div style="${HITBOX_WRAP_STYLE}"><div style="background:#22C55E;width:14px;height:14px;border-radius:50%;
    border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div></div>`,
  className: '',
  iconSize:   [EDIT_HITBOX_PX, EDIT_HITBOX_PX],
  iconAnchor: [EDIT_HITBOX_PX / 2, EDIT_HITBOX_PX / 2],
})

// P7 (Nils 22/05/2026) : anneau de sélection autour d'un poteau pour la
// fonction "Changer le fil sur cette portion". Rendu PAR-DESSUS le poteau
// normal (zIndexOffset léger), non-interactif (les clics passent au poteau
// sous-jacent puis au FenceEditHitDetector).
const SELECTED_POST_RING_ICON = L.divIcon({
  html: `<div style="width:32px;height:32px;border-radius:50%;
    border:3px solid #A855F7;background:rgba(168,85,247,0.18);
    box-shadow:0 0 0 2px white, 0 1px 4px rgba(0,0,0,0.3);"></div>`,
  className: '',
  iconSize:   [32, 32],
  iconAnchor: [16, 16],
})

// Point intermédiaire ghost (au milieu d'un segment, en mode édition).
// Eugénie clique dessus pour insérer un vrai poteau à cet emplacement.
const FENCE_MID_DOT_ICON = L.divIcon({
  html: `<div style="${HITBOX_WRAP_STYLE}"><div style="background:#22C55E;width:14px;height:14px;border-radius:50%;
    border:2px dashed white;opacity:0.55;box-shadow:0 1px 4px rgba(0,0,0,0.25);
    display:flex;align-items:center;justify-content:center;
    color:white;font-size:10px;font-weight:bold;line-height:1;">+</div></div>`,
  className: '',
  iconSize:   [EDIT_HITBOX_PX, EDIT_HITBOX_PX],
  iconAnchor: [EDIT_HITBOX_PX / 2, EDIT_HITBOX_PX / 2],
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

const LABEL_ZOOM      = 17  // zoom haut : 1 ligne par animal (emoji + nom)
const LABEL_ZOOM_MED  = 15  // zoom moyen : compteur compact "3 🐎 · 2 🫏"
const LABEL_ZOOM_LOW  = 13  // zoom bas : juste un nombre total minuscule
// Bug Nils 22/05/2026 : en-dessous de LABEL_ZOOM_LOW les labels sont masqués
// pour éviter la surcharge visuelle ("trop d'emoji trop d'indication").

// Couleurs santé alignées sur services/map/health.ts → healthDotClass()
const HEALTH_COLOR: Record<'ok' | 'warn' | 'stale' | 'never', string> = {
  ok:    '#52B788', // meadow
  warn:  '#F59E0B', // sun
  stale: '#DC2626', // danger
  never: '#9CA3AF', // muted
}

function makeEnclosureLabelIcon(
  enclosureAnimals: Animal[],
  zoom: number,
  customSpecies: import('../types').CustomSpecies[] = [],
  rotationDueAt?: number,
): L.DivIcon {
  // Bug Chacha 19/05/2026 (bug.json #3) : "avoir des indications visibles de
  // quand a été identifié en bonne santé la dernière fois un animal". Les
  // pastilles colorées 🟢🟡🔴 apparaissent maintenant DIRECTEMENT sur la map
  // (avant : uniquement dans la fiche animal ou le panneau enclos ouvert).
  const freshness = enclosureAnimals.map(a => healthFreshness(a.lastCheckedHealthy))
  const warnCount  = freshness.filter(f => f === 'warn').length
  const staleCount = freshness.filter(f => f === 'stale' || f === 'never').length

  // Couleurs depuis CSS vars → s'adaptent automatiquement light/dark
  let inner: string
  if (enclosureAnimals.length === 0) {
    inner = '<em style="color:var(--color-muted);font-size:10px">Vide</em>'
  } else if (zoom >= LABEL_ZOOM) {
    // Zoom haut — 1 ligne par animal + pastille santé colorée à droite du nom
    inner = enclosureAnimals.map((a, i) => {
      const { emoji } = getSpeciesInfo(a.species, customSpecies)
      const dot = HEALTH_COLOR[freshness[i]]
      return `<div style="font-size:10px;font-weight:600;white-space:nowrap;line-height:1.6;color:var(--color-charcoal);display:flex;align-items:center;gap:4px;justify-content:center">
        <span>${emoji} ${a.name}</span>
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};box-shadow:0 0 0 1px white"></span>
      </div>`
    }).join('')
  } else if (zoom >= LABEL_ZOOM_MED) {
    // Zoom moyen — comptage par espèce + indicateur agrégé santé
    const counts = new Map<string, number>()
    for (const a of enclosureAnimals) counts.set(a.species, (counts.get(a.species) ?? 0) + 1)
    const parts: string[] = []
    for (const [sp, n] of counts) {
      const { emoji } = getSpeciesInfo(sp, customSpecies)
      parts.push(`${n} ${emoji}`)
    }
    let healthTag = ''
    if (staleCount > 0) {
      healthTag = ` · <span style="color:${HEALTH_COLOR.stale};font-weight:bold">⚠${staleCount}</span>`
    } else if (warnCount > 0) {
      healthTag = ` · <span style="color:${HEALTH_COLOR.warn};font-weight:bold">⚠${warnCount}</span>`
    }
    inner = `<strong style="font-size:13px;white-space:nowrap;color:var(--color-charcoal)">${parts.join(' · ')}${healthTag}</strong>`
  } else {
    // Zoom bas — chiffre + pastille si au moins 1 animal en alerte santé.
    // Sinon juste le compteur. Évite l'empilement d'emojis sur la vue large.
    const dotColor = staleCount > 0 ? HEALTH_COLOR.stale
      : warnCount > 0 ? HEALTH_COLOR.warn
      : null
    const dot = dotColor
      ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};margin-left:3px;vertical-align:middle"></span>`
      : ''
    inner = `<strong style="font-size:11px;color:var(--color-charcoal)">${enclosureAnimals.length}${dot}</strong>`
  }

  // Badge "rotation à prévoir" — orange à J-7, rouge à échéance dépassée.
  // Visible en plus du label normal pour signaler qu'il faut bouger les animaux.
  if (rotationDueAt && enclosureAnimals.length > 0) {
    const daysLeft = (rotationDueAt - Date.now()) / 86_400_000
    if (daysLeft <= 7) {
      const overdue = daysLeft < 0
      const bg = overdue ? '#DC2626' : '#EA580C'
      const txt = overdue ? '⏰ retard' : `⏰ J${daysLeft < 1 ? '0' : `-${Math.ceil(daysLeft)}`}`
      inner = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        ${inner}
        <div style="background:${bg};color:white;font-size:9px;font-weight:bold;padding:1px 5px;border-radius:8px;white-space:nowrap">${txt}</div>
      </div>`
    }
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

/**
 * Couleur de remplissage d'un enclos selon la fraîcheur du pâturage.
 * Demande Eugénie 20/05/2026 : visualiser en un coup d'œil les parcs
 * récemment pâturés (encore en repos) vs les parcs prêts à repâturer.
 *
 *   occupied  → vert moyen      (présence actuelle d'animaux)
 *   fresh     → marron clair    (vide < 14 j  — repos en cours)
 *   resting   → jaune clair     (vide 14-60 j — repousse)
 *   ready     → vert vif        (vide > 60 j ou jamais  — prêt à pâturer)
 *
 * Le contour de la clôture (presetColor) n'est PAS affecté — seulement le fill.
 */
type GrazingStatus = 'occupied' | 'fresh' | 'resting' | 'ready'

/**
 * Remonte la chaîne `cutFromId` jusqu'à la racine. Un parc qui n'a pas été
 * découpé est sa propre racine. Un sous-parc créé par le ciseau pointe vers son
 * parent ; un sous-sous-parc remonte de proche en proche.
 *
 * Garde-fou anti-cycle (max 10 sauts) — ne devrait jamais arriver mais coûte rien.
 */
function getFenceRootId(pin: MapPin, allFences: MapPin[]): string {
  let current = pin
  for (let i = 0; i < 10; i++) {
    if (!current.cutFromId) return current.id
    const parent = allFences.find(f => f.id === current.cutFromId)
    if (!parent) return current.id
    current = parent
  }
  return current.id
}

/**
 * Tous les pins du même "groupe de pâturage" qu'un pin donné : son parc racine
 * + tous les sous-parcs (cousins, frères) issus du même découpage.
 *
 * Demande Eugénie 21/05/2026 : "même dans un parc scindé en plusieurs parties
 * ça agit comme si c'étaient des parcs indépendants". On veut que la fraîcheur
 * d'herbe agrège les rotations sur l'ensemble du parc d'origine.
 */
function getFenceGroup(pin: MapPin, allFences: MapPin[]): MapPin[] {
  const rootId = getFenceRootId(pin, allFences)
  return allFences.filter(f => f.id === rootId || getFenceRootId(f, allFences) === rootId)
}

function computeGrazingStatus(
  pin: MapPin,
  allFences: MapPin[],
  animals: Animal[],
  movements: EnclosureMovement[],
): GrazingStatus {
  // Agrégation : on regarde TOUS les pins du même groupe (parc d'origine + sous-parcs).
  // S2.5 compat migration : groupIds contient l'enclosureId LOGIQUE (plot.id si migré,
  // sinon fence.id), pour matcher contre animal.enclosureId / movement.{from,to}EnclosureId.
  const group = getFenceGroup(pin, allFences)
  const groupIds = new Set(group.map(g => effectiveEnclosureId(g)))

  // Occupé si AU MOINS un animal est présent dans n'importe quel sous-parc du groupe.
  const hasOccupants = animals.some(a => a.enclosureId && groupIds.has(a.enclosureId))
  if (hasOccupants) return 'occupied'

  // Dernière sortie d'un animal HORS du groupe (transition vers un parc qui n'est
  // pas dans le même groupe). Les mouvements internes (d'un sous-parc à un autre
  // sous-parc du même groupe) ne comptent pas — l'herbe a déjà été broutée.
  let lastExit = 0
  for (const m of movements) {
    if (!m.fromEnclosureId || !groupIds.has(m.fromEnclosureId)) continue
    // Sortie effective : vers null (libéré) ou vers un parc EXTÉRIEUR au groupe
    if (m.toEnclosureId === null || !m.toEnclosureId || !groupIds.has(m.toEnclosureId)) {
      if (m.movedAt > lastExit) lastExit = m.movedAt
    }
  }
  if (lastExit === 0) return 'ready'
  const daysSince = (Date.now() - lastExit) / 86_400_000
  if (daysSince < 14) return 'fresh'
  if (daysSince < 60) return 'resting'
  return 'ready'
}

const GRAZING_FILL: Record<GrazingStatus, { color: string; opacity: number }> = {
  occupied: { color: '#16A34A', opacity: 0.20 }, // vert moyen — animaux présents
  fresh:    { color: '#92400E', opacity: 0.22 }, // brun chaud — broutaillé récemment
  resting:  { color: '#EAB308', opacity: 0.16 }, // jaune — en repos / repousse
  ready:    { color: '#22C55E', opacity: 0.16 }, // vert vif — prêt à repâturer
}

/* ─── sous-composants Leaflet ─── */

// Rayon de tolérance en pixels — adapté doigt sur mobile
const SNAP_RADIUS_PX = 44
// P6 (Nils 22/05/2026) : rayon dédié à la sélection d'un FIL de clôture par
// clic. Plus serré que SNAP_RADIUS_PX parce que le fil ne fait que 3-8 px de
// large visuellement — un rayon de 44 attrapait tout clic en plein milieu
// d'un enclos fermé. 22 px = largeur visible + ~18 px de marge "Blender".
const FENCE_SELECT_RADIUS_PX = 22
// P5 (Nils 22/05/2026) : rayon spécifique pour la FERMETURE AUTOMATIQUE d'un
// parc en cours de dessin (retour au 1er poteau). Plus serré que
// SNAP_RADIUS_PX (44) pour ne plus fermer accidentellement les petits parcs.
// L'utilisatrice qui veut vraiment fermer tape sur le 1er poteau (cible
// verte = isClose visible) OU utilise le bouton "Fermer le parc".
const FENCE_CLOSE_RADIUS_PX = 24

function MapClickCapture({
  addActive, fenceActive,
  pointerActive, onPointer,
  streamActive, onStreamPoint,
  plotActive, onPlotPoint, onPlotClose, plotFirstPoint,
  holeActive, onHolePoint, onHoleClose, holeFirstPoint,
  onPin, onFencePoint, onFenceClose, onSelect, onSnapHover,
  fencePins, allPins, fenceFirstPoint,
}: {
  addActive: boolean
  fenceActive: boolean
  pointerActive: boolean
  onPointer: (lat: number, lng: number) => void
  streamActive: boolean
  onStreamPoint: (lat: number, lng: number) => void
  plotActive: boolean
  onPlotPoint: (lat: number, lng: number) => void
  onPlotClose: () => void
  plotFirstPoint: { lat: number; lng: number } | null
  holeActive: boolean
  onHolePoint: (lat: number, lng: number) => void
  onHoleClose: () => void
  holeFirstPoint: { lat: number; lng: number } | null
  onPin: (lat: number, lng: number) => void
  onFencePoint: (lat: number, lng: number) => void
  onFenceClose: () => void
  onSelect: (pin: MapPin) => void
  onSnapHover: (target: { lat: number; lng: number; isClose: boolean } | null) => void
  fencePins: MapPin[]
  allPins: MapPin[]
  fenceFirstPoint: { lat: number; lng: number } | null
}) {
  const map = useMap()

  useMapEvents({
    mousemove(e) {
      // Bug Nils 22/05/2026 : snap bidirectionnel — il opère désormais aussi
      // pendant le tracé d'un espace (land_plot) sur les sommets des clôtures
      // ET des autres land_plots existants. Avant : seul fenceActive snappait.
      if (!fenceActive && !plotActive) return
      const movePx = map.latLngToContainerPoint(e.latlng)
      let best: { lat: number; lng: number; isClose: boolean } | null = null
      let bestDist = SNAP_RADIUS_PX

      // Premier point du tracé courant (fermeture) — rayon serré.
      // - fence  : utilise FENCE_CLOSE_RADIUS_PX (P5, Nils 22/05/2026)
      // - plot   : utilise SNAP_RADIUS_PX par défaut (déjà cohérent avec onClick)
      const firstPoint = fenceActive ? fenceFirstPoint : plotFirstPoint
      const closeRadius = fenceActive ? FENCE_CLOSE_RADIUS_PX : SNAP_RADIUS_PX
      if (firstPoint) {
        const fp = map.latLngToContainerPoint(L.latLng(firstPoint.lat, firstPoint.lng))
        const d  = Math.hypot(movePx.x - fp.x, movePx.y - fp.y)
        if (d < closeRadius) { bestDist = d; best = { ...firstPoint, isClose: true } }
      }
      // Points existants des clôtures sauvegardées
      for (const pin of fencePins) {
        for (const v of pin.points ?? []) {
          const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
          const d  = Math.hypot(movePx.x - vp.x, movePx.y - vp.y)
          if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
        }
      }
      // Points des contours land_plot (S5.2 — tip n°1 Eugénie : la clôture
      // doit pouvoir suivre le tracé d'un espace défini sans décalage).
      for (const pin of allPins) {
        if (pin.type !== 'land_plot') continue
        for (const v of pin.points ?? []) {
          const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
          const d  = Math.hypot(movePx.x - vp.x, movePx.y - vp.y)
          if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
        }
        // Points des holes (zones vides intérieures)
        for (const h of pin.holes ?? []) {
          for (const v of h.points) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(movePx.x - vp.x, movePx.y - vp.y)
            if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
          }
        }
      }
      onSnapHover(best)
    },
    mouseout() {
      if (fenceActive || plotActive) onSnapHover(null)
    },
    click(e) {
      // ── Mode pointer (curseur partagé) : envoie la position aux autres ──
      if (pointerActive) {
        onPointer(e.latlng.lat, e.latlng.lng)
        return
      }
      // ── Mode cours d'eau (water_stream) : accumule des points ──
      if (streamActive) {
        onStreamPoint(e.latlng.lat, e.latlng.lng)
        return
      }
      // ── Mode "Définir un espace" (land_plot) : accumule des points,
      //    ferme automatiquement si on retouche le premier point (≥ 3 points).
      //    Bug Nils 22/05/2026 : snap bidirectionnel — un tap proche d'un sommet
      //    de clôture (ou d'un autre land_plot) se cale dessus pour assurer la
      //    continuité géométrique entre l'espace et les clôtures qui l'entourent. ──
      if (plotActive) {
        const clickPx = map.latLngToContainerPoint(e.latlng)
        // 1. fermeture sur le 1er point ?
        if (plotFirstPoint) {
          const firstPx = map.latLngToContainerPoint(L.latLng(plotFirstPoint.lat, plotFirstPoint.lng))
          const d = Math.hypot(clickPx.x - firstPx.x, clickPx.y - firstPx.y)
          if (d < SNAP_RADIUS_PX) {
            onPlotClose()
            return
          }
        }
        // 2. snap sur le sommet le plus proche (fence vertices + autres land_plots)
        let snap: { lat: number; lng: number } | null = null
        let bestDist = SNAP_RADIUS_PX
        for (const pin of fencePins) {
          for (const v of pin.points ?? []) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
            if (d < bestDist) { bestDist = d; snap = { lat: v.lat, lng: v.lng } }
          }
        }
        for (const pin of allPins) {
          if (pin.type !== 'land_plot') continue
          for (const v of pin.points ?? []) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
            if (d < bestDist) { bestDist = d; snap = { lat: v.lat, lng: v.lng } }
          }
        }
        if (snap) {
          onPlotPoint(snap.lat, snap.lng)
        } else {
          onPlotPoint(e.latlng.lat, e.latlng.lng)
        }
        return
      }
      // ── Mode "+ Zone vide intérieure" (hole d'un land_plot) ──
      if (holeActive) {
        if (holeFirstPoint) {
          const clickPx = map.latLngToContainerPoint(e.latlng)
          const firstPx = map.latLngToContainerPoint(L.latLng(holeFirstPoint.lat, holeFirstPoint.lng))
          const d = Math.hypot(clickPx.x - firstPx.x, clickPx.y - firstPx.y)
          if (d < SNAP_RADIUS_PX) {
            onHoleClose()
            return
          }
        }
        onHolePoint(e.latlng.lat, e.latlng.lng)
        return
      }
      if (fenceActive) {
        // ── Snap vers point existant ou fermeture ──
        const clickPx = map.latLngToContainerPoint(e.latlng)
        let best: { lat: number; lng: number; isClose: boolean } | null = null
        let bestDist = SNAP_RADIUS_PX
        // P5 (Nils 22/05/2026) : rayon de fermeture serré
        // (FENCE_CLOSE_RADIUS_PX) — le tap doit être franchement sur le 1ᵉʳ
        // poteau pour fermer. Aligné avec le mousemove ci-dessus.
        if (fenceFirstPoint) {
          const fp = map.latLngToContainerPoint(L.latLng(fenceFirstPoint.lat, fenceFirstPoint.lng))
          const d  = Math.hypot(clickPx.x - fp.x, clickPx.y - fp.y)
          if (d < FENCE_CLOSE_RADIUS_PX) { bestDist = d; best = { ...fenceFirstPoint, isClose: true } }
        }
        for (const pin of fencePins) {
          for (const v of pin.points ?? []) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
            if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
          }
        }
        // Snap aussi sur les contours land_plot (S5.2 — tip n°1 Eugénie)
        for (const pin of allPins) {
          if (pin.type !== 'land_plot') continue
          for (const v of pin.points ?? []) {
            const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
            const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
            if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
          }
          for (const h of pin.holes ?? []) {
            for (const v of h.points) {
              const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
              const d  = Math.hypot(clickPx.x - vp.x, clickPx.y - vp.y)
              if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng, isClose: false } }
            }
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
      // Bug Eugénie 21/05/2026 : avant, l'intérieur des polygones était prioritaire,
      // donc impossible de sélectionner un point d'eau placé DANS un enclos en cliquant
      // dessus — on tombait toujours sur l'édition d'enclos. Inversé : pins → fil → enclos.
      const clickPx = map.latLngToContainerPoint(e.latlng)
      let bestPin: MapPin | null = null
      let bestDist = SNAP_RADIUS_PX

      // 1. Épingles standard (priorité la plus haute — points eau, batterie, todo, etc.)
      for (const pin of allPins) {
        if (pin.type === 'fence') continue
        const pos = map.latLngToContainerPoint(L.latLng(pin.lat, pin.lng))
        const d   = Math.hypot(clickPx.x - pos.x, clickPx.y - pos.y)
        if (d < bestDist) { bestDist = d; bestPin = pin }
      }

      // 2. Fil de clôture (proximité segment) — si aucun pin dans le rayon.
      //    P6 (Nils 22/05/2026) : rayon dédié plus serré que SNAP_RADIUS_PX,
      //    pour ne plus "tomber sur le fil" en cliquant en plein milieu d'un
      //    enclos fermé (le fil mesure 3-8 px de large visuellement, donc
      //    largeur réelle + ~18 px de marge Blender = 22 px suffit).
      if (!bestPin) {
        let bestFenceDist = FENCE_SELECT_RADIUS_PX
        for (const pin of fencePins) {
          if (!pin.points || pin.points.length < 2) continue
          for (let i = 0; i < pin.points.length - 1; i++) {
            const a = map.latLngToContainerPoint(L.latLng(pin.points[i].lat,   pin.points[i].lng))
            const b = map.latLngToContainerPoint(L.latLng(pin.points[i+1].lat, pin.points[i+1].lng))
            const d = distToSegmentPx(clickPx.x, clickPx.y, a.x, a.y, b.x, b.y)
            if (d < bestFenceDist) { bestFenceDist = d; bestPin = pin }
          }
        }
      }

      // S9 (22/05/2026) : on a retiré le fallback "clic à l'intérieur d'un
      // fence fermé = sélectionne le fence". Une clôture est juste un tracé,
      // sa hitbox est la proximité du fil (étape 2). Cliquer au milieu d'un
      // anneau ne doit plus tomber sur la clôture — soit on tombe sur un
      // land_plot (Polygon onClick direct), soit sur rien.

      if (bestPin) onSelect(bestPin)
    },
  })
  return null
}

/**
 * Hit-detection style Blender pour le mode édition d'un tracé : à chaque clic,
 * on calcule la distance pixel du clic à TOUTES les cibles (poteaux réels + "+"
 * ghosts) et la plus proche gagne. Évite que la hitbox d'un poteau réel masque
 * un "+" plus proche du doigt (bug Nils 22/05/2026, problèmes 1+2).
 *
 * Les ghosts "+" passent en `interactive={false}` côté Marker → leurs clics
 * traversent jusqu'à la map, ce composant intercepte et arbitre. Les poteaux
 * réels restent interactifs pour conserver drag + dblclick natifs ; quand le
 * clic atterrit sur eux et qu'aucun "+" n'est plus proche, ce détecteur ne
 * fait rien (le Marker gère).
 */
function FenceEditHitDetector({
  editPin, points, isClosed, hasDup, mode, onInsert, onRealClick, onRemove,
}: {
  editPin: MapPin | null
  points: { lat: number; lng: number }[]
  isClosed: boolean
  hasDup: boolean
  /** Bug Nils #4+#7 22/05/2026 — un seul comportement par tap selon le mode. */
  mode: 'move' | 'add' | 'delete' | 'cut'
  onInsert: (afterIdx: number) => void
  onRealClick: (idx: number) => void
  onRemove: (idx: number) => void
}) {
  const map = useMap()
  useMapEvents({
    click(e) {
      if (!editPin || points.length < 2) return
      // En mode 'move', le tap simple ne fait RIEN. Le drag des markers gère
      // lui-même le déplacement (cf. eventHandlers.dragend). On élimine ainsi
      // toute sélection accidentelle qui agaçait Nils (#7 problème 1).
      if (mode === 'move') return

      const clickPx = map.latLngToContainerPoint(e.latlng)

      // Mode 'add' : on cherche UNIQUEMENT les segments (= mid-dots "+").
      // Les poteaux réels sont volontairement ignorés — c'est cohérent : pour
      // ajouter on doit cliquer ENTRE des poteaux. Plus de winner-takes-all
      // qui empêchait le "+" de répondre quand on était proche d'un poteau.
      if (mode === 'add') {
        let bestDist = EDIT_HITBOX_PX
        let bestMidIdx = -1
        for (let i = 0; i < points.length - 1; i++) {
          if (hasDup && i === points.length - 2) continue
          const a = points[i], b = points[i + 1]
          const px = map.latLngToContainerPoint(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2))
          const d  = Math.hypot(clickPx.x - px.x, clickPx.y - px.y)
          if (d < bestDist) { bestDist = d; bestMidIdx = i }
        }
        // Mid-dot de fermeture (polygon land_plot sans doublon : segment dernier → premier)
        if (isClosed && !hasDup && points.length >= 2) {
          const last  = points[points.length - 1]
          const first = points[0]
          const px = map.latLngToContainerPoint(L.latLng((last.lat + first.lat) / 2, (last.lng + first.lng) / 2))
          const d  = Math.hypot(clickPx.x - px.x, clickPx.y - px.y)
          if (d < bestDist) { bestDist = d; bestMidIdx = points.length - 1 }
        }
        if (bestMidIdx >= 0) onInsert(bestMidIdx)
        return
      }

      // Modes 'delete' et 'cut' : on cherche UNIQUEMENT les poteaux réels.
      // Pas d'ambiguïté possible avec les "+" qui n'existent pas dans ces modes.
      let bestDist = EDIT_HITBOX_PX
      let bestRealIdx = -1
      for (let i = 0; i < points.length; i++) {
        if (hasDup && i === points.length - 1) continue
        const px = map.latLngToContainerPoint(L.latLng(points[i].lat, points[i].lng))
        const d  = Math.hypot(clickPx.x - px.x, clickPx.y - px.y)
        if (d < bestDist) { bestDist = d; bestRealIdx = i }
      }
      if (bestRealIdx < 0) return
      if (mode === 'delete') onRemove(bestRealIdx)
      else if (mode === 'cut') onRealClick(bestRealIdx)
    },
  })
  return null
}

// Curseur fantôme : suit la souris en mode ajout
function CursorMarker({ active, type, customEmoji, customColor }: { active: boolean; type: PinType; customEmoji?: string; customColor?: string }) {
  const [pos, setPos] = useState<[number, number] | null>(null)
  useMapEvents({
    mousemove(e) { if (active) setPos([e.latlng.lat, e.latlng.lng]) },
    mouseout()   { setPos(null) },
  })
  if (!active || !pos) return null
  return <Marker position={pos} icon={makeDivIconGhost(type, customEmoji, customColor)} interactive={false} />
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

// Perf/confort Nils 03/06 : on mémorise le dernier centre+zoom de la carte pour
// la rouvrir là où elle était (au lieu de toujours repartir du défaut, ce qui
// donnait l'impression que "ça recharge" à chaque visite).
const MAP_VIEW_KEY = 'le-cazal:mapView'
function readSavedView(): { center: [number, number]; zoom: number } | null {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v?.lat === 'number' && typeof v?.lng === 'number' && typeof v?.zoom === 'number') {
      return { center: [v.lat, v.lng], zoom: v.zoom }
    }
  } catch { /* localStorage indispo / JSON cassé : on ignore */ }
  return null
}
let _persistViewTimer: ReturnType<typeof setTimeout> | null = null
function persistView(map: L.Map) {
  if (_persistViewTimer) clearTimeout(_persistViewTimer)
  _persistViewTimer = setTimeout(() => {
    try {
      const c = map.getCenter()
      localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }))
    } catch { /* ignore */ }
  }, 400)
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  // zoomend → maj du zoom (seuils d'affichage labels) ; move/zoom → persistance de la vue.
  useMapEvents({
    zoomend(e)  { const m = e.target as L.Map; onZoom(m.getZoom()); persistView(m) },
    moveend(e)  { persistView(e.target as L.Map) },
  })
  return null
}

/**
 * Marker temps réel "ma position" + cercle de précision, ISOLÉ dans son propre
 * composant. Perf Nils 03/06 : avant, `selfPos` vivait dans MapPage et le flux GPS
 * (~1 update/s en haute précision) faisait re-render TOUTE la carte chaque seconde,
 * en continu — saccades au pan/zoom et même à l'arrêt. Désormais seul ce petit
 * composant se re-rend à chaque position ; MapPage ne bouge plus.
 */
function SelfLocationMarker({ enabled, color, label }: { enabled: boolean; color: string; label: string }) {
  const [selfPos, setSelfPos] = useState<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null)
  useLocationCore(setSelfPos, undefined, enabled)
  if (!enabled || !selfPos) return null
  return (
    <>
      <Circle
        center={[selfPos.lat, selfPos.lng]}
        radius={Math.max(3, Math.min(200, selfPos.accuracy))}
        pathOptions={{ color, weight: 1, opacity: 0.4, fillColor: color, fillOpacity: 0.08 }}
        interactive={false}
      />
      <Marker
        key="live-self"
        position={[selfPos.lat, selfPos.lng]}
        icon={makeUserLocationIcon(color, label)}
        interactive={false}
        zIndexOffset={400}
      />
    </>
  )
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
  // custom (pin perso)
  customEmoji: string
  customColor: string
}

function blankForm(defaultUid: string): FormState {
  return {
    name: '', type: 'note', note: '',
    intervalHours: 24, alertBeforeHours: 3, waterAssignedTo: defaultUid,
    availabilityMode: 'always', activeMonths: [], waterStatus: 'functional', waterAnimals: [],
    batteryStatus: 'good', checkIntervalDays: 7, zoneCovered: '',
    currentOccupants: [],
    customEmoji: CUSTOM_EMOJIS[0], customColor: CUSTOM_COLORS[0],
  }
}

/* ─── page ─── */

export default function MapPage() {
  const navigate = useNavigate()
  // Bug Eugénie 22/05/2026 : la notification geofence arrive en URL avec
  // ?check=<plotId> → on ouvre la GeofenceCheckSheet automatiquement plutôt
  // que de juste recharger /map.
  const [searchParams, setSearchParams] = useSearchParams()
  const checkPlotId = searchParams.get('check')
  const { user, profile, isTemp } = useAuth()
  // Géoloc partagée : ne s'active QUE pendant que cette page est montée.
  // Évite de pinger Firestore en arrière-plan toute la journée — la position
  // n'est utile qu'aux utilisateurs qui ont la carte ouverte.
  useLiveLocation()

  // Bug Eugénie 24/05/2026 (qualité GPS) : son propre marker est rendu DIRECTEMENT
  // depuis le flux GPS local (~1 update/s), pas depuis Firestore (throttle 90 s).
  // Perf Nils 03/06 : ce flux ~1/s est désormais consommé par le composant isolé
  // <SelfLocationMarker> (cf. plus bas dans le rendu) et NON par un state de MapPage,
  // sinon toute la carte se re-rendait chaque seconde → saccades permanentes.

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
  const users = useUsers()
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
  // Filtre d'affichage : catégories de pins MASQUÉES (Nils 03/06/2026). Persisté.
  const [filterOpen,  setFilterOpen]  = useState(false)
  const [hiddenCats,  setHiddenCats]  = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('fm_map_hidden_cats')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('fm_map_hidden_cats', JSON.stringify([...hiddenCats])) }
    catch { /* ignoré */ }
  }, [hiddenCats])
  const isCatHidden = (key: string) => hiddenCats.has(key)
  const toggleCat = (key: string) => setHiddenCats(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const [tileError,    setTileError]    = useState<string | null>(null)
  const [addMode,      setAddMode]      = useState(false)
  const [pendingPos,   setPendingPos]   = useState<{ lat: number; lng: number } | null>(null)
  const [selected,     setSelected]     = useState<MapPin | null>(null)
  // Renommer un pin (parc, point d'eau, batterie…) sans le recréer — bug Eugénie 21/05/2026.
  const [renamingPin,  setRenamingPin]  = useState(false)
  const [renameValue,  setRenameValue]  = useState('')
  const [form,         setForm]         = useState<FormState>(() => blankForm(user?.uid ?? ''))
  const [saving,       setSaving]       = useState(false)
  const [actionBusy,   setActionBusy]   = useState(false)
  const [savingHealth, setSavingHealth] = useState(false)
  const [flyTrigger,   setFlyTrigger]   = useState(0)
  const [editOccupants, setEditOccupants] = useState(false)
  const [pendingOccupants, setPendingOccupants] = useState<string[]>([])

  // États mode "cours d'eau" — bug Eugénie 21/05/2026 V2.
  // Mode dessin polyline simple : on clique, on accumule des points, on valide.
  // Plus minimal que fenceMode (pas de presets / wireCount / GPS auto).
  const [streamMode,         setStreamMode]         = useState(false)
  const [streamPoints,       setStreamPoints]       = useState<{ lat: number; lng: number }[]>([])
  const [streamFormVisible,  setStreamFormVisible]  = useState(false)
  const [streamFormName,     setStreamFormName]     = useState('')
  const [streamFormSeasonal, setStreamFormSeasonal] = useState(false)
  // ── Mode "Définir un espace" (S4.3) ── demande Eugénie 21/05/2026
  // Trace un land_plot autonome (terrain qui nous appartient). Plus minimal
  // que fenceMode (pas de presets / fils / GPS auto), proche de streamMode.
  const [plotMode,           setPlotMode]           = useState(false)
  const [plotPoints,         setPlotPoints]         = useState<{ lat: number; lng: number }[]>([])
  const [plotFormVisible,    setPlotFormVisible]    = useState(false)
  const [plotFormName,       setPlotFormName]       = useState('')
  // ── Mode "+ Zone vide intérieure" (S4.6) ── demande Eugénie tip n°2 21/05/2026
  // Trace un trou (hole) dans un land_plot existant : bout de terrain qui ne
  // nous appartient pas au milieu d'un parc. Le polygon résultant est poussé
  // dans landplot.holes[].
  const [holeMode,           setHoleMode]           = useState(false)
  const [holePlotId,         setHolePlotId]         = useState<string | null>(null)
  const [holePoints,         setHolePoints]         = useState<{ lat: number; lng: number }[]>([])
  const [streamFormMonths,   setStreamFormMonths]   = useState<number[]>([])

  // Atténuation par segment (Phase 2 cours d'eau, Eugénie) : l'état du
  // formulaire est désormais local au composant WaterStreamPanel.

  // États mode clôture
  const [fenceMode,        setFenceMode]        = useState(false)
  const [fencePoints,      setFencePoints]      = useState<{ lat: number; lng: number }[]>([])
  const [fenceFormVisible, setFenceFormVisible] = useState(false)
  const [fenceName,        setFenceName]        = useState('')
  const [fenceNote,        setFenceNote]        = useState('')

  /* Édition d'une clôture existante : drag des poteaux pour corriger le tracé.
     fenceEditPin = pin en cours d'édition (null = hors mode).
     fenceEditPoints = copie de travail des points (commit Firestore au "Valider").
     Bugs Nils #4+#7 22/05/2026 — refonte UX : un seul comportement par tap selon
     le mode actif (toolbar). Avant on superposait drag + range select + "+"
     intermédiaires sur le même tap → confusion + sélection accidentelle. */
  const [fenceEditPin,    setFenceEditPin]    = useState<MapPin | null>(null)
  const [fenceEditPoints, setFenceEditPoints] = useState<{ lat: number; lng: number }[]>([])
  const [fenceEditSaving, setFenceEditSaving] = useState(false)
  // Référence vers la carte Leaflet (react-leaflet v5 : forwardée via ref).
  // Utilisée par le snap en mode édition pour projeter lat/lng → pixels.
  const mapRef = useRef<L.Map | null>(null)
  // Anneau de snap en mode édition, piloté en IMPÉRATIF (hors React). Bug Nils :
  // un setState pendant le drag d'un poteau re-rendait toute la carte → react-leaflet
  // remettait le marqueur à sa position d'origine et ça oscillait à toute vitesse.
  // On déplace donc l'indicateur directement via Leaflet, sans aucun re-render.
  const snapMarkerRef = useRef<L.Marker | null>(null)
  // Vue initiale = dernière vue mémorisée (centre+zoom), sinon défaut ferme. Lue une
  // seule fois au montage (MapContainer ne lit center/zoom qu'à l'init).
  const initialView = useRef(readSavedView()).current
  type EditMode = 'move' | 'add' | 'delete' | 'cut'
  const [editMode, setEditMode] = useState<EditMode>('move')

  // P7 (Nils 22/05/2026) : sélection d'une portion entre 2 poteaux dans le
  // mode édition. Permet de changer le fil utilisé sur cette portion sans
  // passer par le mode ciseau séparé. Quand start ET end sont définis, le
  // bouton "Changer le fil" apparaît dans le toolbar d'édition.
  const [editRangeStart, setEditRangeStart] = useState<number | null>(null)
  const [editRangeEnd,   setEditRangeEnd]   = useState<number | null>(null)
  // Modal de choix du preset pour la portion sélectionnée.
  const [editRangePresetVisible, setEditRangePresetVisible] = useState(false)
  const [editRangeApplying,      setEditRangeApplying]      = useState(false)

  // S7 — scindage automatique d'un land_plot par une clôture.
  // Quand `saveFence()` détecte que le tracé traverse un espace existant, on
  // n'écrit pas la clôture tout de suite : on stocke le contexte ici et on
  // ouvre la modal de découpage (placement animaux + confirmation).
  const [pendingSplit, setPendingSplit] = useState<{
    plot:    MapPin
    split:   SplitResult
    payload: Record<string, unknown>  // doc fence prêt à addDoc (sans id)
  } | null>(null)

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
  const [mapZoom,                 setMapZoom]                 = useState(readSavedView()?.zoom ?? ZOOM_DEFAULT)
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
  // Édition inline de la description d'un pin perso (Nils 03/06/2026).
  const [customDescEdit, setCustomDescEdit] = useState<string | null>(null)
  // Reset le brouillon de description dès qu'on change (ou ferme) le pin sélectionné.
  useEffect(() => { setCustomDescEdit(null) }, [selected?.id])

  // Historique mouvements d'animaux (pour enclos sélectionné)
  const [enclosureHistory, setEnclosureHistory] = useState<EnclosureMovement[]>([])
  const [historyVisible,   setHistoryVisible]   = useState(false)
  // TOUS les mouvements (pour colorer les enclos selon la fraîcheur du pâturage).
  // Demande Eugénie 20/05/2026 : "changer la couleur des parcs quand ils ont été pâturés".
  // Borné à ~2200 docs en pratique (cf. ARCHITECTURE.md) → impact négligeable.
  const [allMovements, setAllMovements] = useState<EnclosureMovement[]>([])
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'enclosure_movements'),
      snap => setAllMovements(snap.docs.map(d => ({ id: d.id, ...d.data() } as EnclosureMovement))),
      err => console.warn('[Map] all enclosure_movements:', err.code),
    )
    return unsub
  }, [])
  // Tick pour faire expirer les marqueurs "live" des autres (pointeurs 60 s, positions
  // 10 min). Perf Nils 03/06 : avant, ce tick re-rendait TOUTE la carte (4400 lignes,
  // toutes les clôtures) chaque seconde — même quand personne ne partageait sa position,
  // ce qui faisait "sauter" les barrières et saccader le zoom/pan. Désormais :
  //   1. on ne tourne QUE s'il y a effectivement une activité live à expirer,
  //   2. à 3 s au lieu de 1 s (l'expiration n'a pas besoin d'être à la seconde près).
  const [now, setNow] = useState(Date.now())
  const hasLiveActivity = useMemo(() => {
    const t = Date.now()
    if (localPointer && (t - localPointer.at) < 60_000) return true
    return users.some(u => u.uid !== user?.uid && (
      (u.livePointer  && (t - (u.livePointer.updatedAt  ?? 0)) < 60_000) ||
      (u.liveLocation && (t - (u.liveLocation.updatedAt ?? 0)) < 10 * 60_000)
    ))
    // `now` en dépendance : réévalue l'activité au fil des ticks pour stopper l'interval
    // dès que tout est expiré.
  }, [users, user?.uid, localPointer, now])
  useEffect(() => {
    if (!hasLiveActivity) return
    const t = setInterval(() => setNow(Date.now()), 3000)
    return () => clearInterval(t)
  }, [hasLiveActivity])

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
  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'map_pins')),
      snap => setPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))),
      err => console.error('[Map] map_pins subscription error:', err.code, err.message)
    )
    // Le listener `users` vit dans UsersProvider — partagé entre Tasks/Map/Dashboard/etc.
    // Avant : 1 listener par page consommatrice (9× en parallèle).
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
    return () => { u1(); u3() }
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
    setRenamingPin(false)
    setRenameValue('')
  }, [selected?.id])

  /**
   * Garde anti-temp pour la défense en profondeur (audit Nils 23/05/2026).
   * Toutes les écritures Firestore réservées aux réguliers (map_pins, config,
   * etc.) doivent passer ce garde AVANT le batch — sinon Firestore refuse et
   * remonte un `unhandledrejection` "Missing or insufficient permissions"
   * dans la console utilisatrice (cf. bug.json #5 Chacha).
   *
   * Note : la plupart des UI sont déjà cachées aux temps via `!isTemp`. Ce
   * garde est une ceinture+bretelles pour les chemins de code qui pourraient
   * exposer une action (drag, callbacks, etc.) sans vérification visuelle.
   */
  function assertRegularUser(): boolean {
    if (isTemp) {
      // Silent : pas d'alert (l'UI ne devrait jamais déclencher ça pour un temp).
      // Si ça arrive c'est un bug UI, on l'arrête côté backend avant la requête.
      console.debug('[isTemp] action régulière bloquée — vérifier l\'UI exposante')
      return false
    }
    return true
  }

  // Commit du rename : update Firestore + selected local pour feedback immédiat.
  async function commitRename() {
    if (!assertRegularUser()) return
    if (!selected || !user) return
    const next = renameValue.trim()
    if (!next || next === selected.name) {
      setRenamingPin(false)
      return
    }
    try {
      await updateDoc(doc(db, 'map_pins', selected.id), {
        name: next,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      setSelected({ ...selected, name: next })
    } catch (e) {
      console.warn('[map] rename:', e)
      alert("Échec du renommage. Réessaye dans un instant.")
    } finally {
      setRenamingPin(false)
    }
  }

  // Historique : abonnement lazy uniquement quand un enclos est sélectionné ET le panneau ouvert.
  // Couvre fence.id ET fence.migratedToPlotId via `where in` (S2.5 compat migration).
  useEffect(() => {
    if (!selected || !historyVisible) return
    const ids = enclosureQueryIds(selected)
    const q = query(
      collection(db, 'enclosure_movements'),
      where('toEnclosureId', 'in', ids)
    )
    const q2 = query(
      collection(db, 'enclosure_movements'),
      where('fromEnclosureId', 'in', ids)
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
  }, [selected?.id, selected?.migratedToPlotId, historyVisible])

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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
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

  // S6 : édition unifiée des tracés. Le pin peut être fence, land_plot ou
  // water_stream — la logique de drag/insert/delete fonctionne pour tous.
  //
  // Important — distinguer 2 notions :
  //   isEditPinClosed = "ce pin se rend en Polygon (fermé visuellement)" → land_plot OU fence closed
  //   hasDuplicateLastPoint = "le dernier point de points[] est un doublon du premier" → fence closed UNIQUEMENT
  //
  // land_plot et water_stream stockent leurs points sans doublon. fence closed
  // historiquement stocke un doublon (compat avec l'ancien code de coupe ciseau).
  function isEditPinClosed(pin: MapPin): boolean {
    if (pin.type === 'land_plot') return true
    if (pin.type === 'water_stream') return false
    return isFenceClosed(pin)
  }
  function hasDuplicateLastPoint(pin: MapPin): boolean {
    return pin.type === 'fence' && isFenceClosed(pin)
  }
  function editColor(pin: MapPin): string {
    if (pin.type === 'land_plot')   return '#52B788'  // vert
    if (pin.type === 'water_stream') return '#0284C7' // bleu
    return pin.presetColor ?? '#EA580C'               // fence : preset ou orange
  }

  function startEditFence(pin: MapPin) {
    if (!pin.points || pin.points.length < 2) return
    if (isTemp) {
      alert("L'édition du tracé est réservée aux utilisateurs réguliers.")
      return
    }
    setFenceEditPin(pin)
    setFenceEditPoints(pin.points.map(p => ({ ...p })))
    setEditMode('move') // mode par défaut : déplacer
    // Ferme les autres panneaux pour libérer la carte
    setSelected(null)
    setEditOccupants(false)
    setEditEnclosureAnimals(false)
    // Bug Nils V4 #2 (24/05/2026) : reset tous les drafts de création pour ne
    // pas voir de pin/poteau fantôme apparaitre en mode édition. Cas typique :
    // l'utilisatrice a commencé à tracer une clôture, a abandonné via setSelected
    // (qui ne fait que setFenceMode(false) sans nettoyer fencePoints), puis a
    // ouvert l'édition d'une autre clôture → les anciens points restaient.
    setPendingPos(null)
    setAddMode(false)
    setFenceMode(false)
    setFencePoints([])
    setFenceFormVisible(false)
    setFenceIsClosed(false)
    setFenceSnapTarget(null)
    setStreamMode(false)
    setStreamPoints([])
    setPlotMode(false)
    setPlotPoints([])
    setHoleMode(false)
    setHolePoints([])
    setHolePlotId(null)
    setPointerMode(false)
  }

  function cancelEditFence() {
    setFenceEditPin(null)
    setFenceEditPoints([])
    setEditRangeStart(null)
    setEditRangeEnd(null)
    setEditMode('move')
    showSnapRing(null)
  }

  // Déplace le point #idx vers (lat, lng). Si le polygone est fermé
  // (dernier === premier), on synchronise les 2 pour garder la fermeture.
  function dragEditPoint(idx: number, lat: number, lng: number) {
    setFenceEditPoints(prev => {
      const next = prev.map((p, i) => i === idx ? { lat, lng } : p)
      // Maintien de la fermeture : si le pin est un enclos fermé, le dernier
      // point doit rester égal au premier après n'importe quel drag.
      if (fenceEditPin && hasDuplicateLastPoint(fenceEditPin) && next.length >= 2) {
        if (idx === 0) next[next.length - 1] = { lat, lng }
        else if (idx === next.length - 1) next[0] = { lat, lng }
      }
      return next
    })
  }

  // Bug Nils V7 (rapports snap édition) : en mode édition, un poteau qu'on déplace
  // doit se caler ("snap") sur le sommet/contour le plus proche d'une AUTRE clôture
  // ou d'un espace (land_plot), comme c'est déjà le cas en mode création. Retourne
  // la cible magnétique dans le rayon SNAP_RADIUS_PX, ou null si rien d'assez proche.
  function snapEditPoint(lat: number, lng: number): { lat: number; lng: number } | null {
    const map = mapRef.current
    if (!map) return null
    const editId = fenceEditPin?.id
    const dragPx = map.latLngToContainerPoint(L.latLng(lat, lng))
    let best: { lat: number; lng: number } | null = null
    let bestDist = SNAP_RADIUS_PX
    const consider = (v: { lat: number; lng: number }) => {
      const vp = map.latLngToContainerPoint(L.latLng(v.lat, v.lng))
      const d  = Math.hypot(dragPx.x - vp.x, dragPx.y - vp.y)
      if (d < bestDist) { bestDist = d; best = { lat: v.lat, lng: v.lng } }
    }
    for (const pin of pins) {
      if (pin.id === editId) continue                              // jamais soi-même
      if (pin.type !== 'fence' && pin.type !== 'land_plot') continue
      for (const v of pin.points ?? []) consider(v)
      for (const h of pin.holes ?? []) for (const v of h.points) consider(v)
    }
    return best
  }

  // Affiche/déplace/efface l'anneau de snap en mode édition SANS passer par React
  // (cf. snapMarkerRef) — indispensable pour ne pas perturber le drag Leaflet en cours.
  function showSnapRing(pos: { lat: number; lng: number } | null) {
    const map = mapRef.current
    if (!map) return
    if (!pos) {
      if (snapMarkerRef.current) { snapMarkerRef.current.remove(); snapMarkerRef.current = null }
      return
    }
    if (snapMarkerRef.current) {
      snapMarkerRef.current.setLatLng([pos.lat, pos.lng])
    } else {
      snapMarkerRef.current = L.marker([pos.lat, pos.lng], {
        icon: makeSnapIcon(false), interactive: false, zIndexOffset: 1000,
      }).addTo(map)
    }
  }

  // Insère un nouveau poteau au milieu du segment [idx, idx+1].
  // Demande Eugénie 21/05/2026 : "ajouter un poteau entre 2 poteaux existants pour être plus précis".
  function insertEditPoint(afterIdx: number) {
    if (!fenceEditPin) return
    // P7 : décale les bornes de la sélection portion pour rester cohérent
    // avec les nouveaux indices.
    setEditRangeStart(s => (s !== null && s > afterIdx) ? s + 1 : s)
    setEditRangeEnd  (e => (e !== null && e > afterIdx) ? e + 1 : e)
    setFenceEditPoints(prev => {
      const a = prev[afterIdx]
      const b = prev[afterIdx + 1]
      if (!a || !b) return prev
      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
      const next = [...prev.slice(0, afterIdx + 1), mid, ...prev.slice(afterIdx + 1)]
      return next
    })
  }

  // Supprime le point #idx. Refuse si ça casse la géométrie (< 2 pts ouvert, < 3 pts polygone).
  function removeEditPoint(idx: number) {
    if (!fenceEditPin) return
    const polygon = isEditPinClosed(fenceEditPin)
    const hasDup  = hasDuplicateLastPoint(fenceEditPin)
    // P7 : la suppression d'un poteau décale les indices → invalide la
    // sélection portion en cours.
    setEditRangeStart(null)
    setEditRangeEnd(null)
    setFenceEditPoints(prev => {
      // Polygon : min 3 sommets distincts (+1 doublon final si fence closed)
      // Polyline : min 2 points
      const minPts = polygon ? (hasDup ? 4 : 3) : 2
      if (prev.length <= minPts) {
        alert(polygon
          ? "Un espace ou un enclos fermé doit garder au moins 3 points."
          : "Une clôture ou un cours d'eau doit garder au moins 2 points.")
        return prev
      }
      // Si on supprime le 1ᵉʳ et que le polygone est fermé AVEC doublon final (fence),
      // le nouveau 1ᵉʳ doit devenir le dernier
      let next = prev.filter((_, i) => i !== idx)
      if (hasDup && idx === 0 && next.length >= 1) {
        next = [...next, { ...next[0] }]
        next.splice(prev.length - 1, 1) // retire l'ancien dernier
      }
      return next
    })
  }

  async function saveEditFence() {
    if (!assertRegularUser()) return
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
      setEditRangeStart(null)
      setEditRangeEnd(null)
      showSnapRing(null)
    } catch (err) {
      console.error('[saveEditFence]', err)
      alert("Échec enregistrement. Réessaye dans un instant.")
    } finally {
      setFenceEditSaving(false)
    }
  }

  // P7 (Nils 22/05/2026) : sélection d'une portion de poteaux en mode édition.
  // Clic sur un poteau réel (single-tap) → toggle start/end. Logique séquentielle :
  //   - aucun start          → start = idx
  //   - start, pas end       → si re-tap sur start, on annule ; sinon end = idx
  //   - start && end définis → on repart de zéro : start = idx, end = null
  function handleEditPostClick(idx: number) {
    if (!fenceEditPin) return
    // Ignore le doublon final pour les fences fermés (jamais cliquable visuellement)
    if (hasDuplicateLastPoint(fenceEditPin) && idx === fenceEditPoints.length - 1) return

    if (editRangeStart === null) {
      setEditRangeStart(idx)
      setEditRangeEnd(null)
      return
    }
    if (editRangeEnd === null) {
      if (idx === editRangeStart) {
        setEditRangeStart(null)  // annule la sélection
      } else {
        setEditRangeEnd(idx)
      }
      return
    }
    // Range complet → reset et redémarre avec ce clic
    setEditRangeStart(idx)
    setEditRangeEnd(null)
  }

  function clearEditRange() {
    setEditRangeStart(null)
    setEditRangeEnd(null)
  }

  // Indices ordonnés (start ≤ end) — utile pour la visualisation et le split
  const editRangeOrdered = (editRangeStart !== null && editRangeEnd !== null)
    ? { iA: Math.min(editRangeStart, editRangeEnd), iB: Math.max(editRangeStart, editRangeEnd) }
    : null

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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
    if (!user) return
    const next = Math.max(1, Math.min(8, (pin.wireCount ?? 1) + delta))
    setActionBusy(true)
    try {
      await updateDoc(doc(db, 'map_pins', pin.id), {
        wireCount: next, updatedAt: Date.now(), updatedBy: user.uid,
      })
    } finally { setActionBusy(false) }
  }

  // P7 (Nils 22/05/2026) : applique un nouveau preset à une portion [iA..iB]
  // de la clôture en cours d'édition. Logique identique à `splitFence()`
  // mais paramétrée (pas de `scissorMode`) et basée sur les points en cours
  // d'édition (donc inclut les drags/inserts non encore sauvés).
  //
  // Effet :
  //   - Fence ouverte : original supprimé, 2-3 nouveaux segments créés
  //                     dont le segment central porte le nouveau preset.
  //   - Fence fermée  : original → fillOnly (gardé comme polygon pour les
  //                     données dérivées), segments de contour créés et
  //                     liés via cutFromId.
  async function applyPresetToRange(
    fence:     MapPin,
    points:    { lat: number; lng: number }[],
    iA:        number,
    iB:        number,
    newPreset: FencePreset,
  ) {
    if (!assertRegularUser()) return
    if (!user) return
    if (iA >= iB) return
    if (iB >= points.length) return
    setEditRangeApplying(true)
    try {
      const now = Date.now()
      const closed = isFenceClosed(fence)
      const parentId = fence.id

      type Seg = { points: { lat: number; lng: number }[]; useNewPreset: boolean }
      const segs: Seg[] = []
      if (iA > 0)              segs.push({ points: points.slice(0, iA + 1), useNewPreset: false })
                               segs.push({ points: points.slice(iA, iB + 1), useNewPreset: true  })
      if (iB < points.length - 1) segs.push({ points: points.slice(iB),     useNewPreset: false })

      if (closed) {
        // Fence fermée : original conservé en fillOnly. On met à jour ses
        // points avec la version éditée (consistance des données dérivées).
        await updateDoc(doc(db, 'map_pins', parentId), {
          fillOnly:  true,
          points,
          updatedAt: now,
          updatedBy: user.uid,
        })
      } else {
        // Fence ouverte : supprimer l'original avant de créer les segments
        await deleteDoc(doc(db, 'map_pins', parentId))
      }

      const inheritedParent = closed ? null : (fence.cutFromId ?? null)

      for (const seg of segs) {
        if (seg.points.length < 2) continue
        const cLat = seg.points.reduce((s, p) => s + p.lat, 0) / seg.points.length
        const cLng = seg.points.reduce((s, p) => s + p.lng, 0) / seg.points.length
        const docData: Record<string, unknown> = {
          name:        fence.name,
          type:        'fence',
          note:        closed ? '' : (fence.note ?? ''),
          lat:         cLat,
          lng:         cLng,
          points:      seg.points,
          presetId:    seg.useNewPreset ? newPreset.id    : (fence.presetId    ?? null),
          presetColor: seg.useNewPreset ? newPreset.color : (fence.presetColor ?? '#EA580C'),
          wireCount:   fence.wireCount ?? 1,
          status:      'ok',
          createdAt:   now,
          createdBy:   user.uid,
          updatedAt:   now,
        }
        // Pour fence fermée : cutFromId pointe vers le parent (fillOnly) pour
        // que le groupe de pâturage reste cohérent. Pour fence ouverte :
        // hérite du cutFromId du parent si présent (segment-enfant d'un enclos).
        if (closed) docData.cutFromId = parentId
        else if (inheritedParent) docData.cutFromId = inheritedParent
        await addDoc(collection(db, 'map_pins'), docData)
      }

      // Sortie propre du mode édition après application
      setFenceEditPin(null)
      setFenceEditPoints([])
      setEditRangeStart(null)
      setEditRangeEnd(null)
      setEditRangePresetVisible(false)
    } catch (err) {
      console.error('[applyPresetToRange]', err)
      alert("Échec du changement de fil. Réessaye dans un instant.")
    } finally {
      setEditRangeApplying(false)
    }
  }

  async function updateFenceVoltage(pin: MapPin, voltage: number | null) {
    if (!assertRegularUser()) return
    if (!user) return
    await updateDoc(doc(db, 'map_pins', pin.id), {
      wireVoltage: voltage ?? null, updatedAt: Date.now(), updatedBy: user.uid,
    })
  }

  async function saveFence() {
    if (!assertRegularUser()) return
    if (!user || !fenceName.trim() || fencePoints.length < 2) return
    // Snapshot des données + fermeture UI immédiate
    const now = Date.now()
    const centerLat = fencePoints.reduce((s, p) => s + p.lat, 0) / fencePoints.length
    const centerLng = fencePoints.reduce((s, p) => s + p.lng, 0) / fencePoints.length
    const payload: Record<string, unknown> = {
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

    // S7 — détection de scindage : si le tracé traverse un land_plot actif
    // de part en part, on bascule sur la modal de découpage au lieu d'écrire
    // la clôture telle quelle. Le caller (la modal) reprendra la main pour
    // créer atomiquement les 2 enfants + la clôture.
    const splitCandidates = pins.filter(p =>
      p.type === 'land_plot' && !p.inactive && (p.points?.length ?? 0) >= 3,
    )
    const split = detectPlotSplit(fencePoints, splitCandidates)
    if (split) {
      cancelFence()
      setPendingSplit({ plot: split.plot, split: split.split, payload })
      return
    }

    // P4 (Nils 22/05/2026) : si la clôture touche un espace mais ne le scinde
    // pas (zigzag, même bord, polygone résultant trop petit…), on explique
    // pourquoi au lieu de créer silencieusement la clôture par-dessus.
    const nearMiss = diagnoseSplitFailure(fencePoints, splitCandidates)
    if (nearMiss) {
      const proceed = confirm(
        `Impossible de scinder l'espace "${nearMiss.plot.name ?? 'sans nom'}" :\n\n` +
        nearMiss.error.message + '\n\n' +
        'Créer quand même la clôture par-dessus l\'espace ?',
      )
      if (!proceed) return  // l'utilisatrice peut continuer à dessiner / annuler
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

  // S7.4 — exécute le scindage : crée 2 land_plots enfants, marque le parent
  // inactif, écrit la clôture avec splitsPlotId, redirige les animaux selon
  // le choix de l'utilisatrice. Tout en 1 writeBatch atomique.
  async function confirmSplit(choice: ScindageChoice) {
    if (!assertRegularUser()) return
    if (!user || !pendingSplit) return
    const { plot: parent, split, payload } = pendingSplit
    const now = Date.now()

    // Pré-génère les 3 ids client-side pour pouvoir les référencer entre eux
    // dans le même batch (splitsPlotId, parentPlotId, animal.enclosureId).
    const child1Ref = doc(collection(db, 'map_pins'))
    const child2Ref = doc(collection(db, 'map_pins'))
    const fenceRef  = doc(collection(db, 'map_pins'))

    const centroid = (pts: { lat: number; lng: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    })
    const c1 = centroid(split.p1)
    const c2 = centroid(split.p2)

    const batch = writeBatch(db)

    // Enfant 1 — hérite du parent (preset visuel, etc. n'ont pas de sens sur
    // land_plot, on garde juste l'essentiel pour le placement animaux).
    batch.set(child1Ref, {
      name:         choice.name1,
      type:         'land_plot',
      lat:          c1.lat,
      lng:          c1.lng,
      points:       split.p1,
      parentPlotId: parent.id,
      createdAt:    now,
      createdBy:    user.uid,
      updatedAt:    now,
    })
    // Enfant 2
    batch.set(child2Ref, {
      name:         choice.name2,
      type:         'land_plot',
      lat:          c2.lat,
      lng:          c2.lng,
      points:       split.p2,
      parentPlotId: parent.id,
      createdAt:    now,
      createdBy:    user.uid,
      updatedAt:    now,
    })
    // Parent → inactif (gardé pour la fusion auto à S8)
    batch.update(doc(db, 'map_pins', parent.id), {
      inactive:        true,
      updatedAt:       now,
      updatedBy:       user.uid,
    })
    // Clôture qui a scindé — porte splitsPlotId pour permettre la fusion S8
    batch.set(fenceRef, {
      ...payload,
      splitsPlotId: parent.id,
      updatedAt:    now,
    })

    // Redirection des animaux qui étaient placés dans le parent
    for (const [animalId, target] of Object.entries(choice.animalChoice)) {
      const newEnclosureId = target === 'p1' ? child1Ref.id : child2Ref.id
      batch.update(doc(db, 'animals', animalId), { enclosureId: newEnclosureId })
    }

    setSaving(true)
    try {
      await batch.commit()
      setPendingSplit(null)
    } catch (err) {
      console.error('[confirmSplit]', err)
      const code = (err as { code?: string })?.code
      alert(code === 'permission-denied'
        ? 'Permissions insuffisantes : ta session a peut-être expiré.'
        : 'Erreur lors du découpage. Réessayez quand la connexion est meilleure.')
    } finally {
      setSaving(false)
    }
  }

  // Annule le découpage : la clôture n'est PAS créée. L'utilisatrice doit
  // refaire son tracé si elle veut continuer. (On préfère cette approche à
  // une création silencieuse de la clôture sans scinder — l'intention de
  // tracer une clôture qui traverse un espace est ambiguë.)
  function cancelSplit() {
    setPendingSplit(null)
  }

  /* ─── enregistrer pin standard ─── */

  async function savePin(e: React.FormEvent) {
    if (!assertRegularUser()) return
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

      // Pin "à faire" : init en statut "ouvert". La description est dans note,
      // la complétion se fait depuis le panneau de détail (bouton "✓ Fait").
      if (form.type === 'todo') {
        Object.assign(base, { todoStatus: 'open' })
      }

      // Pin perso : emoji + couleur indicatifs. La description est dans note.
      if (form.type === 'custom') {
        Object.assign(base, {
          customEmoji: form.customEmoji || CUSTOM_EMOJIS[0],
          customColor: form.customColor || CUSTOM_COLORS[0],
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
    if (!assertRegularUser()) return
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
      // Auto-validation des tâches liées (demande Nils 25/05/2026) :
      // si une tâche pointe vers ce point d'eau, on la coche en même temps.
      await completeLinkedTasks('water_manual', pin.id, user.uid)
    } finally { setActionBusy(false) }
  }

  /* ─── eau naturelle : changer statut ─── */

  async function setWaterNaturalStatus(pin: MapPin, waterStatus: string) {
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
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
    if (!user) return

    // Pin à supprimer (lu depuis la mémoire pour pas re-fetch)
    const pinToDelete = pins.find(p => p.id === pinId)

    // ── S8 — fusion auto si on supprime une clôture qui a scindé un land_plot.
    // Demande Nils 24/05/2026 (V4 #3) : "j'ai supprimé la clôture rouge mais les
    // 2 terrains n'ont pas refusionné". La logique S7 (scindage) créait bien les
    // enfants + flagait le parent inactive, mais S8 (suppression de la clôture
    // scindante = retour à l'état d'origine) n'avait jamais été codée.
    //
    // Comportement attendu :
    //   1. Lire splitsPlotId sur la clôture supprimée → trouver le parent + ses enfants directs.
    //   2. Si l'un des enfants a lui-même été re-scindé (descendants actifs), refuser
    //      la fusion et avertir l'utilisateur (sinon on perdrait les sous-divisions).
    //   3. Sinon, dans le même batch atomique :
    //      - rapatrier les animaux des enfants vers le parent (enclosureId = parent.id)
    //      - supprimer les enfants
    //      - réactiver le parent (inactive: false)
    //      - supprimer la clôture
    const splitParentId = pinToDelete?.splitsPlotId
    let mergeParent: MapPin | null = null
    let mergeChildren: MapPin[] = []
    let animalsToRehome: Animal[] = []
    if (splitParentId) {
      const parent = pins.find(p => p.id === splitParentId && p.type === 'land_plot')
      if (parent) {
        // Enfants directs : land_plots qui pointent vers ce parent.
        // Note : on exclut le parent lui-même par sécurité (parentPlotId ne devrait
        // jamais s'auto-référencer mais c'est de la défense en profondeur).
        const children = pins.filter(p =>
          p.type === 'land_plot' &&
          p.parentPlotId === splitParentId &&
          p.id !== splitParentId
        )
        // Si un enfant est lui-même parent d'une sous-division encore active,
        // on bloque la fusion pour ne pas perdre la sous-structure.
        const hasActiveSubsplit = children.some(c =>
          pins.some(p =>
            p.type === 'land_plot' &&
            p.parentPlotId === c.id &&
            !p.inactive
          )
        )
        if (hasActiveSubsplit) {
          alert(
            "Cette clôture ne peut pas être supprimée tant que les sous-divisions existent.\n\n" +
            "Supprime d'abord les clôtures qui scindent les sous-espaces, puis réessaye."
          )
          // Ré-ouvrir le panneau (l'utilisateur l'avait peut-être fermé déjà)
          if (pinToDelete) setSelected(pinToDelete)
          return
        }
        mergeParent     = parent
        mergeChildren   = children
        const childIds  = new Set(children.map(c => c.id))
        animalsToRehome = animals.filter(a => a.enclosureId && childIds.has(a.enclosureId))
      }
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
    const now = Date.now()
    const batch = writeBatch(db)
    for (const a of toFree)    batch.update(doc(db, 'animals',    a.id), { enclosureId: null })
    for (const s of childSegs) batch.delete(doc(db, 'map_pins',   s.id))
    for (const p of attachedPhotos) batch.delete(doc(db, 'pin_photos', p.id))
    // S8 — fusion
    if (mergeParent) {
      for (const a of animalsToRehome) {
        batch.update(doc(db, 'animals', a.id), { enclosureId: mergeParent.id })
      }
      for (const c of mergeChildren) {
        batch.delete(doc(db, 'map_pins', c.id))
      }
      batch.update(doc(db, 'map_pins', mergeParent.id), {
        inactive:  false,
        updatedAt: now,
        updatedBy: user.uid,
      })
    }
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
    if (!assertRegularUser()) return
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
    if (!assertRegularUser()) return
    if (!user) return
    // Fermeture UI immédiate — pas d'attente perçue
    setEditEnclosureAnimals(false)

    const now = Date.now()
    const targetEnclosure = pins.find(p => p.id === fenceId)
    // S2.5 compat migration : si le fence a un jumeau land_plot, on écrit
    // l'identifiant logique du land_plot. Sinon on garde le fence.id.
    // Côté lecture, le helper effectiveEnclosureId fait la même translation.
    const targetId = targetEnclosure?.migratedToPlotId ?? fenceId
    // 1 seul writeBatch = 1 round-trip réseau pour tous les changements
    const batch = writeBatch(db)
    let hasChanges = false

    // Date du déplacement : par défaut maintenant, mais l'utilisateur peut
    // l'avoir saisie via le sélecteur "date du mouvement" (rétroactif).
    const movedAtTs = pendingMoveDate ? dateInputToTsLocal(pendingMoveDate) : now

    for (const a of animals) {
      const shouldBe = pendingEnclosureAnimals.includes(a.id)
      const isCurrent = a.enclosureId === targetId
      if (shouldBe && !isCurrent) {
        batch.update(doc(db, 'animals', a.id), { enclosureId: targetId })
        const fromEnc = a.enclosureId ? pins.find(p => p.id === a.enclosureId || p.migratedToPlotId === a.enclosureId) : null
        const moveRef = doc(collection(db, 'enclosure_movements'))
        batch.set(moveRef, {
          animalId: a.id, animalName: a.name, species: a.species,
          fromEnclosureId: a.enclosureId, fromEnclosureName: fromEnc?.name ?? null,
          toEnclosureId: targetId,        toEnclosureName: targetEnclosure?.name ?? null,
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
          fromEnclosureId: targetId, fromEnclosureName: targetEnclosure?.name ?? null,
          toEnclosureId: null,       toEnclosureName: null,
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

  // Perf Nils 23/05/2026 : useMemo sur les filters lourds. Avant ils
  // recomputaient à CHAQUE render (et il y en a beaucoup vu la taille du
  // composant), maintenant uniquement quand `pins` change.
  const overduePins  = useMemo(
    () => new Set(pins.filter(p => isWaterOverdue(p) || isBatteryDue(p)).map(p => p.id)),
    [pins],
  )
  const fencePins    = useMemo(
    () => pins.filter(p => p.type === 'fence' && (p.points?.length ?? 0) >= 2),
    [pins],
  )
  // Ids des land_plots qui ont un fence jumeau (migration S3). On ne les rend
  // S9 : avant on filtrait les jumeaux migrés pour les rendre via leur fence.
  // Désormais une clôture n'est jamais un espace, donc tous les land_plots
  // (y compris les jumeaux S3) doivent se dessiner eux-mêmes. Demande Nils
  // 22/05/2026 : "lorsque on referme une clôture ça crée une zone, on veut
  // pas du tout ça". Les plots scindés (S7) restent masqués via `inactive`.
  const landPlotPins = useMemo(
    () => pins.filter(p =>
      p.type === 'land_plot'
      && (p.points?.length ?? 0) >= 3
      && !p.inactive,
    ),
    [pins],
  )
  const nonFencePins = useMemo(
    () => pins.filter(p => {
      // Bug Nils 22/05/2026 : pas d'épingle 🏞️ pour les water_stream tracés —
      // l'utilisateur veut juste voir le fil d'eau, sans la bulle emoji qui
      // surcharge le visuel. On retombe sur l'épingle pour les streams orphelins
      // (sans points — incident de saisie) pour qu'ils restent sélectionnables.
      if (p.type === 'water_stream' && (p.points?.length ?? 0) >= 2) return false
      if (p.type === 'fence' && (p.points?.length ?? 0) >= 2)        return false
      if (p.type === 'land_plot')                                     return false  // jamais des Markers
      return true
    }),
    [pins],
  )
  // P3 : pendant l'édition d'un tracé (fenceEditPin actif), on ne veut AUCUNE
  // interaction avec les autres pins de la carte — l'utilisatrice se concentre
  // uniquement sur ses points. Inclus dans anyModeActive pour désactiver tous
  // les onClick gardés par ce guard.
  const inTraceEdit = fenceEditPin !== null
  const anyModeActive = addMode || fenceMode || pointerMode || streamMode || plotMode || holeMode || inTraceEdit

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
    const preset = fencePresets.find(p => p.id === pin.presetId)
    const base = getFenceVisualState(pin, preset, pins)
    // Bug Nils 22/05/2026 : animation "le courant circule" quand la clôture est
    // électrique, sous tension, alimentée par une batterie ALLUMÉE — et qu'on
    // est zoomé suffisamment pour la voir sans alourdir l'UX en vue large.
    const isElectric = preset?.wireStyle === 'electric'
    const intensity  = pin.electricityIntensity ?? 'full'
    const battery    = pin.connectedBatteryId
      ? pins.find(p => p.id === pin.connectedBatteryId)
      : null
    const isPowered  = isElectric && intensity !== 'off'
      && (!pin.connectedBatteryId || (battery && battery.powerOn !== false))
    if (isPowered && mapZoom >= LABEL_ZOOM_MED) {
      return { ...base, dashArray: '10 6', className: 'fence-electric-flow' }
    }
    return base
  }

  /* ─── couches lourdes mémoïsées (Perf Nils 03/06, lot C) ──────────────────
     Ces trois groupes (espaces, clôtures, labels) étaient reconstruits à CHAQUE
     render du composant (ouverture d'un panneau, update GPS, frappe dans un
     formulaire…). On les mémoïse sur leurs vraies dépendances : ils ne se
     recalculent plus que quand leurs données bougent. Comportement identique. */
  const landPlotLayers = useMemo(() => landPlotPins.map(pin => {
    const enc = sortAnimalsByName(animals.filter(a => a.enclosureId === pin.id))
    const outer = pin.points!.map(p => [p.lat, p.lng] as [number, number])
    const holesPos = (pin.holes ?? [])
      .filter(h => h.points.length >= 3)
      .map(h => h.points.map(p => [p.lat, p.lng] as [number, number]))
    const positions = holesPos.length > 0 ? [outer, ...holesPos] : outer
    const status = computeGrazingStatus(pin, fencePins, animals, allMovements)
    const fill = GRAZING_FILL[status]
    return (
      <Polygon
        key={pin.id + '-plot'}
        positions={positions}
        pathOptions={{
          color:       '#52B788',
          weight:      enc.length > 0 ? 3 : 2,
          opacity:     0.85,
          fillColor:   fill.color,
          fillOpacity: fill.opacity,
          dashArray:   enc.length > 0 ? undefined : '6 4',
        }}
        eventHandlers={{
          click: () => {
            if (!anyModeActive) setSelected(pin)
          },
        }}
      />
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [landPlotPins, animals, fencePins, allMovements, anyModeActive])

  const fenceLayers = useMemo(() =>
    fencePins
      .filter(pin => !pin.fillOnly)
      .map(pin => (
        <Polyline
          key={pin.id}
          positions={pin.points!.map(p => [p.lat, p.lng] as [number, number])}
          pathOptions={getFencePathOptions(pin)}
          interactive={false}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fencePins, fencePresets, pins, mapZoom])

  const landPlotLabels = useMemo(() => landPlotPins
    .filter(pin => {
      if (mapZoom < LABEL_ZOOM_LOW) return false
      if (mapZoom >= LABEL_ZOOM)    return true
      return animals.some(a => a.enclosureId === pin.id)
    })
    .map(pin => {
      const enc = sortAnimalsByName(animals.filter(a => a.enclosureId === pin.id))
      const labelPos = pin.points ? insidePolygonCentroid(pin.points) : { lat: pin.lat, lng: pin.lng }
      return (
        <Marker
          key={`label-${pin.id}`}
          position={[labelPos.lat, labelPos.lng]}
          icon={makeEnclosureLabelIcon(enc, mapZoom, customSpecies, pin.rotationDueAt)}
          interactive={false}
        />
      )
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landPlotPins, animals, mapZoom, customSpecies])

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
        ref={mapRef}
        center={initialView?.center ?? FARM}
        zoom={initialView?.zoom ?? ZOOM_DEFAULT}
        maxZoom={20}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        // Molette desktop plus douce (réglage inoffensif, répond au "zoom trop rapide").
        // Perf Nils 03/06 : preferCanvas / zoomSnap fractionnel / keepBuffer ont été
        // RETIRÉS — avec le serveur de tuiles IGN (lent), ils chargeaient plus de tuiles
        // et redessinaient les vecteurs sur canvas à chaque frame, ce qui empirait le pan.
        // On revient au rendu SVG natif (transformé par le navigateur au pan = quasi gratuit).
        wheelPxPerZoomLevel={120}
      >
        <TileLayer
          key={layer}
          url={layer === 'osm' ? OSM_TILES : layer === 'plan' ? IGN_PLAN : IGN_AERIAL}
          attribution={layer === 'osm' ? OSM_ATTR : IGN_ATTR}
          maxNativeZoom={layer === 'osm' ? 19 : 19}
          maxZoom={20}
          // Perf Nils 03/06 : pré-charge un anneau de tuiles AUTOUR de l'écran pour
          // qu'au déplacement elles soient déjà là (moins de "zones blanches"). Une
          // fois en cache (CacheFirst, cf. sw.ts), elles sont instantanées au retour.
          keepBuffer={4}
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
            (voir limites officielles de terrain par-dessus l'aérien).
            Bug Nils 03/06/2026 : depuis le passage de maxZoom à 20, les parcelles
            apparaissaient "corrompues" / ne chargeaient qu'à certains zooms. Cause :
            le service IGN CADASTRALPARCELS.PARCELLAIRE_EXPRESS ne sert nativement que
            jusqu'au zoom 19 (comme l'ortho/plan, plafonnés à 19). Avec maxNativeZoom=20
            Leaflet réclamait des tuiles z20 inexistantes → tuiles en erreur. On aligne
            sur 19 : Leaflet up-scale alors la tuile z19 au zoom 20 (parcelles continues). */}
        {showParcels && (
          <TileLayer
            key="parcels-overlay"
            url={IGN_PARCELS}
            attribution=""
            maxNativeZoom={19}
            maxZoom={20}
            opacity={0.7}
            zIndex={400}
          />
        )}

        <MapClickCapture
          addActive={addMode}
          // En mode auto, on désactive le tap-pour-ajouter : les points viennent du GPS,
          // pas du toucher. Le toolbar bascule en bouton "Capturer ce poteau".
          fenceActive={fenceMode && fenceMethod === 'manual' && !fenceFormVisible}
          pointerActive={pointerMode}
          onPointer={sendPointer}
          streamActive={streamMode && !streamFormVisible}
          onStreamPoint={(lat, lng) => setStreamPoints(prev => [...prev, { lat, lng }])}
          plotActive={plotMode && !plotFormVisible}
          onPlotPoint={(lat, lng) => setPlotPoints(prev => [...prev, { lat, lng }])}
          onPlotClose={() => {
            if (plotPoints.length >= 3) {
              setPlotFormName('')
              setPlotFormVisible(true)
            }
          }}
          plotFirstPoint={plotMode && !plotFormVisible && plotPoints.length >= 3 ? plotPoints[0] : null}
          holeActive={holeMode}
          onHolePoint={(lat, lng) => setHolePoints(prev => [...prev, { lat, lng }])}
          onHoleClose={async () => {
            // Sauvegarde directe : push le nouveau hole dans landplot.holes[]
            if (holePoints.length < 3 || !holePlotId || !user) return
            const plot = pins.find(p => p.id === holePlotId)
            if (!plot) return
            // Firestore interdit les tableaux imbriqués → on wrappe chaque hole
            // dans un objet { points } (bug Nils 22/05).
            const nextHoles = [...(plot.holes ?? []), { points: holePoints }]
            try {
              await updateDoc(doc(db, 'map_pins', holePlotId), {
                holes:     nextHoles,
                updatedAt: Date.now(),
                updatedBy: user.uid,
              })
              if (selected?.id === holePlotId) {
                setSelected({ ...plot, holes: nextHoles })
              }
            } catch (err) {
              console.error('[holeClose] save failed', err)
              alert("Erreur lors de l'enregistrement de la zone vide. Réessaye.")
            }
            setHoleMode(false)
            setHolePoints([])
            setHolePlotId(null)
          }}
          holeFirstPoint={holeMode && holePoints.length >= 3 ? holePoints[0] : null}
          onPin={handleMapClick}
          onFencePoint={handleFencePoint}
          onFenceClose={handleFenceClose}
          onSelect={pin => {
            // P3 : pendant l'édition d'un tracé, on bloque toute sélection
            // d'autres pins. L'utilisatrice se concentre uniquement sur ses
            // points (drag/insert/delete). Pour sortir, elle valide ou annule.
            if (fenceEditPin) return
            setSelected(pin)
            setAddMode(false)
            setFenceMode(false)
            setEditOccupants(false)
            setEditEnclosureAnimals(false)
            // Bug Nils V4 #2 (24/05/2026) : reset les drafts en abandonnant
            // fenceMode/streamMode/plotMode via sélection d'un pin, sinon les
            // points fantômes survivent et réapparaissent ailleurs.
            setFencePoints([])
            setStreamPoints([])
            setPlotPoints([])
          }}
          onSnapHover={setFenceSnapTarget}
          fencePins={fencePins}
          allPins={pins}
          fenceFirstPoint={fenceMode && fenceMethod === 'manual' && fencePoints.length >= 2 ? fencePoints[0] : null}
        />
        <FenceEditHitDetector
          editPin={fenceEditPin}
          points={fenceEditPoints}
          isClosed={fenceEditPin ? isEditPinClosed(fenceEditPin) : false}
          hasDup={fenceEditPin ? hasDuplicateLastPoint(fenceEditPin) : false}
          mode={editMode}
          onInsert={insertEditPoint}
          onRealClick={handleEditPostClick}
          onRemove={removeEditPoint}
        />
        <FlyHome trigger={flyTrigger} />
        <FlyToTarget target={flyTarget} />
        <ZoomTracker onZoom={setMapZoom} />

        {/* Curseur fantôme qui suit la souris */}
        {anyModeActive && !fenceFormVisible && (
          <CursorMarker active={true} type={fenceMode ? 'fence' : form.type} customEmoji={form.customEmoji} customColor={form.customColor} />
        )}

        {/* ── Espaces définis (land_plot) — autonomes uniquement ── */}
        {/* Les land_plots avec un fence jumeau (migration S3) ne sont pas rendus
            ici : leur fence jumeau couvre déjà le visuel.
            Les holes (zones vides intérieures) sont rendus comme polygons imbriqués —
            Leaflet supporte le format [outer, ...holes] pour découper le fill. */}
        {!isCatHidden('space') && landPlotLayers}

        {/* ── Clôtures ──
            S9 : une clôture est TOUJOURS une polyline, peu importe son état
            (ouverte, bouclée, ex-enclos). Le rôle d'espace appartient
            uniquement aux land_plot. Demande Nils 22/05/2026.
            (Couches mémoïsées — cf. landPlotLayers/fenceLayers/landPlotLabels.) */}
        {!isCatHidden('fence') && fenceLayers}

        {/* Labels animaux dans les espaces (land_plot) — position GARANTIE à l'intérieur du polygone.
            S9 : les labels appartiennent désormais aux land_plot, pas aux fences fermés.
            Bug Eugénie 20/05/2026 : ne pas afficher "Vide" en vue large — ça surcharge la carte. */}
        {!isCatHidden('space') && landPlotLabels}

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

        {/* Cours d'eau en cours de dessin */}
        {streamMode && streamPoints.length > 0 && (
          <>
            <Polyline
              positions={streamPoints.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: '#0284C7', weight: 4, dashArray: '8 6', opacity: 0.8 }}
              interactive={false}
            />
            {streamPoints.map((p, i) => (
              <Marker
                key={`stream-draw-${i}`}
                position={[p.lat, p.lng]}
                icon={FENCE_DOT_ICON}
                interactive={false}
              />
            ))}
          </>
        )}

        {/* Espace en cours de dessin (mode "Définir un espace") */}
        {plotMode && plotPoints.length > 0 && (
          <>
            <Polyline
              positions={plotPoints.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: '#52B788', weight: 3, dashArray: '8 6', opacity: 0.85 }}
              interactive={false}
            />
            {plotPoints.map((p, i) => (
              <Marker
                key={`plot-draw-${i}`}
                position={[p.lat, p.lng]}
                icon={i === 0 && plotPoints.length >= 3 ? FENCE_FIRST_DOT_ICON : FENCE_DOT_ICON}
                interactive={false}
              />
            ))}
          </>
        )}

        {/* Zone vide en cours de dessin (mode hole) — orange pour distinguer */}
        {holeMode && holePoints.length > 0 && (
          <>
            <Polyline
              positions={holePoints.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: '#EA580C', weight: 3, dashArray: '6 4', opacity: 0.85 }}
              interactive={false}
            />
            {holePoints.map((p, i) => (
              <Marker
                key={`hole-draw-${i}`}
                position={[p.lat, p.lng]}
                icon={i === 0 && holePoints.length >= 3 ? FENCE_FIRST_DOT_ICON : FENCE_DOT_ICON}
                interactive={false}
              />
            ))}
          </>
        )}

        {/* Cours d'eau enregistrés — un segment Polyline par paire de points consécutifs,
            pour pouvoir afficher des atténuations manuelles différentes selon le tronçon
            (Phase 2 demande Eugénie 21/05/2026). */}
        {!isCatHidden('water') && pins.filter(p => p.type === 'water_stream' && (p.points?.length ?? 0) >= 2).flatMap(pin => {
          const segments = getStreamSegments(pin, new Date().getMonth() + 1)
          // Bug Nils 22/05/2026 : hitbox élargie pour la sélection — un trait
          // invisible (opacity 0) plus épais doublé du trait visuel donne au doigt
          // une cible facile à toucher sur mobile. Le visuel garde son weight d'origine.
          const allPositions = (pin.points ?? []).map(p => [p.lat, p.lng] as [number, number])
          return [
            <Polyline
              key={`${pin.id}-hit`}
              positions={allPositions}
              pathOptions={{ color: '#000', weight: 22, opacity: 0 }}
              eventHandlers={{
                click: () => { if (!anyModeActive) setSelected(pin) },
              }}
            />,
            ...segments.map(seg => (
              <Polyline
                key={`${pin.id}-seg-${seg.fromIndex}`}
                positions={[[seg.a.lat, seg.a.lng], [seg.b.lat, seg.b.lng]] as Array<[number, number]>}
                pathOptions={{
                  color:     seg.color,
                  weight:    seg.weight,
                  opacity:   seg.opacity,
                  dashArray: seg.dashArray,
                }}
                interactive={false}
              />
            )),
          ]
        })}

        {/* ── Édition d'une clôture existante : aperçu live + markers draggables ── */}
        {fenceEditPin && fenceEditPoints.length > 0 && (() => {
          const editPolygon = isEditPinClosed(fenceEditPin)
          const editHasDup  = hasDuplicateLastPoint(fenceEditPin)
          const color       = editColor(fenceEditPin)
          return (
            <>
              {editPolygon ? (
                <Polygon
                  positions={fenceEditPoints.map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{
                    color,
                    weight: 3,
                    dashArray: '6 4',
                    opacity: 0.9,
                    fillColor: color,
                    fillOpacity: 0.1,
                  }}
                  interactive={false}
                />
              ) : (
                <Polyline
                  positions={fenceEditPoints.map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{
                    color,
                    weight: 3,
                    dashArray: '6 4',
                    opacity: 0.9,
                  }}
                  interactive={false}
                />
              )}
              {fenceEditPoints.map((p, i) => {
                // Cache le doublon final UNIQUEMENT pour les fences fermés
                // (land_plot stocke sans doublon, water_stream est ouvert).
                if (editHasDup && i === fenceEditPoints.length - 1) return null
                // Bug Nils #7 22/05/2026 : drag uniquement en mode 'move'. Dans les
                // autres modes, le tap est interprété par FenceEditHitDetector.
                const canDrag = editMode === 'move'
                return (
                  <Marker
                    key={`edit-${i}`}
                    position={[p.lat, p.lng]}
                    icon={i === 0 ? FENCE_FIRST_DOT_ICON : FENCE_DOT_ICON}
                    draggable={canDrag}
                    // P2 : vrais poteaux au-dessus des ghosts (mid-dots) en cas
                    // de chevauchement hitbox → le doigt tape sur le poteau réel.
                    zIndexOffset={200}
                    eventHandlers={canDrag ? {
                      // Snap "constant" pendant le drag : l'anneau magnétique suit le
                      // sommet ciblé, piloté en impératif (showSnapRing) pour ne PAS
                      // re-rendre la carte et éviter l'oscillation marqueur/origine.
                      drag: (e) => {
                        const ll = e.target.getLatLng()
                        showSnapRing(snapEditPoint(ll.lat, ll.lng))
                      },
                      dragend: (e) => {
                        const ll = e.target.getLatLng()
                        const s = snapEditPoint(ll.lat, ll.lng)
                        const target = s ?? { lat: ll.lat, lng: ll.lng }
                        showSnapRing(null)
                        dragEditPoint(i, target.lat, target.lng)
                      },
                    } : {}}
                  />
                )
              })}

              {/* Anneaux violets de sélection portion — visibles uniquement en
                  mode 'cut' (refonte #4+#7 22/05/2026 : la sélection range n'est
                  plus active en parallèle des autres modes). */}
              {editMode === 'cut' && fenceEditPoints.map((p, i) => {
                if (editHasDup && i === fenceEditPoints.length - 1) return null
                const inRange = (() => {
                  if (editRangeStart === null) return false
                  if (editRangeEnd === null) return i === editRangeStart
                  const iA = Math.min(editRangeStart, editRangeEnd)
                  const iB = Math.max(editRangeStart, editRangeEnd)
                  return i >= iA && i <= iB
                })()
                if (!inRange) return null
                return (
                  <Marker
                    key={`edit-sel-${i}`}
                    position={[p.lat, p.lng]}
                    icon={SELECTED_POST_RING_ICON}
                    interactive={false}
                    zIndexOffset={150}
                  />
                )
              })}

              {/* Markers ghost "+" au milieu de chaque segment — visibles
                  uniquement en mode 'add' (refonte #4+#7 : avant ils
                  encombraient la carte tout le temps et entraient en conflit
                  avec les poteaux réels selon Nils). */}
              {editMode === 'add' && fenceEditPoints.map((p, i) => {
                const next = fenceEditPoints[i + 1]
                if (!next) return null
                // Fence fermé : le dernier segment colle (doublon), on skippe l'intermédiaire
                if (editHasDup && i === fenceEditPoints.length - 2) return null
                const mid = { lat: (p.lat + next.lat) / 2, lng: (p.lng + next.lng) / 2 }
                return (
                  <Marker
                    key={`edit-mid-${i}`}
                    position={[mid.lat, mid.lng]}
                    icon={FENCE_MID_DOT_ICON}
                    interactive={false}
                  />
                )
              })}
              {/* Ghost de fermeture pour land_plot : segment dernier ↔ premier */}
              {editMode === 'add' && editPolygon && !editHasDup && fenceEditPoints.length >= 2 && (() => {
                const last  = fenceEditPoints[fenceEditPoints.length - 1]
                const first = fenceEditPoints[0]
                const mid   = { lat: (last.lat + first.lat) / 2, lng: (last.lng + first.lng) / 2 }
                return (
                  <Marker
                    key="edit-mid-close"
                    position={[mid.lat, mid.lng]}
                    icon={FENCE_MID_DOT_ICON}
                    interactive={false}
                  />
                )
              })()}
            </>
          )
        })()}

        {/* Indicateur snap (point magnétique) en CRÉATION. En édition, l'anneau est
            piloté en impératif via showSnapRing (cf. snapMarkerRef) pour ne pas
            re-rendre la carte pendant le drag.
            Bug Nils 03/06/2026 : l'anneau n'apparaissait qu'en mode clôture alors
            que le snap opère aussi en mode "Définir un espace" (plotMode) — la cible
            était calculée (onSnapHover) mais jamais affichée. On rend donc le marqueur
            pour les deux modes. */}
        {(fenceMode || plotMode) && fenceSnapTarget && (
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

        {/* Épingles standard — non-interactives, sélection via proximité.
            Bug Nils V4 #5 (24/05/2026) : en vue très large (zoom < LABEL_ZOOM_LOW),
            les pins eau/zone surchargeaient la carte alors que les labels animaux
            étaient déjà masqués. On aligne le seuil : tout disparaît ensemble.
            Les pins critiques (alert, todo non fait, batterie en panne) restent
            visibles à tous les zooms pour rester repérables de loin. */}
        {nonFencePins
          .filter(pin => {
            // Filtre d'affichage par catégorie (Nils 03/06/2026) — masque toute
            // la famille même les pins "toujours visibles" ci-dessous.
            const cat = TYPE_TO_CAT[pin.type]
            if (cat && isCatHidden(cat)) return false
            if (mapZoom >= LABEL_ZOOM_LOW) return true
            // Pins toujours visibles : alertes + tâches à faire en cours +
            // batteries en panne (utile en vue dézoom pour repérer rapidement).
            if (pin.type === 'alert') return true
            if (pin.type === 'todo' && pin.todoStatus !== 'done') return true
            if (pin.type === 'battery' && (pin.batteryStatus === 'down' || pin.batteryStatus === 'critical')) return true
            // Eau en retard reste visible (cas critique, l'utilisatrice doit voir
            // qu'il y a une urgence même de loin).
            if ((pin.type === 'water_manual' || pin.type === 'water_natural') && overduePins.has(pin.id)) return true
            return false
          })
          .map(pin => (
            <Marker
              key={pin.id}
              position={[pin.lat, pin.lng]}
              icon={makeDivIcon(pin.type, overduePins.has(pin.id), (pin.photoCount ?? 0) > 0, pin.waterStatus, pin.todoStatus === 'done', pin.type === 'battery' && pin.powerOn === false, isSeasonalDry(pin, new Date().getMonth()), pin.customEmoji, pin.customColor)}
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
          <Marker position={[pendingPos.lat, pendingPos.lng]} icon={makeDivIcon(form.type, false, false, undefined, false, false, false, form.customEmoji, form.customColor)} />
        )}

        {/* Positions GPS partagées des AUTRES membres (lues depuis Firestore,
            throttled à 90 s).
            Soi-même est rendu séparément depuis selfPos (locationCore direct,
            ~1 update/s) pour avoir une pastille temps réel comme Google Maps. */}
        {users
          .filter(u => u.uid !== user?.uid && u.liveLocation && (now - (u.liveLocation.updatedAt ?? 0)) < 10 * 60_000)
          .map(u => (
            <Marker
              key={`live-${u.uid}`}
              position={[u.liveLocation!.lat, u.liveLocation!.lng]}
              icon={makeUserLocationIcon(u.color || '#2D6A4F', (u.displayName || '?').charAt(0).toUpperCase())}
              interactive={false}
              zIndexOffset={300}
            />
          ))}

        {/* Soi-même : marker temps réel + cercle de précision.
            Cercle d'incertitude = visualisation directe de la qualité du signal
            GPS (3 m = excellent, 80 m = mauvais). Permet à l'utilisatrice de
            voir si son GPS est fiable AVANT de prendre une décision (placer un
            poteau, valider un check geofence). */}
        <SelfLocationMarker
          enabled={!!user && !!profile?.shareLocation}
          color={profile?.color || '#2D6A4F'}
          label={(profile?.displayName || '?').charAt(0).toUpperCase()}
        />

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
      {tileError && !fenceMode && !pointerMode && (
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
          {/* P5 (Nils 22/05/2026) : bouton explicite "Fermer le parc" en
              manuel — aligné avec le mode auto. Avant, seul l'auto-snap sur
              le 1er poteau fermait la clôture, ce qui forçait l'utilisatrice
              à dessiner large sous peine de fermer accidentellement. */}
          {fencePoints.length >= 3 && (
            <button
              onClick={handleFenceClose}
              className="px-2.5 py-1.5 rounded-lg bg-white/25 text-white text-xs font-bold
                         active:scale-95 transition-all whitespace-nowrap"
              title="Boucler la clôture en revenant au 1ᵉʳ poteau (enclos fermé)"
            >
              🔒 Fermer
            </button>
          )}
          {fencePoints.length >= 2 && (
            <button
              onClick={() => setFenceFormVisible(true)}
              className="px-3 py-1.5 rounded-lg bg-white text-orange-600 text-xs font-bold
                         active:scale-95 transition-all whitespace-nowrap"
              title="Valider le tracé tel quel (clôture ouverte, en ligne)"
            >
              Terminer →
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
                  {/* P5 : permettre une clôture ouverte (ligne) en mode auto.
                       Disponible dès 2 poteaux, sans obligation de retour au 1er. */}
                  {fencePoints.length >= 2 && (
                    <button
                      onClick={() => setFenceFormVisible(true)}
                      className="flex-1 py-2 rounded-lg bg-white/30 text-white text-xs font-bold active:scale-95"
                    >
                      Terminer (ouvert)
                    </button>
                  )}
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

      {/* ── Barre d'outils édition d'une clôture existante ──
          Refonte #4+#7 22/05/2026 : modes explicites (un seul comportement
          par tap selon le mode actif). Avant on superposait drag + range
          select + insert sur le même tap → confusion + sélection accidentelle. */}
      {fenceEditPin && (() => {
        const modes: Array<{ id: EditMode; icon: string; label: string; hint: string }> = [
          { id: 'move',   icon: '✋', label: 'Déplacer',  hint: 'Glisse un poteau pour le repositionner.' },
          { id: 'add',    icon: '➕', label: 'Ajouter',   hint: 'Touche entre 2 poteaux pour en insérer un nouveau.' },
          { id: 'delete', icon: '✖',  label: 'Supprimer', hint: 'Touche un poteau pour le retirer.' },
          { id: 'cut',    icon: '✂',  label: 'Découper',  hint: 'Touche 2 poteaux pour sélectionner la portion entre les deux.' },
        ]
        // Le mode 'cut' n'a de sens que sur les fences (changement de fil sur portion).
        const visibleModes = fenceEditPin.type === 'fence' ? modes : modes.filter(m => m.id !== 'cut')
        const activeMode = visibleModes.find(m => m.id === editMode) ?? visibleModes[0]
        return (
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

          {/* Toolbar modes — choisis-en un, le tap fait UNE seule chose à la fois */}
          <div className="grid grid-cols-4 gap-1.5">
            {visibleModes.map(m => {
              const active = m.id === editMode
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setEditMode(m.id)
                    // En sortant du mode cut on nettoie la sélection range
                    if (m.id !== 'cut') { setEditRangeStart(null); setEditRangeEnd(null) }
                  }}
                  className={`py-2 px-1 rounded-lg text-[11px] font-bold transition-all flex flex-col items-center gap-0.5 ${
                    active
                      ? 'bg-white text-charcoal shadow-md'
                      : 'bg-white/15 text-white active:bg-white/25'
                  }`}
                >
                  <span className="text-base leading-none">{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              )
            })}
          </div>

          {/* Description courte du mode actif */}
          <p className="text-[11px] opacity-95 leading-snug bg-white/10 rounded-lg px-2 py-1.5">
            {activeMode.hint}
          </p>

          {/* Sélection portion (mode 'cut' uniquement) + action de changement
              de fil. Apparaît quand l'utilisatrice a tapé au moins un poteau ;
              le bouton "Changer le fil" est actif quand les 2 bornes sont définies. */}
          {editMode === 'cut' && (editRangeStart !== null) && fenceEditPin?.type === 'fence' && (() => {
            const completeRange = editRangeOrdered !== null
            const count = completeRange ? (editRangeOrdered.iB - editRangeOrdered.iA + 1) : 1
            return (
              <div className="rounded-xl bg-white/15 p-2.5 space-y-2">
                <p className="text-[11px] font-semibold leading-tight">
                  🎯 Sélection :{' '}
                  {completeRange
                    ? <>poteaux <strong>{editRangeOrdered.iA + 1}</strong> à <strong>{editRangeOrdered.iB + 1}</strong> ({count} poteaux)</>
                    : <>poteau <strong>{(editRangeStart ?? 0) + 1}</strong> (tape un 2ᵉ poteau pour finir la portion)</>}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditRangePresetVisible(true)}
                    disabled={!completeRange || editRangeApplying}
                    className="flex-1 py-2 rounded-lg bg-white text-charcoal text-xs font-bold
                               active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                               flex items-center justify-center gap-1.5"
                  >
                    🎨 Changer le fil
                  </button>
                  <button
                    onClick={clearEditRange}
                    className="px-2.5 py-2 rounded-lg bg-white/20 text-xs font-semibold active:bg-white/30"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )
          })()}
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
        )
      })()}

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
          className="bg-card shadow-lg rounded-xl p-3 active:scale-95 transition-all"
        >
          <Layers size={20} className="text-forest" />
        </button>
        <button
          onClick={() => setShowParcels(v => !v)}
          title={showParcels ? 'Masquer les parcelles cadastrales' : 'Afficher les parcelles cadastrales IGN'}
          aria-pressed={showParcels}
          className={`shadow-lg rounded-xl p-3 active:scale-95 transition-all
            ${showParcels ? 'bg-forest text-white' : 'bg-card text-forest'}`}
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
          className="bg-card shadow-lg rounded-xl p-3 active:scale-95 transition-all"
          title="Recentrer sur la ferme"
        >
          <LocateFixed size={20} className="text-forest" />
        </button>
        <button
          onClick={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery('') }}
          className={`shadow-lg rounded-xl p-3 active:scale-95 transition-all ${
            searchOpen ? 'bg-forest text-white' : 'bg-card'
          }`}
          title="Rechercher un animal, un espace ou une épingle"
        >
          <Search size={20} className={searchOpen ? 'text-white' : 'text-forest'} />
        </button>
        <button
          onClick={() => setFilterOpen(v => !v)}
          className={`shadow-lg rounded-xl p-3 active:scale-95 transition-all relative ${
            filterOpen ? 'bg-forest text-white' : 'bg-card'
          }`}
          title="Filtrer l'affichage des pins"
          aria-pressed={filterOpen}
        >
          <SlidersHorizontal size={20} className={filterOpen ? 'text-white' : 'text-forest'} />
          {hiddenCats.size > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-sun text-earth text-[9px] font-bold flex items-center justify-center border border-white">
              {hiddenCats.size}
            </span>
          )}
        </button>
      </div>

      {/* ── Menu déroulant : filtre d'affichage des pins (Nils 03/06/2026) ── */}
      {filterOpen && (
        <div className="absolute top-4 right-20 z-[1100] w-60 bg-card shadow-xl rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <p className="text-sm font-bold text-charcoal">Afficher sur la carte</p>
            <button onClick={() => setFilterOpen(false)} className="p-1 rounded-lg active:bg-cream">
              <X size={16} className="text-muted" />
            </button>
          </div>
          <ul className="py-1 max-h-[60vh] overflow-y-auto">
            {PIN_CATEGORIES.map(cat => {
              const visible = !isCatHidden(cat.key)
              return (
                <li key={cat.key}>
                  <button
                    onClick={() => toggleCat(cat.key)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-cream transition-colors"
                  >
                    <span className="text-base flex-shrink-0">{cat.emoji}</span>
                    <span className={`flex-1 text-sm font-semibold ${visible ? 'text-charcoal' : 'text-muted line-through'}`}>
                      {cat.label}
                    </span>
                    <span className={`w-9 h-5 rounded-full flex items-center transition-colors flex-shrink-0 ${
                      visible ? 'bg-forest justify-end' : 'bg-border justify-start'
                    } px-0.5`}>
                      <span className="w-4 h-4 rounded-full bg-white shadow" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {hiddenCats.size > 0 && (
            <div className="px-4 py-2.5 border-t border-border/50">
              <button
                onClick={() => setHiddenCats(new Set())}
                className="text-xs font-semibold text-forest underline active:opacity-70"
              >
                Tout afficher
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Panneau recherche (déroulant au top-center) ── */}
      {searchOpen && (
        <div className="absolute top-4 left-4 right-20 z-[1000] flex flex-col gap-1.5 max-w-md">
          <div className="flex items-center gap-2 bg-card shadow-lg rounded-xl px-3 py-2.5">
            <Search size={16} className="text-muted flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher : un animal, un espace, une épingle…"
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
            // Animaux → téléportation vers le centre de leur espace (enclos). Demande
            // Nils 03/06/2026 : taper "Darius" amène directement au parc où il est.
            const animalResults = animals
              .filter(a => a.name && a.name.toLowerCase().includes(q))
              .slice(0, 6)
              .map(a => ({ a, plot: a.enclosureId ? landPlotPins.find(p => p.id === a.enclosureId) ?? null : null }))
            // Espaces définis (land_plot) → centre du polygone.
            const spaceResults = landPlotPins
              .filter(p => p.name && p.name.toLowerCase().includes(q))
              .slice(0, 6)
            // Épingles ponctuelles (eau, batterie, note, clôture…) hors espaces.
            const pinResults = pins
              .filter(p => p.type !== 'land_plot' && p.name && p.name.toLowerCase().includes(q))
              .slice(0, 8)
            const total = animalResults.length + spaceResults.length + pinResults.length

            const plotCenter = (p: MapPin) =>
              p.points && p.points.length >= 3 ? insidePolygonCentroid(p.points) : { lat: p.lat, lng: p.lng }

            return (
              <div className="bg-card shadow-lg rounded-xl max-h-[55vh] overflow-y-auto">
                {total === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted italic">Aucun résultat pour « {searchQuery.trim()} »</p>
                ) : (
                  <ul>
                    {/* Animaux */}
                    {animalResults.map(({ a, plot }) => (
                      <li key={`a-${a.id}`}>
                        <button
                          onClick={() => {
                            if (plot) {
                              const c = plotCenter(plot)
                              setFlyTarget({ lat: c.lat, lng: c.lng, zoom: 18, key: Date.now() })
                              setSelected(plot)
                            }
                            setSearchOpen(false)
                            setSearchQuery('')
                          }}
                          disabled={!plot}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-cream transition-colors border-b border-border/40 last:border-0 disabled:opacity-50"
                        >
                          <span className="text-base flex-shrink-0">{getSpeciesInfo(a.species, customSpecies).emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-charcoal truncate">{a.name}</p>
                            <p className="text-xs text-muted truncate">
                              {plot ? `🐾 dans ${plot.name}` : '🐾 animal non placé'}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                    {/* Espaces définis */}
                    {spaceResults.map(p => (
                      <li key={`s-${p.id}`}>
                        <button
                          onClick={() => {
                            const c = plotCenter(p)
                            setFlyTarget({ lat: c.lat, lng: c.lng, zoom: 17, key: Date.now() })
                            setSelected(p)
                            setSearchOpen(false)
                            setSearchQuery('')
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-cream transition-colors border-b border-border/40 last:border-0"
                        >
                          <span className="text-base flex-shrink-0">{PIN_CFG.land_plot.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-charcoal truncate">{p.name}</p>
                            <p className="text-xs text-muted">Espace défini</p>
                          </div>
                        </button>
                      </li>
                    ))}
                    {/* Épingles ponctuelles */}
                    {pinResults.map(p => {
                      const cfg = PIN_CFG[p.type]
                      return (
                        <li key={`p-${p.id}`}>
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
      {!addMode && !pendingPos && !selected && !fenceMode && !pointerMode && !streamMode && !plotMode && (
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
          {/* Bouton cours d'eau — bug Eugénie 21/05/2026 V2 */}
          <button
            onClick={() => { setStreamMode(true); setStreamPoints([]) }}
            className="bg-sky-600 text-white rounded-2xl px-4 py-3 shadow-lg
                       active:scale-95 transition-all flex items-center gap-2"
            title="Tracer un cours d'eau"
          >
            <span className="text-base leading-none">🏞️</span>
            <span className="text-sm font-semibold">Cours d'eau</span>
          </button>
          {/* Bouton "Définir un espace" — refonte clôtures/espaces (S4.3).
              Trace un land_plot autonome : terrain qui nous appartient,
              indépendant des clôtures physiques qui peuvent l'entourer. */}
          <button
            onClick={() => { setPlotMode(true); setPlotPoints([]) }}
            className="text-white rounded-2xl px-4 py-3 shadow-lg
                       active:scale-95 transition-all flex items-center gap-2"
            style={{ backgroundColor: '#15803d' }}
            title="Définir un espace (terrain)"
          >
            <span className="text-base leading-none">⛰</span>
            <span className="text-sm font-semibold">Espace</span>
          </button>
          <button
            onClick={() => setAddMode(true)}
            className="bg-forest text-white rounded-2xl p-4 shadow-xl active:scale-95 transition-all"
          >
            <Plus size={24} />
          </button>
        </div>
      )}

      {/* ── Barre d'outils : mode "Tracer un cours d'eau" ── */}
      {streamMode && !streamFormVisible && (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                          text-white rounded-2xl shadow-xl px-4 py-3 space-y-2"
               style={{ backgroundColor: '#0284C7' }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold leading-tight">
                🏞️ Tracé du cours d'eau
                <span className="ml-1 text-xs font-semibold opacity-90">
                  · {streamPoints.length} point{streamPoints.length > 1 ? 's' : ''}
                </span>
              </p>
              <button
                onClick={() => { setStreamMode(false); setStreamPoints([]) }}
                className="p-1.5 rounded-lg bg-white/20 active:bg-white/40"
                aria-label="Annuler"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] opacity-90 leading-snug">
              Touche la carte pour ajouter chaque point du cours d'eau (source → embouchure).
              Touche "Valider" quand le tracé suit le cours réel.
            </p>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] flex gap-2">
            {streamPoints.length > 0 && (
              <button
                onClick={() => setStreamPoints(prev => prev.slice(0, -1))}
                className="bg-card text-charcoal rounded-2xl px-4 py-3 shadow-lg
                           active:scale-95 transition-all flex items-center gap-2 border border-border"
              >
                <Undo2 size={16} />
                <span className="text-sm font-semibold">Retirer le dernier</span>
              </button>
            )}
            <button
              onClick={() => {
                setStreamFormName('')
                setStreamFormSeasonal(false)
                setStreamFormMonths([])
                setStreamFormVisible(true)
              }}
              disabled={streamPoints.length < 2}
              className="bg-sky-600 text-white rounded-2xl px-5 py-3 shadow-xl
                         active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40"
            >
              <Check size={18} />
              <span className="text-sm font-bold">Valider le tracé</span>
            </button>
          </div>
        </>
      )}

      {/* ── Barre d'outils : mode "Définir un espace" ── */}
      {plotMode && !plotFormVisible && (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                          text-white rounded-2xl shadow-xl px-4 py-3 space-y-2"
               style={{ backgroundColor: '#15803d' }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold leading-tight">
                ⛰ Définir un espace
                <span className="ml-1 text-xs font-semibold opacity-90">
                  · {plotPoints.length} point{plotPoints.length > 1 ? 's' : ''}
                </span>
              </p>
              <button
                onClick={() => { setPlotMode(false); setPlotPoints([]) }}
                className="p-1.5 rounded-lg bg-white/20 active:bg-white/40"
                aria-label="Annuler"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] opacity-90 leading-snug">
              Touche la carte point par point pour entourer le terrain qui vous appartient.
              Touche le 1<sup>er</sup> point (rond vert clair) ou "Valider" pour fermer.
            </p>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] flex gap-2">
            {plotPoints.length > 0 && (
              <button
                onClick={() => setPlotPoints(prev => prev.slice(0, -1))}
                className="bg-card text-charcoal rounded-2xl px-4 py-3 shadow-lg
                           active:scale-95 transition-all flex items-center gap-2 border border-border"
              >
                <Undo2 size={16} />
                <span className="text-sm font-semibold">Retirer le dernier</span>
              </button>
            )}
            <button
              onClick={() => {
                setPlotFormName('')
                setPlotFormVisible(true)
              }}
              disabled={plotPoints.length < 3}
              className="text-white rounded-2xl px-5 py-3 shadow-xl
                         active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: '#15803d' }}
            >
              <Check size={18} />
              <span className="text-sm font-bold">Valider l'espace</span>
            </button>
          </div>
        </>
      )}

      {/* ── Barre d'outils : mode "+ Zone vide intérieure" (S4.6) ── */}
      {holeMode && (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[92vw] max-w-md
                          text-white rounded-2xl shadow-xl px-4 py-3 space-y-2"
               style={{ backgroundColor: '#EA580C' }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold leading-tight">
                ⛶ Zone vide intérieure
                <span className="ml-1 text-xs font-semibold opacity-90">
                  · {holePoints.length} point{holePoints.length > 1 ? 's' : ''}
                </span>
              </p>
              <button
                onClick={() => { setHoleMode(false); setHolePoints([]); setHolePlotId(null) }}
                className="p-1.5 rounded-lg bg-white/20 active:bg-white/40"
                aria-label="Annuler"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] opacity-90 leading-snug">
              Trace le contour du bout de terrain qui ne vous appartient PAS
              à l'intérieur de l'espace. Touche le 1<sup>er</sup> point pour fermer.
            </p>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] flex gap-2">
            {holePoints.length > 0 && (
              <button
                onClick={() => setHolePoints(prev => prev.slice(0, -1))}
                className="bg-card text-charcoal rounded-2xl px-4 py-3 shadow-lg
                           active:scale-95 transition-all flex items-center gap-2 border border-border"
              >
                <Undo2 size={16} />
                <span className="text-sm font-semibold">Retirer le dernier</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Modal : nom de l'espace ── */}
      {plotFormVisible && (
        <div className="fixed inset-0 z-[2500] bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-card w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 flex items-start justify-between border-b border-border/40">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                  ⛰ Nouvel espace défini
                </p>
                <p className="text-xs text-muted/80 mt-1">
                  {plotPoints.length} points tracés
                </p>
              </div>
              <button
                onClick={() => setPlotFormVisible(false)}
                className="ml-2 w-8 h-8 rounded-lg bg-cream flex items-center justify-center active:scale-95 flex-shrink-0"
                aria-label="Retour au tracé"
              >
                <X size={16} className="text-muted" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Nom de l'espace *</span>
                <input
                  type="text"
                  autoFocus
                  value={plotFormName}
                  onChange={e => setPlotFormName(e.target.value)}
                  maxLength={60}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="ex: Pré du haut, Verger, Bois de Larivière…"
                />
              </label>
              <p className="text-[11px] text-muted/80 leading-snug">
                Cet espace définit un terrain qui vous appartient (suivi pâturage,
                placement animaux). Les clôtures qui l'entourent restent indépendantes
                et modifiables sans casser le placement.
              </p>
            </div>

            <div className="px-5 py-3 border-t border-border/40 flex gap-2">
              <button
                onClick={() => setPlotFormVisible(false)}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted active:bg-cream"
              >
                Retour au tracé
              </button>
              <button
                onClick={async () => {
                  if (!plotFormName.trim() || !user) return
                  const now = Date.now()
                  const centerLat = plotPoints.reduce((s, p) => s + p.lat, 0) / plotPoints.length
                  const centerLng = plotPoints.reduce((s, p) => s + p.lng, 0) / plotPoints.length
                  await addDoc(collection(db, 'map_pins'), {
                    name:       plotFormName.trim(),
                    type:       'land_plot',
                    note:       '',
                    lat:        centerLat,
                    lng:        centerLng,
                    points:     plotPoints,
                    status:     'ok',
                    createdAt:  now,
                    createdBy:  user.uid,
                    updatedAt:  now,
                    updatedBy:  user.uid,
                  })
                  setPlotMode(false)
                  setPlotPoints([])
                  setPlotFormVisible(false)
                }}
                disabled={!plotFormName.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                           text-white text-sm font-bold active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: '#15803d' }}
              >
                <Check size={15} /> Enregistrer l'espace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : nom + saisonnalité du cours d'eau ── */}
      {streamFormVisible && (
        <div className="fixed inset-0 z-[2500] bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-card w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 pt-5 pb-3 flex items-start justify-between border-b border-border/40">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                  🏞️ Nouveau cours d'eau
                </p>
                <p className="text-xs text-muted/80 mt-1">
                  {streamPoints.length} points tracés
                </p>
              </div>
              <button
                onClick={() => setStreamFormVisible(false)}
                className="ml-2 w-8 h-8 rounded-lg bg-cream flex items-center justify-center active:scale-95 flex-shrink-0"
                aria-label="Retour au tracé"
              >
                <X size={16} className="text-muted" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Nom du cours d'eau *</span>
                <input
                  type="text"
                  autoFocus
                  value={streamFormName}
                  onChange={e => setStreamFormName(e.target.value)}
                  maxLength={60}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder="ex: Ruisseau du bas, Source de la prairie…"
                />
              </label>

              <div>
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Régime</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStreamFormSeasonal(false)}
                    className={`py-2.5 rounded-xl border text-xs font-bold transition-all ${
                      !streamFormSeasonal
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-border bg-cream text-muted'
                    }`}
                  >
                    Permanent (toute l'année)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStreamFormSeasonal(true)}
                    className={`py-2.5 rounded-xl border text-xs font-bold transition-all ${
                      streamFormSeasonal
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-border bg-cream text-muted'
                    }`}
                  >
                    Saisonnier (subit aléas)
                  </button>
                </div>
              </div>

              {streamFormSeasonal && (
                <div>
                  <span className="text-xs font-semibold text-charcoal block mb-1.5">Mois où il coule</span>
                  <div className="grid grid-cols-6 gap-1">
                    {['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'].map((m, idx) => {
                      const monthNum = idx + 1
                      const active = streamFormMonths.includes(monthNum)
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setStreamFormMonths(prev =>
                            active ? prev.filter(x => x !== monthNum) : [...prev, monthNum].sort((a, b) => a - b),
                          )}
                          className={`py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                            active
                              ? 'bg-sky-500 text-white border-sky-500'
                              : 'bg-cream text-muted border-border'
                          }`}
                        >
                          {m}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-muted/80 mt-1.5">
                    Les mois cochés = l'eau coule. Les autres mois, le tracé apparaîtra en gris pointillé sur la carte.
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border/40 flex gap-2">
              <button
                onClick={() => setStreamFormVisible(false)}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted active:bg-cream"
              >
                Retour au tracé
              </button>
              <button
                onClick={async () => {
                  if (!streamFormName.trim() || !user) return
                  const now = Date.now()
                  await addDoc(collection(db, 'map_pins'), {
                    name:               streamFormName.trim(),
                    type:                'water_stream',
                    note:                '',
                    lat:                 streamPoints[0].lat,
                    lng:                 streamPoints[0].lng,
                    points:              streamPoints,
                    status:              'ok',
                    createdAt:           now,
                    createdBy:           user.uid,
                    updatedAt:           now,
                    streamMode:          streamFormSeasonal ? 'seasonal' : 'permanent',
                    streamActiveMonths:  streamFormSeasonal ? streamFormMonths : [],
                  })
                  setStreamMode(false)
                  setStreamPoints([])
                  setStreamFormVisible(false)
                }}
                disabled={!streamFormName.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                           bg-sky-600 text-white text-sm font-bold active:scale-95
                           disabled:opacity-40"
              >
                <Check size={15} /> Enregistrer le cours d'eau
              </button>
            </div>
          </div>
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
        {animals.filter(a => a.enclosureId === null).length > 0 && !addMode && !fenceMode && (
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
        <div className="bg-card rounded-xl px-3 py-1.5 shadow-md">
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

            {/* Liste des espaces disponibles (S9 : land_plot uniquement, plus de fence-as-enclosure) */}
            {(() => {
              const availablePlots = landPlotPins
              return (
                <>
                  {availablePlots.length === 0 && (
                    <div className="bg-sun/10 border border-sun/30 rounded-xl p-4 mb-4 text-center">
                      <p className="text-sm font-semibold text-earth mb-1">Aucun espace défini sur la carte</p>
                      <p className="text-xs text-muted">
                        Crée un espace via le mode ⛰ Espace dans la barre du bas
                        pour pouvoir y placer des animaux.
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {animals.map(animal => {
                      const currentPlot = availablePlots.find(p => p.id === animal.enclosureId)
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
                                  {currentPlot
                                    ? <span className="text-forest font-semibold">📍 {currentPlot.name}</span>
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

                          {/* Sélecteur d'espace */}
                          {isEditing && (
                            <div className="border-t border-border px-4 py-3 bg-white space-y-2">
                              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                                Choisir un espace
                              </p>
                              {availablePlots.length === 0 ? (
                                <p className="text-xs text-muted italic">Aucun espace défini disponible.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {availablePlots.map(plot => (
                                    <button
                                      key={plot.id}
                                      disabled={actionBusy}
                                      onClick={async () => {
                                        setActionBusy(true)
                                        try {
                                          await updateDoc(doc(db, 'animals', animal.id), { enclosureId: plot.id })
                                          setAnimalPanelEditing(null)
                                        } finally { setActionBusy(false) }
                                      }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-95 ${
                                        animal.enclosureId === plot.id
                                          ? 'border-forest bg-forest/10'
                                          : 'border-border bg-cream'
                                      }`}
                                    >
                                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: '#52B788' }} />
                                      <span className="text-sm font-semibold text-charcoal flex-1">{plot.name}</span>
                                      <span className="text-xs text-muted">
                                        {animals.filter(a => a.enclosureId === plot.id).length} animaux
                                      </span>
                                      {animal.enclosureId === plot.id && (
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

              {/* Nom — pour le pin perso, le champ nom est dans la section dédiée
                  (plus proche de l'aperçu emoji/couleur). Nils 11/06/2026. */}
              {form.type !== 'custom' && (
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
              )}

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

              {/* ── Champs pin perso (nom + emoji + couleur) ── */}
              {form.type === 'custom' && (
                <>
                  <FormSection label="Nom du repère *">
                    <input
                      type="text" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="ex: Rocher dangereux, Passage à gué…"
                      maxLength={60}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                                 placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent"
                      disabled={saving} />
                  </FormSection>
                  <FormSection label="Emoji">
                    <div className="grid grid-cols-8 gap-1.5">
                      {CUSTOM_EMOJIS.map(em => (
                        <button key={em} type="button"
                          onClick={() => setForm(f => ({ ...f, customEmoji: em }))}
                          className={`py-2 rounded-xl border text-lg transition-all ${
                            form.customEmoji === em ? 'border-forest bg-forest/10' : 'border-border bg-cream'
                          }`} disabled={saving}>{em}</button>
                      ))}
                    </div>
                    {/* Emoji libre : l'utilisatrice peut coller/taper n'importe quel emoji
                        depuis le clavier du téléphone (Nils 11/06/2026). */}
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text" value={form.customEmoji}
                        onChange={e => {
                          // Garde le dernier "caractère" emoji saisi (un emoji = plusieurs
                          // code units → on segmente proprement plutôt que slice(-1)).
                          const chars = Array.from(e.target.value.trim())
                          setForm(f => ({ ...f, customEmoji: chars.length ? chars[chars.length - 1] : '' }))
                        }}
                        placeholder="Ou tape ton emoji"
                        className="flex-1 px-3 py-2 rounded-xl border border-border bg-cream text-charcoal text-base
                                   placeholder:text-muted/50 placeholder:text-sm focus:outline-none focus:ring-2 focus:ring-forest"
                        disabled={saving} />
                      <span className="text-xs text-muted">→</span>
                      <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg border-2 border-white shadow flex-shrink-0"
                            style={{ backgroundColor: form.customColor }}>{form.customEmoji || '📌'}</span>
                    </div>
                  </FormSection>
                  <FormSection label="Couleur">
                    <div className="flex flex-wrap gap-2">
                      {CUSTOM_COLORS.map(col => (
                        <button key={col} type="button"
                          onClick={() => setForm(f => ({ ...f, customColor: col }))}
                          className={`w-9 h-9 rounded-full transition-all ${
                            form.customColor === col ? 'ring-2 ring-offset-2 ring-charcoal' : ''
                          }`} style={{ backgroundColor: col }} disabled={saving}
                          aria-label={`Couleur ${col}`} />
                      ))}
                    </div>
                  </FormSection>
                </>
              )}

              {/* Note / description */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  {form.type === 'custom' ? 'Description (optionnel)' : 'Note (optionnel)'}
                </label>
                <textarea value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder={form.type === 'custom' ? 'À quoi sert ce repère ?' : 'Informations supplémentaires…'}
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

      {/* ══════════════════════════════════════════
          P7 (Nils 22/05/2026) : modal choix du fil pour la portion sélectionnée
          en mode édition. Délibérément simplifiée — pas de "création de
          nouveau preset", l'utilisatrice y a accès en démarrant un nouveau
          tracé. Ici on choisit parmi les presets existants.
      ══════════════════════════════════════════ */}
      {editRangePresetVisible && fenceEditPin && editRangeOrdered && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => !editRangeApplying && setEditRangePresetVisible(false)} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[75vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-charcoal text-lg font-bold m-0 flex items-center gap-2">
                🎨 Nouveau fil — poteaux {editRangeOrdered.iA + 1} à {editRangeOrdered.iB + 1}
              </h2>
              <button
                onClick={() => setEditRangePresetVisible(false)}
                disabled={editRangeApplying}
                className="p-2 rounded-xl text-muted active:bg-cream disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-muted mb-4 leading-relaxed">
              Choisis le type de fil à appliquer sur la portion. Les autres
              portions de la clôture gardent leur fil actuel.
            </p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {fencePresets.map(preset => (
                <button
                  key={preset.id}
                  disabled={editRangeApplying}
                  onClick={() => {
                    applyPresetToRange(fenceEditPin, fenceEditPoints, editRangeOrdered.iA, editRangeOrdered.iB, preset)
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                             active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: preset.color + '40', background: preset.color + '10' }}
                >
                  <div className="w-6 h-6 rounded-full flex-shrink-0 shadow-md" style={{ background: preset.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-charcoal truncate">{preset.name}</p>
                    {preset.description && <p className="text-xs text-muted truncate">{preset.description}</p>}
                  </div>
                  <span className="text-xs font-semibold text-muted/70">
                    {editRangeApplying ? '…' : 'Appliquer →'}
                  </span>
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
            {/* Bug Nils 22/05/2026 : marquer clairement les clôtures sous tension. */}
            {selectedPreset?.wireStyle === 'electric' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 bg-yellow-100 border border-yellow-300">
                <span className="text-lg">⚡</span>
                <span className="text-xs text-yellow-900 font-semibold">
                  Clôture électrique — relie-la à une batterie depuis le panneau
                  après création pour visualiser l'alimentation.
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
          Modal : découpage automatique d'un espace par la clôture (S7)
      ══════════════════════════════════════════ */}
      {pendingSplit && (
        <ScindageModal
          parent={pendingSplit.plot}
          split={pendingSplit.split}
          animals={animals.filter(a => a.enclosureId === pendingSplit.plot.id)}
          saving={saving}
          onCancel={cancelSplit}
          onConfirm={confirmSplit}
        />
      )}

      {/* ══════════════════════════════════════════
          Sheet : check rapide depuis la notif geofence (bug Eugénie 22/05/2026)
          URL : /map?check=<plotId> → cocher les animaux vus en bonne santé
      ══════════════════════════════════════════ */}
      {checkPlotId && (() => {
        const plot = pins.find(p => p.id === checkPlotId && p.type === 'land_plot')
        if (!plot) return null
        const plotAnimals = animals.filter(a => a.enclosureId === plot.id)
        const clearCheck = () => {
          // Retire le param ?check de l'URL pour qu'un refresh n'ouvre pas la
          // sheet en boucle. Garde les autres params (defensive).
          const next = new URLSearchParams(searchParams)
          next.delete('check')
          setSearchParams(next, { replace: true })
        }
        return (
          <GeofenceCheckSheet
            plot={plot}
            animals={plotAnimals}
            customSpecies={customSpecies}
            saving={savingHealth}
            onMarkChecked={async (list) => {
              await markAllHealthy(list)
              // Auto-validation des tâches liées à cet espace (Nils 25/05/2026)
              if (user) await completeLinkedTasks('land_plot', plot.id, user.uid)
            }}
            onOpenAnimal={(a) => { clearCheck(); navigate(`/animal/${a.id}`) }}
            onClose={clearCheck}
          />
        )
      })()}

      {/* ══════════════════════════════════════════
          Sheet : détail épingle
      ══════════════════════════════════════════ */}
      {selected && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => { setSelected(null); setEditOccupants(false) }} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[80vh] overflow-y-auto">

            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-3xl">{selected.type === 'custom' ? (selected.customEmoji ?? PIN_CFG.custom.emoji) : PIN_CFG[selected.type]?.emoji}</span>
                <div className="flex-1 min-w-0">
                  {renamingPin && !isTemp ? (
                    <input
                      type="text"
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') { setRenamingPin(false); setRenameValue('') }
                      }}
                      maxLength={60}
                      className="w-full px-2 py-1 rounded-lg border-2 border-forest bg-white text-charcoal text-lg font-bold
                                 focus:outline-none focus:ring-2 focus:ring-forest/30"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        if (isTemp) return
                        setRenameValue(selected.name)
                        setRenamingPin(true)
                      }}
                      disabled={isTemp}
                      className={`flex items-center gap-1.5 text-left ${isTemp ? 'cursor-default' : 'active:bg-cream/50 -mx-1 px-1 rounded-md transition-colors'}`}
                    >
                      <h2 className="text-charcoal text-lg font-bold m-0 truncate">{selected.name}</h2>
                      {!isTemp && <Pencil size={12} className="text-muted flex-shrink-0" />}
                    </button>
                  )}
                  <p className="text-muted text-xs mt-0.5">{PIN_CFG[selected.type]?.label}</p>
                </div>
              </div>
              <button onClick={() => { setSelected(null); setEditOccupants(false); setRenamingPin(false) }}
                      className="p-2 rounded-xl text-muted active:bg-cream flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            {/* ── Bloc espace défini (land_plot) ── S4.4 */}
            {selected.type === 'land_plot' && (
              <LandPlotPanel
                pin={selected}
                isTemp={isTemp}
                actionBusy={actionBusy}
                savingHealth={savingHealth}
                user={user}
                animals={animals}
                users={users}
                customSpecies={customSpecies}
                enclosureHistory={enclosureHistory}
                historyVisible={historyVisible}
                setHistoryVisible={setHistoryVisible}
                editEnclosureAnimals={editEnclosureAnimals}
                setEditEnclosureAnimals={setEditEnclosureAnimals}
                pendingEnclosureAnimals={pendingEnclosureAnimals}
                setPendingEnclosureAnimals={setPendingEnclosureAnimals}
                pendingMoveDate={pendingMoveDate}
                setPendingMoveDate={setPendingMoveDate}
                pendingMoveNote={pendingMoveNote}
                setPendingMoveNote={setPendingMoveNote}
                onMarkAllHealthy={async (list) => {
                  await markAllHealthy(list)
                  if (user) await completeLinkedTasks('land_plot', selected.id, user.uid)
                }}
                onSaveEnclosureAnimals={saveEnclosureAnimals}
                onSetRotation={async (pin, days) => {
                  if (!user) return
                  setActionBusy(true)
                  try {
                    const payload: Record<string, unknown> = {
                      updatedAt: Date.now(),
                      updatedBy: user.uid,
                    }
                    if (days === null) {
                      payload.rotationDueAt = deleteField()
                    } else {
                      payload.rotationDueAt = Date.now() + days * 86_400_000
                    }
                    await updateDoc(doc(db, 'map_pins', pin.id), payload)
                    setSelected({
                      ...pin,
                      rotationDueAt: days === null ? undefined : Date.now() + days * 86_400_000,
                    })
                  } finally { setActionBusy(false) }
                }}
                onStartAddHole={(plot) => {
                  // Active holeMode et mémorise le plot cible.
                  setHolePlotId(plot.id)
                  setHolePoints([])
                  setHoleMode(true)
                  // Ferme le panel pour libérer la vue carte pendant le tracé.
                  setSelected(null)
                }}
                onDeleteHole={async (plot, holeIndex) => {
                  if (!user) return
                  const nextHoles = (plot.holes ?? []).filter((_, i) => i !== holeIndex)
                  setActionBusy(true)
                  try {
                    await updateDoc(doc(db, 'map_pins', plot.id), {
                      holes:     nextHoles.length > 0 ? nextHoles : deleteField(),
                      updatedAt: Date.now(),
                      updatedBy: user.uid,
                    })
                    setSelected({ ...plot, holes: nextHoles.length > 0 ? nextHoles : undefined })
                  } finally { setActionBusy(false) }
                }}
                onStartEditTrace={startEditFence}
              />
            )}

            {/* ── Bloc clôture ── */}
            {selected.type === 'fence' && (
              <div className="mb-4 space-y-3">
                <FencePanel
                  pin={selected}
                  preset={fencePresets.find(p => p.id === selected.presetId)}
                  isTemp={isTemp}
                  actionBusy={actionBusy}
                  batteryPins={pins.filter(p => p.type === 'battery')}
                  onUpdateWireCount={updateFenceWireCount}
                  onUpdateVoltage={updateFenceVoltage}
                  onSetBattery={async (pin, bid) => {
                    if (!user) return
                    setActionBusy(true)
                    try {
                      const payload: Record<string, unknown> = {
                        updatedAt: Date.now(),
                        updatedBy: user.uid,
                      }
                      payload.connectedBatteryId = bid ?? deleteField()
                      await updateDoc(doc(db, 'map_pins', pin.id), payload)
                      setSelected({ ...pin, connectedBatteryId: bid ?? undefined })
                    } finally { setActionBusy(false) }
                  }}
                  onSetIntensity={async (pin, level) => {
                    if (!user) return
                    setActionBusy(true)
                    try {
                      const payload: Record<string, unknown> = {
                        updatedAt: Date.now(),
                        updatedBy: user.uid,
                      }
                      if (level === 'full') {
                        payload.electricityIntensity = deleteField()
                      } else {
                        payload.electricityIntensity = level
                      }
                      await updateDoc(doc(db, 'map_pins', pin.id), payload)
                      setSelected({
                        ...pin,
                        electricityIntensity: level === 'full' ? undefined : level,
                      })
                    } finally { setActionBusy(false) }
                  }}
                  onStartEditFence={startEditFence}
                  onRestoreSingleWire={restoreSingleWire}
                  onShowLinkedPlot={
                    selected.migratedToPlotId
                      ? () => {
                          const plot = pins.find(p => p.id === selected.migratedToPlotId)
                          if (plot) setSelected(plot)
                        }
                      : undefined
                  }
                />

                <EnclosurePlacementPanel
                  pin={selected}
                  isEnclosed={false}
                  isTemp={isTemp}
                  actionBusy={actionBusy}
                  savingHealth={savingHealth}
                  user={user}
                  animals={animals}
                  users={users}
                  customSpecies={customSpecies}
                  enclosureHistory={enclosureHistory}
                  historyVisible={historyVisible}
                  setHistoryVisible={setHistoryVisible}
                  editEnclosureAnimals={editEnclosureAnimals}
                  setEditEnclosureAnimals={setEditEnclosureAnimals}
                  pendingEnclosureAnimals={pendingEnclosureAnimals}
                  setPendingEnclosureAnimals={setPendingEnclosureAnimals}
                  pendingMoveDate={pendingMoveDate}
                  setPendingMoveDate={setPendingMoveDate}
                  pendingMoveNote={pendingMoveNote}
                  setPendingMoveNote={setPendingMoveNote}
                  onMarkAllHealthy={async (list) => {
                    await markAllHealthy(list)
                    // Fences ont parfois un land_plot jumeau (migration S3). Si oui,
                    // les tâches sont liées au plot — on auto-valide pour ce plot.
                    if (user && selected.migratedToPlotId) {
                      await completeLinkedTasks('land_plot', selected.migratedToPlotId, user.uid)
                    }
                  }}
                  onSaveEnclosureAnimals={saveEnclosureAnimals}
                  onSetRotation={async (pin, days) => {
                    if (!user) return
                    setActionBusy(true)
                    try {
                      const payload: Record<string, unknown> = {
                        updatedAt: Date.now(),
                        updatedBy: user.uid,
                      }
                      if (days === null) {
                        payload.rotationDueAt = deleteField()
                      } else {
                        payload.rotationDueAt = Date.now() + days * 86_400_000
                      }
                      await updateDoc(doc(db, 'map_pins', pin.id), payload)
                      setSelected({
                        ...pin,
                        rotationDueAt: days === null ? undefined : Date.now() + days * 86_400_000,
                      })
                    } finally { setActionBusy(false) }
                  }}
                />
              </div>
            )}

            {/* ── Bloc eau manuelle ── */}
            {selected.type === 'water_manual' && (
              <WaterManualPanel pin={selected} actionBusy={actionBusy} onFill={fillWaterPoint} />
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
                {selected.availabilityMode === 'seasonal' && selected.activeMonths && selected.activeMonths.length > 0 && (
                  isSeasonalDry(selected, new Date().getMonth()) ? (
                    <div className="rounded-xl p-2.5 bg-slate-100 border border-slate-300 flex items-center gap-2">
                      <span className="text-base">💤</span>
                      <span className="text-xs font-semibold text-slate-600">
                        À sec ce mois-ci{(() => {
                          const next = nextActiveMonth(selected.activeMonths, new Date().getMonth())
                          return next !== null ? ` — revient en ${MONTHS_FR[next]}` : ''
                        })()}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl p-2.5 bg-sky/10 border border-sky/30 flex items-center gap-2">
                      <Droplets size={16} className="text-sky" />
                      <span className="text-xs font-semibold text-sky">Coule actuellement</span>
                    </div>
                  )
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

            {/* ── Bloc cours d'eau (water_stream) ── */}
            {selected.type === 'water_stream' && (
              <WaterStreamPanel
                pin={selected}
                isTemp={isTemp}
                actionBusy={actionBusy}
                onPatchAttenuations={async (next) => {
                  if (!user) return
                  setActionBusy(true)
                  try {
                    await updateDoc(doc(db, 'map_pins', selected.id), {
                      streamAttenuations: next ?? deleteField(),
                      updatedAt: Date.now(),
                      updatedBy: user.uid,
                    })
                    setSelected({ ...selected, streamAttenuations: next })
                  } finally { setActionBusy(false) }
                }}
                onPatchSeasonality={async (mode, months) => {
                  if (!user) return
                  setActionBusy(true)
                  try {
                    await updateDoc(doc(db, 'map_pins', selected.id), {
                      streamMode:         mode,
                      streamActiveMonths: months,
                      updatedAt: Date.now(),
                      updatedBy: user.uid,
                    })
                    setSelected({ ...selected, streamMode: mode, streamActiveMonths: months })
                  } finally { setActionBusy(false) }
                }}
                onStartEditTrace={startEditFence}
              />
            )}

            {/* ── Bloc batterie ── */}
            {selected.type === 'battery' && (
              <BatteryPanel
                pin={selected}
                isTemp={isTemp}
                actionBusy={actionBusy}
                connectedFenceCount={pins.filter(p => p.type === 'fence' && p.connectedBatteryId === selected.id).length}
                onSetStatus={setBatteryStatus}
                onCheck={checkBattery}
                onTogglePower={async (pin) => {
                  if (!user) return
                  const isOff = pin.powerOn === false
                  setActionBusy(true)
                  try {
                    await updateDoc(doc(db, 'map_pins', pin.id), {
                      powerOn: !isOff,
                      updatedAt: Date.now(),
                      updatedBy: user.uid,
                    })
                    setSelected({ ...pin, powerOn: !isOff })
                  } finally { setActionBusy(false) }
                }}
              />
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

            {/* ── Bloc tâche "à faire" ── */}
            {selected.type === 'todo' && (
              <div className="mb-4 space-y-3">
                {selected.todoStatus === 'done' ? (
                  <div className="rounded-xl p-3 flex items-center gap-3 bg-meadow/10 border border-meadow/30">
                    <Check size={20} className="text-meadow" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-charcoal">Tâche terminée</p>
                      {selected.todoCompletedAt && (
                        <p className="text-xs text-muted mt-0.5">
                          Faite {timeAgo(selected.todoCompletedAt)}
                          {selected.todoCompletedBy && (() => {
                            const author = users.find(u => u.uid === selected.todoCompletedBy)?.displayName
                            return author ? ` · par ${author}` : ''
                          })()}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl p-3 flex items-center gap-3 bg-earth/10 border border-earth/30">
                    <span className="text-2xl">🪓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-charcoal">Tâche à faire</p>
                      <p className="text-xs text-muted mt-0.5">
                        Créée {timeAgo(selected.createdAt)}
                      </p>
                    </div>
                  </div>
                )}

                {!isTemp && (
                  selected.todoStatus === 'done' ? (
                    <button
                      onClick={async () => {
                        if (!user) return
                        setActionBusy(true)
                        try {
                          await updateDoc(doc(db, 'map_pins', selected.id), {
                            todoStatus: 'open',
                            todoCompletedAt: deleteField(),
                            todoCompletedBy: deleteField(),
                            updatedAt: Date.now(),
                            updatedBy: user.uid,
                          })
                          setSelected({ ...selected, todoStatus: 'open', todoCompletedAt: undefined, todoCompletedBy: undefined })
                        } finally { setActionBusy(false) }
                      }}
                      disabled={actionBusy}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl
                                 border border-border text-charcoal font-bold text-sm
                                 active:bg-cream disabled:opacity-50 transition-all"
                    >
                      <Undo2 size={18} /> Rouvrir cette tâche
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        if (!user) return
                        setActionBusy(true)
                        try {
                          const now = Date.now()
                          await updateDoc(doc(db, 'map_pins', selected.id), {
                            todoStatus: 'done',
                            todoCompletedAt: now,
                            todoCompletedBy: user.uid,
                            updatedAt: now,
                            updatedBy: user.uid,
                          })
                          setSelected({ ...selected, todoStatus: 'done', todoCompletedAt: now, todoCompletedBy: user.uid })
                        } finally { setActionBusy(false) }
                      }}
                      disabled={actionBusy}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl
                                 bg-meadow text-white font-bold text-base shadow-lg
                                 active:scale-95 disabled:opacity-50 transition-all"
                    >
                      <Check size={20} /> Marquer comme faite
                    </button>
                  )
                )}
              </div>
            )}

            {/* ── Bloc pin perso : aperçu + description éditable ── */}
            {selected.type === 'custom' && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg border-2 border-white shadow flex-shrink-0"
                        style={{ backgroundColor: selected.customColor ?? PIN_CFG.custom.color }}>
                    {selected.customEmoji ?? PIN_CFG.custom.emoji}
                  </span>
                  <span className="text-sm font-semibold text-charcoal">Repère personnel</span>
                </div>

                {customDescEdit === null ? (
                  <div className="bg-cream rounded-xl p-3 border border-border">
                    {selected.note
                      ? <p className="text-charcoal text-sm leading-relaxed whitespace-pre-wrap">{selected.note}</p>
                      : <p className="text-muted text-sm italic">Aucune description.</p>}
                    {!isTemp && (
                      <button
                        onClick={() => setCustomDescEdit(selected.note ?? '')}
                        className="mt-2 text-xs font-semibold text-forest underline active:opacity-70"
                      >
                        {selected.note ? 'Modifier la description' : 'Ajouter une description'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={customDescEdit}
                      onChange={e => setCustomDescEdit(e.target.value)}
                      rows={3}
                      autoFocus
                      placeholder="À quoi sert ce repère ?"
                      className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-charcoal text-sm
                                 focus:outline-none focus:ring-2 focus:ring-forest resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCustomDescEdit(null)}
                        disabled={actionBusy}
                        className="flex-1 py-2 rounded-lg border border-border text-sm font-semibold text-muted bg-card active:bg-cream disabled:opacity-40"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={async () => {
                          if (!user) return
                          setActionBusy(true)
                          try {
                            const next = customDescEdit.trim()
                            await updateDoc(doc(db, 'map_pins', selected.id), {
                              note: next, updatedAt: Date.now(), updatedBy: user.uid,
                            })
                            setSelected({ ...selected, note: next })
                            setCustomDescEdit(null)
                          } finally { setActionBusy(false) }
                        }}
                        disabled={actionBusy}
                        className="flex-1 py-2 rounded-lg bg-forest text-white text-sm font-bold active:opacity-90 disabled:opacity-40"
                      >
                        {actionBusy ? 'Enregistrement…' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Note générale */}
            {selected.note && selected.type !== 'fence' && selected.type !== 'custom' && (
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
