import { useEffect, useState } from 'react'
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

export function useMessaging() {
  const { user } = useAuth()
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  useEffect(() => {
    if (!user || !VAPID || user.isAnonymous) return
    let cleanup: (() => void) | null = null

    async function init() {
      const messaging = await getMessagingIfSupported()
      if (!messaging) return

      // Demande permission (silencieuse si déjà accordée)
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return

      try {
        // On passe le SW unifié (sw.js) à FCM pour éviter que Firebase
        // enregistre un second SW (firebase-messaging-sw.js) qui entrerait
        // en conflit avec le SW Workbox qui gère le cache hors ligne.
        const registration = await navigator.serviceWorker.ready
        const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: registration })
        if (token && user) {
          await updateDoc(doc(db, 'users', user.uid), { fcmToken: token })
        }
      } catch (err) {
        console.warn('[FCM] Impossible d\'obtenir le token:', err)
      }

      // Notifications reçues quand l'app est en avant-plan
      cleanup = onMessage(messaging, (payload) => {
        const id       = ++_nextId
        const title    = payload.notification?.title ?? 'Ferme Nilslamber'
        const body     = payload.notification?.body  ?? ''
        const severity = (payload.data?.severity as string) ?? 'info'
        addToast({ id, title, body, severity })
      })
    }

    init()
    return () => { if (cleanup) cleanup() }
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
