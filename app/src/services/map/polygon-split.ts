// Algorithme de scindage : découpe un polygon par une polyline qui le traverse.
// Sert au scindage automatique d'un land_plot par une clôture (S7 refonte
// clôtures/espaces, demande Eugénie 21/05/2026).
//
// Pur — pas de DOM, pas d'I/O. Testable unitairement.
//
// Approche (refonte Nils 22/05/2026, soir) :
//   On classe chaque sommet de la polyline en `inside`, `outside`, ou
//   `on-edge` (≤ EDGE_TOLERANCE_M mètres du contour). Le "tunnel intérieur"
//   = sous-séquence de sommets `inside` du premier au dernier. Le point
//   d'entrée = sommet on-edge juste avant, OU intersection avec le contour
//   si le précédent est outside. Symétrique pour la sortie.
//
//   Cette approche résout le bug critique de l'algo précédent : compter les
//   intersections plantait dès que la clôture longeait le contour (snap au
//   sommet, tracé sur le bord avant de couper), ce qui est le cas standard
//   en usage réel (le user place sa clôture sur les sommets du terrain).
//
// Cas refusés (avec raison explicite via SplitError) :
//   - aucun sommet intérieur     → no-intersection
//   - polyline part de l'intérieur → starts-inside
//   - polyline finit à l'intérieur → ends-inside
//   - entrée et sortie sur le même edge → same-edge
//   - un des polygons résultants < 1 m² → degenerate

import { pointInPolygon, type LatLng } from './geometry'
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
    | 'no-intersection'   // aucun sommet de la polyline n'est strictement intérieur
    | 'starts-inside'     // la clôture commence à l'intérieur du polygon
    | 'ends-inside'       // la clôture finit à l'intérieur du polygon
    | 'same-edge'         // entrée et sortie sur le même bord du polygon
    | 'degenerate'        // un des polygons résultants a une aire ≈ 0
  message: string
}

const EPSILON = 1e-9
// Tolérance pour considérer qu'un sommet de la polyline est "sur le bord" du
// polygon (snap manuel, tracé qui longe le contour). 2 m couvre :
//   - le snap UI explicite (rayon ~44 px côté carte, qui mappe à ~1-2 m
//     côté terrain au zoom 22 le plus utilisé)
//   - les petits décalages dus à l'imprécision tactile
//   - la marge de manœuvre que se laisse Eugénie quand elle suit le contour
const EDGE_TOLERANCE_M = 2.0

// Mètres par degré à la latitude approximative de la ferme (Roquefixade ~43°).
// Pour des distances < 100 m on traite les degrés comme du x/y plat — l'erreur
// est < 0.1% à cette échelle, négligeable pour la détection d'edge.
const M_PER_DEG_LAT = 111_000
function mPerDegLng(lat: number): number {
  return 111_000 * Math.cos((lat * Math.PI) / 180)
}

/**
 * Intersection de 2 segments [a, b] et [c, d] en coordonnées 2D (lat/lng).
 * Renvoie le point d'intersection si t ∈ [0,1] ET u ∈ [0,1] (extrémités incluses),
 * ou null sinon. Tolère les contacts aux extrémités (snap auto).
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

  if (t < -EPSILON || t > 1 + EPSILON) return null
  if (u < -EPSILON || u > 1 + EPSILON) return null

  return {
    lng: x1 + t * (x2 - x1),
    lat: y1 + t * (y2 - y1),
  }
}

/**
 * Distance en mètres d'un point P au segment [A, B], calculée en projetant
 * (lng, lat) sur un repère plat local en mètres (suffisant à l'échelle d'un
 * polygon de terrain).
 */
function distanceFromPointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const lat0 = (a.lat + b.lat) / 2
  const mLng = mPerDegLng(lat0)
  const ax = a.lng * mLng,  ay = a.lat * M_PER_DEG_LAT
  const bx = b.lng * mLng,  by = b.lat * M_PER_DEG_LAT
  const px = p.lng * mLng,  py = p.lat * M_PER_DEG_LAT
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Trouve l'edge du polygon le plus proche d'un point + la distance en mètres.
 * Utilisé pour décider si un sommet de la polyline est "sur le bord".
 */
