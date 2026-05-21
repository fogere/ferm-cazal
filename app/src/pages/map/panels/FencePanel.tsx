// Panneau d'édition d'une clôture (partie config — preset, fils, batterie,
// intensité, tracé). Le sous-bloc "Animaux dans l'enclos" + "Historique des
// mouvements" reste inline dans Map.tsx pour la session S1 ; il sera extrait
// dans son propre composant à la session S1.5 (EnclosurePlacementPanel).
//
// Extrait de Map.tsx lors de la refacto S1. Behavior-preserving strict.

import { Pencil, Undo2 } from 'lucide-react'
import type { MapPin, FencePreset } from '../../../types'
import { isFenceClosed } from '../../../services/map/geometry'

type IntensityLevel = 'full' | 'attenuated' | 'off'

interface Props {
  pin:         MapPin
  preset:      FencePreset | undefined
  isTemp:      boolean
  actionBusy:  boolean
  /** Liste des pins type='battery' à afficher dans le select "Reliée à une batterie". */
  batteryPins: MapPin[]
  onUpdateWireCount: (pin: MapPin, delta: number) => void | Promise<void>
  onUpdateVoltage:   (pin: MapPin, voltage: number | null) => void | Promise<void>
  onSetBattery:      (pin: MapPin, batteryId: string | null) => void | Promise<void>
  onSetIntensity:    (pin: MapPin, level: IntensityLevel) => void | Promise<void>
  onStartEditFence:  (pin: MapPin) => void
  onRestoreSingleWire: (pin: MapPin) => void | Promise<void>
  /**
   * Si fourni ET pin.migratedToPlotId existe, affiche un bouton "→ Voir
   * l'espace défini" qui ouvre le land_plot jumeau (refonte S3+).
   * Le callback est appelé sans argument ; le parent résout le land_plot
   * via pins.find(p => p.id === pin.migratedToPlotId).
   */
  onShowLinkedPlot?: () => void
}

