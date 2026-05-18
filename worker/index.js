/**
 * Cloudflare Worker — Ferme Nilslamber
 * Tourne toutes les 30 minutes (Cron Trigger)
 * Vérifie les points d'eau en retard et les tâches urgentes
 * et envoie des notifications push FCM aux bons utilisateurs.
 *
 * Secret requis (Cloudflare dashboard) :
 *   SERVICE_ACCOUNT_JSON = contenu du fichier JSON du compte de service Firebase
 */

const PROJECT_ID  = 'farm-ed787'
const DB_BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const FCM_URL     = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`
const TOKEN_URL   = 'https://oauth2.googleapis.com/token'
const SCOPES      = 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore'

/* ─── JWT / OAuth2 via Web Crypto (natif Cloudflare) ─── */

function pemToBuf(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(saJson) {
  const sa  = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const enc = new TextEncoder()

  const hdr  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '')
  const pay  = btoa(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: TOKEN_URL, iat: now, exp: now + 3600, scope: SCOPES,
  })).replace(/=/g, '')

  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBuf(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${hdr}.${pay}`))
  const jwt = `${hdr}.${pay}.${b64url(sig)}`

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth2%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  return (await r.json()).access_token
}

/* ─── Firestore helpers ─── */

async function firestoreQuery(token, collectionId, filters) {
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: filters.length === 1 ? filters[0] : {
        compositeFilter: { op: 'AND', filters },
      },
    },
  }
  const r = await fetch(`${DB_BASE}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

async function firestorePatch(token, docPath, fields) {
  const mask = Object.keys(fields).join(',')
  const doc  = { fields: {} }
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number')  doc.fields[k] = { integerValue: String(v) }
    if (typeof v === 'boolean') doc.fields[k] = { booleanValue: v }
    if (typeof v === 'string')  doc.fields[k] = { stringValue: v }
    if (v === null)             doc.fields[k] = { nullValue: null }
  }
  await fetch(`${DB_BASE}/${docPath}?updateMask.fieldPaths=${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

function fVal(field) {
  if (!field) return null
  return field.stringValue ?? field.integerValue ?? field.booleanValue ?? field.nullValue ?? null
}

/* ─── Heures silencieuses ─── */

function inSilentHours(start = '22:00', end = '07:00') {
  const now  = new Date()
  const nowM = now.getUTCHours() * 60 + now.getUTCMinutes() + 60 // +1h Paris approx
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  return s > e ? (nowM >= s || nowM <= e) : (nowM >= s && nowM <= e)
}

/* ─── Envoi FCM ─── */

async function sendNotification(token, fcmToken, title, body, data = {}) {
  await fetch(FCM_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        android: {
          priority: 'high',
          notification: { channelId: data.severity === 'urgent' ? 'urgent_alerts' : 'farm_reminders' },
        },
        data,
      },
    }),
  })
}

/* ─── Logique principale ─── */

