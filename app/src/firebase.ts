import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore'
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

/**
 * Cache persistant Firestore (IndexedDB) — REQUIS pour le mode hors-ligne :
 * - les données restent accessibles en avion / sans réseau
 * - les écritures faites hors ligne sont mises en file et synchronisées au retour réseau
 * - survit aux rechargements de page
 *
 * Le tabManager `persistentMultipleTabManager` gère proprement les onglets multiples
 * (élection d'un leader, partage de la cache).
 *
 * Fallback gracieux : si l'init persistant échoue (navigateur privé, IndexedDB
 * inaccessible, quota saturé), on retombe sur la cache mémoire pour ne pas
 * casser l'application.
 */
function initDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  } catch (e) {
    console.warn('[firebase] Cache persistant indisponible, fallback mémoire :', e)
    return initializeFirestore(app, { localCache: memoryLocalCache() })
  }
}

export const db = initDb()

// Nettoyage best-effort des résidus de l'ancienne cache localStorage des
// versions Firebase précédentes (avant migration vers IndexedDB).
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
