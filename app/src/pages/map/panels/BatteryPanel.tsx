// Panneau d'édition d'un pin batterie.
// Extrait de Map.tsx lors de la refacto S1. Behavior-preserving strict.
//
// Affiche :
//  - badge statut batterie (good / warning / critical / replace / down)
//  - dernière vérification, prochaine vérification, intervalle, zone couverte
//  - grille 3x2 pour changer le statut (sauf temp)
//  - bouton "J'ai vérifié ✓" (re-bump la date)
//  - bouton ON/OFF (cascade sur les clôtures connectées — bug Nils 21/05)

import { Zap, Check } from 'lucide-react'
import type { MapPin } from '../../../types'
import { timeAgo, timeUntil } from '../../../services/map/time'
import { isBatteryDue } from '../../../services/map/battery'
import { DetailRow, BATTERY_STATUS_CFG } from './shared'

interface Props {
  pin:        MapPin
  isTemp:     boolean
  actionBusy: boolean
  /** Nombre de clôtures `connectedBatteryId === pin.id` (affiché sur le bouton OFF). */
  connectedFenceCount: number
  onSetStatus:  (pin: MapPin, status: string) => void | Promise<void>
  onCheck:      (pin: MapPin) => void | Promise<void>
  onTogglePower: (pin: MapPin) => void | Promise<void>
}

export function BatteryPanel({
  pin, isTemp, actionBusy, connectedFenceCount, onSetStatus, onCheck, onTogglePower,
}: Props) {
  const isOff = pin.powerOn === false
  return (
    <div className="mb-4 space-y-3">
      {pin.batteryStatus && (() => {
        const cfg = BATTERY_STATUS_CFG[pin.batteryStatus as keyof typeof BATTERY_STATUS_CFG]
        return cfg ? (
          <div className={`rounded-xl p-3 border ${cfg.bg} flex items-center gap-2`}>
            <Zap size={18} className={cfg.color} />
            <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
            {isBatteryDue(pin) && (
              <span className="ml-auto text-xs text-danger font-semibold">Vérification due !</span>
            )}
          </div>
        ) : null
      })()}
      <DetailRow label="Dernière vérif." value={pin.lastChecked ? timeAgo(pin.lastChecked) : 'Jamais'} />
      {pin.nextCheckAt && (
        <DetailRow
          label="Prochaine vérif."
          value={isBatteryDue(pin) ? `Dépassée ${timeAgo(pin.nextCheckAt)}` : timeUntil(pin.nextCheckAt)}
        />
      )}
      {pin.zoneCovered && <DetailRow label="Zone couverte" value={pin.zoneCovered} />}
      <DetailRow label="Intervalle vérif." value={`Tous les ${pin.checkIntervalDays ?? 7} jours`} />
      <p className="text-xs font-semibold text-muted uppercase tracking-wider pt-1">Statut de la batterie</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(Object.entries(BATTERY_STATUS_CFG) as [string, { label: string; color: string }][]).map(([k, v]) => (
          <button key={k}
            onClick={() => onSetStatus(pin, k)}
            disabled={actionBusy}
            className={`py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
              pin.batteryStatus === k
                ? `border-forest bg-forest/10 ${v.color}`
                : 'border-border text-muted bg-cream'
            }`}>{v.label}</button>
        ))}
      </div>
      <button onClick={() => onCheck(pin)} disabled={actionBusy}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl
                   bg-sun/90 text-charcoal font-bold text-sm shadow
                   active:scale-95 disabled:opacity-50 transition-all">
        <Check size={18} />
        {actionBusy ? 'Enregistrement…' : "J'ai vérifié ✓"}
      </button>

      {/* Bouton ON/OFF — demande Nils 21/05/2026 */}
      {!isTemp && (
        <button
          onClick={() => onTogglePower(pin)}
          disabled={actionBusy}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl
                      font-bold text-sm shadow active:scale-95 transition-all disabled:opacity-50 ${
            isOff
              ? 'bg-meadow text-white'
              : 'bg-danger/10 border-2 border-danger/40 text-danger'
          }`}
        >
          {isOff
            ? <>⚡ Rallumer la batterie</>
            : <>⊘ Éteindre la batterie {connectedFenceCount > 0 && <span className="text-[10px] font-normal opacity-90">({connectedFenceCount} clôture{connectedFenceCount > 1 ? 's' : ''})</span>}</>}
        </button>
      )}
    </div>
  )
}
