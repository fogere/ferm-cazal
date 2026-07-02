import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { Task, UserProfile } from '../../types'

// Timeline « à la Genshin » de l'historique des tâches faites (demande Nils V8,
// 02/07/2026). Une rangée de ronds datés reliés par une ligne ; l'anneau de chaque
// jour se remplit selon le nombre de tâches cochées ce jour-là (relatif au jour le
// plus chargé de la fenêtre). Cliquer un jour affiche, en dessous, la liste des
// tâches faites ce jour-là — typographie classique, PAS de texte rayé en gris.
//
// N'affiche QUE l'historique (le « ce qu'on a fait »). La liste des tâches à faire
// reste gérée par Tasks.tsx (les buckets En retard / Aujourd'hui / …).

const DAYS_FR   = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTHS_FR = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sep.', 'oct.', 'nov.', 'déc.']

// Début de journée locale décalée de `offset` jours (0 = aujourd'hui, -1 = hier…).
// Recalculé depuis le calendrier réel → robuste aux changements d'heure.
function startOfDay(offset: number): number {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function formatHM(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
}

interface DayCell {
  offset: number      // 0 = aujourd'hui, -1 = hier, …
  start: number
  done: Task[]        // tâches cochées ce jour-là, plus récentes d'abord
}

interface Props {
  tasks: Task[]
  users: UserProfile[]
  /** Nombre de jours affichés = fenêtre de rétention de l'historique (défaut 6). */
  historyDays?: number
}

export default function TaskDayTimeline({ tasks, users, historyDays = 6 }: Props) {
  // Jour sélectionné, exprimé en offset ≤ 0 (0 = aujourd'hui).
  const [selected, setSelected] = useState(0)

  const days = useMemo<DayCell[]>(() => {
    const out: DayCell[] = []
    // Du plus ancien (gauche) au plus récent (droite = aujourd'hui).
    for (let i = historyDays - 1; i >= 0; i--) {
      const offset = -i
      const start  = startOfDay(offset)
      const end    = startOfDay(offset + 1) // borne exclusive
      const done = tasks
        .filter(t => t.completed && t.completedAt != null && t.completedAt >= start && t.completedAt < end)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      out.push({ offset, start, done })
    }
    return out
  }, [tasks, historyDays])

  const maxDone = useMemo(() => Math.max(1, ...days.map(d => d.done.length)), [days])

  const selectedDay = days.find(d => d.offset === selected) ?? days[days.length - 1]

  function dayLabel(offset: number): string {
    if (offset === 0)  return 'aujourd’hui'
    if (offset === -1) return 'hier'
    const d = new Date(startOfDay(offset))
    return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
  }

  return (
    <div className="space-y-3">
      {/* Rangée de ronds datés reliés */}
      <div className="bg-card rounded-2xl px-4 py-4 shadow-sm">
        <div className="relative">
          {/* Ligne de liaison derrière les ronds (au niveau du centre) */}
          <div className="absolute left-6 right-6 top-[22px] h-px bg-border" />
          <div className="relative flex justify-between">
            {days.map(cell => {
              const active = cell.offset === selected
              const d = new Date(cell.start)
              const isToday = cell.offset === 0
              return (
                <button
                  key={cell.offset}
                  onClick={() => setSelected(cell.offset)}
                  className="flex flex-col items-center gap-1 min-w-0 active:scale-95 transition-transform"
                  aria-label={`${dayLabel(cell.offset)} — ${cell.done.length} tâche${cell.done.length > 1 ? 's' : ''} faite${cell.done.length > 1 ? 's' : ''}`}
                >
                  {/* fond opaque pour masquer la ligne sous le rond */}
                  <div className={`rounded-full bg-card ${active ? 'ring-2 ring-meadow ring-offset-2 ring-offset-card' : ''}`}>
                    <DayRing count={cell.done.length} max={maxDone} />
                  </div>
                  <span className={`text-[11px] leading-none ${active ? 'text-charcoal font-bold' : 'text-muted'}`}>
                    {isToday ? 'Auj' : DAYS_FR[d.getDay()]}
                  </span>
                  <span className="text-[9px] leading-none text-muted">
                    {d.getDate()}/{d.getMonth() + 1}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Détail du jour sélectionné — « ce qu'on a fait ce jour-là » */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted px-1 mb-2">
          Fait {dayLabel(selectedDay.offset)} ({selectedDay.done.length})
        </p>
        {selectedDay.done.length === 0 ? (
          <p className="text-sm text-muted px-1 py-3">Rien de coché ce jour-là.</p>
        ) : (
          <div className="bg-card rounded-2xl px-3 shadow-sm">
            <ul className="divide-y divide-border/50">
              {selectedDay.done.map(t => {
                const by = users.find(u => u.uid === t.completedBy)
                return (
                  <li key={t.id} className="py-2.5 flex items-start gap-2.5">
                    <CheckCircle2 size={18} className="text-meadow mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-charcoal leading-snug">{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {t.zone && (
                          <span className="text-[11px] text-muted bg-cream px-2 py-0.5 rounded-full border border-border">
                            {t.zone}
                          </span>
                        )}
                        <span className="text-[11px] text-muted">
                          {t.completedAt ? formatHM(t.completedAt) : ''}
                          {by?.displayName ? ` · ${by.displayName}` : ''}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// Anneau SVG : cercle de fond + arc de progression (fraction = count / max).
// Le chiffre au centre = nombre de tâches faites ce jour-là.
function DayRing({ count, max }: { count: number; max: number }) {
  const R = 15
  const C = 2 * Math.PI * R
  const frac = max > 0 ? Math.min(1, count / max) : 0
  return (
    <svg viewBox="0 0 40 40" className="w-11 h-11 block">
      <circle cx="20" cy="20" r={R} fill="none" strokeWidth="3" className="stroke-border" />
      {count > 0 && (
        <circle
          cx="20" cy="20" r={R} fill="none" strokeWidth="3" strokeLinecap="round"
          className="stroke-meadow"
          strokeDasharray={`${frac * C} ${C}`}
          transform="rotate(-90 20 20)"
        />
      )}
      <text
        x="20" y="21" textAnchor="middle" dominantBaseline="middle"
        className={`text-[13px] font-bold ${count > 0 ? 'fill-meadow' : 'fill-muted'}`}
      >
        {count}
      </text>
    </svg>
  )
}
