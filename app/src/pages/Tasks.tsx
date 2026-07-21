import { useEffect, useState, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, X, CheckCircle2, Circle, AlertTriangle, RotateCcw,
  Trash2, Hand, Bell, BellRing, Pencil, ArrowRight, Droplets, Square, Heart,
} from 'lucide-react'
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, where, writeBatch,
} from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useUsers } from '../hooks/useUsers'
import { timeAgo } from '../services/map/time'
import type { Task, UserProfile, MapPin } from '../types'
import MapPicker from '../components/MapPicker'
import TaskDoneFlash from '../components/TaskDoneFlash'
import TaskDayTimeline from '../components/tasks/TaskDayTimeline'

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
  // Liens carte (V6, Eugénie 27/05/2026) : on peut maintenant lier une tâche
  // à 1 point d'eau ET 1 espace simultanément, ou un seul des deux, ou aucun.
  linkedWaterId?:   string
  linkedWaterName?: string
  linkedLandId?:    string
  linkedLandName?:  string
  // Quand un land est lié : la complétion de la tâche vaut aussi "j'ai vu
  // tous les animaux, ils vont bien" (markAllHealthy auto). Activé par défaut
  // car c'est l'usage typique (cf. V5 #1 Nils 25/05/2026).
  healthCheckOnComplete: boolean
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
    healthCheckOnComplete: true,
  }
}

// Construit un FormState à partir d'une tâche existante (mode édition).
function formFromTask(t: Task): FormState {
  const d = new Date(t.dueDate)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const time = t.hasDueTime
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : ''
  let mode: FormState['mode'] = 'pool'
  if (t.broadcast) mode = 'broadcast'
  else if (t.assignedTo && t.assignedTo !== 'auto') mode = 'assigned'
  // V6 — lecture des liens : on prend d'abord les nouveaux champs séparés
  // (linkedWaterId/linkedLandId). Pour les tâches anciennes qui n'ont que
  // linkedKind/linkedId/linkedName, on dérive vers le bon slot.
  const linkedWaterId   = t.linkedWaterId   ?? (t.linkedKind === 'water_manual' ? t.linkedId   : undefined)
  const linkedWaterName = t.linkedWaterName ?? (t.linkedKind === 'water_manual' ? t.linkedName : undefined)
  const linkedLandId    = t.linkedLandId    ?? (t.linkedKind === 'land_plot'    ? t.linkedId   : undefined)
  const linkedLandName  = t.linkedLandName  ?? (t.linkedKind === 'land_plot'    ? t.linkedName : undefined)
  return {
    title:        t.title,
    zone:         t.zone ?? '',
    dueDate:      `${yyyy}-${mm}-${dd}`,
    dueTime:      time,
    recurrence:   t.recurrence,
    intervalDays: t.intervalDays ?? 3,
    priority:     t.priority,
    mode,
    assignedTo:   mode === 'assigned' ? (t.assignedTo ?? '') : '',
    linkedWaterId,
    linkedWaterName,
    linkedLandId,
    linkedLandName,
    healthCheckOnComplete: t.healthCheckOnComplete !== false,
  }
}

/* ─── component ─── */

