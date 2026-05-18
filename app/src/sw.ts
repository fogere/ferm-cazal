/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ── Mise à jour automatique ──
// skipWaiting au install pour éviter de garder une vieille version active qui
// pourrait bloquer le routage des tuiles si la config a changé.
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()))

// ── Firebase Messaging (notifications en arrière-plan) ──
const _app = initializeApp({
  apiKey:            'AIzaSyC7yHZsfWrmxl620l3YEjMzhZds-HcY-tw',
  authDomain:        'farm-ed787.firebaseapp.com',
  projectId:         'farm-ed787',
  storageBucket:     'farm-ed787.firebasestorage.app',
  messagingSenderId: '313036475766',
  appId:             '1:313036475766:web:6023e1c5a82356b0e13e57',
})
const messaging = getMessaging(_app)

onBackgroundMessage(messaging, (payload) => {
  const { title, body, icon } = payload.notification ?? {}
  self.registration.showNotification(title ?? 'Ferme Nilslamber', {
    body:  body ?? '',
    icon:  icon ?? '/icons/farm-icon.svg',
    badge: '/icons/farm-icon.svg',
    vibrate: [200, 100, 200],
    requireInteraction: payload.data?.['severity'] === 'urgent',
  } as NotificationOptions)
})

// ── Précache du shell applicatif (JS, CSS, HTML, assets) ──
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── Plugin quota 5 Go : priorité à l'app et aux données Firestore ──
// Les tuiles IGN ne sont mises en cache que s'il reste de la place
const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024 // 5 Go

const tileQuotaPlugin = {
  cacheWillUpdate: async ({ response }: { response: Response }) => {
    try {
      const { usage = 0 } = await navigator.storage.estimate()
      if (usage >= MAX_STORAGE_BYTES) return null // Quota atteint
    } catch {
      // navigator.storage non disponible : on laisse passer
    }
    return response
  },
}

// ── Tuiles IGN (CacheFirst — carte dispo hors ligne, cap 5 Go, 90 jours) ──
registerRoute(
  ({ url }) => url.hostname === 'data.geopf.fr',
  new CacheFirst({
    cacheName: 'ign-tiles-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      tileQuotaPlugin,
      new ExpirationPlugin({
        maxEntries: 200_000,
        maxAgeSeconds: 60 * 60 * 24 * 90, // 90 jours
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// ── Météo Open-Meteo (NetworkFirst — fraîche si réseau, cache si hors ligne) ──
registerRoute(
  ({ url }) => url.hostname === 'api.open-meteo.com',
  new NetworkFirst({
    cacheName: 'weather-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 3_600 }),
    ],
  })
)
