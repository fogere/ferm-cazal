import { useMemo } from 'react'
import type { Animal, AnimalCondition } from '../../types'
import { getSpeciesInfo } from '../../services/species'
import type { CustomSpecies } from '../../types'

interface Props {
  animal:        Animal
  allAnimals:    Animal[]
  customSpecies: CustomSpecies[]
  onNavigate?:   (animalId: string) => void
}

interface Node {
  id:     string
  name:   string
  emoji:  string
  gender?: string
}

export default function AnimalLineage({ animal, allAnimals, customSpecies, onNavigate }: Props) {
  const sire   = animal.sireId ? allAnimals.find(a => a.id === animal.sireId) : null
  const dam    = animal.damId  ? allAnimals.find(a => a.id === animal.damId)  : null
  const siblings = useMemo(() =>
    allAnimals.filter(a =>
      a.id !== animal.id && (
        (animal.sireId && a.sireId === animal.sireId) ||
        (animal.damId  && a.damId  === animal.damId)
      ),
    ),
    [allAnimals, animal],
  )
  const offspring = useMemo(() =>
    allAnimals.filter(a => a.sireId === animal.id || a.damId === animal.id),
    [allAnimals, animal.id],
  )

  // Conditions héréditaires partagées avec un parent
  const hereditaryShared = useMemo(() => {
    const list: Array<{ cond: AnimalCondition; with: Animal }> = []
    const myConditions = animal.conditions ?? []
    for (const parent of [sire, dam].filter(Boolean) as Animal[]) {
      const pc = parent.conditions ?? []
      for (const mine of myConditions.filter(c => c.isGenetic)) {
        if (pc.some(p => p.label.toLowerCase() === mine.label.toLowerCase())) {
          list.push({ cond: mine, with: parent })
        }
      }
    }
    return list
  }, [animal, sire, dam])

  function nodeOf(a: Animal): Node {
    const sp = getSpeciesInfo(a.species, customSpecies)
    return { id: a.id, name: a.name, emoji: sp.emoji, gender: a.gender }
  }

  return (
    <div className="space-y-4">

      {/* Parents */}
      <Section title="Parents">
        {!sire && !dam ? (
          <p className="text-xs text-muted italic text-center py-2">Parents non renseignés.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sire ? <Tile node={nodeOf(sire)} role="Père"  onNavigate={onNavigate} />
                  : <Empty label="Père"  />}
            {dam  ? <Tile node={nodeOf(dam)}  role="Mère"  onNavigate={onNavigate} />
                  : <Empty label="Mère"  />}
          </div>
        )}
      </Section>

      {/* L'animal central */}
      <div className="relative flex items-center justify-center py-2">
        <div className="absolute inset-x-1/2 top-0 -translate-x-1/2 w-px h-2 bg-border" />
        <div className="bg-forest text-white rounded-2xl px-4 py-2 text-center shadow-md">
          <p className="text-base font-bold m-0">
            {getSpeciesInfo(animal.species, customSpecies).emoji} {animal.name}
          </p>
          <p className="text-[9px] opacity-80 m-0">vous êtes ici</p>
        </div>
        <div className="absolute inset-x-1/2 bottom-0 -translate-x-1/2 w-px h-2 bg-border" />
      </div>

      {/* Fratrie */}
      {siblings.length > 0 && (
        <Section title={`Fratrie (${siblings.length})`}>
          <div className="grid grid-cols-2 gap-2">
            {siblings.map(s => (
              <Tile key={s.id} node={nodeOf(s)} role={
                s.sireId === animal.sireId && s.damId === animal.damId
                  ? 'Plein frère/sœur'
                  : 'Demi-frère/sœur'
              } onNavigate={onNavigate} compact />
            ))}
          </div>
        </Section>
      )}

      {/* Descendance */}
      {offspring.length > 0 && (
        <Section title={`Descendance (${offspring.length})`}>
          <div className="grid grid-cols-2 gap-2">
            {offspring.map(o => (
              <Tile key={o.id} node={nodeOf(o)}
                    role={o.birthDate
                      ? new Date(o.birthDate).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
                      : '—'}
                    onNavigate={onNavigate} compact />
            ))}
          </div>
        </Section>
      )}

      {/* Alertes héréditaires */}
      {hereditaryShared.length > 0 && (
        <div className="bg-danger/5 border border-danger/30 rounded-xl p-3">
          <p className="text-xs font-bold text-danger flex items-center gap-1 mb-1">
            🧬 Conditions héréditaires partagées
          </p>
          <ul className="space-y-0.5">
            {hereditaryShared.map((s, i) => (
              <li key={i} className="text-[11px] text-charcoal">
                <strong>{s.cond.label}</strong> · partagée avec {s.with.name}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted mt-1.5 italic">
            À considérer pour les futures sailies.
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 pl-1">
        {title}
      </p>
      {children}
    </div>
  )
}

function Tile({ node, role, onNavigate, compact }: {
  node: Node
  role: string
  onNavigate?: (id: string) => void
  compact?: boolean
}) {
  return (
    <button onClick={() => onNavigate?.(node.id)}
            className="bg-white rounded-xl p-2 border border-border/40 text-left active:bg-cream w-full">
      <div className="flex items-center gap-2">
        <span className={compact ? 'text-xl' : 'text-2xl'}>{node.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-charcoal truncate m-0">{node.name}</p>
          <p className="text-[9px] text-muted m-0">{role}</p>
        </div>
      </div>
    </button>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="bg-cream rounded-xl p-2 border border-dashed border-border/60 text-center">
      <p className="text-[10px] text-muted">{label} : inconnu</p>
    </div>
  )
}
