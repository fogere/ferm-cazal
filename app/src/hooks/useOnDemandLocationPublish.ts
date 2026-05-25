import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, updateDoc } from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { useUsers } from './useUsers'
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

  // Bug Eugénie 23/05/2026 (téléphone qui chauffe) : avant on subscribait au
  // core en permanence avec un no-op pour "maintenir le watch actif" — résultat,
  // le GPS tournait 24/24h alors que personne ne regardait la carte. Maintenant
  // on n'active la souscription QUE si un autre user regarde la map → en idle
  // (cas typique : Eugénie seule, app ouverte mais autres téléphones fermés),
  // le watch ne tourne PAS du tout via ce hook.
  const [otherWatcherActive, setOtherWatcherActive] = useState(false)
  const lastPublishAt      = useRef(0)
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null)
  // Ref miroir du state, lu par le setInterval pour éviter de recréer le timer
  // à chaque flip de otherWatcherActive (audit 24/05/2026 — listener churn).
  const otherWatcherActiveRef = useRef(false)

  // Subscribe au core uniquement quand un autre user nous regarde
  const noopUpdate = useCallback(() => { /* updates lus à la demande via getRecentPosition */ }, [])
  useLocationCore(noopUpdate, undefined, !!myUid && shareLocation && otherWatcherActive)

  // Liste users centralisée (UsersProvider) — un seul listener partagé entre
  // tous les hooks/pages consommateurs au lieu de 9 listeners parallèles.
  const users = useUsers()
  // Ref tenant la dernière liste users, pour le polling du timer (le timer ne
  // doit pas être recréé à chaque changement de users — sinon listener churn).
  const usersRef = useRef(users)
  usersRef.current = users

  // Recalcule "un autre user regarde la map" à chaque update de la liste users.
  // Source primaire de la transition active→inactive lorsqu'un user ferme la map.
  useEffect(() => {
    if (!myUid || !shareLocation) {
      otherWatcherActiveRef.current = false
      setOtherWatcherActive(false)
      return
    }
    const now = Date.now()
    let active = false
    for (const u of users) {
      if (u.uid === myUid) continue
      if (u.mapOpenAt && now - u.mapOpenAt < RECENT_WINDOW_MS) {
        active = true
        break
      }
    }
    if (active !== otherWatcherActiveRef.current) {
      otherWatcherActiveRef.current = active
      setOtherWatcherActive(active)
    }
  }, [users, myUid, shareLocation])

  useEffect(() => {
    if (!myUid || !shareLocation) return

    // Polling local — quand actif, on publie 1× / minute (throttle).
    // Le timer recalcule aussi `active` (selon l'horloge) pour gérer le cas
    // d'un user dont mapOpenAt expire sans qu'un nouveau snapshot Firestore
    // n'arrive (ex : l'autre user kill l'app sans fermer proprement la map).
    timerRef.current = setInterval(() => {
      // Re-check de la fenêtre temporelle indépendamment des snapshots Firestore
      const now = Date.now()
      let active = false
      for (const u of usersRef.current) {
        if (u.uid === myUid) continue
        if (u.mapOpenAt && now - u.mapOpenAt < RECENT_WINDOW_MS) {
          active = true
          break
        }
      }
      if (active !== otherWatcherActiveRef.current) {
        otherWatcherActiveRef.current = active
        setOtherWatcherActive(active)
      }
      if (!active) return
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
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [myUid, shareLocation])
}