function findClosestPolygonEdge(p: LatLng, polygon: LatLng[]): { edgeIdx: number; distanceM: number } {
  let bestIdx  = -1
  let bestDist = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const d = distanceFromPointToSegmentMeters(p, a, b)
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return { edgeIdx: bestIdx, distanceM: bestDist }
}

type PointStatus = 'inside' | 'outside' | 'on-edge'

/**
 * Classe un point par rapport au polygon : intérieur, extérieur, ou "sur le
 * bord" (distance ≤ EDGE_TOLERANCE_M d'un edge). Pour on-edge, on retourne
 * aussi l'index de l'edge le plus proche.
 */
function classifyPoint(p: LatLng, polygon: LatLng[]): { status: PointStatus; edgeIdx: number } {
  const closest = findClosestPolygonEdge(p, polygon)
  if (closest.distanceM <= EDGE_TOLERANCE_M) {
    return { status: 'on-edge', edgeIdx: closest.edgeIdx }
  }
  return {
    status: pointInPolygon(p.lat, p.lng, polygon) ? 'inside' : 'outside',
    edgeIdx: -1,
  }
}

/**
 * Trouve l'intersection d'un segment [a, b] avec un edge du polygon.
 * `mode = 'first'` retourne le hit le plus proche de a (le premier qu'on
 * traverse en partant de a) ; `mode = 'last'` retourne celui le plus proche
 * de b. Utilisé pour les transitions outside ↔ inside dans la polyline.
 */
function findSegmentEdgeIntersection(
  a: LatLng, b: LatLng, polygon: LatLng[], mode: 'first' | 'last',
): { point: LatLng; polyEdge: number } | null {
  let best: { point: LatLng; polyEdge: number; t: number } | null = null
  const dx = b.lng - a.lng, dy = b.lat - a.lat
  const len = Math.hypot(dx, dy)
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i]
    const d = polygon[(i + 1) % polygon.length]
    const hit = segmentIntersection(a, b, c, d)
    if (!hit) continue
    const t = len < 1e-12 ? 0 : Math.hypot(hit.lng - a.lng, hit.lat - a.lat) / len
    if (!best || (mode === 'first' ? t < best.t : t > best.t)) {
      best = { point: hit, polyEdge: i, t }
    }
  }
  return best ? { point: best.point, polyEdge: best.polyEdge } : null
}

