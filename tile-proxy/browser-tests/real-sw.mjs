// Test décisif : charge la VRAIE app (dist/) en local, laisse son VRAI service
// worker de prod (workbox) prendre le contrôle, puis vérifie s'il met bien les
// tuiles en cache et les ressert. Tranche la contradiction "test dit instantané /
// Nils voit en retard". Aucune auth : on reste sur l'écran de login, le SW
// contrôle quand même la page et intercepte nos fetch() vers le worker.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import puppeteer from 'puppeteer-core'

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const DIST = 'c:\\Users\\Administrator\\Downloads\\projet farm\\app\\dist'
const WORKER_HOST = 'ferme-tiles.ferme-nilslamber.workers.dev'
const FARM = { lat: 42.9375, lon: 1.7452 }

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2tile = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z) }
const tileUrl = (z, dx = 0, dy = 0) => `https://${WORKER_HOST}/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0`
  + `&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM`
  + `&TILEMATRIX=${z}&TILEROW=${lat2tile(FARM.lat, z) + dy}&TILECOL=${lon2tile(FARM.lon, z) + dx}&FORMAT=image%2Fjpeg`
const TILES = []
for (const z of [16, 17, 18]) for (let dx = 0; dx <= 2; dx++) for (let dy = 0; dy <= 2; dy++) TILES.push(tileUrl(z, dx, dy))

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/index.html'
    const full = normalize(join(DIST, p))
    if (!full.startsWith(DIST)) { res.statusCode = 403; return res.end('no') }
    await stat(full)
    res.setHeader('Content-Type', MIME[extname(full)] || 'application/octet-stream')
    res.setHeader('Service-Worker-Allowed', '/')
    res.end(await readFile(full))
  } catch { res.statusCode = 404; res.end('404') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const base = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let browser
try {
  browser = await puppeteer.launch({ executablePath: BRAVE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  const swErrors = []
  page.on('pageerror', e => swErrors.push('page: ' + e.message))
  const net = []
  page.on('response', r => { if (r.url().includes(WORKER_HOST)) net.push({ fromSW: r.fromServiceWorker(), fromCache: r.fromCache(), status: r.status() }) })

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })

  // Attendre que le VRAI SW contrôle la page (tolère le reload forcé de l'activate)
  let controlled = false
  for (let i = 0; i < 40; i++) {
    try { controlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)) } catch { /* contexte détruit par le reload forcé */ }
    if (controlled) break
    await sleep(500)
  }

  if (!controlled) {
    console.log('\n❌ Le vrai SW de prod n\'a pas pris le contrôle en 20 s.')
    console.log('   (précache échoué ? erreur firebase/messaging dans le SW ?)')
    if (swErrors.length) console.log('   erreurs page:', swErrors.slice(0, 5))
    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: !!r.active, installing: !!r.installing, waiting: !!r.waiting })))
    console.log('   registrations:', JSON.stringify(regs))
  } else {
    await sleep(800) // laisser l'activate/navigate se stabiliser
    // 1er passage : charge les tuiles
    net.length = 0
    const p1 = await page.evaluate(async (urls) => {
      const out = []
      for (const u of urls) { const t = performance.now(); try { const r = await fetch(u, { mode: 'cors' }); await r.blob(); out.push({ ms: Math.round(performance.now() - t), ok: r.ok }) } catch (e) { out.push({ ms: -1, ok: false }) } }
      return out
    }, TILES)
    const net1 = net.filter(r => r.fromSW).length
    const stored = await page.evaluate(async () => { try { const c = await caches.open('ign-tiles-v2'); return (await c.keys()).length } catch { return -1 } })

    // 2e passage : revisite
    net.length = 0
    const p2 = await page.evaluate(async (urls) => {
      const out = []
      for (const u of urls) { const t = performance.now(); try { const r = await fetch(u, { mode: 'cors' }); await r.blob(); out.push({ ms: Math.round(performance.now() - t), ok: r.ok }) } catch { out.push({ ms: -1, ok: false }) } }
      return out
    }, TILES)
    const bySW2 = net.filter(r => r.fromSW).length
    const hitNet2 = net.filter(r => !r.fromSW && !r.fromCache).length

    const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
    const N = TILES.length
    console.log('\n════════════ VRAI SERVICE WORKER DE PROD (dist/sw.js) ════════════')
    console.log(`SW contrôle la page : OUI (workbox actif)\n`)
    console.log(`Tuiles testées                : ${N}`)
    console.log(`1er passage  : médiane ${med(p1.map(r => r.ms))} ms, servi par le SW ${net1}/${N}`)
    console.log(`Tuiles STOCKÉES dans le cache 'ign-tiles-v2' : ${stored}`)
    console.log(`2e passage   : médiane ${med(p2.map(r => r.ms))} ms, servi par le SW ${bySW2}/${N}, retombé réseau ${hitNet2}/${N}`)
    console.log(`\n=> ${stored >= N * 0.9 && hitNet2 === 0
      ? '✅ Le VRAI SW de prod cache ET ressert les tuiles. La chaîne prod est bonne.'
      : '❌ Le vrai SW de prod NE cache PAS correctement — bug prod trouvé.'}`)
    console.log('══════════════════════════════════════════════════════════════════')
  }
} catch (e) {
  console.error('ERREUR:', e); process.exitCode = 1
} finally {
  if (browser) await browser.close()
  server.close()
}
