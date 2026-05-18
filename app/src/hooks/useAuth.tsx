import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import type { UserProfile, Availability } from '../types'

const USER_COLORS = ['#1A4731', '#0EA5E9', '#EA580C']

/* ─── Rate limiting pour les codes temporaires ─── */

const RL_KEY = 'fm_temp_rl'

interface RLData { attempts: number; lockUntil: number }

function getRateLimit(): RLData {
  try { return JSON.parse(localStorage.getItem(RL_KEY) ?? '{}') }
  catch { return { attempts: 0, lockUntil: 0 } }
}

function recordFailedAttempt() {
  const rl = getRateLimit()
  const attempts = (rl.attempts ?? 0) + 1
  const lock = attempts >= 7 ? 3_600_000
             : attempts >= 5 ? 300_000
             : attempts >= 3 ? 60_000 : 0
  localStorage.setItem(RL_KEY, JSON.stringify({ attempts, lockUntil: lock ? Date.now() + lock : 0 }))
}

function checkRateLimit(): number { // retourne ms restantes, 0 si ok
  const rl = getRateLimit()
  return rl.lockUntil && rl.lockUntil > Date.now() ? rl.lockUntil - Date.now() : 0
}

function clearRateLimit() { localStorage.removeItem(RL_KEY) }

function generateTempCode(): string {
  // Alphabet sans caractères ambigus (0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const arr = new Uint8Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => chars[b % chars.length]).join('')
}

export function formatCode(raw: string): string {
  const r = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (r.length <= 4) return r
  if (r.length <= 8) return `${r.slice(0, 4)}-${r.slice(4)}`
  return `${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8, 12)}`
}

export function normalizeCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase()
}

/* ─── Flag module-level pour éviter la race condition avec signInAnonymously ─── */
let _codeValidationInProgress = false

/* ─── Context ─── */

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  isTemp: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithCode: (code: string) => Promise<void>
  logout: () => Promise<void>
  generateTempCode: () => string
  formatCode: (raw: string) => string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isTemp,  setIsTemp]  = useState(false)

  useEffect(() => {
    let profileUnsub: (() => void) | null = null

    const authUnsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (profileUnsub) { profileUnsub(); profileUnsub = null }

      setUser(firebaseUser)

      if (!firebaseUser) {
        setProfile(null)
        setIsTemp(false)
        setLoading(false)
        return
      }

      /* ── Utilisateur anonyme (aide temporaire) ── */
      if (firebaseUser.isAnonymous) {
        if (_codeValidationInProgress) {
          // loginWithCode gère tout — ne pas interférer
          return
        }
        try {
          const sessionSnap = await getDoc(doc(db, 'tempSessions', firebaseUser.uid))
          if (!sessionSnap.exists() || sessionSnap.data().expiresAt < Date.now()) {
            await signOut(auth)
            return
          }
          setIsTemp(true)
          // Abonnement temps réel au profil temp aussi (pour shareLocation, livePointer, etc.)
          const ref = doc(db, 'users', firebaseUser.uid)
          profileUnsub = onSnapshot(
            ref,
            snap => {
              if (snap.exists()) {
                setProfile(snap.data() as UserProfile)
              } else {
                // Fallback : profil minimal depuis la session si le doc n'existe pas
                setProfile({
                  uid:              firebaseUser.uid,
                  displayName:      sessionSnap.data().displayName,
                  color:            '#D97706',
                  silentStart:      '22:00',
                  silentEnd:        '07:00',
                  availability:     'available' as Availability,
                  availabilityDate: new Date().toISOString().split('T')[0],
                })
              }
              setLoading(false)
            },
            err => {
              console.warn('[Auth temp] Profil snapshot erreur:', err)
              setLoading(false)
            }
          )
        } catch {
          await signOut(auth)
          setLoading(false)
        }
        return
      }

      /* ── Utilisateur régulier (email/password) ── */
      setIsTemp(false)

      try {
        const ref = doc(db, 'users', firebaseUser.uid)
        const snap = await getDoc(ref)
        if (!snap.exists()) {
          const namePart    = firebaseUser.email?.split('@')[0] ?? 'utilisateur'
          const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1)
          const colorIndex  = Math.floor(Math.random() * USER_COLORS.length)
          await setDoc(ref, {
            uid:              firebaseUser.uid,
            displayName,
            color:            USER_COLORS[colorIndex],
            silentStart:      '22:00',
            silentEnd:        '07:00',
            availability:     'available' as Availability,
            availabilityDate: new Date().toISOString().split('T')[0],
            createdAt:        serverTimestamp(),
          })
        }

        profileUnsub = onSnapshot(
          ref,
          (snap) => {
            if (snap.exists()) setProfile(snap.data() as UserProfile)
            setLoading(false)
          },
          (err) => {
            console.warn('[Auth] Profil snapshot erreur:', err)
            setLoading(false)
          }
        )
      } catch (err) {
        console.warn('[Auth] Firestore inaccessible, profil par défaut utilisé.', err)
        const namePart    = firebaseUser.email?.split('@')[0] ?? 'utilisateur'
        const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1)
        setProfile({
          uid:              firebaseUser.uid,
          displayName,
          color:            USER_COLORS[0],
          silentStart:      '22:00',
          silentEnd:        '07:00',
          availability:     'available',
          availabilityDate: new Date().toISOString().split('T')[0],
        })
        setLoading(false)
      }
    })

    return () => {
      authUnsub()
      if (profileUnsub) profileUnsub()
    }
  }, [])

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
  }

  async function loginWithCode(code: string): Promise<void> {
    const remaining = checkRateLimit()
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60_000)
      throw new Error(`Trop de tentatives. Réessayez dans ${mins} min.`)
    }

    _codeValidationInProgress = true
    let anonUser: User | null = null

    try {
      const result = await signInAnonymously(auth)
      anonUser = result.user

      const normalized = normalizeCode(code)
      if (normalized.length !== 12) throw new Error('Code invalide (12 caractères attendus)')

      const codeSnap = await getDoc(doc(db, 'tempCodes', normalized))
      if (!codeSnap.exists()) {
        recordFailedAttempt()
        throw new Error('Code invalide ou inconnu')
      }

      const codeData = codeSnap.data()
      if (codeData.expiresAt < Date.now()) {
        recordFailedAttempt()
        throw new Error('Ce code a expiré')
      }

      // Crée la session et le profil utilisateur
      await setDoc(doc(db, 'tempSessions', anonUser.uid), {
        displayName: codeData.displayName,
        expiresAt:   codeData.expiresAt,
        codeId:      normalized,
      })

      await setDoc(doc(db, 'users', anonUser.uid), {
        uid:              anonUser.uid,
        displayName:      codeData.displayName,
        color:            '#D97706',
        silentStart:      '22:00',
        silentEnd:        '07:00',
        availability:     'available' as Availability,
        availabilityDate: new Date().toISOString().split('T')[0],
      })

      clearRateLimit()
      setProfile({
        uid:              anonUser.uid,
        displayName:      codeData.displayName,
        color:            '#D97706',
        silentStart:      '22:00',
        silentEnd:        '07:00',
        availability:     'available',
        availabilityDate: new Date().toISOString().split('T')[0],
      })
      setIsTemp(true)
      setLoading(false)

    } catch (e) {
      try { if (anonUser) await signOut(auth) } catch {}
      setProfile(null)
      setIsTemp(false)
      throw e
    } finally {
      _codeValidationInProgress = false
    }
  }

  async function logout() {
    await signOut(auth)
    setProfile(null)
    setIsTemp(false)
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isTemp,
      login, loginWithCode, logout, generateTempCode, formatCode,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
