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
  /** Active le mode "+ Zone vide intérieure" pour ce land_plot (S4.6). */
  onStartAddHole?:        (plot: MapPin) => void
  /** Supprime un hole par son index (0-based). */
  onDeleteHole?:          (plot: MapPin, holeIndex: number) => void | Promise<void>
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

      {/* Zones vides intérieures (S4.6) — bouts de terrain qui ne nous
          appartiennent pas au milieu de l'espace. Bug Eugénie 21/05 tip n°2. */}
      {!props.isTemp && (
        <div className="rounded-xl p-3 bg-cream border border-border/40 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">
            Zones vides intérieures ({holes.length})
          </p>
          {holes.length > 0 && props.onDeleteHole && (
            <ul className="space-y-1">
              {holes.map((h, i) => (
                <li key={i} className="flex items-center justify-between text-xs bg-white border border-border/40 rounded-lg px-2 py-1.5">
                  <span className="text-charcoal">
                    Zone {i + 1} · {h.length} points
                  </span>
                  <button
                    onClick={() => props.onDeleteHole?.(pin, i)}
                    disabled={props.actionBusy}
                    className="text-[10px] font-semibold text-danger bg-danger/5 border border-danger/30 px-2 py-0.5 rounded active:bg-danger/10 disabled:opacity-40"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
          {props.onStartAddHole && isEnclosed && (
            <button
              onClick={() => props.onStartAddHole?.(pin)}
              disabled={props.actionBusy}
              className="w-full py-2 rounded-lg border-2 border-dashed border-orange-500/40 text-orange-700 text-xs font-bold active:bg-orange-500/10 disabled:opacity-40"
            >
              + Ajouter une zone vide
            </button>
          )}
          <p className="text-[10px] text-muted/80 leading-tight">
            Une zone vide retire ce bout de terrain de la surface de l'espace
            et empêche le geofence d'y déclencher.
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
