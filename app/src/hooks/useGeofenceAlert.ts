import { useCallback, useEffect, useRef } from 'react'
import {
  collection, doc, getDocs, query, where, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { pointInPolygon } from '../services/map/geometry'
import { effectiveEnclosureId } from '../services/map/enclosure'
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
 */

const STALE_AFTER_MS  = 12 * 60 * 60 * 1000 // 12 h sans check → animal "à vérifier"
const RENOTIFY_MIN_MS = 6  * 60 * 60 * 1000 // anti-spam : 6 h entre 2 notifs pour le même enclos
const REFRESH_MS      = 5  * 60 * 1000      // refresh cache enclos/animaux toutes les 5 min
const POS_CHECK_MS    = 60_000              // throttle des checks de position : 1× / minute

function isClosedFence(pin: MapPin): boolean {
  if (pin.type !== 'fence') return false
  if (!pin.points || pin.points.length < 3) return false
  const a = pin.points[0]
  const b = pin.points[pin.points.length - 1]
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9
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

  // Charge / rafraîchit les enclos fermés + les animaux du cheptel
  async function refreshCache() {
    try {
      const [pinsSnap, animalsSnap] = await Promise.all([
        getDocs(query(collection(db, 'map_pins'), where('type', '==', 'fence'))),
        getDocs(collection(db, 'animals')),
      ])
      enclosuresRef.current = pinsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as MapPin))
        .filter(isClosedFence)
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

  // Réception des positions partagées : pointInPolygon + notification locale.
  const onPosition = useCallback((u: { lat: number; lng: number }) => {
    if (!myUid) return
    const now = Date.now()
    if (now - lastCheckedAt.current < POS_CHECK_MS) return
    lastCheckedAt.current = now

    const candidate = enclosuresRef.current.find(e =>
      pointInPolygon(u.lat, u.lng, e.points ?? []),
    )
    if (!candidate) {
      insideEnclosure.current = null
      return
    }
    // Évite de notifier 2× pour le même enclos pendant une seule présence
    if (insideEnclosure.current === candidate.id) return
    insideEnclosure.current = candidate.id

    // Animaux à vérifier : jamais checkés OU check de plus de 12 h.
    // S2.5 : après migration fence → land_plot, animal.enclosureId pointe vers
    // le land_plot.id. effectiveEnclosureId(candidate) résout le bon id.
    const encId = effectiveEnclosureId(candidate)
    const stale = animalsRef.current.filter(a =>
      a.enclosureId === encId &&
      (!a.lastCheckedHealthy || now - a.lastCheckedHealthy > STALE_AFTER_MS),
    )
    if (stale.length === 0) return

    // Anti-spam : 1 notif max / 6 h par enclos
    const lastNotif = notifiedMap.current[candidate.id] ?? 0
    if (now - lastNotif < RENOTIFY_MIN_MS) return
    notifiedMap.current = { ...notifiedMap.current, [candidate.id]: now }

    // Notification locale (registration.showNotification = compatible PWA)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready?.then(reg => {
        reg.showNotification('🐴 Tu es dans un enclos', {
          body: `${stale.length} animal${stale.length > 1 ? 'aux' : ''} à vérifier ici. Touche pour ouvrir la carte.`,
          icon: '/icons/farm-icon-192.png',
          badge: '/icons/farm-icon-192.png',
          tag: `geofence-${candidate.id}`,
          data: { url: '/map' },
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
