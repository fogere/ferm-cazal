import { useEffect, useState, useMemo } from 'react'
import {
  Plus, X, CheckCircle2, Circle, AlertTriangle, RotateCcw, ChevronDown, ChevronRight, Trash2,
} from 'lucide-react'
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import type { Task, UserProfile, TempUser, Availability } from '../types'

/* ─── helpers ─── */

const DAYS_FR  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
const MONTHS_FR = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']

function getDayRange(offset = 0) {
  const s = new Date(); s.setDate(s.getDate() + offset); s.setHours(0,0,0,0)
  const e = new Date(s); e.setHours(23,59,59,999)
  return [s.getTime(), e.getTime()] as const
}

function dateLabel(ts: number): string {
  const [s0, e0] = getDayRange(0)
  const [s1, e1] = getDayRange(1)
  if (ts >= s0 && ts <= e0) return "Aujourd'hui"
  if (ts >= s1 && ts <= e1) return 'Demain'
  const d = new Date(ts)
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
}

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming'

function getBucket(ts: number): Bucket {
  const [s0, e0] = getDayRange(0)
  const [, e1]   = getDayRange(1)
  if (ts <  s0) return 'overdue'
  if (ts <= e0) return 'today'
  if (ts <= e1) return 'tomorrow'
  return 'upcoming'
}

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue:  'En retard',
  today:    "Aujourd'hui",
  tomorrow: 'Demain',
  upcoming: 'À venir',
}

const AVAIL_STYLE: Record<Availability, { dot: string; label: string }> = {
  available:   { dot: 'bg-meadow', label: 'Disponible' },
  limited:     { dot: 'bg-sun',    label: 'Limité' },
  unavailable: { dot: 'bg-danger', label: 'Indisponible' },
}

function todayInputValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function dateInputToTs(s: string): number {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day, 12, 0, 0).getTime()
}

/* ─── form state ─── */

interface FormState {
  title: string
  zone: string
  assignedTo: string
  dueDate: string
  recurrence: Task['recurrence']
  priority: Task['priority']
}

function blankForm(uid: string): FormState {
  return { title: '', zone: '', assignedTo: uid, dueDate: todayInputValue(), recurrence: 'once', priority: 'normal' }
}

/* ─── component ─── */

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'upcoming']

