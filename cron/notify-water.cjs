/* eslint-disable */
/**
 * Cron scanner FCM — exécuté toutes les 5 min par GitHub Actions.
 *
 * Scanne Firestore et envoie les notifications push manquantes :
 * 1. Points d'eau manuels  — rappel X heures avant `dueAt`
 * 2. Points d'eau manuels  — escalade à tous Y heures après dueAt non rempli
 * 3. Batteries de clôture  — rappel périodique selon `nextCheckAt`
 *
 * Le service account est lu depuis la variable d'env `FIREBASE_SERVICE_ACCOUNT`
 * (contenu JSON du fichier service account collé tel quel dans le secret GitHub).
 *
 * Le script est idempotent : il marque `reminderSent: true` et `lastEscalatedAt`
 * pour ne pas re-notifier deux fois.
 *
 * Honore les heures silencieuses : si la cible est entre `silentStart` et
 * `silentEnd` (interprétés en Europe/Paris), le rappel non urgent est reporté.
 * Les escalades urgentes ignorent les heures silencieuses.
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

/* ─── Main ─── */

async function main() {
  const start = Date.now()
  console.log(`▶ Scan FCM — ${new Date().toISOString()}`)
  try {
    await processWaterPoints()
    await processBatteries()
  } catch (e) {
    console.error('Erreur scan :', e)
    process.exit(1)
  }
  const ms = Date.now() - start
  console.log(`✓ Terminé en ${ms} ms — ${sentCount} envoi(s), ${skippedSilent} report(s) heures silencieuses, ${skippedNoToken} sans token`)
  process.exit(0)
}

main()
