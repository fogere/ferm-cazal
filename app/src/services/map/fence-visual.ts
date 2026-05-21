// Calcul du rendu visuel d'une clôture (couleur, opacité, dashArray) à partir
// de son preset + de sa batterie connectée + de son `electricityIntensity`.
// Pur — pas de DOM, pas de state, pas d'I/O.
//
// Extrait de Map.tsx (commit fb40eb9 du 21/05/2026) pour pouvoir évoluer la
// logique électrique (bug Nils 21/05) sans toucher au composant de 5k lignes.

import type { MapPin, FencePreset } from '../../types'

export interface FenceVisual {
  color:      string
  weight:     number
  opacity:    number
  dashArray?: string
}

export interface ElectricityState {
  // 'full' : courant normal (par défaut)
  // 'attenuated' : courant faible (fin de circuit, dispersion)
  // 'off' : pas de courant (batterie débranchée ou explicitement coupé)
  effective: 'full' | 'attenuated' | 'off'
  // true si l'état "off" vient d'une batterie connectée éteinte (et pas d'une
  // valeur explicite sur la clôture). Permet d'afficher un tooltip différent.
  forcedByBattery: boolean
}

/**
 * Évalue l'état électrique effectif d'une clôture en tenant compte de la
 * batterie connectée. Si la batterie a `powerOn === false`, on force 'off'.
 */
export function getElectricityState(pin: MapPin, allPins: MapPin[]): ElectricityState {
  const battery = pin.connectedBatteryId
    ? allPins.find(p => p.id === pin.connectedBatteryId)
    : null
  const batteryOff = !!(battery && battery.powerOn === false)
  if (batteryOff) return { effective: 'off', forcedByBattery: true }
  return {
    effective: pin.electricityIntensity ?? 'full',
    forcedByBattery: false,
  }
}

/**
 * Calcule les options de polyline Leaflet pour une clôture. La logique :
 *   1. couleur = presetColor ou orange par défaut
 *   2. épaisseur = baseW(wireCount) + bonus si segment de coupe
 *   3. dashArray selon wireStyle (barbed/ribbon/plain/electric)
 *   4. si electric : applique l'atténuation / coupure batterie par-dessus
 *
 * Strictement behavior-preserving par rapport à l'inline original
 * (Map.tsx#L2101-L2135).
 */
export function getFenceVisualState(pin: MapPin, preset: FencePreset | undefined, allPins: MapPin[]): FenceVisual {
  let color   = pin.presetColor ?? '#EA580C'
  const count = pin.wireCount   ?? 1
  const baseW = Math.max(2, 1.5 + count * 1.5)
  const weight = pin.cutFromId ? baseW + 1 : baseW

  let dashArray: string | undefined =
      preset?.wireStyle === 'barbed' ? '2 6'
    : preset?.wireStyle === 'ribbon' ? '14 4'
    : preset?.wireStyle === 'plain'  ? '8 6'
    : undefined  // electric : ligne continue par défaut

  let opacity = 0.9

  if (preset?.wireStyle === 'electric') {
    const { effective } = getElectricityState(pin, allPins)
    if (effective === 'attenuated') {
      opacity   = 0.55
      dashArray = '6 6'
    } else if (effective === 'off') {
      opacity   = 0.35
      dashArray = '3 8'
      color     = '#94A3B8'
    }
  }

  return { color, weight, opacity, dashArray }
}
