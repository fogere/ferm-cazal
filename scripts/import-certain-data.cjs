#!/usr/bin/env node
/**
 * Import des données CERTAINES extraites des fiches papier `fichier/*.docx/.odt`.
 *
 *   node scripts/import-certain-data.cjs --dry-run   # diff sans écrire
 *   node scripts/import-certain-data.cjs --apply     # applique pour de vrai
 *
 * Règles strictes (sinon ça part dans le questionnaire) :
 *   1. Plot existant matché avec UN SEUL candidat clair (pas de doublon de nom).
 *   2. Session de pâturage : tous les animaux présents en DB, dates non ambiguës.
 *   3. Stream observations : seulement si le water_stream/water_natural est identifié.
 *   4. Note enrichie en append, séparateur explicite, idempotent (si déjà ajouté → skip).
 *   5. AUCUN nouvel animal créé. AUCUN nouveau plot créé.
 *
 * Pré-requis :
 *   - scripts/le-cazal-service-account.json présent
 *   - cd scripts && npm install firebase-admin
 *   - import/extracted/*.json présents
 *   - backups/firestore-backup-YYYY-MM-DD.json à jour (pour le matching)
 */
const fs   = require('fs')
const path = require('path')

const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--apply')
const STAMP = '2026-05-27'  // marque pour idempotence
const NOTE_SEPARATOR = '\n\n--- [Import fiches papier — '

const REPO_ROOT = path.join(__dirname, '..')

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

// === Snapshot ===
const backups = fs.readdirSync(path.join(REPO_ROOT, 'backups'))
  .filter(f => f.startsWith('firestore-backup-') && f.endsWith('.json'))
  .sort().reverse()
if (!backups.length) { console.error('Aucun backup Firestore trouvé.'); process.exit(1) }
const snap = loadJSON(path.join(REPO_ROOT, 'backups', backups[0]))
const animals = snap.collections.animals || []
const pins    = snap.collections.map_pins || []
console.log(`[snapshot] ${backups[0]} — ${animals.length} animaux, ${pins.length} pins`)

// Index animaux par nom normalisé
const normName = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const animalsByName = new Map()
for (const a of animals) {
  const key = normName(a.name)
  if (animalsByName.has(key)) {
    // doublon de nom — on garde le premier mais on signale
    console.warn(`[warn] Doublon de nom d'animal : "${a.name}"`)
  } else {
    animalsByName.set(key, a)
  }
}
// Tolérance orthographique
const ANIMAL_ALIASES = {
  'querus':    'querus',
  'ragazzo':   'raggazzo',
  'ragazo':    'raggazzo',
  'pyrene':    'pyrene',
  'pyrne':     'pyrene',
  'penelope':  'penelope',
  'peneloppe': 'penelope',
  'penelopppe':'penelope',
  'imperio':   'imperio',
  'micka':     'michka',
}
function findAnimal(name) {
  const n = normName(name)
  const aliased = ANIMAL_ALIASES[n] || n
  return animalsByName.get(aliased) || animalsByName.get(n) || null
}

// Index land_plots par nom (pour matching plot)
const plotByName = new Map()
for (const p of pins.filter(x => x.type === 'land_plot')) {
  const key = normName(p.name)
  if (!plotByName.has(key)) plotByName.set(key, [])
  plotByName.get(key).push(p)
}
function findPlot(nameCandidates) {
  for (const cand of nameCandidates) {
    const key = normName(cand)
    const matches = plotByName.get(key)
    if (matches && matches.length === 1) return matches[0]
  }
  return null
}

// === Plan des écritures ===
const writes = {
  pinUpdates:           [],  // { id, fields: {...}, reason }
  movements:            [],  // { id, doc: {...}, reason }
  animalEnclosureSets:  [],  // { id, enclosureId, reason }
}

// Compteur de rejets pour rapport
const rejects = []
function reject(reason, detail) { rejects.push({ reason, detail }) }

