// Panneau d'édition d'un land_plot (espace défini).
// Refonte clôtures/espaces, S4.4 du plan. Demande Eugénie 21/05/2026.
//
// Un land_plot représente un terrain qui appartient à la ferme : c'est lui qui
// porte le rôle d'"enclos" (placement animaux, suivi pâturage, geofence). Les
// clôtures physiques (fence) qui entourent peuvent être posées/retirées/déplacées
// sans casser ce placement.
//
// Affiche :
//  - header (nom, surface, nb points, nb zones vides)
//  - placement des animaux (via EnclosurePlacementPanel réutilisé)
//  - section "zones vides intérieures" — UI complète à venir en S4.5
//
// Behavior-preserving : aucun comportement existant changé, c'est un panel
// 100% nouveau qui s'affiche uniquement quand pin.type === 'land_plot'.

import type { Animal, EnclosureMovement, MapPin, UserProfile, CustomSpecies } from '../../../types'
import { polygonAreaSquareMeters, formatArea } from '../../../services/map/polygon'
import { DetailRow } from './shared'
import { EnclosurePlacementPanel } from './EnclosurePlacementPanel'

interface Props {
  pin:             MapPin
  isTemp:          boolean
  actionBusy:      boolean
  savingHealth:    boolean
  user:            { uid: string } | null
  animals:         Animal[]
  users:           UserProfile[]
  customSpecies:   CustomSpecies[]
  enclosureHistory: EnclosureMovement[]
  historyVisible:  boolean
  setHistoryVisible: (v: boolean | ((prev: boolean) => boolean)) => void

  editEnclosureAnimals:     boolean
  setEditEnclosureAnimals:  (v: boolean) => void
  pendingEnclosureAnimals:  string[]
  setPendingEnclosureAnimals: (next: string[] | ((prev: string[]) => string[])) => void
  pendingMoveDate:          string
  setPendingMoveDate:       (v: string) => void
  pendingMoveNote:          string
  setPendingMoveNote:       (v: string) => void

  onMarkAllHealthy:       (list: Animal[]) => void | Promise<void>
  onSaveEnclosureAnimals: (plotId: string) => void | Promise<void>
  onSetRotation:          (pin: MapPin, days: number | null) => void | Promise<void>
}

export function LandPlotPanel(props: Props) {
  const { pin } = props
  const points = pin.points ?? []
  const holes  = pin.holes  ?? []
  const isEnclosed = points.length >= 3
  const areaM2 = isEnclosed ? polygonAreaSquareMeters({ outer: points, holes }) : 0

  return (
    <div className="mb-4 space-y-3">
      {/* Header — meta de l'espace */}
      <div className="rounded-xl p-3 bg-meadow/5 border border-meadow/30 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-base">⛰</span>
          <p className="text-sm font-bold text-meadow">Espace défini</p>
        </div>
        <DetailRow label="Contour" value={`${points.length} points`} />
        {isEnclosed && <DetailRow label="Surface" value={formatArea(areaM2)} />}
        {holes.length > 0 && (
          <DetailRow label="Zones vides" value={`${holes.length}`} />
        )}
      </div>

      {/* Section placement animaux — réutilise EnclosurePlacementPanel.
          isEnclosed = (points >= 3), toujours true pour un land_plot valide. */}
      <EnclosurePlacementPanel
        {...props}
        isEnclosed={isEnclosed}
      />

      {/* Zones vides intérieures — UI dédiée à venir en S4.5.
          Pour l'instant on indique juste si l'espace en a, sans permettre l'édition. */}
      {props.isTemp ? null : (
        <div className="rounded-xl p-3 bg-cream border border-border/40">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Zones vides intérieures
          </p>
          <p className="text-[11px] text-muted leading-snug">
            {holes.length === 0
              ? "Aucune zone vide. L'outil pour en ajouter (bouts de terrain qui ne vous appartiennent pas au milieu d'un espace) arrivera dans une prochaine mise à jour."
              : `Cet espace contient ${holes.length} zone${holes.length > 1 ? 's' : ''} vide${holes.length > 1 ? 's' : ''}. L'outil d'édition arrivera dans une prochaine mise à jour.`}
          </p>
        </div>
      )}

      {pin.note && (
        <div className="bg-cream rounded-xl p-3 border border-border">
          <p className="text-charcoal text-sm">{pin.note}</p>
        </div>
      )}
    </div>
  )
}
