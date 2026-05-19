/* eslint-disable */
/**
 * Cron scanner FCM — exécuté toutes les 5 min par GitHub Actions.
 *
 * Couvre TOUS les types de notifications :
 *   1. Points d'eau manuels  — rappel X heures avant `dueAt`
 *   2. Points d'eau manuels  — escalade à tous Y heures après dueAt non rempli
 *   3. Batteries de clôture  — rappel périodique selon `nextCheckAt`
 *   4. Batteries de clôture  — alerte urgente si statut critical/down
 *   5. Tâches récurrentes    — auto-créées (quotidien / hebdo) si flag `nextOccurrenceCreated` absent
 *   6. Tâches en retard      — rappel à l'assigné si tâche non cochée la veille
 *
 * En plus, ré-synchronise le doc `/opti/state` pour optimiser les lectures
 * Firestore côté clients (système opti).
 *
 * Service account lu depuis la variable d'env `FIREBASE_SERVICE_ACCOUNT`.
 * Idempotent : utilise `reminderSent`, `lastEscalatedAt`, `nextOccurrenceCreated`
 * pour ne pas re-notifier deux fois.
 *
 * Honore les heures silencieuses (Europe/Paris). Urgent ignore les heures silencieuses.
 */

const admin = require('firebase-admin')

/* ─── Service account ─── */

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    console.error('❌ Variable FIREBASE_SERVICE_ACCOUNT manquante.')
    console.error('   Ajoute le contenu JSON du service account dans les secrets GitHub.')
    process.exit(1)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT n\'est pas du JSON valide :', e.message)
    process.exit(1)
  }
}

admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) })

const db = admin.firestore()
const messaging = admin.messaging()

/* ─── Helpers temporels ─── */

const TIMEZONE = 'Europe/Paris'

// Convertit un timestamp ms en {hh, mm} dans le fuseau Paris
function localHourMinutes(ms) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [hh, mm] = fmt.format(new Date(ms)).split(':').map(Number)
  return { hh, mm }
}

// Vrai si l'heure actuelle (Paris) est dans la plage silencieuse de l'user.
// Plage qui traverse minuit : ex 22:00 → 07:00.
function isInSilentWindow(silentStart, silentEnd, now = Date.now()) {
  if (!silentStart || !silentEnd) return false
  const { hh, mm } = localHourMinutes(now)
  const nowMin = hh * 60 + mm
  const [sH, sM] = silentStart.split(':').map(Number)
  const [eH, eM] = silentEnd.split(':').map(Number)
  const startMin = sH * 60 + sM
  const endMin   = eH * 60 + eM
  if (startMin === endMin) return false
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin
  }
  // Traverse minuit
  return nowMin >= startMin || nowMin < endMin
}

/* ─── Cache utilisateur ─── */

const userCache = new Map()
async function getUser(uid) {
  if (!uid) return null
  if (userCache.has(uid)) return userCache.get(uid)
  const snap = await db.collection('users').doc(uid).get()
  const data = snap.exists ? snap.data() : null
  userCache.set(uid, data)
  return data
}

async function getAllRegularUsers() {
  // Tous les profils réguliers (avec fcmToken) — pour escalade "à tous"
  const snap = await db.collection('users').where('fcmToken', '!=', null).get()
  return snap.docs.map(d => d.data()).filter(u => u && u.fcmToken)
}

/* ─── Envoi FCM ─── */

let sentCount = 0
let skippedSilent = 0
let skippedNoToken = 0

async function sendNotification(user, { title, body, severity = 'info', data = {} }) {
  if (!user) return
  if (!user.fcmToken) { skippedNoToken++; return }

  const urgent = severity === 'urgent'
  if (!urgent && isInSilentWindow(user.silentStart, user.silentEnd)) {
    skippedSilent++
    return
  }

  try {
    await messaging.send({
      token: user.fcmToken,
      notification: { title, body },
      data: { severity, ...data },
      webpush: {
        notification: {
          icon: '/icons/farm-icon.svg',
          badge: '/icons/farm-icon.svg',
          requireInteraction: urgent,
        },
      },
    })
    sentCount++
    console.log(`✓ FCM → ${user.displayName ?? user.uid} : ${title}`)
  } catch (e) {
    console.warn(`✗ FCM échec → ${user.displayName ?? user.uid} : ${e.message}`)
  }
}