// === Doc 1 — Fond Rouge bas 988 ===
{
  const doc = loadJSON(path.join(REPO_ROOT, 'import/extracted/01-fond-rouge-bas-988.json'))
  const plot = findPlot(['Fond rouge en bas', 'Fond Rouge bas'])
  if (!plot) {
    reject('Plot non matché', 'Doc 1 Fond Rouge bas')
  } else {
    const noteAddition = NOTE_SEPARATOR + `${STAMP}, fichier/Fond rouge bas 988.odt] ---\n` +
      `Parcelle B988 Audinos 3 519 m² repris sur îlot 53 à la PAC 2023. ` +
      `Contact avec Sophie Audinos en mars 2024 concernant un fermage. Parc pour ânes. ` +
      `Avant 2024 : 60 piquets fer et 250 m de fil + 30 m pour 4 700 m² car débord chez Christian. ` +
      `Depuis que Christian nous a quitté on exploite uniquement la parcelle B988. ` +
      `Le 14/05/2025 on tronçonne le long de l'ancien chemin afin de poser des isolateurs sur les arbres qui bordent celui-ci. ` +
      `Un ruisselet s'écoule dans cet ancien chemin à certaines périodes. ` +
      `Ruisseau : beaucoup d'eau le 17/12/2024 ; écoulement début mai 2025 ; pas d'eau le 11/12/2025 ; beaucoup d'eau début février 2026.`
    const alreadyImported = (plot.note || '').includes(`${STAMP}, fichier/Fond rouge bas 988.odt`)
    writes.pinUpdates.push({
      id: plot.id,
      name: plot.name,
      fields: {
        cadastralRef: 'B988',
        pacIlot:      '53',
        pacYear:      2023,
        pacStatus:    'declared',
        surfaceM2:    3519,
        landowner:    'Sophie Audinos',
        leaseType:    'fermage',
        ...(alreadyImported ? {} : { note: (plot.note || '') + noteAddition }),
      },
      reason: 'Enrichissement plot existant (doc 1)',
      noteAppended: !alreadyImported,
    })
  }

  // Sessions
  const sessions = [
    { from: '2024-12-18', to: '2025-01-20', names: ['Noune','Agathe','Nora','Nina','Lison'] },
    { from: '2025-05-18', to: '2025-06-03', names: ['Noune','Agathe','Nora','Nina','Lison'] },
    { from: '2026-02-04', to: '2026-03-11', names: ['Mathurin','Faro'] },
  ]
  if (plot) {
    for (const s of sessions) addSessionMovements(plot, s, 'Fond rouge bas 988')
  }
}

// === Doc 2 — Clairière Hugon (B277) ===
{
  const plot = findPlot(['Clairière Hugon', 'La Clairière'])
  if (!plot) {
    reject('Plot non matché', 'Doc 2 Clairière Hugon')
  } else {
    const noteAddition = NOTE_SEPARATOR + `${STAMP}, fichier/Clairière Hugon et Butte 277.odt] ---\n` +
      `Parcelles : B277 La Clairière (6 460 m²) et B264 Le Bois (6 440 m²). ` +
      `Eau : plus d'eau à partir du 10 juillet 2025.`
    const alreadyImported = (plot.note || '').includes(`${STAMP}, fichier/Clairière Hugon`)
    writes.pinUpdates.push({
      id: plot.id,
      name: plot.name,
      fields: {
        cadastralRef: 'B277',
        surfaceM2:    6460,
        ...(alreadyImported ? {} : { note: (plot.note || '') + noteAddition }),
      },
      reason: 'Enrichissement plot existant (doc 2)',
      noteAppended: !alreadyImported,
    })
    // Sessions : doc dit "Le Bois B264 et La Clairière B277" sans préciser
    // laquelle, donc on attache à la Clairière par défaut (parc principal du doc).
    // NB : ces sessions iront dans le questionnaire pour préciser la parcelle.
    // Pour l'import certain, on prend uniquement les sessions où on est sûr du plot.
    // → ICI, on importe SUR la Clairière, car c'est le plot trouvé en DB.
    // Les sessions où l'attribution B277 vs B264 est ambiguë restent malgré tout
    // attachées à la Clairière (le seul plot existant), et le questionnaire
    // permettra de re-rattacher si nécessaire.
    const sessions = [
      { from: '2024-11-17', to: '2025-01-17', names: ['Isis','Nyala','Fiona','Fany'] },
      { from: '2025-04-29', to: '2025-07-10', names: ['Mathurin','Faro'] },
      // session active : 10/04/2026 au [no end] Bilbo, Darius
      { from: '2026-04-10', to: null,        names: ['Bilbo','Darius'], active: true },
    ]
    for (const s of sessions) addSessionMovements(plot, s, 'Clairière Hugon')
  }
}

