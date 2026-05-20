#!/usr/bin/env node
/**
 * Script de backup Firestore — projet `le-cazal`.
 *
 * Lit l'intégralité des collections critiques (animals, tasks, map_pins,
 * users, alerts, animal_care, animal_photos, animal_measurements,
 * enclosure_movements, reserves, bugReports, config) et écrit un fichier
 * JSON daté dans le dossier `backups/` à la racine du repo.
 *
 * Pas de bucket GCS requis — tout en local. Pas de coût.
 *
 * Pré-requis :
 *   1. Avoir installé firebase-admin :
 *        cd scripts && npm install firebase-admin
 *      (ou ajouter au scripts/package.json si tu en crées un)
 *   2. Avoir un fichier de clés service account dans
 *        scripts/le-cazal-service-account.json
 *      (à télécharger depuis Firebase Console → Settings → Service Accounts
 *       → Generate new private key — NE PAS COMMIT, ajouter à .gitignore)
 *
 * Usage :
 *   node scripts/backup-firestore.cjs
 *
 * À automatiser via le Planificateur de tâches Windows
 * (hebdomadaire, 4h du matin par exemple).
 */

const fs   = require('fs')
const path = require('path')

const COLLECTIONS = [
  'animals',
  'animal_care',
  'animal_photos',
  'animal_measurements',
  'tasks',
  'map_pins',
  'pin_photos',
  'users',
  'tempUsers',
  'tempCodes',
  'alerts',
  'reserves',
  'enclosure_movements',
  'config',
  'opti',
  'bugReports',
]

async function main() {
  let admin
  try {
    admin = require('firebase-admin')
  } catch {
    console.error('❌ firebase-admin non installé. Lance d\'abord :')
    console.error('   cd scripts && npm install firebase-admin')
    process.exit(1)
  }

  const credPath = path.join(__dirname, 'le-cazal-service-account.json')
  if (!fs.existsSync(credPath)) {
    console.error(`❌ Clé service account introuvable : ${credPath}`)
    console.error('   Télécharge-la depuis Firebase Console et place-la ici.')
    console.error('   Ajoute *.json au .gitignore du dossier scripts/.')
    process.exit(1)
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(credPath)),
  })
  const db = admin.firestore()

  const stamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const outDir = path.join(__dirname, '..', 'backups')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const result = { exportedAt: new Date().toISOString(), collections: {} }
  let totalDocs = 0

  for (const coll of COLLECTIONS) {
    process.stdout.write(`  ${coll.padEnd(24)} `)
    try {
      const snap = await db.collection(coll).get()
      const docs = []
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }))
      result.collections[coll] = docs
      totalDocs += docs.length
      console.log(`✓ ${docs.length} docs`)
    } catch (err) {
      console.log(`⚠ erreur : ${err.message}`)
      result.collections[coll] = { error: err.message }
    }
  }

  const outFile = path.join(outDir, `firestore-backup-${stamp}.json`)
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
  console.log(`\n✅ Backup écrit dans ${outFile}`)
  console.log(`   ${totalDocs} documents · ${sizeMB} MB`)

  // Nettoyage : garde les 12 derniers backups (rotation manuelle)
  const files = fs.readdirSync(outDir)
    .filter(f => f.startsWith('firestore-backup-') && f.endsWith('.json'))
    .sort()
    .reverse()
  if (files.length > 12) {
    for (const f of files.slice(12)) {
      fs.unlinkSync(path.join(outDir, f))
      console.log(`   🗑  Ancien backup supprimé : ${f}`)
    }
  }

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err)
  process.exit(1)
})