export default function Tasks() {
  const { user, profile, isTemp } = useAuth()
  const superAdmin = isSuperAdmin(profile)

  const [searchParams, setSearchParams] = useSearchParams()
  const [allTasks, setAllTasks]   = useState<Task[]>([])
  const users = useUsers()
  const [mapPins, setMapPins]     = useState<MapPin[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)  // null = création
  const [form, setForm]           = useState<FormState>(blankForm)
  const [saving, setSaving]       = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [urgentForId, setUrgentForId] = useState<string | null>(null)
  // Picker carte (open quand on clique "Choisir sur la carte" depuis le form)
  const [pickerKind, setPickerKind] = useState<'water_manual' | 'land_plot' | null>(null)
  const [postponingId, setPostponingId] = useState<string | null>(null)
  // Bug Nils 23/05/2026 (BUGV3 #2) : animation visible quand on coche une tâche.
  // L'id reste setté ~700ms le temps de l'animation CSS, puis revient à null.
  const [justCheckedId, setJustCheckedId] = useState<string | null>(null)
  // Compteur qui déclenche le badge plein écran "Validé !" à chaque tâche cochée.
  const [doneFlash, setDoneFlash] = useState(0)
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

  /* Bouton « ✓ Fait » d'une notification (21/07/2026).
   * Le Service Worker ne peut pas écrire dans Firestore (ni SDK Firestore ni
   * session Auth là-bas) : il ouvre donc /tasks?done=<id> et c'est ici qu'on
   * coche. On attend que les tâches soient chargées, on ne traite l'id qu'UNE
   * fois, et on nettoie l'URL en `replace` pour qu'un rafraîchissement ou un
   * retour arrière ne re-coche pas la tâche. */
  const doneParam = searchParams.get('done')
  const handledDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!doneParam || !user || isTemp) return
    if (handledDoneRef.current === doneParam) return
    if (allTasks.length === 0) return // snapshot pas encore arrivé
    handledDoneRef.current = doneParam
    const task = allTasks.find(t => t.id === doneParam)
    if (task && !task.completed) void toggleDone(task)
    setSearchParams(
      prev => { const next = new URLSearchParams(prev); next.delete('done'); return next },
      { replace: true },
    )
  }, [doneParam, allTasks, user, isTemp])

  // Pins carte (pour résoudre le nom du linkedId si différent du snapshot)
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'map_pins')), snap =>
      setMapPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin)))
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
    // Demande Nils V8 (02/07/2026) : tâches triées par ordre alphabétique dans
    // chaque groupe (avant : ordre d'échéance → « tout dans le désordre »).
    for (const b of BUCKET_ORDER) {
      map[b].sort((a, b2) => a.title.localeCompare(b2.title, 'fr', { sensitivity: 'base' }))
    }
    return map
  }, [filtered])

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

  // Reporte l'heure précise (hasDueTime) d'une tâche sur une nouvelle date d'échéance.
  function withDueTime(task: Task, baseDue: number): number {
    if (!task.hasDueTime) return baseDue
    const src = new Date(task.dueDate)
    const d = new Date(baseDue)
    d.setHours(src.getHours(), src.getMinutes(), 0, 0)
    return d.getTime()
  }

  // Crée la prochaine occurrence d'une tâche récurrente (réutilisé par "marquer fait"
  // et par les options "supprimer juste cette fois / cette semaine"). Préserve tous les
  // champs liés + le seriesId pour garder la chaîne d'occurrences traçable.
  async function createNextOccurrence(task: Task, dueDate: number, seriesId: string | null) {
    const now = Date.now()
    const nextWaterId   = task.linkedWaterId   ?? (task.linkedKind === 'water_manual' ? task.linkedId   : null)
    const nextWaterName = task.linkedWaterName ?? (task.linkedKind === 'water_manual' ? task.linkedName : null)
    const nextLandId    = task.linkedLandId    ?? (task.linkedKind === 'land_plot'    ? task.linkedId   : null)
    const nextLandName  = task.linkedLandName  ?? (task.linkedKind === 'land_plot'    ? task.linkedName : null)
    await addDoc(collection(db, 'tasks'), {
      title:        task.title,
      zone:         task.zone,
      assignedTo:   null,
      claimedAt:    null,
      recurrence:   task.recurrence,
      intervalDays: task.intervalDays ?? null,
      priority:     task.priority,
      completed:    false,
      completedAt:  null,
      completedBy:  null,
      createdAt:    now,
      createdBy:    task.createdBy,
      dueDate,
      hasDueTime:   task.hasDueTime ?? false,
      reminderSentAt: null,
      nextOccurrenceCreated: false,
      broadcast:    task.broadcast ?? false,
      broadcastNotifiedAt: null,
      linkedWaterId:     nextWaterId,
      linkedWaterName:   nextWaterName,
      linkedWaterDoneAt: null,
      linkedLandId:      nextLandId,
      linkedLandName:    nextLandName,
      linkedLandDoneAt:  null,
      healthCheckOnComplete: task.healthCheckOnComplete ?? null,
      linkedKind:  nextWaterId ? 'water_manual' : (nextLandId ? 'land_plot' : null),
      linkedId:    nextWaterId ?? nextLandId ?? null,
      linkedName:  nextWaterName ?? nextLandName ?? null,
      seriesId:    seriesId ?? null,
    })
  }

  async function toggleDone(task: Task) {
    const nowDone = !task.completed
    if (!nowDone) {
      // Dé-cocher : immédiat, pas d'animation.
      await applyToggle(task, false)
      return
    }
    // Bug Nils V7 : on joue l'animation D'ABORD (balayage vert + ✓), puis on écrit en
    // Firestore (~550 ms). Sans ce délai, la tâche quittait la liste instantanément et
    // l'animation ne se voyait jamais. + badge plein écran garanti visible.
    setDoneFlash(n => n + 1)
    setJustCheckedId(task.id)
    setTimeout(() => {
      applyToggle(task, true).finally(() =>
        setJustCheckedId(curr => (curr === task.id ? null : curr)))
    }, 550)
  }

  async function applyToggle(task: Task, nowDone: boolean) {
    const now = Date.now()
    const updates: Record<string, unknown> = {
      completed:   nowDone,
      completedAt: nowDone ? now : null,
      completedBy: nowDone ? user?.uid  : null,
    }
    if (nowDone && task.recurrence !== 'once' && !task.nextOccurrenceCreated) {
      // Crée la prochaine occurrence (filet cron en doublon côté serveur).
      // Bug V5 #2 / V6 : tous les champs liés sont préservés par createNextOccurrence.
      // V7 : on propage le seriesId pour garder la chaîne traçable ("supprimer
      // définitivement" peut alors balayer toute la série).
      const dueDate = withDueTime(task, nextDueFromNow(task))
      await createNextOccurrence(task, dueDate, task.seriesId ?? null)
      updates.nextOccurrenceCreated = true
    }
    await updateDoc(doc(db, 'tasks', task.id), updates)

    // Bug V5 #1 (Nils 25/05/2026) : si la tâche est liée à un espace défini et
    // que l'option "valide la santé des animaux" est active (défaut), on fait
    // l'équivalent du flow geofence : tous les animaux de l'enclos passent
    // lastCheckedHealthy=now. Évite à l'utilisatrice de devoir aussi ouvrir la
    // carte pour cocher "tous vus" après avoir coché la tâche.
    // - Aides temp : autorisées (les rules acceptent ces 2 champs précis).
    // - Best-effort : on log mais on ne bloque pas l'UI si ça plante.
    // V6 : lit linkedLandId (nouveau) avec fallback sur linkedKind/linkedId
    // (rétrocompat anciennes tâches).
    const landId =
      task.linkedLandId ?? (task.linkedKind === 'land_plot' ? task.linkedId : undefined)
    if (
      nowDone
      && landId
      && task.healthCheckOnComplete !== false
      && user
    ) {
      try {
        const animSnap = await getDocs(query(
          collection(db, 'animals'),
          where('enclosureId', '==', landId),
        ))
        if (!animSnap.empty) {
          const batch = writeBatch(db)
          animSnap.forEach(a => {
            batch.update(doc(db, 'animals', a.id), {
              lastCheckedHealthy:   now,
              lastCheckedHealthyBy: user.uid,
            })
          })
          await batch.commit()
        }
      } catch (err) {
        console.warn('[toggleDone] markAllHealthy failed:', err)
      }
    }
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
    // Audit Nils 23/05/2026 : delete tasks réservé aux réguliers (rules Firestore).
    if (isTemp) return
    setConfirmDeleteId(null)
    await deleteDoc(doc(db, 'tasks', id))
  }

  // V7 (Nils) : suppression d'une tâche récurrente avec 3 portées.
  // Deux tâches font partie de la même série si elles partagent un seriesId ;
  // repli par (titre + zone + récurrence) pour les anciennes tâches sans seriesId.
  function sameSeries(a: Task, b: Task): boolean {
    if (a.seriesId && b.seriesId) return a.seriesId === b.seriesId
    if (a.seriesId || b.seriesId) return false
    return a.title === b.title && a.zone === b.zone && a.recurrence === b.recurrence
  }

  // « Définitivement » : la tâche ne revient plus jamais. On supprime l'occurrence
  // courante + toutes les occurrences futures (non faites) de la même série.
  // L'historique des occurrences déjà faites est conservé.
  async function deleteSeriesForever(task: Task) {
    if (isTemp) return
    setConfirmDeleteId(null)
    const targets = allTasks.filter(t => sameSeries(t, task) && (!t.completed || t.id === task.id))
    if (!targets.some(t => t.id === task.id)) targets.push(task)
    const batch = writeBatch(db)
    for (const t of targets) batch.delete(doc(db, 'tasks', t.id))
    await batch.commit()
  }

  // « Juste cette fois » (mode 'once') ou « Cette semaine » (mode 'week') : on saute
  // l'occurrence courante mais on garde la série vivante en recréant la prochaine.
  //   - once : prochaine échéance = cycle normal (demain / +intervalle).
  //   - week : prochaine échéance = dans 7 jours (la tâche revient la semaine prochaine).
  async function skipOccurrence(task: Task, mode: 'once' | 'week') {
    if (isTemp) return
    setConfirmDeleteId(null)
    const base = mode === 'week' ? Date.now() + 7 * 24 * 3_600_000 : nextDueFromNow(task)
    const dueDate = withDueTime(task, base)
    // Legacy sans seriesId : on en assigne un pour que la nouvelle chaîne soit traçable.
    const seriesId = task.seriesId ?? crypto.randomUUID()
    await createNextOccurrence(task, dueDate, seriesId)
    await deleteDoc(doc(db, 'tasks', task.id))
  }

  function openForm() {
    setEditingId(null)
    setForm(blankForm())
    setShowForm(true)
  }

  function openEditForm(task: Task) {
    // Audit : édition réservée aux réguliers (rules + permissions Firestore).
    if (isTemp) return
    setEditingId(task.id)
    setForm(formFromTask(task))
    setShowForm(true)
  }

  // Décaler une tâche d'un jour (bouton "→ Jour suivant" dans la liste + bilan).
  // Demande Nils 03/06/2026 : décale de +1 jour RELATIVEMENT à l'échéance actuelle
  // de la tâche, sans tenir compte de la date du jour. Ainsi une tâche oubliée
  // (en retard depuis hier) repart sur aujourd'hui, pas sur demain.
  // Conserve l'heure de la journée (donc la notif programmée si hasDueTime),
  // la récurrence, le mode broadcast, assignedTo. Reset les flags de notif.
  async function postponeToNextDay(task: Task) {
    if (isTemp) return
    setPostponingId(task.id)
    try {
      const d = new Date(task.dueDate)
      d.setDate(d.getDate() + 1)
      const updates: Record<string, unknown> = {
        dueDate: d.getTime(),
        reminderSentAt: null,
        broadcastNotifiedAt: null,
      }
      await updateDoc(doc(db, 'tasks', task.id), updates)
    } finally {
      setPostponingId(null)
    }
  }

  // V6 — renvoie tous les liens carte d'une tâche (0, 1 ou 2). Lit d'abord les
  // nouveaux champs et fallback sur linkedKind/linkedId pour les anciennes tâches.
  // Le nom prend le live (map_pins) en priorité, sinon le snapshot stocké.
  function linkedItems(t: Task): Array<{ kind: 'water_manual' | 'land_plot', id: string, name: string }> {
    const items: Array<{ kind: 'water_manual' | 'land_plot', id: string, name: string }> = []
    const waterId   = t.linkedWaterId   ?? (t.linkedKind === 'water_manual' ? t.linkedId   : undefined)
    const waterName = t.linkedWaterName ?? (t.linkedKind === 'water_manual' ? t.linkedName : undefined)
    const landId    = t.linkedLandId    ?? (t.linkedKind === 'land_plot'    ? t.linkedId   : undefined)
    const landName  = t.linkedLandName  ?? (t.linkedKind === 'land_plot'    ? t.linkedName : undefined)
    if (waterId) {
      const live = mapPins.find(p => p.id === waterId)
      items.push({ kind: 'water_manual', id: waterId, name: live?.name ?? waterName ?? 'Point d\'eau' })
    }
    if (landId) {
      const live = mapPins.find(p => p.id === landId)
      items.push({ kind: 'land_plot', id: landId, name: live?.name ?? landName ?? 'Espace' })
    }
    return items
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !user) return
    // Audit Nils 23/05/2026 : création task réservée aux réguliers (rules Firestore).
    if (isTemp) return
    setSaving(true)
    try {
      // 3 modes :
      //   - 'pool'      : assignedTo=null, n'importe qui prend (comportement par défaut)
      //   - 'assigned'  : assignedTo=uid choisi (super-admin uniquement — l'UI ne propose
      //                   pas ce mode aux autres)
      //   - 'broadcast' : assignedTo=null + broadcast:true, tâche partagée et notifiée
      //                   à TOUS.
      const isAssigned  = superAdmin && form.mode === 'assigned' && !!form.assignedTo
      const isBroadcast = form.mode === 'broadcast'
      const dueDate = dateTimeToTs(form.dueDate, form.dueTime)
      // V6 (Eugénie 27/05/2026) : 2 liens indépendants. On écrit les nouveaux
      // champs séparés + on miroir linkedKind/linkedId/linkedName (anciens) pour
      // que les vieux clients PWA en cache ou composants pas encore migrés
      // continuent d'afficher au moins UN lien. healthCheckOnComplete reste
      // pertinent uniquement si un land est lié.
      const waterId   = form.linkedWaterId ?? null
      const waterName = form.linkedWaterId ? (form.linkedWaterName ?? null) : null
      const landId    = form.linkedLandId  ?? null
      const landName  = form.linkedLandId  ? (form.linkedLandName  ?? null) : null
      const linked = {
        linkedWaterId:     waterId,
        linkedWaterName:   waterName,
        linkedWaterDoneAt: null,  // reset à la création/édition : nouveau cycle
        linkedLandId:      landId,
        linkedLandName:    landName,
        linkedLandDoneAt:  null,
        healthCheckOnComplete: landId ? form.healthCheckOnComplete : null,
        // Rétrocompat (lecture seule pour vieux composants)
        linkedKind:  waterId ? 'water_manual' : (landId ? 'land_plot' : null),
        linkedId:    waterId ?? landId ?? null,
        linkedName:  waterName ?? landName ?? null,
      }

      // V7 : seriesId pour les tâches récurrentes (chaîne d'occurrences traçable).
      // 'once' → null. En édition, on préserve le seriesId existant (ou on en crée un
      // si la tâche devient récurrente).
      const isRecurring = form.recurrence !== 'once'
      if (editingId) {
        // Mode édition : update en place. Reset des flags de notif si la planification
        // a changé (heure ou broadcast/assigné) pour que la prochaine notif parte.
        const existing = allTasks.find(t => t.id === editingId)
        const seriesId = isRecurring ? (existing?.seriesId ?? crypto.randomUUID()) : null
        const updates: Record<string, unknown> = {
          title:        form.title.trim(),
          zone:         form.zone.trim(),
          assignedTo:   isAssigned ? form.assignedTo : (isBroadcast ? null : null),
          claimedAt:    isAssigned ? Date.now() : null,
          recurrence:   form.recurrence,
          intervalDays: form.recurrence === 'every_n_days' ? form.intervalDays : null,
          priority:     form.priority,
          dueDate,
          hasDueTime:   !!form.dueTime,
          reminderSentAt: null,
          broadcast:    isBroadcast,
          broadcastNotifiedAt: null,
          seriesId,
          ...linked,
        }
        await updateDoc(doc(db, 'tasks', editingId), updates)
      } else {
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
          dueDate,
          hasDueTime:   !!form.dueTime,
          reminderSentAt: null,
          nextOccurrenceCreated: false,
          broadcast:    isBroadcast,
          broadcastNotifiedAt: null,
          seriesId:     isRecurring ? crypto.randomUUID() : null,
          ...linked,
        })
      }
      setShowForm(false)
      setEditingId(null)
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
    // Bug Nils 23/05 puis V7 : animation visible au moment où on coche. La tâche
    // reste affichée pendant le balayage (écriture différée dans toggleDone).
    const completing = justCheckedId === task.id
    const animClass = completing ? 'task-completing' : ''

    return (
      <li className={`py-3 px-1 transition-colors ${doneClass} ${animClass}`}>
        {confirming ? (
          task.recurrence !== 'once' ? (
            /* V7 : tâche récurrente → 3 portées de suppression. */
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-danger flex-shrink-0" />
                <span className="flex-1 text-sm text-danger font-medium leading-snug truncate">
                  Supprimer « {task.title} » ?
                </span>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-2.5 py-1 rounded-lg border border-border text-muted text-xs font-semibold active:bg-cream flex-shrink-0"
                >
                  Annuler
                </button>
              </div>
              <button
                onClick={() => deleteSeriesForever(task)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-danger text-white text-xs font-semibold active:opacity-80"
              >
                <span>Définitivement</span>
                <span className="text-white/80 font-normal">ne revient plus jamais</span>
              </button>
              <button
                onClick={() => skipOccurrence(task, 'week')}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border text-charcoal text-xs font-semibold active:bg-cream"
              >
                <span>Cette semaine</span>
                <span className="text-muted font-normal">revient dans 7 jours</span>
              </button>
              <button
                onClick={() => skipOccurrence(task, 'once')}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border text-charcoal text-xs font-semibold active:bg-cream"
              >
                <span>Juste aujourd'hui</span>
                <span className="text-muted font-normal">revient au prochain cycle</span>
              </button>
            </div>
          ) : (
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
          )
        ) : (
          <div className="flex items-start gap-2.5">
            {/* Checkbox done */}
            <button
              onClick={() => toggleDone(task)}
              disabled={completing}
              className="mt-0.5 flex-shrink-0"
              aria-label={task.completed ? 'Marquer non-fait' : 'Cocher fait'}
            >
              {task.completed || completing
                ? <CheckCircle2 size={22} className={`text-meadow ${completing ? 'check-pop' : ''}`} />
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
                {/* Liens carte (V6 : 0, 1 ou 2 — point d'eau et/ou espace). Badge
                    cliquable qui ouvre la carte centrée sur le pin. */}
                {linkedItems(task).map(it => (
                  <a key={`${it.kind}-${it.id}`}
                     href={`/map?focusPin=${encodeURIComponent(it.id)}`}
                     className="text-xs font-semibold text-sky bg-sky/10 px-2 py-0.5 rounded-full border border-sky/30 inline-flex items-center gap-1"
                  >
                    {it.kind === 'water_manual' ? <Droplets size={10} /> : <Square size={10} />}
                    {it.name}
                  </a>
                ))}
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
                  {/* Décaler d'un jour — demande Nils 25/05/2026, ajusté 03/06/2026
                      (décalage relatif, visible sur toutes les tâches non faites) */}
                  <button
                    onClick={() => postponeToNextDay(task)}
                    disabled={postponingId === task.id}
                    className="text-xs font-semibold text-muted border border-border bg-cream
                               px-2.5 py-1.5 rounded-lg active:bg-cream/80 disabled:opacity-50
                               flex items-center gap-1"
                  >
                    <ArrowRight size={11} /> Jour suivant
                  </button>
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
              {!isTemp && !task.completed && (
                <button
                  onClick={() => openEditForm(task)}
                  className="p-1 mt-1 text-border active:text-forest transition-colors"
                  aria-label="Modifier"
                >
                  <Pencil size={14} />
                </button>
              )}
              {!isTemp && (
                <button
                  onClick={() => setConfirmDeleteId(task.id)}
                  className="p-1 text-border active:text-danger transition-colors"
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
      <TaskDoneFlash trigger={doneFlash} />
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

      {/* Timeline historique des jours — « ce qu'on a fait » (demande Nils V8, 02/07/2026).
          Ronds datés reliés + pastille de complétion ; clic sur un jour = détail des
          tâches faites ce jour-là. Fenêtre = 6 derniers jours (rétention). */}
      <div className="px-4 mt-4">
        <TaskDayTimeline tasks={allTasks} users={users} />
      </div>

      {/* Filtres */}
      <div className="px-4 mt-4 flex gap-2">
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

      {/* Picker carte plein écran — au-dessus du form pour ne pas le perdre.
          V6 : le slot rempli (water ou land) dépend du kind sélectionné. */}
      {pickerKind && (
        <MapPicker
          kind={pickerKind}
          onPick={(id, name) => {
            setForm(f => pickerKind === 'water_manual'
              ? { ...f, linkedWaterId: id, linkedWaterName: name }
              : { ...f, linkedLandId:  id, linkedLandName:  name })
            setPickerKind(null)
          }}
          onCancel={() => setPickerKind(null)}
        />
      )}

      {/* Bottom sheet : new task */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
               onClick={() => !saving && setShowForm(false)} />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-charcoal text-lg font-bold m-0">
                {editingId ? 'Modifier la tâche' : 'Nouvelle tâche'}
              </h2>
              <button onClick={() => { if (!saving) { setShowForm(false); setEditingId(null) } }}
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

              {/* Liens carte — 0, 1 ou 2 liens indépendants.
                  V6 (Eugénie 27/05/2026) : avant on ne pouvait choisir qu'UN
                  seul lien (water OU land). Maintenant on peut lier la tâche
                  à un point d'eau ET un espace : la tâche se coche auto quand
                  TOUS les liens ont été actionnés sur la carte. */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Liens carte (optionnel)
                </label>
                <p className="text-[10px] text-muted/80 mb-3 leading-tight">
                  Tu peux lier la tâche à un point d'eau et/ou à un espace. Quand tu
                  agiras dessus sur la carte (remplir, vu animaux OK), la tâche se
                  cochera toute seule — quand tous les liens auront été faits.
                </p>

                {/* Slot 1 : Point d'eau */}
                <div className="mb-2">
                  {form.linkedWaterId ? (
                    <div className="flex items-center gap-2 bg-sky/5 border border-sky/20 rounded-xl px-3 py-2.5">
                      <Droplets size={14} className="text-sky flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-charcoal truncate">
                          {form.linkedWaterName
                            ?? mapPins.find(p => p.id === form.linkedWaterId)?.name
                            ?? 'Point d\'eau sélectionné'}
                        </p>
                        <p className="text-[10px] text-muted">💧 Point d'eau manuel</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPickerKind('water_manual')}
                        className="text-[11px] font-bold text-sky px-2 py-1 rounded-lg active:bg-sky/10"
                      >
                        Changer
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, linkedWaterId: undefined, linkedWaterName: undefined }))}
                        className="p-1 text-muted active:text-danger"
                        aria-label="Retirer le point d'eau"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setPickerKind('water_manual')}
                      className="w-full py-2.5 rounded-xl border-2 border-dashed border-sky/40 bg-sky/5
                                 text-sky text-xs font-bold flex items-center justify-center gap-2
                                 active:bg-sky/10 transition-all"
                    >
                      <Droplets size={14} />
                      + Lier à un point d'eau
                    </button>
                  )}
                </div>

                {/* Slot 2 : Espace */}
                <div>
                  {form.linkedLandId ? (
                    <div className="flex items-center gap-2 bg-meadow/5 border border-meadow/20 rounded-xl px-3 py-2.5">
                      <Square size={14} className="text-meadow flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-charcoal truncate">
                          {form.linkedLandName
                            ?? mapPins.find(p => p.id === form.linkedLandId)?.name
                            ?? 'Espace sélectionné'}
                        </p>
                        <p className="text-[10px] text-muted">🟩 Espace défini</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPickerKind('land_plot')}
                        className="text-[11px] font-bold text-meadow px-2 py-1 rounded-lg active:bg-meadow/10"
                      >
                        Changer
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, linkedLandId: undefined, linkedLandName: undefined }))}
                        className="p-1 text-muted active:text-danger"
                        aria-label="Retirer l'espace"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setPickerKind('land_plot')}
                      className="w-full py-2.5 rounded-xl border-2 border-dashed border-meadow/40 bg-meadow/5
                                 text-meadow text-xs font-bold flex items-center justify-center gap-2
                                 active:bg-meadow/10 transition-all"
                    >
                      <Square size={14} />
                      + Lier à un espace
                    </button>
                  )}
                </div>

                {/* V5 #1 Nils 25/05/2026 : option "valide la santé des animaux"
                    quand un espace est lié. Cocher la tâche revient alors à
                    marquer "tous les animaux vus en bonne santé" (équivalent
                    flow geofence). Activé par défaut, désactivable pour les
                    rares tâches qui ne consistent pas à vérifier les bêtes
                    (ex : réparer la clôture). */}
                {form.linkedLandId && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setForm(f => ({ ...f, healthCheckOnComplete: !f.healthCheckOnComplete }))}
                    className={`w-full mt-2 px-3 py-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                      form.healthCheckOnComplete
                        ? 'border-meadow/40 bg-meadow/8'
                        : 'border-border bg-cream/40'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      form.healthCheckOnComplete
                        ? 'border-meadow bg-meadow text-white'
                        : 'border-muted/40 bg-card'
                    }`}>
                      {form.healthCheckOnComplete && <Heart size={11} fill="currentColor" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-charcoal leading-tight">
                        Valide la santé des animaux sur ce terrain
                      </p>
                      <p className="text-[10px] text-muted mt-0.5 leading-snug">
                        {form.healthCheckOnComplete
                          ? 'Cocher la tâche = "tous vus, ils vont bien" pour tous les animaux du parc.'
                          : 'La tâche se cochera seule, mais le statut santé des animaux ne sera pas mis à jour.'}
                      </p>
                    </div>
                  </button>
                )}
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
                {saving
                  ? 'Enregistrement…'
                  : editingId
                    ? 'Enregistrer les modifications'
                    : 'Ajouter au pool commun'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
