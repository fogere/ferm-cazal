import { useCallback, useEffect, useRef } from 'react'
import {
  collection, doc, getDoc, getDocs, updateDoc,
} from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { pointInPolygonWithHoles } from '../services/map/polygon'
import { useLocationCore } from './useLocationCore'
import type { Animal, MapPin, Task } from '../types'

/**
 * Geofence : quand l'utilisateur entre physiquement dans un enclos contenant
 * des animaux dont la dernière vérification "bonne santé" remonte à >12h
 * (ou jamais), déclenche une notification locale lui proposant de confirmer.
 *
 * Idée du bug chacha (19/05/2026 15:21) : utiliser la géoloc pour savoir si
 * quelqu'un est dans un champ avec des animaux et lui proposer (notif) de
 * remplir un check rapide.
 *
 * Anti-spam : 1 notification max / 6 h par enclos, stockée dans
 * `users/{uid}.geofenceNotified[enclosureId]`. Effet de bord limité côté
 * Firestore : 1 read au mount + refresh toutes les 5 min des enclos+animaux,
 * et 1 écriture quand on notifie réellement (rare).
 *
 * Source GPS : `locationCore` (watchPosition partagé). Avant ce hook montait
 * son propre watchPosition, dupliqué avec useLiveLocation et
 * useOnDemandLocationPublish. Voir services/location/locationCore.ts.
 *
 * S9 (22/05/2026) : la détection se fait UNIQUEMENT sur les `land_plot`
 * actifs. Une clôture, même refermée, n'est jamais un espace : pas de
 * geofence sur les fences. Exclusion des holes via pointInPolygonWithHoles.
 */

const STALE_AFTER_MS  = 12 * 60 * 60 * 1000 // 12 h sans check → animal "à vérifier"
const RENOTIFY_MIN_MS = 6  * 60 * 60 * 1000 // anti-spam : 6 h entre 2 notifs pour le même enclos
// Refresh cache enclos/animaux/tâches toutes les 15 min.
// Audit Firebase 25/05/2026 (Nils) : avec 4 utilisatrices et shareLocation
// activé, un refresh toutes les 5 min consommait ~1 800 reads/jour/client. En
// passant à 15 min on économise 2/3 de ces reads sans impact visuel (le
// geofence est une notif perso à seuil 12 h, pas du temps réel collaboratif).
// La collaboration multi-user sur clôtures/animaux/tâches reste 100% live via
// les onSnapshot de Map/Tasks/Dashboard.
const REFRESH_MS      = 15 * 60 * 1000
const POS_CHECK_MS    = 60_000              // throttle des checks de position : 1× / minute
// Bug Eugénie 24/05/2026 : on ignore les positions à >100 m de précision
// (Wi-Fi/cellulaire). Avec ce niveau d'erreur, on déclencherait des notifs de
// geofence aléatoires dans le mauvais enclos.
const MAX_ACCURACY_M  = 100

function isValidLandPlot(pin: MapPin): boolean {
  return pin.type === 'land_plot'
    && (pin.points?.length ?? 0) >= 3
    && !pin.inactive
}

