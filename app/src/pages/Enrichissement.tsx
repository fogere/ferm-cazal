import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, onSnapshot, doc, setDoc, deleteDoc,
} from '../services/firestoreMonitor'
import {
  ArrowLeft, Check, X, MapPin as MapPinIcon, Edit3,
  CircleDashed, CircleCheck, CircleSlash, FileText, Filter,
} from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import {
  PARCEL_QUESTIONS, PARCEL_QUESTIONS_BY_DOC,
} from '../data/parcelQuestions'
import type {
  ParcelQuestion, ParcelAnswer, Animal, MapPin,
} from '../types'
import LocationPicker, { type LatLng } from '../components/enrichissement/LocationPicker'

/**
 * Page Enrichissement — questionnaire familial pour compléter les fiches
 * terrain dans Firestore.
 *
 * Décisions UX 2026-05-27 :
 *   - 1 compte commun (la famille répond ensemble en 1 session)
 *   - n'importe qui peut valider — le bouton "Enregistrer" finalise
 *   - filtres par doc + par statut pour pouvoir attaquer un doc à la fois
 *   - chaque question : citation source + question + input + bouton enregistrer
 */

type Filter = 'all' | 'open' | 'answered' | 'skipped'

const STATUS_ICON: Record<'open' | 'answered' | 'skipped', ReactElement> = {
  open:     <CircleDashed size={18} className="text-muted" />,
  answered: <CircleCheck  size={18} className="text-meadow" />,
  skipped:  <CircleSlash  size={18} className="text-muted" />,
}