/* ─── Scan : points d'eau manuels ─── */

async function processWaterPoints() {
  const now = Date.now()
  const pinsSnap = await db.collection('map_pins').where('type', '==', 'water_manual').get()

  for (const doc of pinsSnap.docs) {
    const pin = doc.data()
    pin.id = doc.id

    // 1) Rappel "X h avant l'échéance" — déclenche si nextReminderAt passé ET pas encore notifié
    if (pin.nextReminderAt && pin.nextReminderAt <= now && !pin.reminderSent) {
      const assignee = pin.assignedTo && pin.assignedTo !== 'auto'
        ? await getUser(pin.assignedTo)
        : null

      if (assignee) {
        await sendNotification(assignee, {
          title: '💧 Remplissage à venir',
          body:  `${pin.name} — à remplir d'ici peu`,
          severity: 'warning',
          data: { pinId: pin.id, kind: 'water_reminder' },
        })
      }

      // Marque comme envoyé même si pas d'assignee pour ne pas reboucler
      await doc.ref.update({ reminderSent: true })
    }

    // 2) Escalade : `dueAt` dépassé de plus de `escalateAfterHours` h, jamais escaladé OU dernière escalade > 1h
    if (pin.dueAt && pin.escalateAfterHours) {
      const escalateAt = pin.dueAt + pin.escalateAfterHours * 3600_000
      const escalateAgainAfter = (pin.lastEscalatedAt ?? 0) + 3600_000  // ré-alerte max 1×/h
      if (escalateAt <= now && escalateAgainAfter <= now) {
        const allUsers = await getAllRegularUsers()
        for (const u of allUsers) {
          await sendNotification(u, {
            title: '🚨 Point d\'eau non rempli',
            body:  `${pin.name} aurait dû être rempli — n'attend plus`,
            severity: 'urgent',
            data: { pinId: pin.id, kind: 'water_escalation' },
          })
        }
        await doc.ref.update({ lastEscalatedAt: now })
      }
    }
  }
}

/* ─── Scan : batteries ─── */

async function processBatteries() {
  const now = Date.now()
  const pinsSnap = await db.collection('map_pins').where('type', '==', 'battery').get()

  for (const doc of pinsSnap.docs) {
    const pin = doc.data()
    pin.id = doc.id

    if (pin.nextCheckAt && pin.nextCheckAt <= now && !pin.reminderSent) {
      // Rappel à tous (pas d'assignee unique sur batteries)
      const allUsers = await getAllRegularUsers()
      for (const u of allUsers) {
        await sendNotification(u, {
          title: '⚡ Vérifier batterie clôture',
          body:  `${pin.name} — contrôle périodique à faire`,
          severity: 'info',
          data: { pinId: pin.id, kind: 'battery_check' },
        })
      }
      await doc.ref.update({ reminderSent: true })
    }

    // Statut critique ou en panne → escalade tous
    if ((pin.batteryStatus === 'critical' || pin.batteryStatus === 'down') &&
        (pin.lastEscalatedAt ?? 0) + 6 * 3600_000 <= now) {
      const allUsers = await getAllRegularUsers()
      for (const u of allUsers) {
        await sendNotification(u, {
          title: '🚨 Batterie en panne',
          body:  `${pin.name} — ${pin.batteryStatus === 'down' ? 'hors service' : 'critique'}`,
          severity: 'urgent',
          data: { pinId: pin.id, kind: 'battery_critical' },
        })
      }
      await doc.ref.update({ lastEscalatedAt: now })
    }
  }
}

