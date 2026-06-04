import { useMemo, useState } from 'react'
import type {
  AnimalCareEntry, AnimalMeasurement, AnimalPhoto,
  EnclosureMovement, AnimalCondition, UserProfile,
} from '../../types'
import { careCfg } from '../../services/animal/careConfig'

type Event =
  | { ts: number; kind: 'care';      title: string; sub: string; icon: string; color: string }
  | { ts: number; kind: 'photo';     title: string; sub: string; icon: string; color: string; photoUrl?: string }
  | { ts: number; kind: 'measure';   title: string; sub: string; icon: string; color: string }
  | { ts: number; kind: 'condition'; title: string; sub: string; icon: string; color: string; openEnded?: boolean }
  | { ts: number; kind: 'move';      title: string; sub: string; icon: string; color: string }

type FilterKey = 'all' | 'care' | 'photo' | 'measure' | 'condition' | 'move'

interface Props {
  careEntries:  AnimalCareEntry[]
  photos:       AnimalPhoto[]
  measurements: AnimalMeasurement[]
  conditions:   AnimalCondition[]
  movements:    EnclosureMovement[]
  users:        UserProfile[]
}

function userName(uid: string, users: UserProfile[]): string {
  return users.find(u => u.uid === uid)?.displayName ?? '—'
}

function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export default function AnimalTimeline({
  careEntries, photos, measurements, conditions, movements, users,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const events: Event[] = useMemo(() => {
    const list: Event[] = []
    for (const c of careEntries) {
      list.push({
        ts:    c.date,
        kind:  'care',
        title: careCfg(c.type).label,
        sub:   c.note || `Par ${userName(c.performedBy, users)}`,
        icon:  careCfg(c.type).icon,
        color: 'border-sky/30 bg-sky/5',
      })
    }
    for (const p of photos) {
      list.push({
        ts:       p.takenAt,
        kind:     'photo',
        title:    p.category === 'condition' ? 'Photo de suivi' : 'Photo',
        sub:      (p.tags ?? []).slice(0, 3).join(' · ') || `Par ${userName(p.uploadedBy, users)}`,
        icon:     '📸',
        color:    'border-meadow/30 bg-meadow/5',
        photoUrl: p.dataUrl,
      })
    }
    for (const m of measurements) {
      const parts: string[] = []
      if (m.weightKg != null)  parts.push(`${m.weightKg} kg`)
      if (m.withersCm != null) parts.push(`${m.withersCm} cm`)
      if (m.ecs != null)       parts.push(`ECS ${m.ecs}/${m.ecsScale === '1-9' ? '9' : '5'}`)
      list.push({
        ts:    m.date,
        kind:  'measure',
        title: 'Mesure',
        sub:   parts.join(' · ') || 'Sans valeur',
        icon:  '📏',
        color: 'border-forest/30 bg-forest/5',
      })
    }
    for (const c of conditions) {
      list.push({
        ts:    c.addedAt,
        kind:  'condition',
        title: `🔴 ${c.label}`,
        sub:   c.description || (c.permanent ? 'À vie' : 'En cours'),
        icon:  '🩹',
        color: 'border-danger/30 bg-danger/5',
        openEnded: !c.resolvedAt,
      })
      if (c.resolvedAt) {
        list.push({
          ts:    c.resolvedAt,
          kind:  'condition',
          title: `✓ ${c.label} résolu`,
          sub:   'Marqué comme guéri',
          icon:  '✅',
          color: 'border-meadow/30 bg-meadow/5',
        })
      }
    }
    for (const mv of movements) {
      const from = mv.fromEnclosureName ?? 'libre'
      const to   = mv.toEnclosureName   ?? 'libre'
      list.push({
        ts:    mv.movedAt,
        kind:  'move',
        title: 'Déplacement',
        sub:   `${from} → ${to}`,
        icon:  '↔',
        color: 'border-earth/30 bg-earth/5',
      })
    }
    return list.sort((a, b) => b.ts - a.ts)
  }, [careEntries, photos, measurements, conditions, movements, users])

  const filtered = filter === 'all' ? events : events.filter(e => e.kind === filter)

  // Group by month label
  const grouped = useMemo(() => {
    const map = new Map<string, Event[]>()
    for (const e of filtered) {
      const key = monthLabel(e.ts)
      const arr = map.get(key) ?? []
      arr.push(e)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div className="space-y-3">
      {/* Filtres */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
        {([
          ['all', '🌍 Tout', events.length],
          ['care', '💉 Soins', events.filter(e => e.kind === 'care').length],
          ['measure', '📏 Mesures', events.filter(e => e.kind === 'measure').length],
          ['photo', '📸 Photos', events.filter(e => e.kind === 'photo').length],
          ['condition', '🩹 Santé', events.filter(e => e.kind === 'condition').length],
          ['move', '↔ Mouv.', events.filter(e => e.kind === 'move').length],
        ] as [FilterKey, string, number][]).map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all ${
              filter === k ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
            }`}
          >
            {label} {count > 0 && <span className="opacity-70">({count})</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted text-center italic py-6">
          Aucun événement enregistré.
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([month, items]) => (
            <div key={month}>
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 pl-1">
                {month}
              </p>
              <ul className="space-y-1.5 relative">
                {/* Ligne verticale */}
                <div className="absolute left-3 top-1 bottom-1 w-px bg-border" aria-hidden="true" />
                {items.map((e, i) => (
                  <li key={`${e.kind}-${e.ts}-${i}`} className="relative pl-7">
                    {/* Pastille */}
                    <div className="absolute left-1 top-1.5 w-4 h-4 rounded-full bg-card border border-border flex items-center justify-center text-[9px]">
                      {e.icon}
                    </div>
                    <div className={`rounded-lg p-2 border ${e.color}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-charcoal m-0 leading-tight">
                            {e.title}
                            {e.kind === 'condition' && e.openEnded && (
                              <span className="ml-1 text-[8px] font-normal text-danger">· en cours</span>
                            )}
                          </p>
                          <p className="text-[10px] text-muted m-0 leading-snug truncate">{e.sub}</p>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          {e.kind === 'photo' && e.photoUrl && (
                            <img src={e.photoUrl} alt=""
                                 className="w-8 h-8 rounded object-cover border border-border/40" />
                          )}
                          <span className="text-[9px] text-muted whitespace-nowrap">
                            {new Date(e.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
