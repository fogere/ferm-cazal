import { useEffect, useRef, useState } from 'react'
import { getToken, onMessage } from 'firebase/messaging'
import { doc, updateDoc } from 'firebase/firestore'
import { db, getMessagingIfSupported } from '../firebase'
import { useAuth } from './useAuth'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

export interface ToastMsg {
  id: number
  title: string
  body: string
  severity?: string
}

let _nextId = 0

/**
 * Erreur "FCM indisponible sur ce navigateur" attendue (Chrome/Edge Windows
 * sans connexion au push service de Google) — on la silence pour ne pas
 * polluer les bug reports avec un signal connu (cf. announcements.ts:255).
 *
 * Bug Nils 23/05/2026 : ce warning apparaissait dans 15 bug reports sur 18 et
 * masquait les vrais bugs en console. Désormais on log en `debug` (silencieux
 * par défaut, visible avec un filtre dev) au lieu de `warn`.
 */
function isExpectedFcmUnavailable(err: unknown): boolean {
  const name = (err as { name?: string })?.name
  const msg  = (err as { message?: string })?.message ?? ''
  return name === 'AbortError' || /push service error|Registration failed/i.test(msg)
}

/**
 * Tente d'obtenir un token FCM. Si `pushManager.subscribe()` plante avec
 * un `AbortError: Registration failed - push service error` (cas connu :
 * une vieille souscription incompatible traîne dans le SW), on nettoie la
 * souscription existante puis on retente une fois. La 2ᵉ tentative crée
 * une souscription fraîche, ce qui résout 99 % des cas.
 */
async function getFcmTokenResilient(
  messaging: import('firebase/messaging').Messaging,
  vapidKey: string,
  registration: ServiceWorkerRegistration,
): Promise<string | null> {
  try {
    return await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  } catch (err) {
    if (!isExpectedFcmUnavailable(err)) throw err

    // Nettoyage de la souscription incompatible puis retry — silencieux.
    // Le bug reporter capture aussi console.debug, donc on s'abstient.
    try {
      const old = await registration.pushManager.getSubscription()
      if (old) await old.unsubscribe()
    } catch { /* silent : navigateur sans push, cas attendu */ }

    // Petite pause pour laisser le push service se stabiliser
    await new Promise(r => setTimeout(r, 800))
    return await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  }
}

export function useMessaging() {
  const { user } = useAuth()
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  // Pour ne pas re-tenter en boucle si une erreur persistante survient
  const tokenAttempted = useRef(false)

  useEffect(() => {
    if (!user || !VAPID || user.isAnonymous) return
    let cleanup: (() => void) | null = null
    let cancelled = false

    async function init() {
      const messaging = await getMessagingIfSupported()
      if (!messaging || cancelled) return

      // Important : on NE demande PAS la permission ici — la demande doit
      // être déclenchée par un geste utilisateur (OnboardingModal, Settings).
      // Sinon Chrome rejette silencieusement.
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return
      }

      if (tokenAttempted.current) return
      tokenAttempted.current = true

      try {
        const registration = await navigator.serviceWorker.ready
        const token = await getFcmTokenResilient(messaging, VAPID!, registration)
        if (token && user && !cancelled) {
          await updateDoc(doc(db, 'users', user.uid), { fcmToken: token })
        }
        // Token vide / impossible = cas attendu sur Chrome Windows sans push.
        // On ne logge rien pour ne pas polluer les bug reports.
      } catch (err) {
        // Bug Nils 23/05/2026 : silencieux sur les AbortError "FCM indispo"
        // (15 bug reports sur 18 polluaient avant). On garde un warn pour les
        // erreurs RÉELLES inattendues.
        if (!isExpectedFcmUnavailable(err)) {
          const name = (err as { name?: string })?.name
          const code = (err as { code?: string })?.code
          console.warn(`[FCM] getToken a échoué (name=${name} code=${code}) :`, err)
        }
        // On laisse tokenAttempted=true : un bouton manuel dans Settings
        // permettra de retry quand l'utilisateur le décide.
      }

      cleanup = onMessage(messaging, (payload) => {
        const id       = ++_nextId
        const title    = payload.notification?.title ?? 'Ferme Stinglhamber'
        const body     = payload.notification?.body  ?? ''
        const severity = (payload.data?.severity as string) ?? 'info'
        addToast({ id, title, body, severity })
      })
    }

    init()
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [user])

  function addToast(toast: ToastMsg) {
    setToasts(t => [...t, toast])
    setTimeout(() => dismiss(toast.id), 6000)
  }

  function dismiss(id: number) {
    setToasts(t => t.filter(x => x.id !== id))
  }

  return { toasts, dismiss }
}

/**
 * Tente d'enregistrer le token FCM côté utilisateur, sur déclenchement
 * explicite (bouton dans Settings, fin d'onboarding…). Retourne true si
 * un token a bien été obtenu et écrit dans Firestore.
 *
 * Cette fonction est indépendante de useMessaging pour pouvoir être
 * appelée depuis un onClick sans monter un nouveau hook.
 */
export async function registerFcmTokenManually(uid: string): Promise<boolean> {
  if (!VAPID) {
    console.warn('[FCM] VITE_FIREBASE_VAPID_KEY absente — notifications désactivées')
    return false
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission !== 'granted') return false
  const messaging = await getMessagingIfSupported()
  if (!messaging) return false
  try {
    const registration = await navigator.serviceWorker.ready
    const token = await getFcmTokenResilient(messaging, VAPID, registration)
    if (!token) return false
    await updateDoc(doc(db, 'users', uid), { fcmToken: token })
    return true
  } catch (err) {
    // Idem hook auto : silent sur les cas attendus, warn sur les vrais bugs.
    if (!isExpectedFcmUnavailable(err)) {
      console.warn('[FCM] enregistrement manuel échoué :', err)
    }
    return false
  }
}
