// Panneau d'édition d'un cours d'eau (water_stream).
// Extrait de Map.tsx lors de la refacto S1 du plan refonte clôtures/espaces.
// Behavior-preserving strict.
//
// Affiche :
//  - infos du tracé (nb points, saisonnalité, mois actifs)
//  - liste des atténuations existantes avec slider, boutons modifier/supprimer
//  - formulaire d'ajout/modification d'une atténuation
//  - bouton "+ Marquer une atténuation"

import { useState } from 'react'
import type { MapPin } from '../../../types'
import { DetailRow } from './shared'

// Copié à l'identique de Map.tsx pour rester behavior-preserving en S1.
// ⚠ Bug existant : ce tableau est indexé 0-11 alors que streamActiveMonths
// stocke 1-12 → MONTHS_FR[m] est décalé de 1. À fixer hors S1.
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc']

function newId(): string {
  return (crypto.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

interface Props {
  pin:        MapPin
  isTemp:     boolean
  actionBusy: boolean
  /** Persiste un changement sur le pin et met à jour `selected` côté parent. */
  onPatchAttenuations: (next: NonNullable<MapPin['streamAttenuations']> | undefined) => void | Promise<void>
  /** Active le mode édition du tracé (drag/insert/delete des points). S6. */
  onStartEditTrace?: (pin: MapPin) => void
}

export function WaterStreamPanel({ pin, isTemp, actionBusy, onPatchAttenuations, onStartEditTrace }: Props) {
  const points = pin.points ?? []
  const attenuations = pin.streamAttenuations ?? []
  const isSeasonal = pin.streamMode === 'seasonal'
  const months = pin.streamActiveMonths ?? []
  const fmtRatio = (r: number) => `${Math.round(r * 100)}%`

  const [form, setForm] = useState<{
    open:      boolean
    from:      number
    to:        number
    ratio:     number
    editingId: string | null
  }>({ open: false, from: 0, to: 1, ratio: 0.1, editingId: null })

  return (
    <div className="mb-4 space-y-3">
      {/* Bouton édition du tracé — S6 édition unifiée */}
      {!isTemp && onStartEditTrace && points.length >= 2 && (
        <button
          onClick={() => onStartEditTrace(pin)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                     bg-sky/10 border border-sky/30 text-sky text-sm font-bold
                     active:bg-sky/20 transition-colors"
        >
          ✏️ Modifier le tracé (drag, ajouter, supprimer)
        </button>
      )}

      <DetailRow
        label="Tracé"
        value={`${points.length} points · ${isSeasonal ? 'Saisonnier' : 'Permanent'}`}
      />
      {isSeasonal && months.length > 0 && (
        <DetailRow label="Mois actifs" value={months.map(m => MONTHS_FR[m]).join(', ')} />
      )}

      {/* Liste des atténuations existantes */}
      {attenuations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider pt-1">
            Atténuations ({attenuations.length})
          </p>
          {attenuations.map(att => (
            <div key={att.id} className="rounded-xl p-3 bg-cream border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-charcoal font-medium">
                  Point {att.from + 1} → Point {att.to + 1}
                </span>
                <span className="text-xs font-bold text-sky">
                  Débit {fmtRatio(att.ratio)}
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky"
                  style={{ width: `${Math.round(att.ratio * 100)}%` }}
                />
              </div>
              {!isTemp && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setForm({
                      open: true, from: att.from, to: att.to, ratio: att.ratio, editingId: att.id,
                    })}
                    disabled={actionBusy}
                    className="flex-1 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted bg-card active:bg-cream disabled:opacity-40"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={async () => {
                      const next = attenuations.filter(a => a.id !== att.id)
                      await onPatchAttenuations(next.length > 0 ? next : undefined)
                    }}
                    disabled={actionBusy}
                    className="px-3 py-1.5 rounded-lg border border-danger/30 text-xs font-semibold text-danger bg-danger/5 active:bg-danger/10 disabled:opacity-40"
                  >
                    Supprimer
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Formulaire ajout / modification */}
      {!isTemp && form.open && points.length >= 2 && (
        <div className="rounded-xl p-3 bg-sky/5 border border-sky/30 space-y-3">
          <p className="text-xs font-semibold text-sky uppercase tracking-wider">
            {form.editingId ? 'Modifier l\'atténuation' : 'Nouvelle atténuation'}
          </p>
          <p className="text-[11px] text-muted leading-tight">
            Le tracé a {points.length} points (numérotés de 1 à {points.length}).
            Indique le tronçon où le débit chute.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-muted uppercase tracking-wider">Du point</span>
              <select
                value={form.from + 1}
                onChange={e => {
                  const n = Math.max(1, Math.min(points.length - 1, parseInt(e.target.value, 10)))
                  setForm(f => ({
                    ...f,
                    from: n - 1,
                    to: Math.max(n, f.to),
                  }))
                }}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
              >
                {points.slice(0, -1).map((_, i) => (
                  <option key={i} value={i + 1}>Point {i + 1}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-muted uppercase tracking-wider">Au point</span>
              <select
                value={form.to + 1}
                onChange={e => {
                  const n = Math.max(form.from + 2, Math.min(points.length, parseInt(e.target.value, 10)))
                  setForm(f => ({ ...f, to: n - 1 }))
                }}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
              >
                {points.slice(form.from + 1).map((_, i) => (
                  <option key={i + form.from + 1} value={i + form.from + 2}>
                    Point {i + form.from + 2}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted uppercase tracking-wider">Débit restant</span>
              <span className="text-sm font-bold text-sky">{fmtRatio(form.ratio)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(form.ratio * 100)}
              onChange={e => setForm(f => ({ ...f, ratio: parseInt(e.target.value, 10) / 100 }))}
              className="w-full accent-sky"
            />
            <p className="text-[10px] text-muted/80 mt-1 leading-tight">
              0% = à sec · 100% = pleine puissance. Eugénie : utilise 10% pour signaler
              une infiltration quasi totale.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setForm({ open: false, from: 0, to: 1, ratio: 0.1, editingId: null })}
              disabled={actionBusy}
              className="flex-1 py-2 rounded-lg border border-border text-sm font-semibold text-muted bg-card active:bg-cream disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              onClick={async () => {
                const newAtt = {
                  id:    form.editingId ?? newId(),
                  from:  form.from,
                  to:    form.to,
                  ratio: form.ratio,
                }
                const next = form.editingId
                  ? attenuations.map(a => a.id === form.editingId ? newAtt : a)
                  : [...attenuations, newAtt]
                await onPatchAttenuations(next)
                setForm({ open: false, from: 0, to: 1, ratio: 0.1, editingId: null })
              }}
              disabled={actionBusy}
              className="flex-1 py-2 rounded-lg bg-sky text-white text-sm font-bold active:opacity-90 disabled:opacity-40"
            >
              {actionBusy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Bouton ouverture du formulaire */}
      {!isTemp && !form.open && points.length >= 2 && (
        <button
          onClick={() => setForm({
            open: true, from: 0, to: Math.min(1, points.length - 1), ratio: 0.1, editingId: null,
          })}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-sky/40 text-sky text-sm font-semibold active:bg-sky/5"
        >
          + Marquer une atténuation
        </button>
      )}
    </div>
  )
}
