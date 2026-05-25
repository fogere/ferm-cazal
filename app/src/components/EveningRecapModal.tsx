import { useEffect, useMemo, useState } from 'react'
import { Moon, CheckCircle2, AlertCircle, Plus, ArrowRight, X, Sunrise } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, onSnapshot, query, updateDoc } from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import type { Task, UserProfile } from '../types'

/**
 * Bilan du soir : pop-up qui apparaît automatiquement à partir de l'heure
 * configurée par l'utilisateur (profile.eveningRecapTime, défaut 19:00) une
 * fois par jour. Peut aussi être ouvert manuellement depuis le Dashboard.
 *
 * Contenu :
 *   - Ce qui a été fait aujourd'hui (compte + liste collapsible)
 *   - Ce qui n'a pas été fait (avec bouton "Reporter à demain")
 *   - Ce qui est prévu demain (preview)
 *   - Lien vers Tâches pour en ajouter
 *
 * Ouverture manuelle : émettre l'événement window 'open-evening-recap'.
 * Le modal s'ouvre alors sans tenir compte du flag "déjà fait aujourd'hui".
 *
 * Demande Nils 25/05/2026 : heure custom + accès permanent via encart Dashboard.
 */

const RECAP_HOUR_TO = 23  // s'arrête après 23h (on ne pop pas au milieu de la nuit)
export const OPEN_EVENING_RECAP_EVENT = 'open-evening-recap'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lsKey(uid: string, day: string) {
  return `fm_evening_recap_done_${uid}_${day}`
}

// Parse "HH:MM" en minutes depuis minuit. Retourne null si invalide.
function parseHHMM(s: string | undefined | null): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null
  const [hh, mm] = s.split(':').map(Number)
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

// Helper exporté pour le Dashboard : l'heure (en minutes) à partir de laquelle
// l'encart bilan devient visible pour ce profil.
export function eveningRecapMinutes(time: string | undefined | null): number {
  return parseHHMM(time) ?? 19 * 60
}

