import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LogOut, Check, User, Bell, Shield, ChevronRight, MapPin, Moon, Sun, Bug,
  Lock, Eye, EyeOff, Minimize2, Maximize2, BatteryLow, Battery, BatteryFull,
  BellOff, AlertCircle, ExternalLink, Download,
} from 'lucide-react'
import { doc, deleteField } from '../services/firestoreMonitor'
import {
  reauthenticateWithCredential, EmailAuthProvider, updatePassword,
} from 'firebase/auth'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useDensity } from '../hooks/useDensity'
import { registerFcmTokenManually } from '../hooks/useMessaging'
import { updateDocBounded, FirestoreWriteTimeoutError } from '../services/firestoreWrite'
import { locationCore, type GpsMode } from '../services/location/locationCore'
import OfflineMapButton from '../components/OfflineMapButton'

export default function Settings() {
  const { user, profile, logout, isTemp } = useAuth()
  const navigate = useNavigate()

  const [editName,    setEditName]    = useState(false)
  const [nameVal,     setNameVal]     = useState(profile?.displayName ?? '')
  const [savingName,  setSavingName]  = useState(false)

  const [silentStart, setSilentStart] = useState(profile?.silentStart ?? '22:00')
  const [silentEnd,   setSilentEnd]   = useState(profile?.silentEnd   ?? '07:00')
  const [morningReminderTime, setMorningReminderTime] = useState(
    profile?.morningReminderTime ?? profile?.silentEnd ?? '07:00'
  )
  const [eveningRecapTime, setEveningRecapTime] = useState(
    profile?.eveningRecapTime ?? '19:00'
  )
  // Mode GPS — local au device (Nils V4 #4)
  const [gpsMode, setGpsMode] = useState<GpsMode>(() => locationCore.getMode())
  const [savingHours, setSavingHours] = useState(false)
  const [hoursSaved,  setHoursSaved]  = useState(false)
  const [savingShare, setSavingShare] = useState(false)
  const [writeError,  setWriteError]  = useState<string | null>(null)

  /* ─── Notifications (refonte Nils V4 #1 24/05/2026) ───
   * Bloc "intelligent" : détecte l'état permission + token présent, propose
   * un toggle on/off et une guidance si le navigateur a refusé.
   *
   * 3 états de permission :
   *   - 'granted' + token : ON (vert)
   *   - 'granted' + pas de token : ON mais souscription échouée (warning bleu)
   *   - 'default' : pas demandé, toggle activable (gris)
   *   - 'denied' : refusé à vie côté navigateur, instructions affichées (rouge)
   *
   * Re-check au focus de la page (l'utilisatrice peut avoir changé la perm
   * via les réglages du navigateur sans recharger).
   */
  const [notifState, setNotifState] = useState<NotifState>('unsupported')
  const [notifBusy, setNotifBusy] = useState(false)
  const [showDeniedHelp, setShowDeniedHelp] = useState(false)

  function detectNotifState(): NotifState {
    if (typeof Notification === 'undefined') return 'unsupported'
    const perm = Notification.permission
    if (perm === 'denied')  return 'denied'
    if (perm === 'default') return 'default'
    // granted : si on a un token côté Firestore, c'est OK ; sinon souscription
    // a échoué (cas Chrome Windows push service error — cf. announcements.ts).
    return profile?.fcmToken ? 'granted-token' : 'granted-no-token'
  }

  useEffect(() => {
    setNotifState(detectNotifState())
    function onFocus() { setNotifState(detectNotifState()) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.fcmToken])

  // Détecte le navigateur pour afficher la bonne route dans la guidance "denied".
  function detectBrowser(): 'chrome-android' | 'chrome-desktop' | 'firefox' | 'safari' | 'edge' | 'other' {
    if (typeof navigator === 'undefined') return 'other'
    const ua = navigator.userAgent.toLowerCase()
    const isAndroid = /android/.test(ua)
    if (/edg\//.test(ua)) return 'edge'
    if (/firefox/.test(ua)) return 'firefox'
    if (/chrome/.test(ua)) return isAndroid ? 'chrome-android' : 'chrome-desktop'
    if (/safari/.test(ua)) return 'safari'
    return 'other'
  }

  async function toggleNotifications() {
    if (!user) return
    setNotifBusy(true)
    try {
      const state = detectNotifState()
      if (state === 'unsupported') return
      if (state === 'denied') {
        // Permission bloquée au niveau navigateur : on ne peut PAS la re-demander.
        // On ouvre le tutoriel adapté au navigateur de l'utilisatrice.
        setShowDeniedHelp(true)
        return
      }
      if (state === 'granted-token') {
        // OFF : on efface le token Firestore (le scanner cron arrête d'envoyer).
        // Note : on ne révoque PAS la permission navigateur (impossible côté JS).
        // L'utilisatrice peut "se réabonner" à tout moment via le même bouton.
        await updateDocBounded(doc(db, 'users', user.uid), { fcmToken: deleteField() })
        setNotifState(detectNotifState())
        return
      }
      // 'default' ou 'granted-no-token' : on (re)demande la perm si besoin
      // puis on tente d'obtenir un token.
      let perm = Notification.permission
      if (perm === 'default') {
        perm = await Notification.requestPermission()
      }
      if (perm !== 'granted') {
        // L'utilisatrice a refusé → on devient 'denied', on propose la guidance.
        setNotifState('denied')
        setShowDeniedHelp(true)
        return
      }
      const ok = await registerFcmTokenManually(user.uid)
      if (!ok) {
        // Permission OK mais push service refuse (Chrome/Edge Windows typique).
        // L'état reste 'granted-no-token' avec un message d'aide.
        handleWriteFailure(new Error('Push service unavailable'))
      }
      setNotifState(detectNotifState())
    } catch (e) {
      handleWriteFailure(e)
    } finally {
      setNotifBusy(false)
    }
  }

  /* ─── Changement de mot de passe ─── */
  const [pwOpen,        setPwOpen]        = useState(false)
  const [pwCurrent,     setPwCurrent]     = useState('')
  const [pwNew,         setPwNew]         = useState('')
  const [pwConfirm,     setPwConfirm]     = useState('')
  const [pwShow,        setPwShow]        = useState(false)
  const [pwSaving,      setPwSaving]      = useState(false)
  const [pwError,       setPwError]       = useState<string | null>(null)
  const [pwSuccess,     setPwSuccess]     = useState(false)

  const { theme, toggleTheme } = useTheme()
  const { density, setDensity } = useDensity()

  async function changePassword() {
    if (!user || !user.email) return
    setPwError(null)
    if (pwNew.length < 6) {
      setPwError('Le nouveau mot de passe doit faire au moins 6 caractères.')
      return
    }
    if (pwNew !== pwConfirm) {
      setPwError('La confirmation ne correspond pas.')
      return
    }
    if (pwNew === pwCurrent) {
      setPwError('Le nouveau mot de passe doit être différent de l\'ancien.')
      return
    }
    setPwSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, pwCurrent)
      await reauthenticateWithCredential(user, cred)
      await updatePassword(user, pwNew)
      setPwSuccess(true)
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      setTimeout(() => {
        setPwOpen(false)
        setPwSuccess(false)
      }, 1800)
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPwError('Mot de passe actuel incorrect.')
      } else if (code === 'auth/weak-password') {
        setPwError('Le nouveau mot de passe est trop faible.')
      } else if (code === 'auth/too-many-requests') {
        setPwError('Trop de tentatives. Réessaye dans quelques minutes.')
      } else if (code === 'auth/network-request-failed') {
        setPwError('Pas de connexion réseau.')
      } else {
        setPwError('Échec du changement de mot de passe.')
      }
    } finally {
      setPwSaving(false)
    }
  }

  function handleWriteFailure(e: unknown) {
    if (e instanceof FirestoreWriteTimeoutError) {
      setWriteError("Serveur Firebase saturé — modification mise en file d'attente.")
    } else {
      setWriteError("Échec de l'enregistrement. Réessayez dans un instant.")
    }
    setTimeout(() => setWriteError(null), 5000)
  }

  async function saveName() {
    if (!user || !nameVal.trim()) return
    setSavingName(true)
    try {
      await updateDocBounded(doc(db, 'users', user.uid), { displayName: nameVal.trim() })
      setEditName(false)
    } catch (e) {
      handleWriteFailure(e)
    } finally {
      setSavingName(false)
    }
  }

  async function saveHours() {
    if (!user) return
    setSavingHours(true)
    try {
      await updateDocBounded(doc(db, 'users', user.uid), {
        silentStart,
        silentEnd,
        morningReminderTime,
        eveningRecapTime,
      })
      setHoursSaved(true)
      setTimeout(() => setHoursSaved(false), 2000)
    } catch (e) {
      handleWriteFailure(e)
    } finally {
      setSavingHours(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function toggleShareLocation() {
    if (!user) return
    const next = !(profile?.shareLocation ?? false)
    // Si on active, on demande d'abord la permission navigateur
    if (next && 'geolocation' in navigator) {
      try {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(() => resolve(), reject, { timeout: 10_000 })
        })
      } catch {
        alert('Permission GPS refusée. Activez-la dans les réglages du navigateur pour partager votre position.')
        return
      }
    }
    setSavingShare(true)
    try {
      const updates: Record<string, unknown> = { shareLocation: next }
      // Si on désactive, on efface aussi la dernière position connue
      if (!next) updates.liveLocation = deleteField()
      await updateDocBounded(doc(db, 'users', user.uid), updates)
    } catch (e) {
      handleWriteFailure(e)
    } finally {
      setSavingShare(false)
    }
  }

  return (
    <div className="pb-8">

      {/* Header */}
      <div className="px-5 pt-12 pb-6"
           style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)' }}>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
            style={{ backgroundColor: profile?.color ?? '#1A4731' }}
          >
            {profile?.displayName?.charAt(0) ?? '?'}
          </div>
          <div>
            <h1 className="text-white text-xl font-bold m-0">{profile?.displayName ?? '…'}</h1>
            <p className="text-white/60 text-sm mt-0.5">
              {isTemp ? 'Accès temporaire' : 'Compte permanent'}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Bandeau d'erreur d'écriture (timeout Firestore, quota dépassé…) */}
        {writeError && (
          <div className="bg-danger/10 border border-danger/30 rounded-2xl px-4 py-3 text-sm text-danger">
            ⚠ {writeError}
          </div>
        )}

        {/* Profil */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-muted" />
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Profil</p>
          </div>

          {editName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-xl border border-forest bg-cream text-charcoal text-sm
                           focus:outline-none focus:ring-2 focus:ring-forest transition-all"
                autoFocus
                disabled={savingName}
                onKeyDown={e => e.key === 'Enter' && saveName()}
              />
              <button
                onClick={saveName}
                disabled={savingName || !nameVal.trim()}
                className="px-4 py-2.5 rounded-xl bg-forest text-white text-sm font-semibold
                           active:scale-95 disabled:opacity-40 transition-all"
              >
                {savingName ? '…' : <Check size={16} />}
              </button>
              <button
                onClick={() => { setEditName(false); setNameVal(profile?.displayName ?? '') }}
                className="px-3 py-2.5 rounded-xl border border-border text-muted text-sm active:bg-cream"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted mb-0.5">Prénom affiché</p>
                <p className="text-charcoal font-semibold">{profile?.displayName}</p>
              </div>
              <button
                onClick={() => { setNameVal(profile?.displayName ?? ''); setEditName(true) }}
                className="text-xs text-forest font-semibold px-3 py-1.5 rounded-lg active:bg-meadow/10 transition-colors"
              >
                Modifier
              </button>
            </div>
          )}
        </div>

        {/* Heures silencieuses */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={16} className="text-muted" />
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Notifications</p>
          </div>
          <p className="text-xs text-muted mb-4">
            Aucune notification entre ces heures.
          </p>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1.5">Silence à partir de</label>
              <input
                type="time"
                value={silentStart}
                onChange={e => setSilentStart(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-cream text-charcoal text-sm
                           focus:outline-none focus:ring-2 focus:ring-forest transition-all"
              />
            </div>
            <div className="text-muted text-sm pt-5">→</div>
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1.5">Silence jusqu'à</label>
              <input
                type="time"
                value={silentEnd}
                onChange={e => setSilentEnd(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-cream text-charcoal text-sm
                           focus:outline-none focus:ring-2 focus:ring-forest transition-all"
              />
            </div>
          </div>

          {/* Heure du résumé matinal */}
          <div className="mb-4 pt-3 border-t border-border/40">
            <label className="block text-xs text-muted mb-1.5">
              Résumé du matin envoyé à
            </label>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={morningReminderTime}
                onChange={e => setMorningReminderTime(e.target.value)}
                className="w-32 px-3 py-2.5 rounded-xl border border-border bg-cream text-charcoal text-sm
                           focus:outline-none focus:ring-2 focus:ring-forest transition-all"
              />
              <p className="text-[11px] text-muted leading-tight flex-1">
                Notification push avec les tâches du jour à cette heure-là.
                Par défaut : fin des heures silencieuses.
              </p>
            </div>
          </div>

          {/* Heure du bilan du soir (demande Nils 25/05/2026) */}
          <div className="mb-4 pt-3 border-t border-border/40">
            <label className="block text-xs text-muted mb-1.5">
              Bilan du soir disponible à partir de
            </label>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={eveningRecapTime}
                onChange={e => setEveningRecapTime(e.target.value)}
                className="w-32 px-3 py-2.5 rounded-xl border border-border bg-cream text-charcoal text-sm
                           focus:outline-none focus:ring-2 focus:ring-forest transition-all"
              />
              <p className="text-[11px] text-muted leading-tight flex-1">
                Notification push + ouverture du récap visuel à cette heure.
                Encart toujours accessible sur le Dashboard après cette heure.
              </p>
            </div>
          </div>

          <button
            onClick={saveHours}
            disabled={savingHours}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95
              ${hoursSaved
                ? 'bg-meadow/15 text-meadow'
                : 'bg-forest/10 text-forest border border-forest/20'
              } disabled:opacity-40`}
          >
            {hoursSaved ? '✓ Enregistré' : savingHours ? 'Enregistrement…' : 'Enregistrer'}
          </button>

          {/* État + toggle notifications — refonte Nils V4 #1 (24/05/2026).
              Détecte automatiquement l'état permission + token et propose
              soit un toggle ON/OFF, soit une guidance navigateur. */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <NotificationsToggle
              state={notifState}
              busy={notifBusy}
              onToggle={toggleNotifications}
              onOpenHelp={() => setShowDeniedHelp(true)}
            />
          </div>
        </div>

        {/* Partage de position GPS */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={16} className="text-muted" />
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Partage de position</p>
          </div>
          <p className="text-xs text-muted mb-4 leading-relaxed">
            Partage ta position GPS avec les autres membres de la famille. Visible sur la carte uniquement par les personnes connectées.
            Position rafraîchie au max toutes les 30 secondes.
          </p>
          <button
            onClick={toggleShareLocation}
            disabled={savingShare}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-2
              ${profile?.shareLocation
                ? 'bg-meadow/15 text-meadow border border-meadow/30'
                : 'bg-cream text-muted border border-border'
              } disabled:opacity-40`}
          >
            <MapPin size={15} />
            {savingShare
              ? '…'
              : profile?.shareLocation
                ? '✓ Partage activé'
                : 'Activer le partage'}
          </button>

          {/* Mode GPS — Nils V4 #4 (24/05/2026). Local au device car le choix
              dépend de l'appareil (téléphone vs PC, batterie restante, etc.). */}
          <div className="mt-4 pt-3 border-t border-border/40">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">
              Précision GPS
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['low',    'Faible',  BatteryLow,  'Économie batterie (Wi-Fi + cell, ±50 m)'],
                ['medium', 'Moyen',   Battery,     'Compromis par défaut (GPS, ±10 m)'],
                ['high',   'Précis',  BatteryFull, 'Terrain — précision max, plus de batterie'],
              ] as const).map(([k, label, Icon, hint]) => (
                <button
                  key={k}
                  type="button"
                  title={hint}
                  onClick={() => {
                    if (gpsMode === k) return
                    setGpsMode(k)
                    locationCore.setMode(k)
                  }}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
                    gpsMode === k
                      ? 'border-forest bg-forest/15 text-forest'
                      : 'border-border bg-cream text-muted'
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted/70 mt-1.5 leading-tight">
              {gpsMode === 'low'    && 'Wi-Fi/cell positioning, max 5 min de fraîcheur. Idéal si batterie faible.'}
              {gpsMode === 'medium' && 'GPS satellite, mise à jour ~30 s. Bon pour usage courant.'}
              {gpsMode === 'high'   && 'GPS satellite, mise à jour ~5 s. Pour suivre un déplacement précis (consomme + de batterie).'}
            </p>
          </div>
        </div>

        {/* Carte hors-ligne — pré-téléchargement des tuiles de la ferme (Nils 03/06/2026).
            IGN est lent à la 1ʳᵉ visite d'une zone ; on télécharge une fois la zone ferme
            pour qu'elle soit ensuite instantanée et dispo sans réseau. */}
        {!isTemp && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Download size={16} className="text-muted" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Carte hors-ligne</p>
            </div>
            <p className="text-xs text-muted mb-3">
              La carte IGN est lente à charger la première fois (zones blanches). Télécharge une fois
              la zone de la ferme : ensuite elle s'affiche instantanément, même sans réseau.
            </p>
            <OfflineMapButton />
          </div>
        )}

        {/* Sécurité — changement de mot de passe (utilisateurs réguliers uniquement) */}
        {!isTemp && user?.email && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Lock size={16} className="text-muted" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Sécurité</p>
            </div>
            {!pwOpen ? (
              <button
                onClick={() => { setPwOpen(true); setPwError(null); setPwSuccess(false) }}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-cream text-charcoal
                           border border-border active:bg-meadow/5 transition-all flex items-center justify-center gap-2"
              >
                <Lock size={14} /> Modifier mon mot de passe
              </button>
            ) : (
              <div className="space-y-2 mt-2">
                <div className="relative">
                  <input
                    type={pwShow ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    placeholder="Mot de passe actuel"
                    autoComplete="current-password"
                    disabled={pwSaving || pwSuccess}
                    className="w-full pl-3 pr-10 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                               focus:outline-none focus:ring-2 focus:ring-forest transition-all disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setPwShow(v => !v)}
                    aria-label={pwShow ? 'Masquer' : 'Afficher'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted p-1"
                  >
                    {pwShow ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <input
                  type={pwShow ? 'text' : 'password'}
                  value={pwNew}
                  onChange={e => setPwNew(e.target.value)}
                  placeholder="Nouveau mot de passe (6 caractères min)"
                  autoComplete="new-password"
                  disabled={pwSaving || pwSuccess}
                  className="w-full px-3 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             focus:outline-none focus:ring-2 focus:ring-forest transition-all disabled:opacity-60"
                />
                <input
                  type={pwShow ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Confirmer le nouveau mot de passe"
                  autoComplete="new-password"
                  disabled={pwSaving || pwSuccess}
                  className="w-full px-3 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                             focus:outline-none focus:ring-2 focus:ring-forest transition-all disabled:opacity-60"
                />

                {pwError && (
                  <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 text-xs text-danger font-semibold">
                    {pwError}
                  </div>
                )}
                {pwSuccess && (
                  <div className="bg-meadow/10 border border-meadow/30 rounded-xl px-3 py-2 text-xs text-meadow font-semibold">
                    ✓ Mot de passe changé
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      setPwOpen(false); setPwError(null)
                      setPwCurrent(''); setPwNew(''); setPwConfirm('')
                    }}
                    disabled={pwSaving}
                    className="flex-1 py-3 rounded-xl border border-border text-muted text-sm font-semibold
                               active:bg-cream transition-colors disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={changePassword}
                    disabled={pwSaving || pwSuccess || !pwCurrent || !pwNew || !pwConfirm}
                    className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold
                               active:scale-95 transition-all disabled:opacity-40"
                  >
                    {pwSaving ? '…' : pwSuccess ? '✓' : 'Valider'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Apparence (mode sombre) */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            {theme === 'dark' ? <Moon size={16} className="text-muted" /> : <Sun size={16} className="text-muted" />}
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Apparence</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => theme !== 'light' && toggleTheme()}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                theme === 'light'
                  ? 'border-2 border-sun bg-sun/15 text-earth'
                  : 'border border-border text-muted bg-cream'
              }`}
            >
              <Sun size={16} /> Clair
            </button>
            <button
              onClick={() => theme !== 'dark' && toggleTheme()}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                theme === 'dark'
                  ? 'border-2 border-forest bg-forest/15 text-forest'
                  : 'border border-border text-muted bg-cream'
              }`}
            >
              <Moon size={16} /> Sombre
            </button>
          </div>

          {/* Bug Eugénie/Benoît 24/05/2026 : si les boutons restent trop gros
              malgré le clamp font-size (cf. index.css), basculer ici réduit la
              base de ~12% — propage à tout le chrome via les `rem` Tailwind. */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">
              Taille d'affichage
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => density !== 'normal' && setDensity('normal')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                  density === 'normal'
                    ? 'border-2 border-forest bg-forest/15 text-forest'
                    : 'border border-border text-muted bg-cream'
                }`}
              >
                <Maximize2 size={15} /> Normal
              </button>
              <button
                onClick={() => density !== 'compact' && setDensity('compact')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                  density === 'compact'
                    ? 'border-2 border-forest bg-forest/15 text-forest'
                    : 'border border-border text-muted bg-cream'
                }`}
              >
                <Minimize2 size={15} /> Compact
              </button>
            </div>
            <p className="text-[10px] text-muted mt-1.5 leading-tight">
              Si les boutons et le texte te paraissent trop grands (Android avec "Taille d'affichage" en grand), passe en compact. Réglage local à ce téléphone.
            </p>
          </div>
        </div>

        {/* Info ferme */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">La ferme</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Localisation</span>
              <span className="text-charcoal font-medium">Roquefixade, Ariège</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Coordonnées</span>
              <span className="text-charcoal font-medium font-mono text-xs">42.9375 / 1.7452</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Animaux</span>
              <span className="text-charcoal font-medium">24 ânes · 13 chevaux</span>
            </div>
          </div>
        </div>

        {/* Rapports de bugs */}
        <button
          onClick={() => navigate('/bugs')}
          className="flex items-center gap-3 w-full px-4 py-4 rounded-2xl bg-card shadow-sm active:bg-cream transition-colors"
        >
          <Bug size={20} className="text-danger" />
          <span className="flex-1 text-left text-charcoal font-semibold text-sm">Rapports de bugs</span>
          <ChevronRight size={18} className="text-muted" />
        </button>

        {/* Administration */}
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-3 w-full px-4 py-4 rounded-2xl bg-card shadow-sm active:bg-cream transition-colors"
        >
          <Shield size={20} className="text-forest" />
          <span className="flex-1 text-left text-charcoal font-semibold text-sm">Administration</span>
          <ChevronRight size={18} className="text-muted" />
        </button>

        {/* Déconnexion */}
        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-3 w-full px-4 py-4 rounded-2xl
                     bg-danger/10 text-danger font-semibold active:bg-danger/20 transition-colors"
        >
          <LogOut size={20} />
          Se déconnecter
        </button>

        <p className="text-center text-xs text-muted/50 pt-2">
          Ferme Stinglhamber · v0.1
        </p>
      </div>

      {/* Modale de guidance — navigateur a refusé à vie (Nils V4 #1) */}
      {showDeniedHelp && (
        <DeniedNotificationsHelp
          browser={detectBrowser()}
          onClose={() => setShowDeniedHelp(false)}
          onRetryAfterFix={() => {
            setShowDeniedHelp(false)
            setNotifState(detectNotifState())
          }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Composants internes — refonte notifications Nils V4 #1
   ────────────────────────────────────────────────────────────────────────── */

type NotifState = 'granted-token' | 'granted-no-token' | 'default' | 'denied' | 'unsupported'

function NotificationsToggle(props: {
  state:       NotifState
  busy:        boolean
  onToggle:    () => void
  onOpenHelp:  () => void
}) {
  const { state, busy, onToggle, onOpenHelp } = props

  // Style + libellé selon l'état détecté.
  const cfg = (() => {
    switch (state) {
      case 'granted-token':
        return {
          icon: <Bell size={16} className="text-meadow" />,
          chip: 'bg-meadow/15 text-meadow border-meadow/30',
          title: '🔔 Notifications activées',
          subtitle: 'Tu reçois bien les push de tâches et urgences.',
          cta: 'Désactiver les notifications',
          ctaClass: 'bg-cream text-muted border-border',
        }
      case 'granted-no-token':
        return {
          icon: <AlertCircle size={16} className="text-sun" />,
          chip: 'bg-sun/15 text-earth border-sun/30',
          title: '⚠ Souscription incomplète',
          subtitle: 'Permission OK mais le navigateur n\'a pas pu se connecter au service push (cas Chrome/Edge Windows). Réessaye.',
          cta: '🔔 Réessayer l\'abonnement',
          ctaClass: 'bg-forest text-white',
        }
      case 'default':
        return {
          icon: <BellOff size={16} className="text-muted" />,
          chip: 'bg-cream text-muted border-border',
          title: 'Notifications désactivées',
          subtitle: 'Active pour recevoir les push de tâches et les urgences.',
          cta: '🔔 Activer les notifications',
          ctaClass: 'bg-forest text-white',
        }
      case 'denied':
        return {
          icon: <BellOff size={16} className="text-danger" />,
          chip: 'bg-danger/10 text-danger border-danger/30',
          title: '🚫 Bloquées par le navigateur',
          subtitle: 'Tu as refusé les notifications (volontairement ou par erreur). Pour les ré-autoriser, il faut passer par les réglages du navigateur.',
          cta: 'Voir comment ré-autoriser',
          ctaClass: 'bg-danger text-white',
        }
      case 'unsupported':
      default:
        return {
          icon: <AlertCircle size={16} className="text-muted" />,
          chip: 'bg-cream text-muted border-border',
          title: 'Notifications non supportées',
          subtitle: 'Ton navigateur ne gère pas les notifications push. Utilise Chrome ou Edge récents.',
          cta: '',
          ctaClass: 'bg-cream text-muted border-border',
        }
    }
  })()

  return (
    <div>
      <div className={`flex items-start gap-2.5 p-3 rounded-xl border ${cfg.chip}`}>
        <div className="mt-0.5 flex-shrink-0">{cfg.icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold leading-tight">{cfg.title}</p>
          <p className="text-[11px] mt-0.5 leading-tight opacity-90">{cfg.subtitle}</p>
        </div>
      </div>

      {cfg.cta && (
        <button
          onClick={state === 'denied' ? onOpenHelp : onToggle}
          disabled={busy}
          className={`w-full mt-2 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 border disabled:opacity-50 ${cfg.ctaClass}`}
        >
          {busy ? '…' : cfg.cta}
        </button>
      )}
    </div>
  )
}

/**
 * Guidance navigateur-spécifique pour ré-autoriser les notifications quand
 * elles ont été refusées à vie. Chrome/Edge/Firefox/Safari ne se gèrent pas
 * pareil — on affiche la route adaptée.
 */
function DeniedNotificationsHelp(props: {
  browser:         'chrome-android' | 'chrome-desktop' | 'firefox' | 'safari' | 'edge' | 'other'
  onClose:         () => void
  onRetryAfterFix: () => void
}) {
  const { browser, onClose, onRetryAfterFix } = props

  const steps = (() => {
    switch (browser) {
      case 'chrome-android':
        return [
          'Touche le cadenas 🔒 à gauche de l\'URL en haut de Chrome',
          'Touche "Autorisations" → "Notifications"',
          'Choisis "Autoriser"',
          'Reviens sur l\'appli et touche "Réessayer"',
        ]
      case 'chrome-desktop':
        return [
          'Clique sur le cadenas 🔒 à gauche de l\'URL',
          'Trouve "Notifications" dans la liste',
          'Choisis "Autoriser" dans le menu déroulant',
          'Recharge la page (F5) puis touche "Réessayer"',
        ]
      case 'edge':
        return [
          'Clique sur le cadenas 🔒 à gauche de l\'URL',
          'Section "Autorisations pour ce site"',
          'Notifications → "Autoriser"',
          'Recharge la page puis touche "Réessayer"',
        ]
      case 'firefox':
        return [
          'Clique sur le cadenas 🔒 à gauche de l\'URL',
          'Touche "Effacer la permission" à côté de Notifications',
          'Recharge la page',
          'Active les notifications dans les réglages de l\'app',
        ]
      case 'safari':
        return [
          'Ouvre Réglages Safari → Sites web → Notifications',
          'Trouve "le-cazal.web.app"',
          'Choisis "Autoriser"',
          'Reviens sur l\'appli et touche "Réessayer"',
        ]
      default:
        return [
          'Ouvre les réglages de ton navigateur',
          'Cherche les autorisations du site le-cazal.web.app',
          'Active les notifications',
          'Recharge la page puis touche "Réessayer"',
        ]
    }
  })()

  return (
    <div className="fixed inset-0 z-[9600] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="p-5 border-b border-border/40 flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-danger/10 flex items-center justify-center flex-shrink-0">
            <BellOff size={20} className="text-danger" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-charcoal text-lg font-bold m-0">Ré-autoriser les notifications</h2>
            <p className="text-xs text-muted mt-0.5">
              Ton navigateur les a bloquées. Suis ces étapes pour les remettre :
            </p>
          </div>
        </div>

        <div className="p-5">
          <ol className="space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-forest text-white text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <p className="text-sm text-charcoal pt-0.5 leading-snug">{step}</p>
              </li>
            ))}
          </ol>

          {(browser === 'chrome-desktop' || browser === 'edge') && (
            <a
              href="https://support.google.com/chrome/answer/3220216"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 mt-4 text-sky text-xs font-semibold"
            >
              <ExternalLink size={12} /> Aide Chrome sur les notifications
            </a>
          )}
        </div>

        <div className="p-5 border-t border-border/40 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-border text-muted text-sm font-semibold active:bg-cream"
          >
            Plus tard
          </button>
          <button
            onClick={onRetryAfterFix}
            className="flex-1 py-3 rounded-xl bg-forest text-white text-sm font-bold active:scale-95"
          >
            J'ai fait, réessayer
          </button>
        </div>
      </div>
    </div>
  )
}
