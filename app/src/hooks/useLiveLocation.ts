import { useEffect } from 'react'
import { doc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'

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
 * IMPORTANT — les deps n'incluent PAS `profile.liveLocation` : chaque écriture
 * déclenche un snapshot du profil, et inclure liveLocation re-monterait l'effet
 * (clearWatch + watchPosition), ce qui réinitialise les throttles internes.
 */
export function useLiveLocation() {
  const { user, profile } = useAuth()
  const shareLocation = !!profile?.shareLocation
  const hasStaleLocation = !!profile?.liveLocation

  useEffect(() => {
    if (!user) return
    if (!('geolocation' in navigator)) return

    // Si le partage est désactivé, on efface la position si elle traîne encore
    if (!shareLocation) {
      if (hasStaleLocation) {
        updateDoc(doc(db, 'users', user.uid), { liveLocation: deleteField() }).catch(() => {})
      }
      return
    }

    let lastWrite = 0
    let lastPos: { lat: number; lng: number } | null = null
    const startedAt = Date.now()
    let stopped = false

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        if (stopped) return

        // Auto-stop après 2 h : on désactive le partage en base et on arrête
        if (Date.now() - startedAt > AUTO_STOP_MS) {
          stopped = true
          updateDoc(doc(db, 'users', user.uid), {
            shareLocation: false,
            liveLocation:  deleteField(),
          }).catch(() => {})
          return
        }

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
      // enableHighAccuracy: true — bug Eugénie 21/05/2026 "500 m de rayon aléatoire".
      // `false` faisait du Wifi/Cell positioning (50-500 m). `true` force le GPS satellite
      // (5-20 m typique en outdoor). Coût batterie acceptable : partage auto-stop à 2 h.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 }
    )

    return () => {
      stopped = true
      navigator.geolocation.clearWatch(watchId)
    }
    // Important : on ne dépend QUE de l'état du partage, pas de la dernière position
    // (sinon chaque écriture re-monte l'effet et casse les throttles internes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, shareLocation])
}
