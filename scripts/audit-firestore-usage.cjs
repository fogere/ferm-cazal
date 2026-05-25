#!/usr/bin/env node
/**
 * Audit d'utilisation Firestore — projet `le-cazal`.
 *
 * NON DESTRUCTIF : ne fait que des lectures. Utilise les aggregations count()
 * (1 lecture facturée par collection) et un échantillonnage limité pour estimer
 * les tailles. Pas d'écriture, pas de suppression.
 *
 * Objectif : disposer d'une vue serveur de l'état réel des collections pour
 * identifier les optimisations non destructives possibles (cache, archivage,
 * listeners à remplacer par getDocs, etc.).
 *
 * Coût total estimé : ~ 20 lectures (1 count par collection + quelques samples).
 *
 * Usage : node scripts/audit-firestore-usage.cjs
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
  'tempSessions',
  'alerts',
  'reserves',
  'enclosure_movements',
  'config',
  'opti',
  'bugReports',
]

// Collections qui peuvent grossir vite — on échantillonne les 5 derniers docs
// pour estimer une taille moyenne et voir le rythme d'ajout. Limite : on lit
// 5 documents pour chacune (donc 5 reads par collection sampled).
const SAMPLED = ['enclosure_movements', 'animal_care', 'animal_photos',
                 'animal_measurements', 'bugReports', 'pin_photos']

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function main() {
  let admin
  try { admin = require('firebase-admin') }
  catch {
    console.error("❌ firebase-admin manquant. Lance : cd scripts && npm install firebase-admin")
    process.exit(1)
  }

  const credPath = path.join(__dirname, 'le-cazal-service-account.json')
  if (!fs.existsSync(credPath)) {
    console.error(`❌ Service account introuvable : ${credPath}`)
    process.exit(1)
  }

  admin.initializeApp({ credential: admin.credential.cert(require(credPath)) })
  const db = admin.firestore()
  const now = Date.now()

  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`AUDIT FIRESTORE  ·  projet le-cazal  ·  ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════════════════════\n')

  const report = []
  let totalReadsThisAudit = 0

  for (const coll of COLLECTIONS) {
    process.stdout.write(`  ${coll.padEnd(22)} `)
    const row = { name: coll, count: 0, sampleSizeBytes: 0, sampleCount: 0,
                  recentDocsLastDay: 0, recentDocsLast7Days: 0, oldestTs: null, newestTs: null,
                  approxTotalSize: 0, error: null }
    try {
      // count() = 1 lecture facturée (aggregation), pas de transfert de docs
      const countSnap = await db.collection(coll).count().get()
      row.count = countSnap.data().count
      totalReadsThisAudit++

      // Échantillonnage : 5 derniers docs créés (si la collection a un createdAt)
      // Pour les "samplées", on prend 5 docs au hasard via une simple lecture
      // récente. Coût : 5 lectures.
      if (row.count > 0 && SAMPLED.includes(coll)) {
        try {
          // On trie par __name__ desc à défaut de champ createdAt fiable.
          // Pas d'index requis pour orderBy(__name__).
          const sampleSnap = await db.collection(coll)
            .orderBy('__name__', 'desc')
            .limit(5)
            .get()
          let totalBytes = 0
          sampleSnap.forEach(d => {
            const j = JSON.stringify(d.data())
            totalBytes += j.length
          })
          row.sampleSizeBytes = totalBytes
          row.sampleCount = sampleSnap.size
          totalReadsThisAudit += sampleSnap.size
          if (row.sampleCount > 0) {
            row.approxTotalSize = Math.round((totalBytes / row.sampleCount) * row.count)
          }
        } catch (e) {
          // Pas grave si l'échantillonnage plante (souvent règles ou champ manquant)
          row.error = `sample: ${e.message}`
        }
      }

      console.log(`✓ ${String(row.count).padStart(5)} docs` +
                  (row.sampleCount > 0
                    ? `  ·  ~ ${fmtBytes(row.approxTotalSize)} estimés (${row.sampleCount} samples)`
                    : ''))
    } catch (err) {
      row.error = err.message
      console.log(`⚠ erreur : ${err.message}`)
    }
    report.push(row)
  }

  console.log('\n───────────────────────────────────────────────────────────────')
  console.log('SYNTHÈSE PAR COLLECTION  (triée par nb docs desc)')
  console.log('───────────────────────────────────────────────────────────────')
  const sorted = [...report].filter(r => !r.error).sort((a, b) => b.count - a.count)
  for (const r of sorted) {
    const tag = r.count > 1000 ? '  ⚠ GROS' : r.count > 200 ? '  ·' : ''
    console.log(`  ${r.name.padEnd(22)}  ${String(r.count).padStart(5)} docs${tag}` +
                (r.sampleSizeBytes
                  ? `   ~${fmtBytes(r.approxTotalSize).padStart(8)} total`
                  : ''))
  }

  // ── Croissance vs backup
  console.log('\n───────────────────────────────────────────────────────────────')
  console.log('CROISSANCE  (vs dernier backup local)')
  console.log('───────────────────────────────────────────────────────────────')
  const backupsDir = path.join(__dirname, '..', 'backups')
  if (fs.existsSync(backupsDir)) {
    const backups = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('firestore-backup-') && f.endsWith('.json'))
      .sort()
    if (backups.length > 0) {
      const last = backups[backups.length - 1]
      const lastPath = path.join(backupsDir, last)
      const stat = fs.statSync(lastPath)
      const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
      try {
        const data = JSON.parse(fs.readFileSync(lastPath, 'utf8'))
        console.log(`  Backup : ${last}  (il y a ${ageDays.toFixed(1)} j)`)
        for (const r of sorted) {
          const prev = (data.collections && data.collections[r.name]) || []
          const prevCount = Array.isArray(prev) ? prev.length : 0
          const delta = r.count - prevCount
          if (delta === 0) continue
          const sign = delta > 0 ? '+' : ''
          const rate = ageDays > 0 ? `  (${(delta / ageDays).toFixed(1)} / jour)` : ''
          console.log(`    ${r.name.padEnd(22)}  ${sign}${delta} docs depuis ${ageDays.toFixed(1)} j${rate}`)
        }
      } catch (e) {
        console.log(`  ⚠ backup illisible : ${e.message}`)
      }
    } else {
      console.log('  (aucun backup local)')
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────')
  console.log(`Lectures consommées par cet audit : ${totalReadsThisAudit}`)
  console.log('───────────────────────────────────────────────────────────────')

  // JSON pour réutilisation
  const outFile = path.join(__dirname, '..', 'firestore-usage-audit.json')
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2))
  console.log(`\nRapport JSON écrit dans : ${outFile}`)
  process.exit(0)
}

main().catch(err => { console.error('❌', err); process.exit(1) })
