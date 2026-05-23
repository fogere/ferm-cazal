# Architecture — Projet Ferme Stinglhamber

Document de référence pour te retrouver dans le code en 5 minutes. À jour : 20/05/2026.

---

## Vue d'ensemble

```
Utilisateurs Android (3-5)
        │
        ▼
PWA React (Vite + TS)  ←─── service worker Workbox (offline-first)
        │
        ├──► Firestore  ←── rules dans app/firestore.rules
        │     ├── users
        │     ├── tasks
        │     ├── animals (+ sous-coll animal_care, animal_photos, animal_measurements)
        │     ├── map_pins (clôtures, points d'eau, batteries)
        │     ├── enclosure_movements (historique pâturage)
        │     ├── tempCodes / tempSessions / tempUsers (aides ponctuelles)
        │     ├── bugReports (reporter intégré)
        │     ├── reserves, alerts, config, opti
        │     └── pin_photos
        │
        ├──► Firebase Auth (Email/Password + Anonymous pour aides temp)
        │
        ├──► Firebase Cloud Messaging (FCM)
        │     └─ token stocké dans users/{uid}.fcmToken
        │
        ├──► Cloud Function : checkReminders (endpoint HTTP)
        │     └─ cron-job.org la tape toutes les 30 min
        │
        ├──► IGN tiles (data.geopf.fr) — carte aérienne / plan / parcelles
        │
        └──► Open-Meteo (api.open-meteo.com) — météo gratuite
```

**Projet Firebase :** `le-cazal` · **Domaine prod :** `le-cazal.web.app`

---

## Dossiers du repo

```
projet farm/
├── app/                    ← l'app React (build → app/dist déployé sur Firebase Hosting)
│   ├── src/
│   ├── public/             (favicon, icons PNG/SVG pour PWA)
│   ├── firestore.rules     ← règles Firestore (source de vérité)
│   ├── index.html, vite.config.ts, tsconfig*.json
│   └── .env                (clés Firebase + VAPID, ne PAS commit)
├── functions/              ← Cloud Functions (Node 20)
│   └── src/index.ts        (checkReminders + broadcast)
├── cron/                   ← script Node (notify.cjs) — ancien chemin, à confirmer si encore utilisé
├── worker/                 ← Cloudflare Worker (alternative au cron), pas actif en prod
├── scripts/                ← utilitaires one-shot (génération icônes, migration users)
├── firebase.json, .firebaserc
├── AVANCEMENT.md           ← journal chronologique des features
├── ARCHITECTURE.md         ← ce fichier
└── RUNBOOK.md              ← commandes deploy / debug / gotchas
```

---

## L'app React (`app/src/`)

### Pages (`app/src/pages/`)
| Fichier | Rôle | Taille |
|---|---|---|
| `Login.tsx` | Connexion email/mdp, accepte prénom seul | ~300 |
| `Dashboard.tsx` | Météo, tâches du jour, alertes, soins à faire | ~800 |
| `Tasks.tsx` | Pool commun + assignation + broadcast | ~880 |
| `Map.tsx` | **CARTE PRINCIPALE** — pins, clôtures, animaux, pointeurs… | **~4400** ⚠️ |
| `AnimalDetail.tsx` | Fiche complète d'un animal (`/animal/:id`) | ~900 |
| `Grazing.tsx` | Calendrier de pâturage (Gantt PAC) (`/grazing`) | ~720 |
| `Admin.tsx` | Gestion animaux + comptes temporaires + races | ~2100 |
| `Settings.tsx` | Profil, heures silencieuses, partage GPS, FCM, thème | ~570 |
| `Alerts.tsx` | Liste alertes actives (notifications urgentes) | ~250 |
| `Bugs.tsx` | Inspecteur des bug reports envoyés via le BugReportButton | ~480 |

⚠️ **Map.tsx fait 4400 lignes** — c'est le principal point de fragilité. Y vivent : pins de tous types, mode clôture manuelle, mode clôture auto (GPS), édition de poteaux, placement d'animaux, pointeur partagé temps réel, photos par pin, historique mouvements, parcelles cadastre, météo de fond. À découper en sous-composants quand on a le temps.

