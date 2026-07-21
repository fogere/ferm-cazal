# BACKLOG — Ferme Le Cazal

Fichier **unique**. Remplace `V4→V9.json`, `bug*.json`, `ferme-bugs-*.json`.
Source : **59 demandes uniques** dédupliquées depuis 9 exports (18/05 → 21/07/2026),
statut vérifié dans le code (commit ou `fichier:ligne`), pas déduit.
**49 livrées · 10 restantes.**

> **Vision** (Nils, 21/07/2026) : « identifier le travail à faire, voir **concrètement**
> ce qu'il y a à faire, **ne pas être découragé**, avoir une **vision ensemble** sur la ferme. »
> Mobile-first assumé. C'est le critère de tri de toute décision UX.

**Prod au 21/07/2026** (mesuré, service account) : `tasks` **291** (287 faites, **290 échéance passée**) ·
`animals` 41 · `map_pins` 126 · `enclosure_movements` 131 · `pin_photos` 64 · `alerts` 2 ·
`users` 7 (3 avec token FCM) · `bugReports` **0**.

---

## À FAIRE

### Décidé — prêt à coder
| Quoi | Où | Effort |
|---|---|---|
| **Supprimer la bulle 🐞 flottante** (garder capture auto + bouton dans Réglages) | `BugReportButton.tsx`, `App.tsx:141` | S |
| **Bannière /alerts → couleur selon gravité** (vert si rien, rouge si urgent) | `Alerts.tsx:74-75` + l.78/79/87 | XS |
| **Supprimer les groupes d'animaux** (code puis champ `config/farm.animalGroups`) | `Admin.tsx`, `Map.tsx` | S |
| **Filtrer les AbortError** du patch fetch (16/16 lignes des rapports = du bruit) | `bugReporter.ts:234-242` | XS |

> ⚠️ La bulle 🐞 **recouvre le bouton « + » de la carte** sur 36 px en `z-[9000]` :
> le tap ouvre la modale bug au lieu d'ajouter une épingle. Ce n'est pas cosmétique.

### En attente d'une décision de Nils
- **Vraie app mobile / widgets.** Widget d'écran d'accueil **impossible en PWA** (manifest
  `widgets` = Windows 11 uniquement ; `setAppBadge` non supporté sur Android). Voies :
  notification riche actionnable (~heures, le cron calcule **déjà** la donnée,
  `notify.cjs:459-504`) **vs** APK TWA + `AppWidgetProvider` Kotlin (3-6 j, 2ᵉ login, 0 €).
  Capacitor **tue le Service Worker** → plus de cache tuiles ni de maj auto. À écarter.
- **Touch targets globaux** (« click box »). Généraliser le principe *hitbox large + le plus
  proche gagne*, aujourd'hui présent **uniquement** dans l'édition carte (`SNAP_RADIUS_PX=44`).
  Piège : deux marges qui se chevauchent → c'est l'ordre du DOM qui gagne, pas le plus proche.
- **Fluidité carte, lot 1** : `updateWhenIdle={false}` + `keepBuffer={2}` **ensemble** et
  **bornés au mobile**. Jamais testé sur téléphone (voir Règles).
- **GPS toujours actif** : à réconcilier avec l'incident « téléphone qui chauffe » d'Eugénie (23/05).

### Fond de tiroir (anciens, partiels)
- **Tâches récurrentes** : perdent l'espace et le point d'eau à l'occurrence suivante →
  recopier les champs liés dans `cron/notify.cjs` (`processRecurringTasks`).
- **Notifications KO** : réparation auto active **seulement** sur Réglages ;
  `useMessaging.ts:85` (`tokenAttempted`) bloque tout nouvel essai après un échec.
- **`permission-denied`** sur les listeners de la carte quand la session expire
  (seul `useUsers.tsx:47` rattrape proprement).
- **Cron trop gourmand** : **891 lectures Firestore par exécution**, dont 868 pour 3 requêtes
  non bornées sur `tasks`. Borner → ~25. Coût croît avec l'historique (34 docs en mai → 291).
  ⚠️ Créer les index composites **avant** de pousser, sinon `notify.cjs:605` fait `exit(1)`.
