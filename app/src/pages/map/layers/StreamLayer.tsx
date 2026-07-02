import { memo } from 'react'
import { Polyline } from 'react-leaflet'
import type { MapPin } from '../../../types'
import { getStreamSegments } from '../../../services/map/stream-visual'

/* Couche mémoïsée des cours d'eau (Perf Nils 02/07/2026, chantier fluidité lot 2).
   Avant : rendue inline dans MapPage → `getStreamSegments` recalculé à CHAQUE render
   (tick GPS, ouverture de panneau, frappe…). Isolée en `React.memo` : ne se
   recalcule que si `pins` ou `anyModeActive` changent. Comportement identique :
   trait de hitbox invisible (sélection au tap) + segments visuels non-interactifs.
   La visibilité par catégorie (`isCatHidden('water')`) reste gérée par MapPage. */
const StreamLayer = memo(function StreamLayer({
  pins, anyModeActive, onSelect,
}: {
  pins: MapPin[]
  anyModeActive: boolean
  onSelect: (pin: MapPin) => void
}) {
  const month1to12 = new Date().getMonth() + 1
  return (
    <>
      {pins
        .filter(p => p.type === 'water_stream' && (p.points?.length ?? 0) >= 2)
        .flatMap(pin => {
          const segments = getStreamSegments(pin, month1to12)
          // Bug Nils 22/05/2026 : hitbox élargie pour la sélection — un trait
          // invisible (opacity 0) plus épais doublé du trait visuel donne au doigt
          // une cible facile à toucher sur mobile. Le visuel garde son weight d'origine.
          const allPositions = (pin.points ?? []).map(p => [p.lat, p.lng] as [number, number])
          return [
            <Polyline
              key={`${pin.id}-hit`}
              positions={allPositions}
              pathOptions={{ color: '#000', weight: 22, opacity: 0 }}
              eventHandlers={{
                click: () => { if (!anyModeActive) onSelect(pin) },
              }}
            />,
            ...segments.map(seg => (
              <Polyline
                key={`${pin.id}-seg-${seg.fromIndex}`}
                positions={[[seg.a.lat, seg.a.lng], [seg.b.lat, seg.b.lng]] as Array<[number, number]>}
                pathOptions={{
                  color:     seg.color,
                  weight:    seg.weight,
                  opacity:   seg.opacity,
                  dashArray: seg.dashArray,
                }}
                interactive={false}
              />
            )),
          ]
        })}
    </>
  )
})

export default StreamLayer
