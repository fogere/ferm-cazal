import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Check, User, Bell, Shield, ChevronRight, MapPin, Moon, Sun, Bug } from 'lucide-react'
import { doc, deleteField } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { updateDocBounded, FirestoreWriteTimeoutError } from '../services/firestoreWrite'

export default function Settings() {
  const { user, profile, logout, isTemp } = useAuth()
  const navigate = useNavigate()

  const [editName,    setEditName]    = useState(false)
  const [nameVal,     setNameVal]     = useState(profile?.displayName ?? '')
  const [savingName,  setSavingName]  = useState(false)

  const [silentStart, setSilentStart] = useState(profile?.silentStart ?? '22:00')
  const [silentEnd,   setSilentEnd]   = useState(profile?.silentEnd   ?? '07:00')
  const [savingHours, setSavingHours] = useState(false)
  const [hoursSaved,  setHoursSaved]  = useState(false)
  const [savingShare, setSavingShare] = useState(false)
  const [writeError,  setWriteError]  = useState<string | null>(null)
  const { theme, toggleTheme } = useTheme()

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

          <button
            onClick={saveHours}
            disabled={savingHours}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95
              ${hoursSaved
                ? 'bg-meadow/15 text-meadow'
                : 'bg-forest/10 text-forest border border-forest/20'
              } disabled:opacity-40`}
          >
            {hoursSaved ? '✓ Enregistré' : savingHours ? 'Enregistrement…' : 'Enregistrer les heures'}
          </button>
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
        </div>

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
    </div>
  )
}