/**
 * Découpe un polygon (fermé, points sans doublon final) par une polyline.
 *
 * Algo : identifie la sous-séquence des sommets de la polyline strictement
 * intérieurs au polygon (le "tunnel"). Le scindage utilise ce tunnel + les
 * 2 points où la polyline traverse le contour (en entrée et en sortie du
 * tunnel). Les portions de polyline qui longent le bord avant/après le
 * tunnel ne perturbent plus le scindage (ce qui plantait avec l'ancien algo
 * basé sur le compte des intersections).
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

  // 1. Classifier chaque sommet de la polyline
  const classes = polyline.map(p => classifyPoint(p, polygon))

  // 2. Indices des sommets strictement intérieurs
  const insideIdx: number[] = []
  for (let i = 0; i < classes.length; i++) {
    if (classes[i].status === 'inside') insideIdx.push(i)
  }

  if (insideIdx.length === 0) {
    return { code: 'no-intersection', message: "La clôture ne passe pas à l'intérieur de l'espace." }
  }

  const firstIn = insideIdx[0]
  const lastIn  = insideIdx[insideIdx.length - 1]

  // 3. Point d'entrée (juste avant firstIn)
  let entryPoint: LatLng
  let entryEdge:  number
  if (firstIn === 0) {
    return { code: 'starts-inside', message: "La clôture doit partir du bord de l'espace, pas de son intérieur." }
  }
  const prev = classes[firstIn - 1]
  if (prev.status === 'on-edge') {
    entryPoint = polyline[firstIn - 1]
    entryEdge  = prev.edgeIdx
  } else {
    // outside → intersection segment [polyline[firstIn-1], polyline[firstIn]] avec le contour
    const hit = findSegmentEdgeIntersection(polyline[firstIn - 1], polyline[firstIn], polygon, 'last')
    if (!hit) {
      return { code: 'no-intersection', message: "Impossible de localiser le point d'entrée de la clôture dans l'espace." }
    }
    entryPoint = hit.point
    entryEdge  = hit.polyEdge
  }

  // 4. Point de sortie (juste après lastIn)
  let exitPoint: LatLng
  let exitEdge:  number
  if (lastIn === polyline.length - 1) {
    return { code: 'ends-inside', message: "La clôture doit revenir sur le bord de l'espace, pas y finir à l'intérieur." }
  }
  const next = classes[lastIn + 1]
  if (next.status === 'on-edge') {
    exitPoint = polyline[lastIn + 1]
    exitEdge  = next.edgeIdx
  } else {
    const hit = findSegmentEdgeIntersection(polyline[lastIn], polyline[lastIn + 1], polygon, 'first')
    if (!hit) {
      return { code: 'no-intersection', message: "Impossible de localiser le point de sortie de la clôture." }
    }
    exitPoint = hit.point
    exitEdge  = hit.polyEdge
  }

  // 5. Refus si entrée et sortie sur le même edge
  if (entryEdge === exitEdge) {
    return { code: 'same-edge', message: "L'entrée et la sortie de la clôture sont sur le même bord — la clôture ne scinde pas vraiment l'espace." }
  }

  // 6. Cut path = entryPoint + sommets intérieurs + exitPoint
  const cutPath: LatLng[] = [entryPoint, ...polyline.slice(firstIn, lastIn + 1), exitPoint]
  const innerCut = cutPath.slice(1, -1)

  // 7. Reconstruire les 2 sous-polygons en parcourant le contour
  //    P1 : entryPoint → arc du polygon de entryEdge+1 à exitEdge → exitPoint → cutPath reverse
  //    P2 : exitPoint  → arc du polygon de exitEdge+1  à entryEdge → entryPoint → cutPath
  const N = polygon.length
  const arcForward: LatLng[] = []
  for (let k = (entryEdge + 1) % N; ; k = (k + 1) % N) {
    arcForward.push(polygon[k])
    if (k === exitEdge) break
  }
  const arcBackward: LatLng[] = []
  for (let k = (exitEdge + 1) % N; ; k = (k + 1) % N) {
    arcBackward.push(polygon[k])
    if (k === entryEdge) break
  }

  const p1: LatLng[] = [entryPoint, ...arcForward, exitPoint, ...innerCut.slice().reverse()]
  const p2: LatLng[] = [exitPoint,  ...arcBackward, entryPoint, ...innerCut]

  // 8. Garde-fou : refus si un enfant est dégénéré (< 1 m²)
  const a1 = polygonAreaSquareMeters({ outer: p1, holes: [] })
  const a2 = polygonAreaSquareMeters({ outer: p2, holes: [] })
  if (a1 < 1 || a2 < 1) {
    return { code: 'degenerate', message: 'Un des deux espaces résultants serait trop petit. Vérifie le tracé.' }
  }

  return { p1, p2, cut: [entryPoint, exitPoint] }
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
 *   1. degenerate     (le tracé est presque bon, juste trop fin)
 *   2. same-edge      (les 2 points touchent le même bord)
 *   3. starts-inside  (la clôture part de l'intérieur)
 *   4. ends-inside    (la clôture finit à l'intérieur)
 *   5. no-intersection → ignoré : la clôture ne touche aucun plot, pas
 *                        de feedback à donner.
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
    'degenerate':       1,
    'same-edge':        2,
    'starts-inside':    3,
    'ends-inside':      4,
    'no-intersection':  5,
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
