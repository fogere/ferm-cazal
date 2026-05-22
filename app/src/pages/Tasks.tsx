import { useEffect, useState, useMemo } from 'react'
import {
  Plus, X, CheckCircle2, Circle, AlertTriangle, RotateCcw, ChevronDown, ChevronRight,
  Trash2, Hand, Bell, BellRing,
} from 'lucide-react'
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { timeAgo } from '../services/map/time'
import type { Task, UserProfile } from '../types'

/* ─── helpers ─── */

const DAYS_FR   = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
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
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'upcoming']
const BUCKET_LABELS: Record<Bucket, string> = {
  overdue:  'En retard',
  today:    "Aujourd'hui",
  tomorrow: 'Demain',
  upcoming: 'À venir',
}

function getBucket(ts: number): Bucket {
  const [s0, e0] = getDayRange(0)
  const [, e1]   = getDayRange(1)
  if (ts <  s0) return 'overdue'
  if (ts <= e0) return 'today'
  if (ts <= e1) return 'tomorrow'
  return 'upcoming'
}

function todayInputValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Combine une date YYYY-MM-DD avec une heure optionnelle HH:MM. Si time est vide,
// on tombe à 12:00 (mi-journée — convention historique des tâches).
function dateTimeToTs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  if (!time) return new Date(y, m - 1, d, 12, 0, 0).getTime()
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0).getTime()
}

// Super-administrateurs : peuvent assigner une tâche à un membre spécifique
// (au lieu de la mettre dans le pool commun) et fixer une heure précise.
// Identifiés par leur displayName (en minuscules, sans accents).
// Eugénie + Benoît uniquement — Mathieu reste utilisateur régulier sans pouvoir d'assignation.
const SUPER_ADMIN_NAMES = ['eugenie', 'eugénie', 'benoit', 'benoît']

function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function isSuperAdmin(profile: { displayName?: string } | null | undefined): boolean {
  if (!profile?.displayName) return false
  return SUPER_ADMIN_NAMES.includes(normalizeName(profile.displayName))
}

/* ─── form state ─── */

type FormRecurrence = 'once' | 'daily' | 'weekly' | 'every_n_days'

interface FormState {
  title: string
  zone: string
  dueDate: string
  dueTime: string           // HH:MM optionnel — déclenche notif au lieu de pool ouvert
  recurrence: FormRecurrence
  intervalDays: number      // utilisé uniquement quand recurrence === 'every_n_days'
  priority: Task['priority']
  mode: 'pool' | 'assigned' | 'broadcast'  // 3 modes possibles
  assignedTo: string        // uid spécifique (super admin) ou '' (pool)
}

function blankForm(): FormState {
  return {
    title:        '',
    zone:         '',
    dueDate:      todayInputValue(),
    dueTime:      '',
    recurrence:   'once',
    intervalDays: 3,
    priority:     'normal',
    mode:         'pool',
    assignedTo:   '',
  }
}

/* ─── component ─── */

