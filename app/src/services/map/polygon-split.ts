// Algorithme de scindage : découpe un polygon par une polyline qui le traverse.
// Sert au scindage automatique d'un land_plot par une clôture (S7 refonte
// clôtures/espaces, demande Eugénie 21/05/2026).
//
// Pur — pas de DOM, pas d'I/O. Testable unitairement.
//
// Cas géré (cas favorable) :
//   - exactement 2 intersections entre la polyline et le contour du polygon
//   - chaque intersection sur un EDGE DIFFÉRENT du polygon
//
// Cas non gérés (retour null avec une raison) :
//   - 0/1 intersection : la clôture ne traverse pas vraiment
//   - ≥3 intersections : clôture en zigzag ou multi-traversées
//   - 2 intersections sur le MÊME edge : cas dégénéré
//   - aire d'un enfant trop faible : refus pour éviter polygons cassés

import type { LatLng } from './geometry'
import { polygonAreaSquareMeters } from './polygon'

export interface SplitResult {
  /** Premier sous-polygon (contour). */
  p1:   LatLng[]
  /** Deuxième sous-polygon (contour). */
  p2:   LatLng[]
  /** Les 2 points d'intersection clôture↔bord, dans l'ordre du tracé clôture. */
  cut:  [LatLng, LatLng]
}

export interface SplitError {
  /** Code identifiant la raison du refus, pour message UX. */
  code:
    | 'no-intersection'           // la clôture ne touche jamais le contour
    | 'single-intersection'       // un seul point de contact (touche sans traverser)
    | 'too-many-intersections'    // ≥3 — clôture trop complexe
    | 'same-edge'                 // les 2 intersections tombent sur le même edge
    | 'degenerate'                // un des polygons résultants a une aire ≈ 0
  message: string
}

const EPSILON = 1e-9
// Tolérance géométrique pour dédupliquer 2 intersections au même point physique.
// ~1e-7° ≈ 1 cm — bien en dessous de la précision du snap (mètres).
const GEO_EPSILON = 1e-7

/**
 * Intersection de 2 segments [a, b] et [c, d] en coordonnées 2D (lat/lng).
 * Renvoie le point d'intersection si t ∈ [0,1] ET u ∈ [0,1] (extrémités incluses),
 * ou null sinon. Les contacts aux extrémités sont autorisés — c'est le cas
 * typique quand l'utilisatrice snap son 1er ou dernier point de clôture sur
 * le contour d'un land_plot. Les éventuels doublons (1 intersection comptée
 * 2× car au sommet d'un polygon) sont éliminés par dédup en aval.
 */
function segmentIntersection(a: LatLng, b: LatLng, c: LatLng, d: LatLng): LatLng | null {
  const x1 = a.lng, y1 = a.lat
  const x2 = b.lng, y2 = b.lat
  const x3 = c.lng, y3 = c.lat
  const x4 = d.lng, y4 = d.lat

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < EPSILON) return null // parallèles

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom

  // Extrémités tolérées (snap auto). On accepte t ∈ [−ε, 1+ε] et idem u.
  if (t < -EPSILON || t > 1 + EPSILON) return null
  if (u < -EPSILON || u > 1 + EPSILON) return null

  return {
    lng: x1 + t * (x2 - x1),
    lat: y1 + t * (y2 - y1),
  }
}

/**
 * Découpe un polygon (fermé, points sans doublon final) par une polyline.
 *
 * @param polygon contour du polygon, ordre quelconque (CW ou CCW)
 * @param polyline tracé de la clôture, ouverte
 * @returns SplitResult si scindage possible, sinon SplitError
 */