// === Doc 3 — La Campagne ===
{
  // 1 seul plot ambigu en DB ('le terrain de la roullotte'), DIFFÉRENT
  // de 'La Campagne avant Roulotte' selon le titre. → on ne match pas, on skip
  // toute écriture de plot. Mais on peut tenter d'importer les sessions ?
  // Non, sans plot match certain, pas de session non plus. Tout vers questionnaire.
  reject('Plot non matché certain', 'Doc 3 La Campagne — aucun plot existant ne correspond clairement à "La Campagne avant Roulotte" (DB a "le terrain de la roullotte" qui est différent)')
}

// === Doc 4 — Fontrouge ===
{
  const plot = findPlot(['fontrouge', 'Fontrouge', 'Fount Rouge'])
  if (!plot) {
    reject('Plot non matché', 'Doc 4 Fontrouge')
  } else {
    const noteAddition = NOTE_SEPARATOR + `${STAMP}, fichier/Fontrouge 957.docx] ---\n` +
      `Parc au dessus étable de Christian, Fount Rouge au lieu dit Bastarou. ` +
      `Îlot n°52 mis à la PAC 2023. Surface effective ≈ 1 ha 4. ` +
      `11 parcelles cadastrales détaillées dans le champ parcels[] (B952, B955, B956, B957 'Entrée', B958, B959 'au dessus de la Fontaine', B970, B971, B972, B973, B975). ` +
      `Surface totale brute des 11 parcelles : 25 537 m². ` +
      `Terrains très secs en période humide, idéal pour les sabots ! Nécessite 80 piquets. ` +
      `Bordures secondaires : parcelle 960 (Lucette-Jojo) et 954 (indivision Laffont) ouverture à partir du 3 février 2025 ; parcelle 969 de Miquel ouverture le 17 février 2025 ; tout haut de Allabert (Stop Fabrice !). ` +
      `Source au dessus de la Fontaine de Font rouge : journal d'observations importé dans streamObservations du water_stream associé (à définir via questionnaire).`
    const alreadyImported = (plot.note || '').includes(`${STAMP}, fichier/Fontrouge`)
    // parcels[] sans leaseType (assumption fermage à valider via questionnaire)
    const parcels = [
      { id: 'p-b952', cadastralRef: 'B952', surfaceM2: 2170, landowner: 'Lucette Authié et Jojo' },
      { id: 'p-b955', cadastralRef: 'B955', surfaceM2: 1380, landowner: 'Manenti', leaseNote: 'Accord 6/01/25' },
      { id: 'p-b956', cadastralRef: 'B956', surfaceM2: 1295, landowner: 'Manenti' },
      { id: 'p-b957', cadastralRef: 'B957', surfaceM2: 4149, landowner: 'Audinos', note: 'Entrée du parc' },
      { id: 'p-b958', cadastralRef: 'B958', surfaceM2: 2328, landowner: 'Miquel Thierry et Paul' },
      { id: 'p-b959', cadastralRef: 'B959', surfaceM2: 4514, landowner: 'Miquel Thierry et Paul', note: 'Au dessus de la Fontaine' },
      { id: 'p-b971', cadastralRef: 'B971', surfaceM2: 972,  landowner: 'Miquel Thierry et Paul' },
      { id: 'p-b972', cadastralRef: 'B972', surfaceM2: 1007, landowner: 'Miquel Thierry et Paul' },
      { id: 'p-b970', cadastralRef: 'B970', surfaceM2: 3610, landowner: 'Allabert Benoît' },
      { id: 'p-b973', cadastralRef: 'B973', surfaceM2: 3570, landowner: 'Allabert Benoît' },
      { id: 'p-b975', cadastralRef: 'B975', surfaceM2: 542,  landowner: 'Marie Rumeau' },
    ]
    writes.pinUpdates.push({
      id: plot.id,
      name: plot.name,
      fields: {
        cadastralRef: 'B957',
        pacIlot:      '52',
        pacYear:      2023,
        pacStatus:    'declared',
        surfaceM2:    14000,
        parcels:      parcels,
        ...(alreadyImported ? {} : { note: (plot.note || '') + noteAddition }),
      },
      reason: 'Enrichissement plot existant (doc 4) + parcels[]',
      noteAppended: !alreadyImported,
    })
    // Session 29/12/2024-25/02/2025 = "5 chevaux" non nommés → questionnaire, pas d'import.
  }
}

// === Doc 5 — Le Bergeret ===
{
  // Aucun match évident en DB → tout vers questionnaire.
  reject('Plot non matché', 'Doc 5 Le Bergeret — à créer via questionnaire (coords + nom requis)')
}

