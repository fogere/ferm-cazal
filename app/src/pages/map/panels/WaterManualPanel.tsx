// Panneau d'édition d'un point d'eau manuel (water_manual).
// Extrait de Map.tsx lors de la refacto S1. Behavior-preserving strict.
//
// Affiche :
//  - badge échéance (en retard ou à venir)
//  - dernier remplissage / intervalle / rappel
//  - bouton "Remplir maintenant 💧" qui appelle onFill

import { Droplets } from 'lucide-react'
import type { MapPin } from '../../../types'
import { timeAgo, timeUntil } from '../../../services/map/time'
import { isWaterOverdue } from '../../../services/map/water'
import { DetailRow } from './shared'

interface Props {
  pin:         MapPin
  actionBusy:  boolean
  onFill:      (pin: MapPin) => void | Promise<void>
}

export function WaterManualPanel({ pin, actionBusy, onFill }: Props) {
  const overdue = isWaterOverdue(pin)
  return (
    <div className="mb-4 space-y-3">
      <div className={`rounded-xl p-3 flex items-center gap-3 ${
        overdue ? 'bg-danger/10 border border-danger/20' : 'bg-sky/5 border border-sky/20'
      }`}>
        <Droplets size={20} className={overdue ? 'text-danger' : 'text-sky'} />
        <div>
          <p className="text-xs font-semibold text-charcoal">
            {overdue ? '⚠ Échéance dépassée !' : 'Prochaine échéance'}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {pin.dueAt
              ? overdue ? `Dépassée ${timeAgo(pin.dueAt)}` : timeUntil(pin.dueAt)
              : pin.nextReminderAt ? timeUntil(pin.nextReminderAt) : 'Non planifié'
            }
          </p>
        </div>
      </div>
      <DetailRow label="Dernier remplissage" value={pin.lastFilled ? timeAgo(pin.lastFilled) : 'Jamais'} />
      <DetailRow label="Intervalle" value={`Toutes les ${pin.intervalHours ?? 24}h`} />
      {pin.alertBeforeHours && (
        <DetailRow label="Rappel" value={`${pin.alertBeforeHours}h avant`} />
      )}
      <button onClick={() => onFill(pin)} disabled={actionBusy}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl
                   bg-sky text-white font-bold text-base shadow-lg
                   active:scale-95 disabled:opacity-50 transition-all">
        <Droplets size={20} />
        {actionBusy ? 'Enregistrement…' : 'Remplir maintenant 💧'}
      </button>
    </div>
  )
}
