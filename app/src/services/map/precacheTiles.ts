/**
 * Pré-téléchargement des tuiles aériennes IGN d'une zone, pour un usage hors-ligne
 * instantané. Feature Nils 03/06/2026 : le serveur IGN (data.geopf.fr) est lent à la
 * première visite d'une zone (d'où les "zones blanches"). Comme la ferme est une zone
 * FIXE, on télécharge une fois toutes ses tuiles ; ensuite le service worker les sert
 * depuis le cache (CacheFirst, cf. sw.ts) → carte immédiate, même sans réseau.
 *
 * On `fetch()` chaque tuile en `cors` (IGN renvoie access-control-allow-origin: *) :
 * le SW intercepte et met en cache UNIQUEMENT les réponses 200. Bug Nils 11/06/2026 :
 * en `no-cors`, les réponses étaient opaques (status 0) et les erreurs IGN (rate-limit
 * du téléchargement massif) étaient cachées comme des tuiles valides → couture / bouts
 * corrompus servis indéfiniment. En CORS, une erreur n'est jamais mise en cache.
 */

// Même couche/URL que la carte (ORTHOPHOTOS JPEG). TILEMATRIXSET=PM = tuilage XYZ standard.
const IGN_AERIAL_TPL =
  'https://ferme-tiles.ferme-nilslamber.workers.dev/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg'

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export interface PrecacheProgress {
  done: number
  total: number
  failed: number
}

export interface PrecacheOptions {
  center: [number, number]   // [lat, lng]
  radiusMeters: number       // demi-côté de la zone carrée à couvrir
  minZoom: number
  maxZoom: number
  onProgress?: (p: PrecacheProgress) => void
  signal?: AbortSignal
}

/** Nombre total de tuiles qui seront téléchargées pour ces options (estimation/affichage). */
export function countTiles(opts: Pick<PrecacheOptions, 'center' | 'radiusMeters' | 'minZoom' | 'maxZoom'>): number {
  const [lat, lng] = opts.center
  const dLat = opts.radiusMeters / 111_320
  const dLng = opts.radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180))
  let total = 0
  for (let z = opts.minZoom; z <= opts.maxZoom; z++) {
    const xMin = lon2tile(lng - dLng, z)
    const xMax = lon2tile(lng + dLng, z)
    const yMin = lat2tile(lat + dLat, z) // nord = y plus petit
    const yMax = lat2tile(lat - dLat, z)
    total += (xMax - xMin + 1) * (yMax - yMin + 1)
  }
  return total
}

/**
 * Télécharge (et fait mettre en cache par le SW) toutes les tuiles de la zone.
 * Concurrence limitée pour ne pas saturer IGN. Respecte l'AbortSignal.
 */
export async function precacheAerialTiles(opts: PrecacheOptions): Promise<PrecacheProgress> {
  const [lat, lng] = opts.center
  const dLat = opts.radiusMeters / 111_320
  const dLng = opts.radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180))

  const tiles: { z: number; x: number; y: number }[] = []
  for (let z = opts.minZoom; z <= opts.maxZoom; z++) {
    const xMin = lon2tile(lng - dLng, z)
    const xMax = lon2tile(lng + dLng, z)
    const yMin = lat2tile(lat + dLat, z)
    const yMax = lat2tile(lat - dLat, z)
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) tiles.push({ z, x, y })
    }
  }

  const total = tiles.length
  let done = 0
  let failed = 0
  let idx = 0
  const CONCURRENCY = 8

  async function worker(): Promise<void> {
    while (idx < tiles.length) {
      if (opts.signal?.aborted) return
      const t = tiles[idx++]
      const url = IGN_AERIAL_TPL
        .replace('{z}', String(t.z))
        .replace('{x}', String(t.x))
        .replace('{y}', String(t.y))
      try {
        // CORS : on voit le vrai status. Une tuile en erreur (404/429/5xx) n'est
        // pas mise en cache par le SW (CacheableResponsePlugin statuses [200]).
        const resp = await fetch(url, { mode: 'cors', signal: opts.signal })
        if (!resp.ok) failed++
      } catch {
        failed++
      }
      done++
      opts.onProgress?.({ done, total, failed })
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  return { done, total, failed }
}
