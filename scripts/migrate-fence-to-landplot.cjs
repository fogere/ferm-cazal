#!/usr/bin/env node
/**
 * Migration fence → land_plot
 *
 * Refonte clôtures vs espaces (demande Eugénie 21/05/2026). Voir le plan dans
 * cette conversation : on sépare le rôle "définition d'espace" (terrain qui
 * nous appartient, suivi pâturage, placement animaux) du rôle "clôture
 * physique" (visuel, électricité, batterie connectée).
 *
 * Ce script crée pour CHAQUE fence enclos (closed=true) avec des animaux
 * placés OU un historique de mouvement un land_plot jumeau qui reprend son
 * rôle d'enclos. Le fence reste inchangé visuellement (mêmes points), mais
 * perd implicitement son rôle d'enclos (le code S4-S5 lira maintenant le
 * land_plot).
 *
 * Étapes :
 *   1. Pour chaque fence avec closed=true → créer un land_plot avec :
 *      - points (copie)
 *      - currentOccupants, occupiedSince, rotationHistory (copie)
 *      - name = fence.name (ou "Espace sans nom")
 *      - createdAt = fence.createdAt, createdBy = fence.createdBy
 *      - updatedAt = Date.now(), updatedBy = "migration-script"
 *      Sur le fence, ajouter migratedToPlotId: <plot.id> (audit + idempotence).
 *   2. Pour chaque animal dont enclosureId pointe vers ce fence → rediriger
 *      enclosureId vers land_plot.id.
 *   3. Pour chaque enclosure_movement dont fromEnclosureId ou toEnclosureId
 *      est le fence migré → rediriger vers land_plot.id (les noms
 *      fromEnclosureName/toEnclosureName restent inchangés — historique humain).
 *
 * Pré-requis :
 *   - scripts/le-cazal-service-account.json (clé service account Firebase)
 *   - npm install (déjà fait, firebase-admin est dans package.json)
 *
 * Usage :
 *   node scripts/migrate-fence-to-landplot.cjs           # dry-run (défaut)
 *   node scripts/migrate-fence-to-landplot.cjs --execute # vraie migration
 *
 * Idempotence : si un fence a déjà migratedToPlotId, le script le skippe.
 *
 * Recommandations avant --execute :
 *   1. Lancer un backup MANUEL :  node scripts/backup-firestore.cjs
 *   2. Lancer ce script en dry-run et lire la sortie soigneusement.
 *   3. S'assurer que personne n'utilise l'app à ce moment-là (dimanche matin idéal).
 *   4. Garder un terminal git ouvert pour pouvoir restaurer le backup si besoin.
 */

const fs   = require('fs')
const path = require('path')

