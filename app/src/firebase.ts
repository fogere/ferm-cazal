import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Cache mémoire : pas de localStorage / IndexedDB → plus de QuotaExceededError.
// Trade-off : la cache est perdue entre rechargements (les données sont refetched depuis le serveur),
// mais ça évite la corruption quand le quota navigateur sature (photos base64, multi-tab coordination).
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
})

// Nettoyage best-effort des résidus de l'ancienne cache persistante qui ont déclenché QuotaExceededError.
// Sans cela, le localStorage reste plein et peut affecter d'autres écritures futures.
if (typeof window !== 'undefined') {
  try {
    const keys = Object.keys(window.localStorage)
    for (const k of keys) {
      if (k.startsWith('firestore_') || k.includes('firestore/')) {
        try { window.localStorage.removeItem(k) } catch { /* ignoré */ }
      }
    }
  } catch { /* localStorage indisponible — ignoré */ }
}

export const getMessagingIfSupported = async () => {
  const supported = await isSupported()
  return supported ? getMessaging(app) : null
}

// Convertit un prénom en email Firebase
// "Eugénie" → "eugenie@ferme-nilslamber.fr"
// "mathieu"  → "mathieu@ferme-nilslamber.fr"
export function nameToEmail(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // supprime les accents Unicode
    .replace(/\s+/g, '')
  return `${normalized}@ferme-nilslamber.fr`
}
