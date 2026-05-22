// Bottom sheet ouvert quand l'utilisatrice tape la notification "tu es dans
// un enclos avec X animaux à vérifier" (bug Eugénie 22/05/2026 — avant le tap
// re-naviguait juste vers /map sans rien faire de utile).
//
// L'utilisatrice voit la liste des animaux du parc avec une checkbox par bête.
// Cocher = "je l'ai vu, il va bien". Décocher = "je ne le vois pas / problème
// → on ouvre sa fiche pour qu'elle saisisse plus de détails".
//
// L'action principale "✅ Tous les cochés vont bien" enregistre
// lastCheckedHealthy = now sur les animaux cochés en 1 writeBatch.

import { useState, useMemo } from 'react'
import { X, Check, ChevronRight } from 'lucide-react'
import type { Animal, MapPin, CustomSpecies } from '../types'
import { getSpeciesInfo } from '../services/species'
import { formatAgo } from '../services/map/time'

interface Props {
  plot:             MapPin
  animals:          Animal[]
  customSpecies:    CustomSpecies[]
  saving:           boolean
  onMarkChecked:    (animals: Animal[]) => Promise<void>
  onOpenAnimal:     (animal: Animal) => void
  onClose:          () => void
}

export function GeofenceCheckSheet({
  plot, animals, customSpecies, saving, onMarkChecked, onOpenAnimal, onClose,
}: Props) {
  // Par défaut tout est coché — l'usage typique est "tout va bien, je clique"
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(animals.map(a => a.id)),
  )

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function allOn()  { setChecked(new Set(animals.map(a => a.id))) }
  function allOff() { setChecked(new Set()) }

  const sorted = useMemo(
    () => [...animals].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [animals],
  )

  const handleSave = async () => {
    const toUpdate = sorted.filter(a => checked.has(a.id))
    if (toUpdate.length === 0) {
      onClose()
      return
    }
    await onMarkChecked(toUpdate)
    onClose()
  }

  return (
    <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
           onClick={() => !saving && onClose()} />
      <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-8 shadow-2xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-charcoal text-lg font-bold m-0">
            🐴 Tu es dans «&nbsp;{plot.name || 'cet enclos'}&nbsp;»
          </h2>
          <button onClick={onClose}
                  disabled={saving}
                  className="p-2 rounded-xl text-muted active:bg-cream disabled:opacity-40">
            <X size={20} />
          </button>
        </div>
        <p className="text-xs text-muted mb-3 leading-relaxed">
          Coche les animaux que tu vois et qui vont bien. Touche le nom d'un
          animal pour ouvrir sa fiche si tu veux noter un problème.
        </p>

        {/* Toggles all/none */}
        {sorted.length > 1 && (
          <div className="flex gap-2 mb-3">
            <button
              onClick={allOn}
              disabled={saving}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-meadow/15 text-meadow active:bg-meadow/25 disabled:opacity-40"
            >
              Tout cocher
            </button>
            <button
              onClick={allOff}
              disabled={saving}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-cream text-muted active:bg-cream/70 disabled:opacity-40"
            >
              Tout décocher
            </button>
          </div>
        )}

        {/* Liste des animaux */}
        <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-1.5 min-h-0">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">
              Aucun animal enregistré dans ce parc.
            </p>
          ) : sorted.map(a => {
            const { emoji, label } = getSpeciesInfo(a.species, customSpecies)
            const isChecked = checked.has(a.id)
            return (
              <div
                key={a.id}
                className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-all ${
                  isChecked
                    ? 'border-meadow/40 bg-meadow/8'
                    : 'border-border bg-cream/40'
                }`}
              >
                {/* Zone clic principal = cocher/décocher */}
                <button
                  onClick={() => toggle(a.id)}
                  disabled={saving}
                  className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-40 ${
                    isChecked
                      ? 'border-meadow bg-meadow text-white'
                      : 'border-muted/40 bg-card'
                  }`}
                  aria-label={isChecked ? 'Décocher' : 'Cocher'}
                >
                  {isChecked && <Check size={14} strokeWidth={3} />}
                </button>
                {/* Nom + dernière vérif (tap → fiche animal) */}
                <button
                  onClick={() => onOpenAnimal(a)}
                  disabled={saving}
                  className="flex-1 text-left min-w-0 active:opacity-70 disabled:opacity-40"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg leading-none">{emoji}</span>
                    <span className="text-sm font-bold text-charcoal truncate">{a.name}</span>
                    <span className="text-[10px] text-muted/70 truncate">· {label}</span>
                  </div>
                  <p className="text-[11px] text-muted mt-0.5 leading-tight">
                    {a.lastCheckedHealthy
                      ? `Vu en bonne santé ${formatAgo(a.lastCheckedHealthy)}`
                      : 'Jamais vérifié — touche pour ouvrir sa fiche'}
                  </p>
                </button>
                <ChevronRight size={14} className="text-muted/50 flex-shrink-0" />
              </div>
            )
          })}
        </div>

        {/* Action principale */}
        <div className="space-y-2 pt-3 mt-2 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving || sorted.length === 0}
            className="w-full py-3 rounded-xl bg-meadow text-white text-sm font-bold
                       active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            <Check size={16} />
            {saving
              ? 'Enregistrement…'
              : checked.size === 0
                ? "Personne d'OK — fermer"
                : checked.size === sorted.length
                  ? `Tous OK (${checked.size})`
                  : `OK pour ${checked.size} sur ${sorted.length}`}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full py-2 rounded-xl text-sm text-muted active:bg-cream disabled:opacity-40"
          >
            Fermer sans enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