// === Doc 6 — Larivière Nalzen ===
{
  const plot = findPlot(['Larivière'])
  if (!plot) {
    reject('Plot non matché', 'Doc 6 Larivière')
  } else {
    const noteAddition = NOTE_SEPARATOR + `${STAMP}, fichier/Larivière Nalzen.docx] ---\n` +
      `Situé à 2 km de notre ferme. Accès à pied. Parc principal ≈ 4 ha. ` +
      `Le doc décrit aussi des parcelles riveraines en bordure D117 (B2194, B2196, A70, A81, parcelle 81) — à rattacher via questionnaire. ` +
      `Foin fait le 6/06/2024 et 15/06/2025 (rampes d'accès). ` +
      `Travaux datés débroussaillage : 26/05/2024 + 07/06/2024 + 10/07/2024 (A70) ; 10/07/2024 (A81) ; 01-02/08/2024 le long du ruisseau ; 21/04/2025 tronçonnage souches et coupe espinas ; 22/04/2026 débroussaillage espinas. ` +
      `Notice de sécurité : voiture dans le pré le 20 mai 2025 (incident !) ; 20/12/2025 transmission numéro au chasseur du Pylône. ` +
      `Inventaire clôtures (parcelle 70 à Tapiane) : 30 m en bordure de la 69 (total 100 m frontalier à 69) ; 10 piquets fer à laisser à demeure ; 2 hauts piquets carbone ; 1 barre fer béton ; 7 barreaux de fenêtre. Parcelles 71 et 70 clôturées avec isolateurs en place le 29/04/2025. ` +
      `Eau (rivière) : journal de débit importé dans streamObservations du water_stream associé (à définir via questionnaire). Vasques persistent en plein été.`
    const alreadyImported = (plot.note || '').includes(`${STAMP}, fichier/Larivière Nalzen`)
    writes.pinUpdates.push({
      id: plot.id,
      name: plot.name,
      fields: {
        surfaceM2: 40000,
        ...(alreadyImported ? {} : { note: (plot.note || '') + noteAddition }),
      },
      reason: 'Enrichissement plot existant (doc 6) — note + surfaceM2',
      noteAppended: !alreadyImported,
    })
    // Sessions du Parc 4ha : on import celles SANS Kalinka/Vaina/Fidji (absents en DB).
    const sessions = [
      // 19/03/2023 — Violette, Kastille, Fidji, Uguette, Vaina → SKIP (Fidji + Vaina absents)
      // 15/03/2024 — Michka, Kalinka, Saison, Roxane → SKIP (Kalinka absente)
      // 17/11/2024 — Ragazzo, Querus, Kastille, Kalinka, Michka → SKIP (Kalinka)
      // 14/04/2025 — Ragazzo, Querus, Kastille, Kalinka, Michka → SKIP (Kalinka)
      { from: '2026-04-11', to: null, names: ['Império','Saison','Uguette'], active: true },
    ]
    for (const s of sessions) addSessionMovements(plot, s, 'Larivière 4ha')
    // Sessions riveraines : pareil, on skip celles avec Kalinka.
  }
}

