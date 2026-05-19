/* eslint-disable */
/**
 * Génère les icônes PNG de la PWA à partir du SVG source.
 * Tailles requises par Android Chrome / iOS / desktop install :
 *   - 192x192 et 512x512 (any) — requis Android pour l'installabilité
 *   - 192x192 et 512x512 (maskable) — pour adaptation forme système Android
 *   - 180x180 (apple-touch-icon) — pour iOS Safari "Sur l'écran d'accueil"
 *
 * Lancer après chaque modif du SVG :
 *   node scripts/generate-pwa-icons.cjs
 */
const path = require('path')
const sharp = require(path.join(__dirname, '..', 'app', 'node_modules', 'sharp'))

const SRC = path.join(__dirname, '..', 'app', 'public', 'icons', 'farm-icon.svg')
const DEST_DIR = path.join(__dirname, '..', 'app', 'public', 'icons')

async function gen(size, name) {
  const out = path.join(DEST_DIR, name)
  await sharp(SRC).resize(size, size).png().toFile(out)
  console.log(`✓ ${name} (${size}×${size})`)
}

async function main() {
  await gen(192, 'farm-icon-192.png')
  await gen(512, 'farm-icon-512.png')
  await gen(180, 'apple-touch-icon.png')
  console.log('\nFait. Pense à rebuilder l\'app pour que les icônes soient incluses au manifest.')
}

main().catch(e => { console.error(e); process.exit(1) })