### Composants partagés (`app/src/components/`)
| Fichier | Rôle |
|---|---|
| `layout/Layout.tsx` | Coque + bottom nav |
| `Toaster.tsx` | Toasts FCM en avant-plan |
| `OfflineIndicator.tsx` | Bandeau "hors ligne" |
| `OnboardingModal.tsx` | 1er login → permissions notif + GPS |
| `InstallPWAPrompt.tsx` | Bannière "installer l'app" |
| `UpdatePrompt.tsx` | Bannière "mise à jour disponible" (nouveau déploiement) |
| `EveningRecapModal.tsx` | Bilan du soir auto > 18 h |
| `BugReportButton.tsx` | Bouton 🐞 flottant + form de signalement |
| `ErrorBoundary.tsx` | Catch React errors top-level |
| `animal/` | Composants utilisés par AnimalDetail (Header, Timeline, Growth, Photos, Lineage, Reproduction) |

### Hooks (`app/src/hooks/`)
| Fichier | Rôle | Monté où |
|---|---|---|
| `useAuth.tsx` | Auth Firebase + profil Firestore | App (Provider) |
| `useTheme.tsx` | Light/Dark | App (Provider) |
| `useMessaging.ts` | FCM token + toasts onMessage | App (global) |
| `useBugReporter.ts` | Capture nav + console + erreurs auto | App (global) |
| `useLiveLocation.ts` | watchPosition + write Firestore | `/map` uniquement |
| `useOnDemandLocationPublish.ts` | Publish 1×/min si quelqu'un d'autre regarde la map | App (global) |
| `useGeofenceAlert.ts` | Notif "tu es dans un enclos" | App (global) |
| `useCustomSpecies.ts` | Liste des races custom (chat, mouton…) | Où nécessaire |

✅ **Consolidation GPS terminée** (mai 2026). Les 3 hooks GPS (useLiveLocation, useOnDemandLocationPublish, useGeofenceAlert) consomment désormais `locationCore` (`services/location/locationCore.ts`) via le hook partagé `useLocationCore`. Un seul `navigator.geolocation.watchPosition()` actif à la fois, peu importe combien de hooks s'abonnent. **Pour tout nouveau besoin GPS, réutiliser `useLocationCore` — ne pas remonter un nouveau watchPosition.**

### Services (`app/src/services/`)
| Fichier | Rôle |
|---|---|
| `firebase.ts` (à la racine src/) | Init Firebase + Firestore persistent cache |
| `bugReporter.ts` | Buffer ring console + nav + soumission |
| `image.ts` | Compression JPEG client (`compressImage`) |
| `opti.ts` | Compteur d'écritures pour anti-spam |
| `weather.ts` | Fetch Open-Meteo + codes WMO |
| `species.ts` | DEFAULT_SPECIES + getSpeciesInfo + slugifySpecies |
| `firestoreWrite.ts` | Wrapper avec timeout (FirestoreWriteTimeoutError) |

### Types (`app/src/types/index.ts`)
Toutes les interfaces Firestore. Lecture rapide recommandée avant toute évolution :
- `UserProfile` — profil de l'utilisateur (+ liveLocation, fcmToken, mapOpenAt…)
- `Task` — pool/assignée/broadcast + récurrence + urgence
- `Animal` — identité + santé + parents + SIRE/transpondeur
- `AnimalCareEntry`, `AnimalPhoto`, `AnimalMeasurement`, `AnimalCondition`
- `MapPin` (union `PinType`), `WaterPoint`, `Battery`
- `EnclosureMovement` (historique pâturage)
- `CustomSpecies`
- `TempAccessCode`

### Service worker (`app/src/sw.ts`)
- **Workbox** : précache du shell + tuiles IGN/OSM (CacheFirst, cap 5 Go), météo (NetworkFirst).
- **Firebase Messaging** : `onBackgroundMessage` pour les notifs en arrière-plan.
- **notificationclick** : route vers `/map` ou autre URL fournie par `data.url`.
- **Important** : si tu changes les clés Firebase, modifie aussi `sw.ts` car Vite ne fait pas passer `import.meta.env` dans le SW.

---

## Cloud Functions (`functions/src/index.ts`)

Endpoint HTTP unique : **`checkReminders`**, déclenché par cron-job.org toutes les 30 min avec une clé secrète.

À chaque appel, vérifie :
1. **Points d'eau manuels** dont `nextReminderAt <= now` → notif au responsable
2. **Tâches urgentes en retard** → re-notif max 1×/h
3. **Tâches avec heure précise (`hasDueTime`)** :
   - Mode `broadcast: true` → notif à TOUS les users avec un FCM token
   - Sinon → notif à `assignedTo` seul
   - Anti-doublon via `reminderSentAt` ou `broadcastNotifiedAt`