export function useGeofenceAlert() {
  const { user, profile, isTemp } = useAuth()
  const shareLocation = !!profile?.shareLocation
  const myUid = user?.uid

  const enclosuresRef = useRef<MapPin[]>([])
  const animalsRef    = useRef<Animal[]>([])
  // V5 #1 anti-pollution (Nils 25/05/2026) : ids de land_plots qui ont déjà une
  // tâche active (non complétée, due ≤ fin de journée) liée à eux. Si l'utilisateur
  // entre dans un tel parc, on ne déclenche PAS la notif geofence — la tâche
  // existante suffit à canaliser l'action terrain.
  const activeTaskPlotsRef = useRef<Set<string>>(new Set())
  const lastCheckedAt = useRef(0)
  const refreshTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const insideEnclosure = useRef<string | null>(null)
  const notifiedMap   = useRef<Record<string, number>>({})
  // B · Cache opti (Nils 25/05/2026) : on stocke la dernière version vue par
  // collection pour skip le getDocs si rien n'a bougé. Chaque entrée vaut le
  // timestamp `opti/state[colName]`. Au premier refresh on lit tout, ensuite
  // on n'interroge que la collection dont la version a changé.
  const lastOptiSeen = useRef<{ map_pins: number; animals: number; tasks: number }>({
    map_pins: 0, animals: 0, tasks: 0,
  })

  // Charge / rafraîchit les enclos candidats au geofence + les animaux du cheptel.
  // Candidats = land_plots valides actifs uniquement (S9 : plus de fallback fence).
  // Optimisation opti : avant chaque refresh, on lit /opti/state (1 read) et on
  // compare aux dernières versions vues. Pour chaque collection :
  //   - version inchangée → on garde le cache local (0 read serveur)
  //   - version changée   → getDocs serveur + maj du cache et de la version
  // Filet de sécurité : si opti est introuvable ou plante, on retombe sur le
  // comportement précédent (re-fetch tout). Pas de risque de cache stale long :
  // syncOpti côté cron rattrape toutes les 5 min les bumps oubliés.
  async function refreshCache() {
    try {
      // 1 read pour /opti/state. Coût : 1 lecture par refresh (1/15 min).
      let optiData: { map_pins?: number; animals?: number; tasks?: number } = {}
      try {
        const optiSnap = await getDoc(doc(db, 'opti', 'state'))
        if (optiSnap.exists()) {
          optiData = optiSnap.data() as typeof optiData
        }
      } catch {
        // Si opti est inaccessible (rules, réseau…), on fetch tout par sécurité
        // en laissant optiData vide → toutes les versions seront "changées".
        optiData = {}
      }

      const needPins    = (optiData.map_pins ?? 0) !== lastOptiSeen.current.map_pins || enclosuresRef.current.length === 0
      const needAnimals = (optiData.animals  ?? 0) !== lastOptiSeen.current.animals  || animalsRef.current.length === 0
      const needTasks   = (optiData.tasks    ?? 0) !== lastOptiSeen.current.tasks    || activeTaskPlotsRef.current.size === 0

      // Cas le plus fréquent en utilisation calme : rien n'a bougé. On a alors
      // payé 1 read d'opti contre 154 reads de fetch complet → économie ~99%.
      if (!needPins && !needAnimals && !needTasks) return

      const tasks: Promise<unknown>[] = []
      if (needPins) {
        tasks.push(getDocs(collection(db, 'map_pins')).then(snap => {
          const allPins = snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))
          enclosuresRef.current = allPins.filter(isValidLandPlot)
          lastOptiSeen.current.map_pins = optiData.map_pins ?? Date.now()
        }))
      }
      if (needAnimals) {
        tasks.push(getDocs(collection(db, 'animals')).then(snap => {
          animalsRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal))
          lastOptiSeen.current.animals = optiData.animals ?? Date.now()
        }))
      }
      if (needTasks) {
        tasks.push(getDocs(collection(db, 'tasks')).then(snap => {
          // Fenêtre "active" = jusqu'à la fin de la journée locale courante. Les
          // tâches à échéance demain ou plus tard ne bloquent pas la notif (elles
          // n'orientent pas l'action présente). Pas d'orderBy ici (convention
          // projet : where seul + filter client).
          const endOfToday = new Date()
          endOfToday.setHours(23, 59, 59, 999)
          const cutoff = endOfToday.getTime()
          const plots = new Set<string>()
          snap.forEach(d => {
            const t = d.data() as Task
            if (t.completed) return
            // V6 : lit le nouveau linkedLandId (lien indépendant de l'eau) avec
            // fallback sur linkedKind/linkedId pour les anciennes tâches.
            const landId =
              t.linkedLandId ?? (t.linkedKind === 'land_plot' ? t.linkedId : undefined)
            if (!landId) return
            if (typeof t.dueDate === 'number' && t.dueDate > cutoff) return
            plots.add(landId)
          })
          activeTaskPlotsRef.current = plots
          lastOptiSeen.current.tasks = optiData.tasks ?? Date.now()
        }))
      }
      await Promise.all(tasks)
    } catch (e) {
      console.warn('[geofence] refresh:', e)
    }
  }

  const active = !!myUid && !isTemp && shareLocation

  // Gestion du cache enclos+animaux : indépendante du flux GPS.
  useEffect(() => {
    if (!active) return
    notifiedMap.current = profile?.geofenceNotified ?? {}
    refreshCache()
    refreshTimer.current = setInterval(refreshCache, REFRESH_MS)
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Réception des positions partagées : pointInPolygonWithHoles + notification locale.
  const onPosition = useCallback((u: { lat: number; lng: number; accuracy: number }) => {
    if (!myUid) return
    // Position imprécise (>100 m) — ignorer, sinon on risque de notifier
    // qu'on est dans un enclos voisin.
    if (u.accuracy > MAX_ACCURACY_M) return
    const now = Date.now()
    if (now - lastCheckedAt.current < POS_CHECK_MS) return
    lastCheckedAt.current = now

    // On cherche le premier enclos qui contient le point. Les holes (zones
    // vides intérieures du land_plot) excluent la position : si on est dans
    // un trou (bout de terrain qui n'appartient pas), on n'est PAS dans l'enclos.
    const candidate = enclosuresRef.current.find(e =>
      pointInPolygonWithHoles(u.lat, u.lng, {
        outer: e.points ?? [],
        // Holes stockés en Array<{points}> côté Firestore (bug Nils 22/05) → on
        // déplie pour le helper interne qui attend Array<LatLng[]>.
        holes: (e.holes ?? []).map(h => h.points),
      }),
    )
    if (!candidate) {
      insideEnclosure.current = null
      return
    }
    // Évite de notifier 2× pour le même enclos pendant une seule présence
    if (insideEnclosure.current === candidate.id) return
    insideEnclosure.current = candidate.id

    // Animaux à vérifier : jamais checkés OU check de plus de 12 h.
    // Le candidate est un land_plot, donc son id est l'enclosureId attendu.
    const stale = animalsRef.current.filter(a =>
      a.enclosureId === candidate.id &&
      (!a.lastCheckedHealthy || now - a.lastCheckedHealthy > STALE_AFTER_MS),
    )
    if (stale.length === 0) return

    // V5 #1 anti-pollution (Nils 25/05/2026) : si une tâche active vise
    // explicitement ce parc (lien carte land_plot, due aujourd'hui ou en
    // retard), on n'ajoute pas la notif geofence par-dessus. La tâche en cours
    // est déjà la consigne ; la cocher (avec healthCheckOnComplete) déclenchera
    // de toute façon le markAllHealthy.
    if (activeTaskPlotsRef.current.has(candidate.id)) return

    // Anti-spam : 1 notif max / 6 h par enclos
    const lastNotif = notifiedMap.current[candidate.id] ?? 0
    if (now - lastNotif < RENOTIFY_MIN_MS) return
    notifiedMap.current = { ...notifiedMap.current, [candidate.id]: now }

    // Notification locale (registration.showNotification = compatible PWA).
    // Bug Eugénie 22/05/2026 : avant, `url: '/map'` faisait juste recharger
    // la carte au tap. Maintenant on passe l'id du parc → Map.tsx ouvre une
    // feuille de check rapide listant les animaux à valider.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready?.then(reg => {
        reg.showNotification('🐴 Tu es dans un enclos', {
          body: `${stale.length} animal${stale.length > 1 ? 'aux' : ''} à vérifier ici. Touche pour cocher.`,
          icon: '/icons/farm-icon-192.png',
          badge: '/icons/farm-icon-192.png',
          tag: `geofence-${candidate.id}`,
          data: { url: `/map?check=${candidate.id}` },
        } as NotificationOptions).catch(() => {})
      })
    }

    // Persiste l'anti-spam (best effort, sans bloquer)
    updateDoc(doc(db, 'users', myUid), {
      geofenceNotified: notifiedMap.current,
    }).catch(() => {})
  }, [myUid])

  useLocationCore(onPosition, undefined, active)
}
