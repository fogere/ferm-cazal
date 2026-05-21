import { useCallback, useEffect, useRef } from 'react'
import { doc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { useLocationCore } from './useLocationCore'

// Anti-spam Firestore : ~1 écriture / 90 s ET déplacement > 15 m.
// Le hook ne tourne plus globalement : il est monté uniquement par MapPage,
// donc on n'écrit qu'aux moments où la position est réellement utile
// (quelqu'un regarde la carte). Pour 3 utilisateurs ouvrant la carte
// ~20 min/jour cumulées, ça revient à quelques dizaines d'écritures/jour
// au lieu de milliers.
const MIN_INTERVAL_MS = 90_000
const MIN_DISTANCE_M  = 15
// Filet de sécurité : si la page reste ouverte (onglet en arrière-plan),
// on coupe au bout de 2 h sans toucher Firestore.
const AUTO_STOP_MS    = 2 * 60 * 60 * 1000

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

/**
 * Met à jour `users/{uid}.liveLocation` dans Firestore tant que le profil a
 * `shareLocation: true`. Throttled à 1 écriture / 90 s et seulement si la position
 * a bougé d'au moins 15 m. Auto-stop après 2 h pour limiter la conso de quota.
 *
 * Source GPS : `locationCore` (watchPosition partagé). Avant ce hook montait
 * son propre watchPosition, dupliqué avec useGeofenceAlert et
 * useOnDemandLocationPublish. Voir services/location/locationCore.ts.
 */
export function useLiveLocation() {
  const { user, profile } = useAuth()
  const shareLocation = !!profile?.shareLocation
  const hasStaleLocation = !!profile?.liveLocation
  const myUid = user?.uid

  const lastWriteRef = useRef(0)
  const lastPosRef   = useRef<{ lat: number; lng: number } | null>(null)
  const startedAtRef = useRef(0)
  const stoppedRef   = useRef(false)

  // Reset des refs internes à chaque montage/changement d'utilisateur.
  // Note : on ne les inclut PAS dans les deps de l'effet pour éviter de
  // réinitialiser les throttles à chaque écriture Firestore.
  useEffect(() => {
    if (!myUid || !shareLocation) return
    lastWriteRef.current = 0
    lastPosRef.current   = null
    startedAtRef.current = Date.now()
    stoppedRef.current   = false
  }, [myUid, shareLocation])

  // Si le partage est désactivé, nettoyer l'éventuelle position restée en base.
  useEffect(() => {
    if (!myUid) return
    if (!shareLocation && hasStaleLocation) {
      updateDoc(doc(db, 'users', myUid), { liveLocation: deleteField() }).catch(() => {})
    }
  }, [myUid, shareLocation, hasStaleLocation])

  const onPosition = useCallback((u: { lat: number; lng: number; accuracy: number; timestamp: number }) => {
    if (!myUid || stoppedRef.current) return

    // Auto-stop après 2 h : on désactive le partage en base et on arrête
    if (Date.now() - startedAtRef.current > AUTO_STOP_MS) {
      stoppedRef.current = true
      updateDoc(doc(db, 'users', myUid), {
        shareLocation: false,
        liveLocation:  deleteField(),
      }).catch(() => {})
      return
    }

    const now    = Date.now()
    const newPos = { lat: u.lat, lng: u.lng }
    if (lastPosRef.current && haversineMeters(lastPosRef.current, newPos) < MIN_DISTANCE_M) return
    if (now - lastWriteRef.current < MIN_INTERVAL_MS) return
    lastWriteRef.current = now
    lastPosRef.current   = newPos
    updateDoc(doc(db, 'users', myUid), {
      liveLocation: {
        lat:       newPos.lat,
        lng:       newPos.lng,
        accuracy:  Math.round(u.accuracy),
        updatedAt: now,
      },
    }).catch(() => {})
  }, [myUid])

  useLocationCore(onPosition, undefined, !!myUid && shareLocation)
}
