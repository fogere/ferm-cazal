// Test autonome du CACHE CLIENT des tuiles (Nils 02/07/2026).
// Pilote Brave headless (Chromium) et mesure, pour de vrai, si une tuile déjà
// chargée est re-servie depuis le cache (instantané) ou re-téléchargée (lent).
// Deux couches testées séparément :
//   Phase A — cache HTTP navigateur seul (pas de SW)   -> le header immutable suffit-il ?
//   Phase B — Service Worker CacheFirst (comme la prod) -> les tuiles sont-elles stockées + resservies ?
// Aucune auth requise (les tuiles du worker sont publiques).

import http from 'node:http'
import puppeteer from 'puppeteer-core'

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const WORKER_HOST = 'ferme-tiles.ferme-nilslamber.workers.dev'
const WORKER = `https://${WORKER_HOST}/`
const FARM = { lat: 42.9375, lon: 1.7452 }

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}
const tileUrl = (z, dx = 0, dy = 0) => {
  const x = lon2tile(FARM.lon, z) + dx, y = lat2tile(FARM.lat, z) + dy
  return `${WORKER}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS`
    + `&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image%2Fjpeg`
}
// Une petite grille 3x3 à z16/17/18 autour de la ferme (27 tuiles) = ce qu'un
// petit déplacement traverse.
const TILES = []
for (const z of [16, 17, 18]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) TILES.push(tileUrl(z, dx, dy))

// ── Service worker de test : réplique fidèle de la stratégie CacheFirst de prod ──
const SW_JS = `
const CACHE = 'ign-tiles-v2'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.hostname === '${WORKER_HOST}') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(event.request)
      if (hit) return hit                       // <- cache-hit = instantané
      const resp = await fetch(event.request)
      if (resp.status === 200) await cache.put(event.request, resp.clone())
      return resp
    })())
  }
})
`

const PAGE = (withSW) => `<!doctype html><html><head><meta charset=utf-8><title>tile-cache-test</title></head>
<body><h1>tile-cache-test</h1><script>
window.__ready = ${withSW ? 'false' : 'true'}
${withSW ? `
navigator.serviceWorker.register('/sw.js').then(async () => {
  await navigator.serviceWorker.ready
  // Attendre que ce client soit CONTRÔLÉ par le SW (sinon les fetch ne passent pas dedans)
  if (!navigator.serviceWorker.controller) {
    await new Promise(res => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }))
  }
  window.__ready = true
})
` : ''}
window.fetchTile = async (url) => {
  const t0 = performance.now()
  try {
    const r = await fetch(url, { mode: 'cors' })
    await r.blob()
    return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) }
  } catch (e) { return { ok: false, status: 0, ms: Math.round(performance.now() - t0), err: String(e) } }
}
window.cacheStorageCount = async (name) => {
  try { const c = await caches.open(name); return (await c.keys()).length } catch { return -1 }
}
</script></body></html>`

// ── Serveur statique local (origine sécurisée localhost → SW autorisé) ──
const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(SW_JS) }
  if (req.url.startsWith('/pwa')) { res.setHeader('Content-Type', 'text/html'); return res.end(PAGE(true)) }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE(false))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const base = `http://127.0.0.1:${PORT}`

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const pct = (n, d) => `${n}/${d} (${Math.round(100 * n / d)}%)`

let browser
try {
  browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  // Journal réseau bas-niveau (CDP) : d'où vient CHAQUE réponse ?
  const netLog = []
  const page = await browser.newPage()
  page.on('response', (r) => {
    if (r.url().includes(WORKER_HOST)) {
      netLog.push({ url: r.url(), fromCache: r.fromCache(), fromSW: r.fromServiceWorker(), status: r.status() })
    }
  })

  // ─────────────── PHASE A : cache HTTP navigateur (sans SW) ───────────────
  await page.goto(`${base}/plain`, { waitUntil: 'load' })
  const A_pass1 = [], A_pass2 = []
  for (const u of TILES) A_pass1.push(await page.evaluate(u => window.fetchTile(u), u))
  const netAfterP1 = netLog.length
  for (const u of TILES) A_pass2.push(await page.evaluate(u => window.fetchTile(u), u))
  const A_net2 = netLog.slice(netAfterP1) // réponses du 2e passage
  const A_fromCache2 = A_net2.filter(r => r.fromCache).length
  const A_ok1 = A_pass1.filter(r => r.ok).length

  // ─────────────── PHASE B : Service Worker CacheFirst (comme la prod) ───────────────
  netLog.length = 0
  await page.goto(`${base}/pwa`, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', { timeout: 15000 })
  const B_pass1 = [], B_pass2 = []
  for (const u of TILES) B_pass1.push(await page.evaluate(u => window.fetchTile(u), u))
  const B_net1 = [...netLog]
  const storedAfterP1 = await page.evaluate(() => window.cacheStorageCount('ign-tiles-v2'))
  netLog.length = 0
  for (const u of TILES) B_pass2.push(await page.evaluate(u => window.fetchTile(u), u))
  const B_net2 = [...netLog]
  const B_servedBySW2 = B_net2.filter(r => r.fromSW).length
  const B_hitNetwork2 = B_net2.filter(r => !r.fromSW && !r.fromCache).length

  // ─────────────── RAPPORT ───────────────
  const N = TILES.length
  console.log('\n════════════════════ RÉSULTATS ════════════════════')
  console.log(`Tuiles testées : ${N} (grille 3x3 en z16/17/18 autour de la ferme)\n`)

  console.log('── PHASE A : cache HTTP navigateur (sans service worker) ──')
  console.log(`  1er chargement   : ${pct(A_ok1, N)} OK, médiane ${median(A_pass1.map(r => r.ms))} ms`)
  console.log(`  2e chargement    : servi depuis le cache navigateur = ${pct(A_fromCache2, N)}, médiane ${median(A_pass2.map(r => r.ms))} ms`)
  console.log(`  => ${A_fromCache2 >= N * 0.9 ? '✅ le cache HTTP prend (header immutable respecté)' : '❌ le cache HTTP NE prend PAS — chaque revisite re-télécharge'}`)
  if (A_pass1.some(r => !r.ok)) console.log('  ⚠️ échecs 1er passage (Brave bloque le worker ?) :', A_pass1.find(r => !r.ok))

  console.log('\n── PHASE B : Service Worker CacheFirst (comportement prod) ──')
  console.log(`  SW contrôle la page : oui`)
  console.log(`  1er chargement   : médiane ${median(B_pass1.map(r => r.ms))} ms, servi par le SW = ${pct(B_net1.filter(r => r.fromSW).length, N)}`)
  console.log(`  Tuiles STOCKÉES dans Cache Storage (ign-tiles-v2) après 1er passage : ${storedAfterP1}`)
  console.log(`  2e chargement    : médiane ${median(B_pass2.map(r => r.ms))} ms, servi par le SW = ${pct(B_servedBySW2, N)}`)
  console.log(`  2e chargement retombé sur le réseau (cache raté) : ${pct(B_hitNetwork2, N)}`)
  console.log(`  => ${storedAfterP1 >= N * 0.9 && B_hitNetwork2 === 0 ? '✅ le SW stocke ET ressert les tuiles (revisite instantanée)' : '❌ le SW ne ressert PAS les tuiles depuis le cache'}`)

  console.log('\n════════════════════════════════════════════════════')
} catch (e) {
  console.error('ERREUR test:', e)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  server.close()
}