export default function Tasks() {
  const { user, isTemp } = useAuth()

  const [tab, setTab]               = useState<'mine' | 'team'>('mine')
  const [allTasks, setAllTasks]     = useState<Task[]>([])
  const [users, setUsers]           = useState<UserProfile[]>([])
  const [tempUsers, setTempUsers]   = useState<TempUser[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState<FormState>(() => blankForm(user?.uid ?? ''))
  const [saving, setSaving]         = useState(false)
  const [showDone, setShowDone]     = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* real-time listeners */

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'tasks')), snap =>
      setAllTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)))
    )
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'users')), snap =>
      setUsers(snap.docs.map(d => d.data() as UserProfile))
    )
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tempUsers'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as TempUser))
      setTempUsers(items.filter(t => t.active))
    })
    return unsub
  }, [])

  /* derived */

  const myTasks      = useMemo(() => allTasks.filter(t => t.assignedTo === user?.uid), [allTasks, user])
  const pendingMine  = useMemo(() => myTasks.filter(t => !t.completed).sort((a,b) => a.dueDate - b.dueDate), [myTasks])
  const doneMine     = useMemo(() => myTasks.filter(t =>  t.completed).sort((a,b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)), [myTasks])
  const pendingAll   = useMemo(() => allTasks.filter(t => !t.completed).sort((a,b) => a.dueDate - b.dueDate), [allTasks])

  // Score de charge par utilisateur (tâches en attente cette semaine)
  const weekFromNow = Date.now() + 7 * 86_400_000
  const loadByUser = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of users) {
      const count = allTasks.filter(t =>
        t.assignedTo === u.uid && !t.completed && t.dueDate <= weekFromNow
      ).length
      // Si "limité" → on multiplie pour qu'il reçoive moins en auto
      const factor = u.availability === 'limited' ? 2 : 1
      map.set(u.uid, count * factor)
    }
    return map
  }, [allTasks, users, weekFromNow])

  // Choisit l'utilisateur le moins chargé (exclut indisponibles)
  function pickLeastLoaded(): string | null {
    const eligible = users.filter(u => u.availability !== 'unavailable')
    if (eligible.length === 0) return null
    eligible.sort((a, b) => (loadByUser.get(a.uid) ?? 0) - (loadByUser.get(b.uid) ?? 0))
    return eligible[0].uid
  }

  const grouped = useMemo(() => {
    const source = tab === 'mine' ? pendingMine : pendingAll
    const map: Record<Bucket, Task[]> = { overdue: [], today: [], tomorrow: [], upcoming: [] }
    source.forEach(t => map[getBucket(t.dueDate)].push(t))
    return map
  }, [tab, pendingMine, pendingAll])

  const [todayS, todayE] = getDayRange(0)

  /* actions */

  async function toggleTask(task: Task) {
    const nowDone = !task.completed
    const updates: Record<string, unknown> = {
      completed:   nowDone,
      completedAt: nowDone ? Date.now() : null,
      completedBy: nowDone ? user?.uid  : null,
    }
    if (nowDone && task.recurrence !== 'once' && !task.nextOccurrenceCreated) {
      const next = new Date(task.dueDate)
      if (task.recurrence === 'daily')  next.setDate(next.getDate() + 1)
      if (task.recurrence === 'weekly') next.setDate(next.getDate() + 7)
      await addDoc(collection(db, 'tasks'), {
        title: task.title, zone: task.zone, assignedTo: task.assignedTo,
        recurrence: task.recurrence, priority: task.priority,
        completed: false, completedAt: null, completedBy: null,
        createdAt: Date.now(), createdBy: task.createdBy,
        dueDate: next.getTime(),
      })
      updates.nextOccurrenceCreated = true
    }
    await updateDoc(doc(db, 'tasks', task.id), updates)
  }

  function openForm() {
    setForm(blankForm(user?.uid ?? ''))
    setShowForm(true)
  }

  async function deleteTask(id: string) {
    setConfirmDeleteId(null)
    await deleteDoc(doc(db, 'tasks', id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !user) return
    setSaving(true)
    try {
      // Si "auto", on choisit l'utilisateur le moins chargé (parmi disponibles + limités)
      let assignedTo = form.assignedTo
      if (assignedTo === 'auto') {
        assignedTo = pickLeastLoaded() ?? user.uid
      }
      await addDoc(collection(db, 'tasks'), {
        title:      form.title.trim(),
        zone:       form.zone.trim(),
        assignedTo,
        recurrence: form.recurrence,
        priority:   form.priority,
        completed:  false,
        completedAt: null,
        completedBy: null,
        createdAt:  Date.now(),
        createdBy:  user.uid,
        dueDate:    dateInputToTs(form.dueDate),
      })
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  /* render helpers */

  function TaskRow({ task }: { task: Task }) {
    const assignee    = users.find(u => u.uid === task.assignedTo)
    const tempAssigne = !assignee ? tempUsers.find(t => t.id === task.assignedTo) : null
    const bkt = getBucket(task.dueDate)
    const confirming = confirmDeleteId === task.id

    return (
      <li>
        {confirming ? (
          <div className="flex items-center gap-3 py-3 px-1">
            <Trash2 size={18} className="text-danger flex-shrink-0" />
            <span className="flex-1 text-sm text-danger font-medium">Supprimer cette tâche ?</span>
            <button
              onClick={() => deleteTask(task.id)}
              className="px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-semibold active:opacity-80"
            >
              Oui
            </button>
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="px-3 py-1.5 rounded-lg border border-border text-muted text-xs font-semibold active:bg-cream"
            >
              Non
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <button
              onClick={() => toggleTask(task)}
              className="flex-1 flex items-start gap-3 py-3 px-1 rounded-xl active:bg-cream transition-colors text-left"
            >
              {task.completed
                ? <CheckCircle2 size={22} className="text-meadow flex-shrink-0 mt-0.5" />
                : <Circle size={22} className="text-border flex-shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-snug ${task.completed ? 'line-through text-muted' : 'text-charcoal'}`}>
                  {task.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {task.zone && (
                    <span className="text-xs text-muted bg-cream px-2 py-0.5 rounded-full border border-border">
                      {task.zone}
                    </span>
                  )}
                  {task.recurrence !== 'once' && (
                    <span className="text-xs text-sky flex items-center gap-0.5">
                      <RotateCcw size={10} />
                      {task.recurrence === 'daily' ? 'Quotidien' : 'Hebdo'}
                    </span>
                  )}
                  {tab === 'team' && assignee && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: assignee.color }}
                    >
                      {assignee.displayName}
                    </span>
                  )}
                  {tab === 'team' && tempAssigne && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-earth/20 text-earth">
                      {tempAssigne.displayName}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {task.priority === 'urgent' && !task.completed && (
                  <AlertTriangle size={14} className="text-danger" />
                )}
                {!task.completed && (
                  <span className={`text-xs ${bkt === 'overdue' ? 'text-danger font-semibold' : 'text-muted'}`}>
                    {dateLabel(task.dueDate)}
                  </span>
                )}
              </div>
            </button>
            {!isTemp && (
              <button
                onClick={() => setConfirmDeleteId(task.id)}
                className="p-2.5 mt-1 text-border active:text-danger transition-colors flex-shrink-0"
                aria-label="Supprimer"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </li>
    )
  }

  /* ─── JSX ─── */

  const isEmpty = tab === 'mine' ? pendingMine.length === 0 : pendingAll.length === 0

  return (
    <div className="pb-4">

      {/* Header */}
      <div className="px-5 pt-12 pb-5" style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)' }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-white text-2xl font-bold m-0">Tâches</h1>
          {!isTemp && (
            <button
              onClick={openForm}
              className="flex items-center gap-1.5 bg-meadow text-white text-sm font-semibold px-3.5 py-2 rounded-xl active:scale-95 transition-all"
            >
              <Plus size={16} /> Nouvelle
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {(['mine', 'team'] as const).map(v => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === v ? 'bg-white text-forest' : 'bg-white/15 text-white/80'
              }`}
            >
              {v === 'mine' ? 'Mes tâches' : 'Équipe'}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-3 space-y-4">

        {/* Team cards (équipe tab only) */}
        {tab === 'team' && users.length > 0 && (
          <div className="space-y-3">
            {users.map(u => {
              const todayU  = allTasks.filter(t => t.assignedTo === u.uid && t.dueDate >= todayS && t.dueDate <= todayE)
              const doneU   = todayU.filter(t => t.completed).length
              const totalU  = todayU.length
              const avail   = AVAIL_STYLE[u.availability] ?? AVAIL_STYLE.available
              return (
                <div key={u.uid} className="bg-card rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                      style={{ backgroundColor: u.color }}
                    >
                      {u.displayName.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="text-charcoal font-semibold text-sm">{u.displayName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${avail.dot}`} />
                        <span className="text-xs text-muted">{avail.label}</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-charcoal">
                      {totalU === 0 ? '—' : `${doneU}/${totalU}`}
                    </span>
                  </div>
                  {totalU > 0 && (
                    <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-meadow transition-all duration-500"
                        style={{ width: `${(doneU / totalU) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Task groups */}
        {BUCKET_ORDER.map(b => {
          const tasks = grouped[b]
          if (!tasks.length) return null
          return (
            <div key={b}>
              <p className={`text-xs font-semibold uppercase tracking-wider px-1 mb-2 ${b === 'overdue' ? 'text-danger' : 'text-muted'}`}>
                {BUCKET_LABELS[b]} ({tasks.length})
              </p>
              <div className="bg-card rounded-2xl px-3 shadow-sm">
                <ul className="divide-y divide-border/50">
                  {tasks.map(t => <TaskRow key={t.id} task={t} />)}
                </ul>
              </div>
            </div>
          )
        })}

        {/* Empty state */}
        {isEmpty && (
          <div className="py-14 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-charcoal font-semibold mb-1">Tout est fait !</p>
            <p className="text-muted text-sm">Aucune tâche en attente</p>
          </div>
        )}

        {/* Completed (mine tab) */}
        {tab === 'mine' && doneMine.length > 0 && (
          <div>
            <button
              onClick={() => setShowDone(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider px-1 mb-2"
            >
              {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Complétées ({doneMine.length})
            </button>
            {showDone && (
              <div className="bg-card rounded-2xl px-3 shadow-sm">
                <ul className="divide-y divide-border/50">
                  {doneMine.slice(0, 15).map(t => <TaskRow key={t.id} task={t} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom sheet — task form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !saving && setShowForm(false)}
          />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto">

            {/* Sheet header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-charcoal text-lg font-bold m-0">Nouvelle tâche</h2>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="p-2 rounded-xl text-muted active:bg-cream"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Titre */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Titre *
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="ex: Vérifier eau pré nord"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest
                             focus:border-transparent transition-all"
                  autoFocus
                  required
                  disabled={saving}
                />
              </div>

              {/* Zone */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Zone (optionnel)
                </label>
                <input
                  type="text"
                  value={form.zone}
                  onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  placeholder="ex: Pré nord, Bergerie…"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest
                             focus:border-transparent transition-all"
                  disabled={saving}
                />
              </div>

              {/* Assigné à */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Assigné à
                </label>
                <div className="flex gap-2 flex-wrap">
                  {/* Auto : choisit le moins chargé */}
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, assignedTo: 'auto' }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                      form.assignedTo === 'auto'
                        ? 'border-sky text-sky bg-sky/10'
                        : 'border-border text-muted bg-cream'
                    }`}
                    disabled={saving}
                  >
                    <span className="w-6 h-6 rounded-full flex items-center justify-center bg-sky/20 text-sky text-xs font-bold flex-shrink-0">
                      ⚡
                    </span>
                    Auto
                  </button>
                  {users.map(u => {
                    const load = loadByUser.get(u.uid) ?? 0
                    const unavailable = u.availability === 'unavailable'
                    return (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, assignedTo: u.uid }))}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                          form.assignedTo === u.uid
                            ? 'border-forest text-forest bg-forest/10'
                            : 'border-border text-muted bg-cream'
                        } ${unavailable ? 'opacity-60' : ''}`}
                        disabled={saving}
                      >
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: u.color }}
                        >
                          {u.displayName.charAt(0)}
                        </span>
                        {u.displayName}
                        <span className="text-xs font-bold opacity-60">{load}</span>
                        {u.availability === 'limited' && (
                          <span className="text-[10px] text-sun">⊘</span>
                        )}
                        {unavailable && (
                          <span className="text-[10px] text-danger">✕</span>
                        )}
                      </button>
                    )
                  })}
                  {tempUsers.map(tu => (
                    <button
                      key={tu.id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, assignedTo: tu.id }))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                        form.assignedTo === tu.id
                          ? 'border-earth text-earth bg-earth/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                      disabled={saving}
                    >
                      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-earth/20 text-earth text-xs font-bold flex-shrink-0">
                        {tu.displayName.charAt(0)}
                      </span>
                      {tu.displayName}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent transition-all"
                  disabled={saving}
                />
              </div>

              {/* Récurrence */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Récurrence
                </label>
                <div className="flex gap-2">
                  {(['once', 'daily', 'weekly'] as const).map((v, i) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, recurrence: v }))}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                        form.recurrence === v
                          ? 'border-sky text-sky bg-sky/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                      disabled={saving}
                    >
                      {['Une fois','Quotidien','Hebdo'][i]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priorité */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Priorité
                </label>
                <div className="flex gap-2">
                  {(['normal', 'urgent'] as const).map((v, i) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, priority: v }))}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                        form.priority === v
                          ? v === 'urgent'
                            ? 'border-danger text-danger bg-danger/10'
                            : 'border-meadow text-meadow bg-meadow/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                      disabled={saving}
                    >
                      {['Normal','⚠ Urgent'][i]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={saving || !form.title.trim()}
                className="w-full py-4 rounded-xl font-semibold text-white text-base bg-forest
                           active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                           disabled:active:scale-100 transition-all shadow-lg"
              >
                {saving ? 'Création…' : 'Créer la tâche'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
