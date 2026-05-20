import { useMemo } from 'react'
import type { Animal, AnimalCareEntry } from '../../types'
import { getSpeciesInfo } from '../../services/species'
import type { CustomSpecies } from '../../types'

interface Props {
  animal:        Animal
  careEntries:   AnimalCareEntry[]
  customSpecies: CustomSpecies[]
}

/**
 * Bloc reproduction affiché uniquement pour les femelles (gender = 'female' | 'mare').
 * - État courant : si une dernière saillie + pas de mise bas dans la fenêtre prévue,
 *   on affiche "Gestation J+X / Y" avec barre de progression.
 * - Calendrier sailies & mises bas passées.
 */
export default function AnimalReproduction({ animal, careEntries, customSpecies }: Props) {
  const sp = getSpeciesInfo(animal.species, customSpecies)
  const gest = sp.gestationDays ?? 340

  const breedings = useMemo(
    () => careEntries.filter(c => c.type === 'breeding').sort((a, b) => b.date - a.date),
    [careEntries],
  )
  const births = useMemo(
    () => careEntries.filter(c => c.type === 'birth').sort((a, b) => b.date - a.date),
    [careEntries],
  )

  // État courant : dernière saillie sans mise bas dans la fenêtre [date, date + gest + 30j]
  const current = useMemo(() => {
    if (breedings.length === 0) return null
    const last = breedings[0]
    const windowEnd = last.date + (gest + 30) * 86_400_000
    const birthInWindow = births.find(b => b.date >= last.date && b.date <= windowEnd)
    if (birthInWindow) return null
    return { saillie: last }
  }, [breedings, births, gest])

  return (
    <div className="space-y-3">
      {/* Etat actuel */}
      {current ? (
        <CurrentGestationCard
          startTs={current.saillie.date}
          expectedTs={current.saillie.nextDueAt ?? current.saillie.date + gest * 86_400_000}
          gestDays={gest}
        />
      ) : (
        <div className="bg-card rounded-xl border border-border/40 p-3 text-center">
          <p className="text-xs text-muted">
            {breedings.length === 0
              ? 'Aucune saillie enregistrée.'
              : 'Aucune gestation en cours.'}
          </p>
        </div>
      )}

      {/* Historique sailies */}
      {breedings.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 pl-1">
            Sailies ({breedings.length})
          </p>
          <ul className="space-y-1">
            {breedings.map(b => {
              const matchedBirth = births.find(bb =>
                bb.date >= b.date && bb.date <= b.date + (gest + 30) * 86_400_000,
              )
              return (
                <li key={b.id} className="flex items-start gap-2 bg-white rounded-lg p-2 border border-border/40">
                  <span className="text-base flex-shrink-0">💕</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-charcoal">
                      {new Date(b.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {b.note && <p className="text-[10px] text-muted">{b.note}</p>}
                    {matchedBirth ? (
                      <p className="text-[10px] text-meadow font-semibold">
                        ✓ Mise bas le {new Date(matchedBirth.date).toLocaleDateString('fr-FR')}
                      </p>
                    ) : b.nextDueAt && (
                      <p className="text-[10px] text-sun font-semibold">
                        ⏰ Terme prévu : {new Date(b.nextDueAt).toLocaleDateString('fr-FR')}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Mises bas isolées sans saillie associée */}
      {births.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 pl-1">
            Mises bas ({births.length})
          </p>
          <ul className="space-y-1">
            {births.map(b => (
              <li key={b.id} className="flex items-start gap-2 bg-white rounded-lg p-2 border border-border/40">
                <span className="text-base flex-shrink-0">🐣</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-charcoal">
                    {new Date(b.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {b.note && <p className="text-[10px] text-muted">{b.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted text-center italic pt-1">
        Gestation moyenne {sp.label.toLowerCase()} : {gest} jours
      </p>
    </div>
  )
}

function CurrentGestationCard({ startTs, expectedTs, gestDays }: {
  startTs: number; expectedTs: number; gestDays: number
}) {
  const now = Date.now()
  const dayN = Math.floor((now - startTs) / 86_400_000)
  const pct = Math.min(100, Math.max(0, (dayN / gestDays) * 100))
  const daysToExpected = Math.ceil((expectedTs - now) / 86_400_000)
  return (
    <div className="bg-gradient-to-br from-pink-50 to-card rounded-xl border border-pink-200 p-3">
      <p className="text-xs font-bold text-pink-700 m-0 mb-1">🤰 Gestation en cours</p>
      <p className="text-2xl font-bold text-charcoal m-0">
        J+{dayN} <span className="text-base text-muted font-normal">/ {gestDays}</span>
      </p>
      <div className="h-2 bg-pink-100 rounded-full overflow-hidden mt-2">
        <div
          className="h-full bg-pink-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted mt-2">
        Saillie le {new Date(startTs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
        {daysToExpected > 0
          ? ` · terme dans ${daysToExpected} j`
          : daysToExpected === 0
            ? ' · terme aujourd\'hui !'
            : ' · terme dépassé'}
      </p>
    </div>
  )
}
