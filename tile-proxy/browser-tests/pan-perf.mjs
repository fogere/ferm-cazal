// Test de FLUIDITÉ du pan (Nils 02/07/2026). Mesure, sur un grand viewport et
// cache chaud, le coût d'un déplacement selon les options Leaflet. Compare :
//   - updateWhenIdle: false (défaut desktop) vs true (défaut mobile)
//   - fadeAnimation on/off  (contrôle)
// Métriques objectives : nb de tuiles insérées PENDANT le geste (repaints) +
// frames longues (> 40 ms) pendant le pan. Moins = plus fluide.

import http from 'node:http'
import puppeteer from 'puppeteer-core'

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const WORKER_HOST = 'ferme-tiles.ferme-nilslamber.workers.dev'
const IGN = `https://${WORKER_HOST}/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0`
  + `&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM`
  + `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg`

const SW_JS = `
const CACHE='ign-tiles-v2'
self.addEventListener('install',()=>self.skipWaiting())
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()))
self.addEventListener('fetch',ev=>{const u=new URL(ev.request.url);if(u.hostname==='${WORKER_HOST}'){ev.respondWith((async()=>{const c=await caches.open(CACHE);const h=await c.match(ev.request);if(h)return h;const r=await fetch(ev.request);if(r.status===200)await c.put(ev.request,r.clone());return r})())}})`

const PAGE = `<!doctype html><html><head><meta charset=utf-8>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;background:#1a1a1a}</style></head>
<body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
let map, tl, tilesDuringPan=0, measuring=false
window.__ready=false
navigator.serviceWorker.register('/sw.js').then(async()=>{
  await navigator.serviceWorker.ready
  if(!navigator.serviceWorker.controller){await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}))}
  window.__ready=true
})
window.makeMap=(opts)=>new Promise(res=>{
  if(map){map.remove();map=null}
  document.getElementById('map').innerHTML=''
  map=L.map('map',{zoomControl:false,maxZoom:20,fadeAnimation:opts.fade}).setView([42.9375,1.7452],17)
  tl=L.tileLayer('${IGN}',{crossOrigin:'anonymous',maxNativeZoom:19,maxZoom:20,keepBuffer:opts.keepBuffer,updateWhenIdle:opts.updateWhenIdle}).addTo(map)
  tl.on('tileloadstart',()=>{if(measuring)tilesDuringPan++})
  let done=false;const fin=()=>{if(done)return;done=true;tl.off('load',fin);setTimeout(res,300)}
  tl.on('load',fin);setTimeout(fin,5000)
})
// Réchauffe le cache sur une bande large autour de la ferme (les tuiles du pan)
window.warm=async()=>{
  for(const [la,lo] of [[42.9375,1.740],[42.9375,1.745],[42.9375,1.750],[42.9375,1.755],[42.9375,1.760]]){
    await new Promise(r=>{let d=false;const f=()=>{if(d)return;d=true;tl.off('load',f);setTimeout(r,150)};tl.on('load',f);setTimeout(f,4000);map.setView([la,lo],17)})
  }
  map.setView([42.9375,1.7452],17)
}
// Mesure un pan scripté vers l'est (bande cachée) : frames + tuiles insérées
window.measurePan=()=>new Promise(res=>{
  tilesDuringPan=0; measuring=true
  const frames=[]; let last=performance.now(); let steps=0
  function raf(){
    const now=performance.now(); frames.push(now-last); last=now
    if(steps<24){ map.panBy([70,0],{animate:false}); steps++; requestAnimationFrame(raf) }
    else { measuring=false
      const long=frames.filter(d=>d>40).length
      const max=Math.round(Math.max(...frames))
      const med=(a=>{const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.floor(s.length/2)])})(frames)
      res({tilesDuringPan, longFrames:long, maxFrame:max, medFrame:med, totalFrames:frames.length})
    }
  }
  requestAnimationFrame(raf)
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
  browser = await puppeteer.launch({ executablePath: BRAVE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=2560,1300'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 2558, height: 1293 }) // grand écran comme Nils
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready===true', { timeout: 20000 })

  const configs = [
    { label: 'updateWhenIdle:false (défaut desktop actuel)', updateWhenIdle: false, fade: true, keepBuffer: 4 },
    { label: 'updateWhenIdle:true  (défaut mobile)',         updateWhenIdle: true,  fade: true, keepBuffer: 4 },
    { label: 'updateWhenIdle:true + fade:false',             updateWhenIdle: true,  fade: false, keepBuffer: 4 },
  ]

  console.log('\n════════ FLUIDITÉ DU PAN — grand viewport 2558×1293, cache chaud ════════')
  console.log('(tuiles insérées pendant le geste + frames longues > 40 ms ; MOINS = mieux)\n')
  const results = []
  for (const c of configs) {
    await page.evaluate(o => window.makeMap(o), c)
    await page.evaluate(() => window.warm())
    // deux passes, on garde la 2e (cache bien chaud)
    await page.evaluate(() => window.measurePan())
    await page.evaluate(o => window.makeMap(o), c)
    await page.evaluate(() => window.warm())
    const m = await page.evaluate(() => window.measurePan())
    results.push({ c, m })
    console.log(`${c.label}`)
    console.log(`    tuiles insérées pendant le pan : ${String(m.tilesDuringPan).padStart(4)}   frames longues : ${String(m.longFrames).padStart(3)}/${m.totalFrames}   frame max : ${m.maxFrame} ms   médiane : ${m.medFrame} ms\n`)
  }

  const base = results[0].m, idle = results[1].m
  console.log('─────────────────────────────────────────────────────────────────────────')
  console.log(`Effet de updateWhenIdle:true → tuiles pendant pan ${base.tilesDuringPan} → ${idle.tilesDuringPan}` +
    `  |  frames longues ${base.longFrames} → ${idle.longFrames}`)
  console.log(idle.tilesDuringPan < base.tilesDuringPan && idle.longFrames <= base.longFrames
    ? '=> ✅ updateWhenIdle:true réduit le travail pendant le geste → pan plus fluide.'
    : '=> ⚠️ effet peu concluant en headless (le GPU réel de Nils peut différer).')
  console.log('═════════════════════════════════════════════════════════════════════════')
} catch (e) { console.error('ERREUR:', e); process.exitCode = 1 }
finally { if (browser) await browser.close(); server.close() }