/* ─── Scan : tâches récurrentes (création des prochaines occurrences) ─── */
/*
 * Filet de sécurité : normalement, le client crée la prochaine occurrence dès
 * qu'il coche la tâche faite (Tasks.tsx::toggleDone). Mais si le client a échoué
 * (offline, race) le flag nextOccurrenceCreated reste à false. Le cron rattrape.
 *
 * Récurrence "depuis la dernière fois" : on compte à partir de completedAt.
 *   - daily         : +1 jour
 *   - weekly        : +7 jours
 *   - every_n_days  : +intervalDays
 * La nouvelle occurrence est créée NON ASSIGNÉE (pool commun).
 */
async function processRecurringTasks() {
  const now = Date.now()
  const snap = await db.collection('tasks').where('completed', '==', true).get()

  let createdCount = 0
  for (const doc of snap.docs) {
    const task = doc.data()
    if (task.nextOccurrenceCreated) continue
    if (task.recurrence === 'once' || !task.recurrence) {
      await doc.ref.update({ nextOccurrenceCreated: true })
      continue
    }

    // Base = completedAt si disponible, sinon dueDate (cas legacy).
    const base = task.completedAt || task.dueDate || now
    let nextDueDate = base
    if (task.recurrence === 'daily')         nextDueDate = base + 24 * 3600_000
    else if (task.recurrence === 'weekly')   nextDueDate = base + 7 * 24 * 3600_000
    else if (task.recurrence === 'every_n_days') {
      const days = Math.max(1, Math.min(30, parseInt(task.intervalDays) || 1))
      nextDueDate = base + days * 24 * 3600_000
    }

    await db.collection('tasks').add({
      title:        task.title,
      zone:         task.zone ?? '',
      assignedTo:   null,  // pool : personne assignée par défaut
      recurrence:   task.recurrence,
      intervalDays: task.intervalDays ?? null,
      priority:     task.priority ?? 'normal',
      completed:    false,
      completedAt:  null,
      completedBy:  null,
      createdAt:    now,
      createdBy:    task.createdBy,
      dueDate:      nextDueDate,
      nextOccurrenceCreated: false,
    })
    await doc.ref.update({ nextOccurrenceCreated: true })
    createdCount++
  }
  if (createdCount > 0) await bumpOpti('tasks')
}

/* ─── Scan : tâches libérées en urgence ("je peux plus") ─── */
/*
 * Quand quelqu'un clique "Je peux plus" sur une tâche prise :
 *   - assignedTo → null (libérée pour le pool)
 *   - urgentReleaseAt = Date.now()
 *   - urgentNotified  = false
 *
 * Le cron envoie un push URGENT à TOUS les utilisateurs réguliers,
 * IGNORE les heures silencieuses (severity 'urgent'), puis flag
 * urgentNotified=true pour ne pas re-pinger.
 */
async function processUrgentReleases() {
  // Pas de where composite : on lit toutes les tâches non-complétées et on filtre.
  const snap = await db.collection('tasks').where('completed', '==', false).get()

  for (const doc of snap.docs) {
    const task = doc.data()
    if (!task.urgentReleaseAt) continue
    if (task.urgentNotified) continue

    const releaser = task.urgentReleaseBy ? await getUser(task.urgentReleaseBy) : null
    const releaserName = releaser?.displayName ?? 'Quelqu\'un'
    const reason = task.urgentReleaseReason ? ` (${task.urgentReleaseReason})` : ''

    const allUsers = await getAllRegularUsers()
    for (const u of allUsers) {
      // On évite de notifier la personne qui vient de libérer.
      if (u.uid === task.urgentReleaseBy) continue
      await sendNotification(u, {
        title: '🚨 Tâche urgente libérée',
        body:  `${releaserName} ne peut plus s'occuper de "${task.title}"${reason}`,
        severity: 'urgent',
        data: { taskId: doc.id, kind: 'task_urgent_release' },
      })
    }
    await doc.ref.update({ urgentNotified: true })
  }
}

