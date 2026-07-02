// Config des épingles carte + icônes Leaflet (helpers purs).
// Extrait de Map.tsx le 02/07/2026 (chantier fluidité/hygiène) pour alléger la
// page et permettre aux couches mémoïsées (pages/map/layers/) de réutiliser ces
// helpers sans dupliquer. Aucun état, aucune dépendance React — que du pur.

import L from 'leaflet'
import type { MapPin, PinType } from '../../types'

/* ─── config épingles ─── */

export const PIN_CFG: Record<PinType, { emoji: string; label: string; color: string }> = {
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

// Catégories du filtre d'affichage carte (Nils 03/06/2026 : menu déroulant pour
// montrer/masquer des familles de pins). Chaque catégorie regroupe un ou plusieurs
// PinType. La clé sert d'identifiant stable dans le Set des catégories masquées.
export const PIN_CATEGORIES: { key: string; label: string; emoji: string; types: PinType[] }[] = [
  { key: 'water',   label: 'Points d\'eau', emoji: '💧', types: ['water_manual', 'water_natural', 'water_stream'] },
  { key: 'battery', label: 'Batteries',     emoji: '⚡', types: ['battery'] },
  { key: 'fence',   label: 'Clôtures',      emoji: '🔌', types: ['fence'] },
  { key: 'space',   label: 'Espaces',       emoji: '⛰', types: ['land_plot'] },
  { key: 'todo',    label: 'À faire',       emoji: '🪓', types: ['todo'] },
  { key: 'alert',   label: 'Alertes',       emoji: '⚠️', types: ['alert'] },
  { key: 'note',    label: 'Notes',         emoji: '📍', types: ['note'] },
  { key: 'custom',  label: 'Mes pins',      emoji: '📌', types: ['custom'] },
]
export const TYPE_TO_CAT: Partial<Record<PinType, string>> = (() => {
  const m: Partial<Record<PinType, string>> = {}
  for (const c of PIN_CATEGORIES) for (const t of c.types) m[t] = c.key
  return m
})()

/* ─── icônes Leaflet ─── */

// Surcharge visuelle des points d'eau naturelle selon leur état.
// Fonctionnel = bleu (couleur de base), asséché = orange, problème = rouge, gelé = noir + glaçon.
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
export function isSeasonalDry(pin: MapPin, currentMonth0to11: number): boolean {
  if (pin.type !== 'water_natural') return false
  if (pin.availabilityMode !== 'seasonal') return false
  const months = pin.activeMonths ?? []
  if (months.length === 0) return false
  return !months.includes(currentMonth0to11)
}

export const LABEL_ZOOM      = 17  // zoom haut : 1 ligne par animal (emoji + nom)
export const LABEL_ZOOM_MED  = 15  // zoom moyen : compteur compact "3 🐎 · 2 🫏"
export const LABEL_ZOOM_LOW  = 13  // zoom bas : juste un nombre total minuscule
// Bug Nils 22/05/2026 : en-dessous de LABEL_ZOOM_LOW les labels sont masqués
// pour éviter la surcharge visuelle ("trop d'emoji trop d'indication").

export function makeDivIcon(
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

// Marqueur position GPS d'un membre (cercle coloré avec l'initiale)
export function makeUserLocationIcon(color: string, initial: string): L.DivIcon {
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
export function makePointerIcon(color: string, name: string): L.DivIcon {
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
