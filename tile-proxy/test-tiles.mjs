// Test autonome du pipeline de tuiles (Nils 02/07/2026).
// Vérifie le worker Cloudflare sur TOUS les zooms utilisés par la carte (13→20)
// et les 3 couches (aérien / plan / parcelles), autour de la ferme. Détecte toute
// tuile en échec (status ≠ 200, mauvais content-type). Usage : `node tile-proxy/test-tiles.mjs`
// Ne dépend d'aucune session / navigateur → reproductible côté dev.

const WORKER = 'https://ferme-tiles.ferme-nilslamber.workers.dev/'
const FARM = { lat: 42.9375, lon: 1.7452 }

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

const LAYERS = [
  { name: 'aerien',    layer: 'ORTHOIMAGERY.ORTHOPHOTOS',            fmt: 'image/jpeg' },
  { name: 'plan',      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',   fmt: 'image/png' },
  { name: 'parcelles', layer: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', fmt: 'image/png' },
]

let fails = 0
for (const L of LAYERS) {
  for (let z = 13; z <= 20; z++) {
    const x = lon2tile(FARM.lon, z)
    const y = lat2tile(FARM.lat, z)
    const url = `${WORKER}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${L.layer}`
      + `&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`
      + `&FORMAT=${encodeURIComponent(L.fmt)}`
    try {
      const r = await fetch(url)
      const ct = r.headers.get('content-type') || ''
      const cache = r.headers.get('x-tile-cache') || '-'
      const ok = r.ok && ct.startsWith('image')
      if (!ok) fails++
      console.log(`${ok ? 'OK ' : 'ERR'} ${L.name.padEnd(9)} z${String(z).padStart(2)} ${y}/${x} -> ${r.status} ${ct.padEnd(10)} cache=${cache}`)
    } catch (e) {
      fails++
      console.log(`ERR ${L.name} z${z} -> ${e.message}`)
    }
  }
}
console.log(`\n=> ${fails === 0 ? '✅ TOUT OK (aucune tuile en échec)' : '❌ ' + fails + ' ÉCHEC(S)'}`)
process.exit(fails === 0 ? 0 : 1)
