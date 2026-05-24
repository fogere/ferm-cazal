import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  collection, onSnapshot, addDoc, query, where,
} from '../services/firestoreMonitor'
import {
  ArrowLeft, Download, ClipboardPaste, Plus, Calendar, X,
} from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo } from '../services/species'
import type {
  Animal, EnclosureMovement, MapPin, UserProfile,
} from '../types'
import {
  dateInputToTs as dateInputToTsLocal,
  tsToDateInput as tsToDateInputLocal,
} from '../services/map/time'

type View = 'enclosure' | 'animal'

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
}

/**
 * Pin éligible à recevoir des animaux dans Grazing (refonte clôtures/espaces).
 * Depuis S9 : uniquement les land_plot. Une clôture, même refermée, n'est
 * jamais un espace — les fences fermés non-migrés (cas rare post-S3) ne
 * peuvent plus recevoir d'animaux. Demande Nils 22/05/2026.
 * Les plots scindés (S7, marqués inactive) sont exclus : ce sont leurs
 * 2 enfants qui reçoivent les animaux.
 */
function isEnclosureCandidate(pin: MapPin): boolean {
  return pin.type === 'land_plot'
    && (pin.points?.length ?? 0) >= 3
    && !pin.inactive
}

/**
 * Page "Calendrier de pâturage" — vue Gantt des présences animaux × enclos
 * sur les 12 derniers mois. Permet :
 *   - Saisie rétroactive de mouvements (pour reconstituer l'historique avant
 *     l'utilisation de l'app, ou corriger une omission)
 *   - Import en lot depuis un calendrier Excel/Numbers (TSV)
 *   - Export CSV format PAC (cheptel × parcelle × date entrée/sortie)
 *
 * Bug Benoît 20/05/2026 : "comment noter les mouvements, les dates car
 * lorsque l'on clique sur le crayon impossible de noter ? J'ai essayé un
 * copie coller de mon calendrier pacage"
 */