- **Double notification** : le SDK FCM affiche la notif **puis** appelle `onBackgroundMessage`
  qui en affiche une 2ᵉ. Aucun `tag` des deux côtés (`sw.ts:62`, `notify.cjs:118`). À confirmer sur téléphone.

---

## ACQUIS — 115 commits, 18/05 → 02/07/2026

- **Carte · clôtures & espaces** — refonte complète : scission auto d'un espace par une clôture
  (S7, `polygon-split.ts` + `ScindageModal`), **refusion auto à la suppression** (S8),
  affectation des animaux à une moitié, herbe calculée par sous-espace, clôture ouverte
  vs refermée, enclaves, mode édition tracé (7 améliorations), snap 44 px « style Blender ».
- **Carte · tuiles** — proxy Cloudflare `ferme-tiles` (cache edge gratuit), cache SW workbox
  (revisite **1 ms**, prouvé), pré-cache hors-ligne manuel, retry auto des tuiles.
- **Carte · pins** — points d'eau, batteries + voyant ON/OFF, cours d'eau (2 phases),
  photos, atténuation visuelle du fil électrique, priorité au pin sur le parc au clic.
- **Tâches** — timeline « historique des jours », tri alpha, assignation à « tous »,
  heure précise, récurrences.
- **Animaux** — carnet de santé unifié (`CareJournal` + `careConfig`), SIRE/transpondeur,
  mouvements d'enclos (immuables).
- **Notifications** — FCM + cron GitHub Actions (matin + soir), pas de Cloud Function.
- **PWA** — mise à jour forcée (`sw.ts` activate → `client.navigate`), invite d'installation.
- **Bug reports** — capture auto console/navigation/viewport, page `/bugs`, système d'annonces.
- **Admin** — monitoring Firestore **maison** (compteurs reads/writes + jauges quota Spark).
- **Abandonné** — import fiches terrain (retiré le 04/06, commit `3375f3c`). **Ne pas reconstruire.**

---

## RÈGLES À NE JAMAIS OUBLIER

**Argent / infra**
- Firebase **Spark gratuit, 0 € absolu**. Blaze refusé. **Jamais** de Cloud Functions.
- ⚠️ **Jamais `firebase deploy` nu** : `firebase.json` déclare encore `functions` → ça plante.
  Toujours `--only hosting`. **`RUNBOOK.md` documente le contraire — à corriger.**
- Quota : 50 000 lectures/jour. Toute nouvelle feature se chiffre en lectures.

**Carte — pièges payés cher**
- `fadeAnimation={false}` → casse le fallback LOD → **carrés noirs**. Reverté.
- `keepBuffer={8}` → ~600 tuiles → thread principal noyé. Reverté.
- `updateWhenIdle={true}` sur PC → écran noir plus long. Reverté.
  **Mais sur Android c'est DÉJÀ la valeur par défaut** (`Browser.mobile`) : les 3 essais ont
  été jugés sur PC, aucun n'a jamais rien testé sur téléphone.
- `maxNativeZoom = 19` : l'IGN n'a pas de z20. Ne pas remonter.
- Le cache des tuiles est **parfait, prouvé de bout en bout**. Ne jamais le re-chasser :
  le goulot est la **peinture** Leaflet-DOM.

**Données**
- `config/farm` contient aussi `customSpecies` → **jamais** `set`/`delete` sur le doc,
  uniquement `FieldValue.delete()` sur le champ visé. Backup frais avant toute écriture.
- Firestore : `where()` seul + tri client (sinon index composite).
- `le-cazal-service-account.json` (gitignoré) donne un accès Admin réel → **mesurer, pas supposer**.

**Process**
- Nils teste **uniquement en prod**. Construire des tests autonomes, ne pas en faire un testeur manuel.
- **1 changement perf = 1 déploiement = 1 retour** (mieux/pareil/pire). Sinon on reverte à l'aveugle.
- Git : Nils accumule des modifs non commitées. **Jamais** `reset --hard` ni `checkout HEAD --`.
- La page `/bugs` a un bouton « exporter **puis tout supprimer** » → l'export JSON est souvent
  la **seule copie** d'un rapport. Lire avant de purger.
- Pas de monitoring payant (Sentry refusé). Pas de modale d'onboarding/tuto.
