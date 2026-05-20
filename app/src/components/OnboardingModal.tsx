import { useEffect, useState } from 'react'
import { Bell, MapPin, Check, ChevronRight, Loader2 } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { registerFcmTokenManually } from '../hooks/useMessaging'

/**
 * Modal d'onboarding affichée au 1er login pour demander explicitement :
 *   - Permission notifications push (Notification.requestPermission)
 *   - Partage de position GPS (geolocation + flag Firestore shareLocation)
 *
 * Le user clique "Activer" → on déclenche la vraie demande navigateur.
 * Une fois traité, on flag `onboardingDone: true` dans localStorage pour ne plus
 * re-prompter sur ce device. Le flag est par-utilisateur (uid).
 *
 * UX : le modal apparaît 1 s après l'arrivée sur le dashboard, pour laisser
 * la page se charger d'abord (moins agressif). On peut "Passer" et tout
 * activer plus tard depuis Settings.
 */

interface State {
  notif: 'idle' | 'requesting' | 'granted' | 'denied'
  geo:   'idle' | 'requesting' | 'granted' | 'denied'
}

function lsKey(uid: string) { return `fm_onboarded_${uid}` }

export default function OnboardingModal() {
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ notif: 'idle', geo: 'idle' })

  // Décide si on affiche
  useEffect(() => {
    if (!user || !profile) return
    if (typeof window === 'undefined') return

    // Déjà passé l'onboarding sur ce device ?
    try {
      if (localStorage.getItem(lsKey(user.uid)) === 'done') return
    } catch { /* localStorage indisponible — on continue */ }

    // Si tout est déjà accordé, on flag direct et on n'affiche pas
    const notifOk = typeof Notification !== 'undefined' && Notification.permission === 'granted'
    const geoOk   = profile.shareLocation === true
    if (notifOk && geoOk) {
      try { localStorage.setItem(lsKey(user.uid), 'done') } catch { /* ignoré */ }
      return
    }

    // Initialise l'état avec les permissions déjà connues
    setState(s => ({
      ...s,
      notif: notifOk ? 'granted' : Notification?.permission === 'denied' ? 'denied' : 'idle',
      geo:   geoOk   ? 'granted' : 'idle',
    }))

    // Laisser la page se charger 1s avant le pop-up (moins agressif)
    const t = setTimeout(() => setOpen(true), 1000)
    return () => clearTimeout(t)
  }, [user, profile])

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      setState(s => ({ ...s, notif: 'granted' }))
      return
    }
    if (Notification.permission === 'denied') {
      setState(s => ({ ...s, notif: 'denied' }))
      return
    }
    setState(s => ({ ...s, notif: 'requesting' }))
    try {
      const result = await Notification.requestPermission()
      const granted = result === 'granted'
      setState(s => ({ ...s, notif: granted ? 'granted' : 'denied' }))
      // Demande tout de suite un token FCM pendant qu'on est encore dans
      // le geste utilisateur (certaines plateformes l'exigent).
      if (granted && user) {
        registerFcmTokenManually(user.uid).catch(() => {})
      }
    } catch {
      setState(s => ({ ...s, notif: 'denied' }))
    }
  }

  async function requestGeolocation() {
    if (!user) return
    if (!('geolocation' in navigator)) {
      setState(s => ({ ...s, geo: 'denied' }))
      return
    }
    setState(s => ({ ...s, geo: 'requesting' }))
    // 1. Test du navigateur : déclenche le prompt natif
    try {
      await new Promise<void>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(() => resolve(), reject, { timeout: 15_000 })
      })
    } catch {
      setState(s => ({ ...s, geo: 'denied' }))
      return
    }
    // 2. Active le partage dans Firestore (l'app commencera à diffuser la position)
    try {
      await updateDoc(doc(db, 'users', user.uid), { shareLocation: true })
      setState(s => ({ ...s, geo: 'granted' }))
    } catch {
      // Permission OS OK mais write Firestore échoué — on flag granted quand même
      // (le toggle Settings pourra retry)
      setState(s => ({ ...s, geo: 'granted' }))
    }
  }

  function finish() {
    if (user) {
      try { localStorage.setItem(lsKey(user.uid), 'done') } catch { /* ignoré */ }
    }
    setOpen(false)
  }

  if (!open) return null

  const renderStatus = (st: State['notif']) => {
    if (st === 'granted')    return <Check size={16} className="text-meadow" />
    if (st === 'requesting') return <Loader2 size={16} className="text-forest animate-spin" />
    if (st === 'denied')     return <span className="text-[11px] font-bold text-danger">Refusé</span>
    return <ChevronRight size={16} className="text-muted" />
  }

  return (
    <div className="fixed inset-0 z-[9500] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">

        <h2 className="text-charcoal text-xl font-bold m-0 mb-1">Bienvenue 👋</h2>
        <p className="text-sm text-muted mb-5 leading-relaxed">
          Pour que l'app soit vraiment utile, on a besoin de deux permissions.
          Tu peux toujours les changer plus tard dans Réglages.
        </p>

        {/* Notifications */}
        <button
          onClick={requestNotifications}
          disabled={state.notif === 'requesting' || state.notif === 'granted'}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all mb-3
            ${state.notif === 'granted'
              ? 'border-meadow/40 bg-meadow/5'
              : state.notif === 'denied'
                ? 'border-danger/30 bg-danger/5'
                : 'border-border bg-cream active:scale-[0.98]'}`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
            ${state.notif === 'granted' ? 'bg-meadow/15 text-meadow'
                                        : 'bg-forest/10 text-forest'}`}>
            <Bell size={18} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-bold text-charcoal m-0">Notifications</p>
            <p className="text-xs text-muted mt-0.5 leading-tight">
              {state.notif === 'denied'
                ? 'Permission refusée — active-les dans les réglages de ton navigateur'
                : 'Pour recevoir les rappels d\'eau, batteries, tâches en retard'}
            </p>
          </div>
          <div className="flex-shrink-0">{renderStatus(state.notif)}</div>
        </button>

        {/* GPS */}
        <button
          onClick={requestGeolocation}
          disabled={state.geo === 'requesting' || state.geo === 'granted'}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all mb-5
            ${state.geo === 'granted'
              ? 'border-meadow/40 bg-meadow/5'
              : state.geo === 'denied'
                ? 'border-danger/30 bg-danger/5'
                : 'border-border bg-cream active:scale-[0.98]'}`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
            ${state.geo === 'granted' ? 'bg-meadow/15 text-meadow'
                                       : 'bg-forest/10 text-forest'}`}>
            <MapPin size={18} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-bold text-charcoal m-0">Partage de position</p>
            <p className="text-xs text-muted mt-0.5 leading-tight">
              {state.geo === 'denied'
                ? 'Permission refusée — active la géolocalisation dans ton navigateur'
                : 'Voir les membres de la famille sur la carte (s\'arrête seul après 2 h)'}
            </p>
          </div>
          <div className="flex-shrink-0">{renderStatus(state.geo)}</div>
        </button>

        <button
          onClick={finish}
          className="w-full py-3 rounded-xl bg-forest text-white text-sm font-bold active:scale-95 transition-all"
        >
          {state.notif === 'granted' && state.geo === 'granted'
            ? "C'est parti"
            : state.notif === 'idle' && state.geo === 'idle'
              ? 'Passer pour l\'instant'
              : 'Continuer'}
        </button>

      </div>
    </div>
  )
}
