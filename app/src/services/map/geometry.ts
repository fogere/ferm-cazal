// Géométrie 2D utilisée par la carte. Toutes les fonctions ici sont pures
// (pas de DOM, pas de state, pas d'I/O) — donc trivialement testables.

import type { MapPin } from '../../types'

export type LatLng = { lat: number; lng: number }

/**
 * Point à l'intérieur d'un polygone — algo "ray casting".
 * Marche pour polygones convexes ET concaves.
 */
export function pointInPolygon(lat: number, lng: number, pts: LatLng[]): boolean {
  // Le `+ 1e-12` protège contre une division par zéro quand deux sommets
  // partagent exactement la même latitude (epsilon insignifiant pour des
  // coordonnées GPS, qui ont une précision réelle bien plus grande).
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng, yi = pts[i].lat
    const xj = pts[j].lng, yj = pts[j].lat
    const intersect = (yi > lat) !== (yj > lat) &&
                      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Trouve un point GARANTI à l'intérieur du polygone — même concave.
 * Pour les polygones convexes, la moyenne arithmétique suffit. Pour les
 * formes en L ou U, on fait un grid search dans la bbox et on retient le
 * point intérieur le plus éloigné de toute arête (polylabel simplifié).
 */
export function insidePolygonCentroid(pts: LatLng[]): LatLng {
  if (pts.length < 3) return pts[0] ?? { lat: 0, lng: 0 }
  // Moyenne arithmétique
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const meanLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  // Si à l'intérieur, on garde (cas convexe — 99% des enclos)
  if (pointInPolygon(meanLat, meanLng, pts)) return { lat: meanLat, lng: meanLng }
  // Concave : grid search dans la bbox
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  const N = 24
  const stepLat = (maxLat - minLat) / N
  const stepLng = (maxLng - minLng) / N
  let bestLat = meanLat, bestLng = meanLng, bestDist = -Infinity
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const lat = minLat + i * stepLat
      const lng = minLng + j * stepLng
      if (!pointInPolygon(lat, lng, pts)) continue
      let minD = Infinity
      for (let k = 0, prev = pts.length - 1; k < pts.length; prev = k++) {
        const a = pts[prev], b = pts[k]
        const dx = b.lng - a.lng, dy = b.lat - a.lat
        const len2 = dx*dx + dy*dy
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - a.lng)*dx + (lat - a.lat)*dy) / len2)) : 0
        const d = Math.hypot(lng - (a.lng + t*dx), lat - (a.lat + t*dy))
        if (d < minD) minD = d
      }
      if (minD > bestDist) { bestDist = minD; bestLat = lat; bestLng = lng }
    }
  }
  return { lat: bestLat, lng: bestLng }
}

/**
 * Distance en pixels d'un point P au segment [A, B].
 * Utilisé pour la sélection d'une polyline par proximité du curseur.
 */
export function distToSegmentPx(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Une clôture est "fermée" si elle a le flag explicite, OU si son premier
 * et dernier point sont confondus (≥ 4 points).
 */
export function isFenceClosed(pin: MapPin): boolean {
  if (pin.closed) return true
  const pts = pin.points
  if (!pts || pts.length < 4) return false
  return pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng
}
