// Sous-panneau d'un fence : tout ce qui est lié au PLACEMENT D'ANIMAUX dans
// l'enclos (assignation, listing, rotation à prévoir, historique des
// mouvements). Extrait de Map.tsx lors de la sous-session S1.5.
//
// Behavior-preserving strict.
//
// Note : ce sous-panneau a beaucoup de props parce qu'il traite plusieurs
// préoccupations à la fois (placement + check santé + rotation + historique).
// Une refacto fonctionnelle plus poussée (le casser en 3-4 sous-composants
// plus petits) viendra avec le chantier "espaces vs clôtures" — S2+ du plan.

import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import type { Animal, EnclosureMovement, MapPin, UserProfile, CustomSpecies } from '../../../types'
// isFenceClosed n'est plus utilisé ici — le caller décide via la prop isEnclosed.
import { healthFreshness, healthDotClass } from '../../../services/map/health'
import { formatAgo } from '../../../services/map/time'
import { getSpeciesInfo } from '../../../services/species'
import { tsToDateInput } from '../../../services/map/time'
import { effectiveEnclosureId } from '../../../services/map/enclosure'

function sortAnimalsByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
}

interface Props {
  pin:             MapPin
  /**
   * "L'enclos est-il fonctionnel pour recevoir des animaux ?"
   * - Fence : `isFenceClosed(fence)` (l'ancien comportement)
   * - Land_plot : true par construction (un polygon défini est toujours un enclos)
   *
   * Passé en prop pour permettre la réutilisation du panel sur les deux types.
   */
  isEnclosed:      boolean
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

  // Callbacks vers Map.tsx (Firestore writes / navigation)
  onMarkAllHealthy:      (list: Animal[]) => void | Promise<void>
  onSaveEnclosureAnimals: (fenceId: string) => void | Promise<void>
  onSetRotation:         (pin: MapPin, days: number | null) => void | Promise<void>
}

