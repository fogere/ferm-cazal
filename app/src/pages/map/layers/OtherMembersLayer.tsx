import { memo } from 'react'
import { Marker } from 'react-leaflet'
import type { UserProfile } from '../../../types'
import { makeUserLocationIcon, makePointerIcon } from '../../../services/map/pinIcons'

/* Couche mémoïsée des positions + pointeurs partagés des AUTRES membres
   (Perf Nils 02/07/2026, chantier fluidité lot 2).
   Avant : deux blocs `.map` rendus inline dans MapPage → recréés à chaque render
   (notamment le tick `now`). Isolés en `React.memo` : ne se re-render que si
   `users`, `selfUid` ou `now` changent. Comportement identique — z-order piloté
   par `zIndexOffset` (indépendant de l'ordre JSX). Soi-même (SelfLocationMarker) et
   le pointeur local restent gérés par MapPage. */
const OtherMembersLayer = memo(function OtherMembersLayer({
  users, selfUid, now,
}: {
  users: UserProfile[]
  selfUid?: string
  now: number
}) {
  return (
    <>
      {/* Positions GPS partagées des AUTRES membres (Firestore, throttlé à 90 s) */}
      {users
        .filter(u => u.uid !== selfUid && u.liveLocation && (now - (u.liveLocation.updatedAt ?? 0)) < 10 * 60_000)
        .map(u => (
          <Marker
            key={`live-${u.uid}`}
            position={[u.liveLocation!.lat, u.liveLocation!.lng]}
            icon={makeUserLocationIcon(u.color || '#2D6A4F', (u.displayName || '?').charAt(0).toUpperCase())}
            interactive={false}
            zIndexOffset={300}
          />
        ))}
      {/* Pointeurs partagés des AUTRES utilisateurs (Firestore) */}
      {users
        .filter(u => u.uid !== selfUid && u.livePointer && (now - (u.livePointer.updatedAt ?? 0)) < 60_000)
        .map(u => (
          <Marker
            key={`ptr-${u.uid}-${u.livePointer!.updatedAt}`}
            position={[u.livePointer!.lat, u.livePointer!.lng]}
            icon={makePointerIcon(u.color || '#2D6A4F', u.displayName || '?')}
            interactive={false}
            zIndexOffset={600}
          />
        ))}
    </>
  )
})

export default OtherMembersLayer
