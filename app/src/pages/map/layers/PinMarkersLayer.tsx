import { memo } from 'react'
import { Marker } from 'react-leaflet'
import type { MapPin } from '../../../types'
import { makeDivIcon, isSeasonalDry, TYPE_TO_CAT, LABEL_ZOOM_LOW } from '../../../services/map/pinIcons'

/* Couche mémoïsée des épingles (Perf Nils 02/07/2026, chantier fluidité).
   Avant : le bloc de <Marker> des pins était rendu inline dans MapPage → recréé à
   CHAQUE render du composant (94 useState → beaucoup de renders : ouverture de
   panneau, frappe dans un formulaire, tick GPS…). Isolé ici en `React.memo` : la
   couche ne se re-render QUE si ses props changent (pins visibles, zoom, retards,
   filtre catégorie). Un tick GPS ou l'ouverture d'un panneau ne recrée plus les
   markers. Markers non-interactifs (sélection via hit-test au niveau carte) → aucun
   handler à faire transiter, extraction behavior-preserving stricte. */
const PinMarkersLayer = memo(function PinMarkersLayer({
  pins, mapZoom, overduePins, hiddenCats,
}: {
  pins: MapPin[]
  mapZoom: number
  overduePins: Set<string>
  hiddenCats: Set<string>
}) {
  const month0 = new Date().getMonth()
  return (
    <>
      {pins
        .filter(pin => {
          // Filtre d'affichage par catégorie (Nils 03/06/2026) — masque toute la
          // famille même les pins "toujours visibles" ci-dessous.
          const cat = TYPE_TO_CAT[pin.type]
          if (cat && hiddenCats.has(cat)) return false
          if (mapZoom >= LABEL_ZOOM_LOW) return true
          // Pins toujours visibles : alertes + tâches à faire en cours + batteries
          // en panne (utile en vue dézoom pour repérer rapidement).
          if (pin.type === 'alert') return true
          if (pin.type === 'todo' && pin.todoStatus !== 'done') return true
          if (pin.type === 'battery' && (pin.batteryStatus === 'down' || pin.batteryStatus === 'critical')) return true
          // Eau en retard reste visible (cas critique, visible même de loin).
          if ((pin.type === 'water_manual' || pin.type === 'water_natural') && overduePins.has(pin.id)) return true
          return false
        })
        .map(pin => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makeDivIcon(pin.type, overduePins.has(pin.id), (pin.photoCount ?? 0) > 0, pin.waterStatus, pin.todoStatus === 'done', pin.type === 'battery' && pin.powerOn === false, isSeasonalDry(pin, month0), pin.customEmoji, pin.customColor)}
            interactive={false}
          />
        ))}
    </>
  )
})

export default PinMarkersLayer
