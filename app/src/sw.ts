/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
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
// Au passage v1→v2 des caches de tuiles (Nils 11/06/2026) : on supprime les
// anciens caches qui contenaient des tuiles CASSÉES. Cause : le pré-téléchargement
// hors-ligne fetchait en `no-cors` → réponses OPAQUES (status 0) ; quand IGN renvoyait
// une erreur (rate-limit du téléchargement massif), cette erreur était mise en cache
// comme une tuile valide (CacheableResponsePlugin acceptait le status 0), puis servie
// indéfiniment en CacheFirst → couture / bouts corrompus sur la carte. Désormais les
// tuiles passent en CORS et on ne cache QUE les 200. On purge les vieux caches v1 ici.
const STALE_TILE_CACHES = ['ign-tiles-v1', 'osm-tiles-v1', 'ign-parcels-v1']
self.addEventListener('activate', (ev) => ev.waitUntil((async () => {
  await self.clients.claim()
  const names = await caches.keys()
  await Promise.all(names.filter(n => STALE_TILE_CACHES.includes(n)).map(n => caches.delete(n)))

  // ── Mise à jour FORCÉE (Nils 02/07/2026) ──
  // Bug : une nouvelle version s'installait (skipWaiting) mais la page ne se
  // rechargeait JAMAIS toute seule → tout le monde restait bloqué sur l'ancienne
  // build (dont l'ancien CSP qui bloquait le proxy de tuiles → carrés noirs). Un
  // simple Ctrl+R ne suffisait pas. Ici, dès que ce SW prend la main, on recharge
  // chaque fenêtre contrôlée → la maj s'applique automatiquement, sans action de
  // l'utilisatrice. Une seule navigation par activation → pas de boucle. Les clients
  // encore sur l'ancienne version basculeront à leur prochain check (30 min / retour
  // au premier plan, cf. UpdatePrompt) ou au prochain lancement de l'app.
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) {
    try { await (client as WindowClient).navigate(client.url) } catch { /* client parti */ }
  }
})()))

// ── Firebase Messaging (notifications en arrière-plan) ──
// Config alignée sur projet le-cazal. Si tu changes de projet Firebase,
// pense à mettre à jour ces valeurs (le SW ne lit pas .env via Vite).
const _app = initializeApp({
  apiKey:            'AIzaSyBCVfDmyh_KaZjw2r3sdHKHgbIj0WSgkcg',
  authDomain:        'le-cazal.firebaseapp.com',
  projectId:         'le-cazal',
  storageBucket:     'le-cazal.firebasestorage.app',
  messagingSenderId: '1050666737967',
  appId:             '1:1050666737967:web:7e3e5fb99544e11c5a81da',
})
const messaging = getMessaging(_app)

onBackgroundMessage(messaging, (payload) => {
  const { title, body, icon } = payload.notification ?? {}
  self.registration.showNotification(title ?? 'Ferme Stinglhamber', {
    body:  body ?? '',
    icon:  icon ?? '/icons/farm-icon-192.png',
    badge: '/icons/farm-icon-192.png',
    vibrate: [200, 100, 200],
    requireInteraction: payload.data?.['severity'] === 'urgent',
    data: payload.data ?? {},
  } as NotificationOptions)
})

// Click sur une notification (FCM background OU notif locale du geofence) :
// route vers l'URL fournie dans `data.url`, en focalisant un onglet existant
// si possible plutôt qu'en en ouvrant un nouveau.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/dashboard'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      // L'origine est forcément le même domaine (Web Push limité same-origin)
      if ('focus' in client) {
        await (client as WindowClient).focus()
        ;(client as WindowClient).navigate(target).catch(() => {})
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target)
  })())
})

// ── Précache du shell applicatif (JS, CSS, HTML, assets) ──
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── SPA fallback : toute navigation (ex: /tasks, /map, refresh, lien partagé) ──
// Sans ça, ouvrir directement /tasks hors ligne → page "dinosaure" Chrome.
// Avec ça, toute requête de navigation est servie par le /index.html précaché,
// qui bootstrappe ensuite React Router côté client depuis le cache.
// Exclusions : on laisse passer les requêtes vers Firestore/Auth/Storage qui ne
// sont pas des navigations HTML mais des XHR/fetch d'API.
const navigationHandler = createHandlerBoundToURL('/index.html')
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [
    /^\/__\//,         // Firebase Auth iframe (/__/auth/...)
    /^\/api\//,        // toute API à venir
  ],
})
registerRoute(navigationRoute)

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

// ── Parcelles cadastrales IGN (NetworkFirst — cache séparé) ──
// Bug Nils 03→11/06/2026 : l'overlay parcelles apparaissait "corrompu" / partiel.
// Cause double : (1) maxNativeZoom=20 réclamait des tuiles z20 inexistantes (corrigé
// côté Map.tsx → 19), (2) ces tuiles en erreur restaient ensuite SERVIES depuis le
// cache partagé `ign-tiles-v1` en CacheFirst, jamais rafraîchies. On isole donc les
// parcelles dans leur propre cache en NetworkFirst : toujours fraîches quand il y a du
// réseau, le cache ne sert qu'en secours hors-ligne. Le cache aérien hors-ligne
// (ign-tiles-v1) n'est pas touché — pas de re-téléchargement de la carte de la ferme.
// IMPORTANT : cette route doit précéder la route geopf générale (Workbox = 1er match).
registerRoute(
  ({ url }) => url.hostname === 'ferme-tiles.ferme-nilslamber.workers.dev' && url.search.includes('CADASTRALPARCELS'),
  new NetworkFirst({
    cacheName: 'ign-parcels-v2',
    networkTimeoutSeconds: 5,
    plugins: [
      // statuses [200] uniquement (plus de status 0) : les tuiles passent en CORS
      // (crossOrigin côté Leaflet + fetch CORS au pré-cache), donc une erreur IGN
      // n'est plus une réponse opaque cachable — elle est tout simplement ignorée.
      new CacheableResponsePlugin({ statuses: [200] }),
      tileQuotaPlugin,
      new ExpirationPlugin({
        maxEntries: 40_000,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 jours
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// ── Tuiles IGN (CacheFirst — carte dispo hors ligne, cap 5 Go, 90 jours) ──
registerRoute(
  ({ url }) => url.hostname === 'ferme-tiles.ferme-nilslamber.workers.dev',
  new CacheFirst({
    cacheName: 'ign-tiles-v2',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      tileQuotaPlugin,
      new ExpirationPlugin({
        maxEntries: 200_000,
        maxAgeSeconds: 60 * 60 * 24 * 90, // 90 jours
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// ── Tuiles OSM fallback (CacheFirst — utilisées si IGN tombe en panne) ──
// On les met en cache aussi pour rester opérationnel en mode avion.
registerRoute(
  ({ url }) => url.hostname.endsWith('.tile.openstreetmap.org'),
  new CacheFirst({
    cacheName: 'osm-tiles-v2',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      tileQuotaPlugin,
      new ExpirationPlugin({
        maxEntries: 50_000,
        maxAgeSeconds: 60 * 60 * 24 * 90,
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