export function FencePanel({
  pin, preset, isTemp, actionBusy, batteryPins,
  onUpdateWireCount, onUpdateVoltage, onSetBattery, onSetIntensity,
  onStartEditFence, onRestoreSingleWire, onShowLinkedPlot,
}: Props) {
  const presetColor = pin.presetColor ?? '#EA580C'
  const wireCount = pin.wireCount ?? 1
  const isElectric = preset?.wireStyle === 'electric'
  const intensity: IntensityLevel = pin.electricityIntensity ?? 'full'
  const intensityOptions: Array<[IntensityLevel, string, string]> = [
    ['full',       '⚡ Plein',     'Courant pleine puissance'],
    ['attenuated', '⚡ Atténué',   'Courant faible (fin de circuit)'],
    ['off',        '⊘ Coupé',      'Pas de courant (débranché)'],
  ]

  return (
    <>
      {/* Lien vers l'espace défini jumeau (refonte clôtures/espaces S3+).
          Affiché en tête pour signaler que ce fence a un land_plot porteur du
          rôle d'enclos — Eugénie peut y accéder pour placer les animaux. */}
      {pin.migratedToPlotId && onShowLinkedPlot && (
        <button
          onClick={onShowLinkedPlot}
          className="w-full flex items-center justify-between gap-2 py-3 px-4 rounded-2xl
                     bg-meadow/10 border-2 border-meadow/40 text-meadow font-bold
                     active:scale-95 transition-all"
        >
          <span className="text-sm flex items-center gap-2">
            <span className="text-base">⛰</span>
            Voir l'espace défini
          </span>
          <span className="text-base">→</span>
        </button>
      )}

      {/* Badge preset */}
      <div className="rounded-xl p-3 flex items-center gap-3"
           style={{
             background: presetColor + '20',
             border: `1px solid ${presetColor}40`,
           }}>
        <div className="w-4 h-4 rounded-full flex-shrink-0"
             style={{ background: presetColor }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate"
             style={{ color: presetColor }}>
            {preset?.name ?? 'Clôture'}
          </p>
          {preset?.description && (
            <p className="text-xs text-muted truncate">{preset.description}</p>
          )}
        </div>
      </div>

      {/* Compteur de fils */}
      <div className="rounded-xl p-3 bg-cream border border-border">
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Fils électriques</p>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => onUpdateWireCount(pin, -1)}
            disabled={actionBusy || wireCount <= 1}
            className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 font-bold text-xl
                       flex items-center justify-center active:scale-95 disabled:opacity-30 transition-all">
            −
          </button>
          <div className="flex-1 text-center">
            <span className="text-3xl font-bold text-charcoal">{wireCount}</span>
            <span className="text-sm text-muted ml-1">
              fil{wireCount > 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={() => onUpdateWireCount(pin, 1)}
            disabled={actionBusy || wireCount >= 8}
            className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 font-bold text-xl
                       flex items-center justify-center active:scale-95 disabled:opacity-30 transition-all">
            +
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            key={`volt-${pin.id}`}
            type="number"
            placeholder="Tension (ex : 6000)"
            defaultValue={pin.wireVoltage ?? ''}
            onBlur={e => {
              const v = e.target.value ? Number(e.target.value) : null
              if (v !== (pin.wireVoltage ?? null)) onUpdateVoltage(pin, v)
            }}
            className="flex-1 px-3 py-2 rounded-xl border border-border bg-white text-sm text-charcoal
                       placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <span className="text-xs text-muted font-semibold">V</span>
        </div>
      </div>

      {/* Connexion à une batterie — clôtures électriques uniquement.
          Bug Nils 21/05/2026 : circuit visible/invisible selon état batterie. */}
      {isElectric && batteryPins.length > 0 && (
        <div className="rounded-xl p-3 bg-cream border border-border">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
            Reliée à une batterie
          </p>
          <select
            value={pin.connectedBatteryId ?? ''}
            onChange={e => onSetBattery(pin, e.target.value || null)}
            disabled={isTemp || actionBusy}
            className="w-full px-3 py-2 rounded-lg border border-border bg-white text-xs text-charcoal"
          >
            <option value="">— Aucune —</option>
            {batteryPins.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} {b.powerOn === false ? '(éteinte)' : ''}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted/80 mt-1.5 leading-tight">
            Si la batterie est éteinte, cette clôture s'affiche automatiquement
            comme coupée (grisée).
          </p>
        </div>
      )}

      {/* Intensité du courant — clôtures électriques uniquement.
          Bug Nils 21/05/2026 : indiquer visuellement la baisse d'intensité. */}
      {isElectric && (
        <div className="rounded-xl p-3 bg-cream border border-border">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
            Intensité du courant
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {intensityOptions.map(([k, label, hint]) => (
              <button
                key={k}
                onClick={() => !isTemp && onSetIntensity(pin, k)}
                disabled={isTemp || actionBusy}
                title={hint}
                className={`py-2 rounded-lg border text-[11px] font-bold transition-all ${
                  intensity === k
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : 'border-border bg-card text-muted'
                } disabled:opacity-40`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted/80 mt-1.5 leading-tight">
            Visuel sur la carte : trait plein, pointillé moyen, ou pointillé gris/dispersé.
          </p>
        </div>
      )}

      {/* Infos tracé */}
      <div className="rounded-xl p-3 bg-orange-500/10 border border-orange-500/20 flex items-center gap-2">
        <Pencil size={16} className="text-orange-600" />
        <span className="text-sm font-semibold text-orange-700">
          {pin.points?.length ?? 0} points ·{' '}
          {isFenceClosed(pin) ? '🏠 Enclos fermé' : 'Clôture ouverte'}
          {pin.cutFromId && ' · ✂ segment'}
          {pin.fillOnly && ' · ✂ découpé'}
        </span>
      </div>

      {/* Bouton : passer en mode édition du tracé (drag des poteaux) */}
      {!isTemp && (
        <button
          onClick={() => onStartEditFence(pin)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                     bg-forest/10 border border-forest/30 text-forest text-sm font-bold
                     active:bg-forest/20 transition-colors"
        >
          <Pencil size={14} /> Modifier le tracé (drag des poteaux)
        </button>
      )}

      {/* Bouton restaurer fil unique (uniquement pour enclos découpé) */}
      {pin.fillOnly && isFenceClosed(pin) && (
        <button
          onClick={() => onRestoreSingleWire(pin)}
          disabled={actionBusy}
          className="w-full py-3 rounded-xl border-2 border-orange-400 text-orange-700 bg-orange-50
                     text-sm font-bold active:scale-95 disabled:opacity-50 transition-all
                     flex items-center justify-center gap-2"
        >
          <Undo2 size={15} />
          {actionBusy ? 'Restauration…' : 'Restaurer fil unique (supprime les coupes)'}
        </button>
      )}
    </>
  )
}
