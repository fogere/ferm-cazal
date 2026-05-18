import { useEffect } from 'react'
import { doc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'

// Anti-spam Firestore : 1 écriture max par 30s ET déplacement > 8m
const MIN_INTERVAL_MS = 30_000
const MIN_DISTANCE_M  = 8

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
 * `shareLocation: true`. Throttled à 1 écriture / 30 s et seulement si la position
 * a bougé d'au moins 8 m.
 */
export function useLiveLocation() {
  const { user, profile } = useAuth()

  useEffect(() => {
    if (!user) return
    if (!('geolocation' in navigator)) return

    // Si le partage est désactivé, on efface la position et on ne surveille rien
    if (!profile?.shareLocation) {
      if (profile?.liveLocation) {
        updateDoc(doc(db, 'users', user.uid), { liveLocation: deleteField() }).catch(() => {})
      }
      return
    }

    let lastWrite = 0
    let lastPos: { lat: number; lng: number } | null = null

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const now    = Date.now()
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (lastPos && haversineMeters(lastPos, newPos) < MIN_DISTANCE_M) return
        if (now - lastWrite < MIN_INTERVAL_MS) return
        lastWrite = now
        lastPos   = newPos
        updateDoc(doc(db, 'users', user.uid), {
          liveLocation: {
            lat:       newPos.lat,
            lng:       newPos.lng,
            accuracy:  Math.round(pos.coords.accuracy),
            updatedAt: now,
          },
        }).catch(() => {})
      },
      err => console.warn('[geo]', err.message),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [user, profile?.shareLocation, profile?.liveLocation])
}
