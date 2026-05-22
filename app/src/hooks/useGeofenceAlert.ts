import { useCallback, useEffect, useRef } from 'react'
import {
  collection, doc, getDocs, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { pointInPolygonWithHoles } from '../services/map/polygon'
import { useLocationCore } from './useLocationCore'
import type { Animal, MapPin } from '../types'

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
const REFRESH_MS      = 5  * 60 * 1000      // refresh cache enclos/animaux toutes les 5 min
const POS_CHECK_MS    = 60_000              // throttle des checks de position : 1× / minute

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
  const lastCheckedAt = useRef(0)
  const refreshTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const insideEnclosure = useRef<string | null>(null)
  const notifiedMap   = useRef<Record<string, number>>({})

  // Charge / rafraîchit les enclos candidats au geofence + les animaux du cheptel.
  // Candidats = land_plots valides actifs uniquement (S9 : plus de fallback fence).
  async function refreshCache() {
    try {
      const [pinsSnap, animalsSnap] = await Promise.all([
        getDocs(collection(db, 'map_pins')),
        getDocs(collection(db, 'animals')),
      ])
      const allPins = pinsSnap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))
      enclosuresRef.current = allPins.filter(isValidLandPlot)
      animalsRef.current = animalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Animal))
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
  const onPosition = useCallback((u: { lat: number; lng: number }) => {
    if (!myUid) return
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