async function checkReminders(saJson) {
  const token = await getAccessToken(saJson)
  const now   = Date.now()
  const stats = { water: 0, batteries: 0, tasks: 0, errors: 0 }

  // Charge tous les utilisateurs (pour FCM tokens + heures silencieuses)
  const usersR = await fetch(`${DB_BASE}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const usersData = await usersR.json()
  const users = {}
  for (const doc of (usersData.documents ?? [])) {
    const uid = doc.name.split('/').pop()
    users[uid] = {
      fcmToken:    fVal(doc.fields.fcmToken),
      silentStart: fVal(doc.fields.silentStart) ?? '22:00',
      silentEnd:   fVal(doc.fields.silentEnd)   ?? '07:00',
    }
  }

  // Points d'eau manuels — rappel en avance + escalade si dépassé
  const waterRows = await firestoreQuery(token, 'map_pins', [
    { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'water_manual' } } },
  ])

  for (const row of waterRows) {
    if (!row.document) continue
    const f            = row.document.fields ?? {}
    const pinId        = row.document.name.split('/').pop()
    const assignedTo   = fVal(f.assignedTo)
    const name         = fVal(f.name) ?? "Point d'eau"
    const nextAt       = Number(fVal(f.nextReminderAt) ?? 0)
    const dueAt        = Number(fVal(f.dueAt) ?? nextAt) // compat anciens docs
    const reminderSent = fVal(f.reminderSent) === true || fVal(f.reminderSent) === 'true'
    const intervalH    = Number(fVal(f.intervalHours) ?? 24)

    if (!assignedTo) continue

    // ── Escalade : deadline dépassée et rappel déjà envoyé ──
    if (reminderSent && dueAt > 0 && dueAt < now) {
      const lastEscalated = Number(fVal(f.lastEscalatedAt) ?? 0)
      if (now - lastEscalated < 3_600_000) continue // max 1x par heure

      for (const [uid, u] of Object.entries(users)) {
        if (!u.fcmToken) continue
        // Les alertes urgentes ignorent les heures silencieuses
        try {
          await sendNotification(token, u.fcmToken,
            "🚨 Point d'eau non rempli !",
            `${name} — échéance dépassée, personne n'a confirmé`,
            { type: 'water_escalation', pinId, severity: 'urgent' }
          )
        } catch { stats.errors++ }
      }
      await firestorePatch(token, `map_pins/${pinId}`, { lastEscalatedAt: now })
      stats.water++
      continue
    }

    // ── Rappel en avance (nextReminderAt <= now, reminderSent == false) ──
    if (reminderSent || nextAt > now) continue

    const u = users[assignedTo]
    if (!u?.fcmToken || inSilentHours(u.silentStart, u.silentEnd)) continue

    const minsLeft = Math.round((dueAt - now) / 60000)
    const timeLabel = minsLeft <= 0 ? 'maintenant'
      : minsLeft < 60 ? `dans ${minsLeft} min`
      : `dans ${Math.floor(minsLeft / 60)}h`

    try {
      await sendNotification(token, u.fcmToken,
        "💧 Point d'eau à remplir",
        `${name} — ${timeLabel} (intervalle ${intervalH}h)`,
        { type: 'water_reminder', pinId, severity: 'warning' }
      )
      await firestorePatch(token, `map_pins/${pinId}`, {
        reminderSent: true, lastReminderAt: now,
      })
      stats.water++
    } catch { stats.errors++ }
  }

  // Batteries de clôture : vérification due
  const batteryRows = await firestoreQuery(token, 'map_pins', [
    { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'battery' } } },
  ])

  for (const row of batteryRows) {
    if (!row.document) continue
    const f          = row.document.fields ?? {}
    const pinId      = row.document.name.split('/').pop()
    const name       = fVal(f.name) ?? 'Batterie'
    const nextCheckAt = Number(fVal(f.nextCheckAt) ?? 0)
    const lastAlert   = Number(fVal(f.lastCheckAlert) ?? 0)

    if (!nextCheckAt || nextCheckAt > now) continue
    if (now - lastAlert < 86_400_000) continue // max 1x par jour

    const status = fVal(f.batteryStatus) ?? 'good'
    const zone   = fVal(f.zoneCovered)   ?? ''

    for (const [, u] of Object.entries(users)) {
      if (!u.fcmToken || inSilentHours(u.silentStart, u.silentEnd)) continue
      try {
        await sendNotification(token, u.fcmToken,
          '⚡ Batterie à vérifier',
          zone ? `${name} (${zone}) — statut actuel : ${status}` : `${name} — statut actuel : ${status}`,
          { type: 'battery_check', pinId, severity: 'warning' }
        )
      } catch { stats.errors++ }
    }
    await firestorePatch(token, `map_pins/${pinId}`, { lastCheckAlert: now })
    stats.batteries = (stats.batteries ?? 0) + 1
  }

  // Tâches urgentes en retard (1 notification max par heure)
  const taskRows = await firestoreQuery(token, 'tasks', [
    { fieldFilter: { field: { fieldPath: 'completed' }, op: 'EQUAL', value: { booleanValue: false } } },
    { fieldFilter: { field: { fieldPath: 'priority' }, op: 'EQUAL', value: { stringValue: 'urgent' } } },
  ])

  for (const row of taskRows) {
    if (!row.document) continue
    const f          = row.document.fields ?? {}
    const taskId     = row.document.name.split('/').pop()
    const assignedTo = fVal(f.assignedTo)
    const dueDate    = Number(fVal(f.dueDate) ?? 0)
    const lastAlert  = Number(fVal(f.lastOverdueAlert) ?? 0)
    const title      = fVal(f.title) ?? 'Tâche'

    if (!assignedTo || dueDate > now) continue
    if (now - lastAlert < 3_600_000) continue // max 1x par heure

    const u = users[assignedTo]
    if (!u?.fcmToken || inSilentHours(u.silentStart, u.silentEnd)) continue

    try {
      await sendNotification(token, u.fcmToken,
        '⚠️ Tâche urgente en retard',
        `"${title}" — à faire maintenant`,
        { type: 'task_overdue', taskId, severity: 'urgent' }
      )
      await firestorePatch(token, `tasks/${taskId}`, { lastOverdueAlert: now })
      stats.tasks++
    } catch { stats.errors++ }
  }

  return stats
}

/* ─── Handler Cloudflare ─── */

export default {
  // Déclenchement manuel via URL (pour tester)
  async fetch(request, env) {
    const url    = new URL(request.url)
    const secret = env.CRON_SECRET
    if (secret && url.searchParams.get('key') !== secret) {
      return new Response('Unauthorized', { status: 401 })
    }
    try {
      const stats = await checkReminders(env.SERVICE_ACCOUNT_JSON)
      return Response.json({ ok: true, ...stats })
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 })
    }
  },

  // Déclenchement automatique toutes les 30 minutes
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkReminders(env.SERVICE_ACCOUNT_JSON))
  },
}