Garde-fou : pas de notif si la tâche est en retard de plus de 6 h.

Heures silencieuses (`users/{uid}.silentStart` + `silentEnd`) : pas de FCM dans cette plage.

---

## Flux de données critiques

### Ajout d'un animal à un enclos
1. UI : panneau placement sur `/map` → `saveEnclosureAnimals(fenceId)`
2. `writeBatch` qui :
   - Update `animals/{id}.enclosureId`
   - Crée des `enclosure_movements` avec `movedAt` (réel) + `recordedAt` (saisie)

### Notification FCM (tâche assignée à 18:00)
1. Super-admin crée tâche avec `hasDueTime` + `assignedTo`
2. cron-job.org appelle `checkReminders`
3. Function lit `users/{assignedTo}.fcmToken` → `messaging.send()`
4. Client : SW `onBackgroundMessage` → `showNotification`
5. Tap utilisateur → `notificationclick` → ouvre `/dashboard` (ou data.url)

### Geofence (entrée dans un enclos)
1. `useGeofenceAlert` (global) cache enclos + animaux toutes les 5 min
2. `watchPosition` callback toutes les ≥ 60 s
3. `pointInPolygon` → si dans un enclos avec animaux stale (>12 h sans check)
4. `registration.showNotification` (locale, pas FCM)
5. Anti-spam via `users/{uid}.geofenceNotified[encId]` (6 h)

---

## Pièges connus (à lire avant d'évoluer le code)

### Queries Firestore qui demandent un index composite
Toute combinaison `where(X) + orderBy(Y)` avec `X !== Y` exige un index Firestore. Sinon `failed-precondition` au runtime. **Règle adoptée** : `where()` uniquement, tri client. Coût négligeable tant que les collections sont < 1000 docs.

### `userActions` / `consoleEntries` peuvent grossir
Le BugReporter envoie un buffer ring. OK pour l'instant, mais surveiller la taille des docs `bugReports/` si ça gonfle.

### `enclosure_movements` croit linéairement
Chaque déplacement = 1 doc. Sur 5 ans × 37 animaux × 12 rotations/an = ~2200 docs. Pas critique mais à archiver dans 2-3 ans.

### `liveLocation` / `mapOpenAt` / `livePointer` partagent `users/{uid}`
Update fréquent du même doc → frais Firestore. Anti-spam déjà en place (throttle 90 s sur `liveLocation`, 60 s sur `mapOpenAt`).

### Permissions sur `users/{uid}`
Une aide temporaire (anonyme) peut créer/update **son propre** doc users, mais pas voir les autres en write. Toute nouvelle propriété qu'on ajoute à UserProfile doit être writable uniquement par le user lui-même.

### FCM tokens deviennent invalides
La Cloud Function efface `fcmToken` quand `messaging/registration-token-not-registered`. Les users devront alors retoucher "Réactiver les notifications push" dans Settings.

---

## Conventions code

- **Pas de Tailwind arbitraire dans le code** : tout via les classes utilitaires + tokens du thème (`bg-forest`, `text-meadow`, etc.).
- **Pas de commentaires "what"** : on commente le "why" non-évident uniquement.
- **`isTemp` partout** : tout flow qui écrit doit guardrail avec `if (isTemp) return` AVANT le batch (sinon erreur permissions remontée à l'utilisateur).
- **`try / catch + alert`** sur les writes critiques user-initiés (delete pin, save, etc.).
- **Imports relatifs** : pas d'alias `@/`, on garde `../../`.

---

## Comment ajouter une nouvelle feature (checklist)

1. Lire les types dans `types/index.ts` qui pourraient bouger
2. Mettre à jour les rules dans `app/firestore.rules` si nouvelle collection ou propriété
3. Vérifier que le flow respecte `isTemp` (les aides temporaires ne doivent jamais déclencher d'écriture refusée)
4. Si nouvelle query avec `where + orderBy` → trier côté client
5. `tsc --noEmit` doit passer
6. `npm run build` doit passer
7. Si modifs functions : `firebase deploy --only functions`
8. Si modifs rules : `firebase deploy --only firestore:rules`
9. Update `AVANCEMENT.md` avec ce que tu viens d'ajouter