export default function Tasks() {
  const { user, profile, isTemp } = useAuth()
  const superAdmin = isSuperAdmin(profile)

  const [allTasks, setAllTasks]   = useState<Task[]>([])
  const [users, setUsers]         = useState<UserProfile[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<FormState>(blankForm)
  const [saving, setSaving]       = useState(false)
  const [showDone, setShowDone]   = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [urgentForId, setUrgentForId] = useState<string | null>(null)
  const [urgentReason, setUrgentReason] = useState('')
  // Filtre : "à prendre" (libres) | "toutes" (incluant prises)
  const [filter, setFilter] = useState<'all' | 'unclaimed' | 'mine'>('all')

  /* Listeners temps réel */

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

  /* Helpers claim */

  function userById(uid: string | null | undefined): UserProfile | null {
    if (!uid) return null
    return users.find(u => u.uid === uid) ?? null
  }

  function isClaimedByMe(t: Task): boolean {
    return !!user && t.assignedTo === user.uid
  }
  function isUnclaimed(t: Task): boolean {
    return !t.assignedTo || t.assignedTo === 'auto'
  }

  /* Derived */

  const pendingAll = useMemo(
    () => allTasks
      .filter(t => {
        if (!t.completed) return true
        // Les broadcast complétés restent visibles 24 h pour informer les autres
        // que c'est traité, et qui s'en est occupé.
        if (t.broadcast && t.completedAt && (Date.now() - t.completedAt) < 24 * 3600 * 1000) {
          return true
        }
        return false
      })
      .sort((a, b) => a.dueDate - b.dueDate),
    [allTasks],
  )

  const filtered = useMemo(() => {
    if (filter === 'unclaimed') return pendingAll.filter(isUnclaimed)
    if (filter === 'mine')      return pendingAll.filter(isClaimedByMe)
    return pendingAll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, pendingAll, user?.uid])

  const grouped = useMemo(() => {
    const map: Record<Bucket, Task[]> = { overdue: [], today: [], tomorrow: [], upcoming: [] }
    filtered.forEach(t => map[getBucket(t.dueDate)].push(t))
    return map
  }, [filtered])

  const doneRecent = useMemo(
    () => allTasks
      .filter(t => t.completed)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 20),
    [allTasks],
  )

  const counts = useMemo(() => ({
    all:       pendingAll.length,
    unclaimed: pendingAll.filter(isUnclaimed).length,
    mine:      pendingAll.filter(isClaimedByMe).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pendingAll, user?.uid])

  /* Actions */

  // Calcule la prochaine échéance "depuis la dernière fois".
  // Base = completion time (Date.now()) au moment où on coche fait.
  function nextDueFromNow(t: Task): number {
    const now = Date.now()
    if (t.recurrence === 'daily')         return now + 24 * 3_600_000
    if (t.recurrence === 'weekly')        return now + 7 * 24 * 3_600_000
    if (t.recurrence === 'every_n_days')  return now + (t.intervalDays ?? 1) * 24 * 3_600_000
    return now // ne devrait pas être utilisé pour 'once'
  }

  async function toggleDone(task: Task) {
    const nowDone = !task.completed
    const now = Date.now()
    const updates: Record<string, unknown> = {
      completed:   nowDone,
      completedAt: nowDone ? now : null,
      completedBy: nowDone ? user?.uid  : null,
    }
    if (nowDone && task.recurrence !== 'once' && !task.nextOccurrenceCreated) {
      // Crée la prochaine occurrence : non assignée (pool), date depuis maintenant
      await addDoc(collection(db, 'tasks'), {
        title:        task.title,
        zone:         task.zone,
        assignedTo:   null,                // libre → quelqu'un devra la reprendre
        recurrence:   task.recurrence,
        intervalDays: task.intervalDays ?? null,
        priority:     task.priority,
        completed:    false,
        completedAt:  null,
        completedBy:  null,
        createdAt:    now,
        createdBy:    task.createdBy,
        dueDate:      nextDueFromNow(task),
        nextOccurrenceCreated: false,
      })
      updates.nextOccurrenceCreated = true
    }
    await updateDoc(doc(db, 'tasks', task.id), updates)
  }

  async function claimTask(task: Task) {
    if (!user) return
    await updateDoc(doc(db, 'tasks', task.id), {
      assignedTo: user.uid,
      claimedAt:  Date.now(),
    })
  }

  async function releaseTask(task: Task) {
    await updateDoc(doc(db, 'tasks', task.id), {
      assignedTo: null,
      claimedAt:  null,
    })
  }

  function openUrgent(task: Task) {
    setUrgentForId(task.id)
    setUrgentReason('')
  }

  async function confirmUrgent() {
    if (!urgentForId || !user) return
    // Libère + flag urgent → le cron pingera tous (push immédiat).
    await updateDoc(doc(db, 'tasks', urgentForId), {
      assignedTo:           null,
      claimedAt:            null,
      urgentReleaseAt:      Date.now(),
      urgentReleaseBy:      user.uid,
      urgentReleaseReason:  urgentReason.trim().slice(0, 200),
      urgentNotified:       false,
    })
    setUrgentForId(null)
    setUrgentReason('')
  }

  async function deleteTask(id: string) {
    setConfirmDeleteId(null)
    await deleteDoc(doc(db, 'tasks', id))
  }

  function openForm() {
    setForm(blankForm())
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !user) return
    setSaving(true)
    try {
      // 3 modes :
      //   - 'pool'      : assignedTo=null, n'importe qui prend (comportement par défaut)
      //   - 'assigned'  : assignedTo=uid choisi (super-admin uniquement — l'UI ne propose
      //                   pas ce mode aux autres)
      //   - 'broadcast' : assignedTo=null + broadcast:true, tâche partagée et notifiée
      //                   à TOUS. Demande Nils 21/05/2026 : ouvert à tous les regular users
      //                   (avant : super-admin uniquement). L'envoi de notif au cron requiert
      //                   toujours hasDueTime, lui-même restreint aux super-admins.
      const isAssigned  = superAdmin && form.mode === 'assigned' && !!form.assignedTo
      const isBroadcast = form.mode === 'broadcast'
      await addDoc(collection(db, 'tasks'), {
        title:        form.title.trim(),
        zone:         form.zone.trim(),
        assignedTo:   isAssigned ? form.assignedTo : null,
        claimedAt:    isAssigned ? Date.now() : null,
        recurrence:   form.recurrence,
        intervalDays: form.recurrence === 'every_n_days' ? form.intervalDays : null,
        priority:     form.priority,
        completed:    false,
        completedAt:  null,
        completedBy:  null,
        createdAt:    Date.now(),
        createdBy:    user.uid,
        dueDate:      dateTimeToTs(form.dueDate, form.dueTime),
        hasDueTime:   !!form.dueTime,
        reminderSentAt: null,
        nextOccurrenceCreated: false,
        broadcast:    isBroadcast,
        broadcastNotifiedAt: null,
      })
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  /* Render helpers */

  function TaskRow({ task }: { task: Task }) {
    const owner = userById(task.assignedTo)
    const mine  = isClaimedByMe(task)
    const free  = isUnclaimed(task)
    const bkt   = getBucket(task.dueDate)
    const confirming = confirmDeleteId === task.id

    // Bug Nils 22/05/2026 : visuel renforcé pour les tâches faites.
    // - Bandeau vert clair en arrière-plan (au lieu du discret line-through seul)
    // - Liseré meadow à gauche
    // - "Fait il y a X min" sous le titre pour rappeler quand et par qui
    const doneClass = task.completed
      ? 'bg-meadow/5 border-l-4 border-meadow rounded-r-lg pl-2'
      : ''

    return (
      <li className={`py-3 px-1 transition-colors ${doneClass}`}>
        {confirming ? (
          <div className="flex items-center gap-3">
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
          <div className="flex items-start gap-2.5">
            {/* Checkbox done */}
            <button
              onClick={() => toggleDone(task)}
              className="mt-0.5 flex-shrink-0"
              aria-label={task.completed ? 'Marquer non-fait' : 'Cocher fait'}
            >
              {task.completed
                ? <CheckCircle2 size={22} className="text-meadow" />
                : <Circle size={22} className="text-border" />}
            </button>

            {/* Contenu */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${
                task.completed ? 'line-through text-muted' : 'text-charcoal'
              }`}>
                {task.title}
              </p>

              {/* Bug Nils 22/05/2026 : trace "fait" claire — quand et par qui.
                  Visible pour TOUTES les tâches faites (broadcast ou non) en plus du badge. */}
              {task.completed && task.completedAt && (
                <p className="text-[11px] text-meadow font-semibold mt-0.5 flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  Fait {timeAgo(task.completedAt).toLowerCase()}
                  {task.completedBy && userById(task.completedBy)?.displayName &&
                    ` · ${userById(task.completedBy)?.displayName}`}
                </p>
              )}

              {/* Badges meta */}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {task.zone && (
                  <span className="text-xs text-muted bg-cream px-2 py-0.5 rounded-full border border-border">
                    {task.zone}
                  </span>
                )}
                {task.recurrence !== 'once' && (
                  <span className="text-xs text-sky flex items-center gap-0.5">
                    <RotateCcw size={10} />
                    {task.recurrence === 'daily'  ? 'Quotidien'
                   : task.recurrence === 'weekly' ? 'Hebdo'
                   : `Tous les ${task.intervalDays ?? '?'} j`}
                  </span>
                )}
                {task.urgentReleaseAt && !task.completed && (
                  <span className="text-xs font-bold text-danger flex items-center gap-0.5
                                   bg-danger/10 px-2 py-0.5 rounded-full border border-danger/30">
                    <BellRing size={10} /> URGENT — libérée
                  </span>
                )}
                {/* Statut claim / broadcast */}
                {task.broadcast ? (
                  task.completed ? (
                    <span className="text-xs font-semibold text-meadow bg-meadow/10 px-2 py-0.5 rounded-full border border-meadow/30 inline-flex items-center gap-1">
                      ✓ Fait par {userById(task.completedBy)?.displayName ?? '?'}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-sky bg-sky/10 px-2 py-0.5 rounded-full border border-sky/30 inline-flex items-center gap-1">
                      📣 Tout le monde
                    </span>
                  )
                ) : !task.completed && (
                  free ? (
                    <span className="text-xs font-semibold text-meadow bg-meadow/10 px-2 py-0.5 rounded-full border border-meadow/30">
                      Libre
                    </span>
                  ) : (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full text-white inline-flex items-center gap-1"
                      style={{ backgroundColor: owner?.color ?? '#6B7280' }}
                    >
                      <Hand size={10} />
                      {mine ? 'Toi' : owner?.displayName ?? '???'}
                    </span>
                  )
                )}
              </div>

              {/* Action buttons (jamais en mode completed) */}
              {!task.completed && !isTemp && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {task.broadcast ? (
                    <button
                      onClick={() => toggleDone(task)}
                      className="text-xs font-bold text-white bg-meadow px-2.5 py-1.5 rounded-lg
                                 active:scale-95 transition-all flex items-center gap-1"
                    >
                      <CheckCircle2 size={11} /> ✓ Fait
                    </button>
                  ) : free && (
                    <button
                      onClick={() => claimTask(task)}
                      className="text-xs font-bold text-white bg-forest px-2.5 py-1.5 rounded-lg
                                 active:scale-95 transition-all flex items-center gap-1"
                    >
                      <Hand size={11} /> Je m'en occupe
                    </button>
                  )}
                  {!task.broadcast && mine && (
                    <>
                      <button
                        onClick={() => releaseTask(task)}
                        className="text-xs font-semibold text-muted bg-cream border border-border
                                   px-2.5 py-1.5 rounded-lg active:bg-cream/80"
                      >
                        Libérer
                      </button>
                      <button
                        onClick={() => openUrgent(task)}
                        className="text-xs font-bold text-white bg-danger px-2.5 py-1.5 rounded-lg
                                   active:scale-95 transition-all flex items-center gap-1"
                      >
                        <BellRing size={11} /> Je peux plus
                      </button>
                    </>
                  )}
                  {!task.broadcast && !free && !mine && (
                    <button
                      onClick={() => claimTask(task)}
                      className="text-xs font-semibold text-forest border border-forest/30 bg-forest/5
                                 px-2.5 py-1.5 rounded-lg active:scale-95"
                    >
                      Reprendre
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right column : date + delete */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {task.priority === 'urgent' && !task.completed && (
                <AlertTriangle size={14} className="text-danger" />
              )}
              {!task.completed && (
                <span className={`text-xs ${bkt === 'overdue' ? 'text-danger font-semibold' : 'text-muted'}`}>
                  {dateLabel(task.dueDate)}
                </span>
              )}
              {!isTemp && (
                <button
                  onClick={() => setConfirmDeleteId(task.id)}
                  className="p-1 mt-1 text-border active:text-danger transition-colors"
                  aria-label="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  /* JSX */

  const isEmpty = filtered.length === 0

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-5 pt-12 pb-5"
           style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)' }}>
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
        <p className="text-white/70 text-xs leading-relaxed">
          {counts.unclaimed > 0
            ? `${counts.unclaimed} tâche${counts.unclaimed > 1 ? 's' : ''} à prendre — clique "Je m'en occupe"`
            : counts.all > 0
              ? `${counts.all} tâche${counts.all > 1 ? 's' : ''} en cours`
              : 'Tout est fait — bonne journée'}
        </p>
      </div>

      {/* Filtres */}
      <div className="px-4 mt-3 flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all
            ${filter === 'all' ? 'bg-forest text-white' : 'bg-card border border-border text-muted'}`}
        >
          Toutes ({counts.all})
        </button>
        <button
          onClick={() => setFilter('unclaimed')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all
            ${filter === 'unclaimed' ? 'bg-meadow text-white' : 'bg-card border border-border text-muted'}`}
        >
          À prendre ({counts.unclaimed})
        </button>
        <button
          onClick={() => setFilter('mine')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all
            ${filter === 'mine' ? 'bg-sky text-white' : 'bg-card border border-border text-muted'}`}
        >
          Pour moi ({counts.mine})
        </button>
      </div>

      <div className="px-4 mt-3 space-y-4">
        {/* Liste groupée par échéance */}
        {BUCKET_ORDER.map(b => {
          const tasks = grouped[b]
          if (!tasks.length) return null
          return (
            <div key={b}>
              <p className={`text-xs font-semibold uppercase tracking-wider px-1 mb-2 ${
                b === 'overdue' ? 'text-danger' : 'text-muted'
              }`}>
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

        {isEmpty && (
          <div className="py-14 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-charcoal font-semibold mb-1">
              {filter === 'unclaimed' ? 'Aucune tâche libre' : 'Tout est fait !'}
            </p>
            <p className="text-muted text-sm">
              {filter === 'unclaimed'
                ? 'Toutes les tâches sont prises ou n\'attendent personne.'
                : 'Aucune tâche en attente'}
            </p>
          </div>
        )}

        {/* Faites récemment */}
        {doneRecent.length > 0 && (
          <div>
            <button
              onClick={() => setShowDone(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider px-1 mb-2"
            >
              {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Faites récemment ({doneRecent.length})
            </button>
            {showDone && (
              <div className="bg-card rounded-2xl px-3 shadow-sm">
                <ul className="divide-y divide-border/50">
                  {doneRecent.map(t => <TaskRow key={t.id} task={t} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal urgent release */}
      {urgentForId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
               onClick={() => setUrgentForId(null)} />
          <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <BellRing size={20} className="text-danger" />
              <h2 className="text-charcoal text-lg font-bold m-0">Je ne peux plus</h2>
            </div>
            <p className="text-xs text-muted mb-4 leading-relaxed">
              Tu libères cette tâche et tout le monde reçoit une notification d'urgence
              <strong className="text-danger"> immédiatement</strong> (ignore les heures silencieuses).
              Précise la raison si tu veux.
            </p>
            <textarea
              value={urgentReason}
              onChange={e => setUrgentReason(e.target.value)}
              placeholder="Raison (optionnel) — ex: au village, pas dispo avant 18h"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-cream text-charcoal text-sm
                         focus:outline-none focus:ring-2 focus:ring-forest transition-all resize-none mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setUrgentForId(null)}
                className="flex-1 py-3 rounded-xl border border-border text-muted text-sm font-semibold active:bg-cream"
              >
                Annuler
              </button>
              <button
                onClick={confirmUrgent}
                className="flex-1 py-3 rounded-xl bg-danger text-white text-sm font-bold active:scale-95 flex items-center justify-center gap-2"
              >
                <BellRing size={14} /> Pinger tous
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom sheet : new task */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
               onClick={() => !saving && setShowForm(false)} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-charcoal text-lg font-bold m-0">Nouvelle tâche</h2>
              <button onClick={() => !saving && setShowForm(false)}
                      className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>

            {form.mode === 'broadcast' ? (
              <p className="text-xs text-sky mb-5 leading-relaxed bg-sky/10 rounded-xl p-3 border border-sky/30">
                <BellRing size={12} className="inline mr-1" />
                📣 <strong>Mode broadcast</strong> — tout le monde recevra une notification
                {form.dueTime && <> à <strong>{form.dueTime}</strong></>}.
                N'importe qui pourra cliquer "Fait" et les autres verront qui s'en est occupé.
              </p>
            ) : form.mode === 'assigned' && form.assignedTo ? (
              <p className="text-xs text-meadow mb-5 leading-relaxed bg-meadow/10 rounded-xl p-3 border border-meadow/30">
                <BellRing size={12} className="inline mr-1" />
                Tâche assignée directement à <strong>{users.find(u => u.uid === form.assignedTo)?.displayName ?? '?'}</strong>.
                {form.dueTime && <> Une notification lui sera envoyée à <strong>{form.dueTime}</strong>.</>}
              </p>
            ) : (
              <p className="text-xs text-muted mb-5 leading-relaxed bg-cream rounded-xl p-3 border border-border">
                <Bell size={12} className="inline mr-1" />
                La tâche sera ajoutée au pool commun. <strong>Personne ne lui est assigné</strong> —
                chacun pourra cliquer "Je m'en occupe" quand il veut la prendre.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Titre */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Titre *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="ex: Voir les juments au pré 1"
                  autoFocus
                  required
                  disabled={saving}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                />
              </div>

              {/* Zone */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Zone (optionnel)</label>
                <input
                  type="text"
                  value={form.zone}
                  onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  placeholder="ex: Pré 1, Bergerie…"
                  disabled={saving}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                />
              </div>

              {/* Date + heure */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Date {superAdmin && '· heure'}</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    disabled={saving}
                    className="flex-1 px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                               focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                  />
                  {superAdmin && (
                    <input
                      type="time"
                      value={form.dueTime}
                      onChange={e => setForm(f => ({ ...f, dueTime: e.target.value }))}
                      disabled={saving}
                      className="w-28 px-3 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                                 focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                    />
                  )}
                </div>
                {superAdmin && (
                  <p className="text-[10px] text-muted/70 mt-1 leading-tight">
                    Si une heure est précisée, une notification partira automatiquement
                    à la personne assignée (cron toutes les 5 min).
                  </p>
                )}
              </div>

              {/* Mode d'assignation — Pool/Broadcast accessible à tous,
                  Assignée réservée aux super-admins (Eugénie/Benoît) */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Mode {!superAdmin && <span className="font-normal text-[10px] normal-case">(👤 Assignée réservée aux super-admins)</span>}
                </label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {([
                    ['pool',      '🏊 Pool',      'Personne assignée, premier qui prend', true],
                    ['assigned',  '👤 Assignée',  "À une personne précise, notif à elle", superAdmin],
                    ['broadcast', '📣 Pour tous', "Tâche partagée, tout le monde la voit, n'importe qui peut faire", true],
                  ] as const).map(([k, label, hint, enabled]) => (
                    <button key={k}
                            type="button"
                            onClick={() => enabled && setForm(f => ({ ...f, mode: k }))}
                            disabled={saving || !enabled}
                            title={enabled ? hint : 'Réservé aux super-admins (Eugénie/Benoît)'}
                            className={`py-2 rounded-lg border text-[11px] font-bold transition-all ${
                              form.mode === k
                                ? 'border-forest bg-forest text-white'
                                : enabled
                                  ? 'border-border bg-cream text-muted'
                                  : 'border-border/40 bg-cream/40 text-muted/40 cursor-not-allowed'
                            }`}>
                      {label}
                    </button>
                  ))}
                </div>
                {form.mode === 'assigned' && superAdmin && (
                  <select
                    value={form.assignedTo}
                    onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                    disabled={saving}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                               focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                  >
                    <option value="">— Choisir une personne —</option>
                    {users.map(u => (
                      <option key={u.uid} value={u.uid}>{u.displayName}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Récurrence */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Récurrence</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['once',         'Une fois'],
                    ['daily',        'Quotidien'],
                    ['weekly',       'Hebdo'],
                    ['every_n_days', 'Tous les X j'],
                  ] as const).map(([v, lbl]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, recurrence: v }))}
                      disabled={saving}
                      className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                        form.recurrence === v
                          ? 'border-sky text-sky bg-sky/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {form.recurrence === 'every_n_days' && (
                  <div className="mt-3 flex items-center gap-3 bg-sky/5 border border-sky/20 rounded-xl px-4 py-3">
                    <span className="text-sm text-charcoal font-semibold">Tous les</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={form.intervalDays}
                      onChange={e => setForm(f => ({
                        ...f,
                        intervalDays: Math.max(1, Math.min(30, parseInt(e.target.value) || 1)),
                      }))}
                      disabled={saving}
                      className="w-16 px-2 py-1.5 rounded-lg border border-border bg-card text-charcoal text-sm font-bold
                                 text-center focus:outline-none focus:ring-2 focus:ring-sky"
                    />
                    <span className="text-sm text-charcoal font-semibold">jour{form.intervalDays > 1 ? 's' : ''}</span>
                    <span className="text-xs text-muted ml-auto leading-tight">depuis la dernière fois</span>
                  </div>
                )}
              </div>

              {/* Priorité */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Priorité</label>
                <div className="flex gap-2">
                  {(['normal', 'urgent'] as const).map((v, i) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, priority: v }))}
                      disabled={saving}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                        form.priority === v
                          ? v === 'urgent'
                            ? 'border-danger text-danger bg-danger/10'
                            : 'border-meadow text-meadow bg-meadow/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                    >
                      {['Normal','⚠ Urgent'][i]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !form.title.trim()}
                className="w-full py-4 rounded-xl font-semibold text-white text-base bg-forest
                           active:scale-95 disabled:opacity-40 transition-all shadow-lg"
              >
                {saving ? 'Création…' : 'Ajouter au pool commun'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
