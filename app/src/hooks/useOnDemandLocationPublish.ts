import { useEffect, useRef } from 'react'
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'

/**
 * Pull-on-demand de la position GPS.
 *
 * Monté GLOBALEMENT (App.tsx) pour TOUS les utilisateurs connectés ayant
 * activé `shareLocation`. Contrairement à `useLiveLocation` qui tourne en
 * continu pendant qu'on est sur /map, ce hook écoute si UN AUTRE utilisateur
 * a `mapOpenAt` récent (< 90 s) : dans ce cas, il publie ma position 1 fois
 * (puis 1 fois / minute tant que l'autre regarde). Quand plus personne ne
 * regarde la carte, on ne publie rien — zéro écriture Firestore en idle.
 *
 * Idée du bug Eugénie #2 (19/05/2026) : « Au lieu de pinger H24 la map
 * toutes les 30s, demander 1 seule fois leur localisation quand quelqu'un
 * ouvre la map. »
 */

const RECENT_WINDOW_MS = 90_000   // un autre user est "en train de regarder" si mapOpenAt < 90s
const PUBLISH_INTERVAL = 60_000   // 1 publication par minute max tant qu'un viewer est actif
// 45 s : avec enableHighAccuracy=true (fix bug Eugénie 21/05), le first fix GPS peut
// prendre 20-30 s sur Android quand on est en intérieur ou en cold start. Anciennement
// 15 s → "Timeout expired" en boucle dans les logs. À 45 s on laisse le temps au GPS de
// se chauffer ; si vraiment pas de signal, on abandonne (mieux que de boucler des erreurs).
const POSITION_TIMEOUT = 45_000

export function useOnDemandLocationPublish() {
  const { user, profile } = useAuth()
  const shareLocation = !!profile?.shareLocation
  const myUid = user?.uid

  // Détecte si un autre user regarde la carte
  const otherWatcherActive = useRef(false)
  const lastPublishAt      = useRef(0)
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null)
  // Anti-spam des logs d'erreur geoloc : un seul warn par code par session.
  // Sans ça, le buffer ring du bugReporter se remplit de "[onDemandPublish] geoloc:
  // Timeout expired" toutes les 60 s et noie les vraies erreurs (vu dans les bug
  // reports du 21/05/2026).
  const geoLogged          = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!myUid || !shareLocation) return
    if (!('geolocation' in navigator)) return

    // Écoute les autres profils pour savoir si l'un d'eux regarde la map
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      const now = Date.now()
      let active = false
      snap.forEach(d => {
        if (d.id === myUid) return
        const data = d.data() as { mapOpenAt?: number }
        if (data.mapOpenAt && now - data.mapOpenAt < RECENT_WINDOW_MS) {
          active = true
        }
      })
      otherWatcherActive.current = active
    }, err => console.warn('[onDemandPublish] users snap:', err?.code))

    // Polling local — quand actif, on publie 1× / minute (throttle).
    timerRef.current = setInterval(() => {
      if (!otherWatcherActive.current) return
      const now = Date.now()
      if (now - lastPublishAt.current < PUBLISH_INTERVAL) return
      lastPublishAt.current = now

      navigator.geolocation.getCurrentPosition(
        pos => {
          updateDoc(doc(db, 'users', myUid), {
            liveLocation: {
              lat:       pos.coords.latitude,
              lng:       pos.coords.longitude,
              accuracy:  Math.round(pos.coords.accuracy),
              updatedAt: Date.now(),
            },
          }).catch(() => {})
        },
        err => {
          const key = String(err.code ?? err.message)
          if (!geoLogged.current.has(key)) {
            geoLogged.current.add(key)
            console.warn('[onDemandPublish] geoloc:', err.message, '(logué une seule fois/session)')
          }
        },
        // enableHighAccuracy: true — bug Eugénie 21/05/2026 (précision ~500 m).
        // GPS satellite forcé pour que les autres voient une position fiable.
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: POSITION_TIMEOUT },
      )
    }, 10_000) // check toutes les 10 s, mais l'écriture est throttlée à 1/minute

    return () => {
      unsub()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [myUid, shareLocation])
}
