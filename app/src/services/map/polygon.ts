// Géométrie polygonale avec support des zones vides intérieures (donut).
// Préparation S2 du plan refonte clôtures/espaces (demande Eugénie 21/05/2026) :
// un `land_plot` peut avoir un contour extérieur + des `holes` intérieurs
// (bouts de terre qui ne nous appartiennent pas).
//
// Pur — pas de DOM, pas d'I/O. Pas encore utilisé par Map.tsx ; sera consommé
// par le futur composant LandPlotPanel et la nouvelle logique geofence.

import { pointInPolygon } from './geometry'

export type LatLng = { lat: number; lng: number }

/**
 * Un polygone avec d'éventuelles zones vides intérieures.
 *  - `outer` : contour extérieur (au moins 3 points, polygon fermé en pratique)
 *  - `holes` : liste de polygons intérieurs ; un point dans l'un de ces holes
 *              est considéré HORS du polygone résultant.
 */
export interface PolygonWithHoles {
  outer: LatLng[]
  holes: LatLng[][]
}

/**
 * Vrai si le point est À L'INTÉRIEUR du contour outer ET en dehors de tous les
 * holes. Réutilise `pointInPolygon` (ray casting) sur chaque ring.
 *
 * Spec :
 *  - point hors de `outer` → false
 *  - point dans `outer` mais aussi dans un hole → false
 *  - point dans `outer` et dans aucun hole → true
 *  - holes vides ([]) → équivalent à `pointInPolygon(outer)`
 */
export function pointInPolygonWithHoles(lat: number, lng: number, poly: PolygonWithHoles): boolean {
  if (!pointInPolygon(lat, lng, poly.outer)) return false
  for (const hole of poly.holes) {
    if (pointInPolygon(lat, lng, hole)) return false
  }
  return true
}

/**
 * Calcule l'aire approximative (en m²) d'un polygone géographique avec holes.
 * Utilise une projection equirectangulaire locale autour du centroide — précis
 * à mieux que 1% pour des parcelles agricoles de l'ordre du km². Suffisant
 * pour afficher "1.2 ha" dans le panneau d'un land_plot.
 */
export function polygonAreaSquareMeters(poly: PolygonWithHoles): number {
  if (poly.outer.length < 3) return 0
  // Centroide approximatif pour la projection (moyenne arithmétique)
  let cLat = 0
  for (const p of poly.outer) cLat += p.lat
  cLat /= poly.outer.length
  const cosLat = Math.cos(cLat * Math.PI / 180)
  // 1° de latitude ≈ 111_320 m, 1° de longitude ≈ 111_320 * cos(lat)
  const toXY = (p: LatLng): [number, number] => [p.lng * 111_320 * cosLat, p.lat * 111_320]

  const ringArea = (ring: LatLng[]): number => {
    if (ring.length < 3) return 0
    const xy = ring.map(toXY)
    let sum = 0
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i]
      const [x2, y2] = xy[(i + 1) % xy.length]
      sum += (x1 * y2) - (x2 * y1)
    }
    return Math.abs(sum) / 2
  }

  let total = ringArea(poly.outer)
  for (const hole of poly.holes) {
    total -= ringArea(hole)
  }
  return Math.max(0, total)
}

/**
 * Format humain : "1.2 ha" pour les grandes surfaces, "450 m²" pour les petites.
 */
export function formatArea(squareMeters: number): string {
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(1).replace('.', ',')} ha`
  return `${Math.round(squareMeters)} m²`
}
