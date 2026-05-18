import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, KeyRound, ChevronDown } from 'lucide-react'
import { useAuth, normalizeCode, formatCode } from '../hooks/useAuth'

const ERRORS: Record<string, string> = {
  'auth/invalid-credential':     'Identifiant ou mot de passe incorrect.',
  'auth/user-not-found':         'Identifiant ou mot de passe incorrect.',
  'auth/wrong-password':         'Identifiant ou mot de passe incorrect.',
  'auth/invalid-email':          'Identifiant ou mot de passe incorrect.',
  'auth/too-many-requests':      'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion réseau. Vérifiez votre 5G.',
  'auth/operation-not-allowed':  'Connexion par email non activée — Firebase Console.',
}

export default function Login() {
  const { login, loginWithCode } = useAuth()
  const navigate = useNavigate()

  /* ─── Login email ─── */
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [shake, setShake]               = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  /* ─── Accès temporaire ─── */
  const [tempOpen, setTempOpen]   = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [lockRemaining, setLockRemaining] = useState(0) // ms

  useEffect(() => {
    if (lockRemaining <= 0) return
    const t = setInterval(() => {
      setLockRemaining(r => Math.max(0, r - 1000))
    }, 1000)
    return () => clearInterval(t)
  }, [lockRemaining])

  function handleCodeInput(raw: string) {
    const normalized = normalizeCode(raw)
    const capped = normalized.slice(0, 12)
    setCodeInput(formatCode(capped))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return

    setLoading(true)
    setError('')

    try {
      await login(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      const msg = ERRORS[code] ?? 'Identifiant ou mot de passe incorrect.'
      setError(msg)
      setShake(true)
      setTimeout(() => setShake(false), 400)
    } finally {
      setLoading(false)
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (lockRemaining > 0) return

    setCodeLoading(true)
    setCodeError('')

    try {
      await loginWithCode(codeInput)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Code invalide.'
      setCodeError(msg)
      // Si le message contient "Réessayez dans", extraire la durée
      if (msg.includes('Réessayez dans')) {
        const match = msg.match(/(\d+)\s*min/)
        if (match) setLockRemaining(parseInt(match[1]) * 60_000)
      }
    } finally {
      setCodeLoading(false)
    }
  }

  const lockSecs = Math.ceil(lockRemaining / 1000)
  const lockDisplay = lockSecs >= 60 ? `${Math.floor(lockSecs / 60)} min ${lockSecs % 60}s` : `${lockSecs}s`

  return (
    <div
      className="min-h-full flex flex-col items-center justify-center px-5 py-10"
      style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 50%, #1A4731 100%)' }}
    >
      {/* Logo + titre */}
      <div className="text-center mb-8 fade-in">
        <div className="text-7xl mb-4 select-none" role="img" aria-label="Ferme">🌿</div>
        <h1 className="text-3xl font-bold text-white tracking-tight m-0">
          Ferme Nilslamber
        </h1>
        <p className="text-white/60 text-sm mt-1">
          Gestion de la ferme
        </p>
      </div>

      {/* Carte de connexion principale */}
      <div
        ref={cardRef}
        className={`w-full max-w-sm bg-card rounded-3xl shadow-2xl p-7 fade-in ${shake ? 'shake' : ''}`}
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 className="text-charcoal text-xl font-semibold text-center mb-6 m-0">
            Connexion
          </h2>

          {/* Email */}
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-muted mb-1.5">
              Adresse email
            </label>
            <div className="relative">
              <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="votre@email.fr"
                className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-border bg-cream
                           text-charcoal text-base placeholder:text-muted/50
                           focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent
                           transition-all"
                disabled={loading}
                required
              />
            </div>
          </div>

          {/* Mot de passe */}
          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-muted mb-1.5">
              Mot de passe
            </label>
            <div className="relative">
              <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-12 py-3.5 rounded-xl border border-border bg-cream
                           text-charcoal text-base placeholder:text-muted/50
                           focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent
                           transition-all"
                disabled={loading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted p-1"
                aria-label={showPassword ? 'Masquer' : 'Afficher'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-danger-light border border-danger/20 text-danger text-sm font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full py-4 rounded-xl font-semibold text-white text-base
                       bg-forest active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
                       transition-all duration-150 shadow-lg"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Connexion…
              </span>
            ) : (
              'Entrer dans la ferme'
            )}
          </button>
        </form>
      </div>

      {/* ─── Accès temporaire ─── */}
      <div className="w-full max-w-sm mt-4 fade-in">
        <button
          onClick={() => setTempOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 rounded-2xl bg-white/10 text-white/70 text-sm font-medium active:bg-white/20 transition-colors"
        >
          <span className="flex items-center gap-2">
            <KeyRound size={16} />
            Accès temporaire (aide occasionnelle)
          </span>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${tempOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {tempOpen && (
          <div className="mt-2 bg-card rounded-2xl shadow-xl p-5">
            <p className="text-muted text-xs mb-4 leading-relaxed">
              Entrez le code fourni par un membre de la famille Nilslamber.
              Le code est au format <span className="font-mono font-semibold">XXXX-XXXX-XXXX</span>.
            </p>

            <form onSubmit={handleCodeSubmit} noValidate>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Code d'accès
                </label>
                <div className="relative">
                  <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={codeInput}
                    onChange={e => handleCodeInput(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-cream
                               text-charcoal text-base font-mono tracking-widest placeholder:text-muted/40
                               focus:outline-none focus:ring-2 focus:ring-forest focus:border-transparent
                               transition-all"
                    disabled={codeLoading || lockRemaining > 0}
                    maxLength={14}
                  />
                </div>
              </div>

              {codeError && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-danger-light border border-danger/20 text-danger text-sm font-medium">
                  {codeError}
                </div>
              )}

              {lockRemaining > 0 && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-sun/10 border border-sun/30 text-earth text-sm font-medium text-center">
                  Accès bloqué — réessayez dans {lockDisplay}
                </div>
              )}

              <button
                type="submit"
                disabled={codeLoading || lockRemaining > 0 || normalizeCode(codeInput).length !== 12}
                className="w-full py-3.5 rounded-xl font-semibold text-white text-sm
                           bg-earth active:scale-95
                           disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
                           transition-all shadow-md"
              >
                {codeLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Vérification…
                  </span>
                ) : (
                  'Accéder avec ce code'
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      <p className="text-white/30 text-xs mt-8 text-center">
        Accès réservé — Ferme Nilslamber
      </p>
    </div>
  )
}
