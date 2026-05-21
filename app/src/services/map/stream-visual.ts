// Rendu d'un cours d'eau (water_stream) sur la carte, en tenant compte des
// atténuations manuelles par segment. Pur — pas de DOM, pas d'I/O.
//
// Demande Eugénie 21/05/2026 V2 — Phase 2 : "à partir de ce point jusqu'à
// celui-là, -90% de débit car ça s'infiltre dans le sol".

import type { MapPin } from '../../types'

export interface StreamSegmentVisual {
  // Indice du point de départ dans pin.points[]
  fromIndex: number
  // Position lat/lng des 2 extrémités (les seules points utilisés par Polyline)
  a:        { lat: number; lng: number }
  b:        { lat: number; lng: number }
  // Couleur, épaisseur, opacité, dashArray adaptés au ratio effectif
  color:     string
  weight:    number
  opacity:   number
  dashArray?: string
  // Ratio effectif appliqué à ce segment (utile pour les tooltips)
  effectiveRatio: number
}

const COLOR_ACTIVE   = '#0284C7'
const COLOR_INACTIVE = '#0284C7'
const BASE_WEIGHT    = 4

/**
 * Décompose un water_stream en segments de polyline, chacun avec sa propre
 * opacité/dashArray selon les atténuations qui couvrent ce segment.
 *
 * Règles :
 *  - Si plusieurs atténuations se chevauchent sur un segment, on retient
 *    la PLUS RESTRICTIVE (ratio le plus bas, cas le plus sec).
 *  - Hors saison (streamMode='seasonal' ET mois courant non actif) :
 *    rendu uniformément atténué, dashArray '6 6'.
 *  - Ratio = 1 → trait plein opacité 0.85.
 *  - Ratio 0.5..1 → trait plein, opacité dégressive.
 *  - Ratio < 0.5 → trait pointillé moyen, opacité plus basse.
 *  - Ratio = 0 → trait pointillé très fin, opacité minimale.
 */
export function getStreamSegments(pin: MapPin, currentMonth1to12: number): StreamSegmentVisual[] {
  const points = pin.points ?? []
  if (points.length < 2) return []

  const isSeasonal  = pin.streamMode === 'seasonal'
  const isActiveNow = !isSeasonal || (pin.streamActiveMonths?.includes(currentMonth1to12) ?? false)
  const attenuations = pin.streamAttenuations ?? []

  const segments: StreamSegmentVisual[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]

    // Ratio effectif : 1 si aucune att ne couvre, sinon min des ratios
    let ratio = 1
    for (const att of attenuations) {
      // Une att couvre le segment [i, i+1] si from <= i ET to >= i+1
      if (att.from <= i && att.to >= i + 1) {
        if (att.ratio < ratio) ratio = att.ratio
      }
    }

    // Hors saison : on traite comme une atténuation globale
    const visualRatio = isActiveNow ? ratio : Math.min(ratio, 0.3)

    let opacity:   number
    let dashArray: string | undefined
    if (visualRatio >= 0.99) {
      opacity   = isActiveNow ? 0.85 : 0.35
      dashArray = isActiveNow ? undefined : '6 6'
    } else if (visualRatio >= 0.5) {
      opacity   = 0.6 + 0.25 * visualRatio   // 0.725..0.85
      dashArray = undefined
    } else if (visualRatio > 0) {
      opacity   = 0.35 + 0.4 * visualRatio   // 0.35..0.55
      dashArray = '8 6'
    } else {
      opacity   = 0.25
      dashArray = '3 8'
    }

    segments.push({
      fromIndex: i,
      a, b,
      color:     isActiveNow ? COLOR_ACTIVE : COLOR_INACTIVE,
      weight:    BASE_WEIGHT,
      opacity,
      dashArray,
      effectiveRatio: visualRatio,
    })
  }

  return segments
}