/* ─── Scan : tâches en retard ─── */
/*
 * - Si la tâche EST prise par quelqu'un : ping cette personne (rappel personnel).
 * - Si la tâche est LIBRE (assignedTo null/'auto') : pas de push individuel.
 *   La personne verra la tâche en retard sur le dashboard / au matin.
 *   On évite de spammer les 4 utilisateurs à chaque tâche libre en retard.
 * Rate-limit : 1× max par 24 h par tâche.
 */
async function processOverdueTasks() {
  const now = Date.now()
  const oneDayAgo = now - 24 * 3600_000

  const snap = await db.collection('tasks').where('dueDate', '<', now).get()

  for (const doc of snap.docs) {
    const task = doc.data()
    if (task.completed) continue
    if (task.lastOverdueReminderAt && task.lastOverdueReminderAt > oneDayAgo) continue
    // Pool model : seules les tâches assignées (claimed) déclenchent un push.
    if (!task.assignedTo || task.assignedTo === 'auto') continue

    const user = await getUser(task.assignedTo)
    if (!user) continue

    await sendNotification(user, {
      title: '📋 Tâche en retard',
      body:  `${task.title} (${task.zone || 'sans zone'})`,
      severity: 'warning',
      data: { taskId: doc.id, kind: 'task_overdue' },
    })
    await doc.ref.update({ lastOverdueReminderAt: now })
  }
}

/* ─── Système opti : bump et re-sync ─── */

const optiRef = db.collection('opti').doc('state')

async function bumpOpti(collectionName) {
  try {
    await optiRef.set({ [collectionName]: Date.now() }, { merge: true })
  } catch (e) {
    console.warn(`bumpOpti ${collectionName}:`, e.message)
  }
}

// Filet de sécurité : si un client a oublié de bumper opti, on rattrape.
// Lit 1 doc par collection (le plus récent) et compare à opti.
async function syncOpti() {
  const collections = [
    { name: 'map_pins',             orderBy: 'updatedAt' },
    { name: 'animals',              orderBy: 'addedAt' },
    { name: 'tasks',                orderBy: 'createdAt' },
    { name: 'alerts',               orderBy: 'createdAt' },
    { name: 'animal_care',          orderBy: 'createdAt' },
    { name: 'reserves',             orderBy: 'updatedAt' },
    { name: 'enclosure_movements',  orderBy: 'movedAt' },
    { name: 'pin_photos',           orderBy: 'uploadedAt' },
  ]

  const optiSnap = await optiRef.get()
  const opti = optiSnap.exists ? optiSnap.data() : {}
  const updates = {}

  for (const c of collections) {
    try {
      const latest = await db.collection(c.name).orderBy(c.orderBy, 'desc').limit(1).get()
      if (latest.empty) continue
      const raw = latest.docs[0].data()[c.orderBy]
      if (!raw) continue
      const tsValue = typeof raw === 'number' ? raw
                    : (raw && raw.toMillis ? raw.toMillis() : 0)
      if (!opti[c.name] || opti[c.name] < tsValue) {
        updates[c.name] = tsValue
      }
    } catch (e) {
      console.warn(`syncOpti ${c.name}:`, e.message)
    }
  }

  if (Object.keys(updates).length > 0) {
    await optiRef.set(updates, { merge: true })
    console.log(`✓ opti rattrapé pour: ${Object.keys(updates).join(', ')}`)
  }
}

/* ─── Main ─── */

async function main() {
  const start = Date.now()
  console.log(`▶ Scan FCM — ${new Date().toISOString()}`)
  try {
    await processWaterPoints()
    await processBatteries()
    await processRecurringTasks()
    await processOverdueTasks()
    await processUrgentReleases()
    await syncOpti()
  } catch (e) {
    console.error('Erreur scan :', e)
    process.exit(1)
  }
  const ms = Date.now() - start
  console.log(`✓ Terminé en ${ms} ms — ${sentCount} envoi(s), ${skippedSilent} report(s) heures silencieuses, ${skippedNoToken} sans token`)
  process.exit(0)
}

main()