export function splitPolygonByPolyline(
  polygon: LatLng[],
  polyline: LatLng[],
): SplitResult | SplitError {
  if (polygon.length < 3 || polyline.length < 2) {
    return { code: 'no-intersection', message: 'Tracé insuffisant.' }
  }

  // 1. Trouver toutes les intersections polyline ↔ contour polygon.
  //    Pour chaque intersection on retient : point + edge polygon (index) +
  //    edge polyline (index) + position le long de la polyline (j + u).
  type Hit = {
    point:    LatLng
    polyEdge: number   // index i tel que segment = polygon[i]→polygon[(i+1)%N]
    lineEdge: number   // index j tel que segment = polyline[j]→polyline[j+1]
    lineT:    number   // position absolue sur la polyline : lineEdge + u
  }
  const hits: Hit[] = []

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    for (let j = 0; j < polyline.length - 1; j++) {
      const c = polyline[j]
      const d = polyline[j + 1]
      const p = segmentIntersection(a, b, c, d)
      if (p) {
        // recalculer u pour le t le long de la polyline (juste pour ordering)
        // u peut être recalculé à partir du point trouvé
        const dx = d.lng - c.lng
        const dy = d.lat - c.lat
        const len = Math.hypot(dx, dy)
        const u = len < EPSILON ? 0 : Math.hypot(p.lng - c.lng, p.lat - c.lat) / len
        hits.push({ point: p, polyEdge: i, lineEdge: j, lineT: j + u })
      }
    }
  }

  // 2. Trier puis dédupliquer : si la polyline touche un SOMMET du polygon,
  //    on a 2 hits sur les 2 edges adjacents au même point géométrique. On
  //    fusionne ces doublons (distance < GEO_EPSILON) en gardant le premier.
  hits.sort((a, b) => a.lineT - b.lineT)
  const dedup: Hit[] = []
  for (const h of hits) {
    const prev = dedup[dedup.length - 1]
    if (prev && Math.hypot(h.point.lng - prev.point.lng, h.point.lat - prev.point.lat) < GEO_EPSILON) {
      continue
    }
    dedup.push(h)
  }

  // 3. Filtrer le nombre d'intersections après dedup
  if (dedup.length === 0) {
    return { code: 'no-intersection', message: "La clôture ne traverse pas l'espace." }
  }
  if (dedup.length === 1) {
    return { code: 'single-intersection', message: "La clôture touche l'espace mais ne le traverse pas." }
  }
  if (dedup.length > 2) {
    return { code: 'too-many-intersections', message: `La clôture traverse l'espace ${dedup.length} fois — trop complexe pour scinder automatiquement.` }
  }

  const [h1, h2] = dedup

  // 4. Refus si les 2 hits tombent sur le MÊME edge du polygon
  if (h1.polyEdge === h2.polyEdge) {
    return { code: 'same-edge', message: 'Les 2 points de contact sont sur le même bord — la clôture fait une boucle au bord et ne scinde pas vraiment.' }
  }

  // 5. Extraire le segment de polyline entre h1 et h2 (en ordre du tracé)
  //    pathBetween = [h1.point, polyline[h1.lineEdge+1..h2.lineEdge], h2.point]
  const pathBetween: LatLng[] = [h1.point]
  for (let j = h1.lineEdge + 1; j <= h2.lineEdge; j++) {
    pathBetween.push(polyline[j])
  }
  pathBetween.push(h2.point)

  // 6. Construire les 2 sous-polygons
  //    P1 = h1 → polygon[h1.polyEdge+1 .. h2.polyEdge] → h2 → reverse(pathBetween) sans extrémités
  //    P2 = h2 → polygon[h2.polyEdge+1 .. wrap .. h1.polyEdge] → h1 → pathBetween sans extrémités
  const N = polygon.length
  const arcForward: LatLng[] = []
  for (let k = h1.polyEdge + 1; ; k = (k + 1) % N) {
    arcForward.push(polygon[k % N])
    if (k % N === h2.polyEdge) break
  }
  const arcBackward: LatLng[] = []
  for (let k = h2.polyEdge + 1; ; k = (k + 1) % N) {
    arcBackward.push(polygon[k % N])
    if (k % N === h1.polyEdge) break
  }

  // Le chemin entre h1 et h2 le long de la clôture (points intermédiaires uniquement)
  const innerCut = pathBetween.slice(1, -1)

  // P1 : h1 → arcForward (de h1.polyEdge+1 à h2.polyEdge) → h2 → innerCut reverse → retour h1 (implicite)
  const p1: LatLng[] = [h1.point, ...arcForward, h2.point, ...innerCut.slice().reverse()]
  // P2 : h2 → arcBackward (de h2.polyEdge+1 à h1.polyEdge wrap) → h1 → innerCut
  const p2: LatLng[] = [h2.point, ...arcBackward, h1.point, ...innerCut]

  // 7. Garde-fous : aire minimale 1 m² pour éviter des polygons dégénérés
  const a1 = polygonAreaSquareMeters({ outer: p1, holes: [] })
  const a2 = polygonAreaSquareMeters({ outer: p2, holes: [] })
  if (a1 < 1 || a2 < 1) {
    return { code: 'degenerate', message: 'Un des deux espaces résultants serait trop petit. Vérifie le tracé.' }
  }

  return { p1, p2, cut: [h1.point, h2.point] }
}