function StatusBadge({ count, color, label }: { count: number; color: string; label: string }) {
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-lg ${color}`}>
      <span className="text-xl font-bold">{count}</span>
      <span className="text-xs">{label}</span>
    </div>
  )
}

export default function Enrichissement() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [answers, setAnswers] = useState<Record<string, ParcelAnswer>>({})
  const [animals, setAnimals] = useState<Animal[]>([])
  const [landPlots, setLandPlots] = useState<MapPin[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [docFilter, setDocFilter] = useState<string | 'all'>('all')
  const [expandedQ, setExpandedQ] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<{ qId: string; mode: 'pin' | 'polygon' } | null>(null)

  // ─── Firestore listeners ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(collection(db, 'parcel_answers'), snap => {
      const map: Record<string, ParcelAnswer> = {}
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as ParcelAnswer })
      setAnswers(map)
    }, err => console.warn('[Enrichissement] answers:', err?.code))
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(collection(db, 'animals'), snap => {
      setAnimals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal)))
    }, err => console.warn('[Enrichissement] animals:', err?.code))
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(collection(db, 'map_pins'), snap => {
      const pins = snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))
      setLandPlots(pins)
    }, err => console.warn('[Enrichissement] pins:', err?.code))
    return unsub
  }, [user])

  // ─── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let open = 0, answered = 0, skipped = 0
    for (const q of PARCEL_QUESTIONS) {
      const a = answers[q.id]
      if (!a) open++
      else if (a.skipped) skipped++
      else answered++
    }
    return { total: PARCEL_QUESTIONS.length, open, answered, skipped }
  }, [answers])

  // ─── Liste filtrée ─────────────────────────────────────────────────────
  const docs = Object.keys(PARCEL_QUESTIONS_BY_DOC).sort()
  const visibleByDoc = useMemo(() => {
    const result: Record<string, ParcelQuestion[]> = {}
    for (const d of docs) {
      if (docFilter !== 'all' && d !== docFilter) continue
      const filtered = PARCEL_QUESTIONS_BY_DOC[d].filter(q => {
        const a = answers[q.id]
        const status: 'open' | 'answered' | 'skipped' =
          !a ? 'open' : a.skipped ? 'skipped' : 'answered'
        if (filter === 'all') return true
        return status === filter
      })
      if (filtered.length) result[d] = filtered
    }
    return result
  }, [filter, docFilter, answers, docs])

  // ─── Persistance ───────────────────────────────────────────────────────
  async function saveAnswer(q: ParcelQuestion, value: unknown, note?: string) {
    if (!user) return
    const payload: ParcelAnswer = {
      id:             q.id,
      value:          value as ParcelAnswer['value'],
      note:           note,
      answeredBy:     user.uid,
      answeredByName: profile?.displayName,
      answeredAt:     Date.now(),
    }
    try {
      await setDoc(doc(db, 'parcel_answers', q.id), payload as unknown as Record<string, unknown>)
    } catch (err) {
      console.error('[Enrichissement] save failed', err)
      alert('Erreur d\'enregistrement : ' + (err as Error).message)
    }
  }

  async function skipQuestion(q: ParcelQuestion, note?: string) {
    if (!user) return
    const payload: ParcelAnswer = {
      id:             q.id,
      value:          null,
      note:           note,
      skipped:        true,
      answeredBy:     user.uid,
      answeredByName: profile?.displayName,
      answeredAt:     Date.now(),
    }
    await setDoc(doc(db, 'parcel_answers', q.id), payload as unknown as Record<string, unknown>)
  }

  async function clearAnswer(q: ParcelQuestion) {
    if (!user) return
    if (!confirm('Effacer cette réponse ?')) return
    try {
      await deleteDoc(doc(db, 'parcel_answers', q.id))
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="p-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-semibold">Enrichissement terrains</h1>
        <div className="w-9" />
      </div>

      {/* Présentation */}
      <div className="bg-card rounded-lg p-3 mb-3 text-sm">
        <p className="mb-2">
          <FileText size={16} className="inline mr-1 -mt-0.5" />
          Questionnaire familial pour compléter les fiches papier des terrains.
        </p>
        <p className="text-xs text-muted">
          Vous répondez ensemble, sur 1 seul compte. Chaque question cite directement la
          fiche d'origine pour que vous la reconnaissiez. Les réponses sont enregistrées au fur
          et à mesure et serviront à compléter la carte et les mouvements de pâturage.
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-2 mb-3">
        <StatusBadge count={stats.open}     color="bg-bg-muted" label="À répondre" />
        <StatusBadge count={stats.answered} color="bg-meadow/20 text-meadow" label="Répondues" />
        <StatusBadge count={stats.skipped}  color="bg-bg-muted" label="Skippées" />
        <StatusBadge count={stats.total}    color="bg-bg-muted" label="Total" />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <div className="flex items-center gap-1 mr-2">
          <Filter size={12} className="text-muted" />
          <span className="text-muted">Filtres :</span>
        </div>
        {(['open', 'answered', 'skipped', 'all'] as Filter[]).map(f => (
          <button key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded ${filter === f ? 'bg-forest text-white' : 'bg-bg-muted'}`}>
            {f === 'open' ? `À répondre (${stats.open})`
             : f === 'answered' ? `Répondues (${stats.answered})`
             : f === 'skipped' ? `Skippées (${stats.skipped})`
             : `Toutes (${stats.total})`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 mb-4 text-xs">
        <button onClick={() => setDocFilter('all')}
                className={`px-2 py-1 rounded ${docFilter === 'all' ? 'bg-forest text-white' : 'bg-bg-muted'}`}>
          Tous les docs
        </button>
        {docs.map(d => (
          <button key={d}
                  onClick={() => setDocFilter(d === docFilter ? 'all' : d)}
                  className={`px-2 py-1 rounded ${docFilter === d ? 'bg-forest text-white' : 'bg-bg-muted'}`}>
            {d.replace('fichier/', '').replace(/\.(docx|odt|odp)$/, '')}
          </button>
        ))}
      </div>

      {/* Questions par doc */}
      {Object.keys(visibleByDoc).length === 0 && (
        <div className="text-center text-muted py-8 text-sm">
          Aucune question dans ce filtre.
        </div>
      )}
      {Object.entries(visibleByDoc).map(([docName, qs]) => (
        <div key={docName} className="mb-6">
          <h2 className="text-sm font-semibold mb-2 text-forest">
            📄 {docName.replace('fichier/', '').replace(/\.(docx|odt|odp)$/, '')}
          </h2>
          {qs.map(q => (
            <QuestionCard
              key={q.id}
              q={q}
              answer={answers[q.id]}
              animals={animals}
              landPlots={landPlots}
              expanded={expandedQ.has(q.id)}
              onToggle={() => {
                setExpandedQ(prev => {
                  const next = new Set(prev)
                  if (next.has(q.id)) next.delete(q.id); else next.add(q.id)
                  return next
                })
              }}
              onSave={(value, note) => saveAnswer(q, value, note)}
              onSkip={(note) => skipQuestion(q, note)}
              onClear={() => clearAnswer(q)}
              onOpenPicker={(mode) => setPicker({ qId: q.id, mode })}
            />
          ))}
        </div>
      ))}

      {/* Map picker modal */}
      {picker && (
        <LocationPicker
          mode={picker.mode}
          onCancel={() => setPicker(null)}
          onConfirm={(value) => {
            const q = PARCEL_QUESTIONS.find(x => x.id === picker.qId)!
            saveAnswer(q, value)
            setPicker(null)
          }}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// QuestionCard — rend une question + son input selon le type
// ───────────────────────────────────────────────────────────────────────────

interface QuestionCardProps {
  q:           ParcelQuestion
  answer?:     ParcelAnswer
  animals:     Animal[]
  landPlots:   MapPin[]
  expanded:    boolean
  onToggle:    () => void
  onSave:      (value: unknown, note?: string) => void
  onSkip:      (note?: string) => void
  onClear:     () => void
  onOpenPicker: (mode: 'pin' | 'polygon') => void
}

function QuestionCard({
  q, answer, animals, landPlots, expanded, onToggle, onSave, onSkip, onClear, onOpenPicker,
}: QuestionCardProps) {
  const status: 'open' | 'answered' | 'skipped' =
    !answer ? 'open' : answer.skipped ? 'skipped' : 'answered'

  // États locaux pour les inputs
  const [textVal,   setTextVal]   = useState<string>(typeof answer?.value === 'string' ? answer.value : '')
  const [choiceVal, setChoiceVal] = useState<string>(typeof answer?.value === 'string' ? answer.value : '')
  const [multiVal,  setMultiVal]  = useState<string[]>(Array.isArray(answer?.value) ? answer.value as string[] : [])
  const [yesNoVal,  setYesNoVal]  = useState<'yes' | 'no' | 'unknown' | ''>(
    answer?.value === 'yes' || answer?.value === 'no' || answer?.value === 'unknown' ? answer.value : ''
  )
  const [dateVal,   setDateVal]   = useState<string>(typeof answer?.value === 'string' ? answer.value : '')
  const [animalsVal, setAnimalsVal] = useState<string[]>(Array.isArray(answer?.value) ? answer.value as string[] : [])
  const [plotVal,   setPlotVal]   = useState<string>(typeof answer?.value === 'string' ? answer.value : '')
  const [noteVal,   setNoteVal]   = useState<string>(answer?.note || '')

  const isCollapsed = !expanded && status !== 'open'

  return (
    <div className={`bg-card rounded-lg p-3 mb-2 border ${
      status === 'answered' ? 'border-meadow/30' :
      status === 'skipped'  ? 'border-border opacity-60' :
      'border-border'}`}>

      {/* Header — toujours visible */}
      <button onClick={onToggle}
              className="w-full flex items-start gap-2 text-left">
        {STATUS_ICON[status]}
        <div className="flex-1">
          <div className="text-sm font-medium">{q.question}</div>
          {isCollapsed && answer && !answer.skipped && (
            <div className="text-xs text-muted mt-0.5">
              <Check size={11} className="inline mr-1" />
              Répondu — clique pour modifier
            </div>
          )}
          {isCollapsed && answer?.skipped && (
            <div className="text-xs text-muted mt-0.5">
              <X size={11} className="inline mr-1" /> Skippée
            </div>
          )}
        </div>
      </button>

      {/* Corps de la question — affiché si ouvert ou pas encore répondu */}
      {!isCollapsed && (
        <div className="mt-3 ml-7 space-y-3">
          {/* Citation source */}
          <blockquote className="border-l-4 border-forest/40 pl-3 py-1 italic text-xs bg-bg-muted/50 rounded-r">
            {q.sourceQuote}
          </blockquote>

          {/* Contexte */}
          {q.context && (
            <div className="text-xs text-muted">
              💡 {q.context}
            </div>
          )}

          {/* Input selon le type */}
          {q.questionType === 'text' && (
            <input type="text"
                   value={textVal}
                   onChange={e => setTextVal(e.target.value)}
                   className="w-full px-3 py-2 rounded border border-border bg-input text-sm"
                   placeholder="Réponse courte…" />
          )}

          {q.questionType === 'long_text' && (
            <textarea
              value={textVal}
              onChange={e => setTextVal(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded border border-border bg-input text-sm"
              placeholder="Décris en quelques lignes…"
            />
          )}

          {q.questionType === 'yes_no' && (
            <div className="flex gap-2">
              {(['yes', 'no', 'unknown'] as const).map(v => (
                <button key={v}
                        onClick={() => setYesNoVal(v)}
                        className={`flex-1 py-2 rounded text-sm ${
                          yesNoVal === v ? 'bg-forest text-white' : 'bg-bg-muted'
                        }`}>
                  {v === 'yes' ? 'Oui' : v === 'no' ? 'Non' : 'On ne sait pas'}
                </button>
              ))}
            </div>
          )}

          {q.questionType === 'single_choice' && q.options && (
            <div className="space-y-1">
              {q.options.map(opt => (
                <button key={opt.id}
                        onClick={() => setChoiceVal(opt.id)}
                        className={`w-full text-left px-3 py-2 rounded text-sm ${
                          choiceVal === opt.id ? 'bg-forest text-white' : 'bg-bg-muted'
                        }`}>
                  <div>{opt.label}</div>
                  {opt.hint && (
                    <div className={`text-xs ${choiceVal === opt.id ? 'text-white/70' : 'text-muted'}`}>
                      {opt.hint}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {q.questionType === 'multi_choice' && q.options && (
            <div className="space-y-1">
              {q.options.map(opt => {
                const checked = multiVal.includes(opt.id)
                return (
                  <button key={opt.id}
                          onClick={() => setMultiVal(prev =>
                            checked ? prev.filter(x => x !== opt.id) : [...prev, opt.id])}
                          className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                            checked ? 'bg-forest text-white' : 'bg-bg-muted'
                          }`}>
                    <input type="checkbox" readOnly checked={checked}
                           className="pointer-events-none" />
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {q.questionType === 'date' && (
            <input type="date"
                   value={dateVal}
                   onChange={e => setDateVal(e.target.value)}
                   className="w-full px-3 py-2 rounded border border-border bg-input text-sm" />
          )}

          {q.questionType === 'animals_pick' && (
            <AnimalsMultiSelect
              animals={animals}
              selected={animalsVal}
              onChange={setAnimalsVal}
            />
          )}

          {q.questionType === 'plot_pick' && (
            <PlotSinglePicker
              landPlots={landPlots}
              selected={plotVal}
              onChange={setPlotVal}
            />
          )}

          {(q.questionType === 'pin_on_map' || q.questionType === 'polygon_on_map') && (
            <div className="space-y-2">
              <button
                onClick={() => onOpenPicker(q.questionType === 'pin_on_map' ? 'pin' : 'polygon')}
                className="w-full px-3 py-3 rounded bg-forest text-white text-sm flex items-center justify-center gap-2">
                <MapPinIcon size={16} />
                {q.questionType === 'pin_on_map'
                  ? (answer?.value ? 'Modifier le point sur la carte' : 'Ouvrir la carte pour placer le point')
                  : (answer?.value ? 'Modifier le contour' : 'Ouvrir la carte pour dessiner le contour')}
              </button>
              {!!answer?.value && (
                <div className="text-xs text-muted">
                  {q.questionType === 'pin_on_map'
                    ? `Point actuel : ${(answer.value as LatLng).lat?.toFixed(5)}, ${(answer.value as LatLng).lng?.toFixed(5)}`
                    : `Contour actuel : ${(answer.value as LatLng[]).length} points`}
                </div>
              )}
            </div>
          )}

          {/* Note libre */}
          <textarea
            value={noteVal}
            onChange={e => setNoteVal(e.target.value)}
            rows={2}
            placeholder="Note ou précision (facultatif)…"
            className="w-full px-3 py-2 rounded border border-border bg-input text-xs"
          />

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                let value: unknown
                if (q.questionType === 'text' || q.questionType === 'long_text') value = textVal
                else if (q.questionType === 'yes_no') value = yesNoVal
                else if (q.questionType === 'single_choice') value = choiceVal
                else if (q.questionType === 'multi_choice') value = multiVal
                else if (q.questionType === 'date') value = dateVal
                else if (q.questionType === 'animals_pick') value = animalsVal
                else if (q.questionType === 'plot_pick') value = plotVal
                else if (q.questionType === 'pin_on_map' || q.questionType === 'polygon_on_map') {
                  // For map types, the picker handles save directly. This button is for note-only updates.
                  if (!answer?.value) {
                    alert('Place d\'abord un point/contour avec la carte.')
                    return
                  }
                  value = answer.value
                }
                onSave(value, noteVal || undefined)
              }}
              disabled={
                (q.questionType === 'text' && !textVal.trim()) ||
                (q.questionType === 'long_text' && !textVal.trim()) ||
                (q.questionType === 'yes_no' && !yesNoVal) ||
                (q.questionType === 'single_choice' && !choiceVal) ||
                (q.questionType === 'multi_choice' && multiVal.length === 0) ||
                (q.questionType === 'date' && !dateVal) ||
                (q.questionType === 'animals_pick' && animalsVal.length === 0) ||
                (q.questionType === 'plot_pick' && !plotVal)
              }
              className="flex-1 px-3 py-2 rounded bg-forest text-white text-sm flex items-center justify-center gap-1 disabled:opacity-50">
              <Check size={14} /> Enregistrer
            </button>
            <button
              onClick={() => onSkip(noteVal || undefined)}
              className="px-3 py-2 rounded bg-bg-muted text-sm flex items-center gap-1">
              <CircleSlash size={14} /> Skipper
            </button>
            {answer && (
              <button
                onClick={onClear}
                className="px-3 py-2 rounded bg-bg-muted text-sm flex items-center gap-1">
                <Edit3 size={14} /> Effacer
              </button>
            )}
          </div>

          {answer && (
            <div className="text-xs text-muted pt-1 border-t border-border">
              Dernière action par {answer.answeredByName || 'utilisateur'} le {
                new Date(answer.answeredAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
              }
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers : multi-sélection animaux, choix de plot ──

function AnimalsMultiSelect({ animals, selected, onChange }: {
  animals: Animal[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const sorted = [...animals].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return (
    <div className="border border-border rounded p-2 max-h-60 overflow-y-auto bg-bg-muted/30">
      {sorted.length === 0 && <div className="text-xs text-muted">Chargement du cheptel…</div>}
      <div className="grid grid-cols-2 gap-1">
        {sorted.map(a => {
          const checked = selected.includes(a.id)
          return (
            <button key={a.id}
                    onClick={() => onChange(checked ? selected.filter(x => x !== a.id) : [...selected, a.id])}
                    className={`text-left px-2 py-1 rounded text-xs flex items-center gap-1 ${
                      checked ? 'bg-forest text-white' : 'bg-card'
                    }`}>
              <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
              <span>{a.name}</span>
            </button>
          )
        })}
      </div>
      {selected.length > 0 && (
        <div className="text-xs text-muted mt-2">{selected.length} animal{selected.length > 1 ? 'aux' : ''} sélectionné{selected.length > 1 ? 's' : ''}</div>
      )}
    </div>
  )
}

function PlotSinglePicker({ landPlots, selected, onChange }: {
  landPlots: MapPin[]
  selected: string
  onChange: (id: string) => void
}) {
  const sorted = [...landPlots].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  // Option spéciale "à créer / aucun"
  return (
    <div className="border border-border rounded p-2 max-h-60 overflow-y-auto bg-bg-muted/30">
      <button
        onClick={() => onChange('__create__')}
        className={`w-full text-left px-2 py-1 rounded text-xs mb-1 ${
          selected === '__create__' ? 'bg-forest text-white' : 'bg-card'
        }`}>
        ➕ Aucun ne correspond — à créer
      </button>
      <button
        onClick={() => onChange('__unknown__')}
        className={`w-full text-left px-2 py-1 rounded text-xs mb-1 ${
          selected === '__unknown__' ? 'bg-forest text-white' : 'bg-card'
        }`}>
        ❓ On ne sait pas
      </button>
      <div className="border-t border-border mt-1 pt-1">
        {sorted.map(p => (
          <button key={p.id}
                  onClick={() => onChange(p.id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${
                    selected === p.id ? 'bg-forest text-white' : 'bg-card'
                  }`}>
            {p.name}{p.type !== 'land_plot' ? ` (${p.type})` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
