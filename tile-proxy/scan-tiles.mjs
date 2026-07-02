// Scan large de tuiles autour de la ferme, tous zooms utiles, pour trouver LA/LES
// tuile(s) qui n'ont pas de 200 (= carré sombre permanent, jamais mis en cache).
// Teste les 3 couches (aérien/plan/parcelles). Rapporte uniquement les échecs + un
// résumé par zoom. Reproductible sans navigateur.

const WORKER = 'https://ferme-tiles.ferme-nilslamber.workers.dev/'
const FARM = { lat: 42.9375, lon: 1.7452 }
const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2tile = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z) }

const LAYERS = [
  { name: 'aerien',    layer: 'ORTHOIMAGERY.ORTHOPHOTOS',             fmt: 'image/jpeg' },
  { name: 'plan',      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',    fmt: 'image/png' },
  { name: 'parcelles', layer: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', fmt: 'image/png' },
]
const RADIUS = 10 // ±10 tuiles autour du centre = zone ~large

const url = (L, z, x, y) => `${WORKER}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${L.layer}`
  + `&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(L.fmt)}`

async function head(u) {
  try {
    const r = await fetch(u)
    const ct = r.headers.get('content-type') || ''
    await r.arrayBuffer()
    return { status: r.status, ct, ok: r.ok && ct.startsWith('image') }
  } catch (e) { return { status: 0, ct: '', ok: false, err: String(e) } }
}

// Pool de concurrence
async function pool(items, n, fn) {
  let i = 0; const out = []
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

const failures = []
let grandTotal = 0
for (const L of LAYERS) {
  for (let z = 15; z <= 19; z++) {
    const cx = lon2tile(FARM.lon, z), cy = lat2tile(FARM.lat, z)
    const jobs = []
    for (let x = cx - RADIUS; x <= cx + RADIUS; x++) for (let y = cy - RADIUS; y <= cy + RADIUS; y++) jobs.push({ x, y })
    const res = await pool(jobs, 12, async (j) => ({ j, r: await head(url(L, z, j.x, j.y)) }))
    grandTotal += res.length
    const bad = res.filter(o => !o.r.ok)
    if (bad.length) {
      for (const b of bad) failures.push({ layer: L.name, z, x: b.j.x, y: b.j.y, status: b.r.status, ct: b.r.ct })
    }
    console.log(`${L.name.padEnd(9)} z${z}: ${res.length - bad.length}/${res.length} OK${bad.length ? `  ❌ ${bad.length} échec(s)` : ''}`)
  }
}

console.log(`\n─────────── ${grandTotal} tuiles testées ───────────`)
if (!failures.length) {
  console.log('✅ AUCUNE tuile en échec sur toute la zone. Le carré sombre ne vient donc PAS')
  console.log('   d\'une tuile cassée côté worker → c\'est un souci de cache/retry côté client.')
} else {
  console.log(`❌ ${failures.length} tuile(s) en échec :`)
  for (const f of failures.slice(0, 40)) console.log(`   ${f.layer.padEnd(9)} z${f.z}  x=${f.x} y=${f.y}  -> status ${f.status} ${f.ct}`)
  if (failures.length > 40) console.log(`   … +${failures.length - 40} autres`)
}
process.exit(0)