/** Type guard pratique pour discriminer SplitResult vs SplitError. */
export function isSplitSuccess(r: SplitResult | SplitError): r is SplitResult {
  return 'p1' in r
}

/**
 * Scanne une liste de candidats land_plot et renvoie le premier qui est
 * scindable par la polyline donnée. Utilisé à la création d'une clôture
 * pour proposer le découpage automatique (S7.2).
 *
 * Tri par bbox décroissant : si la clôture traverse plusieurs land_plots
 * (cas rare, plots imbriqués), on privilégie le plus grand. La bbox suffit
 * pour l'ordre — pas besoin de calculer l'aire exacte ici.
 *
 * @param polyline tracé de la clôture
 * @param candidates land_plots actifs candidats (le caller filtre déjà ceux
 *                   marqués inactifs ou sans points)
 * @returns le plot scindable + son SplitResult, ou null si aucun
 */
export function detectPlotSplit<T extends { points?: LatLng[] }>(
  polyline:   LatLng[],
  candidates: T[],
): { plot: T; split: SplitResult } | null {
  if (polyline.length < 2) return null

  const ranked = [...candidates]
    .filter(c => (c.points?.length ?? 0) >= 3)
    .sort((a, b) => bboxArea(b.points!) - bboxArea(a.points!))

  for (const plot of ranked) {
    const r = splitPolygonByPolyline(plot.points!, polyline)
    if (isSplitSuccess(r)) return { plot, split: r }
  }
  return null
}

/**
 * Diagnostic : si aucun candidat n'est scindable, renvoie le plot dont la
 * clôture s'est le plus rapprochée d'un scindage réussi, avec l'erreur
 * correspondante. Sert au feedback utilisateur (bug Nils 22/05/2026,
 * problème 4 : "j'ai tout essayé pour couper en 2, ça veut pas, je sais pas
 * pourquoi"). Avant : `null` silencieux et la clôture se créait par-dessus.
 *
 * Priorité (du plus informatif au moins) :
 *   1. degenerate            (le tracé est presque bon, juste trop fin)
 *   2. same-edge             (les 2 points touchent le même bord)
 *   3. too-many-intersections (zigzag)
 *   4. single-intersection   (touche mais ne traverse pas)
 *   5. no-intersection       → ignoré : la clôture ne touche aucun plot, pas
 *                              de feedback à donner.
 *
 * @returns le plot + erreur du meilleur "near-miss", ou null si vraiment
 *          aucun plot n'a été touché.
 */
export function diagnoseSplitFailure<T extends { points?: LatLng[]; name?: string }>(
  polyline:   LatLng[],
  candidates: T[],
): { plot: T; error: SplitError } | null {
  if (polyline.length < 2) return null

  const priority: Record<SplitError['code'], number> = {
    'degenerate':              1,
    'same-edge':               2,
    'too-many-intersections':  3,
    'single-intersection':     4,
    'no-intersection':         5,
  }

  let best: { plot: T; error: SplitError } | null = null

  for (const plot of candidates) {
    if (!plot.points || plot.points.length < 3) continue
    const r = splitPolygonByPolyline(plot.points, polyline)
    if (isSplitSuccess(r)) continue  // déjà géré par detectPlotSplit
    if (r.code === 'no-intersection') continue
    if (!best || priority[r.code] < priority[best.error.code]) {
      best = { plot, error: r }
    }
  }

  return best
}

function bboxArea(points: LatLng[]): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  return (maxLat - minLat) * (maxLng - minLng)
}