const DRY_RUN = !process.argv.includes('--execute')

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
    process.exit(1)
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(credPath)),
  })
  const db = admin.firestore()
  const { FieldValue } = admin.firestore

  console.log(DRY_RUN
    ? '🟡 MODE DRY-RUN — aucune écriture. Relance avec --execute pour appliquer.'
    : '🔴 MODE EXECUTE — les écritures SONT effectuées.')
  console.log('')

  // ── 1. Lecture des collections ──
  console.log('📖 Lecture map_pins, animals, enclosure_movements…')
  const [pinsSnap, animalsSnap, movementsSnap] = await Promise.all([
    db.collection('map_pins').get(),
    db.collection('animals').get(),
    db.collection('enclosure_movements').get(),
  ])

  const allPins      = pinsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const allAnimals   = animalsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const allMovements = movementsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  console.log(`   ${allPins.length} pins`)
  console.log(`   ${allAnimals.length} animaux`)
  console.log(`   ${allMovements.length} mouvements`)
  console.log('')

  // ── 2. Sélection des fences à migrer ──
  // Critère : type=fence, closed=true, points >= 3, et NON déjà migré.
  function isClosedFence(pin) {
    if (pin.type !== 'fence') return false
    if (!Array.isArray(pin.points) || pin.points.length < 3) return false
    const a = pin.points[0]
    const b = pin.points[pin.points.length - 1]
    return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9
  }
  // Fence considéré "joue un rôle d'enclos" si :
  //  - il a actuellement des animaux placés (animal.enclosureId === fence.id)
  //  - OU il a un currentOccupants non vide
  //  - OU il a un rotationHistory non vide
  //  - OU il apparaît dans un enclosure_movement (from ou to)
  function fenceHasEnclosureRole(fence) {
    const hasOccupants = Array.isArray(fence.currentOccupants) && fence.currentOccupants.length > 0
    const hasHistory   = Array.isArray(fence.rotationHistory)  && fence.rotationHistory.length > 0
    const hasAnimals   = allAnimals.some(a => a.enclosureId === fence.id)
    const hasMovements = allMovements.some(m => m.fromEnclosureId === fence.id || m.toEnclosureId === fence.id)
    return hasOccupants || hasHistory || hasAnimals || hasMovements
  }

  const fencesToMigrate = allPins.filter(p =>
    isClosedFence(p) && !p.migratedToPlotId && fenceHasEnclosureRole(p),
  )
  const fencesAlreadyMigrated = allPins.filter(p => p.migratedToPlotId)
  const closedFencesNoRole = allPins.filter(p =>
    isClosedFence(p) && !p.migratedToPlotId && !fenceHasEnclosureRole(p),
  )

  console.log(`📊 Inventaire :`)
  console.log(`   fences fermés à migrer (rôle d'enclos actif) : ${fencesToMigrate.length}`)
  console.log(`   fences fermés SANS rôle d'enclos (skippés)    : ${closedFencesNoRole.length}`)
  console.log(`   fences déjà migrés (idempotence, skippés)     : ${fencesAlreadyMigrated.length}`)
  console.log('')

  if (fencesToMigrate.length === 0) {
    console.log('✅ Rien à migrer. Sortie.')
    process.exit(0)
  }

  // ── 3. Pour chaque fence, préparer un plan de migration ──
  // On génère les ids des land_plots à l'avance (Firestore admin SDK
  // permet de pré-allouer un docId).
  const migrationPlan = fencesToMigrate.map(fence => {
    const plotRef = db.collection('map_pins').doc()
    const plotId  = plotRef.id

    const linkedAnimals = allAnimals.filter(a => a.enclosureId === fence.id)
    const linkedMovementsFrom = allMovements.filter(m => m.fromEnclosureId === fence.id)
    const linkedMovementsTo   = allMovements.filter(m => m.toEnclosureId === fence.id)

    const plotPayload = {
      type:        'land_plot',
      name:        fence.name || 'Espace sans nom',
      lat:         fence.lat,
      lng:         fence.lng,
      status:      fence.status || 'ok',
      note:        fence.note || '',
      points:      fence.points,
      createdAt:   fence.createdAt || Date.now(),
      createdBy:   fence.createdBy || 'migration-script',
      updatedAt:   Date.now(),
      updatedBy:   'migration-script',
    }
    // Rôle d'enclos déplacé (si présent)
    if (Array.isArray(fence.currentOccupants) && fence.currentOccupants.length > 0) {
      plotPayload.currentOccupants = fence.currentOccupants
    }
    if (typeof fence.occupiedSince === 'number') {
      plotPayload.occupiedSince = fence.occupiedSince
    }
    if (Array.isArray(fence.rotationHistory) && fence.rotationHistory.length > 0) {
      plotPayload.rotationHistory = fence.rotationHistory
    }

    return {
      fence,
      plotId,
      plotRef,
      plotPayload,
      linkedAnimals,
      linkedMovementsFrom,
      linkedMovementsTo,
    }
  })

  // ── 4. Affichage du plan ──
  console.log('📋 Plan de migration :')
  console.log('')
  for (const step of migrationPlan) {
    const f = step.fence
    console.log(`  🟢 Fence "${f.name || '(sans nom)'}" [${f.id}]`)
    console.log(`     → land_plot jumeau [${step.plotId}]`)
    console.log(`     ${f.points.length} points · ${f.currentOccupants?.length ?? 0} occupants actifs`)
    if (step.linkedAnimals.length > 0) {
      console.log(`     ${step.linkedAnimals.length} animal(aux) à rediriger : ${step.linkedAnimals.map(a => a.name).join(', ')}`)
    }
    if (step.linkedMovementsFrom.length > 0) {
      console.log(`     ${step.linkedMovementsFrom.length} mouvement(s) "from" à rediriger`)
    }
    if (step.linkedMovementsTo.length > 0) {
      console.log(`     ${step.linkedMovementsTo.length} mouvement(s) "to" à rediriger`)
    }
    console.log('')
  }

  const totalAnimalsToRedirect   = migrationPlan.reduce((s, x) => s + x.linkedAnimals.length, 0)
  const totalMovementsToRedirect = migrationPlan.reduce((s, x) => s + x.linkedMovementsFrom.length + x.linkedMovementsTo.length, 0)
  console.log(`📊 Résumé : ${migrationPlan.length} land_plots à créer,`)
  console.log(`            ${totalAnimalsToRedirect} animaux à rediriger,`)
  console.log(`            ${totalMovementsToRedirect} mouvements à rediriger,`)
  console.log(`            ${migrationPlan.length} fences marqués migratedToPlotId.`)
  console.log('')

  if (DRY_RUN) {
    console.log('🟡 Dry-run terminé. Relance avec --execute pour appliquer.')
    process.exit(0)
  }

  // ── 5. Exécution réelle (writeBatch par groupes de 500 writes max) ──
  console.log('🔴 Exécution en cours…')
  const MAX_WRITES_PER_BATCH = 450 // marge / limite Firestore 500
  let batch = db.batch()
  let writesInBatch = 0
  let totalWrites = 0
  async function flushIfNeeded(force = false) {
    if (writesInBatch === 0) return
    if (force || writesInBatch >= MAX_WRITES_PER_BATCH) {
      await batch.commit()
      totalWrites += writesInBatch
      console.log(`   ✓ batch commit (${writesInBatch} writes)`)
      batch = db.batch()
      writesInBatch = 0
    }
  }

  for (const step of migrationPlan) {
    // 5a. Création du land_plot
    batch.set(step.plotRef, step.plotPayload)
    writesInBatch += 1
    await flushIfNeeded()

    // 5b. Marquage du fence d'origine
    batch.update(db.collection('map_pins').doc(step.fence.id), {
      migratedToPlotId: step.plotId,
      updatedAt:        Date.now(),
      updatedBy:        'migration-script',
    })
    writesInBatch += 1
    await flushIfNeeded()

    // 5c. Animaux : enclosureId → plotId
    for (const a of step.linkedAnimals) {
      batch.update(db.collection('animals').doc(a.id), {
        enclosureId: step.plotId,
      })
      writesInBatch += 1
      await flushIfNeeded()
    }

    // 5d. Movements : fromEnclosureId / toEnclosureId → plotId
    for (const m of step.linkedMovementsFrom) {
      batch.update(db.collection('enclosure_movements').doc(m.id), {
        fromEnclosureId: step.plotId,
      })
      writesInBatch += 1
      await flushIfNeeded()
    }
    for (const m of step.linkedMovementsTo) {
      batch.update(db.collection('enclosure_movements').doc(m.id), {
        toEnclosureId: step.plotId,
      })
      writesInBatch += 1
      await flushIfNeeded()
    }
  }
  await flushIfNeeded(true)

  console.log('')
  console.log(`✅ Migration terminée. ${totalWrites} écritures appliquées.`)
  console.log('')
  console.log('Audit recommandé :')
  console.log('  - Compter map_pins where type=land_plot : doit être', migrationPlan.length)
  console.log('  - Compter animals where enclosureId pointe vers un id NON existant : doit être 0')
  console.log('  - Tester l\'app : placements animaux, geofence, pâturage')
  console.log('')
  console.log('Si quelque chose cloche : restaurer le backup pris avant le --execute.')

  // Note : `FieldValue` réservé pour compatibilité future (ex: delete d'un champ). Pas utilisé ici.
  void FieldValue

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err)
  process.exit(1)
})
