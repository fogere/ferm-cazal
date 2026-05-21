import { useCallback, useEffect, useRef } from 'react'
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { useLocationCore } from './useLocationCore'
import { locationCore } from '../services/location/locationCore'

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
 *
 * Source GPS : `locationCore` (watchPosition partagé). Le subscribe au core
 * garantit que le watch tourne pour cet utilisateur ; les updates push
 * sont ignorés (on lit ponctuellement via getRecentPosition), le but est
 * juste de maintenir le watch actif tant que shareLocation est on.
 */

const RECENT_WINDOW_MS = 90_000   // un autre user est "en train de regarder" si mapOpenAt < 90s
const PUBLISH_INTERVAL = 60_000   // 1 publication par minute max tant qu'un viewer est actif
// Position acceptée si < 90 s : on tolère un léger décalage pour ne pas
// re-fetch inutilement (l'utilisatrice apparaîtra une fois par minute,
// les 30 s de latence ne sont pas perceptibles à l'échelle ferme).
const POSITION_MAX_AGE = 90_000

export function useOnDemandLocationPublish() {
  const { user, profile } = useAuth()
  const shareLocation = !!profile?.shareLocation
  const myUid = user?.uid

  // Détecte si un autre user regarde la carte
  const otherWatcherActive = useRef(false)
  const lastPublishAt      = useRef(0)
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null)

  // S'abonne au core (no-op sur les updates) : garantit que le watch tourne
  // tant que shareLocation est on, même pour les utilisateurs où
  // useGeofenceAlert est désactivé (cas temp + shareLocation).
  const noopUpdate = useCallback(() => { /* updates lus à la demande via getRecentPosition */ }, [])
  useLocationCore(noopUpdate, undefined, !!myUid && shareLocation)

  useEffect(() => {
    if (!myUid || !shareLocation) return

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

      const recent = locationCore.getRecentPosition(POSITION_MAX_AGE)
      if (!recent) return  // pas de position fraîche dispo, on attend le prochain tick

      lastPublishAt.current = now
      updateDoc(doc(db, 'users', myUid), {
        liveLocation: {
          lat:       recent.lat,
          lng:       recent.lng,
          accuracy:  Math.round(recent.accuracy),
          updatedAt: Date.now(),
        },
      }).catch(() => {})
    }, 10_000) // check toutes les 10 s, mais l'écriture est throttlée à 1/minute

    return () => {
      unsub()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [myUid, shareLocation])
}
