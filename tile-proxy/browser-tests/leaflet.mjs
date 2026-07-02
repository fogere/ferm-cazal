// Test autonome n°2 : vraie carte LEAFLET (même config que la prod) pilotée en
// headless. Reproduit un déplacement (pan aller/retour + zoom) et mesure combien
// de tuiles retombent sur le RÉSEAU vs cache lors d'un retour sur une zone déjà vue.
// But : distinguer "cache raté" (réseau au retour) de "juste le rendu Leaflet".

import http from 'node:http'
import puppeteer from 'puppeteer-core'

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const WORKER_HOST = 'ferme-tiles.ferme-nilslamber.workers.dev'
const FARM = [42.9375, 1.7452]

const SW_JS = `
const CACHE='ign-tiles-v2'
self.addEventListener('install',()=>self.skipWaiting())
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()))
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url)
  if(url.hostname==='${WORKER_HOST}'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE)
      const hit=await cache.match(event.request); if(hit) return hit
      const resp=await fetch(event.request)
      if(resp.status===200) await cache.put(event.request,resp.clone())
      return resp
    })())
  }
})`

const IGN_AERIAL = `https://${WORKER_HOST}/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0`
  + `&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM`
  + `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg`

const PAGE = `<!doctype html><html><head><meta charset=utf-8>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;background:#1a1a1a}</style></head>
<body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
window.__ready=false
navigator.serviceWorker.register('/sw.js').then(async()=>{
  await navigator.serviceWorker.ready
  if(!navigator.serviceWorker.controller){
    await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}))
  }
  // Config IDENTIQUE à la prod (Map.tsx)
  const map=L.map('map',{zoomControl:false,maxZoom:20}).setView([${FARM[0]},${FARM[1]}],16)
  const tl=L.tileLayer('${IGN_AERIAL}',{crossOrigin:'anonymous',maxNativeZoom:19,maxZoom:20,keepBuffer:4}).addTo(map)
  window.__map=map; window.__tl=tl
  // panTo qui résout quand la couche a fini de charger toutes ses tuiles visibles
  window.go=(lat,lng,z)=>new Promise(res=>{
    let done=false
    const finish=()=>{if(done)return;done=true;tl.off('load',finish);setTimeout(res,150)}
    tl.on('load',finish)
    // si déjà tout en place (aucune tuile à charger), 'load' ne refire pas → filet de sécurité
    setTimeout(finish,4000)
    if(z!=null) map.setView([lat,lng],z); else map.panTo([lat,lng])
  })
  window.__ready=true
})
</script></body></html>`

const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(SW_JS) }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

let browser
try {
  browser = await puppeteer.launch({ executablePath: BRAVE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  let phase = 'init'
  const stats = {}
  const bump = (k) => (stats[phase] ??= { total: 0, net: 0, cache: 0, sw: 0 })[k]++
  page.on('response', (r) => {
    if (!r.url().includes(WORKER_HOST)) return
    stats[phase] ??= { total: 0, net: 0, cache: 0, sw: 0 }
    stats[phase].total++
    if (r.fromServiceWorker()) stats[phase].sw++
    if (r.fromCache()) stats[phase].cache++
    if (!r.fromCache() && !r.fromServiceWorker()) stats[phase].net++
  })

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready===true', { timeout: 20000 })

  // Séquence de déplacement réaliste autour de la ferme
  phase = '1-chargement-initial (ferme z16)'
  await page.evaluate(() => window.go(42.9375, 1.7452, 16))

  phase = '2-pan-est (zone neuve)'
  await page.evaluate(() => window.go(42.9375, 1.7550))

  phase = '3-RETOUR-ferme (zone déjà vue il y a 2 s)'
  await page.evaluate(() => window.go(42.9375, 1.7452))

  phase = '4-petit-pan-nord (chevauche zone vue)'
  await page.evaluate(() => window.go(42.9410, 1.7452))

  phase = '5-RETOUR-ferme (re-vue)'
  await page.evaluate(() => window.go(42.9375, 1.7452))

  phase = '6-zoom-17-puis-retour-16'
  await page.evaluate(async () => { await window.go(42.9375, 1.7452, 17); await window.go(42.9375, 1.7452, 16) })

  console.log('\n════════════ CARTE LEAFLET RÉELLE — tuiles par phase ════════════')
  console.log('(net = vrai téléchargement réseau | cache = cache HTTP | sw = servi par le SW)\n')
  for (const [ph, s] of Object.entries(stats)) {
    const fromCacheOrSW = s.cache + s.sw
    const flag = ph.includes('RETOUR') || ph.includes('petit') || ph.includes('zoom')
      ? (s.net === 0 ? '  ✅ 0 réseau (tout depuis le cache)' : `  ⚠️ ${s.net} tuile(s) re-téléchargée(s)`)
      : ''
    console.log(`${ph.padEnd(42)} total=${String(s.total).padStart(3)}  net=${String(s.net).padStart(3)}  cache=${String(s.cache).padStart(3)}  sw=${String(s.sw).padStart(3)}${flag}`)
  }
  console.log('\n═════════════════════════════════════════════════════════════════')
  console.log('Lecture : si les phases RETOUR/petit-pan/zoom affichent net=0, alors')
  console.log('le cache fait son travail et le ralenti perçu vient du RENDU Leaflet')
  console.log('(fondu des tuiles + re-render), pas du réseau.\n')
} catch (e) {
  console.error('ERREUR:', e); process.exitCode = 1
} finally {
  if (browser) await browser.close()
  server.close()
}