export default function Grazing() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, isTemp } = useAuth()
  const customSpecies = useCustomSpecies()

  const [animals,   setAnimals]   = useState<Animal[]>([])
  const [pins,      setPins]      = useState<MapPin[]>([])
  const [users,     setUsers]     = useState<UserProfile[]>([])
  const [movements, setMovements] = useState<EnclosureMovement[]>([])
  const [view, setView] = useState<View>('enclosure')
  const [windowMonths, setWindowMonths] = useState<6 | 12 | 24>(12)
  const [showAddMove, setShowAddMove] = useState(false)
  const [showPaste,   setShowPaste]   = useState(false)

  // Ouverture directe du modal "noter un mouvement" depuis la carte (bug Benoît 20/05/2026).
  // Le user clique sur "Noter un mouvement" depuis le détail d'un enclos → arrive ici avec
  // ?addFor=<fenceId>. On nettoie le param après ouverture pour ne pas le rouvrir au reload.
  useEffect(() => {
    if (searchParams.get('addFor') && !isTemp) {
      setShowAddMove(true)
      const next = new URLSearchParams(searchParams)
      next.delete('addFor')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, isTemp, setSearchParams])

  /* ─── Subscriptions ─── */
  useEffect(() => {
    const unsubA = onSnapshot(collection(db, 'animals'),
      s => setAnimals(s.docs.map(d => ({ id: d.id, ...d.data() } as Animal))))
    const unsubP = onSnapshot(query(collection(db, 'map_pins'), where('type', '==', 'fence')),
      s => setPins(s.docs.map(d => ({ id: d.id, ...d.data() } as MapPin))))
    const unsubU = onSnapshot(collection(db, 'users'),
      s => setUsers(s.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile))))
    const unsubM = onSnapshot(collection(db, 'enclosure_movements'),
      s => setMovements(s.docs.map(d => ({ id: d.id, ...d.data() } as EnclosureMovement))))
    return () => { unsubA(); unsubP(); unsubU(); unsubM() }
  }, [])

  /* ─── Calcul des périodes de présence (segments) ─── */
  const segments = useMemo(() => {
    // Pour chaque animal, on construit la chronologie des mouvements
    // puis on en déduit des segments (debut, fin, enclosureId).
    const byAnimal = new Map<string, EnclosureMovement[]>()
    for (const m of movements) {
      const arr = byAnimal.get(m.animalId) ?? []
      arr.push(m)
      byAnimal.set(m.animalId, arr)
    }
    const segs: Array<{
      animalId: string; animalName: string
      enclosureId: string | null; enclosureName: string | null
      start: number; end: number
    }> = []
    const now = Date.now()
    for (const a of animals) {
      const moves = (byAnimal.get(a.id) ?? []).sort((x, y) => x.movedAt - y.movedAt)
      if (moves.length === 0) {
        // Pas d'historique enregistré → segment unique = état courant depuis le début de la fenêtre
        if (a.enclosureId) {
          const enc = pins.find(p => p.id === a.enclosureId)
          segs.push({
            animalId: a.id, animalName: a.name,
            enclosureId: a.enclosureId, enclosureName: enc?.name ?? null,
            start: now - windowMonths * 30 * 86_400_000,
            end: now,
          })
        }
        continue
      }
      // Le premier mouvement : on commence avec son "from"
      const first = moves[0]
      if (first.fromEnclosureId) {
        segs.push({
          animalId: a.id, animalName: a.name,
          enclosureId: first.fromEnclosureId,
          enclosureName: first.fromEnclosureName ?? null,
          start: now - windowMonths * 30 * 86_400_000,
          end: first.movedAt,
        })
      }
      // Chaque mouvement crée un segment "to" jusqu'au mouvement suivant
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i]
        if (!m.toEnclosureId) continue
        const nextStart = moves[i + 1]?.movedAt ?? now
        segs.push({
          animalId: a.id, animalName: a.name,
          enclosureId: m.toEnclosureId, enclosureName: m.toEnclosureName ?? null,
          start: m.movedAt, end: nextStart,
        })
      }
    }
    return segs
  }, [movements, animals, pins, windowMonths])

  const windowStart = Date.now() - windowMonths * 30 * 86_400_000
  const windowEnd   = Date.now()

  /* ─── Export CSV format PAC ─── */
  function exportCsv() {
    const rows = [
      ['Animal', 'Espece', 'SIRE', 'Transpondeur', 'Enclos', 'Date entree', 'Date sortie', 'Jours'],
      ...segments
        .filter(s => s.end >= windowStart)
        .sort((a, b) => a.start - b.start)
        .map(s => {
          const a = animals.find(x => x.id === s.animalId)
          const days = Math.max(1, Math.round((s.end - Math.max(s.start, windowStart)) / 86_400_000))
          return [
            s.animalName,
            getSpeciesInfo(a?.species ?? '', customSpecies).label,
            a?.sireNumber ?? '',
            a?.transponderId ?? '',
            s.enclosureName ?? '—',
            tsToDateInputLocal(Math.max(s.start, windowStart)),
            tsToDateInputLocal(Math.min(s.end, windowEnd)),
            String(days),
          ]
        }),
    ]
    const csv = rows.map(r => r.map(c => /[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(';')).join('\n')
    // BOM UTF-8 pour Excel
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calendrier-pacage-${tsToDateInputLocal()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-full bg-cream pb-12">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <button onClick={() => navigate(-1)}
                  className="p-2 rounded-xl text-charcoal active:bg-cream flex items-center gap-1 text-xs font-semibold">
            <ArrowLeft size={16} /> Retour
          </button>
          <p className="text-sm font-bold text-charcoal m-0">🌿 Calendrier de pâturage</p>
          <div className="w-12" />
        </div>

        {/* Contrôles : vue + fenêtre + actions */}
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-1">
            {([['enclosure', '🌾 Par enclos'], ['animal', '🐎 Par animal']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        view === k ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
                      }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {([6, 12, 24] as const).map(m => (
              <button key={m} onClick={() => setWindowMonths(m)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                        windowMonths === m ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
                      }`}>
                {m} mois
              </button>
            ))}
          </div>
          {!isTemp && (
            <div className="flex gap-1">
              <button onClick={() => setShowAddMove(true)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-meadow/10 text-meadow border border-meadow/30 active:bg-meadow/20 flex items-center justify-center gap-1">
                <Plus size={12} /> Saisie rétroactive
              </button>
              <button onClick={() => setShowPaste(true)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-sky/10 text-sky border border-sky/30 active:bg-sky/20 flex items-center justify-center gap-1">
                <ClipboardPaste size={12} /> Coller depuis Excel
              </button>
              <button onClick={exportCsv}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-forest/10 text-forest border border-forest/30 active:bg-forest/20 flex items-center justify-center gap-1">
                <Download size={12} /> Export CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Gantt */}
      <div className="p-3">
        <GanttView
          view={view}
          segments={segments}
          windowStart={windowStart}
          windowEnd={windowEnd}
          pins={pins}
          animals={animals}
          customSpecies={customSpecies}
          onNavigateAnimal={(id) => navigate(`/animal/${id}`)}
        />
      </div>

      {showAddMove && (
        <AddMovementModal
          animals={animals}
          pins={pins.filter(isEnclosureCandidate)}
          currentUid={user?.uid}
          onClose={() => setShowAddMove(false)}
        />
      )}
      {showPaste && (
        <PasteImportModal
          animals={animals}
          pins={pins.filter(isEnclosureCandidate)}
          currentUid={user?.uid}
          users={users}
          onClose={() => setShowPaste(false)}
        />
      )}
    </div>
  )
}

/* ─── Vue Gantt ─── */
function GanttView({
  view, segments, windowStart, windowEnd, pins, animals, customSpecies, onNavigateAnimal,
}: {
  view: View
  segments: Array<{
    animalId: string; animalName: string
    enclosureId: string | null; enclosureName: string | null
    start: number; end: number
  }>
  windowStart: number; windowEnd: number
  pins: MapPin[]; animals: Animal[]
  customSpecies: import('../types').CustomSpecies[]
  onNavigateAnimal: (id: string) => void
}) {
  const span = windowEnd - windowStart
  const pct = (ts: number) => Math.max(0, Math.min(100, ((ts - windowStart) / span) * 100))

  // Génère les graduations mensuelles
  const monthMarks = useMemo(() => {
    const marks: { ts: number; label: string }[] = []
    const d = new Date(windowStart)
    d.setDate(1); d.setHours(0, 0, 0, 0)
    while (d.getTime() < windowEnd) {
      marks.push({
        ts: d.getTime(),
        label: d.toLocaleDateString('fr-FR', { month: 'short' }),
      })
      d.setMonth(d.getMonth() + 1)
    }
    return marks
  }, [windowStart, windowEnd])

  // Couleur stable par enclos (hash du nom)
  function colorFor(name: string | null): string {
    if (!name) return '#9CA3AF'
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff
    const hue = h % 360
    return `hsl(${hue}, 55%, 55%)`
  }

  // Group par enclos ou par animal
  const rows = useMemo(() => {
    if (view === 'enclosure') {
      const byEnc = new Map<string, typeof segments>()
      for (const s of segments) {
        const key = s.enclosureName ?? '—'
        const arr = byEnc.get(key) ?? []
        arr.push(s)
        byEnc.set(key, arr)
      }
      const sortedEnc = pins
        .filter(p => p.name)
        .map(p => p.name!)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .sort()
      // Inclut tout enclos cité dans des segments même s'il n'est plus dans pins
      for (const k of byEnc.keys()) if (!sortedEnc.includes(k)) sortedEnc.push(k)
      return sortedEnc.map(name => ({
        label: name,
        segments: (byEnc.get(name) ?? [])
          .filter(s => s.end >= windowStart && s.start <= windowEnd),
      }))
    } else {
      const byAnimal = new Map<string, typeof segments>()
      for (const s of segments) {
        const arr = byAnimal.get(s.animalId) ?? []
        arr.push(s)
        byAnimal.set(s.animalId, arr)
      }
      return animals
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map(a => ({
          label: a.name,
          animalId: a.id,
          emoji: getSpeciesInfo(a.species, customSpecies).emoji,
          segments: (byAnimal.get(a.id) ?? [])
            .filter(s => s.end >= windowStart && s.start <= windowEnd),
        }))
    }
  }, [view, segments, animals, pins, windowStart, windowEnd, customSpecies])

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted text-center italic py-6">
        Aucun mouvement enregistré sur la fenêtre choisie.
      </p>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
      {/* En-tête mois */}
      <div className="flex">
        <div className="w-28 flex-shrink-0 px-2 py-1.5 bg-cream border-b border-border text-[9px] font-bold text-muted uppercase tracking-wider">
          {view === 'enclosure' ? 'Enclos' : 'Animal'}
        </div>
        <div className="flex-1 relative h-7 bg-cream border-b border-border">
          {monthMarks.map((m, i) => (
            <div key={i}
                 className="absolute top-0 bottom-0 border-l border-border/50 flex items-center pl-1"
                 style={{ left: `${pct(m.ts)}%` }}>
              <span className="text-[9px] text-muted font-bold uppercase">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lignes */}
      <div className="divide-y divide-border/30">
        {rows.map((row, i) => (
          <div key={i} className="flex hover:bg-cream/40">
            <button
              onClick={() => view === 'animal' && 'animalId' in row && onNavigateAnimal(row.animalId as string)}
              className={`w-28 flex-shrink-0 px-2 py-2 text-[11px] font-semibold text-charcoal text-left truncate border-r border-border/30 ${
                view === 'animal' ? 'active:bg-cream' : ''
              }`}
            >
              {'emoji' in row && row.emoji ? `${row.emoji} ` : ''}{row.label}
            </button>
            <div className="flex-1 relative h-9 bg-white">
              {/* Graduations mensuelles légères */}
              {monthMarks.map((m, idx) => (
                <div key={idx}
                     className="absolute top-0 bottom-0 border-l border-border/30"
                     style={{ left: `${pct(m.ts)}%` }} />
              ))}
              {/* Segments */}
              {row.segments.map((s, idx) => {
                const left  = pct(s.start)
                const right = pct(s.end)
                const width = Math.max(0.5, right - left)
                const color = view === 'enclosure'
                  ? colorFor(s.animalName)
                  : colorFor(s.enclosureName)
                const tooltip = view === 'enclosure'
                  ? `${s.animalName} : ${fmtDate(s.start)} → ${fmtDate(s.end)}`
                  : `${s.enclosureName ?? 'libre'} : ${fmtDate(s.start)} → ${fmtDate(s.end)}`
                return (
                  <div key={idx}
                       title={tooltip}
                       className="absolute top-1.5 bottom-1.5 rounded-sm overflow-hidden"
                       style={{
                         left:  `${left}%`,
                         width: `${width}%`,
                         backgroundColor: color,
                       }}>
                    {width > 8 && (
                      <span className="block px-1 text-[8px] font-bold text-white truncate leading-tight pt-1">
                        {view === 'enclosure' ? s.animalName : s.enclosureName}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Modal : saisie rétroactive d'un mouvement ─── */
function AddMovementModal({
  animals, pins, currentUid, onClose,
}: {
  animals: Animal[]; pins: MapPin[]; currentUid?: string; onClose: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [toId, setToId] = useState<string>('')
  const [date, setDate] = useState(tsToDateInputLocal())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!currentUid || selectedIds.length === 0) return
    setSaving(true)
    try {
      const ts = dateInputToTsLocal(date)
      const now = Date.now()
      const targetEnc = toId ? pins.find(p => p.id === toId) : null
      for (const aid of selectedIds) {
        const a = animals.find(x => x.id === aid)
        if (!a) continue
        const fromEnc = a.enclosureId ? pins.find(p => p.id === a.enclosureId) : null
        await addDoc(collection(db, 'enclosure_movements'), {
          animalId: a.id, animalName: a.name, species: a.species,
          fromEnclosureId:   a.enclosureId ?? null,
          fromEnclosureName: fromEnc?.name ?? null,
          toEnclosureId:     toId || null,
          toEnclosureName:   targetEnc?.name ?? null,
          movedAt:    ts,
          movedBy:    currentUid,
          recordedAt: now,
          ...(note.trim() && { note: note.trim() }),
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[4000] bg-black/60 flex items-end sm:items-center justify-center"
         onClick={onClose}>
      <div className="bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-charcoal m-0">Saisie rétroactive</h3>
          <button onClick={onClose} className="p-1 text-muted active:text-charcoal">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">
              Date du mouvement
            </label>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-muted" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                     className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-sm" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">
              Animaux ({selectedIds.length} sélectionné{selectedIds.length > 1 ? 's' : ''})
            </label>
            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto p-1 bg-cream rounded-lg border border-border">
              {animals.map(a => {
                const on = selectedIds.includes(a.id)
                return (
                  <button key={a.id}
                          onClick={() => setSelectedIds(prev =>
                            on ? prev.filter(x => x !== a.id) : [...prev, a.id]
                          )}
                          className={`px-2 py-1 rounded-md text-xs font-bold border ${
                            on ? 'bg-forest text-white border-forest' : 'bg-white text-muted border-border'
                          }`}>
                    {a.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">
              Enclos cible
            </label>
            <select value={toId} onChange={e => setToId(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-sm">
              <option value="">— Libre (sorti des enclos) —</option>
              {pins.map(p => (
                <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
              ))}
            </select>
          </div>

          <input type="text" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Note (optionnelle)"
                 className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-sm" />

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving || selectedIds.length === 0 || !date}
                    className="flex-1 py-2.5 rounded-xl bg-forest text-white text-sm font-bold disabled:opacity-40">
              {saving ? 'Enregistrement…' : 'Enregistrer le mouvement'}
            </button>
            <button onClick={onClose}
                    className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted">
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Modal : import par collage TSV/CSV ─── */
function PasteImportModal({
  animals, pins, currentUid, onClose,
}: {
  animals: Animal[]; pins: MapPin[]; currentUid?: string; users: UserProfile[]
  onClose: () => void
}) {
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<Array<{
    animal: Animal | null
    animalRaw: string
    enclosure: MapPin | null
    enclosureRaw: string
    date: number | null
    dateRaw: string
    valid: boolean
  }>>([])
  const [saving, setSaving] = useState(false)

  function parse() {
    // Format attendu : Animal[TAB]Enclos[TAB]Date  (TSV) — accepte aussi ; et virgule
    const lines = raw.trim().split('\n').filter(l => l.trim())
    const out: typeof preview = []
    for (const line of lines) {
      const cells = line.split(/[\t;]/).map(c => c.trim())
      if (cells.length < 3) continue
      const [animalRaw, enclosureRaw, dateRaw] = cells

      const animal = animals.find(a =>
        a.name.toLowerCase() === animalRaw.toLowerCase()
      ) ?? null
      const enclosure = enclosureRaw && enclosureRaw.toLowerCase() !== 'libre'
        ? pins.find(p => (p.name ?? '').toLowerCase() === enclosureRaw.toLowerCase()) ?? null
        : null
      const date = parseDateFr(dateRaw)
      out.push({
        animal, animalRaw,
        enclosure, enclosureRaw,
        date, dateRaw,
        valid: !!animal && !!date,
      })
    }
    setPreview(out)
  }

  async function importAll() {
    if (!currentUid) return
    setSaving(true)
    try {
      const now = Date.now()
      for (const row of preview) {
        if (!row.valid || !row.animal || !row.date) continue
        await addDoc(collection(db, 'enclosure_movements'), {
          animalId:          row.animal.id,
          animalName:        row.animal.name,
          species:           row.animal.species,
          fromEnclosureId:   null,
          fromEnclosureName: null,
          toEnclosureId:     row.enclosure?.id ?? null,
          toEnclosureName:   row.enclosure?.name ?? null,
          movedAt:    row.date,
          movedBy:    currentUid,
          recordedAt: now,
          note:       'Import calendrier PAC',
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const validCount = preview.filter(p => p.valid).length

  return (
    <div className="fixed inset-0 z-[4000] bg-black/60 flex items-end sm:items-center justify-center"
         onClick={onClose}>
      <div className="bg-card w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-charcoal m-0">📋 Coller depuis Excel / Calendrier</h3>
          <button onClick={onClose} className="p-1 text-muted active:text-charcoal">
            <X size={18} />
          </button>
        </div>

        <p className="text-[11px] text-muted mb-2 leading-relaxed">
          Colle ici 3 colonnes : <strong>Animal</strong>, <strong>Enclos</strong>, <strong>Date</strong>.
          Séparateurs acceptés : tabulation, point-virgule. Date format : JJ/MM/AAAA, AAAA-MM-JJ ou JJ-MM-AA.
          Une ligne par mouvement. Mets <strong>libre</strong> dans la colonne enclos pour une sortie.
        </p>
        <pre className="text-[10px] text-muted bg-cream rounded-lg p-2 mb-2 overflow-x-auto">
{`Bagatelle    Pré 1    12/03/2026
Pippin       Pré 2    12/03/2026
Lila         libre    20/04/2026`}
        </pre>

        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          placeholder="Colle ici (Ctrl+V)…"
          rows={8}
          className="w-full px-2 py-2 rounded-lg border border-border bg-white text-xs font-mono"
        />

        <div className="flex gap-2 mt-2">
          <button onClick={parse}
                  className="flex-1 py-2 rounded-lg bg-sky/10 text-sky text-xs font-bold border border-sky/30">
            Aperçu ({raw.split('\n').filter(l => l.trim()).length} lignes)
          </button>
        </div>

        {preview.length > 0 && (
          <>
            <p className="text-xs font-bold text-charcoal mt-3 mb-1">
              Aperçu — {validCount} ligne{validCount > 1 ? 's' : ''} valide{validCount > 1 ? 's' : ''} / {preview.length}
            </p>
            <div className="bg-cream rounded-lg border border-border max-h-60 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-card border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Animal</th>
                    <th className="text-left px-2 py-1">Enclos</th>
                    <th className="text-left px-2 py-1">Date</th>
                    <th className="text-left px-2 py-1">État</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className={row.valid ? '' : 'bg-danger/5'}>
                      <td className="px-2 py-1">
                        {row.animal
                          ? <span className="text-meadow">✓ {row.animal.name}</span>
                          : <span className="text-danger">✗ {row.animalRaw}</span>}
                      </td>
                      <td className="px-2 py-1 text-muted">
                        {row.enclosure?.name ?? (row.enclosureRaw.toLowerCase() === 'libre' ? '(libre)' : `? ${row.enclosureRaw}`)}
                      </td>
                      <td className="px-2 py-1 text-muted">
                        {row.date ? fmtDate(row.date) : <span className="text-danger">{row.dateRaw}</span>}
                      </td>
                      <td className="px-2 py-1">{row.valid ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={importAll} disabled={saving || validCount === 0}
                      className="flex-1 py-2.5 rounded-xl bg-forest text-white text-sm font-bold disabled:opacity-40">
                {saving ? 'Import…' : `Importer ${validCount} mouvement${validCount > 1 ? 's' : ''}`}
              </button>
              <button onClick={onClose}
                      className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted">
                Annuler
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Parse JJ/MM/AAAA, AAAA-MM-JJ, JJ-MM-AAAA — retourne null si invalide
function parseDateFr(s: string): number | null {
  if (!s) return null
  const trimmed = s.trim()
  // ISO: 2026-03-12
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, y, m, d] = iso
    return new Date(+y, +m - 1, +d, 12, 0, 0).getTime()
  }
  // JJ/MM/AAAA ou JJ-MM-AAAA
  const fr = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (fr) {
    let [, d, m, y] = fr
    const yy = y.length === 2 ? 2000 + +y : +y
    return new Date(yy, +m - 1, +d, 12, 0, 0).getTime()
  }
  return null
}

