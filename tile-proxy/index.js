/**
 * Cloudflare Worker — proxy + cache des tuiles IGN pour la ferme (le-cazal).
 *
 * POURQUOI : avant, les 4 téléphones tapaient `data.geopf.fr` en direct à chaque
 * déplacement → l'IGN nous rate-limite (fair-use public) → tuiles en erreur =
 * carrés noirs + rechargement en boucle. Ici, les clients tapent CE worker ; il
 * met chaque tuile en cache au bord du réseau Cloudflare (30 j). L'IGN n'est
 * sollicité qu'UNE fois par tuile → plus de throttle, plus de carrés noirs, et
 * les zones déjà vues (la ferme) sont instantanées.
 *
 * GRATUIT : Cloudflare Workers free = 100 000 requêtes/jour, sans carte bancaire.
 * Déploiement : voir DEPLOY.md.
 */

const IGN_ORIGIN = 'https://data.geopf.fr/wmts'

// Allowlist stricte : on ne proxy QUE ces 3 couches (ce n'est pas un proxy ouvert).
const ALLOWED_LAYERS = new Set([
  'ORTHOIMAGERY.ORTHOPHOTOS',            // aérien
  'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',   // plan
  'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', // parcelles cadastrales
])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export default {
  async fetch(request, _env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS })
    }

    const url = new URL(request.url)
    const layer = url.searchParams.get('LAYER')
    if (!layer || !ALLOWED_LAYERS.has(layer)) {
      return new Response('Layer non autorisée', { status: 403, headers: CORS })
    }

    // URL upstream = mêmes paramètres WMTS, mais vers l'IGN.
    const upstream = new URL(IGN_ORIGIN)
    upstream.search = url.search

    // Cache edge Cloudflare — clé = URL upstream normalisée.
    const cache = caches.default
    const cacheKey = new Request(upstream.toString(), { method: 'GET' })

    const cached = await cache.match(cacheKey)
    if (cached) {
      const h = new Headers(cached.headers)
      h.set('X-Tile-Cache', 'HIT')
      return new Response(cached.body, { status: cached.status, headers: h })
    }

    let originResp
    try {
      originResp = await fetch(upstream.toString(), {
        headers: { 'User-Agent': 'ferme-le-cazal-tile-proxy/1.0' },
      })
    } catch {
      return new Response('IGN injoignable', { status: 502, headers: CORS })
    }

    if (!originResp.ok) {
      // On ne cache JAMAIS une erreur (sinon le carré noir se fige). Leaflet
      // réessaiera plus tard, et cette fois l'IGN répondra peut-être.
      return new Response('tuile indisponible', {
        status: originResp.status || 502,
        headers: CORS,
      })
    }

    const headers = new Headers(originResp.headers)
    headers.set('Cache-Control', 'public, max-age=2592000, immutable') // 30 j (navigateur + SW)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('X-Tile-Cache', 'MISS')

    const resp = new Response(originResp.body, { status: 200, headers })
    // Stocke dans le cache edge sans bloquer la réponse au client.
    ctx.waitUntil(cache.put(cacheKey, resp.clone()))
    return resp
  },
}