function startOfDay(offset: number) {
  const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function endOfDay(offset: number) {
  const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export default function EveningRecapModal() {
  const { user, profile, isTemp } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [postponingId, setPostponingId] = useState<string | null>(null)

  /* Décide si on ouvre (timer auto à l'heure du profil) */
  useEffect(() => {
    if (!user || isTemp) return
    if (typeof window === 'undefined') return

    const startMin = eveningRecapMinutes(profile?.eveningRecapTime)

    function check() {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (nowMin < startMin || now.getHours() > RECAP_HOUR_TO) return
      try {
        const already = localStorage.getItem(lsKey(user!.uid, todayKey()))
        if (already === 'done') return
      } catch { /* ignoré */ }
      setOpen(true)
    }

    // Check au montage + check toutes les 5 min
    check()
    const t = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [user, isTemp, profile?.eveningRecapTime])

  /* Ouverture manuelle déclenchée depuis le Dashboard (force, même si déjà fermé) */
  useEffect(() => {
    if (!user || isTemp) return
    if (typeof window === 'undefined') return
    function onOpen() { setOpen(true) }
    window.addEventListener(OPEN_EVENING_RECAP_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENING_RECAP_EVENT, onOpen)
  }, [user, isTemp])

  /* Listeners données */
  useEffect(() => {
    if (!open) return
    const unsub = onSnapshot(query(collection(db, 'tasks')), snap =>
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)))
    )
    return unsub
  }, [open])

  useEffect(() => {
    if (!open) return
    const unsub = onSnapshot(collection(db, 'users'), snap =>
      setUsers(snap.docs.map(d => d.data() as UserProfile))
    )
    return unsub
  }, [open])

  /* Filtres */
  const summary = useMemo(() => {
    const todayStart = startOfDay(0)
    const todayEnd   = endOfDay(0)
    const tomorrowStart = startOfDay(1)
    const tomorrowEnd   = endOfDay(1)

    const doneToday = tasks.filter(t =>
      t.completed && (t.completedAt ?? 0) >= todayStart && (t.completedAt ?? 0) <= todayEnd
    )
    const notDoneToday = tasks.filter(t =>
      !t.completed && t.dueDate >= todayStart && t.dueDate <= todayEnd
    )
    const tomorrowPlanned = tasks.filter(t =>
      !t.completed && t.dueDate >= tomorrowStart && t.dueDate <= tomorrowEnd
    )

    return { doneToday, notDoneToday, tomorrowPlanned }
  }, [tasks])

  function userName(uid: string | null | undefined): string {
    if (!uid) return ''
    const u = users.find(u => u.uid === uid)
    return u?.displayName ?? '?'
  }
  function userColor(uid: string | null | undefined): string {
    if (!uid) return '#6B7280'
    const u = users.find(u => u.uid === uid)
    return u?.color ?? '#6B7280'
  }

  async function postponeToTomorrow(task: Task) {
    setPostponingId(task.id)
    try {
      const newDue = endOfDay(1) - 12 * 3600_000  // demain midi
      await updateDoc(doc(db, 'tasks', task.id), { dueDate: newDue })
    } catch { /* ignoré silencieusement */ }
    finally { setPostponingId(null) }
  }

  function closeMarkDone() {
    if (user) {
      try { localStorage.setItem(lsKey(user.uid, todayKey()), 'done') }
      catch { /* ignoré */ }
    }
    setOpen(false)
  }

  function gotoTasks() {
    closeMarkDone()
    navigate('/tasks')
  }

  if (!open || !user) return null

  return (
    <div className="fixed inset-0 z-[9400] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl
                      max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="p-5 border-b border-border/40 sticky top-0 bg-card z-10">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-forest/10 flex items-center justify-center flex-shrink-0">
              <Moon size={20} className="text-forest" />
            </div>
            <div className="flex-1">
              <h2 className="text-charcoal text-lg font-bold m-0">
                Bilan du soir, {profile?.displayName ?? 'là'} 🌙
              </h2>
              <p className="text-xs text-muted mt-0.5 leading-tight">
                Récap de la journée et ce qui est prévu demain.
              </p>
            </div>
            <button
              onClick={closeMarkDone}
              aria-label="Fermer"
              className="p-2 rounded-xl text-muted active:bg-cream flex-shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Stats globales */}
        <div className="px-5 pt-4 grid grid-cols-2 gap-2">
          <div className="bg-meadow/10 border border-meadow/30 rounded-2xl p-3 text-center">
            <p className="text-2xl font-bold text-meadow m-0">{summary.doneToday.length}</p>
            <p className="text-xs text-muted mt-0.5">faites aujourd'hui</p>
          </div>
          <div className={`rounded-2xl p-3 text-center border ${
            summary.notDoneToday.length === 0
              ? 'bg-meadow/10 border-meadow/30'
              : 'bg-sun/10 border-sun/30'
          }`}>
            <p className={`text-2xl font-bold m-0 ${
              summary.notDoneToday.length === 0 ? 'text-meadow' : 'text-earth'
            }`}>{summary.notDoneToday.length}</p>
            <p className="text-xs text-muted mt-0.5">non faites</p>
          </div>
        </div>

        {/* Faites */}
        {summary.doneToday.length > 0 && (
          <div className="px-5 pt-4">
            <p className="text-xs font-semibold text-meadow uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle2 size={12} /> Faites aujourd'hui ({summary.doneToday.length})
            </p>
            <div className="bg-cream rounded-2xl p-2 space-y-0.5">
              {summary.doneToday.slice(0, 10).map(t => (
                <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <CheckCircle2 size={14} className="text-meadow flex-shrink-0" />
                  <span className="text-charcoal line-through opacity-70 flex-1 truncate">{t.title}</span>
                  {t.completedBy && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
                      style={{ backgroundColor: userColor(t.completedBy) }}
                    >
                      {userName(t.completedBy)}
                    </span>
                  )}
                </div>
              ))}
              {summary.doneToday.length > 10 && (
                <p className="text-[11px] text-muted text-center pt-1">
                  + {summary.doneToday.length - 10} autres
                </p>
              )}
            </div>
          </div>
        )}

        {/* Non faites */}
        {summary.notDoneToday.length > 0 && (
          <div className="px-5 pt-4">
            <p className="text-xs font-semibold text-earth uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlertCircle size={12} /> Non faites ({summary.notDoneToday.length})
            </p>
            <div className="bg-sun/5 rounded-2xl p-2 space-y-1.5 border border-sun/20">
              {summary.notDoneToday.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <AlertCircle size={14} className="text-sun flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-charcoal block truncate">{t.title}</span>
                    {t.assignedTo && (
                      <span className="text-[10px] text-muted">
                        Prise par {userName(t.assignedTo)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => postponeToTomorrow(t)}
                    disabled={postponingId === t.id}
                    className="text-[11px] font-bold text-forest border border-forest/30 bg-forest/5
                               px-2 py-1 rounded-lg active:scale-95 disabled:opacity-40 flex items-center gap-1"
                  >
                    Demain <ArrowRight size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Demain — preview */}
        <div className="px-5 pt-4">
          <p className="text-xs font-semibold text-sky uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sunrise size={12} /> Prévu demain ({summary.tomorrowPlanned.length})
          </p>
          {summary.tomorrowPlanned.length === 0 ? (
            <div className="bg-cream rounded-2xl p-3 text-center text-sm text-muted">
              Aucune tâche pour demain — penser à anticiper ?
            </div>
          ) : (
            <div className="bg-sky/5 rounded-2xl p-2 space-y-0.5 border border-sky/20">
              {summary.tomorrowPlanned.slice(0, 8).map(t => (
                <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky flex-shrink-0" />
                  <span className="text-charcoal flex-1 truncate">{t.title}</span>
                  {!t.assignedTo
                    ? <span className="text-[10px] font-bold text-meadow">Libre</span>
                    : (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: userColor(t.assignedTo) }}
                      >
                        {userName(t.assignedTo)}
                      </span>
                    )}
                </div>
              ))}
              {summary.tomorrowPlanned.length > 8 && (
                <p className="text-[11px] text-muted text-center pt-1">
                  + {summary.tomorrowPlanned.length - 8} autres
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions bas */}
        <div className="p-5 sticky bottom-0 bg-card border-t border-border/40 space-y-2">
          <button
            onClick={gotoTasks}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-forest/30
                       bg-forest/5 text-forest text-sm font-bold active:scale-95 transition-all"
          >
            <Plus size={16} /> Ajouter / modifier les tâches
          </button>
          <button
            onClick={closeMarkDone}
            className="w-full py-3 rounded-xl bg-forest text-white text-sm font-bold active:scale-95"
          >
            Bonne nuit 🌙
          </button>
          <p className="text-[10px] text-muted/60 text-center">
            Ce bilan ne réapparaîtra pas ce soir.
          </p>
        </div>
      </div>
    </div>
  )
}
