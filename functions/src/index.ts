import { onRequest } from 'firebase-functions/v2/https'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

initializeApp()

const db        = getFirestore()
const messaging = getMessaging()

/* ─── heures silencieuses ─── */

function isInSilentHours(start: string, end: string): boolean {
  const now     = new Date()
  const nowMin  = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  // Gère le passage minuit (ex: 22h → 07h)
  if (startMin > endMin) return nowMin >= startMin || nowMin <= endMin
  return nowMin >= startMin && nowMin <= endMin
}

/* ─── envoi FCM sécurisé ─── */

async function sendToUser(uid: string, title: string, body: string, data: Record<string, string>) {
  const userDoc = await db.collection('users').doc(uid).get()
  const userData = userDoc.data()
  if (!userData?.fcmToken) return

  const silentStart = userData.silentStart ?? '22:00'
  const silentEnd   = userData.silentEnd   ?? '07:00'
  if (isInSilentHours(silentStart, silentEnd)) return

  try {
    await messaging.send({
      token: userData.fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channelId: data.severity === 'urgent' ? 'urgent_alerts' : 'farm_reminders',
          sound: 'default',
        },
      },
      data,
    })
  } catch (err: any) {
    if (err.code === 'messaging/registration-token-not-registered') {
      // Token invalide — nettoyage
      await userDoc.ref.update({ fcmToken: null })
    } else {
      throw err
    }
  }
}

/* ─── endpoint HTTP — déclenché par cron-job.org toutes les 30min ─── */
// URL: https://<region>-<project-id>.cloudfunctions.net/checkReminders?key=VOTRE_SECRET
// Configurer CRON_SECRET via : firebase functions:secrets:set CRON_SECRET

export const checkReminders = onRequest(
  { region: 'europe-west1', invoker: 'public' },
  async (req, res) => {
    const secret = process.env.CRON_SECRET
    if (secret && req.query.key !== secret) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const now = Date.now()
    const stats = { waterReminders: 0, errors: 0 }

    try {
      // ── Points d'eau manuels en retard ──
      const waterSnap = await db
        .collection('map_pins')
        .where('type', '==', 'water_manual')
        .where('nextReminderAt', '<=', now)
        .where('reminderSent', '==', false)
        .get()

      for (const pinDoc of waterSnap.docs) {
        const pin = pinDoc.data()
        if (!pin.assignedTo) continue

        try {
          await sendToUser(
            pin.assignedTo,
            "💧 Point d'eau à remplir",
            `${pin.name} — à remplir maintenant (toutes les ${pin.intervalHours ?? 24}h)`,
            { type: 'water_reminder', pinId: pinDoc.id, severity: 'warning' }
          )
          await pinDoc.ref.update({ reminderSent: true, lastReminderAt: now })
          stats.waterReminders++
        } catch {
          stats.errors++
        }
      }

      // ── Tâches en retard (urgentes seulement, non complétées) ──
      const overdueSnap = await db
        .collection('tasks')
        .where('completed', '==', false)
        .where('priority', '==', 'urgent')
        .where('dueDate', '<=', now)
        .get()

      for (const taskDoc of overdueSnap.docs) {
        const task = taskDoc.data()
        if (!task.assignedTo) continue
        // Évite de notifier plus d'une fois par heure (lastOverdueAlert)
        const lastAlert = task.lastOverdueAlert ?? 0
        if (now - lastAlert < 3_600_000) continue

        try {
          await sendToUser(
            task.assignedTo,
            '⚠️ Tâche urgente en retard',
            `"${task.title}" était prévue avant aujourd'hui`,
            { type: 'task_overdue', taskId: taskDoc.id, severity: 'urgent' }
          )
          await taskDoc.ref.update({ lastOverdueAlert: now })
        } catch {
          stats.errors++
        }
      }

    } catch (err) {
      console.error('checkReminders fatal error:', err)
      res.status(500).json({ error: String(err) })
      return
    }

    res.json({ ok: true, ...stats, checkedAt: new Date().toISOString() })
  }
)