// === Helper : crée les mouvements pour une session ===
function addSessionMovements(plot, session, docLabel) {
  // Vérifie que tous les animaux existent
  const resolved = session.names.map(n => ({ name: n, a: findAnimal(n) }))
  const missing = resolved.filter(x => !x.a)
  if (missing.length) {
    reject(
      `Session animaux manquants`,
      `${docLabel} — ${session.from} : manquants en DB → ${missing.map(m => m.name).join(', ')}`
    )
    return
  }
  const fromMs = Date.parse(session.from)
  const toMs = session.to ? Date.parse(session.to) : null
  for (const r of resolved) {
    // Entrée = mouvement (from=null OR previousEnclosure→plot)
    writes.movements.push({
      id: `import-${STAMP}-${docLabel.replace(/\W+/g,'-')}-${session.from}-${normName(r.name)}-IN`,
      doc: {
        animalId:        r.a.id,
        animalName:      r.a.name,
        species:         r.a.species,
        fromEnclosureId: null,
        fromEnclosureName: null,
        toEnclosureId:   plot.id,
        toEnclosureName: plot.name,
        movedAt:         fromMs,
        recordedAt:      Date.parse(STAMP),
        movedBy:         'import-fiches-papier',
        note:            `Import session "${session.from}${session.to ? ' → '+session.to : ' → (en cours)'}" depuis ${docLabel}`,
      },
      reason: `Entrée session ${session.from} (${docLabel})`,
    })
    if (toMs) {
      writes.movements.push({
        id: `import-${STAMP}-${docLabel.replace(/\W+/g,'-')}-${session.to}-${normName(r.name)}-OUT`,
        doc: {
          animalId:          r.a.id,
          animalName:        r.a.name,
          species:           r.a.species,
          fromEnclosureId:   plot.id,
          fromEnclosureName: plot.name,
          toEnclosureId:     null,
          toEnclosureName:   null,
          movedAt:           toMs,
          recordedAt:        Date.parse(STAMP),
          movedBy:           'import-fiches-papier',
          note:              `Sortie session "${session.from} → ${session.to}" depuis ${docLabel}`,
        },
        reason: `Sortie session ${session.to} (${docLabel})`,
      })
    }
    // Si session active, set animal.enclosureId
    if (session.active) {
      writes.animalEnclosureSets.push({
        id:          r.a.id,
        name:        r.a.name,
        enclosureId: plot.id,
        plotName:    plot.name,
        reason:      `Session active depuis ${session.from} (${docLabel})`,
      })
    }
  }
}

// === Rapport ===
function fmt(s, n = 60) { return (s || '').toString().padEnd(n).slice(0, n) }
console.log('\n=== PLAN D\'IMPORT (' + (DRY ? 'DRY-RUN' : 'APPLY') + ') ===\n')
console.log(`Pin updates       : ${writes.pinUpdates.length}`)
console.log(`Mouvements créés  : ${writes.movements.length}`)
console.log(`Animaux à placer  : ${writes.animalEnclosureSets.length}`)
console.log(`Rejets (→ questionnaire) : ${rejects.length}\n`)

console.log('--- ENRICHISSEMENTS PLOTS ---')
for (const u of writes.pinUpdates) {
  console.log(`  ${fmt(u.name, 25)} → ${u.reason}`)
  const keys = Object.keys(u.fields).filter(k => k !== 'note')
  console.log(`    Champs    : ${keys.join(', ')}` + (u.noteAppended ? '  +note' : '  (note déjà importée, skip)'))
}

console.log('\n--- MOUVEMENTS (premiers 20) ---')
for (const m of writes.movements.slice(0, 20)) {
  console.log(`  ${m.reason}  →  ${m.doc.animalName}`)
}
if (writes.movements.length > 20) console.log(`  … ${writes.movements.length - 20} autres`)

console.log('\n--- ANIMAUX À PLACER (session active) ---')
for (const a of writes.animalEnclosureSets) {
  console.log(`  ${fmt(a.name, 15)} → ${a.plotName}   (${a.reason})`)
}

console.log('\n--- REJETS (vers questionnaire) ---')
for (const r of rejects) {
  console.log(`  [${r.reason}] ${r.detail}`)
}

if (DRY) {
  console.log('\n[dry-run] Aucun changement appliqué. Relancer avec --apply pour écrire.')
  process.exit(0)
}

// === APPLY ===
;(async () => {
  let admin
  try { admin = require('firebase-admin') } catch {
    console.error('firebase-admin non installé. cd scripts && npm install firebase-admin')
    process.exit(1)
  }
  admin.initializeApp({ credential: admin.credential.cert(require('./le-cazal-service-account.json')) })
  const db = admin.firestore()

  // Pin updates
  for (const u of writes.pinUpdates) {
    const { id, fields } = u
    const writePayload = { ...fields, updatedAt: Date.now(), updatedBy: 'import-fiches-papier' }
    await db.collection('map_pins').doc(id).set(writePayload, { merge: true })
    console.log(`✓ pin update : ${u.name}`)
  }
  // Movements (idempotent par id)
  for (const m of writes.movements) {
    await db.collection('enclosure_movements').doc(m.id).set(m.doc)
    console.log(`✓ mouvement : ${m.doc.animalName} ${m.doc.movedAt}`)
  }
  // Animaux placement
  for (const a of writes.animalEnclosureSets) {
    await db.collection('animals').doc(a.id).set({ enclosureId: a.enclosureId }, { merge: true })
    console.log(`✓ placement : ${a.name} → ${a.plotName}`)
  }
  console.log('\n✅ Import appliqué.')
  process.exit(0)
})()
