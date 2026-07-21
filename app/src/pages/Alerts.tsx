import { useEffect, useState } from 'react'
import { Plus, X, AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react'
import {
  collection, query, onSnapshot, updateDoc, doc, addDoc, where,
} from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { timeAgo } from '../services/map/time'
import type { FermeAlert, AlertSeverity } from '../types'

const SEV: Record<AlertSeverity, { border: string; icon: string; bg: string; label: string; order: number }> = {
  urgent:  { border: 'border-l-danger', icon: 'text-danger', bg: 'bg-danger/5',  label: 'Urgent',    order: 0 },
  warning: { border: 'border-l-sun',    icon: 'text-sun',    bg: 'bg-sun/5',     label: 'Attention', order: 1 },
  info:    { border: 'border-l-sky',    icon: 'text-sky',    bg: 'bg-sky/5',     label: 'Info',      order: 2 },
}

// Le header prend la couleur de l'alerte la PLUS GRAVE en cours.
// Avant (bug Nils 21/07/2026, « la bannière rouge est trop agressive ») le rouge
// était constant : la page s'affichait en rouge sang même pour dire « aucune
// alerte active ». Du coup le rouge ne signalait plus rien.
// Les teintes reprennent les jetons de --theme (index.css) : forest / sky / sun /
// danger, exactement comme les pastilles SEV ci-dessus. Le texte reste blanc sur
// les quatre (tous des dégradés sombres), donc rien d'autre à changer.
const HEADER_BG: Record<AlertSeverity | 'none', string> = {
  none:    'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)', // forest — comme le reste de l'app
  info:    'linear-gradient(160deg, #075985 0%, #0EA5E9 100%)', // sky
  warning: 'linear-gradient(160deg, #92400E 0%, #F59E0B 100%)', // sun
  urgent:  'linear-gradient(160deg, #7F1D1D 0%, #DC2626 100%)', // danger — le rouge d'origine, réservé au vrai urgent
}

export default function Alerts() {
  const { user } = useAuth()

  const [active,       setActive]       = useState<FermeAlert[]>([])
  const [resolved,     setResolved]     = useState<FermeAlert[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [showForm,     setShowForm]     = useState(false)
  const [formMsg,      setFormMsg]      = useState('')
  const [formSev,      setFormSev]      = useState<AlertSeverity>('warning')
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'alerts'), where('resolved', '==', false)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as FermeAlert))
        all.sort((a, b) => (SEV[a.severity]?.order ?? 3) - (SEV[b.severity]?.order ?? 3))
        setActive(all)
      }
    )
    const u2 = onSnapshot(
      query(collection(db, 'alerts'), where('resolved', '==', true)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as FermeAlert))
        all.sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
        setResolved(all.slice(0, 20))
      }
    )
    return () => { u1(); u2() }
  }, [])

  async function resolve(alertId: string) {
    await updateDoc(doc(db, 'alerts', alertId), {
      resolved: true, resolvedAt: Date.now(), resolvedBy: user?.uid,
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!formMsg.trim() || !user) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'alerts'), {
        type: 'manual', message: formMsg.trim(), severity: formSev,
        resolved: false, createdAt: Date.now(), createdBy: user.uid,
      })
      setFormMsg('')
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  // `active` est déjà trié par gravité (SEV.order) : le premier est le pire.
  // Si une alerte porte une sévérité inconnue (les règles Firestore ne valident
  // pas le champ), HEADER_BG renvoie undefined → le `?? HEADER_BG.none` du JSX
  // évite un header transparent avec du texte blanc dessus.
  const worstSeverity: AlertSeverity | 'none' = active[0]?.severity ?? 'none'

  return (
    <div className="pb-4">

      {/* Header — couleur selon l'alerte la plus grave (vert si tout va bien) */}
      <div className="px-5 pt-12 pb-5"
           style={{ background: HEADER_BG[worstSeverity] ?? HEADER_BG.none }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold m-0">Alertes</h1>
            <p className="text-white/60 text-sm mt-0.5">
              {active.length === 0
                ? 'Aucune alerte active'
                : `${active.length} alerte${active.length > 1 ? 's' : ''} active${active.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-white/20 text-white text-sm font-semibold px-3.5 py-2 rounded-xl active:scale-95 transition-all"
          >
            <Plus size={16} /> Nouvelle
          </button>
        </div>
      </div>

      <div className="px-4 mt-3 space-y-3">

        {/* Alertes actives */}
        {active.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-charcoal font-semibold mb-1">Tout est calme</p>
            <p className="text-muted text-sm">Aucune alerte active</p>
          </div>
        ) : (
          active.map(alert => {
            const cfg = SEV[alert.severity] ?? SEV.info
            return (
              <div key={alert.id}
                   className={`bg-card rounded-2xl p-4 shadow-sm border-l-4 ${cfg.border} ${cfg.bg}`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className={`flex-shrink-0 mt-0.5 ${cfg.icon}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs font-bold uppercase ${cfg.icon}`}>{cfg.label}</span>
                      <span className="text-xs text-muted">{timeAgo(alert.createdAt)}</span>
                    </div>
                    <p className="text-charcoal text-sm font-medium leading-snug">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => resolve(alert.id)}
                    className="flex-shrink-0 flex items-center gap-1 text-xs text-muted font-medium
                               px-3 py-1.5 rounded-lg bg-white border border-border active:bg-cream transition-colors"
                  >
                    <Check size={12} /> Résolu
                  </button>
                </div>
              </div>
            )
          })
        )}

        {/* Alertes résolues */}
        {resolved.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowResolved(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider px-1 mb-2"
            >
              {showResolved ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Résolues ({resolved.length})
            </button>
            {showResolved && (
              <div className="space-y-2">
                {resolved.map(alert => (
                  <div key={alert.id}
                       className="bg-card rounded-2xl p-4 shadow-sm border-l-4 border-l-border opacity-60">
                    <div className="flex items-start gap-3">
                      <Check size={16} className="flex-shrink-0 mt-0.5 text-meadow" />
                      <div className="flex-1 min-w-0">
                        <p className="text-charcoal text-sm font-medium leading-snug line-through">
                          {alert.message}
                        </p>
                        <p className="text-muted text-xs mt-0.5">
                          Résolu {timeAgo(alert.resolvedAt ?? alert.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom sheet — créer une alerte */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !saving && setShowForm(false)}
          />
          <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-charcoal text-lg font-bold m-0">Nouvelle alerte</h2>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="p-2 rounded-xl text-muted active:bg-cream"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Message
                </label>
                <textarea
                  value={formMsg}
                  onChange={e => setFormMsg(e.target.value)}
                  placeholder="Décrivez l'alerte…"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-danger
                             focus:border-transparent transition-all resize-none"
                  autoFocus
                  disabled={saving}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Sévérité
                </label>
                <div className="flex gap-2">
                  {(['info', 'warning', 'urgent'] as AlertSeverity[]).map(v => {
                    const cfg = SEV[v]
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setFormSev(v)}
                        className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                          formSev === v
                            ? `${cfg.bg} ${cfg.icon} border-current`
                            : 'border-border text-muted bg-cream'
                        }`}
                        disabled={saving}
                      >
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <button
                type="submit"
                disabled={saving || !formMsg.trim()}
                className="w-full py-4 rounded-xl font-semibold text-white text-base bg-danger
                           active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                           disabled:active:scale-100 transition-all shadow-lg"
              >
                {saving ? 'Création…' : "Créer l'alerte"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
