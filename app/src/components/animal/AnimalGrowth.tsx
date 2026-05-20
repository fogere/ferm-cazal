import { useMemo, useState } from 'react'
import { Plus, Trash2, Calendar } from 'lucide-react'
import {
  collection, addDoc, deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import {
  dateInputToTs,
  tsToDateInput as todayInputValue,
} from '../../services/map/time'
import type { AnimalMeasurement, UserProfile } from '../../types'

interface Props {
  animalId:     string
  measurements: AnimalMeasurement[]
  users:        UserProfile[]
  isTemp:       boolean
  currentUid?:  string
}

type Metric = 'weightKg' | 'withersCm' | 'girthCm' | 'ecs'

const METRIC_CFG: Record<Metric, { label: string; unit: string; color: string; precision: number }> = {
  weightKg:  { label: 'Poids',           unit: 'kg', color: '#2D6A4F', precision: 1 },
  withersCm: { label: 'Taille au garrot', unit: 'cm', color: '#74C69D', precision: 0 },
  girthCm:   { label: 'Tour de poitrail', unit: 'cm', color: '#8B5A2B', precision: 0 },
  ecs:       { label: 'État corporel',   unit: '/5', color: '#D4A017', precision: 1 },
}

export default function AnimalGrowth({ animalId, measurements, users, isTemp, currentUid }: Props) {
  const [activeMetric, setActiveMetric] = useState<Metric>('weightKg')
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayInputValue())
  const [weight, setWeight] = useState('')
  const [withers, setWithers] = useState('')
  const [girth, setGirth] = useState('')
  const [ecs, setEcs] = useState<number | undefined>(undefined)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const sorted = useMemo(
    () => [...measurements].sort((a, b) => a.date - b.date),
    [measurements],
  )

  async function save() {
    if (!currentUid || isTemp) return
    if (!weight && !withers && !girth && ecs == null) return
    setSaving(true)
    try {
      const entry: Omit<AnimalMeasurement, 'id'> = {
        animalId,
        date:        dateInputToTs(date),
        recordedBy:  currentUid,
        createdAt:   Date.now(),
        ...(weight  && { weightKg:  parseFloat(weight) }),
        ...(withers && { withersCm: parseInt(withers, 10) }),
        ...(girth   && { girthCm:   parseInt(girth, 10) }),
        ...(ecs != null && { ecs, ecsScale: '1-5' as const }),
        ...(note.trim() && { note: note.trim() }),
      }
      await addDoc(collection(db, 'animal_measurements'), entry)
      setWeight(''); setWithers(''); setGirth(''); setEcs(undefined); setNote('')
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Supprimer cette mesure ?')) return
    await deleteDoc(doc(db, 'animal_measurements', id))
  }

  return (
    <div className="space-y-3">
      {/* Sélecteur de métrique */}
      <div className="grid grid-cols-4 gap-1">
        {(Object.entries(METRIC_CFG) as [Metric, typeof METRIC_CFG.weightKg][]).map(([k, cfg]) => {
          const count = measurements.filter(m => m[k] != null).length
          return (
            <button
              key={k}
              onClick={() => setActiveMetric(k)}
              className={`py-2 rounded-lg text-[10px] font-bold border transition-all flex flex-col items-center gap-0.5 ${
                activeMetric === k
                  ? 'border-forest bg-forest text-white'
                  : 'border-border bg-white text-muted'
              }`}
            >
              <span>{cfg.label}</span>
              {count > 0 && <span className="text-[8px] opacity-70">{count} pts</span>}
            </button>
          )
        })}
      </div>

      {/* Graphique de la métrique active */}
      <ChartCard
        metric={activeMetric}
        measurements={sorted}
      />

      {/* Bouton + Saisir mesure */}
      {!isTemp && (open ? (
        <div className="bg-cream rounded-xl p-3 space-y-2 border border-forest/20">
          <div className="flex gap-2 items-center">
            <Calendar size={13} className="text-muted flex-shrink-0" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
                   className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] text-muted block mb-0.5">Poids (kg)</label>
              <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)}
                     placeholder="450"
                     className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
            </div>
            <div>
              <label className="text-[9px] text-muted block mb-0.5">Garrot (cm)</label>
              <input type="number" value={withers} onChange={e => setWithers(e.target.value)}
                     placeholder="148"
                     className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
            </div>
            <div>
              <label className="text-[9px] text-muted block mb-0.5">Poitrail (cm)</label>
              <input type="number" value={girth} onChange={e => setGirth(e.target.value)}
                     placeholder="180"
                     className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
            </div>
          </div>
          <div>
            <label className="text-[9px] text-muted block mb-1">ECS (1 = maigre, 3 = idéal, 5 = gras)</label>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setEcs(ecs === n ? undefined : n)}
                        className={`py-1.5 rounded-lg text-[11px] font-bold border ${
                          ecs === n
                            ? 'border-forest bg-forest text-white'
                            : 'border-border bg-white text-muted'
                        }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Note (contexte, pré humide, etc.)"
                 className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-forest text-white text-xs font-bold disabled:opacity-40">
              {saving ? '…' : 'Enregistrer'}
            </button>
            <button onClick={() => setOpen(false)}
                    className="px-3 py-2 rounded-lg border border-border text-xs text-muted">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
                className="w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold
                           active:bg-forest/10 flex items-center justify-center gap-1">
          <Plus size={12} /> Nouvelle mesure
        </button>
      ))}

      {/* Historique */}
      {sorted.length === 0 ? (
        <p className="text-xs text-muted text-center italic py-2">
          Aucune mesure encore.<br />
          Ajoutez-en régulièrement pour suivre l'évolution.
        </p>
      ) : (
        <div>
          <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1 pl-1">
            Historique ({sorted.length})
          </p>
          <ul className="space-y-1">
            {[...sorted].reverse().map(m => (
              <li key={m.id} className="flex items-center gap-2 bg-white rounded-lg p-2 border border-border/40">
                <Calendar size={11} className="text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-charcoal">
                    {new Date(m.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    <span className="ml-1 text-muted font-normal text-[9px]">
                      · par {users.find(u => u.uid === m.recordedBy)?.displayName ?? '—'}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted">
                    {m.weightKg  != null && `${m.weightKg} kg `}
                    {m.withersCm != null && `· ${m.withersCm} cm garrot `}
                    {m.girthCm   != null && `· ${m.girthCm} cm poitrail `}
                    {m.ecs       != null && `· ECS ${m.ecs}/${m.ecsScale === '1-9' ? '9' : '5'} `}
                  </p>
                  {m.note && <p className="text-[10px] text-charcoal italic">{m.note}</p>}
                </div>
                {!isTemp && (
                  <button onClick={() => remove(m.id)}
                          className="text-danger/30 active:text-danger p-1">
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Graphique SVG simple — une métrique, une courbe + points + min/max. */
function ChartCard({ metric, measurements }: { metric: Metric; measurements: AnimalMeasurement[] }) {
  const cfg = METRIC_CFG[metric]
  const points = useMemo(() => {
    return measurements
      .map(m => ({ ts: m.date, value: m[metric] }))
      .filter((p): p is { ts: number; value: number } => p.value != null)
  }, [measurements, metric])

  if (points.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border/40 p-6 text-center">
        <p className="text-xs text-muted italic">
          Pas encore de données pour <strong>{cfg.label}</strong>.
        </p>
      </div>
    )
  }

  // Bornes
  const minTs = points[0].ts
  const maxTs = points[points.length - 1].ts
  const spanTs = Math.max(1, maxTs - minTs)
  const values = points.map(p => p.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const pad  = Math.max(1, (maxV - minV) * 0.15)
  const yMin = minV - pad
  const yMax = maxV + pad
  const ySpan = Math.max(0.1, yMax - yMin)

  // Dimensions SVG (viewport responsive via width 100%)
  const W = 320, H = 120, PL = 30, PR = 8, PT = 10, PB = 18
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const x = (ts: number) => PL + (spanTs === 0 ? innerW / 2 : ((ts - minTs) / spanTs) * innerW)
  const y = (v: number)  => PT + (1 - (v - yMin) / ySpan) * innerH

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ')

  const lastPoint = points[points.length - 1]
  const firstPoint = points[0]
  const totalDelta = points.length > 1 ? lastPoint.value - firstPoint.value : 0
  const days = (lastPoint.ts - firstPoint.ts) / 86_400_000
  const trend = days > 0 ? (totalDelta / days) * 30 : 0  // par mois

  return (
    <div className="bg-white rounded-xl border border-border/40 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wider font-bold">{cfg.label}</p>
          <p className="text-xl font-bold m-0" style={{ color: cfg.color }}>
            {lastPoint.value.toFixed(cfg.precision)}<span className="text-xs ml-0.5 text-muted">{cfg.unit}</span>
          </p>
        </div>
        {points.length > 1 && (
          <div className="text-right">
            <p className="text-[10px] text-muted m-0">Tendance</p>
            <p className={`text-xs font-bold m-0 ${
              Math.abs(trend) < 0.5 ? 'text-meadow'
                : trend > 0 ? 'text-sun' : 'text-danger'
            }`}>
              {trend > 0 ? '+' : ''}{trend.toFixed(cfg.precision)}{cfg.unit}/mois
            </p>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        {/* Grille horizontale */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const yy = PT + t * innerH
          return (
            <line key={t} x1={PL} x2={W - PR} y1={yy} y2={yy}
                  stroke="#E5E7EB" strokeWidth={0.5} />
          )
        })}
        {/* Min / Max labels */}
        <text x={PL - 4} y={y(yMax) + 3} fontSize={9} textAnchor="end" fill="#6B7280">
          {yMax.toFixed(cfg.precision)}
        </text>
        <text x={PL - 4} y={y(yMin) + 3} fontSize={9} textAnchor="end" fill="#6B7280">
          {yMin.toFixed(cfg.precision)}
        </text>

        {/* Aire dégradée */}
        <defs>
          <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={cfg.color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={cfg.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {points.length > 1 && (
          <path d={`${pathD} L${x(maxTs).toFixed(1)},${PT + innerH} L${x(minTs).toFixed(1)},${PT + innerH} Z`}
                fill={`url(#grad-${metric})`} />
        )}

        {/* Courbe */}
        <path d={pathD} fill="none" stroke={cfg.color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />

        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.ts)} cy={y(p.value)} r={2.5}
                  fill="#fff" stroke={cfg.color} strokeWidth={1.5} />
        ))}

        {/* Labels début / fin */}
        {points.length > 1 && (
          <>
            <text x={PL} y={H - 4} fontSize={9} fill="#6B7280" textAnchor="start">
              {new Date(minTs).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
            </text>
            <text x={W - PR} y={H - 4} fontSize={9} fill="#6B7280" textAnchor="end">
              {new Date(maxTs).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}