export function EnclosurePlacementPanel(props: Props) {
  const {
    pin, isEnclosed, isTemp, actionBusy, savingHealth, user,
    animals, users, customSpecies, enclosureHistory,
    historyVisible, setHistoryVisible,
    editEnclosureAnimals, setEditEnclosureAnimals,
    pendingEnclosureAnimals, setPendingEnclosureAnimals,
    pendingMoveDate, setPendingMoveDate,
    pendingMoveNote, setPendingMoveNote,
    onMarkAllHealthy, onSaveEnclosureAnimals, onSetRotation,
  } = props
  const navigate = useNavigate()
  // Identifiant logique de l'enclos. Pour un fence migré (migratedToPlotId
  // présent), on compare contre le plot id ; sinon contre le fence id.
  // Voir services/map/enclosure.ts.
  const encId = effectiveEnclosureId(pin)

  return (
    <>
      {/* ── Animaux (enclos fermé → assignation, ouvert → conseil) ── */}
      {isEnclosed ? (
        <div className="rounded-xl border-2 border-forest/30 bg-forest/5 overflow-hidden">
          {/* En-tête */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-forest/20">
            <div className="flex items-center gap-2">
              <span className="text-base">🐾</span>
              <p className="text-sm font-bold text-forest">Animaux dans l'enclos</p>
              <span className="text-xs font-bold text-forest/60 bg-forest/10 rounded-full px-2 py-0.5">
                {animals.filter(a => a.enclosureId === encId).length}
              </span>
            </div>
            {!editEnclosureAnimals && (
              <button
                onClick={() => {
                  setPendingEnclosureAnimals(animals.filter(a => a.enclosureId === encId).map(a => a.id))
                  setPendingMoveDate(tsToDateInput())
                  setPendingMoveNote('')
                  setEditEnclosureAnimals(true)
                }}
                className="text-xs text-forest font-bold px-3 py-1.5 rounded-lg bg-forest/10 active:bg-forest/20 transition-colors"
              >
                ✏️ Modifier
              </button>
            )}
          </div>

          <div className="p-3">
            {!editEnclosureAnimals ? (
              (() => {
                const enc = sortAnimalsByName(animals.filter(a => a.enclosureId === encId))
                return enc.length === 0 ? (
                  <div className="text-center py-3">
                    <p className="text-sm text-muted italic mb-2">Aucun animal placé ici</p>
                    <button
                      onClick={() => {
                        setPendingEnclosureAnimals([])
                        setPendingMoveDate(tsToDateInput())
                        setPendingMoveNote('')
                        setEditEnclosureAnimals(true)
                      }}
                      className="px-4 py-2 rounded-xl bg-forest text-white text-sm font-bold active:opacity-80 transition-opacity"
                    >
                      + Placer des animaux
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {enc.map(a => {
                        const f = healthFreshness(a.lastCheckedHealthy)
                        const seenBy = a.lastCheckedHealthyBy
                          ? (users.find(u => u.uid === a.lastCheckedHealthyBy)?.displayName ?? '?')
                          : null
                        const title = seenBy
                          ? `${formatAgo(a.lastCheckedHealthy)} (par ${seenBy}) — touchez pour la fiche`
                          : `${formatAgo(a.lastCheckedHealthy)} — touchez pour la fiche`
                        return (
                          <button key={a.id}
                                title={title}
                                onClick={() => navigate(`/animal/${a.id}`)}
                                className="px-2.5 py-1.5 rounded-xl bg-forest/10 border border-forest/30 text-forest text-xs font-semibold flex items-center gap-1.5 active:bg-forest/20 transition-colors">
                            <span className={`w-2 h-2 rounded-full ${healthDotClass(f)}`} aria-hidden />
                            {getSpeciesInfo(a.species, customSpecies).emoji} {a.name}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => onMarkAllHealthy(enc)}
                      disabled={savingHealth || !user}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl
                                 bg-meadow/15 border border-meadow/40 text-meadow text-xs font-bold
                                 active:bg-meadow/25 transition-colors disabled:opacity-50"
                    >
                      <Check size={13} />
                      {savingHealth ? 'Enregistrement…' : `Tous vus en bonne santé (${enc.length})`}
                    </button>
                    {enc.some(a => a.lastCheckedHealthy) && (
                      <p className="text-[10px] text-muted/70 text-center">
                        Dernier check : {(() => {
                          const ts = Math.max(...enc.map(a => a.lastCheckedHealthy ?? 0))
                          return ts ? formatAgo(ts) : '—'
                        })()}
                      </p>
                    )}
                  </div>
                )
              })()
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted font-medium">
                  Touchez un animal pour l'ajouter ou le retirer.
                  Un animal déplacé depuis un autre enclos sera libéré automatiquement.
                </p>
                {animals.length === 0 ? (
                  <p className="text-xs text-muted italic text-center py-2">
                    Aucun animal enregistré — ajoutez-en depuis Admin.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                    {sortAnimalsByName(animals).map(a => {
                      const isSelected = pendingEnclosureAnimals.includes(a.id)
                      const isElsewhere = a.enclosureId && a.enclosureId !== encId
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setPendingEnclosureAnimals(prev =>
                            prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]
                          )}
                          className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1 ${
                            isSelected
                              ? 'border-forest text-forest bg-forest/10'
                              : 'border-border text-muted bg-white'
                          }`}
                        >
                          {getSpeciesInfo(a.species, customSpecies).emoji} {a.name}
                          {isElsewhere && !isSelected && (
                            <span className="text-muted/50 text-[10px]">↗ autre enclos</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                {/* Date + note du mouvement — utile pour reconstituer un calendrier
                    de pâturage PAC (déclaration des dates réelles de présence). */}
                <div className="bg-cream/60 rounded-xl p-2.5 space-y-2 border border-border/50">
                  <div>
                    <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
                      Date du mouvement
                    </label>
                    <input
                      type="date"
                      value={pendingMoveDate || tsToDateInput()}
                      onChange={e => setPendingMoveDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                    />
                    <p className="text-[9px] text-muted mt-0.5 leading-tight">
                      Par défaut aujourd'hui. Mettre une date passée pour saisir
                      un mouvement rétroactif (calendrier PAC).
                    </p>
                  </div>
                  <input
                    type="text"
                    value={pendingMoveNote}
                    onChange={e => setPendingMoveNote(e.target.value)}
                    placeholder="Note (optionnelle) — ex: rotation, transhumance…"
                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onSaveEnclosureAnimals(pin.id)}
                    disabled={actionBusy}
                    className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold active:opacity-80 disabled:opacity-50 transition-opacity"
                  >
                    {actionBusy ? 'Enregistrement…' : '✓ Confirmer'}
                  </button>
                  <button
                    onClick={() => setEditEnclosureAnimals(false)}
                    className="px-4 py-3 rounded-xl border border-border text-muted text-sm active:bg-cream"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3 bg-cream border border-dashed border-border flex items-center gap-2">
          <span className="text-base">💡</span>
          <p className="text-xs text-muted leading-relaxed">
            <strong>Clôture ouverte.</strong> Fermez-la en rapprochant le dernier point
            du point vert de départ pour créer un enclos et y placer des animaux.
          </p>
        </div>
      )}

      {/* Rotation à prévoir — demande Eugénie 21/05/2026 */}
      {isEnclosed && !isTemp && (() => {
        const occupants = animals.filter(a => a.enclosureId === encId).length
        if (occupants === 0) return null
        const due = pin.rotationDueAt
        if (due) {
          const daysLeft = (due - Date.now()) / 86_400_000
          const overdue = daysLeft < 0
          return (
            <div className={`rounded-xl p-3 border ${overdue ? 'bg-danger/10 border-danger/30' : 'bg-orange-500/10 border-orange-500/30'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-charcoal">⏰ Rotation prévue</p>
                  <p className="text-xs text-muted mt-0.5">
                    {overdue
                      ? `En retard de ${Math.ceil(-daysLeft)} j`
                      : daysLeft < 1
                        ? "Aujourd'hui"
                        : `Dans ${Math.ceil(daysLeft)} j`}
                    {' · '}
                    {new Date(due).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <button
                  onClick={() => onSetRotation(pin, null)}
                  disabled={actionBusy}
                  className="text-[11px] font-bold text-muted bg-card border border-border px-2 py-1 rounded-md active:bg-cream disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          )
        }
        return (
          <div className="rounded-xl p-3 bg-cream border border-border/40">
            <p className="text-xs font-semibold text-charcoal mb-2">⏰ Signaler une rotation à prévoir</p>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 3, 7, 14].map(d => (
                <button
                  key={d}
                  onClick={() => onSetRotation(pin, d)}
                  disabled={actionBusy}
                  className="py-2 rounded-lg bg-card border border-border text-xs font-bold text-charcoal active:bg-orange-500/10 active:border-orange-500/40 disabled:opacity-50 transition-colors"
                >
                  J+{d}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted/80 mt-1.5">
              Tout le monde verra une horloge ⏰ sur ce parc à J-7 (orange) puis rouge à échéance.
            </p>
          </div>
        )
      })()}

      {/* Historique des rotations (uniquement pour enclos fermés) */}
      {isEnclosed && (
        <div className="rounded-xl bg-cream border border-border/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              🌿 Pâturage
            </span>
            <button onClick={() => navigate('/grazing')}
                    className="text-[10px] font-bold text-forest bg-forest/10 px-2 py-1 rounded-md active:bg-forest/20">
              Calendrier complet →
            </button>
          </div>
          <button
            onClick={() => setHistoryVisible(v => !v)}
            className="w-full px-3 py-2.5 flex items-center justify-between active:bg-border/30 transition-colors"
          >
            <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              🔄 Historique des mouvements
            </span>
            {/* Bug Benoît 20/05/2026 : crayon trompeur (suggérait l'édition). C'est juste un toggle. */}
            {historyVisible ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
          </button>
          {historyVisible && (
            <div className="px-3 pb-3 pt-1">
              {enclosureHistory.length === 0 ? (
                <p className="text-xs text-muted italic text-center py-3">
                  Aucun mouvement enregistré pour cet enclos.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                  {enclosureHistory.slice(0, 30).map(m => {
                    const cameIn = m.toEnclosureId === encId
                    const author = users.find(u => u.uid === m.movedBy)?.displayName ?? '—'
                    const date   = new Date(m.movedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                    return (
                      <li key={m.id}
                          className={`text-xs leading-snug px-2.5 py-1.5 rounded-lg ${cameIn ? 'bg-meadow/10' : 'bg-danger/5'}`}>
                        <span className="font-bold">
                          {getSpeciesInfo(m.species, customSpecies).emoji} {m.animalName}
                        </span>
                        {' '}
                        {cameIn
                          ? <span className="text-meadow">↘ entré{m.fromEnclosureName ? ` (depuis « ${m.fromEnclosureName} »)` : ' (libre)'}</span>
                          : <span className="text-danger">↗ sorti{m.toEnclosureName ? ` (vers « ${m.toEnclosureName} »)` : ' (libéré)'}</span>
                        }
                        <div className="text-muted/80 text-[11px] mt-0.5">{date} · par {author}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {!isTemp && (
                <button
                  onClick={() => navigate(`/grazing?addFor=${pin.id}`)}
                  className="mt-2 w-full text-[11px] font-bold text-forest bg-forest/10
                             px-3 py-2 rounded-lg active:bg-forest/20 flex items-center justify-center gap-1.5"
                >
                  <Pencil size={12} /> Noter un mouvement
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {pin.note && (
        <div className="bg-cream rounded-xl p-3 border border-border">
          <p className="text-charcoal text-sm">{pin.note}</p>
        </div>
      )}
    </>
  )
}
